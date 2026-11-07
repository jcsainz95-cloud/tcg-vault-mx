/**
 * tcgcsv-card-name.ts — P-PROMOS opción C (ARCHITECTURE §5.12): piezas PURAS del import de cartas desde TCGCSV.
 *
 * Marca de origen: prefijo `tcgcsv:` en `externalId` (sin columna nueva; pokemontcg.io nunca usa `:`). ⛔ Ningún
 * `startsWith('tcgcsv:')` suelto en el código: todo pasa por `isTcgcsvOrigin`.
 */
import { StampType } from '@prisma/client';

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
  return null;
}

/** Sello en paréntesis: SOLO el texto exacto `(Prerelease)`, `(Winner)`, `(Championship)`/`(Campeonato)`. Otro ⇒ `null`. */
export function parenStampTypeFromLabel(label: string): StampType | null {
  const s = label.trim().toLowerCase();
  if (/^pre-?release$/.test(s)) return 'prerelease';
  if (/^(winner|championship|campeonato)$/.test(s)) return 'championship';
  return null;
}

/**
 * `parseTcgcsvCardName(name, extNumber)`: «Pikachu ex - 107 (30th Celebration)» + Number «107» ⇒ name
 * «Pikachu ex (30th Celebration)», #107. «Paradise Resort - 092 (…) [Staff]» ⇒ sello `staff`, label «Staff».
 * Sin `Number` ⇒ no es carta (sellado u otro) ⇒ `no_number`. Número del nombre ≠ `Number` ⇒ `number_mismatch`.
 */
export function parseTcgcsvCardName(rawName: string, extNumber: string | null | undefined): ParsedTcgcsvName {
  const ext = (extNumber ?? '').split('/')[0].trim();
  if (ext === '') return { ok: false, reason: 'no_number' };

  let s = (rawName ?? '').trim();
  const stamps: { type: StampType; label: string }[] = [];
  for (const m of s.matchAll(BRACKET)) {
    const label = m[1].trim();
    if (label === '') continue;
    const type = stampTypeFromLabel(label);
    if (type == null) return { ok: false, reason: 'unknown_stamp' };
    stamps.push({ type, label });
  }
  s = s.replace(BRACKET, ' ');
  // Paréntesis: solo `(30th Celebration)` se queda en el nombre; Prerelease/Winner/Campeonato son sello; el resto, desconocido.
  for (const m of [...s.matchAll(PAREN)]) {
    const label = m[1].trim();
    if (KEEP_PARENS.includes(label.toLowerCase())) continue;
    const type = parenStampTypeFromLabel(label);
    if (type == null) return { ok: false, reason: 'unknown_stamp' };
    stamps.push({ type, label });
    s = s.replace(m[0], ' ');
  }
  if (stamps.length > 1) return { ok: false, reason: 'unknown_stamp' };
  const stamp = stamps[0] ?? null;
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
