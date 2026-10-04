/**
 * sdx-d.dials.spec.ts — ⭐💰 pieza D2a de Skydropx (M-66 = `M-SDX-D`): los doce diales en las CUATRO tablas, sus seeds
 * (`API_CONTRACT §M4-SHIP.19.19.12`, `HECHOS.md:48`/`:49`), sus validadores (PS-96 parte dial, PS-97 parte dial) y la
 * paridad de la migración con el código (lo que la migración siembra == `SETTING_DEFAULTS` / `DEFAULT_SHIPPING_PACKAGES`).
 * Propiedad: backend. La parte con BD (PUT /admin/settings, seeds tras migrar, CHECKs) está en
 * `test/integration/sdx-d-schema.e2e-spec.ts`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CarrierStatus } from '@prisma/client';
import {
  SETTING_DEFAULTS,
  SETTING_DTO_MAP,
  SETTING_VALIDATORS,
  SettingKey,
  SettingKeyType,
} from '../src/modules/settings/settings.constants';
import { DEFAULT_SHIPPING_PACKAGES } from '../src/modules/settings/shipping-dials';
import { CARRIER_STATUSES } from '../src/modules/shipping-provider/shipping-provider.port';

/** §19.19.12 — la tabla vigente entera, escrita a mano (el ancla: cambiar un seed rompe aquí a propósito). */
const EXPECTED: Record<string, { key: string; seed: unknown }> = {
  shippingProvider: { key: 'shipping_provider', seed: 'off' },
  shippingLabelPurchase: { key: 'shipping_label_purchase', seed: 'disabled' }, // HECHOS.md:58 (arranca apagado)
  skydropxOriginAddressTemplateId: { key: 'skydropx_origin_address_template_id', seed: null },
  skydropxOriginSnapshot: { key: 'skydropx_origin_snapshot', seed: null },
  shippingPreferredCarriers: { key: 'shipping_preferred_carriers', seed: ['ninetynineminutes'] },
  shippingDropoffPoints: {
    key: 'shipping_dropoff_points',
    seed: { ninetynineminutes: { name: 'Punto99 · Periférico Sur 4249', address: 'Av. Periférico Sur 4249, Jardines de la Montaña, 14210 CDMX' } },
  },
  shippingConsignmentNote: { key: 'shipping_consignment_note', seed: '49101600' }, // HECHOS.md:48
  shippingPackageRuleBoxMinCards: { key: 'shipping_package_rule_box_min_cards', seed: 60 },
  skydropxLowBalanceCents: { key: 'skydropx_low_balance_cents', seed: 100000 }, // HECHOS.md:62 (v1.80.12.9, antes 50000)
  shippingTrackingPollMinutes: { key: 'shipping_tracking_poll_minutes', seed: 60 },
  shippingInsuranceTiers: {
    key: 'shipping_insurance_tiers',
    // HECHOS.md:48 — «menos de 2500 el 25 y así»; medido $10,000 ⇒ $170 (PROD §4.4)
    seed: [
      { coverageCents: 250000, costCents: 2500, measuredAt: '2026-10-04' },
      { coverageCents: 1000000, costCents: 17000, measuredAt: '2026-10-04' },
    ],
  },
  shippingLabelFormat: { key: 'shipping_label_format', seed: 'standard' },
};

const MIGRATIONS = join(__dirname, '..', 'prisma', 'migrations');
const M66_DIR = readdirSync(MIGRATIONS).find((d) => /_m66_sdx_d_/.test(d));
const M66 = M66_DIR ? readFileSync(join(MIGRATIONS, M66_DIR, 'migration.sql'), 'utf8') : '';
/** SQL sin comentarios `--` (la migración no lleva `--` dentro de ningún literal; si lo llevara, este candado lo diría). */
const sqlCode = (sql: string) => sql.replace(/--.*$/gm, '');

