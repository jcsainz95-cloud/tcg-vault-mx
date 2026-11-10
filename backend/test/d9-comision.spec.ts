/**
 * D9 — la comisión de plataforma DENTRO del precio (docs/specs/D9_COMISION.md §6, criterios C1–C9 en centavos).
 * Dials de hoy: pct 0.036, fijo 300, IVA 16 %, envío ejemplo 10000, gratis desde 400000. Aritmética pura (N=1 por caso, determinista).
 */
import {
  FeeFormulaError,
  computeCartBreakdown,
  computeDirectShipBreakdown,
  computeShipmentBreakdown,
  estimateStripeFeeCents,
  feeIncludedPriceCentsOf,
  FEE_CONVENTION_OF_NEW_ROWS,
  itemMissingRefundComponents,
  saleDisplayCentsOf,
  type DiscountTerms,
  type IvaDials,
} from '../src/common/money';
import { SettingsService } from '../src/modules/settings/settings.service';
import { PRICE_AFFECTING_SETTING_KEYS, SettingKey } from '../src/modules/settings/settings.constants';
import { directShipFeeOf } from '../src/modules/orders/shipping-rule';
import { priceVaultCartWithCode } from '../src/modules/discounts/discount-pricing';

const FEE = { stripePct: 0.036, stripeFixedCents: 300, stripeFeeIvaPct: 0.16 };
const DIALS: IvaDials = { ivaTransferPct: 100, ivaRatePct: 16, stripeFeePct: 0.036 };
const SHIP = { cardsFeeCents: 10000, sealedFeeCents: 17500, freeFromCents: 400000 };
/** `M = 10000` con IVA dentro ⇒ `L` tal que `displayPriceCentsOf(L,100,16) = 10000`: L = 8621 ⇒ round(8621×1.16)=10000. */
const L_FOR_M_10000 = 8621;

describe('D9 C1 — el precio exhibido lleva la comisión dentro (por unidad, al peso hacia arriba)', () => {
  it('M = 10000 ⇒ P = 10500 (ceilPeso(10436))', () => {
    expect(feeIncludedPriceCentsOf(10000, 0.036, 16)).toBe(10500);
  });
  it('un múltiplo exacto NO sube un peso de más (techo entero, sin flotante)', () => {
    // M tal que M/0.95824 es entero de pesos: 95824 ⇒ 100000 exactos.
    expect(feeIncludedPriceCentsOf(95824, 0.036, 16)).toBe(100000);
    expect(feeIncludedPriceCentsOf(95825, 0.036, 16)).toBe(100100);
  });
  it('saleDisplayCentsOf: calculado ⇒ lleva comisión; precio final del dueño (C9) ⇒ tal cual', () => {
    expect(saleDisplayCentsOf({ listPriceCents: L_FOR_M_10000, fixedDisplayCents: null }, DIALS)).toBe(10500);
    expect(saleDisplayCentsOf({ listPriceCents: 1, fixedDisplayCents: 25000 }, DIALS)).toBe(25000);
  });
  it('comisión 0 ⇒ nada que absorber: P es el exhibido con IVA tal cual (sin redondeo al peso)', () => {
    expect(feeIncludedPriceCentsOf(13340, 0, 16)).toBe(13340);
    expect(feeIncludedPriceCentsOf(13340, 0.036, 16)).toBe(14000); // con comisión sí sube al peso: ceil(133.40/0.95824) = 140
  });
  it('8.4 (ii): sin `stripeFeePct`, no finito o con divisor < 0.75 ⇒ FeeFormulaError (falla cerrado, nunca un precio sin comisión)', () => {
    const calc = (d: object) => () => saleDisplayCentsOf({ listPriceCents: L_FOR_M_10000, fixedDisplayCents: null }, d as never);
    expect(calc({ ivaTransferPct: 100, ivaRatePct: 16 })).toThrow(FeeFormulaError);
    expect(calc({ ivaTransferPct: 100, ivaRatePct: 16, stripeFeePct: NaN })).toThrow(FeeFormulaError);
    expect(calc({ ivaTransferPct: 100, ivaRatePct: 16, stripeFeePct: -0.01 })).toThrow(FeeFormulaError);
    expect(calc({ ivaTransferPct: 100, ivaRatePct: 16, stripeFeePct: 0.22 })).toThrow(FeeFormulaError); // 0.22×1.16 = 0.2552 > 0.25
    expect(calc({ ivaTransferPct: 100, ivaRatePct: 16, stripeFeePct: 0.21 })).not.toThrow(); // 0.2436 ≤ 0.25
  });
});

