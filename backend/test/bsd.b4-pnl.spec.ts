/**
 * bsd.b4-pnl.spec.ts — 💰 rev BSD-1, errata BSD-1.2, bloque B-4 (API_CONTRACT §BSD.16 §5, ARCHITECTURE §4.BSD (l)).
 *
 * La guía de ENTRADA del buylist RESTA en la ganancia, la tarifa RETENIDA al vendedor SUMA (reduce el costo de compra) y el
 * margen de las guías se ve, POR SOLICITUD. Pruebas BSD-B32…B36, deterministas (N=1 cada una, dicho como tal: no hay
 * carrera ni reloj). Las mismas cifras contra Postgres real: `test/integration/bsd-b4-pnl.e2e-spec.ts`.
 *
 * El doble de Prisma modela UNA sola fuente: la lista de solicitudes, cada una con su fila de entrada (`inbound`). Las dos
 * lecturas de `SellRequest` y la de `ShipmentRequest` (`INBOUND_ONLY`) salen de ella aplicando los filtros que el código
 * pide (clase, `labelSource`, `status`, `guideActualCostCents`, y las fechas del periodo), para que una guía no pueda
 * aparecer en una lectura y faltar en la otra por culpa del doble.
 */
import { ConfigService } from '@nestjs/config';
import { AdminService } from '../src/modules/admin/admin.service';
import { BuylistService } from '../src/modules/buylist/buylist.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { UsersService } from '../src/modules/users/users.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { withM61Defaults } from './helpers/m61-mock-defaults';

const pii = new PiiCryptoService(new ConfigService({}));

interface Inbound {
  labelSource: 'skydropx' | 'manual' | null;
  providerCancelConfirmedAt: Date | null;
  shippingCostCents: number;
  shippingCostIvaCents: number;
  labelPurchasedAt: Date | null;
}
interface Req {
  id: string;
  status: string;
  approvedTotalCents: number | null;
  offerGrossCents: number | null;
  quotedTotalCents: number | null;
  offerShippingFeeCents: number | null;
  payoutNetCents: number | null;
  paidAt: Date | null;
  guideSentAt: Date | null;
  /** BSD-1.4 punto 12: el periodo de (b) es `coalesce(guideSentAt, shipmentConfirmedAt)`. */
  shipmentConfirmedAt?: Date | null;
  guideActualCostCents: number | null;
  inbound: Inbound | null;
}

const IN = new Date('2031-03-15T12:00:00Z'); // dentro del periodo de las pruebas con periodo
const OUT = new Date('2031-02-10T12:00:00Z'); // fuera
const FROM = '2031-03-01T00:00:00Z';
const TO = '2031-03-31T23:59:59Z';

/** Una solicitud PAGADA: `payoutNetCents` = max(0, bruto − tarifa), como lo sella `paySpei`. */
function paid(id: string, gross: number, fee: number, over: Partial<Req> = {}): Req {
  return {
    id,
    status: 'pagada',
    approvedTotalCents: gross,
    offerGrossCents: gross,
    quotedTotalCents: gross,
    offerShippingFeeCents: fee,
    payoutNetCents: Math.max(0, gross - fee),
    paidAt: IN,
    guideSentAt: IN,
    guideActualCostCents: null,
    inbound: null,
    ...over,
  };
}
/** Guía de Skydropx de entrada: bruto e IVA congelados al capturar. */
function sdx(gross: number, iva: number, over: Partial<Inbound> = {}): Inbound {
  return { labelSource: 'skydropx', providerCancelConfirmedAt: null, shippingCostCents: gross, shippingCostIvaCents: iva, labelPurchasedAt: IN, ...over };
}
/** Una solicitud aceptada que NUNCA se pagó (su guía cuesta sin retener nada). */
function unpaid(id: string, inbound: Inbound | null, over: Partial<Req> = {}): Req {
  return { ...paid(id, 150000, 18000), status: 'aceptada', payoutNetCents: null, paidAt: null, inbound, ...over };
}

function inPeriod(d: Date | null, f: any): boolean {
  if (!f) return true;
  if (d == null) return false;
  if (f.gte && d < f.gte) return false;
  if (f.lte && d > f.lte) return false;
  return true;
}

/**
 * Las fechas del `where` de una lectura de `SellRequest`, como las evalúa Prisma: `campo: periodo`, `campo: null` (IS NULL) y
 * un `OR` de ramas (BSD-1.4 punto 12: `OR: [{guideSentAt: P}, {guideSentAt: null, shipmentConfirmedAt: P}]`). Un `where` que
 * el doble no sepa leer FALLA aquí (⛔ no se ignora: un filtro ignorado es un periodo que no filtra).
 */
