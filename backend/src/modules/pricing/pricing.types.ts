import { Card, CardSet, Finish, PriceSource, ProductType } from '@prisma/client';
import { orderFinishes } from '../../common/card-order';

// v1.19-sealed-tcgcsv: += 'tcgcsv' (fuente de la referencia de mercado del SELLADO, M-23).
export type PriceSourceStr = 'pokemontcg_io' | 'pokemonpricetracker' | 'poketrace' | 'manual' | 'tcgcsv';

/**
 * v1.6-finish — mapeo Finish → llave de `tcgplayer.prices` (inverso de ARCHITECTURE §3.7).
 * El provider lee `prices[llave].market` de ESE acabado (deja de tomar el primero disponible).
 */
export const FINISH_TO_TCG_KEY: Record<Finish, string> = {
  normal: 'normal',
  reverse_holo: 'reverseHolofoil',
  holofoil: 'holofoil',
  first_edition_holofoil: '1stEditionHolofoil',
};

/**
 * v1.6-finish — mapeo llave de `tcgplayer.prices` → Finish (ARCHITECTURE §3.7). Las llaves
 * no listadas (`1stEditionNormal`, `unlimitedHolofoil`, …) se ignoran al derivar availableFinishes.
 */
export const TCG_KEY_TO_FINISH: Record<string, Finish> = {
  normal: 'normal',
  reverseHolofoil: 'reverse_holo',
  holofoil: 'holofoil',
  '1stEditionHolofoil': 'first_edition_holofoil',
};

/**
 * Llaves de `cardmarket.prices` que denotan la existencia de una impresión REVERSE HOLO.
 * ⚠️ ASIMETRÍA DELIBERADA con `tcgplayer.prices` (ARCHITECTURE §4.22a-3): Cardmarket emite estas
 * llaves SIEMPRE (con `0`/`null` cuando la impresión no existe) ⇒ aquí la llave NO es señal, **el
 * valor sí**. Tratarlas como las de TCGplayer inventaría un reverse holo en TODAS las cartas —
 * justo la «casilla de relleno» que el PO prohíbe.
 */
export const CARDMARKET_REVERSE_HOLO_KEYS = [
  'reverseHoloSell',
  'reverseHoloLow',
  'reverseHoloTrend',
  'reverseHoloAvg1',
  'reverseHoloAvg7',
  'reverseHoloAvg30',
] as const;

/** Payload remoto mínimo del que se derivan las variantes (subconjunto de `RemoteCard`). */
export interface FinishSignalSource {
  tcgplayer?: { prices?: Record<string, unknown> | null } | null;
  cardmarket?: { prices?: Record<string, unknown> | null } | null;
}

/**
 * v1.22-variantes-orden (ARCHITECTURE §3.7 / §4.22a-3) — deriva los acabados en que EXISTE la
 * carta a partir de DOS señales del MISMO payload que el sync ya descarga (cero requests extra):
 *
 *  - **Señal A — `tcgplayer.prices`:** cada LLAVE PRESENTE mapeable (§3.7) añade su `Finish`.
 *    **La presencia de la llave ES la señal**: `market` puede ser `null`/`0` y la variante SIGUE
 *    contando. Este es el cambio que arregla «tiene reverse holo pero no tiene precio de reverse
 *    holo». Llaves no mapeadas (`1stEditionNormal`, `unlimitedHolofoil`) se ignoran.
 *  - **Señal B — `cardmarket.prices.reverseHolo*`:** añade `reverse_holo` si ALGUNA de esas llaves
 *    trae un número FINITO > 0 (ver `CARDMARKET_REVERSE_HOLO_KEYS`).
 *
 * @returns `union(A, B)` en orden canónico `FINISH_ORDER`, o **`null`** si NINGUNA de las dos
 * señales existe. `null` ≠ `['normal']`: significa «el payload no dice nada de acabados» y el
 * llamador debe CONSERVAR lo que ya sabía (§4.22a-4), nunca clobbear a `['normal']`.
 *
 * ❌ PROHIBIDO derivar acabados de la existencia de un PRECIO (`PriceReference`, `market > 0`,
 * respuesta del proveedor de paga): precio ausente ≠ variante inexistente. Ese fue el bug de tres
 * rondas (VAR-1, §9). ❌ Prohibida cualquier heurística por rareza.
 */
