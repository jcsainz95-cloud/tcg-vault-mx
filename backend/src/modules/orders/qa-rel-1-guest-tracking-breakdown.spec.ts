/**
 * QA-REL-1 (QA, 2026-10-19) — el seguimiento público del invitado (`POST /orders/guest/track`,
 * contrato §4-G.3) devuelve `breakdown: BreakdownDTO` **completo** (§M10-IVA.4): con
 * `priceConvention` e `ivaIncluded` de **la columna de ESA orden** (`IVA-3`), y el mismo desglose
 * que el resto de vistas del pedido (`OrdersService.breakdownOf` + `shippingFeeCents`).
 *
 * Defecto medido: `toTrackingDto` armaba el desglose a mano sin esos dos campos ⇒ el front
 * (`AmountBreakdown`, `ivaIncluded !== true`) pintaba «IVA 16%» como SUMANDO en un pedido
 * `IVA_INCLUSIVE` y el total no cuadraba (D54, criterio 190).
 *
 * Ninguna aserción mide un nombre de campo por sí solo: miden cómo se lee el dinero que sale.
 */
import { GuestCheckoutService } from './guest-checkout.service';
import { OrdersService } from './orders.service';

type Convention = 'IVA_INCLUSIVE' | 'IVA_EXCLUSIVE';

const svc = new GuestCheckoutService(null as never, null as never, null as never, null as never, null as never, null as never);
const track = (order: unknown) =>
  (svc as unknown as { toTrackingDto: (o: unknown, exp: Date) => Record<string, any> }).toTrackingDto(
    order,
    new Date(Date.now() + 3600_000),
  );

/** Pedido de invitado `direct_ship` mínimo, con el dinero que el test fija. */
const guestOrder = (money: {
  priceConvention: unknown;
  subtotalCents: number;
  shippingFeeCents: number;
  ivaCents: number;
  processingFeeCents: number;
  totalCents: number;
}) => ({
  orderNumber: 'TCG-000777',
  status: 'settled',
  createdAt: new Date('2026-10-01T12:00:00Z'),
  settledAt: new Date('2026-10-01T12:05:00Z'),
  guestEmail: 'invitado@example.com',
  claimedAt: null,
  ivaRatePct: 16,
  currency: 'MXN',
  paymentMethodBrand: 'visa',
  paymentMethodLast4: '4242',
  locale: 'es',
  fulfillmentMode: 'direct_ship',
  shippingAddressSnapshot: { city: 'CDMX', state: 'CDMX', postalCode: '06600', recipientName: 'Juan Pérez', line1: 'x', phone: '5500000000', country: 'MX' },
  shipmentRequests: [],
  refunds: [],
  accessoryLines: [],
  items: [
    {
      unitPriceCents: money.subtotalCents,
      refund: null,
      inventoryItem: {
        finish: 'normal',
        productType: 'single',
        rawCondition: 'NM',
        sealedSubtype: null,
        gradingCompany: null,
        gradeValue: null,
        sealedProductId: null,
        sealedProductName: null,
        sealedImageUrl: null,
        card: { name: 'Pikachu', number: '025', imageSmallUrl: null, set: { name: 'Base' } },
      },
    },
  ],
  ...money,
});

// Pedido IVA_INCLUSIVE con envío (forma de IVA-9): S=11600, E=20300, iva residual 4400 DENTRO de S+E.
// total = S + E + fee (identidad (b) de §M10-IVA.4) — el IVA NO es sumando.
const INCLUSIVE = { priceConvention: 'IVA_INCLUSIVE' as Convention, subtotalCents: 11600, shippingFeeCents: 20300, ivaCents: 4400, processingFeeCents: 1173, totalCents: 33073 };
// Pedido legado IVA_EXCLUSIVE (forma de IVA-3): total = S + E + iva + fee — el IVA SÍ suma.
const EXCLUSIVE = { priceConvention: 'IVA_EXCLUSIVE' as Convention, subtotalCents: 10000, shippingFeeCents: 17500, ivaCents: 4400, processingFeeCents: 1150, totalCents: 33050 };

describe('QA-REL-1 — `GuestOrderTrackingDTO.breakdown` es un BreakdownDTO completo (§4-G.3, §M10-IVA.4)', () => {
  it('IVA_INCLUSIVE ⇒ priceConvention IVA_INCLUSIVE + ivaIncluded true (la línea de IVA INFORMA, no suma)', () => {
    const { breakdown } = track(guestOrder(INCLUSIVE));
    expect(breakdown).toEqual({
      subtotalCents: 11600,
      shippingFeeCents: 20300,
      ivaCents: 4400,
      ivaRatePct: 16,
      processingFeeCents: 1173,
      totalCents: 33073,
      currency: 'MXN',
      priceConvention: 'IVA_INCLUSIVE',
      ivaIncluded: true,
    });
    // Identidad (b): con la convención que el DTO declara, el total cuadra SIN sumar el IVA.
    expect(breakdown.ivaIncluded).toBe(true);
    expect(breakdown.subtotalCents + breakdown.shippingFeeCents + breakdown.processingFeeCents).toBe(breakdown.totalCents);
  });

  it('IVA-3: una orden legada IVA_EXCLUSIVE NO se reinterpreta (la convención sale de SU columna)', () => {
    const { breakdown } = track(guestOrder(EXCLUSIVE));
    expect(breakdown.priceConvention).toBe('IVA_EXCLUSIVE');
    expect(breakdown.ivaIncluded).toBe(false);
    // Y con esa lectura el total cuadra sumando el IVA: el número legado sigue siendo coherente.
    expect(breakdown.subtotalCents + breakdown.shippingFeeCents + breakdown.ivaCents + breakdown.processingFeeCents).toBe(breakdown.totalCents);
  });

  it.each([INCLUSIVE, EXCLUSIVE])('mismo desglose que el resto de vistas del pedido (OrdersService.breakdownOf + envío) — %#', (money) => {
    const order = guestOrder(money);
    const orders = Object.create(OrdersService.prototype) as OrdersService;
    expect(track(order).breakdown).toEqual({ ...orders.breakdownOf(order as never), shippingFeeCents: money.shippingFeeCents });
  });

  it('una convención desconocida o ausente LANZA — sin `??` por defecto que reinterprete la orden (IVA-3)', () => {
    expect(() => track(guestOrder({ ...INCLUSIVE, priceConvention: undefined }))).toThrow(/priceConvention/);
    expect(() => track(guestOrder({ ...INCLUSIVE, priceConvention: 'IVA_MAYBE' }))).toThrow(/priceConvention/);
  });
});
