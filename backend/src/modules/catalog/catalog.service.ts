import { Injectable } from '@nestjs/common';
import { Card, CardSet, Finish, GradingCompany, InventoryItem, Prisma, ProductType, RawCondition, SealedCondition, SealedSubtype, VariantPriceOverride } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
// MERGE v1.50.2: `GradedEstimateRef` (gancho de grading) entra JUNTO a lo de main. Lo que se BORRA es
// `computeSalePriceForRarity`/`SalesRule`/`PriceRuleSet` y `common/pricing-tiers`: P-48 (§4.36) los
// eliminó al sustituir las reglas por rareza/acabado por la CURVA. Conservarlos «por si acaso» no
// compilaba: ya no existen.
import {
  PricingService,
  PriceInfo,
  GradedEstimateRef,
  toPublicPriceInfo,
} from '../pricing/pricing.service';
// v2.0 (P-48, §4.36): la CURVA sustituye a las reglas por rareza/acabado. `sealedPriceBasisOf` deriva
// el `priceBasis` del SELLADO (cuya matemática NO cambia) para que el front tenga UNA sola regla de
// visibilidad del «Valor de mercado» en las dos fichas.
import { sealedPriceBasisOf, PriceBasis, hasManualPrice } from '../../common/money';
import { PricingCurve } from '../../common/pricing-curve';
import { BusinessException } from '../../common/business.exception';
import { CARD_ORDER_BY_GLOBAL, CARD_ORDER_BY_IN_SET, computeDisplayFinishes } from '../../common/card-order';
// P-30 H2 (TECH_DEBT): helper ÚNICO de la clave de variante K=(cardId,productType,gradeKey,finish),
// antes interpolada a mano en 3 sitios de este archivo (riesgo de drift silencioso). Mismo string.
import { variantKey } from '../../common/variant-key';
// v2.1.9 (D4): lista de CLASE R — «raw = solo NM» (PROJECT §H). Ver `common/business-rules.ts`.
import { ACCEPTED_RAW_CONDITIONS } from '../../common/business-rules';
// v1.33 (P-27, §4.31d): master set combinado en el STOREFRONT. `GET /catalog/sets`+`/facets` PLIEGAN
// el subset en su principal; `GET /catalog/cards?setId=<principal>` EXPANDE a las partes. SOLO
// presentación/lectura (money-safe): el mapa nunca publica cartas sin precio ni re-llavea nada.
import { MASTER_SET_GROUPS, partExternalIds } from '../../config/master-set-groups';
// v1.50.3: la lista de revisión nombra la clave corrupta en su `409` (§4.38n.3).
import { SettingKey } from '../settings/settings.constants';
// v1.50-graded-estimate (§4.38): «gancho de grading». La DECISIÓN (qué se emite y qué se destaca) vive
// en las PURAS de `common/graded-estimate.ts`; aquí solo se compone el DTO. Partición §4.38-0:
// `gradedEstimates` (ficha, SIN gate) ≠ `gradingHighlight` (teja/vitrina, CON gate de curaduría).
import {
  businessDateCdmx,
  evaluateGradingHighlight,
  GRADED_ESTIMATE_COMPANY,
  GRADED_ESTIMATE_GRADE_KEYS,
  GradedEstimateConfig,
  GradingCostTier,
  GradingHighlightResult,
  HighlightReason,
  selectGradedEstimates,
  toGradedEstimateConfigDTO,
} from '../../common/graded-estimate';

// Conjuntos de valores válidos de los enums de Prisma. Un filtro público con un valor
// fuera de estos conjuntos produciría un PrismaClientValidationError (500); en cambio
// se rechaza con 400 VALIDATION_ERROR (ver `validateEnum`).
const PRODUCT_TYPES = new Set<string>(Object.values(ProductType));
// v2.1.9 (D4, §4.37): el filtro público de condición es CLASE R, no un espejo del schema. PROJECT §H:
// «el filtro de condición para raw refleja únicamente NM». Derivarlo de `RawCondition` haría que un
// valor nuevo del enum se volviera filtrable en Compra el mismo día, sin decisión de nadie.
const RAW_CONDITIONS = new Set<string>(ACCEPTED_RAW_CONDITIONS);
const SEALED_SUBTYPES = new Set<string>(Object.values(SealedSubtype));
const FINISHES = new Set<string>(Object.values(Finish));

/**
 * `CardDTO` del contrato (§DTOs), **declarado como INTERFAZ que espeja el CONTRATO** (v2.1.9, T-2).
 *
 * ### Por qué no `ReturnType<typeof toCardDTO>`
 * Ése era el tipo que usaban `GroupedListingDTO.card` y `SealedGroupDTO.card`: **el tipo espejaba la
 * IMPLEMENTACIÓN, no el contrato**. Si el builder perdiera `displayFinishes`, el tipo lo seguiría sin
 * chistar y ningún test lo vería (las aserciones de forma solo cubrían el primer nivel). Es B-1 un
 * nivel más abajo: un campo requerido que desaparece y el compilador «tiene razón».
 *
 * Con la interfaz declarada, quitar un campo del builder **no compila** — que es el candado más
 * barato que existe para un contrato.
 */
export interface CardDTO {
  id: string;
  externalId: string;
  name: string;
  number: string;
  /** v1.22 (M-26, §4.22b): claves persistidas del ORDEN NATURAL. */
  numberSort: number | null;
  numberPrefix: string | null;
  rarity: string | null;
  supertype: string | null;
  subtypes: string[];
  setId: string;
  setName: string | null;
  imageSmallUrl: string | null;
  imageLargeUrl: string | null;
  availableFinishes: Finish[];
  /** v1.22-2 / N-15: subconjunto DISPLAY-only (⊆ availableFinishes, nunca vacío). */
  displayFinishes: Finish[];
}

/**
 * `ListingDTO` del contrato (§DTOs), **declarado** (v2.1.9, T-2). El retorno de `toListingDTO` era
 * **inferido**: la misma clase que B-1 cerró en `GroupedListingDTO` seguía abierta en el DTO
 * por-pieza, que es el que alimenta `units[]`, `GET /catalog/listings/:id` y la ficha de sellado.
 */
export interface ListingDTO {
  inventoryItemId: string;
  card: CardDTO;
  productType: ProductType;
  rawCondition?: RawCondition;
  sealedSubtype?: SealedSubtype;
  /** v1.23-sealed-sales: condición del sellado; `undefined` en raw/graded. */
  sealedCondition?: SealedCondition;
  finish: Finish;
  gradingCompany?: GradingCompany;
  gradeValue?: string;
  certNumber?: string;
  referenceValue: PriceInfo;
  salePriceCents?: number;
  /** v2.0 (P-48, §N.7): QUÉ determinó el precio. REQUERIDO — su ausencia es lo que invirtió B-1. */
  priceBasis: PriceBasis;
  sellable: boolean;
}

/**
 * @param pricedFinishes v1.22-2 / N-15 (§4.22a-6): acabados de ESTA carta con `hasPricedRef`
 *   (PriceReference raw `raw:NM`, `priceMxnCents > 0`), de `PricingService.getPricedRawFinishesBatch`.
 *   El llamador lo pasa para computar `displayFinishes` (supresión del acabado ESPURIO en premium de
 *   una sola impresión). Omitido/`undefined` ⇒ conjunto vacío ⇒ SIN supresión money-safe:
 *   `displayFinishes = availableFinishes` (una premium sin priced cae a la salvaguarda; una no-premium
 *   nunca se suprime). Los call-sites de catalog/quoter/master-set/vault SIEMPRE lo pasan (batch, sin N+1).
 */
export function toCardDTO(
  card: Card & { set?: CardSet | null },
  pricedFinishes?: Iterable<Finish>,
): CardDTO {
  // v1.6-finish: acabados en que existe la carta (lista blanca de validación). [normal] por default.
  const availableFinishes = (card.availableFinishes ?? ['normal']) as Finish[];
  return {
    id: card.id,
    externalId: card.externalId,
    name: card.name,
    number: card.number,
    // v1.22 (M-26, §4.22b): claves persistidas del ORDEN NATURAL. El front las usa SOLO para
    // re-ordenar localmente tras filtrar, con (numberPrefix asc, numberSort asc, number asc) —
    // que reproduce EXACTAMENTE el orden del servidor. Nunca con el índice del arreglo.
    numberSort: card.numberSort,
    numberPrefix: card.numberPrefix,
    rarity: card.rarity,
    supertype: card.supertype,
    subtypes: (card.subtypes as string[] | null) ?? [],
    setId: card.setId,
    setName: card.set?.name ?? null,
    imageSmallUrl: card.imageSmallUrl,
    imageLargeUrl: card.imageLargeUrl,
    availableFinishes,
    // v1.22-2 / N-15 (§4.22a-6): subconjunto DISPLAY-only (⊆ availableFinishes, orden FINISH_ORDER,
    // nunca vacío). SOLO gobierna el render; la whitelist SEC-A1 sigue siendo availableFinishes.
    displayFinishes: computeDisplayFinishes(card.rarity, availableFinishes, pricedFinishes ?? []),
  };
}

/**
 * v1.44-graded-estimate (§DTOs base / §4.38e) — `GradedEstimateDTO` público. Tres reglas NORMATIVAS que
 * este constructor hace CIERTAS POR CONSTRUCCIÓN (no por convención):
 *  - `estimate.status` es SIEMPRE `"priced"` — un `pending` en un argumento de venta está PROHIBIDO
 *    (§N.4). Si no hay dato, el elemento NO se emite (el caller filtra antes de llegar aquí).
 *  - `referenceMxnCents` y `capturedDate` SIEMPRE presentes.
 *  - **`source` se OMITE SIEMPRE** (y `isManualOverride` jamás viaja): es el ÚNICO campo que delataría
 *    si el número lo tecleó el admin (fase 1) o lo trajo el ingest (fase 2). El objeto se construye con
 *    exactamente tres campos, así que no hay forma de que se cuele. Ver §4.38g.
 *
 * Nada del cálculo viaja: ni multiplicador, ni ganancia, ni costo de gradeo, ni umbral (SEC-A1
 * reforzado — el cliente no puede reconstruir el gate porque los números no salen del servidor).
 */
export interface GradedEstimateDTO {
  gradingCompany: typeof GRADED_ESTIMATE_COMPANY;
  gradeValue: string;
  gradeKey: string;
  /** `PriceInfo` con `status` SIEMPRE `"priced"`, `referenceMxnCents`/`capturedDate` siempre, y `source` NUNCA. */
  estimate: { status: 'priced'; referenceMxnCents: number; capturedDate: string };
}

function toGradedEstimateDTO(e: GradedEstimateRef): GradedEstimateDTO {
  return {
    gradingCompany: GRADED_ESTIMATE_COMPANY,
    gradeValue: e.gradeValue,
    gradeKey: e.gradeKey,
    estimate: {
      status: 'priced' as const,
      referenceMxnCents: e.mxnCents,
      capturedDate: e.capturedDate,
    },
  };
}

/**
 * v1.44 — contexto del gancho izado UNA vez por request (§4.38c): config + los estimados de las cartas
 * del conjunto ya materializado (+1 query constante) + la fecha de negocio. `null` ⇒ el dial está
 * apagado o no hay carta raw que evaluar ⇒ **no se emite ninguno de los dos campos y no se hace ninguna
 * query extra**.
 */
interface GradingContext {
  cfg: GradedEstimateConfig;
  byCard: Map<string, GradedEstimateRef[]>;
  /**
   * v1.50.2 (§4.38l, INV-D) — grados con SLAB PUBLICADO por carta. Se iza en el MISMO punto que los
   * estimados (una query batcheada, nunca por grupo) porque las dos superficies lo necesitan: sin él,
   * un «estimado» sobre una carta con slab publicado se mostraría como estimado cuando en realidad es
   * el precio de mercado REAL de esa pieza.
   */
  slabsByCard: Map<string, string[]>;
  today: string;
}

/** Deriva el año del set desde `releaseDate` (`yyyy/MM/dd` de pokemontcg.io). v1.1. */
export function yearFromReleaseDate(releaseDate?: string | null): number | null {
  if (!releaseDate) return null;
  const m = /^(\d{4})/.exec(releaseDate);
  return m ? parseInt(m[1], 10) : null;
}

type ItemWithCard = InventoryItem & { card: Card & { set?: CardSet | null } };

