/**
 * 🔒💰 CANDADO — celdas pequeñas del Panel de Marketing (Brief 2 §5.2, PM-A1; ARCHITECTURE §13.5).
 * Protege a UNA persona detrás de una cifra agregada. Deterministas (N=1).
 */
import { applySmallCells, applySmallCellsByComponent, hiddenCellIds, cellId, OTROS_LABEL, SMALL_CELL_HIDDEN, SMALL_CELL_SENTINEL, type CellPrivacy, type DimensionRow } from '../src/modules/marketing/small-cells';

const row = (key: string, count: number, mxn: number | null = count * 100): DimensionRow => ({ key, count, subjects: count, money: { mxn } });

describe('applySmallCells', () => {
  it('oculta conteo y MX$ de una fila con N<5 (centinela «< 5», dinero «oculta», v1.106 C-P1)', () => {
    // DOS ocultas (story, dm) ⇒ no se dispara la agrupación complementaria: se ve el caso base.
    const out = applySmallCells([row('story', 1), row('dm', 2), row('bio', 9), row('paid', 12)]);
    const story = out.find((r) => r.key === 'story')!;
    expect(story.count).toBe(SMALL_CELL_SENTINEL);
    expect(story.money.mxn).toBe(SMALL_CELL_HIDDEN);
    // Las visibles ≥5 quedan exactas.
    expect(out.find((r) => r.key === 'bio')!.count).toBe(9);
    expect(out.find((r) => r.key === 'bio')!.money.mxn).toBe(900);
  });

  it('⛔ el conteo REAL de una celda oculta NUNCA viaja en la salida', () => {
    const out = applySmallCells([row('dm', 3), row('bio', 40), row('paid', 50)]);
    // 3 está oculto; no debe aparecer como número en ninguna celda de conteo.
    const counts = out.map((r) => r.count);
    expect(counts).not.toContain(3);
  });

  it('oculta TODO campo monetario/derivado de la fila (ticket medio incluido)', () => {
    const out = applySmallCells([
      { key: 'x', count: 2, subjects: 2, money: { mxn: 500, ticket: 250 } },
      { key: 'w', count: 1, subjects: 1, money: { mxn: 100, ticket: 100 } }, // 2ª oculta ⇒ sin agrupación
      { key: 'y', count: 10, subjects: 10, money: { mxn: 5000, ticket: 500 } },
      { key: 'z', count: 11, subjects: 11, money: { mxn: 6000, ticket: 545 } },
    ]);
    const x = out.find((r) => r.key === 'x')!;
    expect(x.money.mxn).toBe(SMALL_CELL_HIDDEN);
    expect(x.money.ticket).toBe(SMALL_CELL_HIDDEN);
  });

  it('supresión complementaria: si queda UNA sola oculta, la agrupa con la más chica en «Otros (< 5 c/u)»', () => {
    // Solo `dm` (N=1) < 5. La más chica visible es `story` (N=6). Ambas deben desaparecer y salir «Otros».
    const out = applySmallCells([row('dm', 1), row('story', 6), row('bio', 40), row('paid', 50)]);
    expect(out.find((r) => r.key === 'dm')).toBeUndefined();
    expect(out.find((r) => r.key === 'story')).toBeUndefined();
    const otros = out.find((r) => r.key === OTROS_LABEL)!;
    expect(otros).toBeDefined();
    expect(otros.count).toBe(SMALL_CELL_SENTINEL);
    expect(otros.money.mxn).toBe(SMALL_CELL_HIDDEN);
    expect(otros.otros).toBe(true);
    // bio y paid siguen visibles y exactas.
    expect(out.find((r) => r.key === 'bio')!.count).toBe(40);
  });

  it('con DOS o más celdas ocultas NO agrupa (el total ya no despeja una sola)', () => {
    const out = applySmallCells([row('dm', 1), row('story', 2), row('bio', 40)]);
    expect(out.find((r) => r.key === OTROS_LABEL)).toBeUndefined();
    expect(out.filter((r) => r.count === SMALL_CELL_SENTINEL).length).toBe(2);
  });

  it('una sola fila oculta sin pareja visible queda «< 5» (no hay con qué agrupar)', () => {
    const out = applySmallCells([row('dm', 2)]);
    expect(out).toHaveLength(1);
    expect(out[0].count).toBe(SMALL_CELL_SENTINEL);
  });
});

describe('applySmallCellsByComponent (b1-b3, §MKT.H.14)', () => {
  const part = (n: number, mxn: number) => ({ count: n, subjects: n, money: { mxn } });
  const brow = (key: string, o: number, s: number) => ({ key, parts: { pedidos: part(o, o * 100), solicitudes: part(s, s * 10) } });

  it('R3a por columna: UNA oculta en «pedidos» ⇒ se oculta en su sitio la visible más chica ≠ 0 (con su MX$); «solicitudes» no se toca', () => {
    const out = applySmallCellsByComponent([brow('a', 9, 6), brow('b', 2, 7), brow('c', 6, 8), brow('d', 0, 9)], 'small_cells');
    const by = (k: string) => out.find((r) => r.key === k)!;
    expect(by('b').parts.pedidos).toEqual({ count: SMALL_CELL_SENTINEL, money: { mxn: SMALL_CELL_HIDDEN } });
    // c (6) es la visible más chica ≠ 0: la d (0) no cuenta como pareja.
    expect(by('c').parts.pedidos).toEqual({ count: SMALL_CELL_HIDDEN, money: { mxn: SMALL_CELL_HIDDEN } });
    expect(by('d').parts.pedidos).toEqual({ count: 0, money: { mxn: 0 } });
    expect(out.map((r) => r.parts.solicitudes.count)).toEqual(expect.arrayContaining([6, 7, 8, 9]));
    // R0 solo con valores publicados: pedidos visibles desc (a 9, d 0); después las de pedidos oculto, que empatan en
    // pedidos y se ordenan por la siguiente parte publicada (solicitudes c 8 > b 7) y, si no, por clave. Sin fila «Otros».
    expect(out.map((r) => r.key)).toEqual(['a', 'd', 'c', 'b']);
    expect(hiddenCellIds([brow('a', 9, 6), brow('b', 2, 7), brow('c', 6, 8), brow('d', 0, 9)])).toEqual(new Set([cellId('b', 'pedidos'), cellId('c', 'pedidos')]));
  });

  it('forced (coherencia mes↔semanas) por (clave, componente): oculta solo esa parte', () => {
    const out = applySmallCellsByComponent([brow('a', 9, 6), brow('b', 8, 7), brow('c', 7, 8)], 'small_cells', new Set([cellId('a', 'solicitudes'), cellId('b', 'solicitudes')]));
    const a = out.find((r) => r.key === 'a')!;
    expect(a.parts.pedidos.count).toBe(9);
    expect(a.parts.solicitudes).toEqual({ count: SMALL_CELL_HIDDEN, money: { mxn: SMALL_CELL_HIDDEN } });
  });

  it("'exact': cifras reales en el orden de entrada", () => {
    const out = applySmallCellsByComponent([brow('b', 1, 4), brow('a', 9, 0)], 'exact' as CellPrivacy);
    expect(out.map((r) => [r.key, r.parts.pedidos.count, r.parts.solicitudes.money.mxn])).toEqual([['b', 1, 40], ['a', 9, 0]]);
  });
});
