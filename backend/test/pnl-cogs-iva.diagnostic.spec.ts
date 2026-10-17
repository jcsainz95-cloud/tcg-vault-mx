import { ConfigService } from '@nestjs/config';
import { AdminService } from '../src/modules/admin/admin.service';
import { withM61Defaults } from './helpers/m61-mock-defaults';
import { withPnlBuylistDoubles } from './helpers/pnl-buylist-doubles';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { taxBaseCentsOf } from '../src/common/money';

/**
 * ⭐💰 CANDADO `IVA-15` (rama `fix/pnl-finanzas`, API_CONTRACT §M10-IVA.8-bis (A) / ARCHITECTURE §4.44.f-quater)
 * — **EL COGS DEL P&L SE NETEA DE IVA POR RESTA DEL CRÉDITO CONGELADO, espejo exacto del costo de envío.**
 *
 * Nació como DIAGNÓSTICO (bloque A verde = la asimetría medida; bloque B rojo a propósito = la reconciliación
 * pendiente de decisión del arquitecto). El arquitecto decidió (§4.44.f-quater): `InventoryItem` gana
 * `acquisitionCostIvaCents` (IVA acreditable del costo, CONGELADO al capturar), y el P&L netea por RESTA al leer
 * (`pnl-core.ts:244`: `cogs += (acquisitionCostCents ?? 0) − (acquisitionCostIvaCents ?? 0)`). Este spec EVOLUCIONA
 * al candado definitivo con el fixture que fija la columna. ⛔ No se hace pasar debilitándolo.
 *
 * ### Lo que fija (hecho objetivo del código, no opinión)
 *  - **Ingreso**: `pnl-core.ts:238` → `netRevenueCents(o)` → bajo `IVA_INCLUSIVE` = `taxBaseCentsOf(subtotal, r)`.
 *  - **COGS**: `pnl-core.ts:244` → `acquisitionCostCents − acquisitionCostIvaCents` (NETO por resta del crédito
 *    congelado), **simétrico** con el costo de envío (`:264` = `shippingCostCents − shippingCostIvaCents`).
 *  - **Amarre anti-mutación**: una pieza con `acquisitionCostIvaCents = 0` (aportación / histórica) aporta su costo
 *    **ENTERO** — no se le resta un IVA que no tiene. Mata la mutación que ignore la columna o aplique una tasa global.
 */

type OrdenFake = {
  subtotalCents: number;
  ivaCents: number;
  processingFeeCents: number;
  ivaRatePct: number;
  priceConvention: 'IVA_EXCLUSIVE' | 'IVA_INCLUSIVE';
  fulfillmentMode: 'vault' | 'direct_ship';
  shippingFeeCents: number;
  items: { inventoryItem: { acquisitionCostCents: number | null; acquisitionCostIvaCents: number } }[];
};

const orden = (o: Partial<OrdenFake> = {}): OrdenFake => ({
  subtotalCents: 11600,
  ivaCents: 1600,
  processingFeeCents: 0,
  ivaRatePct: 16,
  priceConvention: 'IVA_INCLUSIVE',
  fulfillmentMode: 'vault',
  shippingFeeCents: 0,
  // Pieza de COMPRA FIRME capturada con el BRUTO de la factura (9280) y su crédito de IVA congelado (1280).
  items: [{ inventoryItem: { acquisitionCostCents: 9280, acquisitionCostIvaCents: 1280 } }],
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
// El dueño teclea el bruto (9280); la captura congela el crédito (1280). El COGS neto es la resta ⇒ 8000.
const NET_INCOME = taxBaseCentsOf(11600, 16); // 10000
const COST_NET = 8000;
const IVA_ON_COST = 1280; // 8000 × 16%
const COST_GROSS = COST_NET + IVA_ON_COST; // 9280

describe('💰 IVA-15 — el COGS del P&L se netea de IVA por resta del crédito congelado (fix/pnl-finanzas)', () => {
  it('ingreso NETO (taxBase), no el subtotal bruto', async () => {
    const { service } = servicio([orden()]);
    const p = await service.pnl();
    expect(p.incomeCents).toBe(NET_INCOME); // 10000, no 11600
    expect(p.incomeCents).not.toBe(11600);
  });

  it('⭐ COGS NETO = acquisitionCostCents − acquisitionCostIvaCents, y margen neto-contra-neto', async () => {
    const { service } = servicio([orden()]);
    const p = await service.pnl();
    // El neteo por resta del crédito congelado: 9280 − 1280 = 8000 (NO el bruto 9280 de antes del arreglo).
    expect(p.cogsCents).toBe(COST_NET); // 8000
    expect(p.cogsCents).not.toBe(COST_GROSS); // ⛔ ya no es 9280
    // Margen económico real: el IVA del costo (1280) es crédito acreditable, no gasto ⇒ 10000 − 8000 = 2000.
    expect(p.profitCents).toBe(NET_INCOME - COST_NET); // 2000
    // Antes del arreglo daba 10000 − 9280 = 720 (subestimado EXACTAMENTE por el IVA del costo).
    expect(p.profitCents - IVA_ON_COST).toBe(720);
  });

  it('⭐ amarre anti-mutación: una pieza con acquisitionCostIvaCents=0 (aportación/histórica) aporta su costo ENTERO', async () => {
    // Dos renglones en la MISMA orden: COMPRA FIRME (9280 bruto, crédito 1280) + APORTACIÓN (8000 ya NETO, crédito 0).
    const { service } = servicio([
      orden({
        items: [
          { inventoryItem: { acquisitionCostCents: 9280, acquisitionCostIvaCents: 1280 } }, // net 8000
          { inventoryItem: { acquisitionCostCents: 8000, acquisitionCostIvaCents: 0 } }, // net 8000 (entero)
        ],
      }),
    ]);
    const p = await service.pnl();
    // La aportación NO pierde IVA (no lo tiene): 8000 + (9280 − 1280) = 16000. Una mutación que restara un IVA
    // global (p. ej. 16/116 de 8000 = 1103) daría 14897 ⇒ rojo. Y una que ignorara la columna daría 17280 ⇒ rojo.
    expect(p.cogsCents).toBe(COST_NET + 8000); // 16000
  });

  it('CONTROL: un crédito nulo deja el COGS = bruto (dirección conservadora de las filas históricas)', async () => {
    const { service } = servicio([
      orden({ items: [{ inventoryItem: { acquisitionCostCents: 9280, acquisitionCostIvaCents: 0 } }] }),
    ]);
    const p = await service.pnl();
    expect(p.cogsCents).toBe(9280); // net = bruto cuando no consta crédito
  });
});
