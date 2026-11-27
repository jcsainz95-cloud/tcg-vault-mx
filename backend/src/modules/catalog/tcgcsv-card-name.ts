/**
 * tcgcsv-card-name.ts — P-PROMOS opción C (ARCHITECTURE §5.12): piezas PURAS del import de cartas desde TCGCSV.
 *
 * Marca de origen: prefijo `tcgcsv:` en `externalId` (sin columna nueva; pokemontcg.io nunca usa `:`). ⛔ Ningún
 * `startsWith('tcgcsv:')` suelto en el código: todo pasa por `isTcgcsvOrigin`.
 */
import { StampType } from '@prisma/client';
import { normalizeMatchText } from '../../common/card-version';

export const TCGCSV_ORIGIN_PREFIX = 'tcgcsv:';

/** true si el `externalId` (de un `CardSet` o de una `Card`) nació de TCGCSV y no de pokemontcg.io. */
export function isTcgcsvOrigin(externalId: string | null | undefined): boolean {
  return typeof externalId === 'string' && externalId.startsWith(TCGCSV_ORIGIN_PREFIX);
}

export const tcgcsvSetExternalId = (groupId: number): string => `${TCGCSV_ORIGIN_PREFIX}${groupId}`;
export const tcgcsvCardExternalId = (productId: number): string => `${TCGCSV_ORIGIN_PREFIX}${productId}`;

export type TcgcsvSkipReason =
  | 'no_number'
  | 'number_mismatch'
  | 'unknown_stamp'
  | 'empty_name'
  | 'no_base'
  | 'ambiguous_base'
  | 'product_already_linked'
  | 'field_too_long';

/** Topes de campo (PRM-3): una fila que los excede se omite como `field_too_long`. */
export const TCGCSV_MAX_NAME = 200;
export const TCGCSV_MAX_NUMBER = 16;
export const TCGCSV_MAX_RARITY = 64;
export const TCGCSV_MAX_STAMP_LABEL = 64;

/** ÚNICO paréntesis que se conserva en `Card.name` (comparación sin mayúsculas). */
export const KEEP_PARENS: readonly string[] = ['30th celebration'];

/**
 * §PRECIO-SIN-ENLACE (fase 1) — paréntesis que son PARTE DEL NOMBRE de la carta, no un sello/versión aparte:
 * «Metagross (Delta Species)», «Gengar (Prime)», LEGEND de dos mitades «(Top)»/«(Bottom)», «N (Supporter)».
 * Se conservan en `Card.name` (las dos mitades siguen siendo cartas distintas). Lista de PALABRAS DEL NOMBRE,
 * no de sets. Todo paréntesis fuera de esta lista, de `KEEP_PARENS` y de los sellos (HECHOS 257) sigue
 * omitido y reportado (`unknown_stamp`). Comparación sobre texto normalizado (NFKD, minúsculas).
 */
export const NAME_PARENS: readonly string[] = ['delta species', 'prime', 'top', 'bottom', 'supporter'];

const normParen = (label: string): string =>
  label.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** true si el paréntesis es parte del nombre (`NAME_PARENS` o `KEEP_PARENS`). */
export function isNameParen(label: string): boolean {
  const n = normParen(label);
  return NAME_PARENS.includes(n) || KEEP_PARENS.includes(n);
}

/**
 * Llave de nombre para ENLAZAR carta local ↔ producto TCGCSV (§PRECIO-SIN-ENLACE regla b): el nombre sin los
 * paréntesis de `NAME_PARENS`/`KEEP_PARENS`, normalizado. «Metagross (Delta Species)» y «Metagross» ⇒ `metagross`.
 */
export function linkNameKey(raw: string | null | undefined): string {
  let s = (raw ?? '').replace(/\(([^()]*)\)/g, (m, l: string) => (isNameParen(l) ? ' ' : m));
  // §7.8b(e2) Unown: la letra única `(X)`/`[X]` (X = letra, `!` o `?`) NO se borra: queda como marca ` #x` al final de la llave
  // (`normalizeMatchText` borraría `!`/`?` y ligaría «Unown (!)» con «Unown (?)»). La comparación asimétrica está en `linkKeysCompatible`.
  let letter = '';
  if (/^\s*unown\b/i.test(s)) {
    s = s.replace(/[([]\s*([A-Za-z!?])\s*[)\]]/g, (_m, l: string) => {
      letter = ` #${l === '!' ? 'excl' : l === '?' ? 'ques' : l.toLowerCase()}`;
      return ' ';
    });
  }
  // «Gyarados ★ δ» ≡ «Gyarados Star (Delta Species)»: la `δ` FINAL equivale al paréntesis `(Delta Species)` que se quita (NAME_PARENS).
  return normalizeMatchText(symbolsToWords(s)).replace(/ delta$/, '') + letter;
}

