import { Injectable, Logger } from '@nestjs/common';
import { Finish, ProductType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FinishReconciler } from './finish-reconciler.service';
import { FxService } from '../pricing/fx.service';
import { usdToMxnCents } from '../../common/money';
import {
  TcgcsvCatalogClient,
  deriveCardProductsFromTcgcsv,
} from '../pricing/providers/tcgcsv-singles.provider';

/**
 * CardProductResolverService (v1.29, ARCHITECTURE §4.27d) — REEMPLAZA a `StructuralFinishResolverService`.
 * Resuelve la composición «1 carta ↔ N productos TCGplayer» de un set desde TCGCSV (fuente ÚNICA de
 * estructura + precio por variante) y persiste:
 *   1. una fila `CardProduct` por `productId` (con SU `kind` y SUS `finishes`, leídos EXACTO de la
 *      fuente — jamás unidos con los de otro productId ⇒ el `normal` fantasma es imposible);
 *   2. una `PriceReference` POR (cardProduct, finish) con `source=tcgcsv_singles` (USD→MXN Banxico),
 *      SOLO cuando `marketPrice > 0` (money-safe: sin precio ⇒ «—»/null + PRICE_PENDING, jamás 0);
 *   3. recomputa `Card.availableFinishes` de las cartas tocadas desde `CardProduct.finishes`
 *      (`FinishReconciler`, §4.27c).
 *
 * Se invoca como PASO de `catalog-sync.importSet`, GATEADO a first-import o `--force` (NUNCA en
 * price-ingest). Best-effort/money-safe: fallo remoto ⇒ log, conserva lo previo, no aborta el import.
 * Los Deck Exclusives/promo se persisten como su propio `CardProduct` (kind deck_exclusive/promo) y NO
 * funden acabados con la carta de set — se exponen como productos vendibles separados (§4.27e).
 */
