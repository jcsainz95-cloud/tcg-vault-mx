/**
 * v1.82.3 · §PNL.12 «Regla C» — unidad de la regla pura y de su forma `where` (la conducta contra Postgres
 * vive en `test/integration/buylist-skip-closure.e2e-spec.ts`, SKP-1…6). Propiedad: backend.
 */
import {
  SELL_ITEM_COUNTS_FOR_CLOSURE_WHERE,
  closesAsRejected,
  closesAsRejectedByWhere,
  countsForClosure,
  deriveRejectedReason,
  readClosureRule,
} from '../src/modules/buylist/buylist-reject.constants';

describe('§PNL.12 — Regla C (las líneas `skip` no cuentan para cerrar)', () => {
  it('countsForClosure: null y buy cuentan; skip no; ausente cuenta (fail-safe: nunca se pierde una línea)', () => {
    expect(countsForClosure({ offerDecision: null })).toBe(true);
    expect(countsForClosure({ offerDecision: 'buy' })).toBe(true);
    expect(countsForClosure({ offerDecision: 'skip' })).toBe(false);
    expect(countsForClosure({})).toBe(true);
  });

  it('⛔ el `where` es el OR EXPLÍCITO (la columna es NULLABLE: `{not:"skip"}` solo borraría las pre-ciclo)', () => {
    expect(SELL_ITEM_COUNTS_FOR_CLOSURE_WHERE).toEqual({
      OR: [{ offerDecision: null }, { offerDecision: { not: 'skip' } }],
    });
  });

  it.each([
    ['2 buy rechazadas + skip viva', [{ itemStatus: 'rechazada', offerDecision: 'buy' }, { itemStatus: 'rechazada', offerDecision: 'buy' }, { itemStatus: 'verificacion', offerDecision: 'skip' }], true],
    ['💰 buy aprobada + buy rechazada + skip', [{ itemStatus: 'aprobada', offerDecision: 'buy' }, { itemStatus: 'rechazada', offerDecision: 'buy' }, { itemStatus: 'verificacion', offerDecision: 'skip' }], false],
    ['pre-ciclo, 1 de 2 rechazada', [{ itemStatus: 'rechazada', offerDecision: null }, { itemStatus: 'verificacion', offerDecision: null }], false],
    ['pre-ciclo, 2 de 2 rechazadas', [{ itemStatus: 'rechazada', offerDecision: null }, { itemStatus: 'rechazada', offerDecision: null }], true],
    ['solo skip (0 que cuentan)', [{ itemStatus: 'verificacion', offerDecision: 'skip' }], false],
    ['solo skip rechazada (0 que cuentan)', [{ itemStatus: 'rechazada', offerDecision: 'skip' }], false],
    ['sin líneas', [], false],
    ['convertida_inventario cuenta como viva', [{ itemStatus: 'convertida_inventario', offerDecision: 'buy' }, { itemStatus: 'rechazada', offerDecision: 'buy' }], false],
  ])('%s ⇒ %s, y la lectura `where` dice lo mismo', async (_n, items, esperado) => {
    expect(closesAsRejected(items)).toBe(esperado);
    // La forma `where`: el fake aplica en memoria el filtro que Postgres aplica (líneas que cuentan).
    const db = {
      sellRequestItem: {
        findMany: jest.fn(async () => items.filter(countsForClosure).map((i) => ({ itemStatus: i.itemStatus }))),
      },
    };
    const reading = await readClosureRule(db as never, 'sr-1');
    expect(closesAsRejectedByWhere(reading)).toBe(esperado);
    expect(db.sellRequestItem.findMany).toHaveBeenCalledWith({
      where: { sellRequestId: 'sr-1', ...SELL_ITEM_COUNTS_FOR_CLOSURE_WHERE },
      select: { itemStatus: true },
    });
  });

  it('readClosureRule: `nonRejectedItemStatuses` solo trae estados de líneas que cuentan, sin repetir', async () => {
    const db = {
      sellRequestItem: {
        findMany: jest.fn(async () => [{ itemStatus: 'aprobada' }, { itemStatus: 'aprobada' }, { itemStatus: 'rechazada' }]),
      },
    };
    expect(await readClosureRule(db as never, 'x')).toEqual({ countingItems: 3, nonRejectedItemStatuses: ['aprobada'] });
  });

  it('(c) deriveRejectedReason: cerrada con `skip` viva y oferta aceptada ⇒ all_items_rejected (no null)', () => {
    const r = { status: 'rechazada', acceptedAt: new Date(), offerSentAt: new Date(), closedAt: new Date() };
    expect(
      deriveRejectedReason(r, [
        { itemStatus: 'rechazada', offerDecision: 'buy' },
        { itemStatus: 'verificacion', offerDecision: 'skip' },
      ]),
    ).toBe('all_items_rejected');
    // Solo `skip` ⇒ no hay líneas que cuenten ⇒ no es «todas rechazadas».
    expect(deriveRejectedReason(r, [{ itemStatus: 'verificacion', offerDecision: 'skip' }])).toBeNull();
  });
});
