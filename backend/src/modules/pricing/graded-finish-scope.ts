import type { Finish } from '@prisma/client';

/**
 * PSA-ACABADO (docs/specs/PSA_ACABADO.md §2) — a que acabado(s) se puede atribuir una cifra PSA del proveedor.
 * Funcion PURA (sin BD). La regla NUNCA reparte una cifra de carta entre acabados:
 *  - `per_finish` con `finish` real de la carta  => escribe SOLO ese acabado;
 *  - `per_finish` con un acabado que la carta no tiene => `skip` (no se adivina);
 *  - `card_level` (o duda) y carta de UN acabado => escribe ese acabado;
 *  - `card_level` y carta de 2+ acabados => `no_split` (sin estimado; el escaneo queda `no_finish_split`).
 */
export type EstimateFinishDecision =
  | { kind: 'write'; finish: Finish }
  | { kind: 'no_split' }
  | { kind: 'skip' };

export function resolveEstimateFinish(
  row: { finishScope?: 'per_finish' | 'card_level'; finish?: Finish },
  cardFinishes: readonly Finish[],
): EstimateFinishDecision {
  const finishes = [...new Set(cardFinishes)];
  if (row.finishScope === 'per_finish') {
    return row.finish != null && finishes.includes(row.finish) ? { kind: 'write', finish: row.finish } : { kind: 'skip' };
  }
  if (finishes.length === 1) return { kind: 'write', finish: finishes[0] };
  return { kind: 'no_split' };
}
