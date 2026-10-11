/**
 * tcgdex-set-mapper.ts — v1.91⟨precios⟩ (M-75, §PRE / ARCHITECTURE §4.PRE (e), criterio 885) — resuelve
 * `CardSet` (nuestro, de pokemontcg.io) ↔ `tcgdexSetId` (TCGdex) SIN puente frágil.
 *
 * **El problema (medido 2026-10-11):** pokemontcg.io y TCGdex usan esquemas de id DISTINTOS
 * (pokemontcg.io `sv8pt5` · TCGdex `sv08.5`). Derivar uno del otro por regex es exactamente el «puente
 * frágil» que el criterio 885 prohíbe (se rompe con el próximo set).
 *
 * **La estrategia (misma doctrina que `PptSetMapper`, money-safe, ante ambigüedad NO se adivina):**
 * se empata por **nombre normalizado + número de cartas OFICIALES**, resuelto UNA vez contra
 * `GET /v2/en/sets` (lista de 220 sets, 1 llamada, cacheada en memoria por corrida). Un set nuevo NO
 * exige un puente manual: en cuanto TCGdex lo publique con el mismo nombre, el barrido lo resuelve solo.
 * Si no hay match ÚNICO, el set NO tiene fuente TCGdex (sus cartas caen a lo que haya — tcgcsv o
 * `PRICE_PENDING`; NUNCA heredan precio de otra variante).
 *
 * **NO se persiste** (a diferencia de `pptSetId`): la lista de sets es UNA llamada barata y se re-resuelve
 * cada corrida, así que un set recién publicado por TCGdex se recoge sin re-sync ni columna nueva (sin
 * DDL fuera de M-75; §PRE.g no añade columna a `CardSet`).
 */

/** Forma mínima de un set de TCGdex (`GET /v2/en/sets`): id + name + cardCount. */
export interface TcgdexRemoteSet {
  id: string;
  name: string;
  cardCount?: { total?: number; official?: number } | null;
}

/** Lo que el mapper necesita de NUESTRO `CardSet`. */
export interface LocalSetForMatch {
  name: string;
  /** Nº de cartas oficiales del set (`CardSet.printedTotal`). */
  printedTotal: number | null;
}

/**
 * Normaliza un nombre de set (misma función que `PptSetMapper.normalizeSetName`, re-declarada aquí para
 * no acoplar los dos mappers): pliega diacríticos, minúsculas, sin no-alfanuméricos.
 */
export function normalizeTcgdexSetName(name: string | null | undefined): string {
  return (name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Empata un `CardSet` local con un set de TCGdex y devuelve su `tcgdexSetId`, o `null` si no hay match
 * ÚNICO. Money-safe (ante ambigüedad NO se adivina):
 *  1. Por NOMBRE normalizado exacto.
 *  2. Si el nombre empata con >1 set de TCGdex, desempata por nº de cartas OFICIALES (`printedTotal`
 *     == `cardCount.official`).
 *  3. Sin match único ⇒ `null` (el set no tendrá fuente TCGdex; sus cartas caen a lo que haya).
 */
export function matchTcgdexSet(local: LocalSetForMatch, remote: TcgdexRemoteSet[]): string | null {
  const target = normalizeTcgdexSetName(local.name);
  if (target === '') return null;

  const byName = remote.filter((r) => normalizeTcgdexSetName(r.name) === target);
  if (byName.length === 1) return byName[0].id;
  if (byName.length === 0) return null;

  // Empate por nombre ⇒ desempata por nº de cartas oficiales.
  if (local.printedTotal != null) {
    const byCount = byName.filter((r) => (r.cardCount?.official ?? null) === local.printedTotal);
    if (byCount.length === 1) return byCount[0].id;
  }
  return null; // ambiguo ⇒ no se adivina (money-safe).
}

/** Extrae el array de sets del cuerpo de `GET /v2/en/sets` (array pelón o envelope defensivo). */
export function extractTcgdexSets(body: unknown): TcgdexRemoteSet[] {
  const pick = (arr: unknown[]): TcgdexRemoteSet[] =>
    arr.filter(
      (s): s is TcgdexRemoteSet =>
        typeof s === 'object' && s !== null && typeof (s as { id?: unknown }).id === 'string',
    );
  if (Array.isArray(body)) return pick(body);
  if (body && typeof body === 'object') {
    const o = body as Record<string, unknown>;
    for (const key of ['data', 'sets', 'results']) {
      if (Array.isArray(o[key])) return pick(o[key] as unknown[]);
    }
  }
  return [];
}
