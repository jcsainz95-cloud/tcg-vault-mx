/**
 * accessories.dials-and-packages.spec.ts — mitades puras de **AC-B40** y de los diales de §AC.11 · API_CONTRACT §AC.7
 * («Cajas en el panel») y §AC.11 («Diales nuevos»).
 *
 *  - `energy_bundle_price_cents` (1..100_000, default 2000) y `accessory_suggestion_count` (0..6, default 3), en el DTO de
 *    M10 como `energyBundlePriceCents` / `accessorySuggestionCount`. ⛔ NO van a `OWNER_ONLY_SETTING_KEYS`.
 *  - `PUT /admin/shipping/packages`: `customerFeeCents: number | null` (CHECK `shipping_package_customer_fee`: NULL o
 *    1..10_000_000); fuera de rango ⇒ `400 {field:'customerFeeCents', index}`.
 */
import {
  OWNER_ONLY_SETTING_KEYS,
  SETTING_DEFAULTS,
  SETTING_DTO_MAP,
  SETTING_VALIDATORS,
  SettingKey,
} from '../src/modules/settings/settings.constants';
import { parsePackagesBody } from '../src/modules/admin/shipping-config';
import { BusinessException } from '../src/common/business.exception';

describe('§AC.11 — diales de accesorios', () => {
  const K = SettingKey as Record<string, string>;

  it('claves, defaults y nombres del DTO', () => {
    expect(K.ENERGY_BUNDLE_PRICE_CENTS).toBe('energy_bundle_price_cents');
    expect(K.ACCESSORY_SUGGESTION_COUNT).toBe('accessory_suggestion_count');
    expect((SETTING_DEFAULTS as Record<string, unknown>).energy_bundle_price_cents).toBe(2000);
    expect((SETTING_DEFAULTS as Record<string, unknown>).accessory_suggestion_count).toBe(3);
    expect(SETTING_DTO_MAP.energyBundlePriceCents).toBe('energy_bundle_price_cents');
    expect(SETTING_DTO_MAP.accessorySuggestionCount).toBe('accessory_suggestion_count');
  });

  it.each([
    ['energy_bundle_price_cents', 1, true],
    ['energy_bundle_price_cents', 100_000, true],
    ['energy_bundle_price_cents', 0, false],
    ['energy_bundle_price_cents', 100_001, false],
    ['energy_bundle_price_cents', 20.5, false],
    ['energy_bundle_price_cents', '2000', false],
    ['accessory_suggestion_count', 0, true],
    ['accessory_suggestion_count', 6, true],
    ['accessory_suggestion_count', 7, false],
    ['accessory_suggestion_count', -1, false],
    ['accessory_suggestion_count', 2.5, false],
  ] as const)('%s = %p ⇒ válido %p', (key, v, ok) => {
    const validate = (SETTING_VALIDATORS as Record<string, (x: unknown) => string | null>)[key];
    expect(typeof validate).toBe('function');
    expect(validate(v) === null).toBe(ok);
  });

  it('⛔ no son diales del dueño', () => {
    expect(OWNER_ONLY_SETTING_KEYS as readonly string[]).not.toContain('energy_bundle_price_cents');
    expect(OWNER_ONLY_SETTING_KEYS as readonly string[]).not.toContain('accessory_suggestion_count');
  });
});

describe('AC-B40 — parsePackagesBody con customerFeeCents', () => {
  const pkg = (over: Record<string, unknown> = {}) => ({
    code: 'box',
    label: 'Caja',
    lengthCm: 30,
    widthCm: 20,
    heightCm: 10,
    weightKg: 1,
    providerPackageType: '4G',
    active: true,
    sortOrder: 1,
    ...over,
  });

  it('número en rango ⇒ se conserva; null ⇒ null; ausente ⇒ null (reemplazo entero)', () => {
    const out = parsePackagesBody({ packages: [pkg({ customerFeeCents: 15000 }), pkg({ code: 'b2', customerFeeCents: null }), pkg({ code: 'b3' })] });
    expect(out.map((p) => p.customerFeeCents)).toEqual([15000, null, null]);
  });

  it.each([0, -1, 10_000_001, 1.5, '100', true])('customerFeeCents = %p ⇒ 400 {field, index}', (bad) => {
    let err: unknown;
    try {
      parsePackagesBody({ packages: [pkg(), pkg({ code: 'b2', customerFeeCents: bad })] });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(BusinessException);
    const be = err as BusinessException;
    expect(be.getStatus()).toBe(400);
    expect(be.code).toBe('VALIDATION_ERROR');
    expect(be.details).toEqual({ field: 'customerFeeCents', index: 1 });
  });

  it('bordes 1 y 10_000_000 ⇒ válidos', () => {
    expect(parsePackagesBody({ packages: [pkg({ customerFeeCents: 1 }), pkg({ code: 'x', customerFeeCents: 10_000_000 })] }).map((p) => p.customerFeeCents)).toEqual([
      1, 10_000_000,
    ]);
  });
});
