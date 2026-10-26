/**
 * discounts-v1103.pure.spec.ts — 💰 contrato v1.110.3 (§DSC) y el refactor del rechazo del techlead sobre `c421de13`, la
 * parte PURA. Propiedad: backend. Deterministas (N=1 dicho como tal).
 *
 *  DCO-B20 (pura) precedencia de los motivos de §DSC.4 con los diales de hoy y `free_shipping` con mínimo 300000.
 *  DCO-B21 (`discountOf` y `preview`) `capped` = solo el tope en pesos.
 *  §DSC.6 `details` mínimos (pentest DSC-1).
 *  DCO-B16 (puro) el proyector de línea: `unitPriceBeforeDiscountCents`/`lineTotalBeforeDiscountCents` solo con rebaja > 0.
 *  TL-DSC-3 `pieceDiscountLines` lanza ante una pieza ausente. TL-ENV-1 una sola cadena `directShipBreakdownOf` con
 *  `representableOrThrow` dentro (también en la bóveda con código). TL-DSC-4 un solo lector del código de la orden.
 *  TL-DSC-5 `DiscountsService` OBLIGATORIO en la inyección de orders, guest-checkout y shipments.
 */
import 'reflect-metadata';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { DiscountCartLine, DiscountTerms, computeDirectShipBreakdown, discountOf } from '../src/common/money';
import { priceDirectShipCartWithCode, priceVaultCartWithCode, withdrawalCodeOutcome } from '../src/modules/discounts/discount-pricing';
import { discountedAccessoryLine, pieceDiscountLines, projectLineDiscount } from '../src/modules/discounts/discount-lines';
import { AdminDiscountsService } from '../src/modules/discounts/admin-discounts.service';
import { DiscountsService } from '../src/modules/discounts/discounts.service';
import { directShipBreakdownOf, directShipFeeOf } from '../src/modules/orders/shipping-rule';
import { OrdersService } from '../src/modules/orders/orders.service';
import { GuestCheckoutService } from '../src/modules/orders/guest-checkout.service';
import { ShipmentsService } from '../src/modules/shipments/shipments.service';
import { BusinessException } from '../src/common/business.exception';
import type { BoxChoice } from '../src/modules/orders/box-fit';

const FEE = { stripePct: 0.036, stripeFixedCents: 300, stripeFeeIvaPct: 0.16 };
const DIALS = { cardsFeeCents: 10000, sealedFeeCents: 17500, freeFromCents: 400000 };
const BIG_BOX = { box: { code: 'XL', label: 'XL', customerFeeCents: 35000 }, review: false } as unknown as BoxChoice;

const terms = (t: Partial<DiscountTerms> & Pick<DiscountTerms, 'kind'>): DiscountTerms => ({
  percentPct: null,
  amountCents: null,
  maxDiscountCents: null,
  minSubtotalCents: null,
  productScopes: [],
  destinations: [],
  ...t,
});
const card = (id: string, P: number): DiscountCartLine => ({ id, group: 'piece', type: 'raw', unitPriceCents: P, quantity: 1 });
const sealed = (id: string, P: number): DiscountCartLine => ({ id, group: 'piece', type: 'sealed', unitPriceCents: P, quantity: 1 });
const accessory = (id: string, P: number, q = 1): DiscountCartLine => ({ id, group: 'accessory', type: 'accessory', unitPriceCents: P, quantity: q });
const FREE_MIN = terms({ kind: 'free_shipping', minSubtotalCents: 300000 });
const reasonOf = (r: { outcome: string; reason?: string }) => (r.outcome === 'applied' ? 'applied' : r.reason);