describe('D2a — los doce diales de Skydropx en las CUATRO tablas (§19.19.12)', () => {
  it.each(Object.entries(EXPECTED))('%s ⇒ SettingKey, SETTING_DEFAULTS (seed exacto), SETTING_VALIDATORS (el seed valida), SETTING_DTO_MAP', (dtoKey, { key, seed }) => {
    expect(Object.values(SettingKey)).toContain(key);
    expect(SETTING_DTO_MAP[dtoKey]).toBe(key);
    expect(SETTING_DEFAULTS[key as SettingKeyType]).toEqual(seed);
    const validate = SETTING_VALIDATORS[key as SettingKeyType];
    expect(typeof validate).toBe('function');
    expect(validate(seed)).toBeNull(); // un seed que su propio validador rechaza sería un PUT imposible de repetir
  });

  it('ni uno más: las claves de envío del DTO son EXACTAMENTE las doce; `shippingDeclaredValueCapCents` NO existe (retirado, §19.19.5)', () => {
    const shippingish = Object.keys(SETTING_DTO_MAP).filter((k) => /^(shipping|skydropx)/.test(k) && k !== 'shippingFeeCents' && k !== 'shippingLabelReissueMaxPerShipment'); // el envío al comprador no es de Skydropx; el tope TG-2 es de §19.29.8 // el envío al comprador (M10 desde v1.0) no es de Skydropx
    expect(shippingish.sort()).toEqual(Object.keys(EXPECTED).sort());
    expect(Object.values(SettingKey)).not.toContain('shipping_declared_value_cap_cents');
    expect(M66).not.toMatch(/declared_value_cap/);
  });

  it('FAIL-CLOSED: el proveedor nace `off` y la compra `disabled` (sin clic humano no se cotiza ni se compra)', () => {
    expect(SETTING_DEFAULTS[SettingKey.SHIPPING_PROVIDER]).toBe('off');
    expect(SETTING_DEFAULTS[SettingKey.SHIPPING_LABEL_PURCHASE]).toBe('disabled');
  });
});

/** §19.29.8 (v1.80.12.9, `HECHOS.md:62`): topes y avisos del gasto. Cableados en D2a; los siembra en BD M-68 (D2g). */
const SPEND: Record<string, { key: string; seed: unknown; ok: unknown[]; bad: unknown[] }> = {
  operatorLabelCap24hCents: { key: 'operator_label_cap_24h_cents', seed: 250000, ok: [100, 100000000], bad: [0, 99, 100000001, 2500.5, null] },
  shippingLabelReissueMaxPerShipment: { key: 'shipping_label_reissue_max_per_shipment', seed: 1, ok: [0, 10], bad: [-1, 11, '1'] },
  spendAlertsDisabled: { key: 'spend_alerts_disabled', seed: [], ok: [['AG-1', 'AG-13']], bad: [['AG-14'], ['AG-1', 'AG-1'], ['ag-1'], 'AG-1', null] },
  spendAlertLabelCapWarnPct: { key: 'spend_alert_label_cap_warn_pct', seed: 80, ok: [1, 99], bad: [0, 100] },
  spendAlertShipmentCancelCount: { key: 'spend_alert_shipment_cancel_count', seed: 2, ok: [1, 10], bad: [0, 11] },
  spendAlertPersonCancelCount24h: { key: 'spend_alert_person_cancel_count_24h', seed: 3, ok: [1, 50], bad: [0, 51] },
  spendAlertChargeDriftImmediateCents: { key: 'spend_alert_charge_drift_immediate_cents', seed: 2000, ok: [0], bad: [-1, 1.5] },
  spendAlertExtraChargeImmediateCents: { key: 'spend_alert_extra_charge_immediate_cents', seed: 15000, ok: [0], bad: [-1] },
  spendAlertCancelRefundDays: { key: 'spend_alert_cancel_refund_days', seed: 3, ok: [1, 30], bad: [0, 31] },
  spendAlertLabelNotShippedDays: { key: 'spend_alert_label_not_shipped_days', seed: 3, ok: [1, 30], bad: [0, 31] },
};

describe('v1.80.12.9 — diales de control del gasto (§19.29.8) en las cuatro tablas', () => {
  it.each(Object.entries(SPEND))('%s ⇒ clave, seed, validador (bordes) y DTO', (dtoKey, { key, seed, ok, bad }) => {
    expect(SETTING_DTO_MAP[dtoKey]).toBe(key);
    expect(SETTING_DEFAULTS[key as SettingKeyType]).toEqual(seed);
    const validate = SETTING_VALIDATORS[key as SettingKeyType];
    expect(validate(seed)).toBeNull();
    for (const x of ok) expect({ x, err: validate(x) }).toEqual({ x, err: null });
    for (const x of bad) expect({ x, err: validate(x) }).toEqual({ x, err: expect.any(String) });
  });

  it('M-66 NO los siembra (es de M-68, D2g)', () => {
    for (const { key } of Object.values(SPEND)) expect(M66).not.toContain(`'${key}'`);
  });
});

