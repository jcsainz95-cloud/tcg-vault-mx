// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  discountOf,
  evaluateMockDiscount,
  mockCreateCode,
  mockPreview,
  mockProjectAccessoryLine,
  resetMockDiscounts,
  type DiscountLine,
  type DiscountRule,
} from './discounts';
import { DIRECT_SHIP_DEFAULT_DIALS } from './shipping-rule';
import { getGuestCheckoutQuote, mockDiscountedDirectShip } from '@/lib/api';

/**
 * Contrato v1.110.3 (`083d589c`) en el simulador: precedencia de motivos (DCO-B20), `capped` solo por tope (DCO-B21) y la
 * proyección de línea de §DSC.6. Como `discounts.parity.test.ts`: las cifras se LEEN del contrato; si el arquitecto cambia un
 * número, la prueba cambia con él o se pone roja.
 */

const ROOT = join(__dirname, '..', '..', '..', '..');
const CONTRACT = readFileSync(join(ROOT, 'docs', 'API_CONTRACT.md'), 'utf8');
const DSC = (() => {
  const start = CONTRACT.indexOf('## <a id="DSC"></a>DSC.');
  expect(start).toBeGreaterThan(-1);
  const end = CONTRACT.indexOf('\n## ', start + 10);
  return CONTRACT.slice(start, end === -1 ? undefined : end).replace(/\s+/g, ' ');
})();

function grab(re: RegExp): number[] {
  const m = re.exec(DSC);
  expect(m, `el contrato ya no dice ${re}`).not.toBeNull();
  return m!.slice(1).map((x) => Number(x.replace(/[,]/g, '')));
}

const rule = (r: Partial<DiscountRule>): DiscountRule => ({
  kind: 'percent',
  percentPct: null,
  amountCents: null,
  maxDiscountCents: null,
  minSubtotalCents: null,
  productScopes: [],
  destinations: [],
  ...r,
});
const card = (id: string, priceCents: number): DiscountLine => ({ id, kind: 'item', scope: 'raw', priceCents, quantity: 1 });

beforeEach(() => resetMockDiscounts());