describe('DCO-B20 (pura, v1.110.3) — precedencia de §DSC.4: NO_SHIPPING → DESTINATION → NO_ELIGIBLE_ITEMS → LARGE_BOX → ALREADY_FREE_SHIPPING → MIN_SUBTOTAL → TOTAL_BELOW_MINIMUM', () => {
  it('(a) bóveda, carta 100000, envío gratis con mínimo 300000 ⇒ NO_SHIPPING (en c421de13: MIN_SUBTOTAL)', () => {
    expect(priceVaultCartWithCode([card('a', 100000)], FREE_MIN, 16, FEE)).toEqual({ outcome: 'not_applicable', reason: 'NO_SHIPPING', details: {} });
  });
  it('(b) igual con destinations = [direct_ship] ⇒ NO_SHIPPING (gana a DESTINATION)', () => {
    expect(reasonOf(priceVaultCartWithCode([card('a', 100000)], { ...FREE_MIN, destinations: ['direct_ship'] }, 16, FEE))).toBe('NO_SHIPPING');
  });
  it('(c) mínimo 500000, invitado, cartas 450000 ⇒ ALREADY_FREE_SHIPPING (gana a MIN_SUBTOTAL)', () => {
    const r = priceDirectShipCartWithCode([card('a', 450000)], terms({ kind: 'free_shipping', minSubtotalCents: 500000 }), { kind: 'cards_only', dials: DIALS, choice: null }, 16, FEE);
    expect(r).toEqual({ outcome: 'not_applicable', reason: 'ALREADY_FREE_SHIPPING', details: {} });
  });
  it('(d) invitado, sellado 100000 + accesorio 20000 en caja de 35000 ⇒ LARGE_BOX (gana a MIN_SUBTOTAL)', () => {
    const r = priceDirectShipCartWithCode([sealed('s', 100000), accessory('x', 20000)], FREE_MIN, { kind: 'sealed', dials: DIALS, choice: BIG_BOX }, 16, FEE);
    expect(r).toEqual({ outcome: 'not_applicable', reason: 'LARGE_BOX', details: {} });
  });
  it('(e) cartas 250000 ⇒ MIN_SUBTOTAL { missingCents: 50000 }; con 300000 ⇒ applied, shippingWaivedCents = 10000', () => {
    const ship = { kind: 'cards_only' as const, dials: DIALS, choice: null };
    expect(priceDirectShipCartWithCode([card('a', 250000)], FREE_MIN, ship, 16, FEE)).toEqual({ outcome: 'not_applicable', reason: 'MIN_SUBTOTAL', details: { missingCents: 50000 } });
    const ok = priceDirectShipCartWithCode([card('a', 300000)], FREE_MIN, ship, 16, FEE);
    if (ok.outcome !== 'applied') throw new Error(JSON.stringify(ok));
    expect(ok.shippingWaivedCents).toBe(10000);
    expect(ok.breakdown).toEqual(computeDirectShipBreakdown(300000, 0, 16, FEE));
  });
  it('(f) 10 % con destinations = [direct_ship] y mínimo 300000, bóveda 100000 ⇒ DESTINATION (no es envío gratis: NO_SHIPPING no aplica)', () => {
    const r = priceVaultCartWithCode([card('a', 100000)], terms({ kind: 'percent', percentPct: 10, destinations: ['direct_ship'], minSubtotalCents: 300000 }), 16, FEE);
    expect(r).toEqual({ outcome: 'not_applicable', reason: 'DESTINATION', details: {} });
  });
  it('NO_ELIGIBLE_ITEMS gana a LARGE_BOX y a MIN_SUBTOTAL; DESTINATION gana a NO_ELIGIBLE_ITEMS (envío gratis directo)', () => {
    const ship = { kind: 'sealed' as const, dials: DIALS, choice: BIG_BOX };
    expect(reasonOf(priceDirectShipCartWithCode([sealed('s', 1000)], { ...FREE_MIN, productScopes: ['raw'] }, ship, 16, FEE))).toBe('NO_ELIGIBLE_ITEMS');
    expect(reasonOf(priceDirectShipCartWithCode([sealed('s', 1000)], { ...FREE_MIN, productScopes: ['raw'], destinations: ['vault'] }, ship, 16, FEE))).toBe('DESTINATION');
  });
  it('% y monto: DESTINATION → NO_ELIGIBLE_ITEMS → MIN_SUBTOTAL → TOTAL_BELOW_MINIMUM (los de envío gratis no aplican)', () => {
    const ship = { kind: 'sealed' as const, dials: DIALS, choice: BIG_BOX };
    const t = terms({ kind: 'fixed_amount', amountCents: 1500, minSubtotalCents: 2000 });
    expect(reasonOf(priceDirectShipCartWithCode([sealed('s', 1000)], t, ship, 16, FEE))).toBe('MIN_SUBTOTAL');
    expect(reasonOf(priceVaultCartWithCode([card('a', 2000)], t, 16, FEE))).toBe('TOTAL_BELOW_MINIMUM');
    expect(reasonOf(priceVaultCartWithCode([card('a', 1999)], t, 16, FEE))).toBe('MIN_SUBTOTAL');
  });
  it('retiro: WITHDRAWAL_ONLY_FREE_SHIPPING → WITHDRAWAL_FILTERED → DESTINATION → ALREADY_FREE_SHIPPING', () => {
    expect(withdrawalCodeOutcome(terms({ kind: 'percent', percentPct: 10, minSubtotalCents: 1, destinations: ['vault'] }), 0)).toMatchObject({ reason: 'WITHDRAWAL_ONLY_FREE_SHIPPING' });
    expect(withdrawalCodeOutcome(terms({ kind: 'free_shipping', minSubtotalCents: 1, destinations: ['vault'] }), 0)).toMatchObject({ reason: 'WITHDRAWAL_FILTERED' });
    expect(withdrawalCodeOutcome(terms({ kind: 'free_shipping', destinations: ['vault'] }), 0)).toEqual({ outcome: 'not_applicable', reason: 'DESTINATION', details: {} });
    expect(withdrawalCodeOutcome(terms({ kind: 'free_shipping' }), 0)).toMatchObject({ reason: 'ALREADY_FREE_SHIPPING' });
  });
});

