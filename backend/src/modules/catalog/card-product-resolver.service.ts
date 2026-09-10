import { Injectable, Logger } from '@nestjs/common';
import { Finish, PriceRefKind, ProductType } from '@prisma/client';
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
import { matchTcgcsvGroupByName } from '../pricing/providers/tcgcsv-group-match';

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
      return {
        groupId,
        joined: 0,
        products: 0,
        pricesWritten: 0,
        pricesPending: 0,
        unjoined: 0,
        cardsTouched: 0, // MEDIDO: no se tocó ninguna carta (no hay producto mapeable).
      };
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
    let pricesPending = 0;

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
    };
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
    // MONEY-REF-EXEMPT: lectura de la CLAVE del upsert de un ESCRITOR (tcgcsv_singles por producto),
    // no de candidatas de precio. Filtrar por naturaleza dejaría de ver la fila del día y el `create`
    // colisionaría con la `@@unique` (que no incluye `refKind`).
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
      // v1.50.3-f (M-43, §4.38l.4.3): escritor de MERCADO ⇒ `market` EXPLÍCITO, en el `create` **y** en
      // el `update` del upsert (aquí `data` sirve a los dos, que es justo lo que la regla pide).
      refKind: PriceRefKind.market,
    };
    await this.prisma.priceReference.upsert({
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
    const match = matchTcgcsvGroupByName(set.name, groups);
    if (match.groupId != null) {
      this.groupIdCache.set(set.id, match.groupId);
      return match.groupId;
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