const LETTER_MARK = / #(?:[a-z]|excl|ques)$/;
/**
 * §7.8b(e2): dos llaves de nombre (`número|llave`) son compatibles si son iguales, o si EXACTAMENTE un lado trae letra de Unown
 * y el resto de la llave es igual. Letras distintas ⇒ nunca.
 */
export function linkKeysCompatible(a: string, b: string): boolean {
  if (a === b) return true;
  const ma = LETTER_MARK.test(a);
  const mb = LETTER_MARK.test(b);
  if (ma === mb) return false;
  return a.replace(LETTER_MARK, '') === b.replace(LETTER_MARK, '');
}

/**
 * §AUTO-ENLACE §7.8b — tabla CERRADA de símbolos del nombre (ambos lados, tras minúsculas y quitar acentos y ANTES de quitar
 * puntuación): ♂→m, ♀→f, ★→star, δ→delta, ◇→prism star, α→alpha, β→beta, γ→gamma (cada uno por su palabra entre espacios).
 */
const SYMBOL_WORDS: Readonly<Record<string, string>> = { '♂': 'm', '♀': 'f', '★': 'star', 'δ': 'delta', '◇': 'prism star', 'α': 'alpha', 'β': 'beta', 'γ': 'gamma' };
function symbolsToWords(s: string): string {
  return s.toLowerCase().replace(/[♂♀★δ◇αβγ]/g, (c) => ` ${SYMBOL_WORDS[c]} `);
}

/**
 * §AUTO-ENLACE §7.8 — respaldo de la llave del PRODUCTO cuando `parseTcgcsvCardName` falla (sello desconocido, «(Secret)», «(Full Art)»…).
 * Quita, en este orden y sin tabla a mano: (1) todo `[...]`; (2) el sufijo « - NUM(/NUM)?» y el número suelto final; (3) los paréntesis
 * FINALES repetidos que NO sean `NAME_PARENS`/`KEEP_PARENS` (esos son parte del nombre). `stripBrackets=false` conserva los `[...]` (segunda y última llave; nunca hay una tercera).
 */
export function stripProductNameSuffixes(raw: string, keepKeepParens = true, stripBrackets = true): string {
  let s = (stripBrackets ? raw.replace(/\[[^[\]]*\]/g, ' ') : raw).replace(/\s+/g, ' ').trim();
  for (let prev = ''; prev !== s; ) {
    prev = s;
    s = s.replace(/\s*\([^()]*\)\s*$/, (m) => {
      const label = m.trim().slice(1, -1);
      const keep = (!stripBrackets && /^[A-Za-z!?]$/.test(label.trim())) || (keepKeepParens ? isNameParen(label) : NAME_PARENS.includes(normParen(label)));
      return keep ? m : '';
    }).trim();
    s = s.replace(new RegExp(String.raw`(?:^|\s+)-\s*${NUM}(?:\s*/\s*${NUM})?\s*$`), '').trim();
    s = s.replace(new RegExp(String.raw`\s+${NUM}(?:\s*/\s*${NUM})?\s*$`), '').trim();
  }
  return s;
}

/** true si algún campo escribible excede su tope. */
export function exceedsFieldLimits(f: { name: string; number: string; rarity?: string | null; stampLabel?: string | null }): boolean {
  return (
    f.name.length > TCGCSV_MAX_NAME ||
    f.number.length > TCGCSV_MAX_NUMBER ||
    (f.rarity ?? '').length > TCGCSV_MAX_RARITY ||
    (f.stampLabel ?? '').length > TCGCSV_MAX_STAMP_LABEL
  );
}

export type ParsedTcgcsvName =
  | {
      ok: true;
      /** Nombre público: sin el « - 107 » ni el `[Sello]`; el sufijo `(30th Celebration)` SE CONSERVA. */
      name: string;
      /** `ExtendedData.Number` antes de `/`, tal cual (conserva ceros: «092»). */
      number: string;
      stamp: { type: StampType; label: string } | null;
    }
  | { ok: false; reason: Extract<TcgcsvSkipReason, 'no_number' | 'number_mismatch' | 'unknown_stamp' | 'empty_name'> };