const DATE_KEYS = ['paidAt', 'guideSentAt', 'shipmentConfirmedAt'] as const;
function datesMatch(r: Req, where: any): boolean {
  for (const k of DATE_KEYS) {
    if (!(k in where)) continue;
    const v = (r as any)[k] ?? null;
    if (where[k] === null ? v !== null : !inPeriod(v, where[k])) return false;
  }
  if (where.OR) {
    for (const branch of where.OR) {
      const unknown = Object.keys(branch).filter((k) => !(DATE_KEYS as readonly string[]).includes(k));
      if (unknown.length > 0) throw new Error(`doble: rama OR con claves que no modela: ${unknown.join(',')}`);
    }
    return where.OR.some((branch: any) => datesMatch(r, branch));
  }
  return true;
}

interface Fx {
  requests?: Req[];
  orders?: any[];
  outbound?: any[];
  adjustments?: { amountCents: number; ivaCents: number }[];
}

function build(fx: Fx) {
  const requests = fx.requests ?? [];
  const prisma: any = {
    order: { findMany: jest.fn(async () => fx.orders ?? []) },
    shipmentRequest: {
      findMany: jest.fn(async ({ where }: any) => {
        if (where.kind === 'buylist_inbound') {
          return requests
            .map((r) => r.inbound)
            .filter((g): g is Inbound => g != null && (where.labelSource == null || g.labelSource === where.labelSource))
            .filter((g) => inPeriod(g.labelPurchasedAt, where.labelPurchasedAt));
        }
        return fx.outbound ?? [];
      }),
    },
    sellRequest: {
      findMany: jest.fn(async ({ where }: any) =>
        requests
          .filter((r) => (where.status ? r.status === where.status : true))
          .filter((r) => (where.guideActualCostCents ? r.guideActualCostCents != null : true))
          .filter((r) => datesMatch(r, where))
          .map((r) => ({ ...r, inboundShipment: r.inbound })),
      ),
    },
    shipmentCostAdjustment: { findMany: jest.fn(async () => fx.adjustments ?? []) },
  };
  return new AdminService(withM61Defaults(prisma) as unknown as PrismaService, {} as PricingService, pii, {} as any);
}

/** Un envío de VENTA con costo: para afirmar que `shippingCostCents` NO cambia. */
const OUTBOUND = [{ shippingFeeCents: 17500, shippingCostCents: 9000, shippingCostIvaCents: 1241, processingFeeCents: 0, ivaCents: 0, priceConvention: 'IVA_EXCLUSIVE', labelSource: 'skydropx', insuranceCostCents: 0 }];

describe('💰 BSD-B32 — la guía de Skydropx de entrada RESTA, neta; la cancelada con confirmación no (N=1, determinista)', () => {
  it('bruto 25 000 con IVA 3 448 ⇒ buylistGuideCostCents 21 552 y profitCents baja 21 552; shippingCostCents de venta igual', async () => {
    const without = await build({ outbound: OUTBOUND, requests: [unpaid('a', null)] }).pnl();
    const withGuide = await build({ outbound: OUTBOUND, requests: [unpaid('a', sdx(25000, 3448))] }).pnl();
    expect(withGuide.buylistGuideCostCents).toBe(21552);
    expect(without.profitCents - withGuide.profitCents).toBe(21552);
    expect(withGuide.shippingCostCents).toBe(without.shippingCostCents);
    expect(withGuide.shippingCostCents).toBe(9000 - 1241);
  });

  it('cancelada CON confirmación y ajuste de 1 000 ⇒ (a) 0 y «ajustes de paquetería» 1 000 (sin doble conteo)', async () => {
    const p = await build({
      outbound: OUTBOUND,
      requests: [unpaid('a', sdx(25000, 3448, { providerCancelConfirmedAt: IN }))],
      adjustments: [{ amountCents: 1000, ivaCents: 0 }],
    }).pnl();
    expect(p.buylistGuideCostCents).toBe(0);
    expect(p.shippingAdjustmentsCents).toBe(1000);
    expect(p.shippingCostCents).toBe(9000 - 1241 + 1000);
  });

  it('cancelada SIN confirmar ⇒ sigue restando (el dinero salió)', async () => {
    const p = await build({ requests: [unpaid('a', sdx(25000, 3448, { providerCancelConfirmedAt: null }))] }).pnl();
    expect(p.buylistGuideCostCents).toBe(21552);
  });

  it('manual: `guideActualCostCents` tal cual (sin IVA), por `guideSentAt`; con guía de Skydropx de entrada NO cuenta como manual', async () => {
    const manual = unpaid('m', null, { guideActualCostCents: 15000, guideSentAt: IN });
    const both = unpaid('s', sdx(25000, 3448), { guideActualCostCents: 99999, guideSentAt: IN });
    const outside = unpaid('o', null, { guideActualCostCents: 7000, guideSentAt: OUT });
    expect((await build({ requests: [manual] }).pnl()).buylistGuideCostCents).toBe(15000);
    expect((await build({ requests: [both] }).pnl()).buylistGuideCostCents).toBe(21552);
    expect((await build({ requests: [manual, outside] }).pnl(FROM, TO)).buylistGuideCostCents).toBe(15000);
  });

  it('periodo: (a) por `labelPurchasedAt`', async () => {
    const p = await build({ requests: [unpaid('a', sdx(25000, 3448)), unpaid('b', sdx(10000, 1379, { labelPurchasedAt: OUT }))] }).pnl(FROM, TO);
    expect(p.buylistGuideCostCents).toBe(21552);
  });
});

