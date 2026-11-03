import { CardLanguage, Finish, StampType } from '@prisma/client';

/**
 * card-version.ts — v1.116⟨ids⟩ (API_CONTRACT §IDS.2/.3/.5, ARCHITECTURE §15) — la VERSIÓN de una pieza y sus funciones
 * puras: clave de versión, `FinishLabel`, clasificación del tipo de liga por grupo/sufijo y llave de empate con la carta base.
 *
 * Versión = (`language`, producto de liga o ninguno). La liga de una pieza es su `cardProductId` (el `Int` de TCGplayer de
 * M-46) cuando ese `CardProduct` es `stamped` (D-IDS-C): aquí llega ya resuelta como `StampRef`. Sin I/O: la usan el cuerpo
 * de venta, la tienda, la captura, el pedido y los Meta decks.
 */

/** El producto de liga de una versión, como lo resuelve quien lee `CardProduct` (`kind = stamped`). */
export interface StampRef {
  /** `CardProduct.tcgplayerProductId` (== `InventoryItem.cardProductId`). */
  productId: number;
  /** `CardProduct.id` (uuid interno; la llave de `PriceReference.cardProductId`). */
  internalId: string;
  type: StampType;
  label: string | null;
  finishes: Finish[];
}

export interface PieceVersion {
  language: CardLanguage;
  stamp: StampRef | null;
}

/** `StampDTO` del contrato (§IDS.5). */
export interface StampDTO {
  type: StampType;
  label: string | null;
  productId: number;
}

/** `VersionDTO` del contrato (§IDS.5). */
export interface VersionDTO {
  key: string;
  language: CardLanguage;
  stamp: StampDTO | null;
}

/**
 * El orden de los idiomas de una versión donde el servidor ordena (ficha `versions[]`, surtido de Meta decks, §IDS.5/.6):
 * `en` antes que `es`. Una tabla y no `=== 'en' ? 0 : 1` en cada sitio (TL-IDS-4): un idioma nuevo no compila hasta tener fila.
 */
export const LANGUAGE_ORDER: Readonly<Record<CardLanguage, number>> = Object.freeze({ en: 0, es: 1 });

/** La versión por defecto (inglés, sin liga): la de toda pieza y línea anterior a M-95 (I-1). */
export const DEFAULT_VERSION: PieceVersion = Object.freeze({ language: 'en', stamp: null }) as PieceVersion;

/** `true` ⇔ (inglés, sin liga): el único camino que conserva override M-30, bounty y referencia de hoy (§IDS.2). */
export function isDefaultVersion(v: { language: CardLanguage; stamp: unknown | null }): boolean {
  return v.language === 'en' && v.stamp == null;
}

/** `key` de §IDS.5: `en` | `es` | `en.<productId>` | `es.<productId>`. */
export function versionKeyOf(language: CardLanguage, stampProductId: number | null): string {
  return stampProductId == null ? language : `${language}.${stampProductId}`;
}

export function stampDtoOf(s: Pick<StampRef, 'type' | 'label' | 'productId'>): StampDTO {
  return { type: s.type, label: s.label, productId: s.productId };
}

export function versionDtoOf(v: { language: CardLanguage; stamp: Pick<StampRef, 'type' | 'label' | 'productId'> | null }): VersionDTO {
  return {
    key: versionKeyOf(v.language, v.stamp?.productId ?? null),
    language: v.language,
    stamp: v.stamp ? stampDtoOf(v.stamp) : null,
  };
}

/**
 * La versión de una pieza a partir de su `language`, su `cardProductId` y el mapa de productos `stamped` que leyó el
 * llamador (`tcgplayerProductId → StampRef`). Un `cardProductId` que no está en el mapa (set_base, promo, deck_exclusive)
 * no es versión de liga.
 */
export function pieceVersionOf(
  item: { language?: CardLanguage | null; cardProductId?: number | null },
  stamps: ReadonlyMap<number, StampRef>,
): PieceVersion {
  const language: CardLanguage = item.language ?? 'en';
  const stamp = item.cardProductId != null ? (stamps.get(item.cardProductId) ?? null) : null;
  return { language, stamp };
}

/**
 * `optionKey` de §IDS.5 (D-IDS-O): `version.key` sin liga; `version.key + '.' + finish` con liga (`es.703819.holofoil`).
 * ⛔ El navegador no lo compone: lo manda el servidor.
 */
