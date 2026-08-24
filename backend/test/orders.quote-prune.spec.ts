import { OrdersService } from '../src/modules/orders/orders.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { computeCartBreakdown } from '../src/common/money';
import { DEFAULT_PRICING_CURVE } from '../src/common/pricing-curve';

const FEE = { stripePct: 0.036, stripeFixedCents: 300, stripeFeeIvaPct: 0.16 };
const IVA = 16;

/**
 * v1.21.3-quote-prune (API_CONTRACT §4, ARCHITECTURE §4.21h-1 caso v ajustado).
 *
 * POST /checkout/quote resuelve POR ÍTEM: una pieza muerta del carrito (`localStorage` envejece;
 * las piezas físicas únicas desaparecen al venderse) ya NO revienta la cotización entera con
 * `404`/`409` globales — viaja en `unavailableItems` con `200`. La regla de venta NO cambia
 * (plataforma + `{listed, in_stock}` + precio server-side): solo cambia el TRANSPORTE del fallo.
 * SESSION sigue ESTRICTA a propósito (anti double-sell): eso también se asegura aquí.
 */
describe('OrdersService — quote con poda por ítem (v1.21.3-quote-prune)', () => {
  /** Pieza de inventario mínima para `priceCartForOrder`/`priceCartForQuote` (con card+set como el include real). */
  const piece = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    folio: `INV-${id}`,
    cardId: `card-${id}`,
    productType: 'raw',
    rawCondition: 'NM',
    gradingCompany: null,
    gradeValue: null,
    finish: 'normal',
    ownerType: 'platform',
    status: 'listed',
    listPriceCents: 10000,
    card: { name: `Card ${id}`, rarity: 'Rare', number: '1', set: { name: 'Base' } },
    ...over,
  });

  function build(rows: Record<string, unknown>[]) {
    const db = new Map(rows.map((r) => [(r as { id: string }).id, r]));
    const prisma: any = {
      inventoryItem: {
        findMany: jest.fn(async ({ where }: any) =>
          (where.id.in as string[]).map((id) => db.get(id)).filter(Boolean),
        ),
      },
      // Session estricta: si el flujo llegara a crear la Order con una pieza muerta, el test truena.
      order: { create: jest.fn() },
      billingProfile: { findUnique: jest.fn(async () => null) },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    const settings: any = {
      getNumber: jest.fn(async () => IVA),
      getStripeFee: jest.fn(async () => FEE),
    };
    // Solo se toca si un ítem VÁLIDO no trae `listPriceCents` (ruta PRICE_PENDING).
    const pricing: any = {
      loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
      // v2.1.1 (§4.36.5b): el seam de VENTA devuelve una DECISIÓN (monto + veredicto). El mock usa
      // el CUERPO REAL (`PricingService.prototype`): es puro y no toca `this`, así que el test no
      // puede divergir de producción ni reimplementar la matemática.
      decideSalePrice: jest.fn(PricingService.prototype.decideSalePrice),
      gradeKeyFor: jest.fn(() => 'NM'),
      getReference: jest.fn(async () => ({ status: 'pending', referenceMxnCents: null })),
      // v2.1.1: el seam single delega en `decideSalePrice` y en `loadPricingCurve` del propio mock;
      // se usa el CUERPO REAL para que el test no reimplemente la precedencia de venta.
      computeSalePriceForItem: jest.fn(PricingService.prototype.computeSalePriceForItem),
      // v1.28 (P-18): sin fila M-30 por default (comportamiento previo).
      getVariantOverride: jest.fn(async () => null),
    };
    const svc = new OrdersService(
      prisma as PrismaService,
      pricing as PricingService,
      settings as SettingsService,
      {} as never,
      {} as never,
    );
    return { svc, prisma, settings, pricing };
  }

  it('1 vendida (cardName poblado) + 1 id inexistente (cardName null) + 2 vivas ⇒ 2 cotizadas y 2 podadas', async () => {
    const { svc } = build([
      piece('a'),
      piece('b', { status: 'shipped' }), // muerta: existe pero salió de {listed, in_stock}
      piece('d', { listPriceCents: 15000 }),
    ]);
    const res = await svc.quote(['a', 'b', 'no-existe', 'd']);

    expect(res.items.map((i: any) => i.inventoryItemId)).toEqual(['a', 'd']);
    expect(res.items.map((i: any) => i.unitPriceCents)).toEqual([10000, 15000]);
    // El breakdown se calcula SOLO con los válidos (los podados no suman al total).
    expect(res.breakdown).toEqual(computeCartBreakdown(25000, IVA, FEE));
    expect(res.unavailableItems).toEqual([
      { inventoryItemId: 'b', cardName: 'Card b' },
      { inventoryItemId: 'no-existe', cardName: null },
    ]);
  });

  it('una pieza que ya no es de plataforma (bóveda de un cliente) también se poda, con cardName', async () => {
    const { svc } = build([
      piece('a'),
      piece('v', { ownerType: 'customer', status: 'in_custody' }),
    ]);
    const res = await svc.quote(['a', 'v']);
    expect(res.items.map((i: any) => i.inventoryItemId)).toEqual(['a']);
    expect(res.unavailableItems).toEqual([{ inventoryItemId: 'v', cardName: 'Card v' }]);
  });

  it('carrito 100 % muerto ⇒ items: [], unavailableItems poblado y breakdown EN CEROS (misma forma)', async () => {
    const { svc, settings } = build([piece('b', { status: 'reserved' })]);
    const res = await svc.quote(['b', 'no-existe']);

    expect(res.items).toEqual([]);
    expect(res.unavailableItems).toEqual([
      { inventoryItemId: 'b', cardName: 'Card b' },
      { inventoryItemId: 'no-existe', cardName: null },
    ]);
    // EN CEROS de verdad: sin gross-up (cotizar la nada no puede producir un fee fijo > 0).
    expect(res.breakdown).toEqual({
      subtotalCents: 0,
      ivaCents: 0,
      ivaRatePct: IVA,
      processingFeeCents: 0,
      totalCents: 0,
      currency: 'MXN',
    });
    expect(settings.getStripeFee).not.toHaveBeenCalled();
  });

  it('compatibilidad: si todo el carrito resuelve, la forma previa NO cambia (solo se suma `[]`)', async () => {
    const { svc } = build([piece('a'), piece('d', { listPriceCents: 15000 })]);
    const res = await svc.quote(['a', 'd']);
    expect(res.breakdown).toEqual(computeCartBreakdown(25000, IVA, FEE));
    expect(res.items).toHaveLength(2);
    expect(res.unavailableItems).toEqual([]); // SIEMPRE presente, [] cuando todo resuelve
  });

  it('un id repetido en el carrito no cotiza dos veces la misma pieza única', async () => {
    const { svc } = build([piece('a')]);
    const res = await svc.quote(['a', 'a']);
    expect(res.items).toHaveLength(1);
    expect(res.breakdown.subtotalCents).toBe(10000);
  });

  describe('PRICE_PENDING (422) conserva su semántica pero se evalúa DESPUÉS de la poda', () => {
    it('un ítem VÁLIDO sin precio resoluble sigue disparando PRICE_PENDING', async () => {
      const { svc } = build([piece('p', { listPriceCents: null })]);
      await expect(svc.quote(['p'])).rejects.toMatchObject({ code: 'PRICE_PENDING' });
    });

    it('un ítem MUERTO sin precio NO lo dispara: se poda antes de tocar la regla de precios', async () => {
      const { svc, pricing } = build([
        piece('a'),
        piece('m', { status: 'shipped', listPriceCents: null }),
      ]);
      const res = await svc.quote(['a', 'm']);
      expect(res.items.map((i: any) => i.inventoryItemId)).toEqual(['a']);
      expect(res.unavailableItems).toEqual([{ inventoryItemId: 'm', cardName: 'Card m' }]);
      // La ruta de precios ni se enteró de la pieza muerta.
      expect(pricing.computeSalePriceForItem).not.toHaveBeenCalled();
    });
  });

  describe('ANTI-SOBRECORRECCIÓN — session sigue ESTRICTA (caso v, ARCHITECTURE §4.21h-1)', () => {
    it('priceCartForOrder (la ruta de las DOS sessions) con un id inexistente ⇒ 404 NOT_FOUND global', async () => {
      const { svc } = build([piece('a')]);
      await expect(svc.priceCartForOrder(['a', 'no-existe'])).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('priceCartForOrder con una pieza muerta ⇒ 409 ITEM_UNAVAILABLE global (sin poda)', async () => {
      const { svc } = build([piece('a'), piece('b', { status: 'picking' })]);
      await expect(svc.priceCartForOrder(['a', 'b'])).rejects.toMatchObject({
        code: 'ITEM_UNAVAILABLE',
      });
    });

    it('createSession con una pieza muerta ⇒ 409 ITEM_UNAVAILABLE y NO crea la Order', async () => {
      const { svc, prisma } = build([piece('b', { status: 'shipped' })]);
      await expect(svc.createSession('u1', ['b'], undefined)).rejects.toMatchObject({
        code: 'ITEM_UNAVAILABLE',
      });
      expect(prisma.order.create).not.toHaveBeenCalled();
    });

    it('createSession con un id inexistente ⇒ 404 NOT_FOUND y NO crea la Order', async () => {
      const { svc, prisma } = build([]);
      await expect(svc.createSession('u1', ['no-existe'], undefined)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(prisma.order.create).not.toHaveBeenCalled();
    });
  });
});
