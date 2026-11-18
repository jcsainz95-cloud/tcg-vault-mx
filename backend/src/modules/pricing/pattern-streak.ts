/**
 * §PRICE-PATTERN 6.2/6.6 — decisión PURA de la auto-pausa del job `pattern-reclassify`. Lo «pendiente» de una corrida (su informe `pattern_reclassify_run`)
 * es diferidos + cartas en cuarentena activas + LOTES FALLIDOS (PP-12: un lote que revierte por excepción/tiempo no es «cero problemas»). Las corridas
 * viejas sin `quarantined` / `failedBatches` cuentan 0.
 */
export const pendingOfRun = (after: unknown): number => {
  const a = after as { deferred?: unknown; quarantined?: unknown; failedBatches?: unknown } | null;
  return Number(a?.deferred ?? 0) + Number(a?.quarantined ?? 0) + Number(a?.failedBatches ?? 0);
};

/**
 * `runs` = las últimas corridas (más NUEVA primero), ya acotadas a las posteriores a la última pausa. Devuelve la serie de pendientes (de la más vieja a la
 * más nueva) si hay que pausar: exactamente `streak` corridas, cada una a ≤ 48 h de la anterior, con pendientes > 0 y ESTRICTAMENTE crecientes. Si no, `null`.
 */
export function pauseSeries(runs: readonly { createdAt: Date; after: unknown }[], streak: number): number[] | null {
  if (runs.length < streak) return null;
  const asc = [...runs].reverse();
  const pending = asc.map((r) => pendingOfRun(r.after));
  const growing = pending.every((d, i) => d > 0 && (i === 0 || d > pending[i - 1]));
  const close = asc.every((r, i) => i === 0 || r.createdAt.getTime() - asc[i - 1].createdAt.getTime() <= 48 * 3_600_000);
  return growing && close ? pending : null;
}
