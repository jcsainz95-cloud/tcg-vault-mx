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

/** Grupos TCGCSV de versiones de liga (§IDS.3). `22872`/`24451` entran solo tras IDS-D2 (cambiar esta constante). */
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

/** El número («057/191» con o sin guion; si no, el de promo/energía « - 005») al final del nombre de un producto TCGplayer, o `null`. */
export function numberFromProductName(name: string): string | null {
  const stripped = stripBrackets(name);
  const m = TRAILING_FULL_NUMBER.exec(stripped) ?? TRAILING_PROMO_NUMBER.exec(stripped);
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
 * La `baseMatchKey` de NUESTRO lado (un `CardProduct` `set_base|other` del catálogo). Medido con la fixture de IDS-B7: el
 * número completo sale del NOMBRE del producto (TCGplayer nombra los singles «Pikachu ex - 057/191»); si el nombre no lo trae,
 * de `Card.number` + `/` + `CardSet.printedTotal` (los dos de pokemontcg.io). Sin ninguno ⇒ `null` (no empata).
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