export function optionKeyOf(versionKey: string, stamped: boolean, finish: Finish): string {
  return stamped ? `${versionKey}.${finish}` : versionKey;
}

/** `FinishLabel` (§IDS.5, D-IDS-N): el acabado como lo nombra el cliente. Clave cerrada; el texto es i18n de frontend. */
export type FinishLabel = 'non_holo' | 'holo' | 'reverse_holo' | 'first_edition_holo' | 'cosmos_holo';
export const FINISH_LABEL_VALUES: readonly FinishLabel[] = ['non_holo', 'holo', 'reverse_holo', 'first_edition_holo', 'cosmos_holo'];

const FINISH_LABEL_BY_FINISH: Record<Finish, FinishLabel> = {
  normal: 'non_holo',
  holofoil: 'holo',
  reverse_holo: 'reverse_holo',
  first_edition_holofoil: 'first_edition_holo',
};

/**
 * `finishLabelOf(finish, stampLabel)` (§IDS.5): `stampLabel` contiene «cosmos holo» (sin distinguir mayúsculas ni
 * espacios) ⇒ `cosmos_holo`; si no, el mapeo fijo por `finish`.
 */
export function finishLabelOf(finish: Finish, stampLabel: string | null | undefined): FinishLabel {
  if (stampLabel != null && stampLabel.toLowerCase().replace(/\s+/g, '').includes('cosmosholo')) return 'cosmos_holo';
  return FINISH_LABEL_BY_FINISH[finish];
}

// ─────────────────────────────── §IDS.3 — ingesta de productos de liga ───────────────────────────────

/**
 * Grupos TCGCSV de versiones de liga (§IDS.3). v1.116.2⟨ids⟩ (D-IDS-7): `22872`/`24451` (prerelease/Staff de SV/ME) quedan FUERA
 * de §IDS — no basta con añadirlos aquí (sus promos no están en el catálogo y chocan con productos `promo`); es diseño aparte.
 */
export const STAMPED_SOURCE_GROUPS: readonly number[] = [22880, 1539];
export const PRIZE_PACK_GROUP_ID = 22880;
export const LEAGUE_GROUP_ID = 1539;

/** Los segmentos `(…)` y `[…]` de un nombre de producto, en orden, sin los delimitadores. */
export function bracketSegments(name: string): string[] {
  const out: string[] = [];
  const re = /\(([^()]*)\)|\[([^[\]]*)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(name)) != null) {
    const seg = (m[1] ?? m[2] ?? '').trim();
    if (seg) out.push(seg);
  }
  return out;
}

const STAFF_RE = /\bstaff\b/i;
const PRERELEASE_RE = /\bpre-?release\b/i;
const CHAMPIONSHIP_RE = /\b(championships?|regionals?|international|world|worlds)\b/i;
const LEAGUE_RE = /\bleague\b/i;

/**
 * Tipo de un segmento de `1539` (o `null` si el segmento no dice tipo). Precedencia dentro de un segmento: campeonato antes
 * que liga («League & Championship» no aparece en un segmento; si apareciera, gana el que NO dice «De liga», D-6 v3).
 */
function segmentType(seg: string): StampType | null {
  if (STAFF_RE.test(seg)) return 'staff';
  if (PRERELEASE_RE.test(seg)) return 'prerelease';
  if (CHAMPIONSHIP_RE.test(seg)) return 'championship';
  if (LEAGUE_RE.test(seg)) return 'league';
  return null;
}

export interface StampClassification {
  type: StampType;
  /** El resto de paréntesis/corchetes que no es el tipo, unido con «, »; `null` si no queda nada. */
  label: string | null;
}

/**
 * `stampTypeOf(groupId, name)` (§IDS.3, D-IDS-F): `22880` ⇒ `prize_pack` (todo el grupo); `1539` por el sufijo, FALLANDO
 * CERRADO (sin sufijo reconocible ⇒ `null` ⇒ no se ofrece). `[Staff]` gana sobre el resto de segmentos (es otro producto
 * físico: «(Prerelease) [Staff]» es Staff); después prerelease, campeonato y liga. Cualquier otro grupo ⇒ `null`.
 */
