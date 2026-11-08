import { Injectable, Logger } from '@nestjs/common';
import { Finish, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TcgcsvCatalogClient } from '../pricing/providers/tcgcsv-singles.provider';
import { TcgcsvPriceRow, deriveStructuralFinishes, tcgcsvSubTypeToFinish } from '../pricing/pricing.types';
import { PricingService } from '../pricing/pricing.service';
import { FxService } from '../pricing/fx.service';
import { FinishReconciler } from './finish-reconciler.service';
import { PromoSkipped, planPromoSet } from './promo-set-plan';
import { exceedsFieldLimits } from './tcgcsv-card-name';

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
  /** QA-PV-PEND: cartas del set SIN producto set_base vendible tras el plan (≠ `pricesPending`, que cuenta filas de precio). */
  pendingCards: number;
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
      const skipped: PromoSkipped[] = [...plan.skipped];
      const numberOf = new Map(localCards.map((c) => [c.id, c.number]));
      let joined = 0;
      let pricesWritten = 0;
      let pricesPending = 0;
      let unjoined = 0;

      // 1) Plan efectivo: solo lo colgable (con acabado mapeable y campos dentro de tope).
      type Eff = { it: (typeof plan.items)[number]; finishes: Finish[]; priceRows: TcgcsvPriceRow[] };
      const eff = new Map<number, Eff>();
      for (const it of plan.items) {
        const priceRows = pricesByProduct.get(it.product.productId) ?? [];
        const finishes = deriveStructuralFinishes(priceRows.map((r) => r.subTypeName));
        if (finishes.length === 0) {
          unjoined += 1; // sin ningún acabado mapeable no hay nada que colgar: la carta queda «Precio pendiente»
          continue;
        }
        if (exceedsFieldLimits({ name: it.product.name, number: numberOf.get(it.cardId) ?? '', rarity: null, stampLabel: it.stamp?.label ?? null })) {
          skipped.push({ number: numberOf.get(it.cardId) ?? `#${it.product.productId}`, reason: 'field_too_long' });
          continue;
        }
        eff.set(it.product.productId, { it, finishes, priceRows });
      }

      // 2) Reconciliación (PV-1): lo que ya existe del set y no coincide con el plan se retira o se re-cuelga.
      const cardIds = localCards.map((c) => c.id);
      const existing = await tx.cardProduct.findMany({
        where: { OR: [{ sourceGroupId: groupId }, { cardId: { in: cardIds }, kind: 'set_base' }] },
        select: { id: true, tcgplayerProductId: true, cardId: true },
      });
      const pids = existing.map((e) => e.tcgplayerProductId);
      const uuids = existing.map((e) => e.id);
      const inUsePids = new Set<number>();
      if (existing.length > 0) {
        for (const r of await tx.inventoryItem.findMany({ where: { cardProductId: { in: pids } }, distinct: ['cardProductId'], select: { cardProductId: true } }))
          if (r.cardProductId != null) inUsePids.add(r.cardProductId);
        for (const r of await tx.sellRequestItem.findMany({ where: { cardProductId: { in: pids } }, distinct: ['cardProductId'], select: { cardProductId: true } }))
          if (r.cardProductId != null) inUsePids.add(r.cardProductId);
        for (const r of await tx.pendingPriceEntry.findMany({ where: { cardProductId: { in: pids } }, distinct: ['cardProductId'], select: { cardProductId: true } }))
          if (r.cardProductId != null) inUsePids.add(r.cardProductId);
        const byUuid = new Map(existing.map((e) => [e.id, e.tcgplayerProductId]));
        for (const r of await tx.priceReviewCase.findMany({ where: { cardProductId: { in: uuids } }, select: { cardProductId: true } }))
          if (r.cardProductId != null && byUuid.has(r.cardProductId)) inUsePids.add(byUuid.get(r.cardProductId)!);
      }
      const reconcileIds = new Set<string>();
      const staleIds: string[] = [];
      for (const e of existing) {
        const want = eff.get(e.tcgplayerProductId);
        const label = numberOf.get(e.cardId) ?? `#${e.tcgplayerProductId}`;
        if (want && want.it.cardId === e.cardId) continue; // sigue en el plan en su misma carta
        if (inUsePids.has(e.tcgplayerProductId)) {
          // Hay piezas/solicitudes que lo usan: NO se borra ni se mueve (no existe bandera «inactivo»); se reporta.
          if (want) eff.delete(e.tcgplayerProductId); // y no se re-cuelga de otra carta
          skipped.push({ number: label, reason: 'stale_in_use' });
          continue;
        }
        if (want) continue; // re-colgado a otra carta sin uso: el upsert lo mueve y abajo se mueven sus precios
        staleIds.push(e.id);
        reconcileIds.add(e.cardId);
      }
      if (staleIds.length > 0) {
        await tx.priceReference.deleteMany({ where: { cardProductId: { in: staleIds } } });
        await tx.cardProduct.deleteMany({ where: { id: { in: staleIds } } });
      }

      for (const { it, finishes, priceRows } of eff.values()) {
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
        // PV-1(c): el precio de un producto re-colgado de carta no puede quedar atado al cardId anterior.
        await tx.priceReference.updateMany({ where: { cardProductId: cp.id, cardId: { not: it.cardId } }, data: { cardId: it.cardId } });
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
      await this.finishReconciler.reconcile([...new Set([...touched, ...reconcileIds])], tx);
      const baseCards = new Set<string>();
      for (const { it } of eff.values()) if (it.kind === 'set_base') baseCards.add(it.cardId);
      for (const e of existing) if (inUsePids.has(e.tcgplayerProductId)) baseCards.add(e.cardId);
      const pendingCards = localCards.filter((c) => !baseCards.has(c.id)).length;
      return { plan, skipped, pendingCards, touched: touched.size, joined, pricesWritten, pricesPending, unjoined };
    }, TX_OPTS);

    const { joined: uni, touched: tocadas, pricesWritten: escritos, pricesPending: sinPrecio, unjoined: sinUnir } = res;
    this.logger.log(
      `promo-set: grupo ${groupId} — unidos=${uni} cartasTocadas=${tocadas} preciosEscritos=${escritos} ` +
        `preciosPendientes=${sinPrecio} sinUnir=${sinUnir} omitidos=${res.skipped.length}.`,
    );
    return {
      groupId,
      joined: res.joined,
      products: res.plan.items.length,
      pricesWritten: res.pricesWritten,
      pricesPending: res.pricesPending,
      unjoined: res.unjoined,
      cardsTouched: res.touched,
      pendingCards: res.pendingCards,
      promoSkipped: res.skipped,
    };
  }
}
