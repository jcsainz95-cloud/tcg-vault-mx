import { describe, it, expect } from 'vitest';
import { mockBasis, mockDelta, mockPreviousRange } from './period-compare';

/** El servidor falso debe decir lo mismo que `sales-period.ts` (casos de `backend/test/reports-f2a-period.spec.ts`). */
describe('§2 F2a · servidor falso = regla del contrato', () => {
  it('mes a la fecha ⇒ mismos días del mes anterior; mes cerrado ⇒ mes anterior completo', () => {
    expect(mockPreviousRange('month', '2026-11-01', '2026-11-23')).toMatchObject({ from: '2026-10-01', to: '2026-10-23', clamped: false });
    expect(mockPreviousRange('month', '2026-10-01', '2026-10-31')).toMatchObject({ from: '2026-09-01', to: '2026-09-30', clamped: false });
  });
  it('31-mar contra febrero: febrero completo y `clamped` (también bisiesto)', () => {
    expect(mockPreviousRange('month', '2027-03-01', '2027-03-31')).toMatchObject({ from: '2027-02-01', to: '2027-02-28', clamped: false });
    expect(mockPreviousRange('month', '2027-03-01', '2027-03-30')).toMatchObject({ from: '2027-02-01', to: '2027-02-28', clamped: true });
    expect(mockPreviousRange('month', '2028-03-01', '2028-03-29')).toMatchObject({ to: '2028-02-29', clamped: false });
  });
  it('trimestre y año a la fecha; day = misma semana −7; rolling y span = misma duración inmediatamente antes', () => {
    expect(mockPreviousRange('quarter', '2026-10-01', '2026-11-23')).toMatchObject({ from: '2026-07-01', to: '2026-08-23' });
    expect(mockPreviousRange('year', '2026-01-01', '2026-11-23')).toMatchObject({ from: '2025-01-01', to: '2025-11-23' });
    expect(mockPreviousRange('day', '2026-11-23', '2026-11-23')).toMatchObject({ from: '2026-11-16', to: '2026-11-16' });
    expect(mockPreviousRange('rolling', '2026-11-17', '2026-11-23')).toMatchObject({ from: '2026-11-10', to: '2026-11-16' });
    expect(mockPreviousRange('span', '2026-11-10', '2026-11-12')).toMatchObject({ from: '2026-11-07', to: '2026-11-09' });
    expect(mockPreviousRange(undefined, '2026-11-10', '2026-11-12')).toMatchObject({ from: '2026-11-07', to: '2026-11-09', kind: 'span' });
  });
  it('un `kind` de calendario cuyo `from` no es inicio de la unidad cae a span', () => {
    expect(mockPreviousRange('month', '2026-11-05', '2026-11-23')).toMatchObject({ kind: 'span', from: '2026-10-17', to: '2026-11-04' });
  });
  it('basis: complete / partial (dataSince) / none', () => {
    const p = { from: '2026-10-01', to: '2026-10-23' };
    expect(mockBasis('2024-03-01', p)).toEqual({ basis: 'complete', dataSince: null });
    expect(mockBasis('2026-10-12', p)).toEqual({ basis: 'partial', dataSince: '2026-10-12' });
    expect(mockBasis('2026-11-02', p)).toEqual({ basis: 'none', dataSince: null });
    expect(mockBasis(null, p)).toEqual({ basis: 'none', dataSince: null });
  });
  it('deltaBps sobre |anterior|, mitad hacia afuera; anterior 0 ⇒ null', () => {
    expect(mockDelta(50, -100).deltaBps).toBe(15000);
    expect(mockDelta(1, 3).deltaBps).toBe(-6667);
    expect(mockDelta(5, 0).deltaBps).toBeNull();
  });
});
