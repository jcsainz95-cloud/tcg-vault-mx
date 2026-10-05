import { BusinessException } from '../src/common/business.exception';
import {
  isItemFinal,
  ITEM_FINAL_STATUSES,
  parseRejectItemsBody,
  rejectItemsBlock,
  REJECT_ITEMS_BLOCKED_STATUSES,
} from '../src/modules/buylist/buylist-reject-items';
import { BuylistService } from '../src/modules/buylist/buylist.service';

/**
 * v1.82 · PNL-4 — unitarios de `POST /admin/buylist/:id/reject-items` (`API_CONTRACT §PNL.4`). La conducta por
 * HTTP contra Postgres (BRJ-1…9) vive en `test/integration/buylist-reject-items.e2e-spec.ts`.
 */
function details(fn: () => unknown): Record<string, unknown> {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(BusinessException);
    expect((e as BusinessException).getStatus()).toBe(400);
    expect((e as BusinessException).code).toBe('VALIDATION_ERROR');
    return (e as BusinessException).details;
  }
  throw new Error('no lanzó');
}

describe('parseRejectItemsBody — 400 de forma con {field, rule}', () => {
  it('válido ⇒ ids tal cual y motivo con trim', () => {
    expect(parseRejectItemsBody({ itemIds: ['a', 'b'], reason: '  dañadas ', extra: 1 })).toEqual({
      itemIds: ['a', 'b'],
      reason: 'dañadas',
    });
  });
  it.each([
    [undefined, 'itemIds', 'required'],
    [[], 'itemIds', 'required'],
    [{ reason: 'abc' }, 'itemIds', 'type'],
    [{ itemIds: 'a', reason: 'abc' }, 'itemIds', 'type'],
    [{ itemIds: [], reason: 'abc' }, 'itemIds', 'size'],
    [{ itemIds: Array.from({ length: 201 }, (_, i) => `i${i}`), reason: 'abc' }, 'itemIds', 'size'],
    [{ itemIds: ['a', 7], reason: 'abc' }, 'itemIds', 'type'],
    [{ itemIds: ['a', '  '], reason: 'abc' }, 'itemIds', 'type'],
    [{ itemIds: ['a', 'b', 'a'], reason: 'abc' }, 'itemIds', 'duplicates'],
    [{ itemIds: ['a'] }, 'reason', 'type'],
    [{ itemIds: ['a'], reason: '  ab  ' }, 'reason', 'length'],
    [{ itemIds: ['a'], reason: 'x'.repeat(501) }, 'reason', 'length'],
  ])('%j ⇒ 400 {field:%s, rule:%s}', (body, field, rule) => {
    expect(details(() => parseRejectItemsBody(body))).toMatchObject({ field, rule });
  });
  it('200 ids y motivo de 3 y de 500 (los bordes) pasan', () => {
    const ids = Array.from({ length: 200 }, (_, i) => `i${i}`);
    expect(parseRejectItemsBody({ itemIds: ids, reason: 'abc' }).itemIds).toHaveLength(200);
    expect(parseRejectItemsBody({ itemIds: ['a'], reason: 'x'.repeat(500) }).reason).toHaveLength(500);
  });
});

describe('rejectItemsBlock — el predicado, un cuerpo', () => {
  it('`skip` ⇒ not_offered (gana aunque el estado también bloquee)', () => {
    expect(rejectItemsBlock({ itemStatus: 'verificacion', offerDecision: 'skip' })).toBe('not_offered');
    expect(rejectItemsBlock({ itemStatus: 'rechazada', offerDecision: 'skip' })).toBe('not_offered');
  });
  it('convertida / pagada / rechazada ⇒ not_rejectable', () => {
    expect([...REJECT_ITEMS_BLOCKED_STATUSES].sort()).toEqual(['convertida_inventario', 'pagada', 'rechazada']);
    for (const s of REJECT_ITEMS_BLOCKED_STATUSES) {
      expect(rejectItemsBlock({ itemStatus: s, offerDecision: 'buy' })).toBe('not_rejectable');
    }
  });
  it('`buy` o legacy (`null`) en revisión, aprobada o ajustada ⇒ rechazable', () => {
    for (const s of ['verificacion', 'recibida', 'aprobada', 'ajustada', 'cotizada'] as const) {
      expect(rejectItemsBlock({ itemStatus: s, offerDecision: 'buy' })).toBeNull();
      expect(rejectItemsBlock({ itemStatus: s, offerDecision: null })).toBeNull();
    }
  });
});

describe('recomputeApprovedTotal suelto — toma `SellRequest FOR UPDATE` ANTES de agregar (BRJ-8, total viejo)', () => {
  it('orden de llamadas: candado → agregado → escritura, en UNA tx', async () => {
    const calls: string[] = [];
    const tx = {
      $queryRaw: jest.fn(async (strings: TemplateStringsArray) => {
        calls.push(strings.join('?').includes('FOR UPDATE') && strings.join('?').includes('"SellRequest"') ? 'lock' : 'raw');
        return [{ id: 'sr' }];
      }),
      sellRequestItem: {
        aggregate: jest.fn(async () => {
          calls.push('aggregate');
          return { _sum: { approvedPriceCents: 500 }, _count: { approvedPriceCents: 1 } };
        }),
      },
      sellRequest: {
        updateMany: jest.fn(async () => {
          calls.push('write');
          return { count: 1 };
        }),
      },
    };
    const prisma = { $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)) };
    const svc = Object.create(BuylistService.prototype) as BuylistService;
    Object.assign(svc, { prisma, logger: { warn: jest.fn() } });
    await (svc as unknown as { recomputeApprovedTotal: (id: string) => Promise<void> }).recomputeApprovedTotal('sr');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['lock', 'aggregate', 'write']);
    expect(tx.sellRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { approvedTotalCents: 500 } }),
    );
  });
});

