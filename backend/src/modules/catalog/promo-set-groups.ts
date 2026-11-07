/**
 * promo-set-groups.ts — P-PROMOS-VIEJAS (ARCHITECTURE §5.13): TABLA FIJA set de pokemontcg.io ↔ grupo de TCGCSV para las
 * promos viejas. Las cartas y fotos siguen viniendo de pokemontcg.io (sync normal); de TCGCSV salen productos y precios.
 * El empate por nombre falló 20/20 en estos sets (medido 2026-11-07) y 1400/1430 son los sets BASE de BW/DP: por eso la
 * tabla va en código y manda sobre `pptSetId` y sobre el nombre. Añadir/quitar una fila = cambio revisado; quitarla es el rollback.
 * ⛔ No se escribe `pptSetId` (id de PPT para graded) ni `tcgcsvGroupId` (espejo del sellado) por esta vía.
 */
export interface PtcgPromoGroup {
  /** `CardSet.externalId` (id de pokemontcg.io). */
  ptcgSetId: string;
  /** Grupo de TCGCSV (categoría Pokémon). */
  groupId: number;
  /** Prefijo que llevan los números de este set («BW004», «XY67a»); se quita en `promoNumberKey`. */
  numberPrefix: string;
}

export const PTCG_PROMO_GROUPS: readonly PtcgPromoGroup[] = [
  { ptcgSetId: 'svp', groupId: 22872, numberPrefix: 'SVP' },
  { ptcgSetId: 'swshp', groupId: 2545, numberPrefix: 'SWSH' },
  { ptcgSetId: 'smp', groupId: 1861, numberPrefix: 'SM' },
  { ptcgSetId: 'xyp', groupId: 1451, numberPrefix: 'XY' },
  { ptcgSetId: 'bwp', groupId: 1407, numberPrefix: 'BW' },
  { ptcgSetId: 'dpp', groupId: 1421, numberPrefix: 'DP' },
];

/** Fila de la tabla para el `externalId` de un set local (o `undefined`). */
export function promoGroupFor(externalId: string | null | undefined): PtcgPromoGroup | undefined {
  if (!externalId) return undefined;
  return PTCG_PROMO_GROUPS.find((g) => g.ptcgSetId === externalId);
}

/**
 * Clave de unión de un número de promo: mayúsculas, SIN `numberPrefix`, ceros a la izquierda colapsados y letra final
 * CONSERVADA (BW004 = BW04 = «4»; XY67a = «67A» ≠ «67»). Sin prefijo (svp: «002» = «2»).
 *
 * Un número con `/` es ajeno a la tabla si lo que sigue es un total numérico («134/142», «12/99» = carta de OTRO set que
 * TCGCSV metió en el grupo de promos, p. ej. una Prerelease): devuelve `null` para que NUNCA case con la promo «134»/«12».
 * Un `/` con código de promo («226/S-P», «381/SM-P») sí es de la tabla: se usa lo de antes de `/`. Vacío ⇒ `null`.
 */
export function promoNumberKey(raw: string | null | undefined, numberPrefix: string): string | null {
  const s = (raw ?? '').trim().toUpperCase();
  if (s === '') return null;
  const slash = s.indexOf('/');
  let head = s;
  if (slash >= 0) {
    if (/^\d+$/.test(s.slice(slash + 1).trim())) return null;
    head = s.slice(0, slash).trim();
  }
  const prefix = numberPrefix.toUpperCase();
  if (prefix !== '' && head.startsWith(prefix)) head = head.slice(prefix.length).trim();
  const m = /^0*(\d+)([A-Z]?)$/.exec(head);
  if (!m) return null;
  return `${String(parseInt(m[1], 10))}${m[2]}`;
}