export function deriveAvailableFinishes(remote: FinishSignalSource | null | undefined): Finish[] | null {
  const found = new Set<Finish>();

  // Señal A — la LLAVE presente de tcgplayer.prices es la señal (con o sin `market`).
  const tcgPrices = remote?.tcgplayer?.prices;
  if (tcgPrices && typeof tcgPrices === 'object') {
    for (const key of Object.keys(tcgPrices)) {
      const finish = TCG_KEY_TO_FINISH[key];
      if (finish) found.add(finish);
    }
  }

  // Señal B — en cardmarket la señal es el VALOR (> 0), no la llave (asimetría deliberada).
  const cmPrices = remote?.cardmarket?.prices;
  if (cmPrices && typeof cmPrices === 'object') {
    for (const key of CARDMARKET_REVERSE_HOLO_KEYS) {
      const raw = (cmPrices as Record<string, unknown>)[key];
      if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
        found.add('reverse_holo');
        break;
      }
    }
  }

  if (found.size === 0) return null;
  return orderFinishes(found);
}

export interface PriceQuote {
  /** Precio en USD centavos (si la fuente da USD) o null. */
  priceUsdCents?: number | null;
  /** Precio en MXN centavos (si la fuente ya da MXN). */
  priceMxnCents?: number | null;
  source: PriceSourceStr;
}

export interface PricingProviderInput {
  card: Card;
  productType: ProductType;
  gradeKey: string;
  /** v1.6-finish: acabado pedido; el provider lee el market de ESE acabado. */
  finish: Finish;
}

// ============================================================================
// v1.26 (P-7 ⑤, ARCHITECTURE §4.24e) — fetch FRESCO puntual por carta (on-demand).
// Los `BulkPriceProvider` de arriba solo hacen barrido POR SET; P-7 necesita traer
// el precio FRESCO de un puñado de cartas específicas (publicar + repreciar desde
// el Master Set), acotado por la CUOTA DIARIA del proveedor de paga (nunca un barrido).
// ============================================================================

/**
 * Carta a repreciar FRESCA. `tcgplayerId` (poblado en ①, `Card.tcgplayerId`) es el ancla del lookup
 * puntual del proveedor de paga (PPT). `externalId` (pokemontcg.io) es el ancla del FALLBACK. Las
 * `finishes` son los acabados a refrescar (universo de la carta o el subconjunto que pide el llamador).
 */
export interface FreshCardRef {
  /** `Card.id` LOCAL — clave para el upsert de `PriceReference` (persistMarketReference). */
  cardId: string;
  /** `Card.tcgplayerId` (①) — ancla del lookup puntual PPT; `null` ⇒ el primario no puede pedirla. */
  tcgplayerId: string | null;
  /** `Card.externalId` (pokemontcg.io) — ancla del fetch de FALLBACK. */
  externalId: string;
  /** Acabados a refrescar (>=1). Cada uno produce a lo sumo una fila `market>0`. */
  finishes: Finish[];
}

/**
 * Fila FRESCA por (carta, acabado). El adapter YA validó money-safe: `marketCents` entero > 0 y
 * `finish` mapeado a nuestro enum. El llamador la persiste con `persistMarketReference`.
 */
export interface FreshCardPriceRow {
  cardId: string;
  finish: Finish;
  /** entero de centavos, > 0 (validado por el adapter). */
  marketCents: number;
  /** moneda de ORIGEN (USD → FX+colchón; MXN → sin conversión). */
  currency: 'USD' | 'MXN';
  source: PriceSourceStr;
}

export interface FreshCardPriceResult {
  /** Filas VÁLIDAS por (carta, acabado). Vacío ⇒ nada fresco (el llamador cae a la ref almacenada). */
  rows: FreshCardPriceRow[];
  /** ¿Al menos una petición respondió OK? `false` ante fallo total (money-safe: no borrar precios). */
  requestOk: boolean;
  /** El proveedor de PAGA agotó su CUOTA DIARIA (429 daily) → PARADA; el resto se queda pending. */
  dailyLimited: boolean;
}

