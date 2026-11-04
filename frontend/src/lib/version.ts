/**
 * §IDS (API_CONTRACT v1.116⟨ids⟩ / v1.116.1⟨ids⟩, DESIGN_SYSTEM §IDS-UX vIDS-6) — reglas PURAS de presentación de la
 * versión de una pieza (idioma + versión de liga). Nada de aquí compone claves: `version.key` y `optionKey` vienen del
 * servidor (IDS-F3: «ningún `optionKey` compuesto en el navegador»). Aquí solo se ELIGE entre lo que el servidor dio
 * y se AGRUPA para pintar.
 */
import type { CardLanguage, FinishLabel, StampType, VersionDTO, VersionOptionDTO } from '@/types/contract';

/**
 * Inglés sin liga: la versión «de siempre». En superficies de cliente no lleva insignia (IDS-UX.1) ni línea de versión
 * (`VersionText`), y su teja enlaza a la ficha sin `?version=` (§IDS.5; el arnés E2E lo deriva de aquí,
 * `e2e/utils/catalog-tile.ts`). La forma es estructural (`language: string`) para que el arnés la use con sus DTO.
 */
export function isDefaultVersion(v: { language: string; stamp?: unknown } | null | undefined): boolean {
  return !v || (v.language === 'en' && v.stamp == null);
}

/** Tipos que el cliente lee como «de liga» (D-6 v3); el resto son promos con su nombre («Prerelease», «Staff», «De torneo»). */
export function isLeagueStamp(type: StampType): boolean {
  return type === 'prize_pack' || type === 'league';
}

/**
 * D-IDS-4 (cerrada; API_CONTRACT §IDS.5 «Preselección»), sobre `versions[]` YA FILTRADA por el servidor (agotadas
 * omitidas):
 *  1. `?version=<optionKey>` presente ⇒ esa;
 *  2. `?version=<version.key>` de liga sin acabado ⇒ la entrada más barata de esa versión (empate: la primera del orden);
 *  3. sin parámetro, agotada o inexistente ⇒ `en` si está; si no, la de menor `fromPriceCents` (empate: la primera).
 * ⛔ Nunca redirección ni 404: un parámetro que no casa cae a la regla 3.
 */
export function preselectVersionOption(
  versions: readonly VersionOptionDTO[],
  param: string | null | undefined,
): VersionOptionDTO | null {
  if (versions.length === 0) return null;
  if (param) {
    const exact = versions.find((v) => v.optionKey === param);
    if (exact) return exact;
    const sameVersion = versions.filter((v) => v.version.stamp != null && v.version.key === param);
    if (sameVersion.length > 0) return cheapestFirst(sameVersion);
  }
  const en = versions.find((v) => v.version.key === 'en');
  if (en) return en;
  return cheapestFirst(versions);
}

function cheapestFirst(list: readonly VersionOptionDTO[]): VersionOptionDTO {
  // `reduce` con `<` estricto conserva la PRIMERA en empate (el orden del servidor manda).
  return list.reduce((best, v) => (v.fromPriceCents < best.fromPriceCents ? v : best), list[0]);
}

/** Una fila de la cuadrícula: producto × acabado (o la fila sin liga); columnas = idioma. */
export interface VersionRow {
  /** Identidad de la fila para React (no es una clave de API). */
  id: string;
  stamp: VersionDTO['stamp'];
  finishLabel: FinishLabel | null;
  cells: Partial<Record<CardLanguage, VersionOptionDTO>>;
  /** D-IDS-6: hay otra fila con el mismo tipo y el mismo `finishLabel` ⇒ el rótulo añade `stamp.label`. */
  needsStampLabel: boolean;
}

/**
 * Agrupa `versions[]` en filas EN EL ORDEN DEL SERVIDOR (la fila aparece donde aparece su primera entrada). La fila sin
 * liga junta `en` y `es`; cada (producto de liga × acabado) es su fila. Las ranuras vacías quedan en hueco (sin
 * reordenar, IDS-UX.8).
 */
export function versionRows(versions: readonly VersionOptionDTO[]): VersionRow[] {
  const rows: VersionRow[] = [];
  const byId = new Map<string, VersionRow>();
  for (const v of versions) {
    const stamp = v.version.stamp;
    const id = stamp ? `stamp:${stamp.productId}:${v.finish ?? ''}` : 'base';
    let row = byId.get(id);
    if (!row) {
      row = { id, stamp, finishLabel: v.finishLabel, cells: {}, needsStampLabel: false };
      byId.set(id, row);
      rows.push(row);
    }
    if (!row.cells[v.version.language]) row.cells[v.version.language] = v;
  }
  for (const row of rows) {
    if (!row.stamp) continue;
    row.needsStampLabel = rows.some(
      (o) => o !== row && o.stamp != null && o.stamp.type === row.stamp!.type && o.finishLabel === row.finishLabel,
    );
  }
  return rows;
}

/**
 * Forma de la ficha (IDS-UX.8, D-IDS-5 = B): 2×2 estándar = la fila sin liga + a lo más UNA fila de liga con el
 * acabado de la base; 2×N (rótulo de fila, sin insignia en la burbuja) si hay dos filas de liga o la de liga tiene
 * acabado distinto (o la base no tiene un acabado único, `finishLabel null`).
 */
export function isExtendedForm(rows: readonly VersionRow[]): boolean {
  const stamped = rows.filter((r) => r.stamp != null);
  if (stamped.length >= 2) return true;
  if (stamped.length === 0) return false;
  const base = rows.find((r) => r.stamp == null);
  if (!base) return false;
  return base.finishLabel == null || base.finishLabel !== stamped[0].finishLabel;
}
