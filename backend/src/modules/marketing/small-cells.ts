/**
 * small-cells.ts — 🔒💰 CANDADO DE CELDAS PEQUEÑAS del Panel de Marketing (Brief 2 §5.2, PM-A1;
 * ARCHITECTURE §13.5/§13.7; API_CONTRACT §MKT.D/E/§MKT.G.10). PURO (sin IO), para poder probarlo a mano (N=1).
 *
 * Regla única que protege a UNA persona detrás de una cifra agregada:
 *  - En toda tabla CON DIMENSIÓN (`utm_*`, puerta, carta, estado, día): si `N < 5` ⇒ el conteo sale
 *    «< 5» y **todo MX$/derivado de esa fila NO se muestra** (null) — ni ticket medio, ni ofertado, ni pagado.
 *  - **Supresión coherente mes↔semanas (§MKT.G.10, D-MKT-PANEL-4):** el llamador pasa `forcedHidden` = las claves
 *    ocultas en ALGUNA semana que toca el mes; en el mes salen **«oculta»** (conteo) y null (MX$) aunque N≥5.
 *  - **Supresión complementaria:** si tras lo anterior queda **UNA sola** celda oculta («< 5» u «oculta») en la
 *    tabla, se agrupa con la **siguiente más chica** en una fila «Otros (< 5 c/u)» (ambas ocultas), de modo
 *    que el total menos las visibles no despeje una sola celda.
 *
 * ⛔ El conteo real de una fila oculta NUNCA viaja: se reemplaza por el centinela.
 * ⛔ Los TOTALES SIN DIMENSIÓN (a1/a2 de la semana) NO pasan por aquí: se muestran exactos.
 *
 * 🔒 INVARIANTE (MKT-TL2) — la supresión complementaria solo protege si **ninguna salida del mismo periodo publica
 * el TOTAL exacto de la MISMA población** que la tabla suprimida, salvo que la tabla nunca deje UNA sola celda oculta:
 * con ese total, total − visibles despeja la SUMA de lo oculto. c7 (pedidos por estado, mes) y a1 (pedidos pagados
 * del mes, exacto) son la misma población; desde 2026-10-18 c7 pasa por aquí (`safeRows`) ⇒ nunca queda una sola
 * celda oculta y a1 − visibles despeja la suma de ≥ 2 (candado `marketing-analytics.service.spec.ts` «c7»). Lo que
 * sigue abierto (candado general entre pantallas, tabla con una sola fila): docs/TECH_DEBT.md MKT-TL2.
 *
 * Régimen (`CellPrivacy`, API_CONTRACT v1.103 §MKT.G.2): `'small_cells'` aplica todo lo anterior; `'exact'` lo
 * salta (cifras reales, sin «Otros»). Es un PARÁMETRO del mismo cálculo, no un segundo camino. Solo la pantalla
 * del dueño (`GET …/panel` con sesión `super_admin`) usa `'exact'`; toda salida fuera de pantalla, `'small_cells'`.
 */

declare const OWNER_EXACT: unique symbol;
/**
 * Régimen exacto como tipo MARCADO (techlead D3, 2026-10-18): el literal `'exact'` a pelo NO es asignable a
 * `CellPrivacy`, así que una salida no puede nacer exacta por escribir la palabra. El único productor es
 * `MarketingController.panelPrivacy()` (cast explícito, vigilado por `test/marketing-panel-privacy.spec.ts`).
 * En ejecución sigue siendo la cadena `'exact'` (viaja así en `ScreenPayload.privacy`).
 */
export type ExactPrivacy = 'exact' & { readonly [OWNER_EXACT]: true };
/** Régimen de privacidad de las celdas de una salida del panel. */
export type CellPrivacy = 'small_cells' | ExactPrivacy;

/** Umbral de la regla: por debajo de 5 se oculta (PM-A1). */
export const SMALL_CELL_THRESHOLD = 5;

/** Centinela de conteo con N<5. El conteo real nunca viaja. */
export const SMALL_CELL_SENTINEL = '< 5' as const;
/** Centinela de conteo con N≥5 ocultado por la supresión coherente mes↔semanas (§MKT.G.10). */
export const SMALL_CELL_HIDDEN = 'oculta' as const;
export type SuppressedCount = typeof SMALL_CELL_SENTINEL | typeof SMALL_CELL_HIDDEN;

/** Etiqueta de la fila agrupada por supresión complementaria. */
export const OTROS_LABEL = 'Otros (< 5 c/u)';

/**
 * Una celda/fila dimensionada antes de aplicar la regla.
 * `money` reúne TODO campo monetario o derivado de dinero que debe ocultarse si `count < 5`
 * (MX$, ticket medio, MX$ ofertado, MX$ pagado…). `count` es el N REAL (no viaja si se oculta).
 */