describe('D9 C2/C3 — total = ΣP + envío, sin gross-up encima', () => {
  it('C2: 1 carta P=10500 + envío 10000 ⇒ total 20500, comisión 0', () => {
    const b = computeDirectShipBreakdown(10500, 10000, 16);
    expect(b).toMatchObject({ subtotalCents: 10500, shippingFeeCents: 10000, processingFeeCents: 0, totalCents: 20500 });
  });
  it('C3: 10 cartas de M=10000 ⇒ ΣP = 105000 (por unidad, no 104400); con envío 115000', () => {
    const sigma = Array.from({ length: 10 }, () => feeIncludedPriceCentsOf(10000, 0.036, 16)).reduce((a, b) => a + b, 0);
    expect(sigma).toBe(105000);
    expect(computeCartBreakdown(sigma, 16)).toMatchObject({ processingFeeCents: 0, totalCents: 105000 });
    expect(computeDirectShipBreakdown(sigma, 10000, 16).totalCents).toBe(115000);
  });
  it('costo de Stripe estimado: C2 1204, C3 5150', () => {
    expect(estimateStripeFeeCents(20500, FEE)).toBe(1204);
    expect(estimateStripeFeeCents(115000, FEE)).toBe(5150);
  });
  it('un agregado > Int32 se rechaza (no se clampa)', () => {
    expect(() => computeCartBreakdown(2_147_483_648, 16)).toThrow(/MAX_CENTS/);
  });
  it('las filas nuevas nacen FEE_INCLUDED', () => {
    expect(FEE_CONVENTION_OF_NEW_ROWS).toBe('FEE_INCLUDED');
  });
});

describe('D9 C4 — envío gratis desde 400000 sobre el subtotal exhibido (con comisión)', () => {
  const S = 389600 + feeIncludedPriceCentsOf(10000, 0.036, 16);
  it('389600 (sellado a precio final) + carta P=10500 = 400100 ⇒ envío 0', () => {
    expect(S).toBe(400100);
    expect(directShipFeeOf('cards_only', S, SHIP, null).feeCents).toBe(0);
  });
  it('399999 cobra; 400000 exacto es gratis (>=)', () => {
    expect(directShipFeeOf('cards_only', 399999, SHIP, null).feeCents).toBe(10000);
    expect(directShipFeeOf('cards_only', 400000, SHIP, null).feeCents).toBe(0);
  });
});

describe('D9 C5 — código 10 % sobre el precio exhibido', () => {
  const terms: DiscountTerms = { kind: 'percent', percentPct: 10, amountCents: null, maxDiscountCents: null, minSubtotalCents: null, productScopes: [], destinations: [] };
  it('P=10500 ⇒ descuento 1050, subtotal 9450, total 9450 (sin recálculo de comisión)', () => {
    const p = priceVaultCartWithCode([{ id: 'a', group: 'piece', type: 'raw', unitPriceCents: 10500, quantity: 1 }], terms, 16);
    expect(p).toMatchObject({ outcome: 'applied', discountCents: 1050 });
    if (p.outcome !== 'applied') throw new Error('no aplicó');
    expect(p.breakdown).toMatchObject({ subtotalCents: 9450, processingFeeCents: 0, totalCents: 9450 });
  });
});

describe('D9 C6 — retiro de bóveda: se muestra y se cobra el dial, sin comisión', () => {
  it('10000 ⇒ total 10000, comisión 0; costo Stripe estimado 766', () => {
    expect(computeShipmentBreakdown(10000, 16)).toMatchObject({ subtotalCents: 10000, processingFeeCents: 0, totalCents: 10000 });
    expect(estimateStripeFeeCents(10000, FEE)).toBe(766);
  });
});

describe('D9 C7 — reembolso de la carta = P pagado, sin parte de comisión', () => {
  it('pedido C2 (processingFeeCents 0) ⇒ item_missing devuelve 10500', () => {
    const o = { subtotalCents: 10500, shippingFeeCents: 10000, processingFeeCents: 0, ivaCents: 0, ivaRatePct: 16, totalCents: 20500, priceConvention: 'IVA_INCLUSIVE' as const };
    expect(itemMissingRefundComponents(o, 10500)).toMatchObject({ amountCents: 10500, processingFeeCents: 0 });
  });
  it('C8: un pedido viejo (FEE_ON_TOP, comisión 4617) se reembolsa como antes: P + floor(F×P/G)', () => {
    const o = { subtotalCents: 80000, shippingFeeCents: 15000, processingFeeCents: 4617, ivaCents: 0, ivaRatePct: 16, totalCents: 99617, priceConvention: 'IVA_INCLUSIVE' as const };
    expect(itemMissingRefundComponents(o, 30000).amountCents).toBe(31458);
  });
});