describe('💰 BSD-B33 — la tarifa RETENIDA suma: lo retenido de verdad, en el mes de `paidAt` (N=1, determinista)', () => {
  it('pagada bruto 150 000, tarifa 18 000 ⇒ retenido 18 000 y profitCents sube 18 000', async () => {
    const base = await build({ requests: [] }).pnl(FROM, TO);
    const p = await build({ requests: [paid('p1', 150000, 18000)] }).pnl(FROM, TO);
    expect(p.buylistShippingFeeRetainedCents).toBe(18000);
    expect(p.profitCents - base.profitCents).toBe(18000);
  });

  it('bruto 10 000 < tarifa 18 000 ⇒ retenido 10 000 (el `max(0, …)` de payoutNetCents), nunca la tarifa a secas', async () => {
    const p = await build({ requests: [paid('p2', 10000, 18000)] }).pnl(FROM, TO);
    expect(p.buylistShippingFeeRetainedCents).toBe(10000);
    const both = await build({ requests: [paid('p1', 150000, 18000), paid('p2', 10000, 18000)] }).pnl(FROM, TO);
    expect(both.buylistShippingFeeRetainedCents).toBe(28000);
  });

  it('cuenta en el mes de `paidAt`: pagada fuera del periodo ⇒ 0', async () => {
    const p = await build({ requests: [paid('p1', 150000, 18000, { paidAt: OUT })] }).pnl(FROM, TO);
    expect(p.buylistShippingFeeRetainedCents).toBe(0);
  });

  it('fila pre-M-46 (`payoutNetCents` null) ⇒ no se le descontó nada ⇒ 0; aprobado null ⇒ el bruto con que se pagó', async () => {
    const legacy = paid('l', 50000, 0, { offerShippingFeeCents: null, payoutNetCents: null, guideSentAt: null });
    expect((await build({ requests: [legacy] }).pnl()).buylistShippingFeeRetainedCents).toBe(0);
    const noApproved = paid('n', 150000, 18000, { approvedTotalCents: null });
    expect((await build({ requests: [noApproved] }).pnl()).buylistShippingFeeRetainedCents).toBe(18000);
  });

  it('solo `pagada`: una aceptada con tarifa congelada no retiene nada todavía', async () => {
    const p = await build({ requests: [unpaid('a', null)] }).pnl();
    expect(p.buylistShippingFeeRetainedCents).toBe(0);
  });
});