describe('§DSC.6 `details` mínimos (v1.110.3, pentest DSC-1)', () => {
  it('MIN_SUBTOTAL {missingCents} · NO_ELIGIBLE_ITEMS {productScopes} · TOTAL_BELOW_MINIMUM {minTotalCents} · el resto {}', () => {
    const v = (t: DiscountTerms, lines: DiscountCartLine[]) => priceVaultCartWithCode(lines, t, 16, FEE);
    expect(v(terms({ kind: 'percent', percentPct: 10, minSubtotalCents: 5000 }), [card('a', 4000)])).toMatchObject({ details: { missingCents: 1000 } });
    expect(Object.keys((v(terms({ kind: 'percent', percentPct: 10, minSubtotalCents: 5000 }), [card('a', 4000)]) as { details: object }).details)).toEqual(['missingCents']);
    expect(v(terms({ kind: 'percent', percentPct: 10, productScopes: ['sealed'] }), [card('a', 4000)])).toMatchObject({ details: { productScopes: ['sealed'] } });
    expect(v(terms({ kind: 'fixed_amount', amountCents: 1500 }), [card('a', 2000)])).toMatchObject({ details: { minTotalCents: 1000 } });
    expect(v(terms({ kind: 'percent', percentPct: 10, destinations: ['direct_ship'] }), [card('a', 4000)])).toMatchObject({ details: {} });
  });
});

