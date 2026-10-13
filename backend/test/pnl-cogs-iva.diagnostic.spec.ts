import { ConfigService } from '@nestjs/config';
import { AdminService } from '../src/modules/admin/admin.service';
import { withM61Defaults } from './helpers/m61-mock-defaults';
import { withPnlBuylistDoubles } from './helpers/pnl-buylist-doubles';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { taxBaseCentsOf } from '../src/common/money';

/**
 * 🔎 DIAGNÓSTICO (rama `fix/pnl-finanzas`) — **EL COGS DEL P&L NO SE NETEA DE IVA; EL INGRESO SÍ.**
 *
 * Reportado por el dueño: P&L 12–14 oct 2026 da **ganancia −67.81** con ingreso neto 1,594.83 y
 * **COGS 1,675.33** (el costo de lo vendido es mayor que el ingreso neto de mercancía).
 *
 * ### Lo MEDIDO en el código (no es opinión)
 *  - **Ingreso**: `pnl-core.ts:238` → `netRevenueCents(o)` → bajo `IVA_INCLUSIVE` devuelve
 *    `taxBaseCentsOf(subtotal, r)` (`common/money.ts:905-915`). El ingreso entra **NETO de IVA**.
 *  - **Costo de ENVÍO**: `pnl-core.ts:264` → `netShippingCostCents(s)` = `shippingCostCents −
 *    shippingCostIvaCents` (`common/money.ts:995-1000`). El costo de envío entra **NETO**, restando
 *    un **crédito de IVA congelado** en su propia columna (`ShipmentRequest.shippingCostIvaCents`).
 *  - **COGS (costo de lo vendido)**: `pnl-core.ts:244` → `b.cogsCents += it.inventoryItem
 *    .acquisitionCostCents ?? 0`. **Suma el valor CRUDO, sin ninguna resta de IVA**, y
 *    `InventoryItem` **no tiene** columna `acquisitionCostIvaCents` análoga a la del envío
 *    (`Grep acquisitionCostIvaCents backend/ = 0`).
 *
 * ⇒ **Asimetría medida:** de los tres términos, SOLO el COGS carece de neteo de IVA. Si una pieza se
 * capturó con el costo **con IVA** (hábito declarado del dueño — `API_CONTRACT.md:690` «yo lo voy a
 * meter con iva», y el precedente del costo de envío `:3269` «el costo de envío con el IVA que yo
 * pagué»), el P&L resta un costo BRUTO contra un ingreso NETO y hunde el margen por el IVA del costo.
 *
 * ### Lo NO MEDIDO (requiere datos de PRODUCCIÓN, inalcanzables desde aquí)
 * Si las piezas vendidas en 12–14 oct tienen `acquisitionCostCents` guardado **con IVA** (bruto) o
 * **sin IVA** (neto). La convención documentada del sistema es **NETO** (la aportación calcula el
 * costo = `mercado_neto × pct`, `inventory.service.ts:997`/`money.ts:86-88`; el margen de la hoja de
 * sellado es `L_neto − costo`, `API_CONTRACT.md:37318/37324`), pero **no hay mecanismo de captura ni
 * rótulo que FUERCE el neto** en la compra firme, a diferencia del envío (que captura bruto + crédito
 * congelado). Esa decisión de convención + su arreglo es de ZONA DE DINERO → diseño + 3 veredictos y
 * pasa por el ARQUITECTO (no se arregla aquí ni se toca el contrato).
 *
 * ### Qué cierra esta prueba
 * El bloque (A) es VERDE y FIJA la asimetría medida (hecho objetivo del código).
 * El bloque (B) está **ROJO A PROPÓSITO**: codifica la hipótesis de reconciliación (costo capturado
 * CON IVA ⇒ el margen debe ser neto-contra-neto). Se pone verde cuando el arquitecto decida la
 * convención y backend implemente el neteo del COGS (o se documente que el costo SIEMPRE se guarda
 * neto y el rojo se retira porque la premisa no aplica). ⛔ No lo haga pasar debilitándolo.
 */

