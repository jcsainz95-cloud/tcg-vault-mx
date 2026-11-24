import { previousRange, comparisonBasis, resolvePeriod, PERIOD_KIND_VALUES } from '../src/modules/sales-analytics/sales-period';
import { deltaOf } from '../src/modules/admin/pnl-core';
import { AdminService } from '../src/modules/admin/admin.service';
import { ConfigService } from '@nestjs/config';
import { withM61Defaults } from './helpers/m61-mock-defaults';
import { withPnlBuylistDoubles } from './helpers/pnl-buylist-doubles';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { withPatrimony } from './helpers/valuation-gate';

/** §REPORTES-CEO F2a — periodo anterior = MISMO TRAMO (API_CONTRACT_REPORTES §2). */
describe('F2a — previousRange (puro)', () => {
  const pr = (k: any, f: string, t: string) => {
    const r = previousRange(k, f, t);
    return [r.kind, r.from, r.to, r.clamped];
  };

  it('sin kind (o span) = «misma duración inmediatamente antes», como siempre', () => {
    expect(pr(undefined, '2026-11-01', '2026-11-23')).toEqual(['span', '2026-10-09', '2026-10-31', false]);
    expect(pr('span', '2026-11-01', '2026-11-23')).toEqual(['span', '2026-10-09', '2026-10-31', false]);
    expect(pr('rolling', '2026-11-17', '2026-11-23')).toEqual(['rolling', '2026-11-10', '2026-11-16', false]);
  });
  it('mes en curso día N vs mes anterior 1..N', () => {
    expect(pr('month', '2026-11-01', '2026-11-23')).toEqual(['month', '2026-10-01', '2026-10-23', false]);
  });
  it('mes cerrado vs la unidad anterior completa (feb vs enero; marzo vs feb 28)', () => {
    expect(pr('month', '2026-02-01', '2026-02-28')).toEqual(['month', '2026-01-01', '2026-01-31', false]);
    expect(pr('month', '2026-03-01', '2026-03-31')).toEqual(['month', '2026-02-01', '2026-02-28', false]);
  });
  it('regla única «el mismo día, un mes antes»: 31-mar CERRADO ⇒ feb completo sin rótulo; 30-mar-2027 ⇒ 28-feb clamped:true', () => {
    expect(pr('month', '2027-03-01', '2027-03-31')).toEqual(['month', '2027-02-01', '2027-02-28', false]);
    expect(pr('month', '2027-03-01', '2027-03-30')).toEqual(['month', '2027-02-01', '2027-02-28', true]);
    expect(pr('month', '2027-03-01', '2027-03-29')).toEqual(['month', '2027-02-01', '2027-02-28', true]);
    expect(pr('month', '2027-03-01', '2027-03-28')).toEqual(['month', '2027-02-01', '2027-02-28', false]);
  });
  it('bisiesto: 29-mar-2028 vs 29-feb sin rótulo; 30-mar-2028 recorta; 31-mar-2028 cerrado vs 29-feb sin rótulo', () => {
    expect(pr('month', '2028-03-01', '2028-03-31')).toEqual(['month', '2028-02-01', '2028-02-29', false]);
    expect(pr('month', '2028-03-01', '2028-03-30')).toEqual(['month', '2028-02-01', '2028-02-29', true]);
    expect(pr('month', '2028-03-01', '2028-03-29')).toEqual(['month', '2028-02-01', '2028-02-29', false]);
  });
  it('trimestre, semestre y año: cerrado = unidad anterior completa; a la fecha = MISMA FECHA de calendario una unidad atrás', () => {
    expect(pr('quarter', '2026-10-01', '2026-12-31')).toEqual(['quarter', '2026-07-01', '2026-09-30', false]);
    expect(pr('quarter', '2026-10-01', '2026-11-23')).toEqual(['quarter', '2026-07-01', '2026-08-23', false]);
    expect(pr('semester', '2026-07-01', '2026-12-31')).toEqual(['semester', '2026-01-01', '2026-06-30', false]);
    expect(pr('semester', '2026-07-01', '2026-11-23')).toEqual(['semester', '2026-01-01', '2026-05-23', false]);
    expect(pr('year', '2026-01-01', '2026-12-31')).toEqual(['year', '2025-01-01', '2025-12-31', false]);
    expect(pr('year', '2026-01-01', '2026-11-23')).toEqual(['year', '2025-01-01', '2025-11-23', false]);
    // recorte de la FECHA (no del largo): 30-may −3 meses = 30-feb no existe ⇒ 28-feb, clamped:true
    expect(pr('quarter', '2027-04-01', '2027-05-30')).toEqual(['quarter', '2027-01-01', '2027-02-28', true]);
    expect(pr('quarter', '2027-04-01', '2027-06-29')).toEqual(['quarter', '2027-01-01', '2027-03-29', false]);
  });
  it('año a la fecha en bisiesto: 2028-03-01 ⇒ 2027-01-01..2027-03-01 (fecha de calendario, no primeros k días); 29-feb es fin de mes ⇒ 28-feb sin rótulo', () => {
    expect(pr('year', '2028-01-01', '2028-03-01')).toEqual(['year', '2027-01-01', '2027-03-01', false]);
    expect(pr('year', '2028-01-01', '2028-02-29')).toEqual(['year', '2027-01-01', '2027-02-28', false]);
  });
  it('day = mismo día de la semana anterior; con más de un día cae a span (el anterior nunca solapa)', () => {
    expect(pr('day', '2026-11-23', '2026-11-23')).toEqual(['day', '2026-11-16', '2026-11-16', false]);
    expect(pr('day', '2026-11-20', '2026-11-23')).toEqual(['span', '2026-11-16', '2026-11-19', false]);
  });
  it('rolling de 30 días = los 30 días inmediatamente antes (no −7)', () => {
    expect(pr('rolling', '2026-11-01', '2026-11-30')).toEqual(['rolling', '2026-10-02', '2026-10-31', false]);
  });
  it('calendario que no calza con su unidad cae a span (from a mitad de mes; to pasa el fin)', () => {
    expect(pr('month', '2026-11-05', '2026-11-23')).toEqual(['span', '2026-10-17', '2026-11-04', false]);
    expect(pr('month', '2026-11-01', '2026-12-05')).toEqual(['span', '2026-09-27', '2026-10-31', false]);
  });
  it('el dominio del enum', () => {
    expect([...PERIOD_KIND_VALUES]).toEqual(['day', 'rolling', 'month', 'quarter', 'semester', 'year', 'span']);
  });
});