export interface DimensionRow {
  /** Etiqueta de la dimensión, YA escapada por el llamador si viene de fuera (utm_*, término…). Clave de cruce mes↔semanas. */
  key: string;
  count: number;
  money: Record<string, number | null>;
}

/** Fila ya saneada para pantalla/export/endpoint. `count` es número exacto o un centinela. */
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

const isHidden = (c: SafeRow['count']): boolean => c === SMALL_CELL_SENTINEL || c === SMALL_CELL_HIDDEN;

/**
 * Núcleo: qué índices quedan ocultos y, si hay supresión complementaria, cuál es la pareja de la celda sola.
 * Comparten `applySmallCells` (las filas) y `hiddenKeys` (las claves, para la coherencia mes↔semanas).
 */
function plan(rows: DimensionRow[], forcedHidden: ReadonlySet<string>) {
  const safe: SafeRow[] = rows.map((r) =>
    r.count < SMALL_CELL_THRESHOLD
      ? { key: r.key, count: SMALL_CELL_SENTINEL, money: blankMoney(r.money) }
      : forcedHidden.has(r.key)
        ? { key: r.key, count: SMALL_CELL_HIDDEN, money: blankMoney(r.money) }
        : { key: r.key, count: r.count, money: { ...r.money } },
  );
  const hiddenIdx = safe.map((r, i) => (isHidden(r.count) ? i : -1)).filter((i) => i >= 0);
  let grouped: { loneIdx: number; partnerIdx: number } | null = null;
  // Supresión complementaria SOLO si queda EXACTAMENTE una celda oculta y hay con qué agruparla (≥1 visible).
  // Con 0 ó ≥2 ocultas, el total no despeja una sola celda ⇒ no se toca.
  if (hiddenIdx.length === 1) {
    const loneIdx = hiddenIdx[0];
    // «La siguiente más chica» entre las visibles. Desempate por key.
    const visible = rows
      .map((r, i) => ({ i, count: r.count }))
      .filter((x) => x.i !== loneIdx && !isHidden(safe[x.i].count))
      .sort((a, b) => a.count - b.count || rows[a.i].key.localeCompare(rows[b.i].key));
    if (visible.length > 0) grouped = { loneIdx, partnerIdx: visible[0].i };
  }
  return { safe, hiddenIdx, grouped };
}

/**
 * Aplica la regla de celdas pequeñas a una tabla dimensionada. Devuelve filas seguras EN EL ORDEN DE
 * ENTRADA; si hubo supresión complementaria, la fila «Otros (< 5 c/u)» va al final (y las dos que la
 * componen desaparecen de su posición). Determinista: «la siguiente más chica» desempata por `key`.
 *
 * ⚠️ El llamador decide QUÉ tablas tienen dimensión. Los totales sin dimensión no se pasan por aquí.
 */
export function applySmallCells(
  rows: DimensionRow[],
  privacy: CellPrivacy = 'small_cells',
  forcedHidden: ReadonlySet<string> = new Set(),
): SafeRow[] {
  // Régimen exacto: cifras reales, sin centinela ni agrupación (mismo orden de entrada).
  if (privacy === 'exact') return rows.map((r) => ({ key: r.key, count: r.count, money: { ...r.money } }));
  const { safe, grouped } = plan(rows, forcedHidden);
  if (!grouped) return safe;
  const drop = new Set([grouped.loneIdx, grouped.partnerIdx]);
  const kept = safe.filter((_, i) => !drop.has(i));
  // La fila «Otros»: ambos componentes ocultos (conteo centinela, dinero en null) ⇒ nada deducible.
  kept.push({ key: OTROS_LABEL, count: SMALL_CELL_SENTINEL, money: blankMoney(rows[grouped.loneIdx].money), otros: true });
  return kept;
}

/**
 * Claves que `applySmallCells(rows, 'small_cells')` deja ocultas: las de N<5 y la pareja de una fila «Otros».
 * Es lo que el mes hereda de cada semana (§MKT.G.10 paso 1).
 */
export function hiddenKeys(rows: DimensionRow[]): Set<string> {
  const { hiddenIdx, grouped } = plan(rows, new Set());
  const out = new Set(hiddenIdx.map((i) => rows[i].key));
  if (grouped) out.add(rows[grouped.partnerIdx].key);
  return out;
}

/** ¿Está oculto el conteo de esta fila? (helper para export/serialización). */
export function isSuppressed(count: number | SuppressedCount): count is SuppressedCount {
  return isHidden(count);
}