@Injectable()
export class CardProductResolverService {
  private readonly logger = new Logger(CardProductResolverService.name);
  private readonly groupIdCache = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly tcgcsv: TcgcsvCatalogClient,
    private readonly finishReconciler: FinishReconciler,
    private readonly fx: FxService,
  ) {}

  /**
   * Resuelve y persiste `CardProduct` + precios por variante del set local dado. Devuelve un resumen
   * de observabilidad (o `null` si no se resolvió el groupId). NO lanza por fallo remoto/parse del
   * fetch — best-effort; el llamador (`importSet`) además lo envuelve en try/catch.
   */
  async resolveCardProductsForSet(localSetId: string): Promise<{
    groupId: number;
    joined: number;
    products: number;
    pricesWritten: number;
    unjoined: number;
  } | null> {
    const set = await this.prisma.cardSet.findUnique({
      where: { id: localSetId },
      select: { id: true, name: true, pptSetId: true },
    });
    if (!set) return null;

    const groupId = await this.resolveGroupId(set);
    if (groupId == null) return null;

    const [products, prices] = await Promise.all([
      this.tcgcsv.getProducts(groupId),
      this.tcgcsv.getPrices(groupId),
    ]);
    const derived = deriveCardProductsFromTcgcsv(products, prices);
    if (derived.length === 0) {
      this.logger.warn(
        `card-product: grupo ${groupId} (set ${set.name}) no produjo ningún producto con acabado ` +
          `mapeable. No se toca ningún CardProduct (money-safe).`,
      );
      return { groupId, joined: 0, products: 0, pricesWritten: 0, unjoined: 0 };
    }

    const localCards = await this.prisma.card.findMany({
      where: { setId: localSetId },
      select: { id: true, number: true, tcgplayerId: true },
    });
    const byTcgId = new Map<string, { id: string }>();
    const byNorm = new Map<string, { id: string }[]>();
    for (const c of localCards) {
      if (c.tcgplayerId) byTcgId.set(c.tcgplayerId, c);
      const norm = normalizeCardNumber(c.number);
      const list = byNorm.get(norm);
      if (list) list.push(c);
      else byNorm.set(norm, [c]);
    }

    // FX una vez por corrida (§4.15f / §4.27e) — REUSA el módulo Banxico existente, no se inventa FX.
    const fxSnap = await this.fx.getCurrent();

    const touched = new Set<string>();
    let joined = 0;
    let unjoined = 0;
    let pricesWritten = 0;

    for (const dp of derived) {
      // Join por productId EXACTO (ancla tcgplayerId del set_base). Sin ancla → número normalizado
      // ÚNICO (típico: Deck Exclusives). El número solo ENRUTA a qué carta colgar; NO funde acabados.
      let owner = byTcgId.get(String(dp.productId));
      if (!owner && dp.number != null) {
        const cands = byNorm.get(normalizeCardNumber(dp.number));
        if (cands && cands.length === 1) owner = cands[0];
      }
      if (!owner) {
        unjoined += 1;
        continue;
      }
      joined += 1;

      // Upsert de CardProduct por tcgplayerProductId (REEMPLAZO money-safe de finishes/kind/name).
      const cardProduct = await this.prisma.cardProduct.upsert({
        where: { tcgplayerProductId: dp.productId },
        create: {
          cardId: owner.id,
          tcgplayerProductId: dp.productId,
          kind: dp.kind,
          name: dp.name,
          finishes: dp.finishes,
        },
        update: { cardId: owner.id, kind: dp.kind, name: dp.name, finishes: dp.finishes },
        select: { id: true },
      });
      touched.add(owner.id);

      // Precio POR VARIANTE (§4.27e): marketPrice de ESA variante → MXN Banxico. Ausente/≤0 ⇒ NO se
      // escribe fila (estructura ≠ precio): la celda queda «—»/null + PRICE_PENDING, jamás 0 inventado.
      for (const pf of dp.pricesByFinish) {
        if (pf.marketPrice == null || pf.marketPrice <= 0) continue;
        const marketUsdCents = Math.round(pf.marketPrice * 100);
        if (marketUsdCents <= 0) continue;
        await this.upsertVariantPrice(owner.id, cardProduct.id, pf.finish, marketUsdCents, fxSnap);
        pricesWritten += 1;
      }
    }

    await this.finishReconciler.reconcile([...touched]);
    this.logger.log(
      `card-product: set ${set.name} (grupo ${groupId}) — products=${derived.length}, joined=${joined}, ` +
        `pricesWritten=${pricesWritten}, unjoined=${unjoined} (conservan su valor previo, money-safe).`,
    );
    return { groupId, joined, products: derived.length, pricesWritten, unjoined };
  }

  /**
   * Upsert de la `PriceReference` POR (carta, producto, acabado) del día, `source=tcgcsv_singles`.
   * Respeta el override manual del admin (no clobbea). Money-safe: solo se llama con market > 0.
   */
  private async upsertVariantPrice(
    cardId: string,
    cardProductId: string,
    finish: Finish,
    marketUsdCents: number,
    fx: { rate: number; bufferPct: number },
  ): Promise<void> {
    const productType: ProductType = 'raw';
    const gradeKey = 'raw:NM';
    const capturedDate = today();
    const key = {
      cardId_productType_gradeKey_finish_capturedDate_cardProductId: {
        cardId,
        productType,
        gradeKey,
        finish,
        capturedDate,
        cardProductId,
      },
    };
    const existing = await this.prisma.priceReference.findUnique({ where: key });
    if (existing?.isManualOverride) return; // §4.27f: el override de MERCADO manda
    const priceMxnCents = usdToMxnCents(marketUsdCents, fx.rate, fx.bufferPct);
    const data = {
      source: 'tcgcsv_singles' as const,
      priceUsdCents: marketUsdCents,
      fxRate: fx.rate,
      fxBufferPct: fx.bufferPct,
      priceMxnCents,
      isManualOverride: false,
    };
    await this.prisma.priceReference.upsert({
      where: key,
      create: { cardId, productType, gradeKey, finish, capturedDate, cardProductId, ...data },
      update: data,
    });
  }

  /**
   * §4.27d paso 1 — resuelve el `groupId` TCGCSV del set (misma lógica S-D3, sin cambios): `pptSetId`
   * entero == groupId; si no, match ÚNICO por nombre (exacto preferido) vía `listGroups()`. `null`
   * (con log) si no hay match ÚNICO ⇒ no se toca nada (money-safe).
   */
  private async resolveGroupId(set: {
    id: string;
    name: string;
    pptSetId: string | null;
  }): Promise<number | null> {
    const cached = this.groupIdCache.get(set.id);
    if (cached != null) return cached;

    if (set.pptSetId && /^\d+$/.test(set.pptSetId)) {
      const groupId = parseInt(set.pptSetId, 10);
      this.groupIdCache.set(set.id, groupId);
      return groupId;
    }

    const groups = await this.tcgcsv.listGroups();
    const target = normalizeName(set.name);
    const exact = groups.filter((g) => normalizeName(g.name) === target);
    if (exact.length === 1) {
      this.groupIdCache.set(set.id, exact[0].groupId);
      return exact[0].groupId;
    }
    const matches =
      exact.length === 0
        ? groups.filter((g) => {
            const gn = normalizeName(g.name);
            return gn.includes(target) || target.includes(gn);
          })
        : exact;
    if (matches.length === 1) {
      this.groupIdCache.set(set.id, matches[0].groupId);
      return matches[0].groupId;
    }
    this.logger.warn(
      `card-product: no se resolvió un groupId ÚNICO para "${set.name}" (${matches.length} candidatos; ` +
        `pptSetId="${set.pptSetId ?? ''}"). No se toca ningún CardProduct (money-safe).`,
    );
    return null;
  }
}

function today(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Normaliza un número de carta para el join TCGCSV↔local: parte antes de `/`, ceros a la izquierda
 * colapsados en números puros (`"057"→"57"`); prefijos (`"TG12"`) en mayúsculas. Robusto a que
 * pokemontcg.io guarde `"57"` y TCGCSV `"057/191"`.
 */
export function normalizeCardNumber(raw: string): string {
  const beforeSlash = (raw ?? '').split('/')[0].trim();
  if (/^\d+$/.test(beforeSlash)) return String(parseInt(beforeSlash, 10));
  return beforeSlash.toUpperCase();
}

/** Normaliza un nombre de set/grupo para el match: minúsculas, solo alfanuméricos. */
export function normalizeName(raw: string): string {
  return (raw ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