const NUM = String.raw`[A-Za-z]{0,3}\d{1,3}[A-Za-z]?`;
/** « - 107 » (guion obligatorio) seguido de espacio, `(` o fin. */
const DASH_NUMBER = new RegExp(String.raw`(?:^|\s+)-\s*(${NUM})(?:\s*/\s*${NUM})?(?=\s|\(|$)`);
/** « 107 » suelto justo antes de un paréntesis o del final. */
const BARE_NUMBER = new RegExp(String.raw`\s+(${NUM})(?:\s*/\s*${NUM})?(?=\s*\(|\s*$)`);
const BRACKET = /\[([^[\]]*)\]/g;
const PAREN = /\(([^()]*)\)/g;

const normNum = (raw: string): string => {
  const t = raw.split('/')[0].trim();
  return /^\d+$/.test(t) ? String(parseInt(t, 10)) : t.toUpperCase();
};

/** Sello físico conocido por el texto del `[…]`. Cualquier otro ⇒ `null` (se reporta, nunca `other`). */
export function stampTypeFromLabel(label: string): StampType | null {
  const s = label.toLowerCase();
  if (/\bstaff\b/.test(s)) return 'staff';
  if (/\bpre-?release\b/.test(s)) return 'prerelease';
  if (/\b(championship|campeonato)\b/.test(s)) return 'championship';
  // P-PROMOS-VIEJAS (§5.13): puestos de campeonato en corchete (lista cerrada exacta; «[Top 16]», «[Champion]»… ⇒ desconocido).
  if (/^(?:[1-4](?:st|nd|rd|th) place|participation|winner|top 16|champion)$/.test(s.trim().replace(/\s+/g, ' '))) return 'championship';
  return null;
}

/**
 * Sello en paréntesis: LISTA CERRADA exacta (sin mayúsculas). `(Prerelease)` ⇒ prerelease; `(Winner)`/`(Championship)`/`(Campeonato)`/
 * `(World Championships <año>)`/`(Asia Championship Series…)` ⇒ championship; `(Pitch Black Stamped)`/`(Pokemon Center Exclusive)`/
 * `(Cosmos Holo)`/`(Ace Trainer)` ⇒ event_promo. Otro ⇒ `null` (se reporta `unknown_stamp`). No se usa `\bchampionship\b`: no casa el plural.
 */
export function parenStampTypeFromLabel(label: string): StampType | null {
  const s = label.trim().toLowerCase().replace(/\s+/g, ' ');
  if (/^pre-?release$/.test(s)) return 'prerelease';
  if (/^(winner|championship|campeonato)$/.test(s)) return 'championship';
  // P-PROMOS-VIEJAS (§5.13): «(Worlds 11)»/«(Worlds 2011)» y «(Battle Road Autumn 2011)» (temporada + año) son campeonato.
  if (/^worlds (?:\d{2}|\d{4})$/.test(s) || /^battle road [a-z]+ \d{4}$/.test(s)) return 'championship';
  if (/^world championships \d{4}$/.test(s) || /^asia championship series(?: [\w -]+)?$/.test(s)) return 'championship';
  if (/^(pitch black stamped|pokemon center exclusive|cosmos holo|ace trainer)$/.test(s)) return 'event_promo';
  // P-PROMOS-VIEJAS (decisión del orquestador, «sello = versión aparte»): «(Staff)» = [Staff]; «(Cosmo Holo)», «(Shiny)» y
  // «(Team Plasma)» (en pokemontcg.io el nombre de la carta NO lo lleva, medido) = promo de evento con su etiqueta.
  if (s === 'staff') return 'staff';
  if (/^(cosmo holo|shiny|team plasma)$/.test(s)) return 'event_promo';
  return null;
}

/**
 * `parseTcgcsvCardName(name, extNumber)`: «Pikachu ex - 107 (30th Celebration)» + Number «107» ⇒ name
 * «Pikachu ex (30th Celebration)», #107. «Paradise Resort - 092 (…) [Staff]» ⇒ sello `staff`, label «Staff».
 * Sin `Number` ⇒ no es carta (sellado u otro) ⇒ `no_number`. Número del nombre ≠ `Number` ⇒ `number_mismatch`.
 */