describe('D9 — candado de escritores: toda fila nueva de Order/ShipmentRequest estampa `feeConvention` desde la constante', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { readFileSync, readdirSync } = require('node:fs') as typeof import('node:fs');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { join } = require('node:path') as typeof import('node:path');
  const walk = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) => {
      const f = join(d, e.name);
      return e.isDirectory() ? walk(f) : e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts') ? [f] : [];
    });
  const files = walk(join(__dirname, '..', 'src'));
  const code = (f: string) => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const WRITERS = [
    'orders/orders.service.ts',
    'orders/guest-checkout.service.ts',
    'shipments/shipments.service.ts',
    'shipments/inbound-shipment.service.ts',
    'payments/payments.service.ts',
  ];
  const count = (re: RegExp) => files.reduce((n, f) => n + (code(f).match(re)?.length ?? 0), 0);

  it('exactamente 7 escritores (2 Order + 5 ShipmentRequest) escriben la constante; ningún escritor de FEE_ON_TOP en código', () => {
    expect(count(/feeConvention:\s*FEE_CONVENTION_OF_NEW_ROWS/g)).toBe(7);
    expect(count(/feeConvention\s*[:=]\s*['"`]FEE_ON_TOP/g)).toBe(0);
  });
  it('cada escritor de `priceConvention` lleva su `feeConvention` (mismos ficheros, mismo conteo)', () => {
    for (const w of WRITERS) {
      const f = files.find((x) => x.endsWith(w)) as string;
      const price = (code(f).match(/priceConvention:\s*PRICE_CONVENTION_OF_NEW_ROWS/g) ?? []).length;
      const fee = (code(f).match(/feeConvention:\s*FEE_CONVENTION_OF_NEW_ROWS/g) ?? []).length;
      // orders.service.ts trae además `zeroCartBreakdown` (un DTO, no una fila): una aparición de más en `priceConvention`.
      expect(fee).toBe(w === 'orders/orders.service.ts' ? price - 1 : price);
    }
  });
});

describe('D9-4 — ningún correo ni ticket del servidor menciona la comisión (pedidos nuevos)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { readFileSync, readdirSync } = require('node:fs') as typeof import('node:fs');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { join } = require('node:path') as typeof import('node:path');
  const walk = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) => {
      const f = join(d, e.name);
      return e.isDirectory() ? walk(f) : e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts') ? [f] : [];
    });
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const MENCION = /comisi[oó]n|processing[ _-]?fee|platform[ _-]?fee|service[ _-]?fee/i;
  it('src/modules/mail/** (plantillas y armado de correos) no contiene la palabra comisión / processing fee / platform fee', () => {
    const files = walk(join(__dirname, '..', 'src', 'modules', 'mail'));
    expect(files.length).toBeGreaterThan(3);
    const culpables = files.filter((f) => MENCION.test(strip(readFileSync(f, 'utf8'))));
    expect(culpables).toEqual([]);
  });
  it('canario: el detector SÍ ve la palabra (no es ciego)', () => {
    expect(MENCION.test(strip('const t = "Incluye comisión de plataforma";'))).toBe(true);
    expect(MENCION.test(strip('// comisión en un comentario\nconst x = 1;'))).toBe(false);
  });
});

describe('D9 — el dial que mete la comisión en `P` llega a TODA derivación de precio', () => {
  it('getIvaDials trae `stripeFeePct` (fila del dial; si no hay fila, el default 0.036)', async () => {
    const rows: { key: string; valueJson: unknown }[] = [{ key: 'stripe_fee_pct', valueJson: 0.04 }];
    const svc = new SettingsService({ configSetting: { findMany: async () => rows } } as never);
    expect(await svc.getIvaDials()).toEqual({ ivaTransferPct: 100, ivaRatePct: 16, stripeFeePct: 0.04 });
    rows.length = 0;
    expect((await svc.getIvaDials()).stripeFeePct).toBe(0.036);
  });
  it('`stripe_fee_pct` mueve P ⇒ está en PRICE_AFFECTING (re-precia al instante); `stripe_fee_fixed_cents` NO entra a P ⇒ no está', () => {
    expect(PRICE_AFFECTING_SETTING_KEYS).toContain(SettingKey.STRIPE_FEE_PCT);
    expect(PRICE_AFFECTING_SETTING_KEYS).not.toContain(SettingKey.STRIPE_FEE_FIXED_CENTS);
  });
  it('cambiar el dial cambia P: 3.6 % ⇒ 10500; 5 % ⇒ 10700 (M=10000, ceilPeso(10000/0.942))', () => {
    expect(feeIncludedPriceCentsOf(10000, 0.036, 16)).toBe(10500);
    expect(feeIncludedPriceCentsOf(10000, 0.05, 16)).toBe(10700); // 10000/0.942 = 10615.7 ⇒ 10700
  });
});