type OrdenFake = {
  subtotalCents: number;
  ivaCents: number;
  processingFeeCents: number;
  ivaRatePct: number;
  priceConvention: 'IVA_EXCLUSIVE' | 'IVA_INCLUSIVE';
  fulfillmentMode: 'vault' | 'direct_ship';
  shippingFeeCents: number;
  items: { inventoryItem: { acquisitionCostCents: number | null } }[];
};

const orden = (o: Partial<OrdenFake> = {}): OrdenFake => ({
  subtotalCents: 11600,
  ivaCents: 1600,
  processingFeeCents: 0,
  ivaRatePct: 16,
  priceConvention: 'IVA_INCLUSIVE',
  fulfillmentMode: 'vault',
  shippingFeeCents: 0,
  items: [{ inventoryItem: { acquisitionCostCents: 9280 } }],
  ...o,
});

function servicio(ordenes: OrdenFake[]) {
  const prisma = {
    order: { findMany: jest.fn().mockResolvedValue(ordenes) },
    shipmentRequest: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const service = new AdminService(
    withPnlBuylistDoubles(withM61Defaults(prisma)) as unknown as PrismaService,
    {} as PricingService,
    new PiiCryptoService(new ConfigService({})),
    {} as any,
  );
  return { service };
}

// Una pieza vendida IVA_INCLUSIVE a MX$116.00 (subtotal 11600) ⇒ ingreso neto = 10000.
// Comprada a un distribuidor con factura: costo NETO MX$80.00 (8000) + IVA 16% (1280) = BRUTO 9280.
// El dueño teclea el bruto (9280) porque es la cifra que trae el papel.
const NET_INCOME = taxBaseCentsOf(11600, 16); // 10000
const COST_NET = 8000;
const IVA_ON_COST = 1280; // 8000 × 16%
const COST_GROSS = COST_NET + IVA_ON_COST; // 9280

describe('🔎 DIAGNÓSTICO P&L — el COGS no se netea de IVA (fix/pnl-finanzas)', () => {
  // ===========================================================================================
  // (A) VERDE — la ASIMETRÍA medida: el ingreso se netea, el COGS no.
  // ===========================================================================================
  describe('(A) hecho medido del código: ingreso NETO, COGS CRUDO', () => {
    it('el ingreso de una orden IVA_INCLUSIVE entra NETO (taxBase), no el subtotal bruto', async () => {
      const { service } = servicio([orden()]);
      const p = await service.pnl();
      expect(p.incomeCents).toBe(NET_INCOME); // 10000, no 11600
      expect(p.incomeCents).not.toBe(11600);
    });

    it('el COGS entra CRUDO: `acquisitionCostCents` tal cual, sin restar IVA', async () => {
      const { service } = servicio([orden()]);
      const p = await service.pnl();
      // Lo que hoy hace el código: suma el bruto 9280 sin tocarlo.
      expect(p.cogsCents).toBe(COST_GROSS); // 9280
    });
  });

  // ===========================================================================================
  // (B) ROJO A PROPÓSITO — la hipótesis de reconciliación (costo capturado CON IVA).
  //     Falla hoy por exactamente `IVA_ON_COST`. Cierra el arquitecto + el arreglo de backend.
  // ===========================================================================================
  describe('(B) ⛔ ROJO pendiente de decisión del arquitecto: margen neto-contra-neto', () => {
    it('un costo capturado CON IVA debe netearse: margen = ingreso_neto − costo_neto', async () => {
      const { service } = servicio([orden()]);
      const p = await service.pnl();
      // El margen económico real: el IVA del costo (1280) es crédito acreditable contra el IVA
      // cobrado, no un gasto. Debe ser 10000 − 8000 = 2000.
      expect(p.profitCents).toBe(NET_INCOME - COST_NET); // 2000
      // Hoy da 10000 − 9280 = 720: subestimado EXACTAMENTE por el IVA del costo.
      expect(NET_INCOME - COST_GROSS).toBe(720);
      expect(p.profitCents + IVA_ON_COST).toBe(NET_INCOME - COST_NET);
    });
  });
});