export function parseTcgcsvCardName(
  rawName: string,
  extNumber: string | null | undefined,
  // P-PROMOS-VIEJAS (§5.13): «(Prerelease) [Staff]» es la versión Staff de la Prerelease (125 productos en las 6 familias):
  // con esta opción `[Staff]` gana también sobre `(Prerelease)`. Sin ella (import de 24451, §5.12) sigue siendo `unknown_stamp`.
  opts: { staffOverPrerelease?: boolean } = {},
): ParsedTcgcsvName {
  const ext = (extNumber ?? '').split('/')[0].trim();
  if (ext === '') return { ok: false, reason: 'no_number' };

  let s = (rawName ?? '').trim();
  const stamps: { type: StampType; label: string; bracket?: boolean }[] = [];
  for (const m of s.matchAll(BRACKET)) {
    const label = m[1].trim();
    if (label === '') continue;
    const type = stampTypeFromLabel(label);
    if (type == null) return { ok: false, reason: 'unknown_stamp' };
    stamps.push({ type, label, bracket: true });
  }
  s = s.replace(BRACKET, ' ');
  // Paréntesis: solo `(30th Celebration)` se queda en el nombre; Prerelease/Winner/Campeonato son sello; el resto, desconocido.
  for (const m of [...s.matchAll(PAREN)]) {
    const label = m[1].trim();
    if (isNameParen(label)) continue;
    const type = parenStampTypeFromLabel(label);
    if (type == null) return { ok: false, reason: 'unknown_stamp' };
    stamps.push({ type, label });
    s = s.replace(m[0], ' ');
  }
  // Combinación evento + `[Staff]` («Paradise Resort 092 (World Championships 2026) [Staff]»): es la versión Staff de ese evento
  // (producto propio de TCGCSV, distinto del que lleva solo el paréntesis); gana `staff`. Cualquier otra combinación ⇒ desconocida.
  // «(Team Plasma)» junto a otro sello (Prerelease, Staff…) no es el sello: solo suma su etiqueta al del evento.
  const tpIdx = stamps.findIndex((x) => !x.bracket && x.label.toLowerCase() === 'team plasma');
  const teamPlasma = tpIdx >= 0 && stamps.length > 1 ? stamps.splice(tpIdx, 1)[0] : null;
  let stamp: { type: StampType; label: string } | null = stamps[0] ? { type: stamps[0].type, label: stamps[0].label } : null;
  if (stamps.length === 2) {
    const staff = stamps.find((x) => x.type === 'staff');
    const other = stamps.find((x) => x !== staff);
    const paren = stamps.find((x) => !x.bracket);
    const bracket = stamps.find((x) => x.bracket);
    if (!staff && paren?.type === 'championship' && bracket?.type === 'championship') {
      // «(Battle Road Autumn 2011) [3rd Place]» sin Staff = UN solo sello: «Battle Road Autumn 2011 · 3rd Place» (≤ 64).
      stamp = { type: 'championship', label: `${paren.label} · ${bracket.label}`.slice(0, TCGCSV_MAX_STAMP_LABEL) };
    } else {
      if (!staff || !other || (other.type !== 'championship' && other.type !== 'event_promo' && !(opts.staffOverPrerelease && other.type === 'prerelease'))) return { ok: false, reason: 'unknown_stamp' };
      stamp = { type: staff.type, label: staff.label };
    }
  } else if (stamps.length > 2) return { ok: false, reason: 'unknown_stamp' };
  if (teamPlasma && stamp) stamp = { type: stamp.type, label: `${stamp.label} · ${teamPlasma.label}`.slice(0, TCGCSV_MAX_STAMP_LABEL) };
  s = s.replace(/\s+/g, ' ').trim();

  const dash = DASH_NUMBER.exec(s);
  if (dash) {
    if (normNum(dash[1]) !== normNum(ext)) return { ok: false, reason: 'number_mismatch' };
    s = s.slice(0, dash.index) + s.slice(dash.index + dash[0].length);
  } else {
    const bare = BARE_NUMBER.exec(s);
    if (bare) {
      if (normNum(bare[1]) === normNum(ext)) {
        s = s.slice(0, bare.index) + s.slice(bare.index + bare[0].length);
      } else if (/^\d{3}$/.test(bare[1])) {
        return { ok: false, reason: 'number_mismatch' };
      }
    }
  }
  s = s.replace(/\s+/g, ' ').trim();
  if (s === '') return { ok: false, reason: 'empty_name' };
  return { ok: true, name: s, number: ext, stamp };
}

/** Formato de un `setId` externo (única definición; hoja del grafo, sin ciclo entre `catalog-sync` y `card-link-repair`). */
export const SET_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
