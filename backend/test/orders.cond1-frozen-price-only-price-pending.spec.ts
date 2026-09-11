import { OrdersService } from '../src/modules/orders/orders.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { StripeService } from '../src/modules/payments/stripe.service';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { BusinessException } from '../src/common/business.exception';

/**
 * ⭐⭐ **COND-1 (techlead, 2026-09-11) — el respaldo al precio CONGELADO solo lo abre `PRICE_PENDING`.**
 *
 * Las dos rutas que recuperan una pieza ya reservada por el propio cliente —`priceCartForOrder`
 * (session: lo que el PaymentIntent va a cobrar) y `priceCartForQuote` (lectura del carrito)—
 * atrapaban **toda** la clase `BusinessException` y caían a la línea congelada. Con el código de
 * hoy la conducta es idéntica (`salePriceOf` solo lanza `PRICE_PENDING`), así que **este archivo no
 * arregla un síntoma: cierra un seam.**
 *
 * Por qué importa, y por qué es de dinero: `PricingService.computeSalePriceForItem` es el **seam
 * único donde vive el guardarraíl de venta** (§4.36.5b — hoy: «una premium en el piso NO se
 * vende»). El día que ese seam emita un código propio distinto de `PRICE_PENDING`, el `catch` ancho
 * lo habría **tragado en silencio** justo para las piezas reservadas por el propio cliente: la
 * pieza se habría cobrado al precio congelado, esquivando el guardarraíl, sin un solo log.
 *
 * **Mutación que debe poner esto rojo:** volver a `if (!(e instanceof BusinessException) || …)` en
 * `orders.service.ts` (cualquiera de los dos sitios) ⇒ el caso «propaga cualquier otro código» de
 * la ruta correspondiente falla, porque el error se traga y sale una línea al precio congelado.
 */

const FROZEN_PRICE = 12_345;
const CATALOG_PRICE = 99_900;

const item = {
  id: 'item-1',
  folio: 'F-0001',
  status: 'reserved',
  ownerType: 'platform',
  productType: 'raw',
  finish: 'normal',
  cardId: 'card-1',
  listPriceCents: null,
  card: { id: 'card-1', name: 'Pikachu', rarity: 'Common', rarityCanonical: 'common', set: { name: 'Base' } },
} as any;

/** La `OrderItem` congelada de la orden propia (lo que su PaymentIntent ya cobra). */
const frozenOrderItem = {
  inventoryItemId: 'item-1',
  unitPriceCents: FROZEN_PRICE,
  marketMxnCents: 20_000,
  priceBasis: 'market',
  marketBracket: null,
  finish: 'normal',
} as any;

/**
 * Construye el servicio con un `computeSalePriceForItem` guionizado: es el SEAM del guardarraíl,
 * el punto exacto donde nacerá el código nuevo el día que nazca.
 */
function build(saleSeam: () => Promise<unknown>, itemOver: Record<string, unknown> = {}) {
  const prisma: any = {
    inventoryItem: { findMany: jest.fn(async () => [{ ...item, ...itemOver }]) },
    order: { findMany: jest.fn(async () => []) },
  };
  const pricing: any = {
    gradeKeyFor: jest.fn(() => 'raw:NM'),
    tryGradeKeyFor: jest.fn(() => 'raw:NM'),
    getReference: jest.fn(async () => ({ status: 'priced', referenceMxnCents: 50_000 })),
    getVariantOverride: jest.fn(async () => null),
    computeSalePriceForItem: jest.fn(saleSeam),
  };
  const svc = new OrdersService(
    prisma as PrismaService,
    pricing as PricingService,
    {} as SettingsService,
    {} as StripeService,
    {} as CatalogService,
  );
  return { svc, prisma, pricing };
}

/** El seam que hoy existe: sin dato de mercado ⇒ `pending` ⇒ `salePriceOf` lanza `PRICE_PENDING`. */
const seamPricePending = async () => ({ priceCents: null, basis: 'pending', pendingReason: 'no_market' });
/** El seam del futuro: un veredicto del guardarraíl con SU PROPIO código. */
const seamOtroCodigo = async () => {
  throw BusinessException.conflict('ITEM_UNAVAILABLE', 'premium en el piso: no se vende');
};
/** El seam feliz. */
const seamOk = async () => ({ priceCents: CATALOG_PRICE, basis: 'market', marketMxnCents: 50_000 });