describe('F2a — comparisonBasis y resolvePeriod', () => {
  const prev = { from: '2026-10-01', to: '2026-10-23' };
  it('complete / partial con dataSince / none; sin pedidos ⇒ none; nunca un delta sin basis', () => {
    expect(comparisonBasis('2026-09-01', prev)).toEqual({ basis: 'complete', dataSince: null });
    expect(comparisonBasis('2026-10-01', prev)).toEqual({ basis: 'complete', dataSince: null });
    expect(comparisonBasis('2026-10-15', prev)).toEqual({ basis: 'partial', dataSince: '2026-10-15' });
    expect(comparisonBasis('2026-10-23', prev)).toEqual({ basis: 'partial', dataSince: '2026-10-23' });
    expect(comparisonBasis('2026-10-24', prev)).toEqual({ basis: 'none', dataSince: null });
    expect(comparisonBasis(null, prev)).toEqual({ basis: 'none', dataSince: null });
  });
  const NOW = new Date('2026-11-24T15:00:00Z');
  it('sin kind, resolvePeriod no cambia nada (candado de compatibilidad)', () => {
    const a = resolvePeriod({ preset: 'this_month' }, NOW);
    expect(a.prev).toEqual({ from: '2026-10-08', to: '2026-10-31' });
    expect(a.kind).toBe('span');
    expect(a.prevClamped).toBe(false);
    const b = resolvePeriod({ from: '2026-11-01', to: '2026-11-23', kind: '' }, NOW);
    expect(b.prev).toEqual({ from: '2026-10-09', to: '2026-10-31' });
  });
  it('con kind=month el mes en curso se compara con 1..N del mes anterior', () => {
    const a = resolvePeriod({ preset: 'this_month', kind: 'month' }, NOW);
    expect(a.prev).toEqual({ from: '2026-10-01', to: '2026-10-24' });
    expect(a.kind).toBe('month');
  });
  it('kind fuera de dominio ⇒ 400 con allowed', () => {
    expect(() => resolvePeriod({ preset: 'today', kind: 'week' }, NOW)).toThrow();
  });
});

