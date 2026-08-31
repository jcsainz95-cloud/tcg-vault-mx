import { describe, it, expect } from 'vitest';
import { getCheckoutQuote, getGuestCheckoutQuote, MOCK_QUOTE_CARD_KEYS, MOCK_QUOTE_ITEM_KEYS } from './api';
import * as fx from './mock/fixtures';

/**
 * PIN de la forma de `OrderItemPreview` / `OrderItemCardDTO` (contrato §4, v1.51-b).
 *
 * Por qué existe: el mock de este endpoint devolvía el `CardDTO` COMPLETO del fixture, así que
 * el carrito se veía perfecto en `dev` y en los e2e de Playwright y llegaba sin miniatura a
 * producción — el simulador tapó el bug hasta que lo vio un usuario. En el pase anterior el
 * mock se corrigió a la forma que el backend servía ENTONCES (ocho campos, sin imagen) y este
 * test se dejó fallando a propósito «hacia arriba»: en cuanto el backend añadiera
 * `imageSmallUrl`, obligaría a mover mock y pin en el mismo commit.
 *
 * Eso ya pasó (contrato v1.51-b + backend `8c6f2ba`), así que el pin se actualiza contra el
 * contrato nuevo: nueve llaves dentro de `card` —incluida `imageSmallUrl`— y TRES al nivel del
 * ítem. Lo segundo importa tanto como lo primero: `productType`/`rawCondition` viajan DENTRO de
 * `card`, y leerlos al nivel del ítem es lo que dejaba el sufijo «· NM» siempre en blanco.
 */
describe('quotes de compra (rama mock) · forma de OrderItemPreview / OrderItemCardDTO', () => {
  const ids = fx.mockListings.filter((l) => l.sellable).slice(0, 2).map((l) => l.inventoryItemId);

  it('el mock replica EXACTAMENTE las llaves del `card` del backend', async () => {
    expect(ids.length).toBeGreaterThan(0);
    const res = await getCheckoutQuote(ids);
    expect(res.items).toHaveLength(ids.length);
    for (const item of res.items) {
      // `Object.keys` incluye las llaves con valor `undefined` (rawCondition en graded, etc.):
      // lo que se pinea es la FORMA, no qué piezas del fixture traen cada campo.
      expect(Object.keys(item.card).sort()).toEqual([...MOCK_QUOTE_CARD_KEYS].sort());
    }
  });

  it('el ítem tiene TRES llaves: nada de `productType` suelto al nivel del ítem', async () => {
    const res = await getCheckoutQuote(ids);
    for (const item of res.items) {
      expect(Object.keys(item).sort()).toEqual([...MOCK_QUOTE_ITEM_KEYS].sort());
      // Espejo exacto del test del backend (`expect(preview).not.toHaveProperty('productType')`).
      expect(item).not.toHaveProperty('productType');
      expect(item).not.toHaveProperty('rawCondition');
    }
  });

  it('`imageSmallUrl` está SIEMPRE presente (clave estable, valor nullable)', async () => {
    const res = await getCheckoutQuote(ids);
    for (const item of res.items) {
      expect(item.card).toHaveProperty('imageSmallUrl');
      expect(item.card.imageSmallUrl === null || typeof item.card.imageSmallUrl === 'string').toBe(true);
    }
  });

  it('el `card` NO es un CardDTO: no inventa los campos que esta ruta no sirve', async () => {
    const res = await getCheckoutQuote(ids);
    for (const item of res.items) {
      const card = item.card as unknown as Record<string, unknown>;
      // Los cinco que el contrato §4 declara ausentes por nombre.
      for (const absent of ['id', 'externalId', 'imageLargeUrl', 'rarity', 'supertype']) {
        expect(card[absent]).toBeUndefined();
      }
    }
  });

  it('el camino de INVITADO (§4-G.1) sirve la misma forma', async () => {
    const res = await getGuestCheckoutQuote(ids);
    expect(res.items).toHaveLength(ids.length);
    for (const item of res.items) {
      expect(Object.keys(item).sort()).toEqual([...MOCK_QUOTE_ITEM_KEYS].sort());
      expect(Object.keys(item.card).sort()).toEqual([...MOCK_QUOTE_CARD_KEYS].sort());
    }
  });
});
