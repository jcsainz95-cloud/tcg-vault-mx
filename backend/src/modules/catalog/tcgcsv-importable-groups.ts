/**
 * tcgcsv-importable-groups.ts — P-PROMOS opción C (ARCHITECTURE §5.12): LISTA EXPLÍCITA de los grupos de TCGCSV que el
 * admin puede importar como cartas. Añadir un grupo = cambio de código revisado (el empate por nombre falló con 33/176
 * sets reales de pokemontcg.io y NO se usa en este flujo). Cualquier `groupId` fuera de la lista ⇒ 404 TCGCSV_GROUP_UNKNOWN.
 */
export interface TcgcsvImportableGroup {
  groupId: number;
  /** ids de set de pokemontcg.io que equivalen al grupo: si alguno existe en su lista VIVA ⇒ 409 COVERED. */
  ptcgSetIds: readonly string[];
}

/**
 * 24451 «ME: Mega Evolution Promo». Medido 2026-11-07: `GET api.pokemontcg.io/v2/sets` ⇒ 176 sets, NINGUNO es promo ME
 * (hay me1..me5, me55, me55c; `/v2/sets/mep` ⇒ HTTP 500). `mep` queda como id esperado por el patrón `svp`/`swshp`: si
 * pokemontcg.io lo publica algún día, el import se bloquea (409) y el sync de ese set queda sombreado (no duplica).
 */
export const TCGCSV_IMPORTABLE_GROUPS: readonly TcgcsvImportableGroup[] = [{ groupId: 24451, ptcgSetIds: ['mep'] }];

export const findImportableGroup = (groupId: number): TcgcsvImportableGroup | undefined =>
  TCGCSV_IMPORTABLE_GROUPS.find((g) => g.groupId === groupId);

/** Grupo importable cuyo set equivalente de pokemontcg.io es `ptcgSetId` (para la sombra del sync). */
export const importableGroupForPtcgSet = (ptcgSetId: string): TcgcsvImportableGroup | undefined =>
  TCGCSV_IMPORTABLE_GROUPS.find((g) => g.ptcgSetIds.includes(ptcgSetId));