describe('F2a — deltaOf (centavos enteros)', () => {
  it('cálculo, signo, redondeo mitad lejos de cero y anterior 0 ⇒ null', () => {
    expect(deltaOf(150, 100)).toEqual({ cents: 150, previousCents: 100, deltaCents: 50, deltaBps: 5000 });
    expect(deltaOf(50, 100).deltaBps).toBe(-5000);
    expect(deltaOf(50, -100)).toMatchObject({ deltaCents: 150, deltaBps: 15000 }); // de −100 a +50 = mejora
    expect(deltaOf(5, 0)).toEqual({ cents: 5, previousCents: 0, deltaCents: 5, deltaBps: null });
    expect(deltaOf(0, 0).deltaBps).toBeNull();
    expect(deltaOf(1, 3).deltaBps).toBe(-6667);
    expect(deltaOf(2, 3).deltaBps).toBe(-3333);
    expect(deltaOf(3, 8).deltaBps).toBe(-6250);
    expect(deltaOf(9, 8).deltaBps).toBe(1250);
    expect(deltaOf(1, 16).deltaBps).toBe(-9375);
    expect(deltaOf(17, 16).deltaBps).toBe(625);
    expect(deltaOf(31, 32).deltaBps).toBe(-313); // −312.5: mitad hacia afuera de cero
    expect(deltaOf(33, 32).deltaBps).toBe(313);
    expect(deltaOf(1, 32000).deltaBps).toBe(-10000); // −31999×10000/32000 = −9999.69
  });
});