describe('DCO-B20 v1.110.3 — precedencia de `not_applicable` de §DSC.4 (el mock da lo mismo que pura y quote)', () => {
  const ORDER = ['NO_SHIPPING', 'DESTINATION', 'NO_ELIGIBLE_ITEMS', 'LARGE_BOX', 'ALREADY_FREE_SHIPPING', 'MIN_SUBTOTAL', 'TOTAL_BELOW_MINIMUM'];

  it('el contrato fija el orden 1…7 y los diales de los casos', () => {
    const m = /1 `(\w+)` · 2 `(\w+)` · 3 `(\w+)` · 4 `(\w+)` · 5 `(\w+)` · 6 `(\w+)` · 7 `(\w+)`/.exec(DSC);
    expect(m, 'el contrato ya no enumera la precedencia 1…7').not.toBeNull();
    expect(m!.slice(1)).toEqual(ORDER);
    const [T, cards, sealed] = grab(/diales de hoy \(T (\d+), cartas (\d+), sellado (\d+)\)/);
    expect(DIRECT_SHIP_DEFAULT_DIALS).toEqual({ freeFromCents: T, cardsFeeCents: cards, sealedFeeCents: sealed });
  });

  const [MIN] = grab(/DCO-B20\*\* .{0,120}`free_shipping` con mínimo (\d+)/);
  const envio = (over: Partial<Parameters<typeof mockCreateCode>[0]> = {}) =>
    mockCreateCode({ code: 'B20ENVIO', kind: 'free_shipping', minSubtotalCents: MIN, ...over }).code;
  const vaultCtx = (price: number) => ({
    destination: 'vault' as const,
    customer: null,
    lines: [card('a', price)],
    close: ({ subtotalCents }: { subtotalCents: number }) => ({ ok: true as const, totalCents: subtotalCents, shippingWaivedCents: 0 }),
  });

  it('(a) bóveda, carta 100000 ⇒ NO_SHIPPING (no «te faltan»); (b) igual con `destinations = [direct_ship]`', () => {
    const [price] = grab(/\(a\) bóveda, carta (\d+) ⇒ `NO_SHIPPING`/);
    expect(evaluateMockDiscount(envio(), vaultCtx(price)).dto).toEqual({ outcome: 'not_applicable', code: 'B20ENVIO', reason: 'NO_SHIPPING', details: {} });
    resetMockDiscounts();
    expect(DSC).toMatch(/\(b\) igual con `destinations = \[direct_ship\]` ⇒ `NO_SHIPPING`/);
    expect(evaluateMockDiscount(envio({ destinations: ['direct_ship'] }), vaultCtx(price)).dto).toMatchObject({ reason: 'NO_SHIPPING', details: {} });
    // La pura también: NO_SHIPPING gana a DESTINATION, filtros y mínimo.
    const pure = discountOf(
      [card('a', price)],
      rule({ kind: 'free_shipping', minSubtotalCents: MIN, destinations: ['direct_ship'], productScopes: ['sealed'] }),
      'vault',
    );
    expect(pure).toEqual({ ok: false, reason: 'NO_SHIPPING', details: {} });
  });

  it('(c) mínimo 500000, invitado, cartas 450000 ⇒ ALREADY_FREE_SHIPPING (gana al mínimo)', () => {
    const [min, S] = grab(/\(c\) mínimo (\d+), invitado, cartas (\d+) ⇒ `ALREADY_FREE_SHIPPING`/);
    const code = envio({ minSubtotalCents: min });
    const { dsc } = mockDiscountedDirectShip([card('a', S)], S, 'cards_only', code, null);
    expect(dsc.dto).toEqual({ outcome: 'not_applicable', code, reason: 'ALREADY_FREE_SHIPPING', details: {} });
  });

  it('(d) invitado, sellado 100000 + accesorio 20000 en caja de 35000 ⇒ LARGE_BOX (gana al mínimo)', () => {
    const [sealedP, accP, box] = grab(/\(d\) invitado, sellado (\d+) \+ accesorio (\d+) en caja de (\d+) ⇒ `LARGE_BOX`/);
    const code = envio();
    const lines: DiscountLine[] = [
      { id: 'inv-s', kind: 'item', scope: 'sealed', priceCents: sealedP, quantity: 1 },
      { id: 'acc-1', kind: 'accessory', scope: 'accessory', priceCents: accP, quantity: 1 },
    ];
    const { dsc, ship } = mockDiscountedDirectShip(lines, sealedP + accP, 'sealed', code, null, { customerFeeCents: box });
    expect(dsc.dto).toEqual({ outcome: 'not_applicable', code, reason: 'LARGE_BOX', details: {} });
    expect(ship.feeCents).toBe(box);
  });

  it('(e) cartas 250000 ⇒ MIN_SUBTOTAL { missingCents: 50000 }; con 300000 ⇒ applied y `shippingWaivedCents = 10000`', () => {
    const [S1, missing, S2, waived] = grab(
      /\(e\) cartas (\d+) ⇒ `MIN_SUBTOTAL \{ missingCents: (\d+) \}` .{0,30} con (\d+) ⇒ `applied`, `shippingWaivedCents = (\d+)`/,
    );
    const code = envio();
    expect(mockDiscountedDirectShip([card('a', S1)], S1, 'cards_only', code, null).dsc.dto).toEqual({
      outcome: 'not_applicable',
      code,
      reason: 'MIN_SUBTOTAL',
      details: { missingCents: missing },
    });
    expect(mockDiscountedDirectShip([card('a', S2)], S2, 'cards_only', code, null).dsc.dto).toMatchObject({ outcome: 'applied', shippingWaivedCents: waived });
  });

  it('(f) 10 % con `destinations = [direct_ship]` y mínimo 300000 en bóveda 100000 ⇒ DESTINATION (sin `destinations` en details)', () => {
    const [pct, min, price] = grab(/\(f\) (\d+) % con `destinations = \[direct_ship\]` y mínimo (\d+) en bóveda (\d+) ⇒ `DESTINATION`/);
    const code = mockCreateCode({ code: 'B20CASA', kind: 'percent', percentPct: pct, minSubtotalCents: min, destinations: ['direct_ship'] }).code;
    expect(evaluateMockDiscount(code, vaultCtx(price)).dto).toEqual({ outcome: 'not_applicable', code, reason: 'DESTINATION', details: {} });
  });

  it('NO_ELIGIBLE_ITEMS gana al mínimo y trae solo `productScopes`', () => {
    const code = mockCreateCode({ code: 'B20SELL', kind: 'percent', percentPct: 10, minSubtotalCents: 900000, productScopes: ['sealed'] }).code;
    const { dsc } = mockDiscountedDirectShip([card('a', 1000)], 1000, 'cards_only', code, null);
    expect(dsc.dto).toEqual({ outcome: 'not_applicable', code, reason: 'NO_ELIGIBLE_ITEMS', details: { productScopes: ['sealed'] } });
  });
});