describe('💰 BSD-B34 — el margen de las guías se mide POR SOLICITUD pagada (N=1, determinista)', () => {
  it('tarifa 18 000 con guía neta 12 931 ⇒ +5 069; con guía neta 21 552 ⇒ −3 552; total 1 517 aunque haya una guía de una solicitud NO pagada en el periodo', async () => {
    const a = paid('a', 150000, 18000, { inbound: sdx(15000, 2069) }); // neta 12 931
    const b = paid('b', 150000, 18000, { inbound: sdx(25000, 3448) }); // neta 21 552
    const c = unpaid('c', sdx(10000, 1379)); // neta 8 621: cuesta en el periodo, no retiene nada
    const p = await build({ requests: [a, b, c] }).pnl(FROM, TO);
    expect(p.buylistGuideMarginCents).toBe(1517);
    // y los dos renglones que SÍ entran en la ganancia ven las tres guías y las dos tarifas
    expect(p.buylistShippingFeeRetainedCents).toBe(36000);
    expect(p.buylistGuideCostCents).toBe(12931 + 21552 + 8621);
    expect(p.buylistGuideCostMissingCount).toBe(0);
  });

  it('el margen usa el costo de SU guía aunque se comprara en otro periodo', async () => {
    const a = paid('a', 150000, 18000, { inbound: sdx(15000, 2069, { labelPurchasedAt: OUT }) });
    const p = await build({ requests: [a] }).pnl(FROM, TO);
    expect(p.buylistGuideMarginCents).toBe(5069);
    expect(p.buylistGuideCostCents).toBe(0); // la guía cuenta en SU mes, no en éste
  });

  it('guía de Skydropx cancelada con confirmación ⇒ costo 0 en el margen (lo no devuelto está en «ajustes»)', async () => {
    const a = paid('a', 150000, 18000, { inbound: sdx(15000, 2069, { providerCancelConfirmedAt: IN }) });
    expect((await build({ requests: [a] }).pnl(FROM, TO)).buylistGuideMarginCents).toBe(18000);
  });

  it('manual SIN costo ⇒ contador +1 (margen con costo 0); manual con costo ⇒ resta su costo; sin guía ⇒ ni contador', async () => {
    const sinCosto = paid('m1', 150000, 18000, { guideActualCostCents: null });
    const conCosto = paid('m2', 150000, 18000, { guideActualCostCents: 15000 });
    const sinGuia = paid('m3', 50000, 0, { guideSentAt: null, offerShippingFeeCents: null, payoutNetCents: null });
    const p = await build({ requests: [sinCosto, conCosto, sinGuia] }).pnl(FROM, TO);
    expect(p.buylistGuideCostMissingCount).toBe(1);
    expect(p.buylistGuideMarginCents).toBe(18000 + (18000 - 15000) + 0);
  });
});

describe('💰 BSD-B35 — sin doble cuenta, por ausencia: el costo de la pieza sigue siendo el BRUTO (N=1, determinista)', () => {
  /** `convertToInventory` sobre un doble que SÍ trae la solicitud con su tarifa: si la conversión la restara, aquí se ve. */
  async function convertedCost(): Promise<number> {
    const seen: { create?: any } = {};
    const prisma: any = {
      sellRequestItem: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'sri-1',
          sellRequestId: 'p1',
          cardId: 'c1',
          productType: 'raw',
          rawCondition: 'NM',
          finish: 'normal',
          cardProductId: null,
          offeredPriceCents: 150000,
          approvedPriceCents: 150000,
          quotedPriceCents: 150000,
          inventoryItemId: null,
          itemStatus: 'aprobada',
          card: {},
          sellRequest: { offerShippingFeeCents: 18000, payoutNetCents: 132000, approvedTotalCents: 150000 },
        }),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      nextFolio: jest.fn(async () => 'INV-000001'),
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
      inventoryItem: {
        create: jest.fn(async ({ data }: any) => {
          seen.create = data;
          return { id: 'inv-1', folio: data.folio };
        }),
        findFirst: jest.fn(async () => ({ id: 'inv-1' })),
      },
      inventoryMovement: { create: jest.fn() },
    };
    const svc = new BuylistService(prisma as PrismaService, {} as PricingService, {} as SettingsService, {} as UsersService, pii);
    await svc.convertToInventory('sri-1', 'actor');
    return seen.create.acquisitionCostCents;
  }
  const sale = (cost: number) => ({
    subtotalCents: 200000,
    processingFeeCents: 6000,
    priceConvention: 'IVA_EXCLUSIVE',
    fulfillmentMode: 'vault',
    shippingFeeCents: 0,
    ivaCents: 32000,
    ivaRatePct: 16,
    items: [{ inventoryItem: { acquisitionCostCents: cost } }],
  });

  it('la pieza del buylist nace con el BRUTO de la línea (150 000), no con bruto − tarifa', async () => {
    expect(await convertedCost()).toBe(150000);
  });

  it('la ganancia de la VENTA de esa pieza no cambia por BSD-1.2; con la compra pagada en el mismo periodo, la tarifa entra UNA vez', async () => {
    const cost = await convertedCost();
    const soloVenta = await build({ orders: [sale(cost)] }).pnl(FROM, TO);
    expect(soloVenta.cogsCents).toBe(150000);
    expect(soloVenta.profitCents).toBe(200000 - 150000 - 6000); // la fórmula de antes de BSD-1.2, al centavo
    const conCompra = await build({ orders: [sale(cost)], requests: [paid('p1', 150000, 18000, { guideActualCostCents: 0 })] }).pnl(FROM, TO);
    expect(conCompra.profitCents - soloVenta.profitCents).toBe(18000);
  });
});