describe('F2a — AdminService.pnlReport con comparación', () => {
  function build(firstDay: Date | null) {
    const prisma: any = {
      order: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        aggregate: jest.fn().mockResolvedValue({ _min: { createdAt: null, settledAt: firstDay } }),
      },
      shipmentRequest: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
      sellRequest: { count: jest.fn().mockResolvedValue(0), aggregate: jest.fn().mockResolvedValue({ _sum: { approvedTotalCents: 0 } }) },
      dispute: { count: jest.fn().mockResolvedValue(0) },
      pendingPriceEntry: { count: jest.fn().mockResolvedValue(0) },
      priceReference: { findFirst: jest.fn().mockResolvedValue(null) },
      fxRate: { findFirst: jest.fn().mockResolvedValue(null) },
      user: { count: jest.fn().mockResolvedValue(0) },
      inventoryItem: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = withPatrimony(
      new AdminService(
        withPnlBuylistDoubles(withM61Defaults(prisma)) as unknown as PrismaService,
        { sealedSourceOnFor: PricingService.prototype.sealedSourceOnFor } as unknown as PricingService,
        new PiiCryptoService(new ConfigService({})),
        {} as any,
      ),
      { sealedSourceOnFor: PricingService.prototype.sealedSourceOnFor } as unknown as PricingService,
    );
    return { prisma, service };
  }

  it('sin from/to o con ISO ⇒ las cuatro claves null; el plano no cambia', async () => {
    const { service } = build(new Date('2026-10-20T12:00:00Z'));
    for (const r of [await service.pnlReport(), await service.pnlReport('2026-11-01T06:00:00.000Z', '2026-11-24T05:59:59.999Z')] as any[]) {
      expect(r.period).toBeNull();
      expect(r.previousPeriod).toBeNull();
      expect(r.previous).toBeNull();
      expect(r.comparison).toBeNull();
      expect(r.statement).toBeDefined();
    }
  });

  it('YMD + kind=month: period con kind efectivo, previousPeriod, previous y 8 cifras Delta; tienda nueva ⇒ partial con dataSince', async () => {
    const { service, prisma } = build(new Date('2026-10-20T12:00:00Z'));
    const r: any = await service.pnlReport('2026-11-01', '2026-11-23', 'month');
    expect(r.period).toEqual({ from: '2026-11-01', to: '2026-11-23', kind: 'month', days: 23, timezone: 'America/Mexico_City', toDate: true });
    expect(r.previousPeriod).toEqual({ from: '2026-10-01', to: '2026-10-23', clamped: false });
    expect(r.previous.statement).toBeDefined();
    expect(r.previous).not.toHaveProperty('previous');
    expect(r.previous).not.toHaveProperty('feeIncludedSince');
    expect(r.previous).not.toHaveProperty('stripeFeeEstimatedCents');
    expect(r.comparison.basis).toBe('partial');
    expect(r.comparison.dataSince).toBe('2026-10-20');
    expect(Object.keys(r.comparison.figures)).toEqual(['salesCents', 'returnsAndRefundsCents', 'netRevenueCents', 'cogsCents', 'stripeFeesCents', 'shippingCostCents', 'grossMarginCents', 'netResultCents']);
    expect(r.comparison.figures.salesCents).toEqual({ cents: 0, previousCents: 0, deltaCents: 0, deltaBps: null });
    // la lectura anterior usa el semiabierto MX de su rango
    const wheres = prisma.order.findMany.mock.calls.map((c: any) => c[0].where.settledAt).filter(Boolean);
    expect(wheres).toContainEqual({ gte: new Date('2026-10-01T06:00:00.000Z'), lt: new Date('2026-10-24T06:00:00.000Z') });
  });

  it('basis none (tramo anterior antes del primer dato) y sin pedidos; complete', async () => {
    expect(((await build(new Date('2026-11-05T12:00:00Z')).service.pnlReport('2026-11-01', '2026-11-23', 'month')) as any).comparison).toMatchObject({ basis: 'none', dataSince: null });
    expect(((await build(null).service.pnlReport('2026-11-01', '2026-11-23')) as any).comparison.basis).toBe('none');
    expect(((await build(new Date('2026-01-05T12:00:00Z')).service.pnlReport('2026-11-01', '2026-11-23', 'month')) as any).comparison.basis).toBe('complete');
  });

  it('tramo anterior antes de 2020 (el range() lo rechazaría): no revienta; P&L vacío y basis none', async () => {
    const { service } = build(new Date('2026-01-05T12:00:00Z'));
    const r: any = await service.pnlReport('2020-01-01', '2020-12-31');
    expect(r.previousPeriod).toEqual({ from: '2018-12-31', to: '2019-12-31', clamped: false });
    expect(r.comparison.basis).toBe('none');
    expect(r.previous.statement.salesCents).toBe(0);
    const r2: any = await service.pnlReport('2020-01-01', '2020-03-31', 'quarter');
    expect(r2.previousPeriod.to).toBe('2019-12-31');
  });

  it('periodo a caballo de 2020: se lee desde 2020-01-01 (sin qFrom range() lo rechazaría)', async () => {
    const { service, prisma } = build(new Date('2026-01-05T12:00:00Z'));
    const r: any = await service.pnlReport('2020-01-20', '2020-02-10');
    expect(r.previousPeriod).toEqual({ from: '2019-12-29', to: '2020-01-19', clamped: false });
    const wheres = prisma.order.findMany.mock.calls.map((c: any) => c[0].where.settledAt).filter(Boolean);
    expect(wheres).toContainEqual({ gte: new Date('2020-01-01T06:00:00.000Z'), lt: new Date('2020-01-20T06:00:00.000Z') });
  });

  it('sin kind con YMD = span; 30-mar vs feb ⇒ clamped; kind que no calza ⇒ period.kind efectivo span', async () => {
    const { service } = build(new Date('2026-01-05T12:00:00Z'));
    expect(((await service.pnlReport('2026-11-01', '2026-11-23')) as any).period.kind).toBe('span');
    expect(((await service.pnlReport('2026-03-01', '2026-03-30', 'month')) as any).previousPeriod).toEqual({ from: '2026-02-01', to: '2026-02-28', clamped: true });
    const off: any = await service.pnlReport('2026-11-05', '2026-11-23', 'month');
    expect(off.period.kind).toBe('span');
    expect(off.previousPeriod).toEqual({ from: '2026-10-17', to: '2026-11-04', clamped: false });
    expect(((await service.pnlReport('2026-11-20', '2026-11-23', 'day')) as any).period.kind).toBe('span');
  });
});