describe('DCO-B21 v1.110.3 — `capped` = SOLO el tope en pesos (`discountOf` y `preview`)', () => {
  it('los cinco casos del contrato: `discountOf` y `mockPreview` dan lo mismo', () => {
    const [pct, cap, base, D, nom] = grab(/DCO-B21\*\* .{0,60}`capped`: (\d+) % tope (\d+) sobre (\d+) ⇒ `\{ (\d+), (\d+), true \}`/);
    const [cap2] = grab(/tope (\d+) ⇒ `false` \(igual al tope\)/);
    const [fixed, piece, fD, fN] = grab(/fijo (\d+) sobre una pieza de (\d+) ⇒ `\{ (\d+), (\d+), false \}` \(I-4\)/);
    type Want = { discountCents: number; nominalCents: number; capped: boolean };
    const cases: { r: Partial<DiscountRule>; base: number; want: Want }[] = [
      { r: { percentPct: pct, maxDiscountCents: cap }, base, want: { discountCents: D, nominalCents: nom, capped: true } },
      { r: { percentPct: pct, maxDiscountCents: cap2 }, base, want: { discountCents: cap2, nominalCents: cap2, capped: false } },
      { r: { percentPct: 10 }, base, want: { discountCents: base / 10, nominalCents: base / 10, capped: false } },
      { r: { kind: 'fixed_amount', amountCents: fixed }, base: piece, want: { discountCents: fD, nominalCents: fN, capped: false } },
      { r: { percentPct: 100 }, base, want: { discountCents: base - 1, nominalCents: base - 1, capped: false } },
    ];
    for (const c of cases) {
      const r = discountOf([card('a', c.base)], rule(c.r), 'direct_ship');
      expect(r.ok && { discountCents: r.discountCents, nominalCents: r.nominalCents, capped: r.capped }).toEqual(c.want);
      const full = rule(c.r);
      expect(
        mockPreview({
          kind: full.kind,
          ...(full.percentPct != null ? { percentPct: full.percentPct } : {}),
          ...(full.amountCents != null ? { amountCents: full.amountCents } : {}),
          ...(full.maxDiscountCents != null ? { maxDiscountCents: full.maxDiscountCents } : {}),
          sampleLines: [{ scope: 'raw', priceCents: c.base, quantity: 1 }],
        }),
      ).toEqual(c.want);
    }
  });
});

describe('§DSC.6 v1.110.3 — proyección de línea: el «antes del descuento» lo da el servidor (el mock también)', () => {
  it('accesorio 2 × 15000 con 10 % ⇒ `lineTotalBeforeDiscountCents` 30000; sin rebaja, los campos se omiten (I-1)', () => {
    const [q, p, pct, lineBefore] = grab(/accesorio (\d+) × (\d+) con (\d+) % ⇒ `lineTotalBeforeDiscountCents` (\d+)/);
    const acc: DiscountLine = { id: 'acc-x', kind: 'accessory', scope: 'accessory', priceCents: p, quantity: q };
    const r = discountOf([acc], rule({ percentPct: pct }), 'direct_ship');
    const u = r.ok ? (r.unitDiscounts.get('acc-x') ?? 0) : 0;
    expect(u).toBeGreaterThan(0);
    const base = { accessoryId: 'acc-x', unitPriceCents: p, quantity: q, lineTotalCents: p * q };
    expect(mockProjectAccessoryLine(base, u)).toEqual({
      ...base,
      unitPriceCents: p - u,
      unitDiscountCents: u,
      unitPriceBeforeDiscountCents: p,
      lineTotalCents: q * (p - u),
      lineTotalBeforeDiscountCents: lineBefore,
    });
    expect(mockProjectAccessoryLine(base, 0)).toEqual(base);
  });

  it('quote con código: cada línea con rebaja trae `unitPriceBeforeDiscountCents` = cobrado + rebaja; Σ = `merchandiseBeforeDiscountCents`', async () => {
    const q = await getGuestCheckoutQuote(['inv-1001', 'inv-1003'], undefined, undefined, undefined, 'SEPT10');
    expect(q.discount?.outcome).toBe('applied');
    if (q.discount?.outcome !== 'applied') return;
    for (const it of q.items) {
      if ((it.unitDiscountCents ?? 0) > 0) expect(it.unitPriceBeforeDiscountCents).toBe(it.unitPriceCents + it.unitDiscountCents!);
      else expect(it).not.toHaveProperty('unitPriceBeforeDiscountCents');
    }
    expect(q.items.reduce((s, it) => s + (it.unitPriceBeforeDiscountCents ?? it.unitPriceCents), 0)).toBe(q.discount.merchandiseBeforeDiscountCents);
  });
});
