// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { allocateDiscount, discountOf, mockCreateCode, resetMockDiscounts, type DiscountLine, type DiscountRule } from './discounts';
import { DIRECT_SHIP_DEFAULT_DIALS } from './shipping-rule';
import { getCheckoutQuote, getGuestCheckoutQuote, mockDiscountedDirectShip } from '@/lib/api';

/**
 * DCO-F5 (API_CONTRACT §DSC.10): «el mock de `lib/api.ts` replica `DiscountQuoteDTO` y la omisión sin código».
 *
 * ⚠️ Medido al escribir esto (2026-10-25, contrato v1.110): los casos DCO-F1…F5 NO traen cifras (son de pantalla);
 * las cifras normativas viven en el ejemplo de §DSC.3, en DCO-B2 (891/893/894/904/919), en el punto de §DSC.4 sobre el
 * umbral (895) y en DCO-B4 (896, caja grande). Esta prueba LEE esas cifras del contrato (y la base del 893 de
 * `PROJECT.md`, que el contrato no repite) y las pasa por el simulador; si el arquitecto cambia un número, la prueba
 * cambia con él o se pone roja. Igual que `shipping-rule.parity.test.ts`.
 */

const ROOT = join(__dirname, '..', '..', '..', '..');
const CONTRACT = readFileSync(join(ROOT, 'docs', 'API_CONTRACT.md'), 'utf8');
const PROJECT = readFileSync(join(ROOT, 'PROJECT.md'), 'utf8');
/** §DSC entera, con los saltos de línea aplanados (las cifras cruzan renglones). */
const DSC = (() => {
  const start = CONTRACT.indexOf('## <a id="DSC"></a>DSC.');
  expect(start).toBeGreaterThan(-1);
  const end = CONTRACT.indexOf('\n## ', start + 10);
  return CONTRACT.slice(start, end === -1 ? undefined : end).replace(/\s+/g, ' ');
})();

function grab(re: RegExp, src = DSC): number[] {
  const m = re.exec(src);
  expect(m, `el contrato ya no dice ${re}`).not.toBeNull();
  return m!.slice(1).map((x) => Number(x.replace(/[,]/g, '')));
}
const pesos = (s: number) => Math.round(s * 100);

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

describe('§DSC.3 — reparto por unidad: los ejemplos del contrato', () => {
  it('33333 + 33333 + 33334 con monto fijo ⇒ el reparto exacto que dice el contrato', () => {
    const [p1, p2, p3, amount, u1, u2, u3, D] = grab(
      /(\d+) \+ (\d+) \+ (\d+) con MX\$([\d.]+) fijo ⇒ (\d+) \+ (\d+) \+ (\d+) = (\d+)/,
    );
    const r = discountOf([card('a', p1), card('b', p2), card('c', p3)], rule({ kind: 'fixed_amount', amountCents: pesos(amount) }), 'direct_ship');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect([r.unitDiscounts.get('a'), r.unitDiscounts.get('b'), r.unitDiscounts.get('c')]).toEqual([u1, u2, u3]);
    expect(r.discountCents).toBe(D);
  });

  it('100000 + 50000 con 10 % ⇒ cobrados 90000 y 45000 (902)', () => {
    const [p1, p2, pct, c1, c2] = grab(/(\d+) \+ (\d+) con (\d+) % ⇒ cobrados (\d+) y (\d+) \(902\)/);
    const r = discountOf([card('a', p1), card('b', p2)], rule({ percentPct: pct }), 'vault');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect([p1 - (r.unitDiscounts.get('a') ?? 0), p2 - (r.unitDiscounts.get('b') ?? 0)]).toEqual([c1, c2]);
  });

  it('3 energías de 1000 con MX$10.00 fijo ⇒ u = 333 y D = 999 (el residuo no cabe en q = 3)', () => {
    const [q, p, amount, u, D] = grab(/(\d+) energías de (\d+) con MX\$([\d.]+) fijo ⇒ u = (\d+), `D = (\d+)`/);
    const line: DiscountLine = { id: 'acc-energia', kind: 'accessory', scope: 'accessory', priceCents: p, quantity: q };
    const r = discountOf([line], rule({ kind: 'fixed_amount', amountCents: pesos(amount) }), 'direct_ship');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.unitDiscounts.get('acc-energia')).toBe(u);
    expect(r.discountCents).toBe(D);
  });

  it('DCO-B1: Σ q·u = D, toda unidad ≥ 1 centavo, y P = 2·10⁹ al 100 % sin pérdida (BigInt)', () => {
    expect(DSC).toContain('`P = 2·10⁹` con 100 %');
    const primes = [7919, 104729, 1299709, 15485863, 179424673, 2147483647, 13];
    for (const n of [1, 2, 3, 7]) {
      const lines = primes.slice(0, n).map((p, i) => ({ priceCents: p, quantity: (i % 3) + 1 }));
      const B = lines.reduce((s, l) => s + l.priceCents * l.quantity, 0);
      const U = lines.reduce((s, l) => s + l.quantity, 0);
      for (const d0 of [1, 999, Math.floor(B / 3), B - U]) {
        const { unit, discountCents } = allocateDiscount(lines, d0);
        expect(unit.reduce((s, u, i) => s + u * lines[i].quantity, 0)).toBe(discountCents);
        expect(discountCents).toBeLessThanOrEqual(d0);
        unit.forEach((u, i) => expect(lines[i].priceCents - u).toBeGreaterThanOrEqual(1));
      }
    }
    const big = discountOf([card('x', 2_000_000_000)], rule({ percentPct: 100 }), 'vault');
    expect(big.ok && big.unitDiscounts.get('x')).toBe(1_999_999_999);
  });
});

