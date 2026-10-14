import { ConfigService } from '@nestjs/config';
import { AdminService } from '../src/modules/admin/admin.service';
import { withM61Defaults } from './helpers/m61-mock-defaults';
import { withPnlBuylistDoubles } from './helpers/pnl-buylist-doubles';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { taxBaseCentsOf } from '../src/common/money';

/**
 * ⭐💰 CANDADO `REF-DASH-2` (rama `fix/pnl-finanzas`, API_CONTRACT §M4-SHIP.20 (B2) / ARCHITECTURE §4.44.f-quater
 * — cierra `D-AN-1`) — **LA DOBLE RESTA DEL REEMBOLSO TOTAL.**
 *
 * El defecto: un reembolso total pasa la orden a `refunded`; el filtro de ingreso `pnl-core.ts:218`
 * (`status:'settled'`) la EXCLUÍA ⇒ se perdía su ingreso en el periodo de liquidación, mientras la fila
 * `order_full` restaba en el periodo de su `submittedAt` ⇒ la venta se restaba **dos veces** (−10000).
 *
 * El arreglo (B2): el ingreso se acota por `settledAt ∈ periodo` con `status IN {settled, refunded}` (⛔ no por
 * el `status` vivo), de modo que la venta liquidada cuenta su ingreso AUNQUE luego se reembolse, y el reembolso
 * resta UNA sola vez. ⛔ `chargeback` queda FUERA (D-PNL-1).
 *
 * ⚠️ El doble de `order.findMany` HONRA el `where.status` (como Postgres): devuelve la orden `refunded` SOLO si el
 * filtro admite `refunded`. Así el candado FALLA de verdad con el filtro viejo (`status:'settled'`) — no por un
 * `mockResolvedValue` que responde igual a cualquier `where` — y PASA con el nuevo. Premisa MEDIDA (grep en
 * `backend/src`): `Order.settledAt` NUNCA se pone a null al pasar a `refunded`/`chargeback` (sello inmutable).
 */

const SETTLED_AT = new Date('2026-03-02T18:00:00.000Z');
const NET_INCOME = taxBaseCentsOf(11600, 16); // 10000

// Orden IVA_INCLUSIVE liquidada en el periodo (income neto 10000), SIN costo ni comisión (para aislar la doble
// resta), luego TOTALMENTE reembolsada ⇒ su `status` vivo es `refunded`, pero su `settledAt` sigue intacto.
const refundedOrder = {
  subtotalCents: 11600,
  ivaCents: 1600,
  processingFeeCents: 0,
  ivaRatePct: 16,
  priceConvention: 'IVA_INCLUSIVE' as const,
  fulfillmentMode: 'vault' as const,
  shippingFeeCents: 0,
  status: 'refunded' as const,
  settledAt: SETTLED_AT,
  items: [] as { inventoryItem: { acquisitionCostCents: number | null; acquisitionCostIvaCents: number } }[],
  accessoryLines: [] as unknown[],
};

// La fila `order_full` del reembolso: neto 10000 (= 11600 − 1600 de IVA), sin comisión devuelta ni compensación.
const fullRefundRow = {
  amountCents: 11600,
  merchandiseCents: 11600,
  merchandiseIvaCents: 1600,
  shippingCents: 0,
  shippingIvaCents: 0,
  processingFeeCents: 0,
  compensationCents: 0,
  submittedAt: SETTLED_AT,
};

function servicio() {
  const statusAllows = (where: any, s: string): boolean => {
    const st = where?.status;
    return st === s || (st && Array.isArray(st.in) && st.in.includes(s));
  };
  const prisma = {
    order: {
      // HONRA el where: la orden `refunded` solo sale si el filtro la admite (Postgres-like).
      findMany: jest.fn(async (args: any) => (statusAllows(args?.where, 'refunded') ? [refundedOrder] : [])),
    },
    shipmentRequest: { findMany: jest.fn().mockResolvedValue([]) },
    paymentRefund: { findMany: jest.fn(async () => [fullRefundRow]) },
  };
  const service = new AdminService(
    withPnlBuylistDoubles(withM61Defaults(prisma)) as unknown as PrismaService,
    {} as PricingService,
    new PiiCryptoService(new ConfigService({})),
    {} as any,
  );
  return { service };
}

describe('💰 REF-DASH-2 — el reembolso total no se resta dos veces (fix/pnl-finanzas)', () => {
  it('⭐ ingreso contado UNA vez (10000) y reembolso restado UNA vez ⇒ profit = 0, no −10000', async () => {
    const { service } = servicio();
    const p = await service.pnl('2026-03-01', '2026-03-31');
    // La venta liquidada en el periodo cuenta su ingreso aunque la orden esté `refunded`.
    expect(p.incomeCents).toBe(NET_INCOME); // 10000 (antes: 0, porque `status:'settled'` la excluía)
    // El reembolso resta UNA sola vez.
    expect(p.refundsCents).toBe(NET_INCOME); // 10000
    // UNA sola resta ⇒ 10000 − 10000 = 0 (antes: 0 − 10000 = −10000, la doble resta).
    expect(p.profitCents).toBe(0);
    expect(p.profitCents).not.toBe(-NET_INCOME);
  });
});
