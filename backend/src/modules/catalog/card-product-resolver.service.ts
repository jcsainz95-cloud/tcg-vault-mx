import { Injectable, Logger, Optional } from '@nestjs/common';
import { Finish, Prisma, PriceRefKind, ProductType } from '@prisma/client';
import { lockPriceWriteShared, withPriceWriteShared } from '../pricing/price-write-lock';
import { SettingsService } from '../settings/settings.service';
import { patternClassifyEnabled } from '../pricing/pattern-dials';
import { PrismaService } from '../../prisma/prisma.service';
import { FinishReconciler } from './finish-reconciler.service';
import { FxService } from '../pricing/fx.service';
import { usdToMxnCents } from '../../common/money';
import {
  TcgcsvCatalogClient,
  deriveCardProductsFromTcgcsv,
} from '../pricing/providers/tcgcsv-singles.provider';
// FUENTE ÚNICA del match set local ↔ grupo TCGCSV (S-D3 / §4.27d). Ver `resolveGroupId`: esta
// escalera NO se reimplementa aquí ni «se adapta»; se llama. La copia local es lo que dejó a la ruta
// de ESTRUCTURA sin el arreglo del prefijo (P-46) que la de PRECIO sí tenía.
import { resolveTcgcsvGroupForSet, scoreGroupCandidates, type GroupCandidate } from '../pricing/providers/tcgcsv-group-match';
import { isTcgcsvOrigin } from './tcgcsv-card-name';
import { planCardLinks } from './card-link-plan';
import { promoGroupFor } from './promo-set-groups';
import { PromoSetProductsService } from './promo-set-products.service';
import type { PromoSkipped } from './promo-set-plan';
import type { TcgcsvCallBudget } from './tcgcsv-call-budget';
import type { TcgcsvGroupRef } from '../pricing/pricing.types';

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
    // P-PROMOS-VIEJAS (§5.13): sets de `PTCG_PROMO_GROUPS` ⇒ no pasan por `deriveCardProductsFromTcgcsv`.
    @Optional() private readonly promoProducts?: PromoSetProductsService,
    // §PRICE-PATTERN: dial `pattern_classify_enabled` (apagado ⇒ no se crea ningún `variant`).
    @Optional() private readonly settings?: SettingsService,
  ) {}

  /**
   * Resuelve y persiste `CardProduct` + precios por variante del set local dado. Devuelve un resumen
   * de observabilidad (o `null` si no se resolvió el groupId). NO lanza por fallo remoto/parse del
   * fetch — best-effort; el llamador (`importSet`) además lo envuelve en try/catch.
   */
  async resolveCardProductsForSet(
    localSetId: string,
    opts: {
      onlyUnlinked?: boolean;
      /** §AUTO-ENLACE fase 2: presupuesto de llamadas de la tanda (cuenta, reintenta una vez y corta). Sin él, llamadas directas como siempre. */
      budget?: TcgcsvCallBudget;
      /** `listGroups` ya descargado en esta corrida (no se vuelve a llamar). */
      groups?: readonly TcgcsvGroupRef[];
      /** Tope de cartas NUEVAS a ligar en este set (lo que sobra queda para mañana, `batch_cap`). */
      maxLinks?: number;
    } = {},
  ): Promise<{
    groupId: number;
    joined: number;
    products: number;
    pricesWritten: number;
    // M-34 (aditivo): variantes (producto×acabado) DECLARADAS por estructura pero SIN precio de
    // mercado (`marketPrice` null/≤0) ⇒ celda «—»/PRICE_PENDING (money-safe, jamás 0). Lo expone
    // el nuevo camino `refresh-variants` en su resumen (`pending`). No altera el comportamiento
    // previo del resolver (solo se cuenta lo que ya se OMITÍA por money-safe).
    pricesPending: number;
    unjoined: number;
    /**
     * D2 (v1.64) — CARTAS que ESTA corrida tocó de verdad: `Card` DISTINTAS a las que se les
     * upserteó al menos un `CardProduct` y a las que, por tanto, se les recomputó
     * `availableFinishes` (`touched`, el mismo conjunto que se pasa al `FinishReconciler`).
     *
     * NO es «cuántas cartas tiene el set» (eso es el universo local, `cardsInSet` en el llamador):
     * son dos predicados distintos y por eso llevan nombres distintos (ARCHITECTURE §0-B.3 regla 8
     * aplicada al código). Un set de 191 cartas del que TCGCSV no reconoce ninguna da
     * `cardsTouched: 0` — que es el hecho que el operador necesita ver, no un 191 tranquilizador.
     */
    cardsTouched: number;
    /** §PRECIO-SIN-ENLACE: productos NO enlazados por número/nombre repetido (colisión) y por otro motivo (omitidos). */
    collisions?: number;
    omittedProducts?: number;
    /** §PRECIO-SIN-ENLACE (I-4): productos con OTRO dueño que una carta sin enlace habría tomado (`product_owned_by_other`). */
    conflicts?: number;
    /** Productos no enlazados por motivo (`collision|owner_conflict|card_already_linked|no_local_card|name_mismatch`; sin `skipped_linked`). */
    reasonCounts?: Record<string, number>;
    /** Hasta 20 productos no enlazados: número y motivo (`cardId` = la carta que lo habría tomado, si la hay). */
    examples?: { cardId: string | null; number: string | null; reason: string }[];
    /** Cartas tocadas por la corrida (para medir inventario con acabado distinto). */
    touchedCardIds?: string[];
    /** P-PROMOS-VIEJAS: productos omitidos de un set de `PTCG_PROMO_GROUPS` (solo en esos sets). */
    promoSkipped?: PromoSkipped[];
    /** QA-PV-PEND: solo rutas de promos viejas. */
    pendingCards?: number;
    /** §AUTO-ENLACE F4: grupo TCGCSV usado (nombre del proveedor) y cómo se eligió; el nombre es `null` si `listGroups` no respondió. */
    groupName?: string | null;
    groupVia?: 'auto' | 'confirmed' | 'promo_table';
  } | null> {
    const set = await this.prisma.cardSet.findUnique({
      where: { id: localSetId },
      select: { id: true, name: true, pptSetId: true, externalId: true, series: true, releaseDate: true, printedTotal: true, cardGroupId: true, cardGroupVia: true },
    });
    if (!set) return null;
    // P-PROMOS (§5.12): los sets `tcgcsv:` los puebla SU importador (cartas, sellos y precios por productId). Este
    // resolver uniría por número y pisaría un `CardProduct stamped` como `promo` ⇒ NO los recorre (refresh-variants).
    if (isTcgcsvOrigin(set.externalId)) return null;

    const resolved = await this.resolveGroup(set, opts.groups);
    if (resolved == null) return null;
    const groupId = resolved.groupId;

    const promo = promoGroupFor(set.externalId);
    if (promo) {
      // Modo reparación: los sets de promos viejas tienen su propia ruta y no se tocan aquí.
      if (!this.promoProducts || opts.onlyUnlinked) return null;
      const pr = await this.promoProducts.run(set.id, groupId, promo.numberPrefix);
      // B-2: la tabla manda; la ruta de promos NO consulta `listGroups` (la tabla no trae nombre ⇒ null).
      return { ...pr, groupName: null, groupVia: 'promo_table' as const };
    }

    const viaBudget = <T>(fn: () => Promise<T>): Promise<T> => (opts.budget ? opts.budget.call(fn) : fn());
    // Secuencial con presupuesto (el contador y el disyuntor deben ver cada llamada en orden); sin presupuesto, en paralelo como siempre.
    const [products, prices] = opts.budget
      ? [await viaBudget(() => this.tcgcsv.getProducts(groupId)), await viaBudget(() => this.tcgcsv.getPrices(groupId))]
      : await Promise.all([this.tcgcsv.getProducts(groupId), this.tcgcsv.getPrices(groupId)]);
    const derived = deriveCardProductsFromTcgcsv(products, prices, { variantEnabled: await patternClassifyEnabled(this.settings) });
    const groupName = await this.groupNameOf(groupId, opts.groups);
    if (derived.length === 0) {
      this.logger.warn(
        `card-product: grupo ${groupId} (set ${set.name}) no produjo ningún producto con acabado ` +
          `mapeable. No se toca ningún CardProduct (money-safe).`,
      );
      return {
        groupId,
        joined: 0,
        products: 0,
        pricesWritten: 0,
        pricesPending: 0,
        unjoined: 0,
        cardsTouched: 0, // MEDIDO: no se tocó ninguna carta (no hay producto mapeable).
        collisions: 0,
        omittedProducts: 0,
        touchedCardIds: [],
        groupName,
        groupVia: resolved.via,
      };
    }

    // §PRECIO-SIN-ENLACE: enlace por reglas (id externo → número+nombre → número, único en AMBOS lados), nunca
    // pisa un producto con dueño ni una carta ya enlazada (modo `onlyUnlinked`). Ver `card-link-plan.ts`.
    const localCards = await this.prisma.card.findMany({
      where: { setId: localSetId },
      select: { id: true, number: true, name: true, tcgplayerId: true, _count: { select: { cardProducts: true } } },
    });
    const existingOwners = await this.prisma.cardProduct.findMany({
      where: { tcgplayerProductId: { in: derived.map((d) => d.productId) } },
      select: { id: true, tcgplayerProductId: true, cardId: true, kind: true, finishes: true },
    });
    const ownerOf = new Map(existingOwners.map((o) => [o.tcgplayerProductId, o.cardId]));
    const prevKind = new Map(existingOwners.map((o) => [o.tcgplayerProductId, o.kind]));
    const plan = planCardLinks(
      derived.map((d) => ({ productId: d.productId, name: d.name, number: d.number, kind: d.kind })),
      localCards.map((c) => ({ id: c.id, number: c.number, name: c.name, tcgplayerId: c.tcgplayerId, productCount: c._count.cardProducts })),
      ownerOf,
      normalizeCardNumber,
      { onlyUnlinked: opts.onlyUnlinked === true },
    );
    if (plan.collisions > 0 || plan.omitted > 0) {
      this.logger.warn(
        `card-product: set ${set.name} (grupo ${groupId}) — ${plan.collisions} producto(s) en colisión de número/nombre y ` +
          `${plan.omitted} sin carta local/ya enlazada NO se enlazan (money-safe; reportados).`,
      );
    }

    // FX una vez por corrida (§4.15f / §4.27e) — REUSA el módulo Banxico existente, no se inventa FX.
    const fxSnap = await this.fx.getCurrent();

    const touched = new Set<string>();
    let joined = 0;
    let unjoined = 0;
    let pricesWritten = 0;
    let pricesPending = 0;
    let finishNotInProduct = 0;
    let batchCapped = 0;

    for (const dp of derived) {
      // Join por productId EXACTO (ancla tcgplayerId del set_base). Sin ancla → número normalizado
      // ÚNICO (típico: Deck Exclusives). El número solo ENRUTA a qué carta colgar; NO funde acabados.
      const link = plan.links.get(dp.productId);
      const owner = link ? { id: link.cardId } : undefined;
      if (!owner) {
        if (!(opts.onlyUnlinked && ownerOf.has(dp.productId))) unjoined += 1;
        continue;
      }
      // §AUTO-ENLACE fase 2: tope de cartas ligadas por tanda; lo que sobra se liga mañana (no se pierde: sigue sin ligar).
      if (opts.maxLinks != null && !ownerOf.has(dp.productId) && joined >= opts.maxLinks) {
        batchCapped += 1;
        continue;
      }
      joined += 1;

      // Upsert de CardProduct por tcgplayerProductId (REEMPLAZO money-safe de finishes/kind/name).
      // Reclasificar HACIA o DESDE `variant` es del job `pattern-reclassify` (freno + auditoría + recálculo): aquí se conserva el kind actual.
      const prevK = prevKind.get(dp.productId);
      const kind = prevK && (prevK === 'variant') !== (dp.kind === 'variant') ? prevK : dp.kind;
      const cardProduct = await this.prisma.cardProduct.upsert({
        where: { tcgplayerProductId: dp.productId },
        create: {
          cardId: owner.id,
          tcgplayerProductId: dp.productId,
          kind: dp.kind,
          name: dp.name,
          finishes: dp.finishes,
        },
        update: { cardId: owner.id, kind, name: dp.name, finishes: dp.finishes },
        select: { id: true },
      });
      touched.add(owner.id);

      // Precio POR VARIANTE (§4.27e): marketPrice de ESA variante → MXN Banxico. Ausente/≤0 ⇒ NO se
      // escribe fila (estructura ≠ precio): la celda queda «—»/null + PRICE_PENDING, jamás 0 inventado.
      for (const pf of dp.pricesByFinish) {
        if (pf.marketPrice == null || pf.marketPrice <= 0) {
          pricesPending += 1; // estructura sin precio ⇒ «—»/PRICE_PENDING (money-safe, jamás 0)
          continue;
        }
        const marketUsdCents = Math.round(pf.marketPrice * 100);
        if (marketUsdCents <= 0) {
          pricesPending += 1;
          continue;
        }
        await this.upsertVariantPrice(owner.id, cardProduct.id, pf.finish, marketUsdCents, fxSnap);
        pricesWritten += 1;
      }
    }

    // §AUTO-ENLACE B4: en modo reparación, los productos YA enlazados (sin dueño distinto) también se precian en la misma
    // corrida con el mismo escritor de siempre (`upsertVariantPrice`, respeta override manual); no se toca ningún CardProduct.
    if (opts.onlyUnlinked) {
      const skipped = new Set(plan.unlinked.filter((u) => u.reason === 'skipped_linked').map((u) => u.productId));
      const inSet = new Set(localCards.map((c) => c.id));
      const cpId = new Map(existingOwners.map((o) => [o.tcgplayerProductId, o.id]));
      // B-1: solo se precian acabados ya presentes en `CardProduct.finishes`. Un acabado nuevo de la fuente NO se escribe
      // aquí (no hay reconciliación de estructura en la reparación): lo trae «Sincronizar este set»; evita filas huérfanas.
      const finishesOf = new Map(existingOwners.map((o) => [o.tcgplayerProductId, new Set<string>(o.finishes as string[])]));
      for (const dp of derived) {
        const ownerId = ownerOf.get(dp.productId);
        const cpid = cpId.get(dp.productId);
        if (!skipped.has(dp.productId) || !ownerId || !cpid || !inSet.has(ownerId)) continue;
        for (const pf of dp.pricesByFinish) {
          if (!finishesOf.get(dp.productId)?.has(pf.finish)) {
            finishNotInProduct += 1; // se REPORTA (`finish_not_in_product`); la carta queda PRICE_PENDING en ese acabado
            continue;
          }
          const cents = pf.marketPrice == null || pf.marketPrice <= 0 ? 0 : Math.round(pf.marketPrice * 100);
          if (cents <= 0) {
            pricesPending += 1;
            continue;
          }
          await this.upsertVariantPrice(ownerId, cpid, pf.finish, cents, fxSnap);
          pricesWritten += 1;
        }
      }
    }

    await this.finishReconciler.reconcile([...touched]);
    this.logger.log(
      `card-product: set ${set.name} (grupo ${groupId}) — products=${derived.length}, joined=${joined}, ` +
        `cardsTouched=${touched.size}, pricesWritten=${pricesWritten}, unjoined=${unjoined} ` +
        `(conservan su valor previo, money-safe).`,
    );
    return {
      groupId,
      joined,
      products: derived.length,
      pricesWritten,
      pricesPending,
      unjoined,
      cardsTouched: touched.size, // cartas DISTINTAS tocadas por ESTA corrida (D2)
      collisions: plan.collisions,
      omittedProducts: plan.omitted,
      conflicts: plan.conflicts,
      reasonCounts: plan.unlinked.reduce<Record<string, number>>((acc, u) => {
        if (u.reason !== 'skipped_linked') acc[u.reason] = (acc[u.reason] ?? 0) + 1;
        return acc;
      }, { ...(finishNotInProduct > 0 ? { finish_not_in_product: finishNotInProduct } : {}), ...(batchCapped > 0 ? { batch_cap: batchCapped } : {}) }),
      examples: plan.unlinked
        .filter((u) => u.reason !== 'skipped_linked')
        .slice(0, 20)
        .map((u) => ({ cardId: ownerOf.get(u.productId) ?? null, number: derived.find((d) => d.productId === u.productId)?.number ?? null, reason: u.reason })),
      touchedCardIds: [...touched],
      groupName,
      groupVia: resolved.via,
    };
  }

  /** Nombre que TCGCSV da al grupo (para mostrarlo al dueño); `null` si `listGroups` falla o no lo trae. Nunca lanza. */
  private async groupNameOf(groupId: number, groups?: readonly TcgcsvGroupRef[]): Promise<string | null> {
    try {
      return (groups ?? (await this.tcgcsv.listGroups())).find((g) => g.groupId === groupId)?.name ?? null;
    } catch {
      return null;
    }
  }

  /**
   * §AUTO-ENLACE (solo lectura de proveedor, sin escribir): por qué un set no resuelve grupo. `promo_table` si lo fija
   * `PTCG_PROMO_GROUPS` (el grupo SÍ existe aunque la ruta de reparación no lo recorra), `ambiguous` si empatan varios.
   */
  async describeGroup(
    localSetId: string,
    groups?: readonly TcgcsvGroupRef[],
  ): Promise<{ groupId: number | null; name: string | null; via: 'auto' | 'confirmed' | 'promo_table' | null; failure: 'ambiguous' | 'none' | null; candidates: GroupCandidate[] }> {
    const set = await this.prisma.cardSet.findUnique({
      where: { id: localSetId },
      select: { id: true, name: true, pptSetId: true, externalId: true, series: true, releaseDate: true, cardGroupId: true, cardGroupVia: true },
    });
    if (!set) return { groupId: null, name: null, via: null, failure: 'none', candidates: [] };
    const promo = promoGroupFor(set.externalId);
    if (promo) return { groupId: promo.groupId, name: null, via: 'promo_table', failure: null, candidates: [] }; // B-2: sin `listGroups` en promos
    const all = groups ?? (await this.tcgcsv.listGroups());
    const m = await resolveTcgcsvGroupForSet(set, async () => all);
    if (m.groupId != null) {
      return { groupId: m.groupId, name: all.find((g) => g.groupId === m.groupId)?.name ?? null, via: m.via === 'confirmed' ? 'confirmed' : 'auto', failure: null, candidates: [] };
    }
    return { groupId: null, name: null, via: null, failure: m.failure === 'ambiguous' ? 'ambiguous' : 'none', candidates: scoreGroupCandidates(set, all) };
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
    db?: Prisma.TransactionClient,
  ): Promise<void> {
    // §PRICE-PATTERN 6.6 (IMP-B): escritura de mercado ⇒ candado COMPARTIDO con la prueba del job (`pricing/price-write-lock.ts`).
    if (!db) return withPriceWriteShared(this.prisma, (tx) => this.upsertVariantPrice(cardId, cardProductId, finish, marketUsdCents, fx, tx));
    await lockPriceWriteShared(db);
    const productType: ProductType = 'raw';
    const gradeKey = 'raw:NM';
    const capturedDate = today();
    // v1.91⟨precios⟩ errata (M-76, §4.PRE (i)): `source` entró a la `@@unique` ⇒ la clave compuesta de
    // Prisma pasa a `..._cardProductId_source`. `tcgcsv_singles` es el ÚNICO escritor de su cubeta
    // (`cardProductId` no-null), así que añadirlo es correcto e inocuo (cada fuente, su serie).
    const key = {
      cardId_productType_gradeKey_finish_capturedDate_cardProductId_source: {
        cardId,
        productType,
        gradeKey,
        finish,
        capturedDate,
        cardProductId,
        source: 'tcgcsv_singles' as const,
      },
    };
    // MONEY-REF-EXEMPT: lectura de la CLAVE del upsert de un ESCRITOR (tcgcsv_singles por producto),
    // no de candidatas de precio. Filtrar por naturaleza dejaría de ver la fila del día y el `create`
    // colisionaría con la `@@unique` (que no incluye `refKind`).
    const existing = await db.priceReference.findUnique({ where: key });
    if (existing?.isManualOverride) return; // §4.27f: el override de MERCADO manda
    const priceMxnCents = usdToMxnCents(marketUsdCents, fx.rate, fx.bufferPct);
    const data = {
      source: 'tcgcsv_singles' as const,
      priceUsdCents: marketUsdCents,
      fxRate: fx.rate,
      fxBufferPct: fx.bufferPct,
      priceMxnCents,
      isManualOverride: false,
      // v1.50.3-f (M-43, §4.38l.4.3): escritor de MERCADO ⇒ `market` EXPLÍCITO, en el `create` **y** en
      // el `update` del upsert (aquí `data` sirve a los dos, que es justo lo que la regla pide).
      refKind: PriceRefKind.market,
    };
    await db.priceReference.upsert({
      where: key,
      create: { cardId, productType, gradeKey, finish, capturedDate, cardProductId, ...data },
      update: data,
    });
  }

  /**
   * §4.27d paso 1 — resuelve el `groupId` TCGCSV del set: `pptSetId` entero == groupId; si no, match
   * ÚNICO por nombre vía `listGroups()`. `null` (con log) si no hay match ÚNICO ⇒ no se toca nada
   * (money-safe).
   *
   * ⚠️ **La escalera de match NO vive aquí** (QA IMPORTANTE-3 / P-47): vive en
   * `matchTcgcsvGroupByName` (`../pricing/providers/tcgcsv-group-match`), el ÚNICO sitio donde se
   * decide qué set empata con qué grupo. Estaba **copiada literalmente** en este servicio (ruta de
   * ESTRUCTURA) y en `TcgcsvSinglesBulkPriceProvider` (ruta de PRECIO) pese a que ARCHITECTURE las
   * declara *«la misma lógica S-D3/§4.27d»* — y esa duplicación es exactamente por lo que el arreglo
   * del **prefijo de código de colección** (`"SV08: Pitch Black"` de TCGCSV vs `"Pitch Black"`
   * nuestro, P-46) llegó al mapeo de PPT y al sellado y **nunca aquí**. Ver la cabecera de ese
   * archivo para el bug entero y para por qué el prefijo se pela **de un solo lado**.
   *
   * **Efecto de adoptarla en ESTA ruta** (medido, `test/card-product-resolver.spec.ts`): el único
   * cambio posible es `null → groupId` — sets que hoy **no escriben nada** empiezan a resolverse.
   * ⛔ Ningún `CardProduct`/`PriceReference` existente puede re-apuntarse a OTRO grupo
   * (`groupId → OTRO groupId` = 0 casos por fuerza bruta). La única desviación es que un nombre que
   * normaliza a VACÍO (en el set local o en el grupo remoto) ya no empata con «lo que sea»: la
   * versión vieja lo ataba al primer grupo que hubiera vía `includes('')`, que era basura, no match.
   *
   * **Señal**: se deja en `warn` con el motivo y los candidatos. Este camino NO escribe su propio
   * `AuditLog` (a diferencia de la ruta de precio, `pricing.set_unresolved`) — la razón, medida, en
   * `docs/BACKEND_NOTES.md`: no corre desatendido (import/`--force`) y un set que no resuelve por
   * NOMBRE aquí tampoco resuelve en el barrido diario de precio, que ya deja esa fila cada día.
   */
  private async resolveGroupId(set: { id: string; name: string; pptSetId: string | null; externalId: string }): Promise<number | null> {
    return (await this.resolveGroup(set))?.groupId ?? null;
  }

  /** Igual que `resolveGroupId`, con cómo se eligió el grupo (§AUTO-ENLACE F4) y la lista de grupos ya bajada de la tanda si la hay. */
  private async resolveGroup(
    set: { id: string; name: string; pptSetId: string | null; externalId: string; series?: string | null; releaseDate?: string | null; printedTotal?: number | null; cardGroupId?: number | null; cardGroupVia?: string | null },
    groups?: readonly TcgcsvGroupRef[],
  ): Promise<{ groupId: number; via: 'auto' | 'confirmed' | 'promo_table' } | null> {
    // Un grupo CONFIRMADO nunca se cachea (el dueño puede cambiarlo; se relee de la columna en cada corrida).
    const cached = set.cardGroupVia === 'confirmed' ? undefined : this.groupIdCache.get(set.id);
    if (cached != null) return { groupId: cached, via: 'auto' };

    // P-PROMOS-VIEJAS: tabla fija > pptSetId numérico > nombre, en la función compartida con la ruta de estructura.
    const match = await resolveTcgcsvGroupForSet(set, async () => groups ?? (await this.tcgcsv.listGroups()));
    if (match.groupId != null) {
      if (match.via !== 'confirmed') this.groupIdCache.set(set.id, match.groupId);
      return { groupId: match.groupId, via: match.via === 'promo_table' ? 'promo_table' : match.via === 'confirmed' ? 'confirmed' : 'auto' };
    }

    this.logger.warn(
      `card-product: no se resolvió un groupId ÚNICO para "${set.name}" (${match.failure}, ` +
        `${match.candidates} candidatos${match.candidateNames.length ? `: ${match.candidateNames.join(' | ')}` : ''}; ` +
        `pptSetId="${set.pptSetId ?? ''}"). No se toca ningún CardProduct (money-safe) — el set ` +
        `conserva su estructura previa/seed hasta que alguien lo arregle.`,
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

/*
 * ⛔ AQUÍ VIVÍA `normalizeName` (minúsculas + alfanuméricos), la normalización de nombres de
 * set/grupo. Se RETIRA con la escalera duplicada: era la última pieza local del match por nombre y,
 * mientras siguiera exportada, invitaba a reconstruir la escalera aquí — que es exactamente cómo
 * P-46 acabó arreglado en tres rutas y no en la de dinero. La normalización vive DENTRO de
 * `matchTcgcsvGroupByName` / `setNameCandidates`. `normalizeCardNumber` (join por NÚMERO de carta,
 * arriba) es otro predicado y se queda.
 */
