/**
 * marketing-summary.ts — cálculo PURO de las celdas de `r1` (MKT_PANEL_V2 §1): delta contra la semana anterior y supresión de
 * las sublíneas con persona (nuevos/recurrentes). Sin red ni BD.
 */
import { SMALL_CELL_HIDDEN, SMALL_CELL_SENTINEL, SMALL_CELL_THRESHOLD } from './small-cells';
import type { Cell } from './marketing-aggregates.types';

const isSmall = (n: number): boolean => n > 0 && n < SMALL_CELL_THRESHOLD;

/**
 * Delta de una cifra. Ambas ausentes/no numéricas ⇒ sin delta. Ruido: actual y anterior < 5 ⇒ neutro («≈»): `delta_abs` y
 * `delta_pct` null. Anterior 0 (y actual ≥ 5) ⇒ «nuevo»: `delta_abs` = actual y `delta_pct` null. `basis` = las cifras que
 * deciden el ruido cuando la fila es otra unidad (MX$ ⇒ los pedidos).
 */
export function deltaCells(cur: Cell, prev: Cell, basis?: [number, number]): { delta_abs: number | null; delta_pct: number | null } {
  if (typeof cur !== 'number' || typeof prev !== 'number') return { delta_abs: null, delta_pct: null };
  const [bc, bp] = basis ?? [cur, prev];
  if (bc < SMALL_CELL_THRESHOLD && bp < SMALL_CELL_THRESHOLD) return { delta_abs: null, delta_pct: null };
  const abs = Math.round((cur - prev) * 100) / 100;
  if (prev === 0) return { delta_abs: abs, delta_pct: null };
  return { delta_abs: abs, delta_pct: Math.round(((cur - prev) / prev) * 1000) / 10 };
}

/**
 * Nuevos / recurrentes con el TOTAL de visitantes exacto a la vista: si una sale «< 5», la otra se oculta (complemento), si no
 * el total las despejaría. En `exact` (vista del dueño) van tal cual.
 */
export function nvrCells(n: { nuevos: number; recurrentes: number }, exact: boolean): [Cell, Cell] {
  if (exact) return [n.nuevos, n.recurrentes];
  const a = isSmall(n.nuevos);
  const b = isSmall(n.recurrentes);
  if (!a && !b) return [n.nuevos, n.recurrentes];
  return [a ? SMALL_CELL_SENTINEL : SMALL_CELL_HIDDEN, b ? SMALL_CELL_SENTINEL : SMALL_CELL_HIDDEN];
}

/**
 * Suma de celdas ya saneadas de a4 (p. ej. Instagram orgánico + pagado): solo si TODAS son números visibles; si alguna está
 * oculta o «< 5», la suma las despejaría ⇒ «oculta». Una suma 0<n<5 de visibles no existe (cada visible es 0 o ≥ 5).
 */
export function sumIfVisible(cells: Cell[]): Cell {
  let t = 0;
  for (const c of cells) {
    if (typeof c !== 'number') return SMALL_CELL_HIDDEN;
    t += c;
  }
  return t;
}
