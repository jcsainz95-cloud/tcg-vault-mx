/**
 * TL-ALTA-2 (A2, contrato v1.116.8 I-6 «Acabado del alta»): el simulador de `POST /admin/inventory/items/batch` valida el
 * acabado como el backend (`inventory.service.ts:971`): con `cardProductId`, contra los acabados de ESE producto de liga
 * (`P.finishes`), no contra `Card.availableFinishes`; sin liga, contra los de la carta. Fuera ⇒ `422 FINISH_NOT_AVAILABLE`
 * por línea. Canario: quitar la comprobación de `productCombos.some(...)` en `mockBatchCreate` ⇒ el primer caso se pone rojo.
 */
import { describe, it, expect } from 'vitest';
import { mockBatchCreate } from './fixtures';
import type { BatchInventoryItemInput } from '@/types/contract';

const line = (o: Partial<BatchInventoryItemInput>): BatchInventoryItemInput => ({
  cardId: 'c-pawmi-sv08',
  productType: 'raw',
  rawCondition: 'NM',
  finish: 'normal',
  qty: 1,
  acquisitionType: 'compra',
  acquisitionCostCents: 1000,
  ...o,
});

describe('mockBatchCreate · acabado validado contra los acabados del producto de liga (TL-ALTA-2)', () => {
  it('liga + acabado que ese producto NO tiene (Promo de Liga solo en Holo, `finish:normal`) ⇒ FINISH_NOT_AVAILABLE', () => {
    const res = mockBatchCreate({ batchKey: 'tl-alta-2-a', items: [line({ cardProductId: 651001, finish: 'normal' })] });
    expect(res.summary).toMatchObject({ createdItems: 0, failedLines: 1 });
    expect(res.results[0]).toMatchObject({ ok: false, error: { code: 'FINISH_NOT_AVAILABLE' } });
  });

  it('liga + acabado del producto aunque la carta NO lo tenga (casilla solo `normal`, liga en Holo) ⇒ se crea con su versión', () => {
    const res = mockBatchCreate({ batchKey: 'tl-alta-2-b', items: [line({ cardProductId: 651001, finish: 'holofoil' })] });
    expect(res.summary).toMatchObject({ createdItems: 1, failedLines: 0 });
    expect(res.results[0]).toMatchObject({ ok: true });
  });

  it('liga con dos acabados: cada uno de los suyos pasa; uno ajeno no', () => {
    const ok = mockBatchCreate({ batchKey: 'tl-alta-2-c', items: [line({ cardProductId: 651002, finish: 'reverse_holo' }), line({ cardProductId: 651002, finish: 'holofoil' }), line({ cardProductId: 651002, finish: 'normal' })] });
    expect(ok.results.map((r) => (r.ok ? 'ok' : r.error.code))).toEqual(['ok', 'ok', 'FINISH_NOT_AVAILABLE']);
  });

  it('sin liga: el acabado se valida contra los de la carta, como siempre', () => {
    const res = mockBatchCreate({ batchKey: 'tl-alta-2-d', items: [line({ finish: 'holofoil' }), line({ finish: 'normal' })] });
    expect(res.results.map((r) => (r.ok ? 'ok' : r.error.code))).toEqual(['FINISH_NOT_AVAILABLE', 'ok']);
  });

  it('`cardProductId` que no es un producto de liga de la carta ⇒ VALIDATION_ERROR (sin cambio)', () => {
    const res = mockBatchCreate({ batchKey: 'tl-alta-2-e', items: [line({ cardProductId: 648703, finish: 'holofoil' })] });
    expect(res.results[0]).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
  });
});