describe('COND-1 · priceCartForOrder (session — lo que el PaymentIntent cobra)', () => {
  const ownReserved = new Map([['item-1', frozenOrderItem]]);

  it('`PRICE_PENDING` con reserva propia ⇒ cae al precio CONGELADO (§4-R.2 regla 5, intacto)', async () => {
    const { svc } = build(seamPricePending);
    const out = await svc.priceCartForOrder(['item-1'], ownReserved as any);
    expect(out.lines[0].unitPriceCents).toBe(FROZEN_PRICE);
    expect(out.subtotalCents).toBe(FROZEN_PRICE);
  });

  it('⭐ CUALQUIER OTRO código PROPAGA: no se traga ni se cobra el precio congelado', async () => {
    const { svc } = build(seamOtroCodigo);
    await expect(svc.priceCartForOrder(['item-1'], ownReserved as any)).rejects.toMatchObject({
      code: 'ITEM_UNAVAILABLE',
    });
  });

  it('sin reserva propia, `PRICE_PENDING` propaga igual que siempre (no hay nada que congelar)', async () => {
    // Pieza `listed` (vendible) y SIN entrada en `ownReserved` ⇒ no hay respaldo congelado.
    const { svc } = build(seamPricePending, { status: 'listed' });
    await expect(svc.priceCartForOrder(['item-1'])).rejects.toMatchObject({ code: 'PRICE_PENDING' });
  });

  it('camino feliz: si el catálogo resuelve, gana el precio de catálogo (no el congelado)', async () => {
    const { svc } = build(seamOk);
    const out = await svc.priceCartForOrder(['item-1'], ownReserved as any);
    expect(out.lines[0].unitPriceCents).toBe(CATALOG_PRICE);
  });
});

describe('COND-1 · priceCartForQuote (lectura del carrito)', () => {
  /**
   * La orden propia `pending` que retiene la pieza, SIN `coversCart` (más ítems de los que se
   * cotizan) para que `frozenOrder` sea `null` y el quote entre por la rama del `try/catch` —que es
   * la que COND-1 estrecha— en vez de por el atajo de `frozenLineByItem`.
   */
  const ownOrders = [
    {
      id: 'ord-1',
      orderNumber: 'TCG-000001',
      status: 'pending',
      items: [frozenOrderItem, { inventoryItemId: 'item-otro', unitPriceCents: 1 }],
      reservedItems: [{ id: 'item-1', reservedUntil: new Date(Date.now() + 600_000) }],
    },
  ];

  function buildQuote(seam: () => Promise<unknown>) {
    const b = build(seam);
    b.prisma.order.findMany = jest.fn(async () => ownOrders);
    return b;
  }

  it('`PRICE_PENDING` sobre pieza reservada por mí ⇒ cae al precio CONGELADO de mi orden', async () => {
    const { svc } = buildQuote(seamPricePending);
    const out = await svc.priceCartForQuote(['item-1'], { userId: 'u-1' });
    expect(out.lines[0].unitPriceCents).toBe(FROZEN_PRICE);
    expect(out.reservedByYou.has('item-1')).toBe(true);
  });

  it('⭐ CUALQUIER OTRO código PROPAGA: no se traga ni se cotiza el precio congelado', async () => {
    const { svc } = buildQuote(seamOtroCodigo);
    await expect(svc.priceCartForQuote(['item-1'], { userId: 'u-1' })).rejects.toMatchObject({
      code: 'ITEM_UNAVAILABLE',
    });
  });

  it('camino feliz: el catálogo resuelve ⇒ precio de catálogo', async () => {
    const { svc } = buildQuote(seamOk);
    const out = await svc.priceCartForQuote(['item-1'], { userId: 'u-1' });
    expect(out.lines[0].unitPriceCents).toBe(CATALOG_PRICE);
  });
});