/**
 * FreshCardPriceProvider — fetch FRESCO puntual por carta (P-7 ⑤). SEPARADO del `BulkPriceProvider`
 * (barrido por set) y del `PricingProvider` per-carta (bóveda). Implementado por el proveedor de PAGA
 * (PPT, PRIMARIO, keyeado por `tcgplayerId`, respeta la cuota diaria) y por pokemontcg.io (FALLBACK,
 * keyeado por `externalId`). Money-safe: NUNCA inventa un precio; una carta sin market válido NO
 * produce fila (se queda pending). El upsert de `PriceReference` lo hace `PricingService.refreshCardPrices`.
 */
export interface FreshCardPriceProvider {
  readonly source: PriceSourceStr;
  fetchFreshForCards(cards: FreshCardRef[]): Promise<FreshCardPriceResult>;
}

/**
 * PricingProvider — Interfaz intercambiable. ARCHITECTURE §4.1.
 * fetchPrice devuelve el precio (USD o MXN) o null si la fuente no lo tiene.
 */
export interface PricingProvider {
  readonly source: PriceSourceStr;
  supports(productType: ProductType): boolean;
  fetchPrice(input: PricingProviderInput): Promise<PriceQuote | null>;
}

// ============================================================================
// WS-A (v1.14-price-ingest, ARCHITECTURE §4.15b) — Interfaz de INGESTA MASIVA.
// Distinta del `PricingProvider` per-carta de arriba (que se conserva para el
// refresco per-carta de bóveda y los stubs graded/sealed). NO colisiona con él.
// ============================================================================

/**
 * Fila NORMALIZADA por carta+acabado que devuelve un `BulkPriceProvider` (ARCHITECTURE §4.15b).
 * El adapter YA validó/omitió las entradas mal formadas (money-safe) antes de devolverla:
 * `marketCents` es un entero de centavos > 0 y `finish` YA está mapeado a nuestro enum canónico.
 * La resolución carta↔BD (externalId primario, (set,number) fallback) la hace el
 * `PriceIngestService` con estos campos identificadores (ARCHITECTURE §4.15c/§4.15d).
 */
export interface BulkPriceRow {
  /** id pokemontcg.io de la carta (mapeo PRIMARIO → `Card.externalId`, @unique). */
  externalId?: string | null;
  /** mapeo FALLBACK: `(setExternalId, number)` → `Card`. */
  setExternalId?: string | null;
  number?: string | null;
  /** YA mapeado a nuestro enum (normal|reverse_holo|holofoil|first_edition_holofoil). */
  finish: Finish;
  /** entero de centavos, > 0 (validado por el adapter). */
  marketCents: number;
  /** moneda de ORIGEN del market (defensivo; se verifica en la 1ª corrida, §4.15h). */
  currency: 'USD' | 'MXN';
  /**
   * v1.22-1 (§4.22g candado 2) — ¿el acabado se mapeó vía un ALIAS VERIFICADO
   * (`VERIFIED_FINISH_ALIASES`, espejo estricto de `TCG_KEY_TO_FINISH`) y NO uno SUPUESTO?
   * SOLO las filas con `finishAliasVerified === true` pueden alimentar `pricedFinishesSnapshot`
   * (Señal C) y por ende la lista blanca SEC-A1. El PRECIO se persiste igual con alias SUPUESTO
   * (dato inocuo); el flag distingue lo apto para la lista blanca de lo tolerado solo para el precio.
   */
  finishAliasVerified: boolean;
}