export function stampTypeOf(groupId: number, name: string): StampClassification | null {
  const segs = bracketSegments(name);
  if (groupId === PRIZE_PACK_GROUP_ID) {
    return { type: 'prize_pack', label: segs.length > 0 ? segs.join(', ') : null };
  }
  if (groupId !== LEAGUE_GROUP_ID) return null;
  const typed = segs.map((s) => ({ s, t: segmentType(s) }));
  const order: StampType[] = ['staff', 'prerelease', 'championship', 'league'];
  for (const t of order) {
    const hit = typed.find((x) => x.t === t);
    if (hit) {
      const rest = typed.filter((x) => x !== hit).map((x) => x.s);
      return { type: t, label: rest.length > 0 ? rest.join(', ') : null };
    }
  }
  return null;
}

/** Normaliza un texto para el empate: sin acentos, minúsculas, solo alfanuméricos y un espacio entre palabras. */
export function normalizeMatchText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Normaliza un `Number` completo de TCGplayer: cada parte separada por `/` en mayúsculas y sin ceros a la izquierda si es
 * numérica (`057/191` ⇒ `57/191`; `TG12/TG30` ⇒ `TG12/TG30`; `SWSH149` ⇒ `SWSH149`).
 */
export function normalizeFullNumber(raw: string): string {
  return raw
    .split('/')
    .map((p) => p.trim().toUpperCase())
    .map((p) => (/^\d+$/.test(p) ? String(parseInt(p, 10)) : p))
    .join('/');
}

