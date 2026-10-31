/**
 * graded-turns.ts — v1.113⟨portada⟩ (API_CONTRACT §DYN.4, ARCHITECTURE §4.DYN (d)): las piezas PURAS del turno PSA por set.
 * Sin infraestructura: reloj por fecha CDMX (`YYYY-MM-DD`), orden del turno, estimado de créditos y proyección de AG-24.
 * Las consume `PriceIngestService.ingestGradedEstimates` (escritura) y `GradedBudgetService` (lectura del panel).
 */

/** §DYN.4.2 — un set se vuelve a pedir cuando su última consulta `ok` tiene ≥ 7 días NATURALES CDMX. */
export const GRADED_TURN_CYCLE_DAYS = 7;
/** §DYN.4.5 — «algún set lleva vencido > 8 días» abre AG-24 (`reason: 'overdue'`). */
export const GRADED_TURN_OVERDUE_ALERT_DAYS = 8;
/** §DYN.4.3 — estimado de un set nunca medido: 2 créditos por carta del set en catálogo (premisa §4.38h.3). */
export const GRADED_EST_CREDITS_PER_CATALOG_CARD = 2;

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
function ymdToUtcDays(ymd: string): number {
  const m = YMD_RE.exec(ymd);
  if (!m) throw new Error(`graded-turns: '${ymd}' no es YYYY-MM-DD`);
  return Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000);
}

/** Días naturales de `from` a `to` (fechas civiles; `to − from`). */
export function daysBetweenYmd(from: string, to: string): number {
  return ymdToUtcDays(to) - ymdToUtcDays(from);
}

/** `Date` de una columna `@db.Date` ⇒ `YYYY-MM-DD` (Prisma la entrega a medianoche UTC). */
export function ymdOfDbDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** §DYN.4.2 — `vencido(set) ⇔ sin ok ∨ fechaCDMX(última ok) ≤ hoyCDMX − 7`. */
export function isSetDue(lastOkDate: string | null, todayCdmx: string): boolean {
  return lastOkDate == null || daysBetweenYmd(lastOkDate, todayCdmx) >= GRADED_TURN_CYCLE_DAYS;
}

export interface SetTurnState {
  setId: string;
  /** Fecha CDMX de la última fila `ok`, o `null` si nunca. */
  lastOkDate: string | null;
  /** MIN(firstListedAt) de sus cartas raw publicadas (null ⇒ al final de los nunca consultados). */
  minFirstListedAt: Date | null;
}

/**
 * §DYN.4.2 — los sets VENCIDOS en el orden del turno: primero los nunca consultados por `minFirstListedAt` asc; luego por
 * fecha de su última ok asc; desempate `setId` asc. Los no vencidos no aparecen.
 */
export function orderDueSets<T extends SetTurnState>(sets: readonly T[], todayCdmx: string): T[] {
  const due = sets.filter((s) => isSetDue(s.lastOkDate, todayCdmx));
  return [...due].sort((a, b) => {
    const an = a.lastOkDate == null;
    const bn = b.lastOkDate == null;
    if (an !== bn) return an ? -1 : 1;
    if (an && bn) {
      const at = a.minFirstListedAt?.getTime() ?? Number.POSITIVE_INFINITY;
      const bt = b.minFirstListedAt?.getTime() ?? Number.POSITIVE_INFINITY;
      if (at !== bt) return at - bt;
    } else if (a.lastOkDate !== b.lastOkDate) {
      return (a.lastOkDate as string) < (b.lastOkDate as string) ? -1 : 1;
    }
    return a.setId < b.setId ? -1 : a.setId > b.setId ? 1 : 0;
  });
}

/** §DYN.4.3 — `est = creditsMeasured de su última ok ?? 2 × (cartas del set en Card)`. */
export function estimateSetCredits(lastOkMeasured: number | null, catalogCards: number): number {
  return lastOkMeasured ?? GRADED_EST_CREDITS_PER_CATALOG_CARD * catalogCards;
}

/** §DYN.4.5 — `ciclo = ⌈W/cap⌉` (cap 0 ⇒ null) y `topeQueAlcanza = ⌈W/7/100⌉ × 100`. */
export function cycleProjection(weeklyCreditsNeeded: number, cap: number): { cycleDays: number | null; capToCoverWeek: number } {
  return {
    cycleDays: cap <= 0 ? null : Math.ceil(weeklyCreditsNeeded / cap),
    capToCoverWeek: Math.ceil(weeklyCreditsNeeded / GRADED_TURN_CYCLE_DAYS / 100) * 100,
  };
}

/**
 * §DYN.4.5 (errata v1.113.2) — la fecha desde la que cuenta la `edad` de un set para `overdue`: su última `ok`; si nunca tuvo
 * una, `max(MIN firstListedAt de sus cartas raw publicadas, inicio)`, con `inicio = MIN(businessDate)` de TODA
 * `GradedEstimateSetScan`. Sin filas en la bitácora (`inicio = null`) un set nunca consultado no está vencido (`null`): así el
 * día del despliegue —todo sin consultar, `firstListedAt` rellenado con `createdAt`— `overdue` no abre en falso.
 */
export function overdueRefYmd(lastOkDate: string | null, minFirstListedYmd: string | null, turnsStartYmd: string | null): string | null {
  if (lastOkDate != null) return lastOkDate;
  if (turnsStartYmd == null) return null;
  if (minFirstListedYmd == null) return turnsStartYmd;
  return minFirstListedYmd > turnsStartYmd ? minFirstListedYmd : turnsStartYmd;
}

/**
 * §DYN.4.5 — ¿abre (o sigue abierto) AG-24, y por qué? `projected` si el ciclo pasa de 7 días (cap 0 con necesidad > 0 cuenta:
 * no se cubre nunca); `overdue` si algún set en alcance lleva más de 8 días sin consulta `ok`. `null` ⇒ se cierra solo.
 */
export function psaCycleShortReason(v: {
  cycleDays: number | null;
  weeklyCreditsNeeded: number;
  maxOverdueDays: number;
}): 'projected' | 'overdue' | null {
  if (v.weeklyCreditsNeeded > 0 && (v.cycleDays == null || v.cycleDays > GRADED_TURN_CYCLE_DAYS)) return 'projected';
  if (v.maxOverdueDays > GRADED_TURN_OVERDUE_ALERT_DAYS) return 'overdue';
  return null;
}
