import { describe, it, expect } from 'vitest';
import { getCheckoutQuote, MOCK_QUOTE_CARD_KEYS } from './api';
import * as fx from './mock/fixtures';

/**
 * PIN de la forma del `card` que devuelve `POST /checkout/quote`.
 *
 * Por qué existe: el mock de este endpoint devolvía el `CardDTO` COMPLETO del fixture
 * (con `imageSmallUrl`), pero el backend real devuelve un snapshot plano sin imagen
 * (`OrdersService.quote()` → `cardSnapshot()`). Resultado: el carrito se veía perfecto en
 * `dev` y en los e2e de Playwright, y llegaba sin miniatura a producción — el simulador
 * tapó el bug hasta que lo vio un usuario.
 *
 * Este test NO bendice la ausencia de la imagen: la deja VISIBLE y con dueño. Cuando el
 * backend añada `imageSmallUrl` a este camino (lo que CheckoutView necesita para pintar la
 * miniatura), este test falla y obliga a actualizar mock + lista en el mismo commit; así el
 * mock tampoco se queda mintiendo en la dirección contraria.
 */
describe('POST /checkout/quote (rama mock) · forma del snapshot de carta', () => {
  const ids = fx.mockListings.filter((l) => l.sellable).slice(0, 2).map((l) => l.inventoryItemId);

  it('el mock replica EXACTAMENTE las llaves del snapshot del backend', async () => {
    expect(ids.length).toBeGreaterThan(0);
    const res = await getCheckoutQuote(ids);
    expect(res.items).toHaveLength(ids.length);
    for (const item of res.items) {
      // `Object.keys` incluye las llaves con valor `undefined` (rawCondition en graded, etc.):
      // lo que se pinea es la FORMA, no qué piezas del fixture traen cada campo.
      expect(Object.keys(item.card).sort()).toEqual([...MOCK_QUOTE_CARD_KEYS].sort());
    }
  });

  it('el backend NO manda la imagen en este camino: el mock tampoco la inventa', async () => {
    const res = await getCheckoutQuote(ids);
    for (const item of res.items) {
      const card = item.card as unknown as Record<string, unknown>;
      expect(card.imageSmallUrl).toBeUndefined();
      expect(card.imageLargeUrl).toBeUndefined();
    }
    // Divergencia declarada: el TIPO (`OrderItemPreview.card: CardDTO`) exige `imageSmallUrl`
    // y el backend no lo cumple. Alinear el tipo es cambio de contrato ⇒ ARQUITECTO (regla 9).
  });
});
