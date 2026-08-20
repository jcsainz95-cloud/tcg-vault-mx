import { parseAdminListFilters } from '../src/common/admin-list-filters';

/**
 * v1.25.1 (§Convenciones «Borde de día») — semántica de fecha del helper TRANSVERSAL
 * `parseAdminListFilters`, compartido por `GET /admin/buylist` (§M5) y `GET /admin/orders` (§M3).
 *
 * date-only (`YYYY-MM-DD`) se ancla al borde del día en UTC: `from` = `00:00:00.000Z`,
 * `to` = fin de día INCLUSIVO `23:59:59.999Z`. Un datetime ISO completo se usa TAL CUAL.
 * Fecha no parseable → 400 VALIDATION_ERROR. Rango invertido → vacío (no error).
 */
describe('parseAdminListFilters — borde de día v1.25.1', () => {
  it('`to` date-only → fin de día INCLUSIVO 23:59:59.999Z', () => {
    const { dateRange } = parseAdminListFilters({ to: '2026-08-20' });
    expect(dateRange).toEqual({ lte: new Date('2026-08-20T23:59:59.999Z') });
    expect(dateRange!.lte!.toISOString()).toBe('2026-08-20T23:59:59.999Z');
  });

  it('`from` date-only → inicio de día 00:00:00.000Z', () => {
    const { dateRange } = parseAdminListFilters({ from: '2026-08-01' });
    expect(dateRange).toEqual({ gte: new Date('2026-08-01T00:00:00.000Z') });
    expect(dateRange!.gte!.toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });

  it('rango date-only `from`+`to` → { gte inicio, lte fin INCLUSIVO }', () => {
    const { dateRange } = parseAdminListFilters({ from: '2026-08-01', to: '2026-08-20' });
    expect(dateRange).toEqual({
      gte: new Date('2026-08-01T00:00:00.000Z'),
      lte: new Date('2026-08-20T23:59:59.999Z'),
    });
  });

  it('datetime ISO completo (con hora) → TAL CUAL, sin ajuste de borde', () => {
    const { dateRange } = parseAdminListFilters({
      from: '2026-08-20T15:00:00Z',
      to: '2026-08-20T18:30:00Z',
    });
    expect(dateRange).toEqual({
      gte: new Date('2026-08-20T15:00:00Z'),
      lte: new Date('2026-08-20T18:30:00Z'),
    });
    // Verifica que NO se movió a fin de día.
    expect(dateRange!.lte!.toISOString()).toBe('2026-08-20T18:30:00.000Z');
  });

  it('datetime con offset (no-Z) → TAL CUAL (instante exacto, sin ajuste)', () => {
    const { dateRange } = parseAdminListFilters({ to: '2026-08-20T18:00:00-06:00' });
    expect(dateRange).toEqual({ lte: new Date('2026-08-20T18:00:00-06:00') });
  });

  it('el where resultante sigue siendo { gte, lte } sobre createdAt', () => {
    const { dateRange } = parseAdminListFilters({ from: '2026-08-01', to: '2026-08-20' });
    expect(Object.keys(dateRange!).sort()).toEqual(['gte', 'lte']);
  });

  it('fecha date-only inválida (mes 13) → 400 VALIDATION_ERROR', () => {
    expect.assertions(2);
    try {
      parseAdminListFilters({ to: '2026-13-40' });
    } catch (e: any) {
      expect(e.code).toBe('VALIDATION_ERROR');
      expect(e.getStatus()).toBe(400);
    }
  });

  it('fecha no parseable → 400 VALIDATION_ERROR', () => {
    expect(() => parseAdminListFilters({ from: 'not-a-date' })).toThrow();
    try {
      parseAdminListFilters({ from: 'not-a-date' });
    } catch (e: any) {
      expect(e.code).toBe('VALIDATION_ERROR');
      expect(e.getStatus()).toBe(400);
    }
  });

  it('rango invertido date-only (from > to) NO es error — devuelve gte/lte y deja el vacío a la BD', () => {
    const { dateRange } = parseAdminListFilters({ from: '2026-08-20', to: '2026-08-01' });
    expect(dateRange).toEqual({
      gte: new Date('2026-08-20T00:00:00.000Z'),
      lte: new Date('2026-08-01T23:59:59.999Z'),
    });
  });
});
