import { ConfigService } from '@nestjs/config';
import { OrdersService } from '../src/modules/orders/orders.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { StripeService } from '../src/modules/payments/stripe.service';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { BuylistService } from '../src/modules/buylist/buylist.service';
import { UsersService } from '../src/modules/users/users.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { AdminService } from '../src/modules/admin/admin.service';
import { UploadsService } from '../src/modules/uploads/uploads.service';
import { DEFAULT_PRICING_CURVE, marketBracketOf } from '../src/common/pricing-curve';

/**
 * E6 (ARCHITECTURE §4.36.7c · PROJECT §N.8, criterio 95) — **INSTRUMENTACIÓN**.
 *
 * Hoy no se puede contestar «¿qué tan rápido rota cada bracket?», y ese es justo el dato que falta
 * para calibrar la curva con realidad en vez de con supuestos. Cada VENTA y cada COMPRA registran
 * los CINCO datos de §N.8: mercado del día (crudo), precio final, qué lo determinó (`priceBasis`),
 * acabado y bracket de mercado.
 *
 * NO se crea una tabla de log: se escriben en las filas de dinero que YA son el snapshot inmutable
 * y transaccional de la operación, así que no pueden desincronizarse de ella y toda pregunta de
 * rotación/margen se responde sin join.
 */

const pii = new PiiCryptoService(new ConfigService({}));

describe('E6 — instrumentación de VENTA: se congela con `unitPriceCents` (checkout)', () => {
  function ordersWith(referenceMxnCents: number | null, over: Record<string, unknown> = {}) {
    const item = {
      id: 'i1',
      folio: 'INV-1',
      cardId: 'c1',
      productType: 'raw',
      rawCondition: 'NM',
      sealedSubtype: null,
      gradingCompany: null,
      gradeValue: null,
      certNumber: null,
      status: 'listed',
      finish: 'holofoil',
      ownerType: 'platform',
      listPriceCents: null,
      card: { id: 'c1', name: 'N', number: '1', rarity: 'Common', set: { name: 'S' } },
      ...over,
    };
    const prisma = { inventoryItem: { findMany: jest.fn(async () => [item]) } } as unknown as PrismaService;
    const pricing = {
      loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
      // v2.1.1 (§4.36.5b): el seam de VENTA devuelve una DECISIÓN (monto + veredicto). El mock usa
      // el CUERPO REAL (`PricingService.prototype`): es puro y no toca `this`, así que el test no
      // puede divergir de producción ni reimplementar la matemática.
      decideSalePrice: jest.fn(PricingService.prototype.decideSalePrice),
      gradeKeyFor: jest.fn(() => 'raw:NM'),
      getReference: jest.fn(async () =>
        referenceMxnCents == null ? { status: 'pending' } : { status: 'priced', referenceMxnCents },
      ),
      // v2.1.1: el seam single delega en `decideSalePrice` y en `loadPricingCurve` del propio mock;
      // se usa el CUERPO REAL para que el test no reimplemente la precedencia de venta.
      computeSalePriceForItem: jest.fn(PricingService.prototype.computeSalePriceForItem),
      getVariantOverride: jest.fn(async () => null),
    } as unknown as PricingService;
    const settings = {
      getNumber: jest.fn(async () => 16),
      getStripeFee: jest.fn(async () => ({ stripePct: 0.036, stripeFixedCents: 300, stripeFeeIvaPct: 0.16 })),
    } as unknown as SettingsService;
    return new OrdersService(prisma, pricing, settings, {} as StripeService, {} as CatalogService);
  }

  it('los CINCO datos de §N.8 viajan en la línea de la orden', async () => {
    const svc = ordersWith(10000); // $100 de mercado ⇒ venta $115
    const { lines } = await svc.priceCartForOrder(['i1']);
    expect(lines[0]).toMatchObject({
      unitPriceCents: 11500, // (1) precio final
      marketMxnCents: 10000, // (2) mercado CRUDO del día
      priceBasis: 'market', // (3) qué lo determinó
      finish: 'holofoil', // (4) acabado
      marketBracket: 'r80_300', // (5) bracket (escala FIJA)
    });
  });

  it('el bracket sale de la ESCALA FIJA, no de la curva vigente', async () => {
    const svc = ordersWith(200); // $2 ⇒ bracket lt_3
    const { lines } = await svc.priceCartForOrder(['i1']);
    expect(lines[0].marketBracket).toBe(marketBracketOf(200));
    expect(lines[0].marketBracket).toBe('lt_3');
  });

  it('override POR PIEZA ⇒ basis `override` y mercado/bracket en NULL (honesto, jamás un 0)', async () => {
    const svc = ordersWith(10000, { listPriceCents: 9999 });
    const { lines } = await svc.priceCartForOrder(['i1']);
    expect(lines[0]).toMatchObject({
      unitPriceCents: 9999,
      priceBasis: 'override',
      marketMxnCents: null,
      marketBracket: null,
    });
  });

  it('cuando gana el PISO el basis lo dice, y el mercado crudo se conserva', async () => {
    const svc = ordersWith(114); // $1.14 ⇒ gana el piso $25
    const { lines } = await svc.priceCartForOrder(['i1']);
    expect(lines[0]).toMatchObject({
      unitPriceCents: 2500,
      priceBasis: 'floor',
      marketMxnCents: 114,
      marketBracket: 'lt_3',
    });
  });
});