export interface BulkPriceResult {
  /** Filas VÁLIDAS por (carta, acabado). */
  rows: BulkPriceRow[];
  /** Entradas crudas recibidas del proveedor (observabilidad). */
  fetchedRaw: number;
  /** Entradas OMITIDAS por el mapeo defensivo del adapter (money-safe). */
  skipped: number;
  /**
   * v1.22-1 (§4.22g) — ¿la CORRIDA fue EXITOSA (al menos una página del proveedor respondió OK)?
   * Gobierna el REEMPLAZO money-safe de `pricedFinishesSnapshot`: solo se tocan snapshots si
   * `requestOk && rows.length > 0`. Ante fallo total (ninguna página OK), 0 filas o modo
   * sample-only, NO se toca ningún snapshot (mismo criterio con que hoy no se borran precios ante
   * un fallo transitorio). Opcional por compat con stubs previos: `undefined` se trata como fallo.
   */
  requestOk?: boolean;
  /**
   * WS-A fix-ppt (2026-08-19) — el proveedor de PAGA agotó su cuota DIARIA (429 `limitType:daily`).
   * Es la señal de PARADA: el orquestador debe DETENER el barrido (no reintentar hasta 00:00 UTC) y
   * reportar los sets pendientes. Independiente de `requestOk` (puede haber traído filas de páginas
   * previas antes de toparse con el límite). `undefined`/`false` = la cuota diaria no se agotó.
   */
  dailyLimited?: boolean;
  /**
   * WS-A fix-ppt (N-11) — presupuesto diario vivo restante (`X-RateLimit-Daily-Remaining` de la
   * última respuesta), para la barra de progreso del sync. `null`/`undefined` = el proveedor no lo
   * reportó o no aplica (proveedor legacy).
   */
  dailyRemaining?: number | null;
}

/**
 * BulkPriceProvider — proveedor de descarga MASIVA de precios por SET (ARCHITECTURE §4.15b).
 * El adapter mapea el payload crudo → `BulkPriceRow[]` DEFENSIVAMENTE (valida y OMITE entradas
 * mal formadas ANTES de devolver: nunca NaN/negativo/cero/acabado desconocido).
 */
export interface BulkPriceProvider {
  readonly source: PriceSource;
  fetchPricesForSet(input: BulkFetchInput): Promise<BulkPriceResult>;
}

/**
 * Entrada de `fetchPricesForSet`. `set` es lo único obligatorio (compat con el legacy). Los demás
 * campos los rellena el `PriceIngestService` SOLO para el proveedor de paga (PokemonPriceTracker);
 * el proveedor legacy (pokemontcg_io) los IGNORA.
 */
export interface BulkFetchInput {
  set: CardSet;
  /**
   * WS-A fix-ppt — `setId` REAL de PokemonPriceTracker (GroupId/slug), resuelto por `PptSetMapper` y
   * cacheado en `CardSet.pptSetId`. PPT lo usa como `setId`; JAMÁS el `externalId` de pokemontcg.io
   * (esa era la causa raíz del "0 entradas"). `null`/ausente en un set SIN mapeo → PPT no pide nada.
   */
  providerSetId?: string | null;
  /**
   * WS-A fix-ppt — scope PARCIAL (set < 2020): filtro `minPrice` de la API (en la unidad del
   * proveedor) para NO traer el bulk de comunes a nivel de origen. Ausente = sin filtro de precio.
   */
  minPrice?: string | null;
  /**
   * WS-A fix-ppt — traer las VARIANTES por impresión (Normal / Reverse Holofoil / Holofoil) con un
   * request por impresión (`printing=…`), para poblar reverse holo. Cuesta ≈2-3× por set → solo se
   * activa por dial. Ausente/false = un solo barrido usando `prices.primaryPrinting`.
   */
  fetchPrintings?: boolean;
}

/**
 * WS-A (§4.15d) — Normaliza una variante/acabado CRUDO del proveedor de paga a nuestro enum
 * `Finish`, o `null` si es DESCONOCIDA (money-safe: NUNCA se atribuye un precio holo a `normal`;
 * variante desconocida → se OMITE la fila). La normalización quita mayúsculas y todo lo no
 * alfanumérico, para tolerar `"Reverse Holo"`, `"reverse_holo"`, `"reverseHolofoil"`, etc.
 *
 * SUPUESTO (a verificar en la 1ª corrida en Railway, §4.15h): estas son las llaves reales de
 * `tcgplayer.prices` (mirror de TCG_KEY_TO_FINISH) MÁS alias probables del proveedor de paga. El
 * `1st Edition` NORMAL (sin holo) NO tiene enum propio y se OMITE (conservador). Si la 1ª corrida
 * revela otros nombres de variante, se AMPLÍA este mapa (no se relaja a "desconocido → normal").
 */