/**
 * `GroupedListingDTO` del contrato (§DTOs), **declarado como tipo a propósito** (v2.1.7).
 *
 * ### Por qué existe este tipo
 * El DTO se construía como un objeto literal SIN tipo, así que **omitir un campo requerido no era un
 * error de compilación**. Se emitió sin `priceBasis` durante todo P-48 y ninguna de las tres capas de
 * verificación lo vio: los fixtures del front lo **horneaban**, el test de forma miraba el
 * `ListingDTO` (por-pieza) y no el de GRUPO, y ningún test `@real` abría una ficha.
 *
 * El daño fue invertir la regla de visibilidad de §N.7: el front decide con
 * `priceBasis === 'market'`, y con `undefined` esa comparación es **siempre falsa** ⇒ «Valor de
 * mercado» no se mostraba NUNCA, ni cuando el mercado sí había fijado el precio. Declarar el tipo
 * convierte esa clase entera de fallo en un error de `tsc`.
 */
/**
 * v2.1.9 (D2, contrato §DTOs `GroupedListingSummaryDTO`) — **el DTO de la REJILLA de singles:
 * `GroupedListingDTO` MENOS las dos señales de precio.**
 *
 * ### Por qué la rejilla no recibe `priceBasis` ni `referenceValue`
 * §N.7 dice literal «SOLO fichas»: tejas y listados no muestran valor de mercado hoy y no van a
 * mostrarlo, así que en esta superficie **nadie consume** ninguno de los dos. Y por la convención de
 * DTOs cerrados —«lo que no debe salir, PROHIBIDO»: publicar de más no rompe a nadie, **filtra**— un
 * campo no consumido aquí no se emite.
 *
 * Lo que cierra: la rejilla es la superficie de **cosecha masiva** (N filas por request, paginada).
 * Emitir `priceBasis` ahí publica un **mapa completo** de qué cartas llevan override manual — o sea
 * dónde falló el feed y dónde el precio puede estar desalineado. Es exactamente la clase que v2.1.6
 * cerró retirando `isManualOverride`/`source`. En la FICHA `priceBasis` sí es público, y a propósito
 * (la UI lo OBEDECE, decisión LOCKED de §N.7): lo que cambia entre las dos superficies no es el
 * secreto, es la **economía** de enumerarlo.
 *
 * ### Por qué TIPO PROPIO y no `priceBasis?`
 * Un campo opcional cuya ausencia apaga una regla es **literalmente B-1**: `undefined === 'market'`
 * es false SIEMPRE, así que «Valor de mercado» no se mostraba NUNCA. Con dos tipos, omitirlo en la
 * ficha **no compila** y emitirlo en la rejilla tampoco. El compilador sostiene la diferencia; el
 * test es la red.
 */
export interface GroupedListingSummaryDTO {
  representativeInventoryItemId: string;
  card: CardDTO;
  productType: 'raw' | 'graded';
  finish: Finish;
  rawCondition?: RawCondition;
  gradeKey: string;
  gradingCompany?: GradingCompany;
  gradeValue?: string;
  stockCount: number;
  salePriceCents: number;
  currency: 'MXN';
  /**
   * v1.50.2 (contrato §DTOs base, ARCHITECTURE §4.38e) — **MOVIDO desde `GroupedListingDTO`**.
   *
   * ### Por qué vive aquí y no en la ficha
   * Tras D2, `GroupedListingDTO` es el DTO de la FICHA y `GroupedListingSummaryDTO` el de la REJILLA.
   * El destacado es **superficie de PROMOCIÓN** (rejilla de Compra + vitrina del home), que es
   * exactamente esta. La ficha ya expone `gradedEstimates` en su raíz — más rico (PSA 10 **y** 9) y
   * sin gatear —, así que un segundo campo gateado allá duplicaba superficie sin añadir información.
   *
   * ### Por qué añadirlo a la lista blanca de D2 NO reabre lo que D2 cerró
   * D2 excluye `priceBasis`/`referenceValue` porque publican **señal operativa** (el mapa de qué cartas
   * van por override). `GradedEstimateDTO` **no puede** expresar esa señal: no tiene `priceBasis`, ni
   * `source`, ni `isManualOverride` — están ausentes **por tipo**, no por olvido de serializar. Y el
   * argumento de «economía de enumeración» no aplica: para este campo **existe un enumerador público
   * deliberado** (`?gradingHighlight=true&sort=grading_showcase`), así que publicarlo por fila no crea
   * ninguna capacidad nueva. La regla generalizada de admisión está en §4.38(e); `priceBasis` sigue
   * fuera porque falla dos de sus tres condiciones.
   *
   * **PRESENCIA ⇔ ELEGIBILIDAD.** No existe `eligible:false` ni `[]`: ausente ⇒ la teja se ve
   * exactamente como hoy (criterio 100).
   */
  gradingHighlight?: GradedEstimateDTO[];
}

export interface GroupedListingDTO {
  representativeInventoryItemId: string;
  card: CardDTO;
  productType: 'raw' | 'graded';
  finish: Finish;
  rawCondition?: RawCondition;
  gradeKey: string;
  gradingCompany?: GradingCompany;
  gradeValue?: string;
  stockCount: number;
  salePriceCents: number;
  /**
   * v2.0 (P-48) — el basis del REPRESENTANTE (la pieza más barata). Las piezas de un grupo comparten
   * clave K ⇒ comparten curva y override de variante ⇒ comparten basis, SALVO que alguna traiga
   * `listPriceCents` manual: ahí el representante es esa y el basis del grupo es `override`. El basis
   * EXACTO por pieza vive en `units[]` (`ListingDTO.priceBasis`).
   */
  priceBasis: PriceBasis;
  referenceValue: PriceInfo;
  currency: 'MXN';
}

/**
 * `GroupedListingDetailResponse` del contrato (§2 `GET /catalog/cards/:cardId`) — **el SOBRE de la
 * ficha, DECLARADO** (v1.50.2, techlead).
 *
 * ### Por qué el sobre necesita tipo y no basta con que lo tengan sus piezas
 * `getCard` devolvía un **literal sin anotar**, así que el tipo de la respuesta salía de lo que la
 * expresión resultara ser. Eso deja abierta exactamente la clase de regresión que `main` ya pagó cara
 * en B-1: cambiar `.map((g) => g.dto)` por `.map((g) => g.summary)` —dos propiedades del MISMO objeto,
 * un carácter de diferencia— **compilaba** y la ficha empezaba a servir el DTO de la REJILLA, que por
 * D2 no lleva `priceBasis` ni `referenceValue`. Es decir: reintroducir la inversión de §N.7 en el 100%
 * de las fichas sin un solo error de compilación. Con el sobre anotado, ese cambio **no compila**.
 *
 * `gradedEstimates` es OPCIONAL porque se OMITE cuando no hay ningún grado que exponer: jamás viaja
 * `[]` (un arreglo vacío es un contenedor renderizable, y su presencia filtraría la decisión del gate).
 */
export interface GroupedListingDetailResponse {
  card: CardDTO;
  /** Publicaciones AGRUPADAS de la FICHA ⇒ `GroupedListingDTO`, **nunca** `GroupedListingSummaryDTO`. */
  listings: GroupedListingDTO[];
  /** Piezas por-pieza (add-to-cart por `inventoryItemId`, `certNumber` de cada slab). */
  units: ListingDTO[];
  gradedEstimates?: GradedEstimateDTO[];
}

/**
 * v1.50.3 (§4.38n / API_CONTRACT §M2) — `GradedEstimateReviewItemDTO`: **el DTO del `preview` por grupo
 * + la identidad de la carta**, para que la lista se lea sin un `fetch` por fila.
 *
 * No es un DTO paralelo: son exactamente los mismos campos de diagnóstico que ya emite el `preview`
 * (`psa10MxnCents`, `psa9MxnCents`, `capturedDate`, `maxAllowedPsa10MxnCents`, `publishedSlabGrades`,
 * `reason`), producidos por **la misma función pura**. Un segundo evaluador de «qué es incoherente»
 * sería una segunda verdad, que es la clase de duplicación que §4.38 rechaza en todas partes.
 */
export interface GradedEstimateReviewItemDTO {
  cardId: string;
  cardName: string;
  setName: string;
  number: string;
  representativeInventoryItemId: string;
  finish: Finish;
  salePriceCents: number;
  psa10MxnCents: number | null;
  psa9MxnCents: number | null;
  capturedDate: string | null;
  stale: boolean;
  /**
   * v1.50.3-c (§4.38n.2-bis) — origen de la fila que reporta `capturedDate`. Distingue los DOS sabores
   * de `STALE`, que exigen remedios OPUESTOS: **manual** rancia ⇒ recapturar o borrar; **automática**
   * rancia ⇒ mirar el ingest, no la carta. **Admin-only** (§4.38g es sobre lo público).
   */
  isManual: boolean;
  /**
   * v1.50.3-f (M-43, §4.38l.4.4B / (l.4.5), contrato v1.50.3-f) — **NATURALEZA** de esa misma fila,
   * ORTOGONAL a `isManual` (procedencia). `"graded_estimate"` ⇒ es una cifra del gancho: se puede
   * recapturar o **borrar**. `"market"` ⇒ es **DINERO** (la referencia de mercado de M1 «Gradeadas»):
   * el gancho la MUESTRA cuando la carta no tiene slab de ese grado, pero **no se toca desde aquí** —
   * el `DELETE` del gancho no la borra. **Admin-only** (§4.38g es una garantía sobre lo PÚBLICO).
   */
  refKind: 'market' | 'graded_estimate';
  gradingCostTier: GradingCostTier | null;
  gradingCostMxnCents: number | null;
  thresholdMxnCents: number | null;
  netUpsidePsa9MxnCents: number | null;
  maxAllowedPsa10MxnCents: number | null;
  publishedSlabGrades: string[];
  eligible: boolean;
  /** PRIMER bloqueante de la promoción (`reasons[0]`). Sin cambio de semántica en v1.50.3-e. */
  reason?: HighlightReason;
  /**
   * v1.50.3-e (§4.38n.2-ter, API_CONTRACT §M2) — **todas** las condiciones detectadas, en orden
   * canónico. Es lo que el filtro de esta lista evalúa (una fila entra si `reasons ∩ pedidos ≠ ∅`),
   * y por eso la carta de **un solo grado** con el error de unidades ya es enumerable: `reason` sigue
   * siendo `NO_PSA9` —sin PSA 9 no se promociona, y así seguirá— pero `reasons` incluye
   * `NOT_ABOVE_RAW`, que es lo que el operador puede ver y corregir.
   */
  reasons: HighlightReason[];
}

/**
 * `reason` ENUMERABLES por `GET /admin/pricing/graded-estimates/review` (§4.38n.2).
 *
 * **Default = los TRES de coherencia de magnitud**, que son los que el criterio 111(e) nombra —111(b),
 * (c) y (d)—: cada uno es una cifra que **se sigue mostrando en la ficha** (§4.38k.3) y que por tanto
 * alguien tiene que revisar. Ésa es la contrapartida entera de no ocultarla.
 */
export const GRADED_REVIEW_DEFAULT_REASONS: readonly HighlightReason[] = [
  'NOT_ABOVE_RAW',
  'ABOVE_MAX_MULTIPLE',
  'GRADE_ORDER_INVERTED',
];

/**
 * Los DOS **opt-in explícitos, fuera del default** (§4.38n.2 / n.2-bis). Los dos son **accionables**
 * para el operador pero **no son datos erróneos**, así que meterlos en el default **ahogaría la señal
 * de coherencia** justo en la lista que existe para que esa señal se vea.
 *
 * - **`SLAB_PUBLISHED`** (INV-D): la guarda funcionando, no un dato malo. Hasta v1.50.3-e era además
 *   *«el conjunto expuesto al riesgo de §4.38(l.3)»* (INV-D inverso). **Desde M-43 ya no lo es:** un
 *   estimado no puede pricear un slab, así que este filtro deja de ser una lista de piezas en riesgo y
 *   pasa a ser lo que su nombre dice — cartas donde estimado y pieza real COEXISTEN. Sigue siendo el
 *   opt-in del **paso 2 del cut-over** (§4.38l.4.7): las que hay que re-afirmar con `intent:"market"`
 *   ANTES de migrar, para que ninguna se apague en silencio.
 * - **`STALE`** (v1.50.3-c, GU-A24 / PI-D6): la cifra **existe y CADUCÓ**. El arquitecto lo tenía
 *   agrupado con la «ausencia de dato» (`NO_PSA10` y compañía) y **no pertenece ahí**: aquéllos
 *   significan *nunca hubo dato* —el estado NORMAL de miles de cartas—; éste significa **hubo un dato,
 *   alguien lo puso o lo ingestó, y expiró**. Sin este valor, una cifra caducada **desaparece de las
 *   tres superficies en silencio, sigue en la BD y el dueño no tiene forma de encontrarla** para
 *   refrescarla o retirarla: el fallo silencioso que §4.38 persigue en todas partes. Y la categoría la
 *   creó esta misma revisión al sembrar `manualFreshnessDays = 30` (antes, un manual no caducaba nunca
 *   ⇒ el conjunto era vacío).
 */