const NUM_TOKEN = String.raw`[A-Za-z]{0,6}\d+[A-Za-z]?`;
/** Número completo al FINAL del nombre, con o sin guion («Pikachu ex - 057/191», «Shelmet 11/101»). */
const TRAILING_FULL_NUMBER = new RegExp(String.raw`\s*-?\s*(${NUM_TOKEN}\s*/\s*${NUM_TOKEN})\s*$`);
/** Número de promo al final, solo con guion («Quaquaval - 005», «Pikachu - XY202»). */
const TRAILING_PROMO_NUMBER = new RegExp(String.raw`\s+-\s*(${NUM_TOKEN})\s*$`);
const stripBrackets = (name: string) => name.replace(/\([^()]*\)|\[[^[\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * El nombre de un producto sin `(…)`/`[…]` y sin el número que TCGplayer mete al final del nombre (con o sin guion; medido
 * por devops en IDS-D1, `DEVOPS_NOTES §108.4` punto 4, misma lectura que `scripts/ids/ids-lib.mjs` `baseName`).
 */
export function baseProductName(name: string): string {
  return stripBrackets(name).replace(TRAILING_FULL_NUMBER, ' ').replace(TRAILING_PROMO_NUMBER, ' ').replace(/\s+-\s*$/, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * El número COMPLETO («057/191», con o sin guion delante) al final del nombre de un producto TCGplayer, o `null`. v1.116.2⟨ids⟩
 * (§IDS.3): solo con total — un número sin total («- 010») no se lee del nombre (nunca se empata por número sin total).
 */
export function numberFromProductName(name: string): string | null {
  const m = TRAILING_FULL_NUMBER.exec(stripBrackets(name));
  return m ? m[1].replace(/\s+/g, '') : null;
}

/**
 * `baseMatchKey` (§IDS.3): `normalizar(nombre sin «(…)»/«[…]») | normalizar(Number completo)`. `null` sin número (sobres,
 * Code Cards, energías sin número): no se cuelgan.
 */
export function baseMatchKey(name: string, fullNumber: string | null | undefined): string | null {
  if (fullNumber == null || fullNumber.trim() === '') return null;
  const n = normalizeMatchText(baseProductName(name));
  if (n === '') return null;
  return `${n}|${normalizeFullNumber(fullNumber)}`;
}

/**
 * La `baseMatchKey` de NUESTRO lado (un `CardProduct` `set_base|other` del catálogo), v1.116.2⟨ids⟩ (§IDS.3): el número del NOMBRE
 * del producto solo si trae total («Pikachu ex - 057/191»); si no, `Card.number` + `/` + `CardSet.printedTotal`. Sin ninguno ⇒
 * `null`: ⛔ nunca se empata por un número sin total.
 */
export function catalogMatchKey(p: { name: string; cardNumber: string | null; printedTotal: number | null }): string | null {
  const fromName = numberFromProductName(p.name);
  if (fromName) return baseMatchKey(p.name, fromName);
  if (p.cardNumber && p.printedTotal != null && p.printedTotal > 0) {
    return baseMatchKey(p.name, `${p.cardNumber}/${p.printedTotal}`);
  }
  return null;
}

/** ×X de §IDS.2: entero half-up `⌊(R·X + 50) / 100⌋`. */
export function scaleByPct(cents: number, pct: number): number {
  return Math.floor((cents * pct + 50) / 100);
}

/** Validador del dial `spanish_market_pct` (§IDS.7): entero en `[1, 200]`. */
export function validateSpanishMarketPct(v: unknown): string | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 200 ? null : 'must be an integer in [1, 200] (percent of the English market)';
}

/**
 * v1.116⟨ids⟩ (§IDS.5) — la versión y el `finishLabel` de una LÍNEA DE PEDIDO, leídos de lo CONGELADO en `OrderItem`
 * (`language`, `stampType`, `stampLabel`, `finish`; D-IDS-J), nunca de la pieza. El `productId` de la liga no se congela
 * (M-95 no lo pide): se toma de la identidad de la pieza (`InventoryItem.cardProductId`), que no es precio.
 */
export function orderLineVersionOf(
  oi: { language?: CardLanguage | null; stampType?: StampType | null; stampLabel?: string | null; finish?: Finish | null },
  stampProductId: number | null | undefined,
  fallbackFinish: Finish = 'normal',
): { version: VersionDTO; finishLabel: FinishLabel } {
  const language: CardLanguage = oi.language ?? 'en';
  const stamp =
    oi.stampType != null && stampProductId != null ? { type: oi.stampType, label: oi.stampLabel ?? null, productId: stampProductId } : null;
  return {
    version: { key: versionKeyOf(language, stamp?.productId ?? null), language, stamp },
    finishLabel: finishLabelOf(oi.finish ?? fallbackFinish, oi.stampType != null ? (oi.stampLabel ?? null) : null),
  };
}

/** Lo que el checkout CONGELA de la versión en `OrderItem` (§IDS.1, D-IDS-J). */
export function frozenVersionColumnsOf(v: PieceVersion): { language: CardLanguage; stampType: StampType | null; stampLabel: string | null } {
  return { language: v.language, stampType: v.stamp?.type ?? null, stampLabel: v.stamp?.label ?? null };
}

/**
 * v1.116⟨ids⟩ (§IDS.5): el tipo de liga en la línea interna de preparación. Fuente única de los 5 textos: DESIGN_SYSTEM IDS-UX.3
 * «Cajón» (TL-IDS-2, petición 7 de ux-ui), formato `GRUPO · Nombre — sello X` (el `IDIOMA · ` y el `, detalle` los pone
 * `versionInternalLineOf`): nombra el logo físico que el operador busca en la carta. Candado: `ids-card-version.spec.ts`
 * (`it.each` sobre los 5 `StampType`, tabla literal del documento).
 */
const INTERNAL_STAMP_TEXT: Record<StampType, string> = {
  prize_pack: 'LIGA · Prize Pack — sello Play! Pokémon',
  league: 'LIGA · Promo de Liga — sello de la Liga',
  championship: 'TORNEO · Campeonato — sello de Campeonato',
  prerelease: 'EVENTO · Promo de Prerelease — sello Prerelease',
  staff: 'EVENTO · Promo Staff — sello Staff',
};

/**
 * v1.116⟨ids⟩ (API_CONTRACT §IDS.5 «Pedidos por preparar»): `versionInternalLine`, texto de backend de una sola lengua para la
 * hoja, de lo CONGELADO en `OrderItem`: «ES · LIGA · Prize Pack — sello Play! Pokémon, Cosmos Holo». `null` en inglés sin liga.
 */
export function versionInternalLineOf(v: { language: CardLanguage; stampType: StampType | null; stampLabel: string | null }): string | null {
  if (v.language === 'en' && v.stampType == null) return null;
  const parts = [v.language.toUpperCase()];
  if (v.stampType) parts.push(INTERNAL_STAMP_TEXT[v.stampType] + (v.stampLabel ? `, ${v.stampLabel}` : ''));
  return parts.join(' · ');
}