describe('D2a — validadores (PS-96 parte dial, PS-97 parte dial)', () => {
  const v = (k: SettingKeyType, x: unknown) => SETTING_VALIDATORS[k](x);

  it('PS-97 — Carta Porte `^\\d{8}$`: `4910160` (7), `491016000` (9), con letras, número o null ⇒ error', () => {
    for (const bad of ['4910160', '491016000', '4910160a', ' 49101600', 49101600, null, '']) {
      expect(v(SettingKey.SHIPPING_CONSIGNMENT_NOTE, bad)).not.toBeNull();
    }
    expect(v(SettingKey.SHIPPING_CONSIGNMENT_NOTE, '60141103')).toBeNull();
  });

  it('PS-96 — escalones: no crecientes, iguales, < 100, costo negativo/decimal, sin `measuredAt`, clave extra, vacío o 21 ⇒ error', () => {
    const t = (coverageCents: number, costCents = 100, measuredAt: unknown = '2026-10-04') => ({ coverageCents, costCents, measuredAt });
    const bad: unknown[] = [
      [t(1000000), t(250000)], // decrecientes
      [t(250000), t(250000)], // iguales: «estrictamente» creciente
      [t(99)],
      [t(250000, -1)],
      [t(250000, 2.5)],
      [t(250000.5)],
      [{ coverageCents: 250000, costCents: 2500 }],
      [{ ...t(250000), extra: 1 }],
      [t(250000, 2500, 'ayer')],
      [t(250000, 2500, '2026-02-30')],
      [],
      Array.from({ length: 21 }, (_, i) => t(1000 * (i + 1))),
      null,
      { coverageCents: 250000 },
    ];
    for (const b of bad) expect({ b, err: v(SettingKey.SHIPPING_INSURANCE_TIERS, b) }).toEqual({ b, err: expect.any(String) });
    expect(v(SettingKey.SHIPPING_INSURANCE_TIERS, [t(100, 0, '2026-10-04T12:00:00Z'), t(250000), t(500000), t(1000000)])).toBeNull();
    expect(v(SettingKey.SHIPPING_INSURANCE_TIERS, Array.from({ length: 20 }, (_, i) => t(1000 * (i + 1))))).toBeNull();
  });

  it('proveedor, compra y formato: solo sus literales (un `true` o `ON` no queda guardado pareciendo encendido)', () => {
    expect(v(SettingKey.SHIPPING_PROVIDER, 'skydropx')).toBeNull();
    for (const bad of ['on', 'Skydropx', true, null]) expect(v(SettingKey.SHIPPING_PROVIDER, bad)).not.toBeNull();
    for (const ok of ['disabled', 'super_admin_only', 'operators']) expect(v(SettingKey.SHIPPING_LABEL_PURCHASE, ok)).toBeNull();
    for (const bad of ['enabled', 'super_admin', true, null]) expect(v(SettingKey.SHIPPING_LABEL_PURCHASE, bad)).not.toBeNull();
    expect(v(SettingKey.SHIPPING_LABEL_FORMAT, 'thermal')).toBeNull();
    expect(v(SettingKey.SHIPPING_LABEL_FORMAT, 'pdf')).not.toBeNull();
  });

  it('enteros con rango: caja 1..500, saldo ≥ 0, sondeo 5..1440', () => {
    expect(v(SettingKey.SHIPPING_PACKAGE_RULE_BOX_MIN_CARDS, 1)).toBeNull();
    expect(v(SettingKey.SHIPPING_PACKAGE_RULE_BOX_MIN_CARDS, 500)).toBeNull();
    for (const bad of [0, 501, 60.5, '60']) expect(v(SettingKey.SHIPPING_PACKAGE_RULE_BOX_MIN_CARDS, bad)).not.toBeNull();
    expect(v(SettingKey.SKYDROPX_LOW_BALANCE_CENTS, 0)).toBeNull();
    for (const bad of [-1, 1.5, null]) expect(v(SettingKey.SKYDROPX_LOW_BALANCE_CENTS, bad)).not.toBeNull();
    expect(v(SettingKey.SHIPPING_TRACKING_POLL_MINUTES, 5)).toBeNull();
    expect(v(SettingKey.SHIPPING_TRACKING_POLL_MINUTES, 1440)).toBeNull();
    for (const bad of [4, 1441]) expect(v(SettingKey.SHIPPING_TRACKING_POLL_MINUTES, bad)).not.toBeNull();
  });

  it('paqueterías preferidas (0..10, sin repetidos), sucursales ({name,address}), plantilla (≤ 64 o null), snapshot de origen (claves de §19.2)', () => {
    expect(v(SettingKey.SHIPPING_PREFERRED_CARRIERS, [])).toBeNull();
    for (const bad of [['a', 'a'], [''], Array.from({ length: 11 }, (_, i) => `c${i}`), 'ninetynineminutes', [1]]) {
      expect(v(SettingKey.SHIPPING_PREFERRED_CARRIERS, bad)).not.toBeNull();
    }
    expect(v(SettingKey.SHIPPING_DROPOFF_POINTS, {})).toBeNull();
    for (const bad of [null, [], { dhl: { name: 'x' } }, { dhl: { name: 'x', address: 'y', phone: 'z' } }, { dhl: { name: '', address: 'y' } }]) {
      expect(v(SettingKey.SHIPPING_DROPOFF_POINTS, bad)).not.toBeNull();
    }
    expect(v(SettingKey.SKYDROPX_ORIGIN_ADDRESS_TEMPLATE_ID, 'tpl_123')).toBeNull();
    for (const bad of ['', '  ', 'x'.repeat(65), 12]) expect(v(SettingKey.SKYDROPX_ORIGIN_ADDRESS_TEMPLATE_ID, bad)).not.toBeNull();
    expect(v(SettingKey.SKYDROPX_ORIGIN_SNAPSHOT, { name: 'TCG Hunt', company: 'TCG Hunt', street1: 'Verapaz 1', postalCode: '03000', reference: null })).toBeNull();
    for (const bad of [{ rfc: 'X' }, { name: 1 }, [], 'x', { name: 'x'.repeat(201) }]) {
      expect(v(SettingKey.SKYDROPX_ORIGIN_SNAPSHOT, bad)).not.toBeNull();
    }
  });
});