describe('DCO-B2 — nominal, tope, mínimo inclusivo y paquete fuera (cifras del contrato)', () => {
  it('891: 10 % de 100000 ⇒ 10000', () => {
    const [pct, base, D] = grab(/891 \((\d+) % de (\d+) ⇒ (\d+)\)/);
    const r = discountOf([card('a', base)], rule({ percentPct: pct }), 'direct_ship');
    expect(r.ok && r.discountCents).toBe(D);
  });

  it('893: monto fijo ⇒ mercancía que dice el contrato (base del criterio 893 en PROJECT.md)', () => {
    const [amount, merch] = grab(/893 \((\d+) fijo ⇒ (\d+) de mercancía\)/);
    const [codePesos, basePesos] = grab(/893\. 💰 \*\*Monto fijo con IVA\*\* \*\(DSC\.2-1\/3\)\*: un código de MX\$([\d,.]+) sobre MX\$([\d,.]+)/, PROJECT);
    expect(pesos(codePesos)).toBe(amount);
    const r = discountOf([card('a', pesos(basePesos))], rule({ kind: 'fixed_amount', amountCents: amount }), 'direct_ship');
    expect(r.ok && pesos(basePesos) - r.discountCents).toBe(merch);
  });

  it('894: 20 % con tope ⇒ el tope', () => {
    const [pct, cap, base, D] = grab(/894 \((\d+) % tope (\d+) sobre (\d+) ⇒ (\d+)\)/);
    const r = discountOf([card('a', base)], rule({ percentPct: pct, maxDiscountCents: cap }), 'direct_ship');
    expect(r.ok && r.discountCents).toBe(D);
  });

  it('904: mínimo ANTES del descuento e inclusivo; uno menos ⇒ MIN_SUBTOTAL con lo que falta', () => {
    const [min, atMin, below, missing] = grab(/904 \(mínimo (\d+): B = (\d+) aplica, (\d+) ⇒ `MIN_SUBTOTAL` con `missingCents: (\d+)`\)/);
    const code = rule({ percentPct: 10, minSubtotalCents: min });
    expect(discountOf([card('a', atMin)], code, 'direct_ship').ok).toBe(true);
    const r = discountOf([card('a', below)], code, 'direct_ship');
    expect(r).toMatchObject({ ok: false, reason: 'MIN_SUBTOTAL', details: { minSubtotalCents: min, missingCents: missing } });
  });

  it('919: el paquete de energías queda fuera; solo `accessory` con el paquete como único accesorio ⇒ NO_ELIGIBLE_ITEMS', () => {
    const [cards, bundle, pct, D, bundleAfter] = grab(/919 \((\d+) de cartas \+ paquete (\d+) con (\d+) % ⇒ `D = (\d+)`, paquete (\d+);/);
    const lines: DiscountLine[] = [card('a', cards), { id: 'deck-x', kind: 'energy_bundle', scope: null, priceCents: bundle, quantity: 1 }];
    const r = discountOf(lines, rule({ percentPct: pct }), 'direct_ship');
    expect(r.ok && r.discountCents).toBe(D);
    expect(r.ok && bundle - (r.unitDiscounts.get('deck-x') ?? 0)).toBe(bundleAfter);
    expect(DSC).toMatch(/solo `accessory` con el paquete como único accesorio ⇒ `NO_ELIGIBLE_ITEMS`/);
    expect(discountOf(lines, rule({ percentPct: pct, productScopes: ['accessory'] }), 'direct_ship')).toMatchObject({
      ok: false,
      reason: 'NO_ELIGIBLE_ITEMS',
    });
  });
});

describe('§DSC.4 / DCO-B4 — el umbral se mide DESPUÉS del descuento; envío gratis y caja grande', () => {
  const D = DIRECT_SHIP_DEFAULT_DIALS;

  it('895: los dos pedidos del contrato (10 %): uno baja del umbral y paga envío, el otro no', () => {
    const [s1, sp1, e1, s2, sp2, e2] = grab(/(\d+) ⇒ (\d+) ⇒ `E = (\d+)`; (\d+) ⇒ (\d+) ⇒ `E = (\d+)`/);
    mockCreateCode({ code: 'PARIDAD10', kind: 'percent', percentPct: 10 });
    for (const [S, Sp, E] of [
      [s1, sp1, e1],
      [s2, sp2, e2],
    ]) {
      const { ship, dsc } = mockDiscountedDirectShip([card('a', S)], S, 'cards_only', 'PARIDAD10', null);
      expect(dsc.dto).toMatchObject({ outcome: 'applied', merchandiseBeforeDiscountCents: S, discountCents: S - Sp });
      expect(ship.feeCents).toBe(E);
      // T9 se mide contra S' (§DSC.4): «te faltan» = T − S'.
      expect(ship.rule.freeShippingRemainingCents).toBe(Math.max(0, D.freeFromCents - Sp));
    }
  });

  it('DCO-B4: envío gratis en cartas a domicilio ⇒ E = 0 y `shippingWaivedCents` del contrato; caja grande ⇒ LARGE_BOX', () => {
    const [waived] = grab(/envío gratis en cartas a domicilio ⇒ `E = 0`, `shippingWaivedCents = (\d+)`/);
    const [box] = grab(/caja (\d+) ⇒ `LARGE_BOX`/);
    mockCreateCode({ code: 'PARIDADENVIO', kind: 'free_shipping' });
    const S = 100000;
    const ok = mockDiscountedDirectShip([card('a', S)], S, 'cards_only', 'PARIDADENVIO', null);
    expect(ok.ship.feeCents).toBe(0);
    expect(ok.dsc.dto).toMatchObject({ outcome: 'applied', kind: 'free_shipping', discountCents: 0, shippingWaivedCents: waived });
    expect(ok.ship.rule).toMatchObject({ freeShippingApplied: true, freeShippingRemainingCents: null });
    const big = mockDiscountedDirectShip([card('a', S)], S, 'sealed', 'PARIDADENVIO', null, { customerFeeCents: box });
    expect(big.dsc.dto).toMatchObject({ outcome: 'not_applicable', reason: 'LARGE_BOX' });
    expect(big.ship.feeCents).toBe(box);
    const above = mockDiscountedDirectShip([card('a', D.freeFromCents)], D.freeFromCents, 'cards_only', 'PARIDADENVIO', null);
    expect(above.dsc.dto).toMatchObject({ outcome: 'not_applicable', reason: 'ALREADY_FREE_SHIPPING' });
  });

  it('bóveda ⇒ NO_SHIPPING (DCO-B4)', async () => {
    expect(DSC).toMatch(/bóveda ⇒ `NO_SHIPPING`/);
    mockCreateCode({ code: 'PARIDADENVIO', kind: 'free_shipping' });
    const q = await getCheckoutQuote(['inv-1001'], 'PARIDADENVIO');
    expect(q.discount).toMatchObject({ outcome: 'not_applicable', reason: 'NO_SHIPPING' });
  });
});

describe('§DSC.0 I-1 / DCO-F5 — sin código, el JSON del mock es el de hoy (los campos se OMITEN)', () => {
  it('quote de invitado y de cuenta sin código: ni `discount` ni `unitDiscountCents`; con código, presentes', async () => {
    const guest = await getGuestCheckoutQuote(['inv-1001', 'inv-1003']);
    expect('discount' in guest).toBe(false);
    expect(JSON.stringify(guest)).not.toMatch(/unitDiscountCents|"discount"/);
    const vault = await getCheckoutQuote(['inv-1001']);
    expect('discount' in vault).toBe(false);
    expect(JSON.stringify(vault)).not.toMatch(/unitDiscountCents|"discount"/);
    // Un código vacío es «ausente» (§DSC.6): mismo cuerpo.
    expect(await getGuestCheckoutQuote(['inv-1001', 'inv-1003'], undefined, undefined, undefined, '   ')).toEqual(guest);
    const withCode = await getGuestCheckoutQuote(['inv-1001', 'inv-1003'], undefined, undefined, undefined, 'SEPT10');
    expect(withCode.discount?.outcome).toBe('applied');
    expect(withCode.items.some((i) => (i.unitDiscountCents ?? 0) > 0)).toBe(true);
  });

  it('con `applied`, `breakdown` es el de un pedido sin código de mercancía S′ (I-2, la MISMA llamada)', async () => {
    const withCode = await getGuestCheckoutQuote(['inv-1001'], undefined, undefined, undefined, 'SEPT10');
    expect(withCode.discount?.outcome).toBe('applied');
    if (withCode.discount?.outcome !== 'applied') return;
    const Sp = withCode.discount.merchandiseBeforeDiscountCents - withCode.discount.discountCents;
    expect(withCode.breakdown.subtotalCents).toBe(Sp);
    expect(withCode.items.reduce((s, i) => s + i.unitPriceCents, 0)).toBe(Sp);
  });
});