describe('E6 — instrumentación de COMPRA: se congela con `quotedPriceCents` (createRequest)', () => {
  function buylistWith(referenceMxnCents: number | null, override: Record<string, unknown> | null = null) {
    const created: Record<string, unknown>[] = [];
    const prisma = {
      card: {
        findUnique: jest.fn(async () => ({ id: 'c1', rarity: 'Common', availableFinishes: ['normal', 'reverse_holo'] })),
        // v2.1.1: `createRequest` carga las cartas EN LOTE (mata el N+1 que hacía un
        // `findUnique` por ítem). Delega en el MISMO `findUnique` del fixture (`this`).
        findMany: jest.fn(async function (this: any, args: any) {
          const ids: string[] = args?.where?.id?.in ?? [];
          const rows = await Promise.all(ids.map((id) => this.findUnique({ where: { id } })));
          return rows.filter(Boolean);
        }),
      },
      kycProfile: { findUnique: jest.fn(async () => null), upsert: jest.fn() },
      sellRequest: {
        aggregate: jest.fn(async () => ({ _sum: { quotedTotalCents: 0 } })),
        create: jest.fn(async ({ data }: { data: { status: string; quotedTotalCents: number; items: { create: Record<string, unknown>[] } } }) => {
          created.push(...data.items.create);
          return {
            id: 'sr-1',
            status: data.status,
            quotedTotalCents: data.quotedTotalCents,
            items: data.items.create.map((it, i) => ({ id: `it-${i}`, card: { id: 'c1', name: 'X', number: '1' }, ...it })),
          };
        }),
      },
      $transaction: jest.fn(async (cb: (p: unknown) => unknown) => cb(prisma)),
    } as unknown as PrismaService & { sellRequest: { create: jest.Mock } };
    const pricing = {
      loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
      // v2.1.1 (§4.36.5b): el seam de VENTA devuelve una DECISIÓN (monto + veredicto). El mock usa
      // el CUERPO REAL (`PricingService.prototype`): es puro y no toca `this`, así que el test no
      // puede divergir de producción ni reimplementar la matemática.
      decideSalePrice: jest.fn(PricingService.prototype.decideSalePrice),
      gradeKeyFor: jest.fn(() => 'raw:NM'),
      getReference: jest.fn(async () =>
        referenceMxnCents == null ? { status: 'pending' } : { status: 'priced', referenceMxnCents },
      ),
      getVariantOverridesBatch: jest.fn(async (keys: { cardId: string; productType: string; gradeKey: string; finish: string }[]) => {
        const m = new Map<string, unknown>();
        if (override) for (const k of keys) m.set(`${k.cardId}|${k.productType}|${k.gradeKey}|${k.finish}`, override);
        return m;
      }),
      settlePendingForVariant: jest.fn(async () => undefined),
      escalatePending: jest.fn(),
    } as unknown as PricingService;
    const settings = {
      getRaw: jest.fn(),
      getNumber: jest.fn(async () => 100_000_000),
    } as unknown as SettingsService;
    return {
      svc: new BuylistService(prisma, pricing, settings, {} as UsersService, pii),
      created,
    };
  }

  it('los CINCO datos de §N.8 se PERSISTEN en el SellRequestItem', async () => {
    const { svc, created } = buylistWith(10000); // $100 ⇒ compra $40
    const res = await svc.createRequest(
      'u1',
      [{ cardId: 'c1', productType: 'raw' as never, rawCondition: 'NM' as never, finish: 'reverse_holo' as never }],
      '012345678901234567',
    );
    expect(created[0]).toMatchObject({
      quotedPriceCents: 4000, // (1) precio final
      marketMxnCents: 10000, // (2) mercado CRUDO
      priceBasis: 'market', // (3) qué lo determinó
      finish: 'reverse_holo', // (4) acabado
      marketBracket: 'r80_300', // (5) bracket
    });
    // …y se reflejan en el DTO de respuesta (SellItemDTO).
    expect(res.items[0]).toMatchObject({ priceBasis: 'market', marketMxnCents: 10000, marketBracket: 'r80_300' });
  });

  it('bounty sin referencia ⇒ basis `bounty` con mercado y bracket en NULL', async () => {
    const { svc, created } = buylistWith(null, { bountyEnabled: true, bountyPriceCents: 250000 });
    await svc.createRequest(
      'u1',
      [{ cardId: 'c1', productType: 'raw' as never, rawCondition: 'NM' as never }],
      '012345678901234567',
    );
    expect(created[0]).toMatchObject({
      quotedPriceCents: 250000,
      priceBasis: 'bounty',
      marketMxnCents: null,
      marketBracket: null,
    });
  });

  it('las columnas LEGACY (`ruleMode`/`ruleValue`/`ruleSource`) ya no se escriben', async () => {
    const { svc, created } = buylistWith(10000);
    await svc.createRequest(
      'u1',
      [{ cardId: 'c1', productType: 'raw' as never, rawCondition: 'NM' as never }],
      '012345678901234567',
    );
    expect(created[0].ruleMode).toBeUndefined();
    expect(created[0].ruleValue).toBeUndefined();
    expect(created[0].ruleSource).toBeUndefined();
  });
});