describe('DCO-B21 (v1.110.3) — `capped` = solo el tope en pesos, lo da `discountOf` y la vista previa lo reenvía', () => {
  const admin = new AdminDiscountsService({} as never, {} as never);
  const preview = (body: Record<string, unknown>) => admin.preview(body, new Date('2026-10-26T12:00:00Z'));
  const cases: [string, Record<string, unknown>, DiscountCartLine[], { discountCents: number; nominalCents: number; capped: boolean }][] = [
    ['20 % tope 30000 sobre 200000', { kind: 'percent', percentPct: 20, maxDiscountCents: 30000 }, [card('a', 200000)], { discountCents: 30000, nominalCents: 30000, capped: true }],
    ['20 % tope 40000 (igual al tope)', { kind: 'percent', percentPct: 20, maxDiscountCents: 40000 }, [card('a', 200000)], { discountCents: 40000, nominalCents: 40000, capped: false }],
    ['10 % sin tope', { kind: 'percent', percentPct: 10 }, [card('a', 200000)], { discountCents: 20000, nominalCents: 20000, capped: false }],
    ['fijo 50000 sobre una pieza de 40000 (I-4)', { kind: 'fixed_amount', amountCents: 50000 }, [card('a', 40000)], { discountCents: 39999, nominalCents: 39999, capped: false }],
    ['100 % sin tope', { kind: 'percent', percentPct: 100 }, [card('a', 40000)], { discountCents: 39999, nominalCents: 39999, capped: false }],
  ];
  it.each(cases)('%s', (_name, cfg, lines, expected) => {
    const d = discountOf(lines, terms(cfg as Partial<DiscountTerms> & Pick<DiscountTerms, 'kind'>), { destination: 'vault' });
    if (!d.ok) throw new Error(JSON.stringify(d));
    expect({ nominalCents: d.nominalCents, capped: d.capped }).toEqual({ nominalCents: expected.nominalCents, capped: expected.capped });
    const p = preview({ ...cfg, sampleLines: lines.map((l) => ({ scope: l.type, priceCents: l.unitPriceCents, quantity: l.quantity })) });
    expect(p).toEqual(expected);
  });
  it('fijo 1000 sobre 3 × 1000 de accesorio ⇒ { 999, 1000, false } (el residuo que no cabe NO es capped)', () => {
    expect(preview({ kind: 'fixed_amount', amountCents: 1000, sampleLines: [{ scope: 'accessory', priceCents: 1000, quantity: 3 }] })).toEqual({ discountCents: 999, nominalCents: 1000, capped: false });
  });
  it('free_shipping ⇒ { 0, 0, false }', () => {
    expect(preview({ kind: 'free_shipping', sampleLines: [{ scope: 'raw', priceCents: 1000, quantity: 1 }] })).toEqual({ discountCents: 0, nominalCents: 0, capped: false });
  });
});

describe('DCO-B16 (puro, v1.110.3) — EL proyector de línea', () => {
  it('sin rebaja ⇒ la línea tal cual (⛔ ni 0 ni null); con rebaja ⇒ unitDiscountCents + unitPriceBeforeDiscountCents', () => {
    const l = { inventoryItemId: 'a', unitPriceCents: 90000 };
    expect(projectLineDiscount(l, 0)).toBe(l);
    expect(projectLineDiscount(l, null)).toBe(l);
    expect(projectLineDiscount(l, 10000)).toEqual({ inventoryItemId: 'a', unitPriceCents: 90000, unitDiscountCents: 10000, unitPriceBeforeDiscountCents: 100000 });
  });
  it('accesorio 2 × 15000 con 10 % ⇒ cobrado 13500, lineTotalCents 27000, lineTotalBeforeDiscountCents 30000', () => {
    const line = { accessoryId: 'x', unitPriceCents: 15000, quantity: 2, lineTotalCents: 30000 };
    const out = discountedAccessoryLine(line, 0, new Map([['acc:x:0', 1500]]));
    expect(out).toEqual({ accessoryId: 'x', unitPriceCents: 13500, quantity: 2, lineTotalCents: 27000, unitDiscountCents: 1500, unitPriceBeforeDiscountCents: 15000, lineTotalBeforeDiscountCents: 30000 });
    expect(discountedAccessoryLine(line, 0, new Map())).toBe(line);
  });
});

describe('TL-DSC-3 — `pieceDiscountLines` no adivina el tipo de una pieza ausente', () => {
  it('pieza presente ⇒ su tipo; ausente ⇒ lanza (antes: `sealed` en silencio)', () => {
    expect(pieceDiscountLines([{ id: 'a', productType: 'raw' }], [{ inventoryItemId: 'a', unitPriceCents: 1000 }])[0].type).toBe('raw');
    expect(() => pieceDiscountLines([], [{ inventoryItemId: 'a', unitPriceCents: 1000 }])).toThrow(/TL-DSC-3/);
  });
});