describe('D2a — la migración M-66 siembra EXACTAMENTE lo que dice el código (una lista, dos artefactos)', () => {
  it('existe UNA migración `m66_sdx_d` y es la 66 (sigue a M-65)', () => {
    const dirs = readdirSync(MIGRATIONS).filter((d) => /^\d{14}_/.test(d)).sort();
    expect(M66_DIR).toBeDefined();
    const i = dirs.indexOf(M66_DIR!);
    expect(dirs[i - 1]).toMatch(/_m65_sdx_c2_address_revision$/);
    expect(dirs.filter((d) => /_m66_/.test(d))).toHaveLength(1);
  });

  it('los 12 `INSERT INTO "ConfigSetting"` == SETTING_DEFAULTS (JSON a JSON), con `ON CONFLICT DO NOTHING` (§11.0)', () => {
    const block = /INSERT INTO "ConfigSetting"[\s\S]*?ON CONFLICT \("key"\) DO NOTHING;/.exec(sqlCode(M66))![0];
    const rows = [...block.matchAll(/\('([a-z_]+)', '((?:[^']|'')*)'::jsonb/g)].map((m) => [m[1], JSON.parse(m[2].replace(/''/g, "'"))] as const);
    expect(rows.map(([k]) => k).sort()).toEqual(Object.values(EXPECTED).map((e) => e.key).sort());
    for (const [k, val] of rows) expect({ k, val }).toEqual({ k, val: SETTING_DEFAULTS[k as SettingKeyType] });
  });

  it('los dos `ShippingPackage` == DEFAULT_SHIPPING_PACKAGES, activos, con código, `weightKg` entero ≥ 1', () => {
    const block = /INSERT INTO "ShippingPackage"[\s\S]*?ON CONFLICT \("code"\) DO NOTHING;/.exec(sqlCode(M66))![0];
    const rows = [...block.matchAll(/gen_random_uuid\(\)::text, '(\w+)', '([^']+)', (\d+), (\d+), (\d+), (\d+), '(\w+)', (true|false), (\d+)/g)].map((m) => ({
      code: m[1], label: m[2], lengthCm: +m[3], widthCm: +m[4], heightCm: +m[5], weightKg: +m[6], providerPackageType: m[7], active: m[8] === 'true', sortOrder: +m[9],
    }));
    expect(rows).toEqual(DEFAULT_SHIPPING_PACKAGES.map((p) => ({ ...p })));
    for (const p of rows) expect(Number.isInteger(p.weightKg) && p.weightKg >= 1 && p.active && p.providerPackageType.length > 0).toBe(true);
  });

  it('SIN BACKFILL: fuera de comentarios no hay `UPDATE` ni `DELETE`; la cabecera trae la REVERSA', () => {
    const code = sqlCode(M66);
    expect(code).not.toMatch(/\bUPDATE\s+"/i);
    expect(code).not.toMatch(/\bDELETE\s+FROM/i);
    expect(M66).toMatch(/-- REVERSA/);
    expect(M66).toMatch(/DROP TABLE IF EXISTS "ShipmentQuote"/);
  });
});

describe('D2a — `CarrierStatus` del schema == `CARRIER_STATUSES` del puerto (D1)', () => {
  it('los doce, en el mismo conjunto', () => {
    expect(Object.values(CarrierStatus).sort()).toEqual([...CARRIER_STATUSES].sort());
  });
});
