import { orderDueSets } from '../src/modules/pricing/graded-turns';

/** AUTO-C3/C4 (docs/specs/AUTO_CATALOGO.md §C): el escaner pone primero los sets con cartas SIN fila por acabado. */
const set = (setId: string, lastOkDate: string | null, pendingScoped = 0) => ({ setId, lastOkDate, minFirstListedAt: null, pendingScoped });

describe('orderDueSets con pendientes por acabado', () => {
  const today = '2026-11-10';
  it('C3 un set consultado ayer pero con pendientes es VENCIDO y va antes que uno nunca consultado', () => {
    const out = orderDueSets([set('a', null), set('b', '2026-11-09', 4), set('c', '2026-11-09', 0)], today);
    expect(out.map((s) => s.setId)).toEqual(['b', 'a']); // c no vence; b (4 pendientes) primero
  });
  it('mas pendientes primero; empate por el orden de siempre', () => {
    const out = orderDueSets([set('a', '2026-11-01', 1), set('b', '2026-11-02', 5), set('c', '2026-10-01', 1)], today);
    expect(out.map((s) => s.setId)).toEqual(['b', 'c', 'a']);
  });
  it('sin pendientes se conserva el comportamiento semanal', () => {
    expect(orderDueSets([set('a', '2026-11-08'), set('b', '2026-11-01')], today).map((s) => s.setId)).toEqual(['b']);
  });
});