const BULK_VARIANT_TO_FINISH: Record<string, Finish> = {
  // Llaves reales de tcgplayer.prices (mirror de TCG_KEY_TO_FINISH):
  normal: 'normal',
  holofoil: 'holofoil',
  reverseholofoil: 'reverse_holo',
  '1steditionholofoil': 'first_edition_holofoil',
  // Alias legibles / probables del proveedor de paga (SUPUESTO — verificar 1ª corrida):
  holo: 'holofoil',
  foil: 'holofoil',
  reverse: 'reverse_holo',
  reverseholo: 'reverse_holo',
  firsteditionholofoil: 'first_edition_holofoil',
  '1steditionholo': 'first_edition_holofoil',
  firsteditionholo: 'first_edition_holofoil',
};

/** Normaliza el nombre de variante crudo (quita mayúsculas y no-alfanuméricos). */
export function normalizeFinishAlias(raw: unknown): Finish | null {
  if (typeof raw !== 'string') return null;
  const key = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  return BULK_VARIANT_TO_FINISH[key] ?? null;
}

/**
 * v1.22-1 (ARCHITECTURE §4.22g, candado 2) — ESPEJO ESTRICTO de `TCG_KEY_TO_FINISH` (las llaves
 * REALES de `tcgplayer.prices`), SIN los alias marcados SUPUESTO de `BULK_VARIANT_TO_FINISH`
 * (`foil`, `holo`, `reverse`, `reverseholo`, `firsteditionholo…`). Las llaves están normalizadas
 * igual que `normalizeFinishAlias` (minúsculas, sin no-alfanuméricos) para tolerar
 * `"Reverse Holo"`, `"reverseHolofoil"`, `"reverse_holofoil"`, etc.
 *
 * SOLO estos alias VERIFICADOS pueden alimentar `pricedFinishesSnapshot` (Señal C) y por tanto la
 * lista blanca SEC-A1 `Card.availableFinishes`. Un `foil` SUPUESTO mal mapeado NO grabará un
 * `holofoil` inexistente permanente en la lista blanca (candado anti-invención). Cuando la 1ª
 * corrida CONFIRME un alias SUPUESTO (S-C2), se PROMUEVE aquí; hasta entonces solo alimenta el
 * precio (`PriceReference`), nunca la lista blanca.
 */
export const VERIFIED_FINISH_ALIASES: Record<string, Finish> = {
  normal: 'normal',
  holofoil: 'holofoil',
  reverseholofoil: 'reverse_holo',
  '1steditionholofoil': 'first_edition_holofoil',
};

/**
 * v1.22-1 (§4.22g candado 2/3) — Normaliza un `printing`/variante CRUDO del proveedor SOLO si es un
 * ALIAS VERIFICADO; devuelve `null` para cualquier alias SUPUESTO o desconocido (anti-invención:
 * NUNCA se atribuye a `normal`, jamás pinta una casilla de relleno). Es MÁS estricto que
 * `normalizeFinishAlias` (que sigue tolerante para el PRECIO). El llamador fija
 * `finishAliasVerified = normalizeVerifiedFinishAlias(raw) !== null`.
 */
export function normalizeVerifiedFinishAlias(raw: unknown): Finish | null {
  if (typeof raw !== 'string') return null;
  const key = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  return VERIFIED_FINISH_ALIASES[key] ?? null;
}

/**
 * v1.26 (ARCHITECTURE §4.24a, paso 4) — mapeo ESTRICTO del `subTypeName` de TCGCSV → `Finish`, la
 * fuente ESTRUCTURAL autoritativa (espejo de TCGplayer). Llaves normalizadas (minúsculas, sin
 * no-alfanuméricos) para tolerar `"Reverse Holofoil"`/`"reverse holofoil"`. Es la ÚNICA vía por la
 * que un `subTypeName` alimenta `Card.structuralFinishes`; un valor DESCONOCIDO/no mapeable devuelve
 * `null` ⇒ se OMITE (candado anti-invención §4.24a: JAMÁS se atribuye a `normal`, nunca una casilla
 * de relleno). NO depende de `marketPrice`: la ESTRUCTURA es la presencia de la fila, no su precio.
 */
export const TCGCSV_SUBTYPE_TO_FINISH: Record<string, Finish> = {
  normal: 'normal',
  holofoil: 'holofoil',
  reverseholofoil: 'reverse_holo',
  '1steditionholofoil': 'first_edition_holofoil',
};

