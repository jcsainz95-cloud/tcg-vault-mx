import { describe, it, expect } from 'vitest';
import { overridePrice, updateSealedItemMapping, getPendingPrices } from './api';
import { ApiClientError } from './api-client';
import { mockInventory } from './mock/fixtures';

/**
 * # api.sealed-unmapped-mock.test.ts — el servidor falso replica `§M2-SK` SK-3 y el endpoint de mapeo
 *
 * Playwright corre en modo mocks: si el servidor falso aceptara un override de mercado sobre un
 * sellado sin mapeo, la pantalla podría ofrecer ese botón y nadie lo vería fallar hasta producción.
 * Por eso el mock rechaza igual que el backend (`422 SEALED_MARKET_KEY_REQUIRED`, contrato
 * `#sealed-market-key-required`) y el mock del mapeo (`PUT /admin/pricing/sealed/items/:itemId/mapping`,
 * contrato §M2 v1.23) valida lo mismo que el servidor: item sellado, `tcgplayerGroupId` obligatorio con
 * `productId`, enteros positivos, `applyToSiblings` que nunca pisa mapeos existentes.
 */

async function rejects(p: Promise<unknown>): Promise<ApiClientError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiClientError) return e;
    throw e;
  }
  throw new Error('esperaba rechazo');
}

describe('overridePrice (mock) · SK-3', () => {
  it('sealed + gradeKey "sealed" ⇒ 422 SEALED_MARKET_KEY_REQUIRED con remedy map_or_price_the_piece', async () => {
    const err = await rejects(
      overridePrice({ cardId: 'c-sealed-sv06-etb', gradeKey: 'sealed', finish: 'normal', productType: 'sealed', priceMxnCents: 180000 }),
    );
    expect(err.status).toBe(422);
    expect(err.code).toBe('SEALED_MARKET_KEY_REQUIRED');
    expect(err.details).toEqual({ gradeKey: 'sealed', remedy: 'map_or_price_the_piece' });
  });

  it('sealed MAPEADO (sealed:tcg:<id>) sigue aceptándose', async () => {
    await expect(
      overridePrice({ cardId: 'c-sealed-sv08-box', gradeKey: 'sealed:tcg:590413', finish: 'normal', productType: 'sealed', priceMxnCents: 320000 }),
    ).resolves.toEqual({ ok: true });
  });
});

describe('getPendingPrices (mock) · semilla', () => {
  it('trae UNA fila de sellado sin mapear (gradeKey "sealed") en la cola VENTA, para que Playwright la vea', async () => {
    const res = await getPendingPrices('inventory');
    const unmapped = res.data.filter((e) => e.productType === 'sealed' && e.gradeKey === 'sealed');
    expect(unmapped).toHaveLength(1);
    expect(unmapped[0].cardId).toBe('c-sealed-sv06-etb');
  });
});

describe('updateSealedItemMapping (mock) · PUT /admin/pricing/sealed/items/:itemId/mapping', () => {
  it('404 para un item inexistente', async () => {
    const err = await rejects(updateSealedItemMapping('inv-nope', { tcgplayerProductId: 570123, tcgplayerGroupId: 23821 }));
    expect(err.status).toBe(404);
    expect(err.code).toBe('NOT_FOUND');
  });

  it('422 VALIDATION_ERROR si el item no es sellado', async () => {
    const raw = mockInventory.find((i) => i.productType === 'raw')!;
    const err = await rejects(updateSealedItemMapping(raw.id, { tcgplayerProductId: 570123, tcgplayerGroupId: 23821 }));
    expect(err.status).toBe(422);
    expect(err.code).toBe('VALIDATION_ERROR');
  });

  it('422 VALIDATION_ERROR si viene productId sin groupId, o enteros no positivos', async () => {
    const e1 = await rejects(updateSealedItemMapping('inv-1009', { tcgplayerProductId: 570123 }));
    expect(e1.status).toBe(422);
    const e2 = await rejects(updateSealedItemMapping('inv-1009', { tcgplayerProductId: -1, tcgplayerGroupId: 23821 }));
    expect(e2.status).toBe(422);
    const e3 = await rejects(updateSealedItemMapping('inv-1009', { tcgplayerProductId: 1.5, tcgplayerGroupId: 23821 }));
    expect(e3.status).toBe(422);
  });

  it('asigna el mapeo; applyToSiblings copia a las piezas sin mapeo del mismo (cardId, subtype) y NO pisa mapeos', async () => {
    const before = mockInventory.filter((i) => i.productType === 'sealed').map((i) => ({ ...i }));
    try {
      // Hermanas fabricadas para la medición: una sin mapeo (se copia) y una ya mapeada (no se toca).
      const base = mockInventory.find((i) => i.id === 'inv-1009')!;
      mockInventory.push(
        { ...base, id: 'inv-sib-unmapped', folio: 'INV-SIB-1' },
        { ...base, id: 'inv-sib-mapped', folio: 'INV-SIB-2', tcgplayerProductId: 111, tcgplayerGroupId: 222 },
        { ...base, id: 'inv-sib-other-subtype', folio: 'INV-SIB-3', sealedSubtype: 'box' },
      );

      const res = await updateSealedItemMapping('inv-1009', {
        tcgplayerProductId: 570123,
        tcgplayerGroupId: 23821,
        applyToSiblings: true,
      });
      expect(res).toEqual({
        inventoryItemId: 'inv-1009',
        tcgplayerProductId: 570123,
        tcgplayerGroupId: 23821,
        siblingsUpdated: 1,
      });
      const byId = (id: string) => mockInventory.find((i) => i.id === id)!;
      expect(byId('inv-1009').tcgplayerProductId).toBe(570123);
      expect(byId('inv-sib-unmapped').tcgplayerProductId).toBe(570123);
      expect(byId('inv-sib-unmapped').tcgplayerGroupId).toBe(23821);
      expect(byId('inv-sib-mapped').tcgplayerProductId).toBe(111);
      expect(byId('inv-sib-other-subtype').tcgplayerProductId).toBeUndefined();

      // Desmapear: `null` limpia ambos.
      const off = await updateSealedItemMapping('inv-1009', { tcgplayerProductId: null });
      expect(off).toEqual({ inventoryItemId: 'inv-1009', tcgplayerProductId: null, tcgplayerGroupId: null, siblingsUpdated: 0 });
      expect(byId('inv-1009').tcgplayerProductId).toBeUndefined();
    } finally {
      // Restaura la semilla: otras suites leen `mockInventory`.
      for (let i = mockInventory.length - 1; i >= 0; i--) {
        if (mockInventory[i].id.startsWith('inv-sib-')) mockInventory.splice(i, 1);
      }
      for (const b of before) Object.assign(mockInventory.find((i) => i.id === b.id)!, b);
    }
  });
});