describe('v1.82.1 §PNL.10.2 — ITEM_FINAL_STATUSES: un predicado, un cuerpo', () => {
  it('ITEM_FINAL_STATUSES = [convertida_inventario, pagada]', () => {
    expect([...ITEM_FINAL_STATUSES]).toEqual(['convertida_inventario', 'pagada']);
  });
  it('composición: REJECT_ITEMS_BLOCKED_STATUSES ⊇ ITEM_FINAL_STATUSES y = [...ITEM_FINAL_STATUSES, rechazada]', () => {
    for (const s of ITEM_FINAL_STATUSES) expect(REJECT_ITEMS_BLOCKED_STATUSES).toContain(s);
    expect([...REJECT_ITEMS_BLOCKED_STATUSES]).toEqual([...ITEM_FINAL_STATUSES, 'rechazada']);
  });
  it('isItemFinal: solo los dos finales; `rechazada` NO es final (la idempotencia del PATCH no se solapa)', () => {
    expect(isItemFinal('convertida_inventario')).toBe(true);
    expect(isItemFinal('pagada')).toBe(true);
    for (const s of ['rechazada', 'aprobada', 'ajustada', 'verificacion', 'recibida', 'cotizada'] as const) {
      expect(isItemFinal(s)).toBe(false);
    }
  });
});

describe('BRJ-12 💰 — la guarda del MOTOR del rechazo, sin el `if`', () => {
  type Svc = {
    rejectItemWrite: (db: unknown, id: string, r: string, at: Date, expected?: string) => Promise<boolean>;
    throwRejectWriteConflict: (db: unknown, itemId: string, srId: string) => Promise<never>;
  };
  const svc = () => {
    const s = Object.create(BuylistService.prototype) as BuylistService;
    Object.assign(s, { logger: { warn: jest.fn() } });
    return s as unknown as Svc;
  };

  it.each([[undefined], ['aprobada']])(
    'el `where` de rejectItemWrite lleva SIEMPRE `itemStatus NOT IN ITEM_FINAL_STATUSES` (expectedItemStatus = %s)',
    async (expected) => {
      const updateMany = jest.fn(async () => ({ count: 0 }));
      const ok = await svc().rejectItemWrite({ sellRequestItem: { updateMany } }, 'it1', 'motivo', new Date(), expected);
      expect(ok).toBe(false);
      const where = (updateMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where;
      const and = where.AND as Record<string, unknown>[];
      expect(and).toContainEqual({ itemStatus: { notIn: [...ITEM_FINAL_STATUSES] } });
      if (expected) expect(and).toContainEqual({ itemStatus: expected });
      else expect(and).toHaveLength(1);
      expect(where.id).toBe('it1');
    },
  );

  const db = (status: string, itemStatus: string | null) => ({
    sellRequest: { findUnique: jest.fn(async () => ({ status })) },
    sellRequestItem: { findUnique: jest.fn(async () => (itemStatus ? { itemStatus } : null)) },
  });
  async function caught(p: Promise<unknown>): Promise<BusinessException> {
    try {
      await p;
    } catch (e) {
      expect(e).toBeInstanceOf(BusinessException);
      return e as BusinessException;
    }
    throw new Error('no lanzó');
  }

  it('count = 0 sobre una carta convertida con la solicitud VIVA ⇒ 409 CONFLICT ITEM_FINAL (no NO_LIVE_ADJUSTMENT)', async () => {
    const e = await caught(svc().throwRejectWriteConflict(db('verificacion', 'convertida_inventario'), 'it1', 'sr1'));
    expect(e.getStatus()).toBe(409);
    expect(e.code).toBe('CONFLICT');
    expect(e.details).toEqual({ itemId: 'it1', itemStatus: 'convertida_inventario', reason: 'ITEM_FINAL' });
  });
  it('count = 0 con la solicitud TERMINAL ⇒ NO_LIVE_ADJUSTMENT gana aunque la carta sea final', async () => {
    const e = await caught(svc().throwRejectWriteConflict(db('pagada', 'convertida_inventario'), 'it1', 'sr1'));
    expect(e.code).toBe('NO_LIVE_ADJUSTMENT');
    expect(e.details).toEqual({ status: 'pagada' });
  });
  it('count = 0 con la solicitud viva y la carta NO final (fila desaparecida o no) ⇒ el 409 terminal de siempre', async () => {
    expect((await caught(svc().throwRejectWriteConflict(db('verificacion', null), 'it1', 'sr1'))).code).toBe('NO_LIVE_ADJUSTMENT');
    expect((await caught(svc().throwRejectWriteConflict(db('verificacion', 'aprobada'), 'it1', 'sr1'))).code).toBe(
      'NO_LIVE_ADJUSTMENT',
    );
  });
});