describe('E6 — GET /admin/reports/pricing-brackets: agrega por eje × bracket', () => {
  function adminWith(orderItems: unknown[], sellItems: unknown[]) {
    const prisma = {
      orderItem: { findMany: jest.fn(async () => orderItems) },
      sellRequestItem: { findMany: jest.fn(async () => sellItems) },
    } as unknown as PrismaService;
    return new AdminService(prisma, {} as PricingService, pii, {} as UploadsService);
  }

  const SALE_ROWS = [
    { marketBracket: 'r25_80', priceBasis: 'market', marketMxnCents: 5000, unitPriceCents: 7000 },
    { marketBracket: 'r25_80', priceBasis: 'market', marketMxnCents: 6000, unitPriceCents: 8500 },
    { marketBracket: 'r25_80', priceBasis: 'override', marketMxnCents: null, unitPriceCents: 9000 },
    { marketBracket: 'lt_3', priceBasis: 'floor', marketMxnCents: 100, unitPriceCents: 2500 },
    { marketBracket: null, priceBasis: 'override', marketMxnCents: null, unitPriceCents: 5000 },
  ];
  const BUY_ROWS = [
    { marketBracket: 'lt_3', priceBasis: 'floor', marketMxnCents: 100, quotedPriceCents: 100, approvedPriceCents: null },
    { marketBracket: 'lt_3', priceBasis: 'floor', marketMxnCents: 200, quotedPriceCents: 100, approvedPriceCents: 80 },
    { marketBracket: 'r80_300', priceBasis: 'bounty', marketMxnCents: null, quotedPriceCents: 25000, approvedPriceCents: null },
  ];

  it('VENTA: operaciones, unidades, bruto, mercado crudo y desglose por basis', async () => {
    const res = await adminWith(SALE_ROWS, []).pricingBrackets();
    const r2580 = res.sale!.find((r) => r.bracket === 'r25_80')!;
    expect(r2580).toMatchObject({ operations: 3, unitsSold: 3, grossMxnCents: 24500, marketMxnCents: 11000 });
    expect(r2580.byBasis).toEqual({ market: 2, floor: 0, override: 1, bounty: 0, pending: 0 });
    // Fila `bracket: null` = operaciones SIN mercado (override/bounty sin referencia).
    expect(res.sale!.find((r) => r.bracket === null)).toMatchObject({ operations: 1, grossMxnCents: 5000 });
  });

  it('COMPRA: el monto pagado usa `approvedPriceCents ?? quotedPriceCents` (el ajuste NO reescribe la serie)', async () => {
    const res = await adminWith([], BUY_ROWS).pricingBrackets();
    const lt3 = res.buy!.find((r) => r.bracket === 'lt_3')!;
    // 100 (sin ajuste) + 80 (ajustado por el admin) = 180.
    expect(lt3).toMatchObject({ operations: 2, unitsBought: 2, paidMxnCents: 180, marketMxnCents: 300 });
    expect(lt3.byBasis.floor).toBe(2);
  });

  it('`?axis=` acota el reporte a un solo eje', async () => {
    const sale = await adminWith(SALE_ROWS, BUY_ROWS).pricingBrackets(undefined, undefined, 'sale');
    expect(sale.sale).toBeDefined();
    expect(sale.buy).toBeUndefined();
    const buy = await adminWith(SALE_ROWS, BUY_ROWS).pricingBrackets(undefined, undefined, 'buy');
    expect(buy.buy).toBeDefined();
    expect(buy.sale).toBeUndefined();
  });

  it('solo cuenta operaciones CONSUMADAS: órdenes `settled` y solicitudes `pagada` sin ítems rechazados', async () => {
    const prisma = {
      orderItem: { findMany: jest.fn(async () => []) },
      sellRequestItem: { findMany: jest.fn(async () => []) },
    } as unknown as PrismaService;
    const svc = new AdminService(prisma, {} as PricingService, pii, {} as UploadsService);
    await svc.pricingBrackets('2026-08-01', '2026-08-24');
    expect((prisma.orderItem.findMany as jest.Mock).mock.calls[0][0].where).toMatchObject({
      order: { status: 'settled' },
    });
    expect((prisma.sellRequestItem.findMany as jest.Mock).mock.calls[0][0].where).toMatchObject({
      itemStatus: { not: 'rechazada' },
      sellRequest: { status: 'pagada' },
    });
  });
});