/**
 * v1.26 (§4.24a, paso 4) — Normaliza UN `subTypeName` crudo de TCGCSV a su `Finish`, o `null` si es
 * desconocido/no mapeable (se OMITE; nunca se inventa). Estructura ≠ precio: NO mira `marketPrice`.
 */
export function tcgcsvSubTypeToFinish(subTypeName: unknown): Finish | null {
  if (typeof subTypeName !== 'string') return null;
  const key = subTypeName.toLowerCase().replace(/[^a-z0-9]/g, '');
  return TCGCSV_SUBTYPE_TO_FINISH[key] ?? null;
}

/**
 * v1.26 (§4.24a, paso 4) — deriva `structuralFinishes` de UNA carta a partir de los `subTypeName`
 * que TCGCSV reportó para ella (unidos por número de carta, ver resolver). Mapea cada uno con
 * `tcgcsvSubTypeToFinish` (OMITE los desconocidos), deduplica y devuelve en orden canónico
 * `FINISH_ORDER`. NUNCA inventa un acabado ni añade `normal` de relleno; un `subTypeName` con
 * `marketPrice: null` SIGUE contando (estructura ≠ precio). Puede devolver `[]` (todos desconocidos)
 * ⇒ el llamador NO escribe (conserva el valor previo; money-safe).
 */
export function deriveStructuralFinishes(subTypeNames: Iterable<unknown>): Finish[] {
  const found = new Set<Finish>();
  for (const raw of subTypeNames) {
    const finish = tcgcsvSubTypeToFinish(raw);
    if (finish) found.add(finish);
  }
  return orderFinishes(found);
}

/**
 * P-6 (2026-08-18) — VARIANTES de formato del número de carta, para el fallback `(set, number)`
 * de `PriceIngestService.resolveCardId`. `Card.number` viene de pokemontcg.io (`"104"`, `"TG01"`,
 * `"SV107"`), pero el proveedor de paga publica `cardNumber` y puede darlo con el total del set
 * (`"104/159"`) o con ceros a la izquierda (`"004"`). Se devuelven las formas EQUIVALENTES del
 * mismo número, SIN el valor exacto (que el llamador ya probó) y sin inventar cartas nuevas:
 *
 *   "104/159" → ["104"]      (se corta el total del set)
 *   "004"     → ["4", "04"]  (nuestro catálogo pudo guardarlo sin relleno)
 *   "4"       → ["04", "004"] (o con relleno)
 *
 * Money-safe: es solo un conjunto de CANDIDATOS; el llamador exige coincidencia ÚNICA dentro del
 * set antes de atribuir un precio (si dos cartas casan, se omite en vez de adivinar).
 */
export function cardNumberVariants(raw: string): string[] {
  const exact = raw.trim();
  if (exact === '') return [];
  const out = new Set<string>();
  const seeds = new Set<string>([exact]);

  // `"104/159"` → `"104"` (el proveedor anexa el total del set).
  const slash = exact.indexOf('/');
  if (slash > 0) seeds.add(exact.slice(0, slash).trim());

  for (const seed of seeds) {
    out.add(seed);
    // Solo se juega con el relleno de ceros en números PUROS (`"004"`), nunca en `"TG01"`/`"SV107"`.
    if (!/^\d+$/.test(seed)) continue;
    const bare = String(Number(seed));
    out.add(bare);
    if (bare.length <= 2) out.add(bare.padStart(2, '0'));
    if (bare.length <= 3) out.add(bare.padStart(3, '0'));
  }

  out.delete(exact);
  return [...out];
}

// ============================================================================
// v1.19-sealed-tcgcsv (ARCHITECTURE §4.19b) — Interfaz de INGESTA del SELLADO.
// SEPARADA del `BulkPriceProvider` de cartas: el sellado se keyea por
// `tcgplayerProductId` (M-23) y no tiene Card remota que resolver (forzar la
// interfaz de cartas obligaría a campos sin sentido: finish, externalId).
// ============================================================================

/** Grupo TCGCSV (≈ set/expansión) para el explorador de curación M2. */
export interface TcgcsvGroupRef {
  groupId: number;
  name: string;
  abbreviation?: string;
  publishedOn?: string;
}

/** Producto SELLADO de un grupo TCGCSV para el explorador de curación M2. */
export interface TcgcsvProductRef {
  productId: number;
  name: string;
  cleanName?: string;
  imageUrl?: string;
}