describe('TL-ENV-1 — una sola cadena clase → importe → desglose, con `representableOrThrow` dentro', () => {
  it('directShipBreakdownOf = directShipFeeOf + computeDirectShipBreakdown (cartas, sellado, umbral, caja)', () => {
    for (const [kind, S, choice] of [['cards_only', 50000, null], ['sealed', 50000, null], ['cards_only', 400000, null], ['sealed', 100000, BIG_BOX]] as const) {
      const fee = directShipFeeOf(kind, S, DIALS, choice);
      expect(directShipBreakdownOf({ kind, subtotalCents: S, dials: DIALS, choice, ivaRatePct: 16, fee: FEE })).toEqual({ ship: fee, breakdown: computeDirectShipBreakdown(S, fee.feeCents, 16, FEE) });
    }
  });
  it('S + E no representable ⇒ 422 AMOUNT_TOO_LARGE (no un Error crudo) — sin código, con % directo y con % en bóveda', () => {
    const huge = 2_147_000_000;
    const asCode = (fn: () => unknown) => {
      try {
        fn();
      } catch (e) {
        return e instanceof BusinessException ? e.code : `crudo: ${(e as Error).message}`;
      }
      return 'no lanzó';
    };
    expect(asCode(() => directShipBreakdownOf({ kind: 'cards_only', subtotalCents: huge, dials: DIALS, choice: null, ivaRatePct: 16, fee: FEE }))).toBe('AMOUNT_TOO_LARGE');
    expect(asCode(() => priceDirectShipCartWithCode([card('a', huge)], terms({ kind: 'percent', percentPct: 1 }), { kind: 'cards_only', dials: DIALS, choice: null }, 16, FEE))).toBe('AMOUNT_TOO_LARGE');
    expect(asCode(() => priceVaultCartWithCode([card('a', huge)], terms({ kind: 'percent', percentPct: 1 }), 16, FEE))).toBe('AMOUNT_TOO_LARGE');
  });
  it('candado de fuente: ni `guest-checkout.service.ts` ni `discount-pricing.ts` llaman a computeDirectShipBreakdown( (TL-ENV-1)', () => {
    for (const f of ['src/modules/orders/guest-checkout.service.ts', 'src/modules/discounts/discount-pricing.ts']) {
      expect({ f, n: (readFileSync(join(__dirname, '..', f), 'utf8').match(/computeDirectShipBreakdown\(/g) ?? []).length }).toEqual({ f, n: 0 });
    }
  });
});

/** Todos los `.ts` de `src/` (sin pruebas). */
function srcFiles(dir = join(__dirname, '..', 'src')): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? srcFiles(p) : p.endsWith('.ts') && !p.endsWith('.spec.ts') ? [p] : [];
  });
}

describe('TL-DSC-4 y la orquestación en `discounts/` — candados de fuente', () => {
  it('«¿la orden lleva código?» se lee en UN sitio: `discountRedemption.findUnique({ where: { orderId` solo en discounts/redemption.ts', () => {
    const hits = srcFiles().filter((f) => /discountRedemption\.findUnique\(\{\s*where:\s*\{\s*orderId/.test(readFileSync(f, 'utf8')));
    expect(hits.map((f) => f.split('/src/')[1])).toEqual(['modules/discounts/redemption.ts']);
  });
  it('validez, intentos y uso solo los orquesta `DiscountsService`: fuera de discounts/ nadie llama a su evaluate/recordFailure/reserve/throttleKeys', () => {
    const hits = srcFiles()
      .filter((f) => !f.includes('/modules/discounts/'))
      .flatMap((f) =>
        /(discounts|discountsSvc|requireDiscounts\(\))\.(evaluate|recordFailure|reserve|throttleKeys|assertNotBlocked|retryAfterSeconds)\(/.test(readFileSync(f, 'utf8')) ? [f.split('/src/')[1]] : [],
      );
    expect(hits).toEqual([]);
  });
});

describe('TL-DSC-5 — `DiscountsService` es OBLIGATORIO en la inyección (sin `@Optional()`)', () => {
  it.each([
    ['OrdersService', OrdersService],
    ['GuestCheckoutService', GuestCheckoutService],
    ['ShipmentsService', ShipmentsService],
  ] as const)('%s', (_n, cls) => {
    const types: unknown[] = Reflect.getMetadata('design:paramtypes', cls) ?? [];
    const idx = types.indexOf(DiscountsService);
    expect(idx).toBeGreaterThanOrEqual(0);
    const optional: number[] = Reflect.getMetadata('optional:paramtypes', cls) ?? [];
    expect(optional).not.toContain(idx);
  });
});