describe('💰 BSD-B36 — CSV: los cuatro campos al final, en el orden del objeto (N=1, determinista)', () => {
  it('cabecera y fila terminan en los cuatro del buylist, y la fila ES el objeto en su orden', async () => {
    const svc = build({
      outbound: OUTBOUND,
      requests: [paid('a', 150000, 18000, { inbound: sdx(15000, 2069) }), paid('m', 150000, 18000), unpaid('c', sdx(10000, 1379))],
    });
    const p = await svc.pnl(FROM, TO);
    const keys = Object.keys(p);
    expect(keys.slice(-4)).toEqual(['buylistShippingFeeRetainedCents', 'buylistGuideCostCents', 'buylistGuideMarginCents', 'buylistGuideCostMissingCount']);
    expect(keys[keys.length - 5]).toBe('profitCents');
    const [header, row] = (await svc.exportCsv('pnl', FROM, TO)).trim().split('\n');
    expect(header.split(',')).toEqual(['report', ...keys]);
    expect(row.split(',')).toEqual(['pnl', ...Object.values(p).map(String)]);
    // cifras distintas entre sí: un cambio de orden no puede pasar por casualidad
    expect(row.split(',').slice(-4)).toEqual(['36000', String(12931 + 8621), String(5069 + 18000), '1']);
  });
});

describe('💰 BSD-B43 — (b) cuenta por `coalesce(guideSentAt, shipmentConfirmedAt)` (errata BSD-1.4 punto 12; N=1, determinista)', () => {
  const Y = 2031;
  const month = (m: number): [string, string] => {
    const from = new Date(Date.UTC(Y, m - 1, 1));
    const to = new Date(Date.UTC(Y, m, 1) - 1);
    return [from.toISOString(), to.toISOString()];
  };
  /** Pagada con costo manual capturado al CONFIRMAR, SIN `guideSentAt` (`adminConfirmShipment` lo acepta: `guideMissing`). */
  const confirmedNoGuide = (id: string, cost: number, confirmedAt: Date) =>
    paid(id, 150000, 18000, { guideSentAt: null, shipmentConfirmedAt: confirmedAt, guideActualCostCents: cost, paidAt: confirmedAt });

  it('confirmada en marzo sin `guideSentAt` ⇒ su costo cuenta en el P&L de marzo (y no en febrero)', async () => {
    const svc = build({ requests: [confirmedNoGuide('x', 9000, new Date(Date.UTC(Y, 2, 20, 12)))] });
    expect((await svc.pnl(...month(3))).buylistGuideCostCents).toBe(9000);
    expect((await svc.pnl(...month(2))).buylistGuideCostCents).toBe(0);
  });

  it('con `guideSentAt` manda `guideSentAt` (la guía de enero confirmada en marzo cuenta en enero)', async () => {
    const r = paid('g', 150000, 18000, { guideSentAt: new Date(Date.UTC(Y, 0, 10)), shipmentConfirmedAt: new Date(Date.UTC(Y, 2, 20)), guideActualCostCents: 7000 });
    const svc = build({ requests: [r] });
    expect([(await svc.pnl(...month(1))).buylistGuideCostCents, (await svc.pnl(...month(3))).buylistGuideCostCents]).toEqual([7000, 0]);
  });

  it('la suma de enero a diciembre de (b) es la del P&L SIN periodo (ningún costo se queda sin mes)', async () => {
    const at = (m: number, d: number) => new Date(Date.UTC(Y, m - 1, d, 12));
    const requests = [
      confirmedNoGuide('a', 9000, at(3, 20)),
      confirmedNoGuide('b', 4100, at(7, 1)),
      confirmedNoGuide('c', 1300, at(12, 31)),
      paid('d', 150000, 18000, { guideSentAt: at(1, 5), shipmentConfirmedAt: at(2, 5), guideActualCostCents: 7000 }),
      unpaid('e', null, { guideSentAt: at(5, 5), guideActualCostCents: 2500 }),
    ];
    const svc = build({ requests });
    let sum = 0;
    for (let m = 1; m <= 12; m++) sum += (await svc.pnl(...month(m))).buylistGuideCostCents;
    const total = (await svc.pnl()).buylistGuideCostCents;
    expect(total).toBe(9000 + 4100 + 1300 + 7000 + 2500);
    expect(sum).toBe(total);
  });
});