/**
 * v1.26 (§4.24a) — Producto de CARTA (single) de un grupo TCGCSV para el resolver estructural.
 * `number` = `extendedData.Number` (p. ej. `"057/191"`) o `null` si el producto no lo trae (sellado
 * u otro). El resolver une `subTypeName` por ESTE número de carta, robusto a que una carta se
 * represente como varias filas bajo un `productId` O como `productId`s separados por impresión.
 */
export interface TcgcsvSingleProductRef {
  productId: number;
  name: string;
  number: string | null;
}

/**
 * v1.26 (§4.24a) — Fila de PRECIO cruda de TCGCSV que aporta ESTRUCTURA vía su `subTypeName`. El
 * `marketPrice` puede ser `null` (estructura ≠ precio); el resolver NO lo usa para decidir estructura.
 */
export interface TcgcsvPriceRow {
  productId: number;
  subTypeName: string | null;
  marketPrice: number | null;
}

/**
 * Fila NORMALIZADA por producto sellado que devuelve el `SealedBulkPriceProvider`.
 * El adapter YA validó/omitió (money-safe): `subTypeName !== 'Normal'` u market
 * inválido (ausente/NaN/<=0, incluso tras el fallback mid) → la fila NO existe.
 */
export interface SealedPriceRow {
  /** productId de TCGplayer/TCGCSV (clave del mapeo M-23). */
  tcgplayerProductId: number;
  /** entero de centavos USD, > 0 (validado por el adapter). */
  marketCents: number;
  /** Observabilidad: true si el precio salió de midPrice (fallback marketPrice→midPrice, §4.19d). */
  usedFallbackMid: boolean;
  /** TCGCSV publica SIEMPRE USD (precios TCGplayer) → el ingest aplica FX+colchón. */
  currency: 'USD';
}

export interface SealedBulkPriceResult {
  /** Filas VÁLIDAS por producto (sub-tipo base 'Normal'). */
  rows: SealedPriceRow[];
  /** Entradas crudas recibidas del remoto (observabilidad). */
  fetchedRaw: number;
  /** Entradas OMITIDAS por el mapeo defensivo del adapter (money-safe). */
  skipped: number;
}

/**
 * SealedBulkPriceProvider — proveedor de la referencia de mercado del SELLADO
 * (ARCHITECTURE §4.19b). `listGroups`/`listSealedProducts` sirven al explorador
 * de curación M2 (proxy read-only); `fetchSealedPricesForGroup` al ingest.
 */
export interface SealedBulkPriceProvider {
  readonly source: PriceSource; // 'tcgcsv' (M-23)
  listGroups(): Promise<TcgcsvGroupRef[]>;
  listSealedProducts(groupId: number): Promise<TcgcsvProductRef[]>;
  fetchSealedPricesForGroup(groupId: number): Promise<SealedBulkPriceResult>;
}

/**
 * v1.19-sealed-tcgcsv (§4.19d) — gradeKey del sellado de MERCADO: `sealed:tcg:<productId>`.
 * Motivo: el legacy `buildGradeKey → 'sealed'` colisionaría en el unique de PriceReference
 * cuando DOS productos sellados distintos (ETB y booster box del mismo set) están anclados a
 * la MISMA Card. `buildGradeKey` NO cambia: `'sealed'` sigue siendo el gradeKey del override
 * MANUAL del admin y del costo de aportación (flujos intactos).
 */
export function sealedMarketGradeKey(tcgplayerProductId: number): string {
  return `sealed:tcg:${tcgplayerProductId}`;
}

/** Normaliza el gradeKey usado en PriceReference (ARCHITECTURE §3.2). */
export function buildGradeKey(input: {
  productType: ProductType;
  rawCondition?: string | null;
  gradingCompany?: string | null;
  gradeValue?: string | null;
}): string {
  switch (input.productType) {
    case 'raw':
      return `raw:${input.rawCondition ?? 'NM'}`;
    case 'graded':
      return `graded:${input.gradingCompany ?? 'PSA'}:${input.gradeValue ?? '10'}`;
    case 'sealed':
      return 'sealed';
    default:
      return 'unknown';
  }
}
