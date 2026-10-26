// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  allocateDiscount,
  discountOf,
  mockArchiveCode,
  mockAudit,
  mockAuditExport,
  mockCodeReport,
  mockCreateBatch,
  mockCreateCode,
  mockGetBatch,
  mockGetCode,
  mockListCodes,
  mockPatchCode,
  mockPreview,
  mockSetBatchStatus,
  mockSetCodeStatus,
  reserveMockDiscount,
  resetMockDiscounts,
  type DiscountLine,
  type DiscountRule,
} from './discounts';
import * as fx from './fixtures';
import { DIRECT_SHIP_DEFAULT_DIALS } from './shipping-rule';
import { getCheckoutQuote, getGuestCheckoutQuote, mockDiscountedDirectShip, mockWithdrawalDiscount } from '@/lib/api';
import { DISCOUNT_AUDIT_ACTIONS } from '@/types/contract';
import es from '../../../messages/es.json';
import en from '../../../messages/en.json';

/** La bitácora del código recién creado (archivado incluido: `mockAudit` lo rechaza si ya no existe). */
const mockAuditOf = (id: string) => mockAudit('DiscountCode', id);

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

/** `PROJECT.md` con los saltos de línea aplanados (el criterio 893 cruza renglones). */
const PROJECT_FLAT = PROJECT.replace(/\s+/g, ' ');

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
    // La lista de reglas entre paréntesis cambia con el PO (`DSC.2-1/3` ⇒ `DSC.2-1/3/7`, e5c793e2): se lee cualquiera.
    const [codePesos, basePesos, merchPesos] = grab(
      /893\. 💰 \*\*Monto fijo con IVA\*\* \*\(DSC\.2-[\d/]+\)\*: un código de MX\$([\d,]+\.\d{2}) sobre MX\$([\d,]+\.\d{2}) ⇒ mercancía de MX\$([\d,]+\.\d{2})/,
      PROJECT_FLAT,
    );
    expect(pesos(codePesos)).toBe(amount);
    expect(pesos(merchPesos)).toBe(merch);
    const r = discountOf([card('a', pesos(basePesos))], rule({ kind: 'fixed_amount', amountCents: amount }), 'direct_ship');
    expect(r.ok && pesos(basePesos) - r.discountCents).toBe(merch);
  });

  it('893 (PROJECT vigente): una carta de MX$100.00 ⇒ MX$99.99 y se cobra MX$0.01; tres energías de MX$10.00 con MX$10.00 fijo ⇒ MX$9.99', () => {
    const [cardPesos, D1, charged] = grab(
      /una sola carta elegible de MX\$([\d,]+\.\d{2}) ⇒ descuento de \*\*MX\$([\d,]+\.\d{2})\*\* y la carta se cobra en \*\*MX\$([\d,]+\.\d{2})\*\*/,
      PROJECT_FLAT,
    );
    const [amount] = grab(/893 \((\d+) fijo ⇒/);
    const one = discountOf([card('a', pesos(cardPesos))], rule({ kind: 'fixed_amount', amountCents: amount }), 'direct_ship');
    expect(one.ok && one.discountCents).toBe(pesos(D1));
    expect(one.ok && pesos(cardPesos) - one.discountCents).toBe(pesos(charged));
    // «tres» va en letra en PROJECT: la regex lo exige literal y la cantidad es 3.
    const [eachPesos, fixedPesos, D3, unitPesos] = grab(
      /Con tres energías sueltas iguales de MX\$([\d,]+\.\d{2}) y un código de MX\$([\d,]+\.\d{2}) fijo ⇒ descuento de \*\*MX\$([\d,]+\.\d{2})\*\* \(cada unidad −MX\$([\d,]+\.\d{2})\)/,
      PROJECT_FLAT,
    );
    const energies: DiscountLine = { id: 'acc-energy', kind: 'accessory', scope: 'accessory', priceCents: pesos(eachPesos), quantity: 3 };
    const three = discountOf([energies], rule({ kind: 'fixed_amount', amountCents: pesos(fixedPesos) }), 'direct_ship');
    expect(three.ok && three.discountCents).toBe(pesos(D3));
    expect(three.ok && three.unitDiscounts.get('acc-energy')).toBe(pesos(unitPesos));
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

// ---------------------------------------------------------------------------------------------------------------
// v1.110.1 — envío gratis con el dial en 0, orden de los motivos, retiro aplicado, y las formas nuevas de §DSC.7.
// ---------------------------------------------------------------------------------------------------------------

/** §DSC sin aplanar: los `//` del bloque `ts` terminan en el salto de línea. */
const DSC_RAW = (() => {
  const start = CONTRACT.indexOf('## <a id="DSC"></a>DSC.');
  const end = CONTRACT.indexOf('\n## ', start + 10);
  return CONTRACT.slice(start, end === -1 ? undefined : end);
})();

/** Claves de primer nivel (y las anidadas en `{ … }`, como `padre.hijo`) de un literal `Nombre = { … }` del contrato. */
function contractKeys(name: string, src = DSC_RAW): string[] {
  const at = src.indexOf(`${name} = {`);
  expect(at, `el contrato ya no define ${name}`).toBeGreaterThan(-1);
  let depth = 0;
  let body = '';
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    if (ch === '}') depth--;
    body += ch;
    if (depth === 0) break;
  }
  const clean = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').replace(/'[^']*'/g, "''");
  return objectKeys(clean.slice(1, -1), '');
}
function objectKeys(inner: string, prefix: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of inner) {
    if ('{[(<'.includes(ch)) depth++;
    if ('}])>'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  parts.push(cur);
  const keys: string[] = [];
  for (const raw of parts) {
    const m = /^([A-Za-z_]\w*)\??\s*(?::\s*([\s\S]*))?$/.exec(raw.trim());
    if (!m) continue;
    keys.push(prefix + m[1]);
    const nested = m[2]?.trim();
    if (nested?.startsWith('{')) keys.push(...objectKeys(nested.slice(1, nested.lastIndexOf('}')), `${prefix}${m[1]}.`));
  }
  return keys;
}
/** Claves de un DTO del mock con la misma convención (`padre.hijo` para objetos, no para arreglos). */
function dtoKeys(o: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === 'object' && !Array.isArray(v) ? [prefix + k, ...dtoKeys(v as Record<string, unknown>, `${prefix}${k}.`)] : [prefix + k],
  );
}

describe('§DSC.4 v1.110.1 — envío gratis: `E` sin código ya en 0 (umbral O dial) ⇒ ALREADY_FREE_SHIPPING; orden de motivos', () => {
  it('el contrato dice el dial y el orden NO_SHIPPING → LARGE_BOX → ALREADY_FREE_SHIPPING', () => {
    expect(DSC).toMatch(/`E` sin código ya es 0 \(`S ≥ T` \*\*o dial de la clase en 0\*\*, v1\.110\.1\) ⇒ `ALREADY_FREE_SHIPPING`/);
    const from = DSC.indexOf('Envío gratis (tipo c) no aplica');
    const order = ['bóveda ⇒ `NO_SHIPPING`', 'caja grande ⇒ `LARGE_BOX`', '⇒ `ALREADY_FREE_SHIPPING`'].map((x) => DSC.indexOf(x, from));
    expect(order.every((i) => i > from)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('dial de cartas en 0 bajo el umbral ⇒ ALREADY_FREE_SHIPPING (nunca `applied` con `shippingWaivedCents = 0`); con caja grande gana LARGE_BOX', () => {
    mockCreateCode({ code: 'PARIDADENVIO', kind: 'free_shipping' });
    const saved = { cards: fx.mockSettings.directShipCardsFeeCents, sealed: fx.mockSettings.directShipSealedFeeCents };
    try {
      fx.mockSettings.directShipCardsFeeCents = 0;
      const S = 100000;
      expect(S).toBeLessThan(DIRECT_SHIP_DEFAULT_DIALS.freeFromCents);
      const zero = mockDiscountedDirectShip([card('a', S)], S, 'cards_only', 'PARIDADENVIO', null);
      expect(zero.dsc.dto).toMatchObject({ outcome: 'not_applicable', reason: 'ALREADY_FREE_SHIPPING' });
      expect(zero.ship.feeCents).toBe(0);
      fx.mockSettings.directShipSealedFeeCents = 0;
      const big = mockDiscountedDirectShip([card('a', S)], S, 'sealed', 'PARIDADENVIO', null, { customerFeeCents: 50000 });
      expect(big.dsc.dto).toMatchObject({ outcome: 'not_applicable', reason: 'LARGE_BOX' });
    } finally {
      fx.mockSettings.directShipCardsFeeCents = saved.cards;
      fx.mockSettings.directShipSealedFeeCents = saved.sealed;
    }
  });
});

describe('§DSC.8 v1.110.1 — retiro con envío gratis: `discount` aplicado con mercancía 0', () => {
  it('`merchandiseBeforeDiscountCents = 0`, `discountCents = 0`, `shippingWaivedCents = E`; con `E = 0` ⇒ ALREADY_FREE_SHIPPING', () => {
    expect(DSC).toMatch(/`discount\.merchandiseBeforeDiscountCents = 0` y `discountCents = 0` .{0,80}\) y `shippingWaivedCents = E`/);
    const r = mockWithdrawalDiscount('ENVIO25', 17500)!;
    expect(r.dto).toMatchObject({ outcome: 'applied', merchandiseBeforeDiscountCents: 0, discountCents: 0 });
    expect(r.dto.outcome === 'applied' && r.dto.shippingWaivedCents).toBeGreaterThan(0);
    expect(mockWithdrawalDiscount('ENVIO25', 0)!.dto).toMatchObject({ outcome: 'not_applicable', reason: 'ALREADY_FREE_SHIPPING' });
  });
});

describe('§DSC.7 v1.110.1 — formas del panel: el mock trae EXACTAMENTE las claves del contrato', () => {
  it('DiscountCodeDTO (con `usage.discountGivenCents` = el `discountGivenCents` del reporte sin from/to)', () => {
    const dto = mockGetCode('dsc-sept10');
    expect(dtoKeys(dto as unknown as Record<string, unknown>).sort()).toEqual(contractKeys('DiscountCodeDTO').sort());
    expect(dto.usage.discountGivenCents).toBeGreaterThan(0);
    expect(dto.usage.discountGivenCents).toBe(mockCodeReport('dsc-sept10').discountGivenCents);
  });

  it('DiscountCodeBatchDTO (ratificado, con `createdBy`); `paused` ⇔ ningún sin usar active; `exhausted` ⇔ todos consumed', () => {
    const { batch } = mockCreateBatch({ prefix: 'PAR', quantity: 2, kind: 'percent', percentPct: 10 });
    expect(dtoKeys(batch as unknown as Record<string, unknown>).sort()).toEqual(contractKeys('DiscountCodeBatchDTO').sort());
    expect(DSC).toMatch(/status \/\* paused ⇔ ningún código sin usar \(sin reserved ni consumed\) está active;/);
    expect(DSC).toMatch(/exhausted ⇔ todos consumed/);
    const codes = mockListCodes({ batchId: batch.id });
    const use = (codeId: string, folio: string) =>
      reserveMockDiscount({ codeId, customer: `${folio}@x`, kind: 'order', folio, discountCents: 100, shippingWaivedCents: 0, totalCents: 900, consumed: true });
    // Uno consumido y el otro (sin usar) pausado ⇒ paused.
    use(codes[0].id, 'F1');
    mockSetCodeStatus(codes[1].id, 'paused');
    expect(mockGetBatch(batch.id)).toMatchObject({ status: 'paused', state: 'paused', usedCodes: 1, locked: true });
    // Todos consumidos ⇒ exhausted.
    mockSetCodeStatus(codes[1].id, 'active');
    use(codes[1].id, 'F2');
    expect(mockGetBatch(batch.id)).toMatchObject({ state: 'exhausted', usedCodes: 2 });
  });

  it('v1.110.2: lote sin códigos sin usar ⇒ `paused` solo si TODOS están pausados (agotado y no pausado = active + exhausted)', () => {
    expect(DSC).toMatch(/si no queda ninguno sin usar, paused ⇔ todos paused \(v1\.110\.2\)/);
    expect(DSC).toMatch(/lote agotado y no pausado = active \+ exhausted/);
    const { batch } = mockCreateBatch({ prefix: 'AGO', quantity: 2, kind: 'percent', percentPct: 10 });
    const codes = mockListCodes({ batchId: batch.id });
    for (const [i, c] of codes.entries()) {
      reserveMockDiscount({ codeId: c.id, customer: `ago${i}@x`, kind: 'order', folio: `AG${i}`, discountCents: 100, shippingWaivedCents: 0, totalCents: 900, consumed: true });
    }
    expect(mockGetBatch(batch.id)).toMatchObject({ status: 'active', state: 'exhausted', usedCodes: 2 });
    // Pausar el lote pausa los N (911, `updateMany` del backend) ⇒ todos pausados ⇒ paused.
    expect(mockSetBatchStatus(batch.id, 'paused')).toMatchObject({ status: 'paused', state: 'paused' });
    // Uno pausado y otro activo, ambos usados ⇒ no TODOS pausados ⇒ active.
    mockSetCodeStatus(codes[0].id, 'active');
    expect(mockGetBatch(batch.id)).toMatchObject({ status: 'active', state: 'exhausted' });
  });

  it('preview: `200 { discountCents, nominalCents, capped }` por `discountOf` (el front no calcula)', () => {
    expect(DSC).toMatch(/`200 \{ discountCents, nominalCents, capped: boolean \}` por `discountOf`\/`allocateDiscount`/);
    const sampleLines = [{ scope: 'raw' as const, priceCents: 400000, quantity: 1 }];
    const capped = mockPreview({ kind: 'percent', percentPct: 20, maxDiscountCents: 30000, sampleLines });
    expect(Object.keys(capped).sort()).toEqual(['capped', 'discountCents', 'nominalCents']);
    expect(capped).toEqual({ discountCents: 30000, nominalCents: 30000, capped: true });
    expect(mockPreview({ kind: 'percent', percentPct: 10, sampleLines })).toEqual({ discountCents: 40000, nominalCents: 40000, capped: false });
    expect(() => mockPreview({ kind: 'percent', percentPct: 10, sampleLines: [] })).toThrow();
  });

  it('preview v1.110.2: muestra a la que no aplica ⇒ `{ 0, 0, false }`; `free_shipping` ⇒ siempre `{ 0, 0, false }`', () => {
    expect(DSC).toMatch(/\(`DESTINATION`, `NO_ELIGIBLE_ITEMS`, `MIN_SUBTOTAL`\) ⇒ `\{ 0, 0, false \}`, sin `reason`; `free_shipping` ⇒ siempre `\{ 0, 0, false \}`/);
    const zero = { discountCents: 0, nominalCents: 0, capped: false };
    const sampleLines = [{ scope: 'raw' as const, priceCents: 400000, quantity: 1 }];
    expect(mockPreview({ kind: 'percent', percentPct: 10, minSubtotalCents: 500000, sampleLines })).toEqual(zero); // MIN_SUBTOTAL
    expect(mockPreview({ kind: 'percent', percentPct: 10, productScopes: ['sealed'], sampleLines })).toEqual(zero); // NO_ELIGIBLE_ITEMS
    expect(mockPreview({ kind: 'free_shipping', sampleLines })).toEqual(zero);
  });

  it('audit v1.110.2: `action` es la lista CERRADA del contrato, cada una con su texto ES/EN; `actor` puede ser null', () => {
    const m = /\*\*`action` \(v1\.110\.2, lista cerrada[^)]*\):\*\* código `discount\.code\.\{([^}]+)\}`; lote `discount\.batch\.\{([^}]+)\}`/.exec(DSC);
    expect(m, 'el contrato ya no enumera `action` como en v1.110.2').not.toBeNull();
    const fromContract = [
      ...m![1].split(',').map((x) => `discount.code.${x.trim()}`),
      ...m![2].split(',').map((x) => `discount.batch.${x.trim()}`),
    ];
    expect([...DISCOUNT_AUDIT_ACTIONS].sort()).toEqual(fromContract.sort());
    for (const msgs of [es, en]) {
      const labels = (msgs as unknown as { admin: { discounts: { audit: { action: Record<string, Record<string, string> | string> } } } }).admin.discounts.audit.action;
      for (const a of DISCOUNT_AUDIT_ACTIONS) {
        const [, entity, verb] = a.split('.');
        expect(typeof (labels[entity] as Record<string, string>)?.[verb], `${a} sin texto`).toBe('string');
      }
      expect(typeof labels.unknown).toBe('string');
    }
    // El mock solo escribe acciones de la lista.
    const c = mockCreateCode({ code: 'AUDITA2', kind: 'percent', percentPct: 10 });
    mockPatchCode(c.id, { percentPct: 15 });
    mockSetCodeStatus(c.id, 'paused');
    mockSetCodeStatus(c.id, 'active');
    mockArchiveCode(c.id);
    const { batch } = mockCreateBatch({ prefix: 'AUD', quantity: 1, kind: 'percent', percentPct: 10 });
    mockSetBatchStatus(batch.id, 'paused');
    mockSetBatchStatus(batch.id, 'active');
    mockAuditExport('DiscountCodeBatch', batch.id, 'discount.batch.codes_exported', 1);
    const written = [...mockAudit('DiscountCode', 'dsc-sept10'), ...mockAuditOf(c.id), ...mockAudit('DiscountCodeBatch', batch.id)].map((r) => r.action);
    for (const a of written) expect(DISCOUNT_AUDIT_ACTIONS as readonly string[]).toContain(a);
    expect(new Set(written)).toEqual(
      new Set([
        'discount.code.created',
        'discount.code.updated',
        'discount.code.paused',
        'discount.code.resumed',
        'discount.code.archived',
        'discount.batch.created',
        'discount.batch.paused',
        'discount.batch.resumed',
        'discount.batch.codes_exported',
      ]),
    );
    expect(DSC).toMatch(/actor: \{ id, name \} \\\| null/);
  });

  it('audit: `{ at, actor: { id, name } | null, action, changes: [{ field, before, after }] }` con antes → después', () => {
    expect(DSC).toMatch(/\{ data: \[\{ at, actor: \{ id, name \} \\\| null, action, changes: \[\{ field, before, after \}\] \}\], page, pageSize, total \}/);
    const c = mockCreateCode({ code: 'AUDITA1', kind: 'percent', percentPct: 10 });
    mockPatchCode(c.id, { percentPct: 15 });
    mockSetCodeStatus(c.id, 'paused');
    mockSetCodeStatus(c.id, 'paused'); // idempotente: sin fila
    const rows = mockAudit('DiscountCode', c.id);
    expect(rows).toHaveLength(3);
    for (const r of rows) expect(Object.keys(r).sort()).toEqual(['action', 'actor', 'at', 'changes']);
    expect(rows.map((r) => r.changes)).toContainEqual([{ field: 'percentPct', before: 10, after: 15 }]);
    expect(rows.map((r) => r.changes)).toContainEqual([{ field: 'status', before: 'active', after: 'paused' }]);
  });
});
