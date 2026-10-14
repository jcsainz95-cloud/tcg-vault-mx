import { ConfigService } from '@nestjs/config';
import { AdminService } from '../src/modules/admin/admin.service';
import { withM61Defaults } from './helpers/m61-mock-defaults';
import { withPnlBuylistDoubles } from './helpers/pnl-buylist-doubles';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';

/**
 * ⭐💰 CANDADO del `statement` (rama `fix/pnl-finanzas`, API_CONTRACT §M10-IVA.8-bis (C) v1.95.2 / ARCHITECTURE
 * §4.44.f-quater (C)) — **EL ESTADO DE RESULTADOS ESTÁNDAR DE E-COMMERCE SE DERIVA POR CONSTRUCCIÓN Y NO PUEDE
 * DESVIAR DE LO PLANO.**
 *
 * Las 7 IDENTIDADES son el candado (⭐ REESCRITAS para v1.95.2):
 *  - `salesCents == income + shipRev`;
 *  - `returnsAndRefunds.totalCents == refunds + refundedFees + comps`;
 *  - `netRevenueCents == salesCents − returnsAndRefunds.totalCents`;
 *  - `costOfSales.totalCents == cogs + stripeFees + shipCost + buylistGuide − buylistRetained`;
 *  - `grossMarginCents == netRevenueCents − costOfSales.totalCents`;
 *  - **`ebitdaCents == grossMarginCents` EXACTO** (no hay opex fija modelada);
 *  - **`netResultCents == profitCents` EXACTO** (⛔⛔ INVARIANTE DURO; el IVA es MEMO, NO se resta: aunque
 *    `ivaNet != 0`, el resultado no cambia);
 *  - **`statement.iva.ivaCollectedCents == GET /admin/finance/iva` del MISMO rango** (misma fuente, estilo IVA-10(b)).
 */

const RANGE: [string, string] = ['2026-03-01', '2026-03-31'];
const SETTLED_AT = new Date('2026-03-10T18:00:00.000Z');

// Orden settled IVA_INCLUSIVE: income neto 10000, IVA cobrado 1600, comisión 500, COGS neto 8000 (9280 − 1280).
const settledOrder = {
  id: 'o-stmt-1',
  subtotalCents: 11600,
  ivaCents: 1600,
  processingFeeCents: 500,
  ivaRatePct: 16,
  priceConvention: 'IVA_INCLUSIVE' as const,
  fulfillmentMode: 'vault' as const,
  shippingFeeCents: 0,
  status: 'settled' as const,
  settledAt: SETTLED_AT,
  items: [{ inventoryItem: { acquisitionCostCents: 9280, acquisitionCostIvaCents: 1280 } }],
  accessoryLines: [] as unknown[],
};

// Reembolso parcial por tarjeta: neto 5000, IVA devuelto 800, comisión devuelta 100, compensación 50.
const refundRow = {
  amountCents: 5900,
  merchandiseCents: 5800,
  merchandiseIvaCents: 800,
  shippingCents: 0,
  shippingIvaCents: 0,
  processingFeeCents: 100,
  compensationCents: 50,
  submittedAt: SETTLED_AT,
};

function servicio() {
  const prisma = {
    order: { findMany: jest.fn(async () => [settledOrder]) },
    shipmentRequest: { findMany: jest.fn().mockResolvedValue([]) },
    paymentRefund: { findMany: jest.fn(async () => [refundRow]) },
  };
  const service = new AdminService(
    withPnlBuylistDoubles(withM61Defaults(prisma)) as unknown as PrismaService,
    {} as PricingService,
    new PiiCryptoService(new ConfigService({})),
    {} as any,
  );
  return { service };
}

