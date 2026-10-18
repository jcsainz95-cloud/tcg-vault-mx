/**
 * small-cells.ts — 🔒💰 CANDADO DE CELDAS PEQUEÑAS del Panel de Marketing (Brief 2 §5.2, PM-A1;
 * ARCHITECTURE §13.5; API_CONTRACT §MKT.D/E). PURO (sin IO), para poder probarlo a mano (N=1).
 *
 * Regla única que protege a UNA persona detrás de una cifra agregada:
 *  - En toda tabla CON DIMENSIÓN (`utm_*`, puerta, carta, estado, día): si `N < 5` ⇒ el conteo sale
 *    «< 5» y **todo MX$/derivado de esa fila NO se muestra** (null) — ni ticket medio, ni ofertado, ni pagado.
 *  - **Supresión complementaria:** si tras lo anterior queda **UNA sola** celda oculta en la tabla,
 *    se agrupa con la **siguiente más chica** en una fila «Otros (< 5 c/u)» (ambas ocultas), de modo
 *    que el total menos las visibles no despeje una sola celda.
 *
 * ⛔ El conteo real de una fila oculta NUNCA viaja: se reemplaza por el centinela «< 5».
 * ⛔ Los TOTALES SIN DIMENSIÓN (a1/a2 de la semana) NO pasan por aquí: se muestran exactos.
 *
 * 🔒 INVARIANTE (MKT-TL2, aún SIN candado) — la supresión complementaria solo protege si **ninguna salida del
 * mismo periodo publica el TOTAL exacto de la MISMA población** que la tabla suprimida: con ese total,
 * total − visibles despeja la suma de lo oculto. ⚠️ Medido 2026-10-18: c7 (pedidos por estado, mes) y a1
 * (pedidos pagados del mes, exacto) cuentan la MISMA población (`settledAt` en el periodo, estados cobrados)
 * ⇒ a1 − filas visibles de c7 despeja «Otros estados» + «Recogida» cuando solo una de las dos sale «< 5».
 * No identifica un estado (ya vienen agrupados), pero rompe el invariante; ver docs/TECH_DEBT.md MKT-TL2.
 *
 * Régimen (`CellPrivacy`): `'small_cells'` aplica la regla; `'exact'` la salta (cifras reales). El régimen es
 * un PARÁMETRO del mismo cálculo, no un segundo camino de código. Hoy TODAS las salidas usan `'small_cells'`
 * (API_CONTRACT §MKT.G.2 D-MKT-PANEL-2); ningún llamador de producción pasa `'exact'` todavía.
 */

/** Régimen de privacidad de las celdas de una salida del panel. */
export type CellPrivacy = 'small_cells' | 'exact';

/** Umbral de la regla: por debajo de 5 se oculta (PM-A1). */
export const SMALL_CELL_THRESHOLD = 5;

/** Centinela de conteo oculto. El conteo real nunca viaja. */
export const SMALL_CELL_SENTINEL = '< 5' as const;
export type SuppressedCount = typeof SMALL_CELL_SENTINEL;

/** Etiqueta de la fila agrupada por supresión complementaria. */
export const OTROS_LABEL = 'Otros (< 5 c/u)';

/**
 * Una celda/fila dimensionada antes de aplicar la regla.
 * `money` reúne TODO campo monetario o derivado de dinero que debe ocultarse si `count < 5`
 * (MX$, ticket medio, MX$ ofertado, MX$ pagado…). `count` es el N REAL (no viaja si se oculta).
 */
export interface DimensionRow {
  /** Etiqueta de la dimensión, YA escapada por el llamador si viene de fuera (utm_*, término…). */
  key: string;
  count: number;
  money: Record<string, number | null>;
}

/** Fila ya saneada para pantalla/export/endpoint. `count` es número exacto o el centinela. */
export interface SafeRow {
  key: string;
  count: number | SuppressedCount;
  money: Record<string, number | null>;
  /** true solo en la fila «Otros (< 5 c/u)» (agrupación por supresión complementaria). */
  otros?: boolean;
}

const blankMoney = (money: Record<string, number | null>): Record<string, number | null> => {
  const out: Record<string, number | null> = {};
  for (const k of Object.keys(money)) out[k] = null;
  return out;
};

/**
 * Aplica la regla de celdas pequeñas a una tabla dimensionada. Devuelve filas seguras EN EL ORDEN DE
 * ENTRADA; si hubo supresión complementaria, la fila «Otros (< 5 c/u)» va al final (y las dos que la
 * componen desaparecen de su posición). Determinista: «la siguiente más chica» desempata por `key`.
 *
 * ⚠️ El llamador decide QUÉ tablas tienen dimensión. Los totales sin dimensión no se pasan por aquí.
 */
export function applySmallCells(rows: DimensionRow[], privacy: CellPrivacy = 'small_cells'): SafeRow[] {
  // Régimen exacto: cifras reales, sin centinela ni agrupación (mismo orden de entrada).
  if (privacy === 'exact') return rows.map((r) => ({ key: r.key, count: r.count, money: { ...r.money } }));
  // Paso 1 — ocultar toda fila con N < 5 (conteo centinela + dinero en null).
  const safe: SafeRow[] = rows.map((r) =>
    r.count < SMALL_CELL_THRESHOLD
      ? { key: r.key, count: SMALL_CELL_SENTINEL, money: blankMoney(r.money) }
      : { key: r.key, count: r.count, money: { ...r.money } },
  );

  // Índices de lo oculto en el paso 1.
  const hiddenIdx = safe.map((r, i) => (r.count === SMALL_CELL_SENTINEL ? i : -1)).filter((i) => i >= 0);

  // Paso 2 — supresión complementaria SOLO si queda EXACTAMENTE una celda oculta y hay con qué
  // agruparla (≥1 fila visible). Con 0 ó ≥2 ocultas, el total no despeja una sola celda ⇒ no se toca.
  if (hiddenIdx.length === 1) {
    const loneIdx = hiddenIdx[0];
    // Candidatas a «la siguiente más chica»: las visibles (su count es número). Desempate por key.
    const visible = rows
      .map((r, i) => ({ i, count: r.count }))
      .filter((x) => x.i !== loneIdx && safe[x.i].count !== SMALL_CELL_SENTINEL)
      .sort((a, b) => a.count - b.count || rows[a.i].key.localeCompare(rows[b.i].key));
    if (visible.length > 0) {
      const partnerIdx = visible[0].i;
      const grouped = new Set([loneIdx, partnerIdx]);
      const kept = safe.filter((_, i) => !grouped.has(i));
      // La fila «Otros»: ambos componentes ocultos (conteo centinela, dinero en null) ⇒ nada deducible.
      kept.push({ key: OTROS_LABEL, count: SMALL_CELL_SENTINEL, money: blankMoney(rows[loneIdx].money), otros: true });
      return kept;
    }
  }
  return safe;
}

/** ¿Está oculto el conteo de esta fila? (helper para export/serialización). */
export function isSuppressed(count: number | SuppressedCount): count is SuppressedCount {
  return count === SMALL_CELL_SENTINEL;
}
