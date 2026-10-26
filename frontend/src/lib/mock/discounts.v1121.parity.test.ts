// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  MOCK_DISCOUNT_THROTTLE,
  evaluateMockDiscount,
  mockCodeReport,
  mockCreateCode,
  mockGetCode,
  mockPatchCode,
  mockPreview,
  reserveMockDiscount,
  resetMockDiscounts,
  sessionErrorOf,
  type DiscountLine,
} from './discounts';
import { mockDiscountedDirectShip } from '@/lib/api';

/**
 * Contrato v1.112.1 (`bdf5784c`) en el simulador: `ZERO_DISCOUNT` (§DSC.3, I-7, DCO-B22) y el `PATCH` con `null` que limpia
 * con `lockedFields` = los campos cuyo valor CAMBIA (§DSC.7). Las cifras de DCO-B22 se LEEN del contrato.
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

const card = (id: string, priceCents: number): DiscountLine => ({ id, kind: 'item', scope: 'raw', priceCents, quantity: 1 });
const acc = (id: string, priceCents: number, quantity: number): DiscountLine => ({ id, kind: 'accessory', scope: 'accessory', priceCents, quantity });
const okClose = ({ subtotalCents }: { subtotalCents: number }) => ({ ok: true as const, totalCents: subtotalCents, shippingWaivedCents: 0 });

beforeEach(() => resetMockDiscounts());

describe('DCO-B22 v1.112.1 — `%`/monto con `D = 0` ⇒ `not_applicable/ZERO_DISCOUNT {}`, sin uso, contando intento', () => {
  const [pct, cardP, accP] = grab(/DCO-B22\*\* .{0,80}?(\d+) % con `productScopes = \[accessory\]`, invitado directo, carta (\d+) \+ accesorio (\d+) ⇒ `not_applicable\/ZERO_DISCOUNT \{\}`/);
  const [fixed, n, energyP] = grab(/fijo (\d+) sobre (\d+) energías de (\d+) ⇒ ídem/);

  it('1 % sobre accesorio 99 (quote de invitado): ZERO_DISCOUNT, sin uso apartado; la sesión ⇒ 422 NOT_APPLICABLE', () => {
    const c = mockCreateCode({ code: 'B22PCT', kind: 'percent', percentPct: pct, productScopes: ['accessory'] });
    const lines = [card('a', cardP), acc('acc-1', accP, 1)];
    const { dsc, ship } = mockDiscountedDirectShip(lines, cardP + accP, 'sealed', c.code, 'email:x@y.mx');
    expect(dsc.dto).toEqual({ outcome: 'not_applicable', code: c.code, reason: 'ZERO_DISCOUNT', details: {} });
    expect(dsc.applied).toBeNull();
    // El envío es el de hoy sin código (no hay `S'` distinto de `S`).
    expect(ship.feeCents).toBeGreaterThanOrEqual(0);
    expect(sessionErrorOf(dsc.dto as Exclude<typeof dsc.dto, { outcome: 'applied' }>)).toEqual({
      status: 422,
      code: 'DISCOUNT_CODE_NOT_APPLICABLE',
      details: { reason: 'ZERO_DISCOUNT' },
    });
    expect(mockGetCode(c.id).locked).toBe(false);
    expect(mockCodeReport(c.id)).toMatchObject({ consumed: 0, reservedNow: 0 });
  });

  it(`fijo ${fixed} sobre ${n} energías de ${energyP} (D0 = ${fixed}, el residuo no cabe) ⇒ ZERO_DISCOUNT; preview ⇒ { 0, 0, false }`, () => {
    const c = mockCreateCode({ code: 'B22FIJO', kind: 'fixed_amount', amountCents: fixed });
    const r = evaluateMockDiscount(c.code, { destination: 'direct_ship', customer: null, lines: [acc('en', energyP, n)], close: okClose });
    expect(r.dto).toEqual({ outcome: 'not_applicable', code: c.code, reason: 'ZERO_DISCOUNT', details: {} });
    expect(mockPreview({ kind: 'fixed_amount', amountCents: fixed, sampleLines: [{ scope: 'accessory', priceCents: energyP, quantity: n }] })).toEqual({
      discountCents: 0,
      nominalCents: 0,
      capped: false,
    });
    expect(DSC).toMatch(/`ZERO_DISCOUNT` también ⇒ `\{ 0, 0, false \}`/);
  });

  it('cuenta como intento (una vez por código y ventana): 1 ZERO_DISCOUNT + (max − 1) inválidos ⇒ bloqueo', () => {
    const c = mockCreateCode({ code: 'B22CNT', kind: 'fixed_amount', amountCents: fixed });
    const ctx = { destination: 'direct_ship' as const, customer: null, lines: [acc('en', energyP, n)], close: okClose };
    expect(evaluateMockDiscount(c.code, ctx).dto).toMatchObject({ reason: 'ZERO_DISCOUNT' });
    expect(evaluateMockDiscount(c.code, ctx).dto).toMatchObject({ reason: 'ZERO_DISCOUNT' }); // mismo código: no suma otra vez
    for (let i = 0; i < MOCK_DISCOUNT_THROTTLE.maxFailures - 1; i++) evaluateMockDiscount(`NOEXISTE${i}`, ctx);
    expect(evaluateMockDiscount(c.code, ctx).dto.outcome).toBe('rate_limited');
  });

  it('con beneficio > 0 sigue `applied` (la regla no se come el caso normal)', () => {
    const c = mockCreateCode({ code: 'B22OK', kind: 'fixed_amount', amountCents: n });
    const r = evaluateMockDiscount(c.code, { destination: 'direct_ship', customer: null, lines: [acc('en', energyP, n)], close: okClose });
    expect(r.dto).toMatchObject({ outcome: 'applied', discountCents: n });
  });
});

describe('§DSC.7 v1.112.1 — `PATCH` con `null` que limpia y `lockedFields` = lo que CAMBIA', () => {
  const lockedCode = () => {
    const c = mockCreateCode({ code: 'LOCK112', kind: 'percent', percentPct: 10, maxDiscountCents: 5000, maxTotalUses: 5 });
    reserveMockDiscount({ codeId: c.id, customer: 'user:u1', kind: 'order', folio: 'TCG-1', discountCents: 1, shippingWaivedCents: 0, totalCents: 1 });
    return c;
  };

  it('el contrato lo dice así', () => {
    expect(DSC).toMatch(/`lockedFields` = los campos cuyo valor \*\*cambia\*\* \(un `null` que limpia cuenta; uno sobre un campo ya nulo, no\)/);
    expect(DSC).toMatch(/`productScopes`\/`destinations` `null` ≡ `\[\]`; `startsAt: null` ⇒ `422`/);
  });

  it('bloqueado: `null` sobre un campo ya nulo ⇒ 200; el cuerpo completo del formulario sin cambios ⇒ 200', () => {
    const c = lockedCode();
    expect(mockPatchCode(c.id, { minSubtotalCents: null, amountCents: null, productScopes: null }).percentPct).toBe(10);
    expect(mockPatchCode(c.id, { kind: 'percent', percentPct: 10, maxDiscountCents: 5000, productScopes: [], destinations: [] }).maxDiscountCents).toBe(5000);
  });

  it('bloqueado: `lockedFields` lista SOLO los que cambian (un `null` que limpia cuenta)', () => {
    const c = lockedCode();
    expect(() => mockPatchCode(c.id, { percentPct: 10, maxDiscountCents: null, minSubtotalCents: null })).toThrow(
      expect.objectContaining({ status: 409, code: 'DISCOUNT_CODE_LOCKED', details: { lockedFields: ['maxDiscountCents'] } }),
    );
  });

  it('sin bloqueo: `null` limpia los siete; `productScopes`/`destinations` `null` ≡ `[]`; `startsAt: null` ⇒ 422', () => {
    const c = mockCreateCode({
      code: 'LIMPIA1',
      kind: 'percent',
      percentPct: 10,
      maxDiscountCents: 5000,
      minSubtotalCents: 100000,
      productScopes: ['sealed'],
      destinations: ['direct_ship'],
      endsAt: '2030-01-01T06:01:00.000Z',
      maxTotalUses: 9,
      maxUsesPerCustomer: 2,
    });
    const out = mockPatchCode(c.id, {
      maxDiscountCents: null,
      minSubtotalCents: null,
      endsAt: null,
      maxTotalUses: null,
      maxUsesPerCustomer: null,
      productScopes: null,
      destinations: null,
    });
    expect(out).toMatchObject({ maxDiscountCents: null, minSubtotalCents: null, endsAt: null, maxTotalUses: null, maxUsesPerCustomer: null, productScopes: [], destinations: [] });
    // Cambiar `kind` exige `null` en los campos del anterior (config fusionada validada como en el POST).
    expect(() => mockPatchCode(c.id, { kind: 'fixed_amount', amountCents: 1000 })).toThrow(expect.objectContaining({ status: 422, details: { field: 'percentPct' } }));
    expect(mockPatchCode(c.id, { kind: 'fixed_amount', amountCents: 1000, percentPct: null })).toMatchObject({ kind: 'fixed_amount', percentPct: null, amountCents: 1000 });
    expect(() => mockPatchCode(c.id, { startsAt: null } as unknown as { startsAt: string })).toThrow(
      expect.objectContaining({ status: 422, code: 'VALIDATION_ERROR', details: { field: 'startsAt' } }),
    );
  });
});