describe('💰 statement — estado de resultados derivado por construcción (fix/pnl-finanzas)', () => {
  it('⭐ identidades: sales, returns, netRevenue, costOfSales, grossMargin y ebitda cuadran con los campos planos', async () => {
    const { service } = servicio();
    const r = await service.pnlReport(...RANGE);
    const s = r.statement;
    // Ventas
    expect(s.salesCents).toBe(r.incomeCents + r.shippingRevenueCents);
    // (−) Devoluciones y reembolsos (CONTRA-INGRESO)
    const rr = s.returnsAndRefunds;
    expect(rr.totalCents).toBe(r.refundsCents + r.refundedFeesCents + r.compensationsCents);
    expect(rr.refundsCents).toBe(r.refundsCents);
    expect(rr.refundedFeesCents).toBe(r.refundedFeesCents);
    expect(rr.compensationsCents).toBe(r.compensationsCents);
    // = Ventas netas
    expect(s.netRevenueCents).toBe(s.salesCents - rr.totalCents);
    // (−) Costo de venta PURO
    const cos = s.costOfSales;
    expect(cos.cogsCents).toBe(r.cogsCents);
    expect(cos.stripeFeesCents).toBe(r.stripeFeesCents);
    expect(cos.shippingCostCents).toBe(r.shippingCostCents);
    expect(cos.buylistGuideCostCents).toBe(r.buylistGuideCostCents);
    expect(cos.buylistShippingFeeRetainedCents).toBe(r.buylistShippingFeeRetainedCents);
    expect(cos.totalCents).toBe(
      r.cogsCents +
        r.stripeFeesCents +
        r.shippingCostCents +
        r.buylistGuideCostCents -
        r.buylistShippingFeeRetainedCents,
    );
    // = Margen bruto (de contribución)
    expect(s.grossMarginCents).toBe(s.netRevenueCents - cos.totalCents);
    // = EBITDA (== margen bruto: no hay opex fija)
    expect(s.ebitdaCents).toBe(s.grossMarginCents);
  });

  it('⭐ ebitda == grossMargin, netResult == ebitda y netResult == profitCents EXACTO (el IVA NO se resta)', async () => {
    const { service } = servicio();
    const r = await service.pnlReport(...RANGE);
    expect(r.statement.ebitdaCents).toBe(r.statement.grossMarginCents);
    expect(r.statement.netResultCents).toBe(r.statement.ebitdaCents);
    // ⛔⛔ INVARIANTE DURO: reordenar los grupos NO cambia el resultado final.
    expect(r.statement.netResultCents).toBe(r.profitCents);
    // ⛔⛔ El IVA es MEMO: aunque ivaNet != 0, el resultado neto NO baja por él.
    expect(r.statement.iva.ivaNetCents).not.toBe(0);
    expect(r.statement.netResultCents).not.toBe(r.statement.ebitdaCents - r.statement.iva.ivaNetCents);
  });

  it('⭐ statement.iva viene de la MISMA fuente que GET /admin/finance/iva (mismo rango)', async () => {
    const { service } = servicio();
    const [r, iva] = await Promise.all([service.pnlReport(...RANGE), service.ivaReport(...RANGE)]);
    expect(r.statement.iva.ivaCollectedCents).toBe(iva.ivaCollectedCents);
    expect(r.statement.iva.ivaRefundedCents).toBe(iva.ivaRefundedCents);
    expect(r.statement.iva.ivaNetCents).toBe(iva.ivaNetCents);
  });

  it('CONTROL: la fixture mueve las cifras (una de ceros no probaría la identidad)', async () => {
    const { service } = servicio();
    const r = await service.pnlReport(...RANGE);
    expect(r.incomeCents).toBe(10000);
    expect(r.cogsCents).toBe(8000);
    expect(r.refundsCents).toBe(5000);
    expect(r.statement.iva.ivaCollectedCents).toBe(1600);
    expect(r.statement.iva.ivaRefundedCents).toBe(800);
    // profit = 10000 − 8000 − 500(fee) − 5000(refund) − 100(refFee) − 50(comp) = −3650.
    expect(r.profitCents).toBe(-3650);
  });
});