export const GRADED_REVIEW_ALLOWED_REASONS: readonly HighlightReason[] = [
  ...GRADED_REVIEW_DEFAULT_REASONS,
  'SLAB_PUBLISHED',
  'STALE',
];

/**
 * Cota DURA del conjunto motor (§4.38n.1). El endpoint evalúa en memoria y pagina después —paginar
 * antes de filtrar produciría páginas vacías intercaladas y un `total` que no significa nada—, así que
 * necesita un tope. **Prohibido truncar en silencio:** si se excede, la respuesta lo dice con
 * `truncated: true` y el `scannedCards` real. Una lista de revisión incompleta presentada como completa
 * es peor que no tenerla: produce la falsa confianza de «no hay nada que revisar».
 */
export const GRADED_REVIEW_MAX_SCAN = 5_000;

/** Paginación del contrato (§M2): default 25, máximo 100. */
export const REVIEW_PAGE_SIZE_DEFAULT = 25;
export const REVIEW_PAGE_SIZE_MAX = 100;

export interface GradedEstimateReviewResponse {
  data: GradedEstimateReviewItemDTO[];
  page: number;
  pageSize: number;
  total: number;
  /** Estado del dial M10 — la lista evalúa igual con `off`; el front avisa «no se está publicando». */
  enabled: boolean;
  scannedCards: number;
  truncated: boolean;
}

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
  ) {}

  /**
   * v1.1 — "Compra" = inventario PUBLICADO con precio de venta RESOLVIBLE (ARCHITECTURE §4.9):
   * `status=listed`, plataforma. El comprador NUNCA ve "precio pendiente".
   *
   * v1.13-sales-pricing (§4.14d): el gate coarse en DB YA NO puede filtrar por existencia de precio.
   * Con la curva de precios (v2.0, §4.36.1), el PISO da un precio a una carta bulk incluso SIN
   * `PriceReference` de mercado (antes se excluía), volviéndola candidata a sellable — la
   * resolubilidad depende de la curva y del guardarraíl premium-en-el-piso, que la DB no evalúa. Por
   * eso el gate coarse se reduce a `platform + listed`; el precio EXACTO y la comprabilidad
   * (`sellable`) se confirman al construir el ListingDTO (`fetchSellable` descarta los no resolubles:
   * sin mercado y sin piso aplicable → `pending` → no vendible; guardarraíl premium-en-el-piso →
   * `pending` también).
   */
  private publishedWhere(extra: Prisma.InventoryItemWhereInput = {}): Prisma.InventoryItemWhereInput {
    return {
      ownerType: 'platform',
      status: 'listed',
      ...extra,
    };
  }

  /**
   * H9 / SB-D5 — WHERE de la vista pública de SINGLES: publicado (`publishedWhere`) + guardarraíl
   * INTERINO que EXCLUYE el sellado. P-35 ancla TODO el sellado de un set a la carta single de menor
   * `(numberPrefix, numberSort)`; sin este filtro la ficha/listado de ese single mezcla cajas selladas
   * entre sus "ejemplares" (y como el front toma `listings[0]` por `createdAt desc` como primary, una caja
   * recién dada de alta puede renderizar la ficha del single como si fuera sellado). Solo raw/graded
   * cuentan como ejemplares de un single; el sellado tiene su propio catálogo público
   * (`GET /catalog/sealed`, SealedCatalogService).
   *
   * Se añade como cláusula `AND` aparte para NO pisar un filtro `productType` explícito ya presente en el
   * where (que sigue exacto). Money-safe: solo ACOTA la lectura (no toca precios ni valuación; sin precio
   * sigue → pendiente/`—`, nunca 0). Cura de raíz (entidad `SealedProduct` propia) diferida en SB-D5 —
   * ver `docs/TECH_DEBT.md` (H9). La ubicación FINAL del filtro la decide el arquitecto: el contrato aún
   * expone sellado en `GET /catalog/facets` y en el filtro `?productType=sealed` de `GET /catalog/cards`.
   */
  private singlesPublishedWhere(extra: Prisma.InventoryItemWhereInput = {}): Prisma.InventoryItemWhereInput {
    const where = this.publishedWhere(extra);
    const guard: Prisma.InventoryItemWhereInput = { productType: { not: 'sealed' } };
    const prev = where.AND;
    where.AND = Array.isArray(prev) ? [...prev, guard] : prev ? [prev, guard] : [guard];
    return where;
  }

  /**
   * Trae items publicados que efectivamente son comprables (precio resoluble).
   *
   * Pago mínimo de BE-25 (v1.16-master-set, §4.17c): iza la curva de precios **una vez** por
   * request y resuelve las referencias en **un** lote (`getReferencesBatch`) en vez de 2 lecturas de
   * settings + 1 `getReference` **por ítem** (N+1). Cada DTO se construye con el contexto pre-cargado.
   */
  private async fetchSellable(
    where: Prisma.InventoryItemWhereInput,
  ): Promise<{ item: ItemWithCard; dto: Awaited<ReturnType<CatalogService['toListingDTO']>> }[]> {
    const items = await this.prisma.inventoryItem.findMany({
      where,
      include: { card: { include: { set: true } } },
      orderBy: { createdAt: 'desc' },
    });
    if (items.length === 0) return [];

    const curve = await this.pricing.loadPricingCurve();
    // v1.23-sealed-sales (§4.23d): contexto de spreads del sellado izado UNA vez (pago mínimo BE-25).
    const sealedSpreads = await this.pricing.loadSealedSpreads();
    // v1.22-2 / N-15 (§4.22a-6): acabados priceados por carta EN LOTE (sin N+1) para displayFinishes.
    const pricedByCard = await this.pricing.getPricedRawFinishesBatch(items.map((i) => i.cardId));
    // Batch de referencias: para el SELLADO la clave es la de MERCADO (`sealed:tcg:<productId>`,
    // finish normal), NO el gradeKey legacy 'sealed'; un sellado no mapeado no aporta clave (sin market).
    const refs = await this.pricing.getReferencesBatch(
      items.flatMap((i): { cardId: string; productType: ProductType; gradeKey: string; finish: Finish }[] => {
        if (i.productType === 'sealed') {
          const gk = this.pricing.sealedMarketGradeKeyForItem(i);
          return gk ? [{ cardId: i.cardId, productType: 'sealed', gradeKey: gk, finish: 'normal' }] : [];
        }
        return [{ cardId: i.cardId, productType: i.productType, gradeKey: this.pricing.gradeKeyFor(i), finish: i.finish }];
      }),
    );

    // v1.28 (P-18, §4.26b): controles por variante (M-30) EN LOTE — solo para piezas raw/graded que
    // DERIVAN su precio (sin `listPriceCents` manual, que sigue ganando; el sellado conserva su
    // cadena H-1 intacta). UNA query por request, misma clave que el lote de referencias.
    const variantOverrides = await this.pricing.getVariantOverridesBatch(
      items
        // H-1 (E5-bis): `<= 0` es AUSENTE, así que esas piezas TAMBIÉN necesitan precio derivado.
        .filter((i) => i.productType !== 'sealed' && !hasManualPrice(i))
        .map((i) => ({
          cardId: i.cardId,
          productType: i.productType,
          gradeKey: this.pricing.gradeKeyFor(i),
          finish: i.finish,
        })),
    );

    const out: { item: ItemWithCard; dto: Awaited<ReturnType<CatalogService['toListingDTO']>> }[] = [];
    for (const item of items) {
      const reference = this.refFromBatch(refs, item);
      const dto = await this.toListingDTO(item, {
        reference,
        curve,
        sealedSpreads,
        pricedFinishes: pricedByCard.get(item.cardId),
        variantOverride:
          item.productType === 'sealed'
            ? null
            : variantOverrides.get(
                variantKey({
                  cardId: item.cardId,
                  productType: item.productType,
                  gradeKey: this.pricing.gradeKeyFor(item),
                  finish: item.finish,
                }),
              ) ?? null,
      });
      if (dto.sellable && dto.salePriceCents != null) out.push({ item, dto });
    }
    return out;
  }

  /** Referencia del lote para un item (mercado sellado vs. gradeKey+acabado del resto). */
  private refFromBatch(refs: Map<string, PriceInfo>, item: ItemWithCard): PriceInfo | undefined {
    if (item.productType === 'sealed') {
      const gk = this.pricing.sealedMarketGradeKeyForItem(item);
      // P-30 H2: mismo `variantKey` con que `getReferencesBatch` indexó el eje sellado (ver :148, que
      // pasa {productType:'sealed', gradeKey:gk, finish:'normal'}); sin string hand-rolled paralelo.
      return gk
        ? refs.get(variantKey({ cardId: item.cardId, productType: 'sealed', gradeKey: gk, finish: 'normal' }))
        : undefined;
    }
    return refs.get(
      variantKey({
        cardId: item.cardId,
        productType: item.productType,
        gradeKey: this.pricing.gradeKeyFor(item),
        finish: item.finish,
      }),
    );
  }

  /**
   * Construye un ListingDTO (API_CONTRACT §DTOs base). Distingue referenceValue
   * (valor de mercado) de salePriceCents (precio de venta). El sellado lleva sealedSubtype
   * y NO lleva rawCondition/grade/rareza.
   */
  // v2.1.9 (T-2): retorno DECLARADO. Era inferido, así que perder un campo requerido no era un
  // error de compilación — la misma clase que B-1 cerró en el DTO de GRUPO, abierta en el de PIEZA.
  async toListingDTO(
    item: ItemWithCard,
    ctx?: {
      // BE-25 (§4.17c): contexto pre-cargado por `fetchSellable` (referencia del lote + reglas de
      // venta izadas una vez) para evitar el N+1 de referencias/settings. Opcional: sin él el método
      // resuelve todo por sí mismo (uso single).
      reference?: PriceInfo;
      // v2.0 (P-48, §4.36.2): la CURVA izada una vez por request (BE-25) — sustituye a `salesRules`.
      curve?: PricingCurve;
      // v1.23-sealed-sales (§4.23d): contexto de spreads del sellado (izado una vez). Su presencia
      // señala que `reference` viene del lote (para sellado = mercado TCGCSV, o undefined si no mapeado).
      sealedSpreads?: { spreadPctBySubtype: Record<string, number>; fallbackPct: number; sourceOn: boolean };
      // v1.22-2 / N-15 (§4.22a-6): acabados priceados de ESTA carta (del lote) para displayFinishes.
      pricedFinishes?: Iterable<Finish>;
      // v1.28 (P-18, §4.26b): fila M-30 de la variante (del lote de `fetchSellable`; `null` = sin
      // fila). Su presencia va atada a `curve` (batch); en uso single se resuelve aquí mismo.
      variantOverride?: VariantPriceOverride | null;
    },
  ): Promise<ListingDTO> {
    let referenceValue: PriceInfo;
    let salePriceCents: number | undefined;
    // v2.0 (P-48, §4.36.7a): QUÉ determinó el precio. Server-side SIEMPRE (SEC-A1); la UI OBEDECE este
    // dato para la regla de visibilidad del «Valor de mercado» — jamás lo infiere comparando cifras.
    let priceBasis: PriceBasis = 'pending';

    if (item.productType === 'sealed') {
      // v1.23-sealed-sales (§4.23a/§4.23b): precio del sellado por precedencia money-safe
      // override > mercado×spread(subtype) > mercado×spread(global) > PRICE_PENDING. referenceValue
      // del sellado = valor de mercado TCGCSV (sealedMarketRef), informativo. SEC-A1: todo server-side.
      const sealedCtx = ctx?.sealedSpreads ?? (await this.pricing.loadSealedSpreads());
      const marketRef = ctx?.sealedSpreads
        ? ctx.reference // lote: puede venir undefined (sellado no mapeado → sin mercado)
        : await this.pricing.getSealedMarketRef(item);
      // H-1 (v1.24): resolver ÚNICO (gate del mercado por dial + pura). El mercado solo cuenta con el
      // dial encendido (§4.23a); con off el sellado solo se vende con override. `referenceValue` =
      // valor de mercado TCGCSV cuando el gate lo deja pasar, si no `pending`.
      const marketPriced = this.pricing.gateSealedMarketCents(marketRef, sealedCtx.sourceOn) != null;
      const sale = this.pricing.resolveSealedSalePrice(item, marketRef, sealedCtx);
      if (sale.salePriceCents != null) salePriceCents = sale.salePriceCents;
      // v2.0 (§4.36.7a): el sellado NO cambia de matemática (criterio 85) — solo DERIVA su basis del
      // `priceSource` que ya tenía: override⇒override; subtype/global_spread⇒market; sin precio⇒pending.
      priceBasis = sealedPriceBasisOf(sale);
      referenceValue = marketPriced ? marketRef! : { status: 'pending' };
    } else {
      const gradeKey = this.pricing.gradeKeyFor(item);
      // v1.6-finish: valúa contra la PriceReference del ACABADO de ESTA copia física.
      referenceValue =
        ctx?.reference ??
        (await this.pricing.getReference(item.cardId, item.productType, gradeKey, item.finish));

      if (hasManualPrice(item)) {
        // Override manual POR PIEZA → gana siempre (precio directo sin regla; intención más
        // específica — v1.28 §4.26b: gana también sobre el sellOverride de la variante).
        // v2.0 (§4.36.6): peldaño 1 de la precedencia de VENTA ⇒ `priceBasis = "override"` (y por
        // §N.7 la ficha NO muestra «Valor de mercado»: el mercado no produjo este precio).
        salePriceCents = item.listPriceCents;
        priceBasis = 'override';
      } else {
        // v2.0 (P-48, §4.36.1): precio de venta por la CURVA sobre el VALOR DE MERCADO — ya no
        // depende de la rareza ni del acabado (criterio 84). SEC-A1: el mercado sale de la
        // `PriceReference` del acabado de ESTA copia, jamás del DTO. SIN dato de mercado ⇒ `pending`
        // (el PISO NO gana): sin referencia no se publica — decisión LOCKED que corrige el supuesto
        // de §N.2, porque un guardarraíl por rareza no atraparía una Common de $400 sin dato.
        // v1.28 (P-18, §4.26b): sellOverride de la VARIANTE (M-30) pisa la curva — resuelto en
        // LECTURA, por eso surte efecto inmediato en toda pieza publicada sin manual.
        const referenceMxnCents =
          referenceValue.status === 'priced' ? (referenceValue.referenceMxnCents ?? null) : null;
        // BE-25: si viene el contexto pre-cargado usa la función pura (sin leer settings por ítem);
        // si no, delega al SEAM ÚNICO del eje de venta (que iza la curva por sí mismo) y resuelve el
        // override single.
        const variantOverride = ctx?.curve
          ? (ctx.variantOverride ?? null)
          : await this.pricing.getVariantOverride(
              item.cardId,
              item.productType,
              this.pricing.gradeKeyFor(item),
              item.finish,
            );
        // v2.0 (P-48, §4.36.5b) — SEAM ÚNICO del eje de venta: el monto y el GUARDARRAÍL vienen de la
        // MISMA llamada. Una carta de rareza PREMIUM que aterriza en el PISO NO se publica —que una
        // chase resuelva al piso solo puede significar que su dato de mercado está mal (ausente,
        // aplanado o absurdo), y venderla ahí es la pérdida IRREVERSIBLE que §N.0 manda evitar—; el
        // seam ya devuelve `priceCents=null` + `basis='pending'` en ese caso, así que aquí no hay
        // ningún veredicto que «acordarse» de consultar. NO dispara con override ni bounty.
        // Esta ruta es LECTURA PÚBLICA: NO escala a la cola — quien escala es la publicación (§4.36.5b).
        const decision = {
          referenceMxnCents,
          // La rareza SOLO alimenta el veredicto (criterio 84); jamás el monto.
          rarityCanonical: item.card.rarityCanonical ?? item.card.rarity,
          controls: variantOverride,
        };
        const sale = ctx?.curve
          ? this.pricing.decideSalePrice({ ...decision, curve: ctx.curve })
          : await this.pricing.computeSalePriceForItem(decision);
        if (sale.priceCents != null) {
          salePriceCents = sale.priceCents;
          priceBasis = sale.basis;
        } else {
          priceBasis = 'pending';
        }
      }
    }

    // v1.1: comprable solo si está PUBLICADO (listed) y con precio de venta fijado (>0).
    const sellable = salePriceCents != null && salePriceCents > 0 && item.status === 'listed';

    return {
      inventoryItemId: item.id,
      card: toCardDTO(item.card, ctx?.pricedFinishes),
      productType: item.productType,
      rawCondition: item.rawCondition ?? undefined,
      sealedSubtype: item.sealedSubtype ?? undefined,
      // v1.23-sealed-sales: condición del sellado (mint|minor_box_damage); undefined en raw/graded.
      sealedCondition: item.sealedCondition ?? undefined,
      // v1.6-finish: acabado de esta copia (graded/sealed → normal). ListingDTO.finish.
      finish: item.finish,
      gradingCompany: item.gradingCompany ?? undefined,
      gradeValue: item.gradeValue ?? undefined,
      // v1.2 (M-12): nº de certificado PSA/CGC (verificable en la graduadora); null en raw/sealed.
      certNumber: item.certNumber ?? undefined,
      // v2.1.6 (S48-M2): superficie ANÓNIMA ⇒ se proyecta SIN `source`. `PriceSource` incluye
      // `manual`, así que dejarlo pasar publicaría un mapa scrapeable de qué cartas llevan precio
      // fijado a mano — o sea dónde falló el feed y dónde el precio puede estar desalineado. La
      // frescura (`capturedDate`) sí es información legítima de compra y sigue viajando.
      //
      // v2.1.9 (D2): y AHORA el número de mercado viaja **si y solo si `priceBasis === 'market'`**.
      // La regla de §N.7 deja de vivir solo en el navegador: este DTO es el de la FICHA, `units[]` y
      // `GET /catalog/listings/:id` — el endpoint del PoC del pentester, que SIN TOKEN devolvía
      // `priceBasis:"override"` + el número que la UI tiene PROHIBIDO pintar.
      referenceValue: toPublicPriceInfo(referenceValue, priceBasis),
      salePriceCents,
      // v2.0 (P-48, §4.36.7a/b): la señal NORMATIVA de la regla de visibilidad. `referenceValue` sigue
      // viajando (el mismo DTO alimenta superficies admin y de valuación); el front OBEDECE esto.
      priceBasis,
      sellable,
      // v1.2 (M-13): sin fotos propias — la imagen es la de catálogo remota (CardDTO.imageSmallUrl/Large).
    };
  }

  /**
   * Valida un valor de filtro enum del endpoint público. Devuelve el valor si es válido;
   * si no, lanza 400 VALIDATION_ERROR (nunca deja que un enum inválido llegue a Prisma y
   * produzca un 500 PrismaClientValidationError).
   */
  private validateEnum(field: string, value: string, allowed: Set<string>): string {
    if (!allowed.has(value)) {
      throw BusinessException.badRequest('VALIDATION_ERROR', `Invalid ${field} filter`, {
        field,
        value,
        allowed: [...allowed],
      });
    }
    return value;
  }

  /**
   * v1.33 (P-27, §4.31d) — expande el filtro `setId` de Compra cuando el id es el PRINCIPAL de un
   * master combinado: devuelve `{ in: partSetIds }` (set-ids locales reales de las partes importadas,
   * ≥2) para listar el inventario de todas las partes. Para un set normal, un subset, o un principal
   * con <2 partes importadas → devuelve el `setId` tal cual (comportamiento v1.20). Money-safe: solo
   * amplía el WHERE de lectura; cada `ListingDTO` sigue llaveado a su `Card`/set real.
   */
  private async expandSetIdFilter(setId: string): Promise<string | { in: string[] }> {
    if (MASTER_SET_GROUPS.length === 0) return setId;
    const set = await this.prisma.cardSet.findUnique({
      where: { id: setId },
      select: { externalId: true },
    });
    if (!set) return setId; // id desconocido → sin cambio (mismo resultado que hoy).
    const partExt = partExternalIds(set.externalId); // [] si no es principal de ningún grupo
    if (partExt.length < 2) return setId; // set normal / subset / principal sin subsets → sin expandir.
    const parts = await this.prisma.cardSet.findMany({
      where: { externalId: { in: partExt } },
      select: { id: true },
    });
    const ids = parts.map((p) => p.id);
    return ids.length >= 2 ? { in: ids } : setId; // requiere ≥2 partes importadas para combinar.
  }

  /**
   * v1.33 (P-27, §4.31d) — PLIEGA los subset de cada master combinado en su principal para el dropdown
   * de Compra (`/catalog/sets` y `/catalog/facets`): el principal aparece UNA vez y gana `partSetIds?`
   * (los set-ids reales agrupados) para que el filtro cubra todas las partes. Si el principal no está
   * entre los sets publicados pero sí importado, se trae para nombrar la entrada combinada. CA-71: si
   * el principal no existe importado, el subset NO se pliega (queda como su propio set). Money-safe:
   * solo re-agrupa metadatos de presentación; jamás publica cartas sin precio ni re-llavea nada.
   */
  private async foldStorefrontSets(
    entries: {
      id: string;
      externalId: string;
      name: string;
      series: string | null;
      releaseDate: string | null;
      year: number | null;
      partSetIds?: string[];
    }[],
  ): Promise<typeof entries> {
    if (MASTER_SET_GROUPS.length === 0) return entries;
    const byExternal = new Map(entries.map((e) => [e.externalId, e]));
    const active = MASTER_SET_GROUPS.map((g) => ({
      g,
      subsetsPresent: g.subsets.filter((s) => byExternal.has(s.externalId)),
    })).filter((x) => x.subsetsPresent.length > 0);
    if (active.length === 0) return entries;

    // Principales necesarios que NO están entre los sets publicados (hay que traerlos para el nombre).
    const missingPrimaryExt = [
      ...new Set(active.map((x) => x.g.primary).filter((ext) => !byExternal.has(ext))),
    ];
    const fetchedPrimaries = missingPrimaryExt.length
      ? await this.prisma.cardSet.findMany({
          where: { externalId: { in: missingPrimaryExt } },
          select: { id: true, externalId: true, name: true, series: true, releaseDate: true },
        })
      : [];
    const primaryByExt = new Map(fetchedPrimaries.map((s) => [s.externalId, s]));

    const removed = new Set<string>();
    const added: typeof entries = [];
    for (const { g, subsetsPresent } of active) {
      let primaryEntry = byExternal.get(g.primary);
      if (!primaryEntry) {
        const fetched = primaryByExt.get(g.primary);
        if (!fetched) continue; // CA-71: principal no importado → no se pliega.
        primaryEntry = {
          id: fetched.id,
          externalId: fetched.externalId,
          name: fetched.name,
          series: fetched.series ?? null,
          releaseDate: fetched.releaseDate ?? null,
          year: yearFromReleaseDate(fetched.releaseDate),
        };
        byExternal.set(g.primary, primaryEntry);
        added.push(primaryEntry);
      }
      const subsetIds = subsetsPresent.map((s) => byExternal.get(s.externalId)!.id);
      primaryEntry.partSetIds = [primaryEntry.id, ...subsetIds];
      for (const s of subsetsPresent) removed.add(byExternal.get(s.externalId)!.id);
    }
    return [...entries, ...added].filter((e) => !removed.has(e.id));
  }

  /**
   * v1.38-grouped-listings (P-30, ARCHITECTURE §4.9a) — AGRUPA en LECTURA las piezas vendibles
   * (raw/graded) en publicaciones ÚNICAS por `K = (cardId, productType, gradeKey, finish)`
   * (`gradeKey = gradeKeyFor(item)`, canónico: `raw:NM` | `graded:PSA:10` | …). Reduce en memoria sobre
   * el set `sellable` que `fetchSellable` YA cargó (mismo coste que el listado por-pieza; sin query ni
   * columna nueva). Por construcción todas las piezas de una `K` comparten `salePriceCents` y
   * `referenceValue` (misma regla/override de variante + misma `PriceReference`).
   *
   * Money-safe: `fetchSellable` ya descartó las piezas sin precio resoluble (`dto.sellable ∧
   * salePriceCents != null`), así que TODO grupo devuelto tiene `stockCount = members.length ≥ 1` (VIVO)
   * y `salePriceCents = mínimo del grupo` = el del representante (pieza vendible más barata). Un grupo
   * AGOTADO (stockCount 0) no existe en `rows` ⇒ no se emite (desaparece de Compra). El `certNumber` es
   * POR SLAB ⇒ NO va a nivel de grupo (se expone por pieza en `units[]` de la ficha).
   */
  private buildGroups(
    rows: { item: ItemWithCard; dto: Awaited<ReturnType<CatalogService['toListingDTO']>> }[],
    // v1.44-graded-estimate (§4.38e): contexto del gancho. Ausente/`null` ⇒ ningún grupo trae
    // `gradingHighlight` (dial off, o superficie que no lo compone) — el DTO sale EXACTAMENTE como hoy.
    grading?: GradingContext | null,
  ) {
    const groups = new Map<string, typeof rows>();
    for (const r of rows) {
      const k = variantKey({
        cardId: r.item.cardId,
        productType: r.item.productType,
        gradeKey: this.pricing.gradeKeyFor(r.item),
        finish: r.item.finish,
      });
      const arr = groups.get(k);
      if (arr) arr.push(r);
      else groups.set(k, [r]);
    }
    return [...groups.values()].map((members) => {
      // Representante = pieza vendible MÁS BARATA (el precio del grupo = su salePriceCents = mínimo).
      const cheapest = [...members].sort(
        (a, b) => (a.dto.salePriceCents ?? 0) - (b.dto.salePriceCents ?? 0),
      )[0];
      const item = cheapest.item;
      const salePriceCents = cheapest.dto.salePriceCents!; // garantizado por fetchSellable (nunca null aquí)

      // v1.50-graded-estimate (§4.38c/e) — GATE DE CURADURÍA, a nivel de GRUPO: compara contra
      // `salePriceCents`, que ES del grupo. Una carta con `normal` y `reverse_holo` publicados tiene UN
      // solo par de estimados (son de la CARTA) pero DOS precios raw ⇒ puede quedar destacada en un
      // acabado y no en el otro. Es deliberado y money-safe.
      const highlightResult = grading
        ? evaluateGradingHighlight<GradedEstimateRef>({
            productType: item.productType,
            rawSalePriceCents: salePriceCents,
            estimates: grading.byCard.get(item.cardId) ?? [],
            // v1.50.2 (§4.38l, INV-D): si la carta tiene un SLAB PUBLICADO de ese grado, esa fila no es
            // un estimado — es el precio de mercado REAL de la pieza. La guarda de LECTURA la omite.
            publishedSlabGrades: grading.slabsByCard.get(item.cardId) ?? [],
            today: grading.today,
            cfg: grading.cfg,
          })
        : null;
      // PRESENCIA ⇔ ELEGIBILIDAD: sin gate cumplido el campo NO EXISTE. Jamás `eligible:false`, jamás
      // `[]` (un arreglo vacío es un contenedor renderizable y filtraría la decisión del gate).
      const gradingHighlight =
        highlightResult?.eligible && highlightResult.highlight.length > 0
          ? highlightResult.highlight.map(toGradedEstimateDTO)
          : null;

      // ANOTADO con el tipo del contrato: omitir un campo requerido ya no compila (v2.1.7).
      const dto: GroupedListingDTO = {
        representativeInventoryItemId: item.id,
        card: cheapest.dto.card,
        productType: item.productType as 'raw' | 'graded',
        finish: item.finish,
        // rawCondition SOLO en raw; gradingCompany/gradeValue SOLO en graded (identidad de GRADO del grupo).
        rawCondition: item.rawCondition ?? undefined,
        gradeKey: this.pricing.gradeKeyFor(item),
        gradingCompany: item.gradingCompany ?? undefined,
        gradeValue: item.gradeValue ?? undefined,
        stockCount: members.length,
        salePriceCents,
        // v2.0 (P-48, contrato §DTOs `GroupedListingDTO`) — REQUERIDO, y se omitía.
        //
        // Es el basis del REPRESENTANTE (la pieza más barata). Todas las piezas de un grupo comparten
        // clave K ⇒ comparten curva y override de variante ⇒ comparten basis, SALVO que alguna traiga
        // `listPriceCents` manual: en ese caso el representante es esa y el basis del grupo es
        // `override`. El basis EXACTO por pieza vive en `units[]` (`ListingDTO.priceBasis`).
        //
        // ⚠️ Omitirlo INVERTÍA la regla de visibilidad de §N.7. El front hace
        // `primary?.priceBasis === 'market'` para decidir si pinta «Valor de mercado»; con
        // `undefined` la comparación es SIEMPRE falsa, así que el bloque no se mostraba NUNCA —ni
        // siquiera cuando el mercado sí fijó el precio— en el 100% de las fichas de single. El dato
        // estaba a mano en `cheapest.dto` (la línea de abajo ya lo usaba para `referenceValue`).
        priceBasis: cheapest.dto.priceBasis,
        // Ya viene proyectado por `toListingDTO` (mismo K ⇒ misma PriceReference), informativo.
        referenceValue: cheapest.dto.referenceValue,
        currency: 'MXN' as const,
        // ⚠️ MERGE v1.50.2 — `gradingHighlight` NO va aquí. Tras D2, `GroupedListingDTO` es el DTO de la
        // FICHA, y la ficha expone `gradedEstimates` en su raíz (más rico: PSA 10 y 9, y sin gatear).
        // El destacado vive en `GroupedListingSummaryDTO` (la REJILLA), abajo. Contrato §DTOs base
        // (v1.50.2) y ARCHITECTURE §4.38(0)/(e): la partición informar≠promover la sostiene el
        // COMPILADOR (dos tipos), no la disciplina.
      };
      // v2.1.9 (D2): la REJILLA recibe el mismo grupo MENOS `priceBasis` y `referenceValue`. Se
      // construye por lista blanca desde el mismo objeto (una sola fuente de agrupación), y el tipo
      // propio hace que emitir cualquiera de los dos aquí NO COMPILE.
      //
      // ⚠️ La lista blanca es también la razón por la que `gradingHighlight` tuvo que MOVERSE
      // explícitamente: un campo que no se copia aquí desaparece EN SILENCIO (compila, la teja queda
      // vacía). Dictamen del arquitecto en §4.38(e) — entra a la rejilla, y con gate de confianza (k).
      const summary: GroupedListingSummaryDTO = {
        representativeInventoryItemId: dto.representativeInventoryItemId,
        card: dto.card,
        productType: dto.productType,
        finish: dto.finish,
        rawCondition: dto.rawCondition,
        gradeKey: dto.gradeKey,
        gradingCompany: dto.gradingCompany,
        gradeValue: dto.gradeValue,
        stockCount: dto.stockCount,
        salePriceCents: dto.salePriceCents,
        currency: dto.currency,
        // v1.50.2 (ADITIVO): presente ⇔ el gate de ROI **y** el de confianza (§4.38k) se cumplen.
        // Omitido en cualquier otro caso (incluido el dial `off`) ⇒ la teja se ve EXACTAMENTE como hoy
        // (criterio 100). Jamás `[]`, jamás `eligible:false`.
        ...(gradingHighlight ? { gradingHighlight } : {}),
      };
      return {
        dto,
        summary,
        salePriceCents,
        // 'newest' del grupo = la pieza más nueva (createdAt desc) — contrato §2 GET /catalog/cards.
        newestAt: Math.max(...members.map((m) => m.item.createdAt.getTime())),
        // Claves de ORDEN de la vitrina (`sort=grading_showcase`) y del diagnóstico de admin. NINGUNA
        // viaja al cliente (SEC-A1, §4.38e): el servidor las usa solo para decidir presencia y orden.
        highlightResult,
      };
    });
  }

  /**
   * v1.44-graded-estimate (§4.38c) — iza el contexto del gancho para un conjunto YA materializado de
   * piezas vendibles.
   *
   * **Coste REAL, medido (IMPORTANTE-2):** **+1 query con el dial `off`** (la lectura de config: las
   * **12** claves del gancho van en UN `findMany`, ver `PricingService.loadGradedEstimateConfig`) y
   * **+3 con el dial `on`** (esa + el batch de estimados + el batch de slabs publicados de INV-D, los
   * dos sobre los `cardId` DISTINTOS de las filas **raw**). Nunca una query por grupo ni por carta: es
   * O(1) respecto del tamaño de la página.
   *
   * ⚠️ Los números de arriba son la MEDICIÓN, no una aspiración: v1.50.2 añadió 6 diales y el batch de
   * INV-D, así que «6 claves / +2» quedó obsoleto. Si vuelve a cambiar, se actualiza aquí — un coste
   * documentado que no corresponde con el real es peor que no documentarlo (§4.38c › «Nota de método»).
   *
   * Devuelve `null` —y NO hace la query de precios— cuando:
   *  - el dial maestro está `off` (§M10: con `off` el backend «ni siquiera evalúa nada»), o
   *  - no hay ninguna pieza **raw** vendible en el conjunto (el gancho no aplica a graded ni a sealed,
   *    criterio 105).
   */
  private async loadGradingContext(
    rows: { item: ItemWithCard }[],
  ): Promise<GradingContext | null> {
    const cfg = await this.pricing.loadGradedEstimateConfig();
    if (!cfg.enabled) return null;
    const cardIds = [
      ...new Set(rows.filter((r) => r.item.productType === 'raw').map((r) => r.item.cardId)),
    ];
    if (cardIds.length === 0) return null;
    // Las DOS lecturas van sobre el MISMO conjunto de `cardId` distintos y fuera de todo bucle: el
    // coste del gancho es +3 con el dial `on` y +1 con `off`, CONSTANTE respecto del nº de grupos, de
    // cartas de la página y de acabados. Si una medición futura escala con `pageSize`, hay un N+1 nuevo
    // y es un bloqueante (§4.38c › «Nota de método»).
    // v1.50.3 (§4.38m): `cfg` + `today` van al batch porque el filtro de FRESCURA se aplica AHÍ,
    // **antes** de `pickBestRef` — así un manual rancio deja pasar a la automática fresca en vez de
    // ganar y caerse después. Es el mismo `today` que consumen las puras: una sola fecha por request.
    const today = businessDateCdmx();
    const [byCard, slabsByCard] = await Promise.all([
      this.pricing.getGradedEstimatesBatch(cardIds, cfg, today),
      this.pricing.getPublishedSlabGradesBatch(cardIds),
    ]);
    return { cfg, byCard, slabsByCard, today };
  }

  /**
   * v1.44-graded-estimate (§4.38f / API_CONTRACT §2) — valida los DOS query params nuevos de la vitrina
   * ANTES de tocar la base (fail-closed, y el error no depende de si la feature está encendida):
   *  - `gradingHighlight` **solo acepta `"true"`**: un `false` «filtrando lo no destacado» sería una
   *    superficie comercial invertida que nadie pidió ⇒ `400 VALIDATION_ERROR`.
   *  - `sort=grading_showcase` **exige** el filtro ⇒ si no, `400 GRADING_SORT_REQUIRES_FILTER`: sin él,
   *    los grupos NO destacados irían a la cola del listado con clave de orden indefinida y la vitrina
   *    podría pintarlos al paginar.
   */
  private validateGradingQuery(q: { gradingHighlight?: string; sort?: string }): boolean {
    const onlyHighlighted = q.gradingHighlight !== undefined;
    if (onlyHighlighted && q.gradingHighlight !== 'true') {
      throw BusinessException.badRequest('VALIDATION_ERROR', 'gradingHighlight only accepts "true"', {
        field: 'gradingHighlight',
        value: q.gradingHighlight,
        allowed: ['true'],
      });
    }
    if (q.sort === 'grading_showcase' && !onlyHighlighted) {
      throw BusinessException.badRequest(
        'GRADING_SORT_REQUIRES_FILTER',
        'sort=grading_showcase requires gradingHighlight=true',
        { field: 'sort' },
      );
    }
    return onlyHighlighted;
  }

  async listCards(q: {
    q?: string;
    setId?: string;
    rarity?: string;
    productType?: string;
    condition?: string;
    finish?: string;
    sealedSubtype?: string;
    minPriceCents?: number;
    maxPriceCents?: number;
    page: number;
    pageSize: number;
    sort?: string;
    /** v1.44 (§4.38f): vitrina «Joyas para gradear». Solo se acepta `"true"`. */
    gradingHighlight?: string;
  }) {
    // v1.44: se valida ANTES de la query (un sort inválido no debe costar una lectura).
    const onlyHighlighted = this.validateGradingQuery(q);
    // Endpoint PÚBLICO: los filtros enum se validan contra la taxonomía real ANTES de
    // llegar a Prisma. Un valor inválido (p. ej. ?condition=LP, ?productType=foo) hoy
    // rompía con PrismaClientValidationError (500); ahora responde 400 VALIDATION_ERROR.
    const extra: Prisma.InventoryItemWhereInput = {};
    if (q.productType) extra.productType = this.validateEnum('productType', q.productType, PRODUCT_TYPES) as never;
    if (q.condition) extra.rawCondition = this.validateEnum('condition', q.condition, RAW_CONDITIONS) as never;
    // v1.6-finish: filtro por acabado sobre InventoryItem.finish. Valor inválido → 400.
    if (q.finish) extra.finish = this.validateEnum('finish', q.finish, FINISHES) as never;
    if (q.sealedSubtype) extra.sealedSubtype = this.validateEnum('sealedSubtype', q.sealedSubtype, SEALED_SUBTYPES) as never;
    const cardWhere: Prisma.CardWhereInput = {};
    // v1.33 (P-27, §4.31d): si `setId` es el PRINCIPAL de un master combinado, EXPANDE a
    // `setId IN partSetIds` (incluye el inventario publicado de todas las partes: cel25 + cel25c).
    // Aditivo: para un set normal el filtro es idéntico a hoy. La Regla de Compra se respeta —
    // `fetchSellable` sigue listando SOLO lo `sellable` (agrupar no publica cartas sin precio).
    if (q.setId) cardWhere.setId = await this.expandSetIdFilter(q.setId);
    if (q.rarity) cardWhere.rarity = q.rarity;
    if (q.q) cardWhere.name = { contains: q.q, mode: 'insensitive' };
    if (Object.keys(cardWhere).length) extra.card = cardWhere;

    // H9 / SB-D5: la vista de SINGLES excluye el sellado (guardarraíl interino) — ver singlesPublishedWhere.
    const rows = await this.fetchSellable(this.singlesPublishedWhere(extra));

    // v1.44-graded-estimate (§4.38c): +1 query constante (0 si el dial está off o no hay raw).
    const grading = await this.loadGradingContext(rows);

    // v1.38-grouped-listings (P-30, §4.9a): AGRUPA en lectura por K=(cardId,productType,gradeKey,finish).
    // `total` = nº de GRUPOS (publicaciones únicas), no de piezas. Todo grupo emitido tiene stockCount≥1.
    let groups = this.buildGroups(rows, grading);

    // v1.44 (§4.38f) — VITRINA: subconjunto ordenado de Compra, no un endpoint aparte (mismo
    // `GroupedListingSummaryDTO` que la rejilla —tras D2 ése ES el DTO de la rejilla, no
    // `GroupedListingDTO`, que quedó para la ficha— ⇒ misma teja, misma cifra, cero drift). Con el dial
    // `off` ningún grupo trae `gradingHighlight` ⇒ `{ data: [], total: 0 }`, la señal de «no renderizar»
    // (criterio 101). No es un error: es la feature apagada.
    if (onlyHighlighted) groups = groups.filter((g) => g.summary.gradingHighlight != null);

    // Rango de precio sobre el salePriceCents del GRUPO (contrato §2): el mínimo del grupo (= el del
    // representante). En el caso normal todas las piezas comparten precio, así que equivale a filtrar por
    // pieza; ante un listPriceCents manual divergente, el grupo se conserva/descarta por su precio único.
    if (q.minPriceCents != null) groups = groups.filter((g) => g.salePriceCents >= q.minPriceCents!);
    if (q.maxPriceCents != null) groups = groups.filter((g) => g.salePriceCents <= q.maxPriceCents!);

    if (q.sort === 'price_asc') groups.sort((a, b) => a.salePriceCents - b.salePriceCents);
    else if (q.sort === 'price_desc') groups.sort((a, b) => b.salePriceCents - a.salePriceCents);
    else if (q.sort === 'grading_showcase') {
      // v1.44 (§4.38f) — nombre deliberadamente NEUTRO: no nombra el criterio, así que ajustar la
      // política comercial es un cambio server-side con CERO impacto en contrato y cliente. Criterio
      // vigente: mayor GANANCIA NETA SOBRE PSA 9 (el escenario realista, no el optimista), con desempate
      // DETERMINISTA para que la paginación no baile: neta desc → PSA 10 desc → representante asc.
      // Ninguna de esas claves viaja al cliente.
      groups.sort((a, b) => {
        const an = a.highlightResult?.netUpsidePsa9MxnCents ?? 0;
        const bn = b.highlightResult?.netUpsidePsa9MxnCents ?? 0;
        if (an !== bn) return bn - an;
        const a10 = a.highlightResult?.psa10MxnCents ?? 0;
        const b10 = b.highlightResult?.psa10MxnCents ?? 0;
        if (a10 !== b10) return b10 - a10;
        return a.dto.representativeInventoryItemId.localeCompare(b.dto.representativeInventoryItemId);
      });
    } else groups.sort((a, b) => b.newestAt - a.newestAt); // 'newest' (default): pieza más nueva del grupo.

    const total = groups.length;
    const start = (q.page - 1) * q.pageSize;
    // v2.1.9 (D2): la REJILLA emite `GroupedListingSummaryDTO` — sin `priceBasis` ni `referenceValue`.
    const data = groups.slice(start, start + q.pageSize).map((g) => g.summary);
    return { data, page: q.page, pageSize: q.pageSize, total };
  }

  /**
   * v1.1 — Facetas dinámicas de "Compra" calculadas SOBRE el inventario publicado y
   * comprable (no el catálogo completo). API_CONTRACT §catalog/facets.
   */
  async facets() {
    const rows = await this.fetchSellable(this.publishedWhere());

    const rarities = [...new Set(rows.map((r) => r.item.card.rarity).filter((x): x is string => Boolean(x)))];
    const productTypes = [...new Set(rows.map((r) => r.item.productType))];
    // v1.6-finish: distinct de InventoryItem.finish sobre el inventario publicado (filtro de acabado).
    const finishes = [...new Set(rows.map((r) => r.item.finish))];
    const sealedSubtypes = [
      ...new Set(rows.map((r) => r.item.sealedSubtype).filter((x): x is NonNullable<typeof x> => Boolean(x))),
    ];

    const setMap = new Map<
      string,
      { id: string; externalId: string; name: string; series: string | null; releaseDate: string | null; year: number | null }
    >();
    for (const { item } of rows) {
      const s = item.card.set;
      if (s && !setMap.has(s.id)) {
        setMap.set(s.id, {
          id: s.id,
          externalId: s.externalId,
          name: s.name,
          series: s.series ?? null,
          releaseDate: s.releaseDate ?? null,
          year: yearFromReleaseDate(s.releaseDate),
        });
      }
    }
    // v1.33 (P-27, §4.31d): pliega el subset en su principal (Celebrations una vez) + `partSetIds?`.
    const folded = await this.foldStorefrontSets([...setMap.values()]);
    const sets = folded
      .map((s) => ({
        id: s.id,
        name: s.name,
        releaseDate: s.releaseDate,
        year: s.year,
        ...(s.partSetIds ? { partSetIds: s.partSetIds } : {}),
      }))
      .sort((a, b) => (b.year ?? 0) - (a.year ?? 0));

    const prices = rows.map((r) => r.dto.salePriceCents ?? 0);
    return {
      rarities,
      sets,
      productTypes,
      sealedSubtypes,
      finishes,
      price: {
        minCents: prices.length ? Math.min(...prices) : 0,
        maxCents: prices.length ? Math.max(...prices) : 0,
        currency: 'MXN' as const,
      },
    };
  }

  async getCard(cardId: string): Promise<GroupedListingDetailResponse> {
    const card = await this.prisma.card.findUnique({
      where: { id: cardId },
      include: { set: true },
    });
    if (!card) throw BusinessException.notFound();
    // H9 / SB-D5: la ficha del single excluye el sellado (P-35 lo ancla a esta carta) — guardarraíl interino.
    const rows = await this.fetchSellable(this.singlesPublishedWhere({ cardId }));
    // v1.22-2 / N-15 (§4.22a-6): displayFinishes de la ficha usa los acabados priceados de la carta.
    const pricedByCard = await this.pricing.getPricedRawFinishesBatch([cardId]);
    // v1.44-graded-estimate (§4.38c): +1 query constante (batch de UN cardId; 0 si el dial está off).
    const grading = await this.loadGradingContext(rows);
    // v1.38-grouped-listings (P-30, §4.9a): `listings` = publicaciones AGRUPADAS (una por
    // (productType,gradeKey,finish) con stockCount≥1), cheapest-first — es la grilla de la ficha.
    const listings = this.buildGroups(rows, grading)
      .sort((a, b) => a.salePriceCents - b.salePriceCents)
      .map((g) => g.dto);
    // `units` = TODAS las piezas vendibles POR-PIEZA (cheapest-first) para el add-to-cart por
    // inventoryItemId (el carrito sigue por-pieza, §4-G) y para exponer el certNumber de cada slab.
    const units = [...rows]
      .sort((a, b) => (a.dto.salePriceCents ?? 0) - (b.dto.salePriceCents ?? 0))
      .map((r) => r.dto);

    // v1.44-graded-estimate (§4.38-0/e, API_CONTRACT §2) — FICHA: `gradedEstimates` a nivel de CARTA y
    // **SIN gatear** (informar ≠ promover). Se emite siempre que haya dato FRESCO, aunque el gate de
    // curaduría NO se cumpla y la carta no salga destacada en Compra ni en el home: eso es exactamente
    // lo buscado, no una inconsistencia. Los grados son INDEPENDIENTES (PSA 10 sin PSA 9 ⇒ un elemento).
    // NUNCA aparece sin grupos RAW publicados (una gradeada o un sellado jamás lo traen, criterio 105).
    // v1.44 R2: la ausencia de grupos raw publicados se resuelve con una GUARDA EXPLÍCITA, no pasando
    // un `productType` falso a la pura. Inyectar `'graded'` como centinela funcionaba (el criterio 105
    // hace que la pura devuelva `[]`), pero MENTÍA en un parámetro de dominio: una carta sin grupos raw
    // publicados no es «graded», y en una función cuyo criterio es «graded y sealed NUNCA» ese atajo es
    // justo el que el siguiente lector «arregla» y rompe.
    const hasPublishedRawGroup = listings.some((l) => l.productType === 'raw');
    const gradedEstimates =
      grading && hasPublishedRawGroup
        ? selectGradedEstimates<GradedEstimateRef>({
            productType: 'raw',
            estimates: grading.byCard.get(cardId) ?? [],
            // v1.50.2 (INV-D): un grado con slab PUBLICADO se OMITE también en la ficha — ahí esa fila
            // no es un estimado, es el precio real de una pieza que ya se lista con su propio precio.
            // (Es lo ÚNICO que la ficha suprime; la coherencia de MAGNITUD sí la informa, §4.38k.3.)
            publishedSlabGrades: grading.slabsByCard.get(cardId) ?? [],
            today: grading.today,
            cfg: grading.cfg,
          }).map(toGradedEstimateDTO)
        : [];

    return {
      card: toCardDTO(card, pricedByCard.get(cardId)),
      listings,
      units,
      // Sin ningún grado que exponer ⇒ el campo se OMITE (nunca `[]`): el front no pinta NADA — ni
      // contenedor, ni skeleton, ni «—», ni $0, ni «pendiente» (criterio 102).
      ...(gradedEstimates.length > 0 ? { gradedEstimates } : {}),
    };
  }

  /**
   * v1.44-graded-estimate (§4.38d, API_CONTRACT §M2) — DIAGNÓSTICO DE CURADURÍA
   * (`GET /admin/pricing/graded-estimates/preview?cardId=`, `super_admin`, read-only): responde
   * «¿por qué esta carta no está destacada?». Es el ÚNICO lugar donde los insumos del gate se exponen —
   * al ADMIN, jamás al cliente — y su existencia es lo que permite que el DTO público sea tan chico.
   *
   * Una entrada **por grupo raw publicado** (la misma `K` de `GroupedListingDTO`). `groups: []` = la
   * carta no tiene ningún grupo raw publicado (NO es un error). Money-safe: todo monto no resoluble es
   * `null`, **nunca `0`**. No escribe nada y no toca dinero.
   *
   * A diferencia del storefront, el batch se lee **aunque el dial esté `off`** (si no, el diagnóstico
   * sería inútil justo en el estado por defecto): el gate devuelve `FEATURE_OFF` y todos los montos que
   * dependen del escalón quedan en `null`.
   */
  async gradedEstimatePreview(cardId: string) {
    const card = await this.prisma.card.findUnique({ where: { id: cardId }, select: { id: true } });
    if (!card) throw BusinessException.notFound();
    // Config COMPLETA (no la abreviada del storefront): el editor de M2 necesita ver los escalones y
    // los umbrales aunque el interruptor maestro esté apagado.
    const cfg = await this.pricing.loadGradedEstimateConfigForAdmin();
    const rows = await this.fetchSellable(this.singlesPublishedWhere({ cardId }));
    const previewToday = businessDateCdmx();
    const [estimatesByCard, slabsByCard] = await Promise.all([
      // v1.50.3 (§4.38m) + v1.50.3-c (QA): el diagnóstico resuelve con la MISMA regla que el storefront
      // —lo rancio se descarta ANTES de `pickBestRef`, así que donde hay dato fresco el operador ve
      // exactamente lo que ve la ficha—, y ADEMÁS ve las filas que ese descarte se llevó, pero **solo
      // donde no quedó ninguna fresca**. Sin esto, «tu cifra de 40 días expiró» se reportaba como
      // `NO_PSA10` + `capturedDate: null`, o sea «nunca la capturaste»: dos problemas con remedios
      // OPUESTOS (refrescar vs. capturar) fundidos en un mismo veredicto, y `STALE` —normado en §M2—
      // convertido en código muerto. La divergencia con la ficha viene siempre etiquetada `STALE`.
      this.pricing.getGradedEstimatesBatch([cardId], cfg, previewToday, {
        includeStaleForDiagnostics: true,
      }),
      this.pricing.getPublishedSlabGradesBatch([cardId]),
    ]);
    const estimates = estimatesByCard.get(cardId) ?? [];
    // v1.50.2 (INV-D): viaja al DTO del preview para que el operador vea POR QUÉ un grado desapareció
    // sin tener que leer la BD — la fila existe, pero es dinero de un slab, no un estimado.
    const publishedSlabGrades = slabsByCard.get(cardId) ?? [];
    const today = previewToday;
    const groups = this.buildGroups(rows)
      .filter((g) => g.dto.productType === 'raw')
      .sort((a, b) => a.salePriceCents - b.salePriceCents)
      .map((g) => {
        const r: GradingHighlightResult<GradedEstimateRef> = evaluateGradingHighlight<GradedEstimateRef>({
          productType: 'raw',
          rawSalePriceCents: g.salePriceCents,
          estimates,
          publishedSlabGrades,
          today,
          cfg,
        });
        return {
          representativeInventoryItemId: g.dto.representativeInventoryItemId,
          finish: g.dto.finish,
          salePriceCents: g.salePriceCents,
          psa10MxnCents: r.psa10MxnCents,
          psa9MxnCents: r.psa9MxnCents,
          capturedDate: r.capturedDate,
          stale: r.stale,
          // v1.50.3-c (§4.38n.2-bis): el ORIGEN de esa misma fila. Sin él, `STALE` no dice si el
          // remedio es «recapturar» (manual) o «mirar el ingest» (automática).
          isManual: r.isManual,
          // v1.50.3-f (M-43, §4.38l.4.4B): la NATURALEZA de esa MISMA fila. Distingue «esta cifra es un
          // estimado que puedo recapturar o borrar» de «esta cifra es DINERO de una pieza real, no la
          // toques»: el gancho MUESTRA las filas `market` de cartas sin slab de ese grado, pero el
          // `DELETE` del gancho no se las lleva (§4.38l.4.5). Sin este campo, el diagnóstico invita a
          // borrar filas de mercado.
          refKind: r.refKind,
          gradingCostTier: r.gradingCostTier,
          gradingCostMxnCents: r.gradingCostMxnCents,
          thresholdMxnCents: r.thresholdMxnCents,
          netUpsidePsa9MxnCents: r.netUpsidePsa9MxnCents,
          // v1.50.2 — los dos campos nuevos del contrato: la cota SUPERIOR efectiva contra la que se
          // comparó (`salePriceCents × maxRawMultiple`) y los grados con slab publicado (INV-D). Sin
          // ellos, `ABOVE_MAX_MULTIPLE` y `SLAB_PUBLISHED` serían veredictos sin evidencia.
          maxAllowedPsa10MxnCents: r.maxAllowedPsa10MxnCents,
          publishedSlabGrades,
          eligible: r.eligible,
          ...(r.reason ? { reason: r.reason } : {}),
          // v1.50.3-e (§4.38n.2-ter): TODAS las condiciones detectadas, no solo la primera. `reason`
          // sigue siendo el primer bloqueante —la pregunta «¿por qué no se promociona?»—; `reasons`
          // contesta «¿qué le pasa a esta carta?», que es la que el operador trae y que un ESCALAR no
          // puede responder: una carta puede fallar varias condiciones a la vez.
          reasons: r.reasons,
        };
      });
    // `config` = la config EFECTIVA (la misma que usa el resolver, ya saneada fail-closed): si el admin
    // ve `gradingCostTiers: []` aquí, eso ES la explicación de por qué nada se destaca. Se PROYECTA al
    // DTO del contrato: los flags internos de GU-A8 no viajan (cuando apagan algo, el admin lo ve en el
    // `reason: FEATURE_OFF` de cada grupo y en el `warn` del servidor, §4.38d › Observabilidad).
    return {
      cardId,
      enabled: cfg.enabled,
      config: toGradedEstimateConfigDTO(cfg),
      groups,
    };
  }

  /**
   * v1.50.3 (§4.38n, API_CONTRACT §M2) — **LISTA DE REVISIÓN** del back-office
   * (`GET /admin/pricing/graded-estimates/review`, `super_admin`, read-only, paginada).
   *
   * ## Por qué existe (es el criterio 111(e), y era una deuda)
   * §4.38(k.3) decidió **no ocultar** en la ficha la cifra que falla la coherencia de magnitud, y esa
   * decisión se justificó **precisamente** por esta contrapartida: *«si decidimos seguir mostrándola,
   * alguien tiene que enterarse»* (§O.7, con esas palabras). Sin lista, (k.3) dejaba de ser
   * «visible-y-corregible» y pasaba a ser «visible-y-nadie-la-corrige» — que es **peor que ocultarla**:
   * publicamos el número malo **y** perdemos la señal. Las dos mitades se sostienen juntas.
   *
   * `preview` responde «¿por qué **esta** carta no está destacada?» y exige `cardId`: solo contesta si
   * **ya sospechabas**. Esto responde **«¿de qué cartas debo sospechar?»**, que es la pregunta que nadie
   * podía hacer. **Mismo cálculo, misma pura, mismos `reason`** — lo que cambia es la dirección.
   *
   * ## Las cuatro decisiones no obvias
   *
   * 1. **Conjunto motor = las cartas que TIENEN fila de estimado**, no el catálogo. Es pequeño y
   *    acotado por diseño (fase 1: curación a mano; fase 2: `ingestMaxCardsPerRun` por corrida). **Sin
   *    ese recorte esto sería un barrido de catálogo y no debería existir.**
   * 2. **Coste CONSTANTE en queries** (1 config + 1 `distinct cardId` + 1 batch de estimados + 1 lote
   *    de piezas publicadas + 1 batch de slabs): jamás una query por carta ni por grupo, misma regla
   *    que §4.38(c).
   * 3. **Funciona con la feature APAGADA**, y `FEATURE_OFF` **nunca se emite**. El dial arranca en `off`
   *    para poder **limpiar antes** de encender la afirmación comercial; una lista que solo funcionara
   *    encendida obligaría a **publicar las cifras malas para poder descubrirlas** — el orden exacto al
   *    revés. Por eso se evalúa con una config forzada a `highlightEnabled` (ver abajo).
   * 4. **«Apagada» ≠ «corrupta».** El dial `off` es una decisión y se tolera; una clave **presente pero
   *    inválida** es intención perdida ⇒ **`409 GRADED_CONFIG_INVALID`** nombrando la clave, en vez de
   *    evaluar contra un umbral basura. Una lista calculada con un umbral corrupto marcaría (o dejaría
   *    de marcar) cartas por una razón que no es la que el operador cree, justo en la superficie que
   *    existe para que el operador **confíe** en lo que ve.
   *
   * **No escribe nada, no corrige, no descarta y no silencia.** «Marcar como revisada» exigiría estado
   * persistido ⇒ DDL ⇒ **fuera de alcance de v1.50.3** (§4.38n.4), declarado para que no se cuele.
   */
  async gradedEstimateReview(params: {
    reasons?: HighlightReason[];
    page: number;
    pageSize: number;
  }): Promise<GradedEstimateReviewResponse> {
    const cfg = await this.pricing.loadGradedEstimateConfigForAdmin();

    // (4) `AUSENTE ≠ INVÁLIDA`. Solo interesa la corrupción de las claves de las que depende LA
    // COHERENCIA. Las cotas inferior y de orden de grados no dependen de ninguna clave (son invariantes
    // de producto), pero NO se sirve un resultado parcial haciéndolo pasar por completo — mismo motivo
    // que `truncated`.
    if (cfg.maxRawMultipleInvalid) {
      throw BusinessException.conflict(
        'GRADED_CONFIG_INVALID',
        'La lista de revisión no puede calcularse: `graded_estimate_max_raw_multiple` está PRESENTE ' +
          'pero es INVÁLIDA, y la cota superior de coherencia depende de ella. Evaluar con un umbral ' +
          'basura marcaría (o dejaría de marcar) cartas por una razón que no es la que crees. ' +
          'Corrígela con PUT /admin/pricing/graded-estimates.',
        { key: SettingKey.GRADED_ESTIMATE_MAX_RAW_MULTIPLE },
      );
    }

    const reasons = params.reasons ?? [...GRADED_REVIEW_DEFAULT_REASONS];

    // (1) CONJUNTO MOTOR: `distinct cardId` de las filas de estimado. `take` = la cota + 1, para poder
    // DISTINGUIR «justo en el límite» de «se pasó» sin una segunda query de conteo.
    const withEstimates = await this.prisma.priceReference.findMany({
      where: {
        productType: 'graded',
        gradeKey: { in: [...GRADED_ESTIMATE_GRADE_KEYS] },
        finish: 'normal',
        cardProductId: null,
      },
      select: { cardId: true },
      distinct: ['cardId'],
      orderBy: { cardId: 'asc' },
      take: GRADED_REVIEW_MAX_SCAN + 1,
    });
    const truncated = withEstimates.length > GRADED_REVIEW_MAX_SCAN;
    const cardIds = withEstimates.slice(0, GRADED_REVIEW_MAX_SCAN).map((r) => r.cardId);
    const empty: GradedEstimateReviewResponse = {
      data: [],
      page: params.page,
      pageSize: params.pageSize,
      total: 0,
      enabled: cfg.enabled,
      scannedCards: cardIds.length,
      truncated,
    };
    if (cardIds.length === 0) return empty;

    // (2) COSTE CONSTANTE: el lote de piezas publicadas de ESAS cartas + los dos batches, todos fuera
    // de cualquier bucle. `fetchSellable` resuelve el precio de venta con la curva vigente, que es
    // contra lo que se comparan las cotas — leerlo de otro sitio sería una segunda verdad del precio.
    const today = businessDateCdmx();
    const rows = await this.fetchSellable(this.singlesPublishedWhere({ cardId: { in: cardIds } }));
    const [estimatesByCard, slabsByCard] = await Promise.all([
      // v1.50.3-c: misma resolución que el `preview` — se ven también las filas que el filtro de
      // frescura descartó, para que la lista pueda decir «esta cifra CADUCÓ» en vez de «no hay cifra».
      // **Es lo que hace posible `?reason=STALE`** (§4.38n.2-bis, GU-A24): sin esta re-inyección, una
      // carta cuya única fila caducó resolvía a `NO_PSA10` —«nunca la capturaste»— y quedaba fuera de
      // toda consulta posible, desaparecida de las tres superficies y aun así presente en la BD.
      this.pricing.getGradedEstimatesBatch(cardIds, cfg, today, { includeStaleForDiagnostics: true }),
      this.pricing.getPublishedSlabGradesBatch(cardIds),
    ]);

    // (3) La feature puede estar `off`: se evalúa con los interruptores de GU-A8 FORZADOS a `true`, que
    // es lo único que se fuerza. Todo lo demás —umbrales, escalones, grados— sale de la config REAL, así
    // que el veredicto es el mismo que el storefront daría con el dial encendido. `FEATURE_OFF` deja de
    // ser alcanzable por construcción, que es justo lo que §4.38n.3 pide.
    const evalCfg: GradedEstimateConfig = { ...cfg, estimatesEnabled: true, highlightEnabled: true };

    // v1.50.3-e (§4.38n.2-ter): cada fila viaja con su **`reason` PRIMARIO MATCHEADO** —el primero de
    // `reasons` que está en el conjunto PEDIDO—, que es la clave de orden del contrato §M2. NO es
    // `reasons[0]` a secas: ése puede ser un motivo que el operador **no** pidió (la carta de un solo
    // grado entra por `NOT_ABOVE_RAW` y su `reasons[0]` es `NO_PSA9`), y ordenar por él mezclaría la
    // lista por un criterio invisible desde la respuesta. El DTO sigue emitiendo `reason` = el primer
    // bloqueante, tal como lo declara el contrato.
    const matched: { key: string; item: GradedEstimateReviewItemDTO }[] = [];
    for (const g of this.buildGroups(rows)) {
      if (g.dto.productType !== 'raw') continue;
      const card = g.dto.card;
      const estimates = estimatesByCard.get(card.id) ?? [];
      const publishedSlabGrades = slabsByCard.get(card.id) ?? [];
      const r = evaluateGradingHighlight<GradedEstimateRef>({
        productType: 'raw',
        rawSalePriceCents: g.salePriceCents,
        estimates,
        publishedSlabGrades,
        today,
        cfg: evalCfg,
      });
      // ⚠️ EL FILTRO SE EVALÚA SOBRE `reasons`, NO SOBRE `reason` (§4.38n.2-ter, contrato §M2). Con
      // `reason` a secas la red de coherencia **no se ponía con un solo grado**: raw $460 + PSA 10 $230
      // sin PSA 9 cortaba en `NO_PSA9` y `NOT_ABOVE_RAW` nunca se comprobaba ⇒ `total: 0`. Y es el peor
      // sitio donde podía faltar: el error USD-como-MXN es más probable en la PRIMERA captura (un solo
      // grado), y como sin PSA 9 la carta nunca se promociona, la cifra errónea **no llega a la rejilla
      // pero SÍ se muestra en la ficha** (§4.38k.3) ⇒ visible al comprador, inencontrable para el
      // operador. Justo «publicamos la cifra mala y nadie se entera», que es el fallo que esta lista
      // existe para impedir.
      const primary = r.reasons.find((x) => reasons.includes(x));
      if (primary == null) continue;
      const item: GradedEstimateReviewItemDTO = {
        cardId: card.id,
        cardName: card.name,
        setName: card.setName ?? '',
        number: card.number,
        representativeInventoryItemId: g.dto.representativeInventoryItemId,
        finish: g.dto.finish,
        salePriceCents: g.salePriceCents,
        psa10MxnCents: r.psa10MxnCents,
        psa9MxnCents: r.psa9MxnCents,
        capturedDate: r.capturedDate,
        stale: r.stale,
        isManual: r.isManual,
        // M-43 (§4.38l.4.4B): mismo campo que el `preview`, misma fila. En la LISTA importa aún más:
        // es el verbo destructivo el que se ofrece por fila.
        refKind: r.refKind,
        gradingCostTier: r.gradingCostTier,
        gradingCostMxnCents: r.gradingCostMxnCents,
        thresholdMxnCents: r.thresholdMxnCents,
        netUpsidePsa9MxnCents: r.netUpsidePsa9MxnCents,
        maxAllowedPsa10MxnCents: r.maxAllowedPsa10MxnCents,
        publishedSlabGrades,
        eligible: r.eligible,
        reason: r.reason,
        reasons: r.reasons,
      };
      matched.push({ key: primary, item });
    }

    // ORDEN DETERMINISTA (§M2): **`reason` PRIMARIO MATCHEADO** asc → **`capturedDate` asc (`null` al
    // final)** → `cardId` asc
    // → representante asc. Sin él la paginación baila entre requests y el operador ve la misma carta
    // dos veces (o ninguna).
    //
    // v1.50.3-c intercala `capturedDate`: con `?reason=STALE` **lo más vencido va primero**, que es el
    // orden en que el dueño quiere atacarlo (la cifra de hace 200 días miente más que la de hace 31).
    // `null` al final y no al principio: una fila sin fecha no es «la más vieja», es una fila de la que
    // no sabemos nada — encabezar la lista con ella empujaría lo accionable fuera de la primera página.
    // El orden sigue siendo TOTAL y estable: los dos últimos criterios son únicos por construcción.
    const byCapturedDate = (a: string | null, b: string | null): number => {
      if (a === b) return 0;
      if (a == null) return 1; // `null` al final
      if (b == null) return -1;
      return a < b ? -1 : 1; // `YYYY-MM-DD` ordena lexicográficamente = cronológicamente
    };
    // v1.50.3-e: el primario es el `reason` MATCHEADO (`key`), no `reasons[0]`. Ver el comentario del
    // filtro: `reasons[0]` puede ser un motivo que el operador no pidió.
    matched.sort(
      (a, b) =>
        a.key.localeCompare(b.key) ||
        byCapturedDate(a.item.capturedDate, b.item.capturedDate) ||
        a.item.cardId.localeCompare(b.item.cardId) ||
        a.item.representativeInventoryItemId.localeCompare(b.item.representativeInventoryItemId),
    );
    const start = (params.page - 1) * params.pageSize;
    return {
      ...empty,
      data: matched.slice(start, start + params.pageSize).map((m) => m.item),
      total: matched.length,
    };
  }

  async getListing(inventoryItemId: string) {
    // v1.1: un item no publicado / sin precio resoluble NO es visible en Compra → 404.
    const rows = await this.fetchSellable(this.publishedWhere({ id: inventoryItemId }));
    if (rows.length === 0) throw BusinessException.notFound();
    return rows[0].dto;
  }

  /**
   * v1.3 — Búsqueda pública sobre TODA la tabla `Card` para el picker del cotizador
   * (API_CONTRACT §6 `GET /buylist/cards`). A diferencia de `listCards` ("Compra"), NO
   * filtra por inventario ni por precio: **cualquier** carta importada es cotizable, aunque
   * NO la tengamos en bóveda. Se reutiliza `CardDTO` (sin `sellable`/`salePriceCents`).
   */
  async searchAllCards(params: {
    setId?: string;
    q?: string;
    rarity?: string;
    page: number;
    pageSize: number;
  }) {
    const where: Prisma.CardWhereInput = {};
    if (params.setId) where.setId = params.setId;
    if (params.rarity) where.rarity = params.rarity;
    if (params.q) {
      // Coincide con nombre (contains, case-insensitive) y/o número de carta.
      where.OR = [
        { name: { contains: params.q, mode: 'insensitive' } },
        { number: { contains: params.q, mode: 'insensitive' } },
      ];
    }
    const skip = (params.page - 1) * params.pageSize;
    const [rows, total] = await Promise.all([
      this.prisma.card.findMany({
        where,
        include: { set: true },
        // ORDEN NORMATIVO v1.22 (API_CONTRACT §6 / ARCHITECTURE §4.22b). Se aplica EN LA BASE DE
        // DATOS, antes de paginar: ordenar tras el skip/take reordenaría la PÁGINA, no el conjunto
        // (orden global incorrecto + filas repetidas/saltadas). Con `setId` (binder del cotizador)
        // el orden es natural puro; sin él, nombre primero. Antes de v1.22 era
        // `[{name},{number}]` con `number` como String ("10" antes que "2") — defecto ORD-1.
        orderBy: params.setId ? CARD_ORDER_BY_IN_SET : CARD_ORDER_BY_GLOBAL,
        skip,
        take: params.pageSize,
      }),
      this.prisma.card.count({ where }),
    ]);
    // v1.22-2 / N-15 (§4.22a-6): picker del cotizador — acabados priceados EN LOTE (sin N+1) para
    // displayFinishes; el front pinta una tarjeta por acabado de displayFinishes (oculta el espurio).
    const pricedByCard = await this.pricing.getPricedRawFinishesBatch(rows.map((c) => c.id));
    return {
      data: rows.map((c) => toCardDTO(c, pricedByCard.get(c.id))),
      page: params.page,
      pageSize: params.pageSize,
      total,
    };
  }

  /**
   * v1.3 — Sets que tienen cartas importadas (API_CONTRACT §6 `GET /buylist/sets`), para
   * poblar el dropdown del cotizador. A diferencia de `listSets` (solo sets con inventario
   * publicado), aquí aparecen TODOS los sets del catálogo con al menos una carta. `year`
   * derivado de `releaseDate`.
   *
   * Orden (fix del dropdown «Filtrar por set»): `releaseDate` COMPLETA descendente (no solo
   * el año — dos sets del mismo año quedan por fecha exacta), desempate por `name` asc, y
   * los sets SIN `releaseDate` al final (también por nombre), en vez de mezclados como si
   * fueran los más antiguos.
   */
  async listSetsWithImportedCards() {
    const sets = await this.prisma.cardSet.findMany({
      where: { cards: { some: {} } },
      select: { id: true, name: true, series: true, releaseDate: true },
    });
    // `releaseDate` viene de pokemontcg.io como `yyyy/MM/dd`, por lo que la comparación
    // lexicográfica de strings equivale a la cronológica con la fecha completa.
    const byName = (a: { name: string }, b: { name: string }) =>
      a.name.localeCompare(b.name, 'en', { sensitivity: 'base', numeric: true });
    const data = sets
      .map((s) => ({
        id: s.id,
        name: s.name,
        series: s.series ?? null,
        releaseDate: s.releaseDate ?? null,
        year: yearFromReleaseDate(s.releaseDate),
      }))
      .sort((a, b) => {
        if (a.releaseDate && b.releaseDate) {
          if (a.releaseDate !== b.releaseDate) return a.releaseDate < b.releaseDate ? 1 : -1;
          return byName(a, b);
        }
        if (a.releaseDate) return -1; // b sin fecha → al final
        if (b.releaseDate) return 1; // a sin fecha → al final
        return byName(a, b);
      });
    return { data };
  }

  /** Sets con inventario publicado y comprable, con `year` derivado, ordenados por año desc. v1.1. */
  async listSets() {
    const rows = await this.fetchSellable(this.publishedWhere());
    const setMap = new Map<
      string,
      { id: string; externalId: string; name: string; series: string | null; releaseDate: string | null; year: number | null }
    >();
    for (const { item } of rows) {
      const s = item.card.set;
      if (s && !setMap.has(s.id)) {
        setMap.set(s.id, {
          id: s.id,
          externalId: s.externalId,
          name: s.name,
          series: s.series ?? null,
          releaseDate: s.releaseDate ?? null,
          year: yearFromReleaseDate(s.releaseDate),
        });
      }
    }
    // v1.33 (P-27, §4.31d): pliega el subset en su principal (Celebrations una vez) + `partSetIds?`.
    const folded = await this.foldStorefrontSets([...setMap.values()]);
    const data = folded
      .map((s) => ({
        id: s.id,
        name: s.name,
        series: s.series,
        releaseDate: s.releaseDate,
        year: s.year,
        ...(s.partSetIds ? { partSetIds: s.partSetIds } : {}),
      }))
      .sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
    return { data };
  }
}