/**
 * v2.1.6 (fase de seguridad, Baja) — `range()` de los reportes VALIDA la ventana.
 *
 * Antes hacía `new Date(garbage)` y metía un `Invalid Date` al filtro de Prisma ⇒ **500** en un
 * endpoint de reportes de dinero. Y un rango invertido devolvía un reporte **vacío**, indistinguible
 * de «no hubo operaciones» — peor que un error, porque se lee como un dato.
 */
describe('reportes — la ventana de fechas se valida (422, no 500)', () => {
  function adminSvc() {
    const prisma = {
      orderItem: { findMany: jest.fn(async () => []) },
      sellRequestItem: { findMany: jest.fn(async () => []) },
    } as never;
    return new AdminService(prisma, {} as never, {} as never, {} as never);
  }

  it.each(['garbage', '2026-13-45', 'DROP TABLE', ''])('`from=%s` inválido ⇒ 422 con el campo', async (bad) => {
    if (bad === '') return; // vacío = ausente (sin filtro), no es inválido
    const err = await adminSvc()
      .pricingBrackets(bad, undefined, 'sale')
      .catch((e) => e);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.getResponse()).toMatchObject({ details: { field: 'from', value: bad } });
  });

  it('rango INVERTIDO ⇒ 422 (antes: reporte vacío que se leía como «no hubo operaciones»)', async () => {
    const err = await adminSvc()
      .pricingBrackets('2026-08-31', '2026-08-01', 'sale')
      .catch((e) => e);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.getResponse()).toMatchObject({ details: { from: '2026-08-31', to: '2026-08-01' } });
  });

  it('una ventana VÁLIDA sigue funcionando, y sin ventana también', async () => {
    await expect(adminSvc().pricingBrackets('2026-08-01', '2026-08-31', 'sale')).resolves.toBeDefined();
    await expect(adminSvc().pricingBrackets(undefined, undefined, 'sale')).resolves.toBeDefined();
  });
});
