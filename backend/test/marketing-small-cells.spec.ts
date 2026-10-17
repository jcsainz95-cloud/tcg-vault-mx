/**
 * 🔒💰 CANDADO — celdas pequeñas del Panel de Marketing (Brief 2 §5.2, PM-A1; ARCHITECTURE §13.5).
 * Protege a UNA persona detrás de una cifra agregada. Deterministas (N=1).
 */
import { applySmallCells, OTROS_LABEL, SMALL_CELL_SENTINEL, type DimensionRow } from '../src/modules/marketing/small-cells';

const row = (key: string, count: number, mxn: number | null = count * 100): DimensionRow => ({ key, count, money: { mxn } });

describe('applySmallCells', () => {
  it('oculta conteo y MX$ de una fila con N<5 (centinela «< 5», dinero null)', () => {
    // DOS ocultas (story, dm) ⇒ no se dispara la agrupación complementaria: se ve el caso base.
    const out = applySmallCells([row('story', 1), row('dm', 2), row('bio', 9), row('paid', 12)]);
    const story = out.find((r) => r.key === 'story')!;
    expect(story.count).toBe(SMALL_CELL_SENTINEL);
    expect(story.money.mxn).toBeNull();
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
      { key: 'x', count: 2, money: { mxn: 500, ticket: 250 } },
      { key: 'w', count: 1, money: { mxn: 100, ticket: 100 } }, // 2ª oculta ⇒ sin agrupación
      { key: 'y', count: 10, money: { mxn: 5000, ticket: 500 } },
      { key: 'z', count: 11, money: { mxn: 6000, ticket: 545 } },
    ]);
    const x = out.find((r) => r.key === 'x')!;
    expect(x.money.mxn).toBeNull();
    expect(x.money.ticket).toBeNull();
  });

  it('supresión complementaria: si queda UNA sola oculta, la agrupa con la más chica en «Otros (< 5 c/u)»', () => {
    // Solo `dm` (N=1) < 5. La más chica visible es `story` (N=6). Ambas deben desaparecer y salir «Otros».
    const out = applySmallCells([row('dm', 1), row('story', 6), row('bio', 40), row('paid', 50)]);
    expect(out.find((r) => r.key === 'dm')).toBeUndefined();
    expect(out.find((r) => r.key === 'story')).toBeUndefined();
    const otros = out.find((r) => r.key === OTROS_LABEL)!;
    expect(otros).toBeDefined();
    expect(otros.count).toBe(SMALL_CELL_SENTINEL);
    expect(otros.money.mxn).toBeNull();
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
