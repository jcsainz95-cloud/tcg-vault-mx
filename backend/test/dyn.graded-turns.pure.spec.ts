/**
 * dyn.graded-turns.pure.spec.ts — v1.113⟨portada⟩ (API_CONTRACT §DYN.4.2–4.5): las piezas PURAS del turno PSA por set.
 * Reloj por fecha CDMX, orden del turno (DYN-B9 en su forma pura), estimado de créditos y la proyección de AG-24.
 * ⛔ Oráculo escrito a mano desde el contrato.
 */
import {
  GRADED_TURN_CYCLE_DAYS,
  cycleProjection,
  daysBetweenYmd,
  estimateSetCredits,
  isSetDue,
  orderDueSets,
  psaCycleShortReason,
  overdueRefYmd,
} from '../src/modules/pricing/graded-turns';

describe('DYN.4.2 — reloj por set en días naturales CDMX', () => {
  it('el ciclo es 7 días', () => expect(GRADED_TURN_CYCLE_DAYS).toBe(7));
  it('sin consulta ok ⇒ vencido', () => expect(isSetDue(null, '2026-11-10')).toBe(true));
  it('última ok hace exactamente 7 días ⇒ vencido; hace 6 ⇒ no', () => {
    expect(isSetDue('2026-11-03', '2026-11-10')).toBe(true);
    expect(isSetDue('2026-11-04', '2026-11-10')).toBe(false);
  });
  it('cruza meses', () => {
    expect(daysBetweenYmd('2026-10-28', '2026-11-04')).toBe(7);
    expect(isSetDue('2026-10-28', '2026-11-04')).toBe(true);
  });
});

describe('DYN-B9 (puro) — orden: nunca consultados por firstListedAt asc, luego última ok asc, desempate setId', () => {
  it('30 sets: 5 nunca + 25 con fechas distintas ⇒ el turno empieza por los 5 nunca y sigue por los más viejos', () => {
    const today = '2026-11-30';
    const sets = [
      ...Array.from({ length: 5 }, (_, i) => ({
        setId: `n${i}`,
        lastOkDate: null,
        minFirstListedAt: new Date(Date.UTC(2026, 9, 10 - i)), // n4 publicada antes que n0
      })),
      ...Array.from({ length: 25 }, (_, i) => ({
        setId: `s${String(i).padStart(2, '0')}`,
        lastOkDate: `2026-11-${String(1 + i).padStart(2, '0')}`, // s00 = la más vieja (01), s24 = 25
        minFirstListedAt: new Date(Date.UTC(2026, 0, 1)),
      })),
    ];
    const order = orderDueSets(sets, today).map((s) => s.setId);
    expect(order.slice(0, 10)).toEqual(['n4', 'n3', 'n2', 'n1', 'n0', 's00', 's01', 's02', 's03', 's04']);
    // ninguna consultada hace < 7 días: 2026-11-24..25 (s23, s24) NO entran
    expect(order).not.toContain('s23');
    expect(order).not.toContain('s24');
    expect(order).toContain('s22'); // 2026-11-23 = hace 7 días ⇒ vencido
  });

  it('empate de fecha ⇒ setId asc (determinista)', () => {
    const order = orderDueSets(
      [
        { setId: 'b', lastOkDate: '2026-11-01', minFirstListedAt: null },
        { setId: 'a', lastOkDate: '2026-11-01', minFirstListedAt: null },
      ],
      '2026-11-30',
    ).map((s) => s.setId);
    expect(order).toEqual(['a', 'b']);
  });
});

describe('DYN.4.3 — estimado de créditos', () => {
  it('= creditsMeasured de su última ok si existe', () => expect(estimateSetCredits(37, 200)).toBe(37));
  it('si no ⇒ 2 × cartas del set en catálogo', () => expect(estimateSetCredits(null, 200)).toBe(400));
});

describe('DYN.4.5 — proyección de AG-24', () => {
  it('ciclo = ⌈W/cap⌉; tope que alcanza = ⌈W/7/100⌉×100', () => {
    expect(cycleProjection(22_400, 3000)).toEqual({ cycleDays: 8, capToCoverWeek: 3200 });
    expect(cycleProjection(21_000, 3000)).toEqual({ cycleDays: 7, capToCoverWeek: 3000 });
  });
  it('cap 0 ⇒ ciclo null', () => expect(cycleProjection(100, 0)).toEqual({ cycleDays: null, capToCoverWeek: 100 }));
  it('W 0 ⇒ ciclo 0, tope 0', () => expect(cycleProjection(0, 3000)).toEqual({ cycleDays: 0, capToCoverWeek: 0 }));
  it('abre por `projected` si ciclo > 7 o cap 0 con necesidad; por `overdue` si un set lleva > 8 días sin ok', () => {
    expect(psaCycleShortReason({ cycleDays: 8, weeklyCreditsNeeded: 1, maxOverdueDays: 0 })).toBe('projected');
    expect(psaCycleShortReason({ cycleDays: null, weeklyCreditsNeeded: 1, maxOverdueDays: 0 })).toBe('projected');
    expect(psaCycleShortReason({ cycleDays: 7, weeklyCreditsNeeded: 1, maxOverdueDays: 9 })).toBe('overdue');
    expect(psaCycleShortReason({ cycleDays: 7, weeklyCreditsNeeded: 1, maxOverdueDays: 8 })).toBeNull();
    expect(psaCycleShortReason({ cycleDays: null, weeklyCreditsNeeded: 0, maxOverdueDays: 0 })).toBeNull();
  });
});

describe('DYN-B21 (pura) — `overdueRefYmd`: desde cuándo cuenta la edad de un set (errata v1.113.2)', () => {
  it('con `ok` ⇒ su fecha; sin `ok` ⇒ max(llegada, inicio de turnos); sin bitácora ⇒ null (no vence)', () => {
    expect(overdueRefYmd('2026-11-01', '2026-01-01', '2026-10-01')).toBe('2026-11-01');
    expect(overdueRefYmd(null, '2026-09-01', '2026-11-01')).toBe('2026-11-01'); // llegó antes de que hubiera turnos
    expect(overdueRefYmd(null, '2026-11-05', '2026-11-01')).toBe('2026-11-05'); // llegó después
    expect(overdueRefYmd(null, null, '2026-11-01')).toBe('2026-11-01');
    expect(overdueRefYmd(null, '2026-09-01', null)).toBeNull();
  });
});
