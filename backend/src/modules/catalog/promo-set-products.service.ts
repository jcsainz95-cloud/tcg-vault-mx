import { Injectable, Logger } from '@nestjs/common';
import { Finish, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TcgcsvCatalogClient } from '../pricing/providers/tcgcsv-singles.provider';
import { TcgcsvPriceRow, deriveStructuralFinishes, tcgcsvSubTypeToFinish } from '../pricing/pricing.types';
import { PricingService } from '../pricing/pricing.service';
import { FxService } from '../pricing/fx.service';
import { FinishReconciler } from './finish-reconciler.service';
import { PromoSkipped, planPromoSet } from './promo-set-plan';

/** Mismo tope de cordura que el barrido diario y el import de P-PROMOS: un `market` mayor es dato corrupto. */
const MAX_SANE_MARKET_USD = 50_000;
const PROMO_LOCK_KEY = 'promo-set-products';
const TX_OPTS = { maxWait: 10_000, timeout: 120_000 } as const;

export interface PromoSetProductsResult {
  groupId: number;
  joined: number;
  products: number;
  pricesWritten: number;
  pricesPending: number;
  unjoined: number;
  cardsTouched: number;
  promoSkipped: PromoSkipped[];
}

/**
 * PromoSetProductsService (P-PROMOS-VIEJAS · ARCHITECTURE §5.13) — productos y precios de un set de `PTCG_PROMO_GROUPS`.
 * Las CARTAS ya existen (pokemontcg.io): aquí NUNCA se crea carta. `planPromoSet` decide `set_base`/`stamped`; este servicio
 * hace upsert por `tcgplayerProductId` y escribe el precio por (producto, acabado) — un sello jamás hereda el de la plana.
 * Todo el fetch va ANTES de la transacción; luego UNA `$transaction` por set con candado consultivo (todo-o-nada; segunda
 * corrida ⇒ 0 filas nuevas). Sin precio ⇒ sin `PriceReference` (PRICE_PENDING), jamás 0.
 */
@Injectable()
export class PromoSetProductsService {
  private readonly logger = new Logger(PromoSetProductsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tcgcsv: TcgcsvCatalogClient,
    private readonly finishReconciler: FinishReconciler,
    private readonly pricing: PricingService,
    private readonly fx: FxService,
  ) {}

  async run(localSetId: string, groupId: number, numberPrefix: string): Promise<PromoSetProductsResult> {
    const [products, prices] = await Promise.all([this.tcgcsv.getCardProducts(groupId), this.tcgcsv.getPrices(groupId)]);
    const fxSnap = await this.fx.getCurrent();
    const pricesByProduct = new Map<number, TcgcsvPriceRow[]>();
    for (const r of prices) {
      const l = pricesByProduct.get(r.productId);
      if (l) l.push(r);
      else pricesByProduct.set(r.productId, [r]);
    }

    const res = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${PROMO_LOCK_KEY}), ${groupId}::int)`;
      const localCards = await tx.card.findMany({ where: { setId: localSetId }, select: { id: true, number: true } });
      const plan = planPromoSet(localCards, products, numberPrefix);
      const touched = new Set<string>();
      let joined = 0;
      let pricesWritten = 0;
      let pricesPending = 0;
      let unjoined = 0;
      for (const it of plan.items) {
        const priceRows = pricesByProduct.get(it.product.productId) ?? [];
        const finishes = deriveStructuralFinishes(priceRows.map((r) => r.subTypeName));
        if (finishes.length === 0) {
          unjoined += 1; // sin ningún acabado mapeable no hay nada que colgar: la carta queda «Precio pendiente»
          continue;
        }
        const data = {
          cardId: it.cardId,
          kind: it.kind,
          name: it.product.name,
          finishes,
          stampType: it.stamp?.type ?? null,
          stampLabel: it.stamp?.label ?? null,
          sourceGroupId: groupId,
        };
        const cp = await tx.cardProduct.upsert({
          where: { tcgplayerProductId: it.product.productId },
          create: { tcgplayerProductId: it.product.productId, ...data },
          update: data,
          select: { id: true },
        });
        joined += 1;
        touched.add(it.cardId);
        const seen = new Set<Finish>();
        for (const r of priceRows) {
          const finish = tcgcsvSubTypeToFinish(r.subTypeName);
          if (finish == null || seen.has(finish)) continue;
          seen.add(finish);
          const m = r.marketPrice;
          const cents = m != null && Number.isFinite(m) && m > 0 && m <= MAX_SANE_MARKET_USD ? Math.round(m * 100) : 0;
          if (cents <= 0) {
            pricesPending += 1;
            continue;
          }
          await this.pricing.persistMarketReference(
            it.cardId,
            finish,
            { marketCents: cents, currency: 'USD', source: 'tcgcsv_singles' },
            fxSnap,
            cp.id,
            tx as Prisma.TransactionClient,
          );
          pricesWritten += 1;
        }
      }
      await this.finishReconciler.reconcile([...touched], tx);
      return { plan, touched: touched.size, joined, pricesWritten, pricesPending, unjoined };
    }, TX_OPTS);

    this.logger.log(
      `promo-set: grupo ${groupId} — joined=${res.joined} cardsTouched=${res.touched} pricesWritten=${res.pricesWritten} ` +
        `pricesPending=${res.pricesPending} unjoined=${res.unjoined} skipped=${res.plan.skipped.length}.`,
    );
    return {
      groupId,
      joined: res.joined,
      products: res.plan.items.length,
      pricesWritten: res.pricesWritten,
      pricesPending: res.pricesPending,
      unjoined: res.unjoined,
      cardsTouched: res.touched,
      promoSkipped: res.plan.skipped,
    };
  }
}
