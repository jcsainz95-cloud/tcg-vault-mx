/**
 * sdx-m67-m68.migrations.spec.ts — 💰🔒 las migraciones M-67 (`M-SDX-E`, el folio) y M-68 (`M-GAS-1`, control del gasto)
 * leídas como TEXTO: orden, forma idempotente, el arreglo de `lpad` (§19.29.1.1, C-18), la marca del dueño condicionada a
 * EXACTAMENTE un candidato (§19.30.1 (1), C-20) y la paridad de los seeds con `SETTING_DEFAULTS` (§19.29.8).
 * La conducta contra Postgres real (orden del backfill, 999999 ⇒ 1000000, 0/1/2 candidatos, CHECKs e índice parcial) está
 * en `test/integration/sdx-d2bc-migrations.e2e-spec.ts`. Propiedad: backend.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SETTING_DEFAULTS, SettingKeyType } from '../src/modules/settings/settings.constants';

const MIGRATIONS = join(__dirname, '..', 'prisma', 'migrations');
const DIRS = readdirSync(MIGRATIONS).filter((d) => /^\d{14}_/.test(d)).sort();
const dirOf = (re: RegExp) => DIRS.find((d) => re.test(d));
const read = (d: string | undefined) => (d ? readFileSync(join(MIGRATIONS, d, 'migration.sql'), 'utf8') : '');
const sqlCode = (sql: string) => sql.replace(/--.*$/gm, '');
const M67_DIR = dirOf(/_m67_sdx_e_folio$/);
const M68_DIR = dirOf(/_m68_gas_1_spend_control$/);
const M67 = sqlCode(read(M67_DIR));
const M68 = sqlCode(read(M68_DIR));

/** §19.29.8 — los diez diales que siembra M-68 (el de saldo bajo ya lo siembra M-66 con 100000, §19.29.2). */
const SPEND_KEYS = [
  'operator_label_cap_24h_cents',
  'shipping_label_reissue_max_per_shipment',
  'spend_alerts_disabled',
  'spend_alert_label_cap_warn_pct',
  'spend_alert_shipment_cancel_count',
  'spend_alert_person_cancel_count_24h',
  'spend_alert_charge_drift_immediate_cents',
  'spend_alert_extra_charge_immediate_cents',
  'spend_alert_cancel_refund_days',
  'spend_alert_label_not_shipped_days',
];

describe('M-67 / M-68 — orden: M-66 ⇒ M-67 ⇒ M-68 (zona compartida, un stream; §19.28.1, §19.29.2)', () => {
  it('existen, una de cada una, y siguen a M-66 en ese orden', () => {
    expect(M67_DIR).toBeDefined();
    expect(M68_DIR).toBeDefined();
    const i67 = DIRS.indexOf(M67_DIR!);
    expect(DIRS[i67 - 1]).toMatch(/_m66_sdx_d_skydropx$/);
    expect(DIRS[i67 + 1]).toBe(M68_DIR);
    expect(DIRS.filter((d) => /_m67_/.test(d))).toHaveLength(1);
    expect(DIRS.filter((d) => /_m68_/.test(d))).toHaveLength(1);
  });

  it('las dos traen su REVERSA en la cabecera (comentada) y no la ejecutan', () => {
    for (const d of [M67_DIR, M68_DIR]) {
      const raw = read(d);
      expect(raw).toMatch(/^-- REVERSA/m);
      expect(raw).toMatch(new RegExp(`DELETE FROM "_prisma_migrations" WHERE migration_name = '${d}'`));
    }
    expect(M67).not.toMatch(/DROP\s+(TABLE|COLUMN|SEQUENCE|FUNCTION|INDEX)/i);
    expect(M68).not.toMatch(/DROP\s+(TABLE|COLUMN|TYPE|INDEX)/i);
  });
});

describe('M-67 — el folio (§19.28.1 + §19.29.1.1)', () => {
  it('C-18: el relleno NO trunca — `lpad(n, greatest(6, length(n)))`, ⛔ nunca `lpad(…, 6, …)` a secas', () => {
    expect(M67).toMatch(/lpad\(s\.n::text, greatest\(6, length\(s\.n::text\)\), '0'\)/);
    expect(M67).not.toMatch(/lpad\([^)]*,\s*6\s*,/);
  });

  it('`nextval` UNA vez por folio: dentro de la función, ⛔ nunca en línea en el DEFAULT (dos llamadas = dos valores)', () => {
    expect((M67.match(/nextval\(/g) ?? []).length).toBe(1);
    expect(M67).toMatch(/ALTER COLUMN "folio" SET DEFAULT shipment_folio_next\(\)/);
  });

  it('idempotente: secuencia/índice/CHECK con IF NOT EXISTS, función OR REPLACE, backfill solo `folio IS NULL`, en orden (requestedAt, id)', () => {
    expect(M67).toMatch(/CREATE SEQUENCE IF NOT EXISTS shipment_folio_seq/);
    expect(M67).toMatch(/CREATE OR REPLACE FUNCTION shipment_folio_next\(\)/);
    expect(M67).toMatch(/ADD COLUMN IF NOT EXISTS "folio" TEXT/);
    expect(M67).toMatch(/WHERE "folio" IS NULL ORDER BY "requestedAt" ASC, "id" ASC/);
    expect(M67).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS "ShipmentRequest_folio_key"/);
    expect(M67).toMatch(/conname = 'shipment_folio_format'/);
    expect(M67).toMatch(/SET NOT NULL/);
  });
});

describe('M-68 — control del gasto (§19.29.2 + §19.30)', () => {
  it('C-20: la marca inicial del dueño exige EXACTAMENTE un candidato y nadie marcado (nunca «el más antiguo»)', () => {
    const upd = /UPDATE "User" SET "isOwner" = true[\s\S]*?;/.exec(M68)?.[0] ?? '';
    expect(upd).toMatch(/role = 'super_admin' AND email IS NOT NULL AND status = 'active' AND "deletedAt" IS NULL\) = 1/);
    expect(upd).toMatch(/NOT EXISTS \(SELECT 1 FROM "User" WHERE "isOwner"\)/);
    expect(upd).not.toMatch(/ORDER BY|LIMIT|MIN\(|createdAt/i);
  });

  it('cardinalidad ≤ 1 en la base: índice PARCIAL único sobre `isOwner`; CHECK de forma', () => {
    expect(M68).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS "user_single_owner" ON "User" \("isOwner"\) WHERE "isOwner"/);
    expect(M68).toMatch(/user_owner_shape[\s\S]*?"role" = 'super_admin' AND "email" IS NOT NULL AND "deletedAt" IS NULL AND "status" <> 'deleted'/);
  });

  it('las tablas y CHECKs de §19.29.2/§19.30 están, todo idempotente', () => {
    for (const t of ['ShipmentLabelAttempt', 'ShipmentPaidLabel', 'SpendAlert', 'SpendDigestRun', 'SpendOwnerWatch']) {
      expect(M68).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS "${t}"`));
    }
    for (const c of [
      'label_attempt_expected_charge_nonneg',
      'label_attempt_no_range',
      'label_attempt_sent_triplet',
      'label_attempt_pending_without_outcome_at',
      'paid_label_charged_nonneg',
      'paid_label_unrefunded_nonneg',
      'paid_label_cancel_paired',
      'paid_label_reissue_has_actor',
      'paid_label_auto_cancel_intent_orphans_only',
      'spend_alert_occurrence_min_1',
      'spend_alert_seen_paired',
      'spend_owner_watch_single_row',
    ]) {
      expect(M68).toMatch(new RegExp(`conname = '${c}'`));
    }
    expect(M68).toMatch(/"muted" BOOLEAN NOT NULL DEFAULT false/);
    expect(M68).toMatch(/"autoCancelIntentAt" TIMESTAMP\(3\)/);
    expect(M68).toMatch(/'owner_account_changed', 'staff_control_by_non_owner'/);
    expect(M68).not.toMatch(/CREATE TABLE "|CREATE INDEX "|CREATE UNIQUE INDEX "/); // siempre con IF NOT EXISTS
  });

  it('§19.29.8: los diez `INSERT INTO "ConfigSetting"` == SETTING_DEFAULTS, `ON CONFLICT DO NOTHING`; el saldo bajo NO (va en M-66)', () => {
    const block = /INSERT INTO "ConfigSetting"[\s\S]*?ON CONFLICT \("key"\) DO NOTHING;/.exec(M68)![0];
    const rows = [...block.matchAll(/\('([a-z0-9_]+)', '((?:[^']|'')*)'::jsonb/g)].map((m) => [m[1], JSON.parse(m[2].replace(/''/g, "'"))] as const);
    expect(rows.map(([k]) => k).sort()).toEqual([...SPEND_KEYS].sort());
    for (const [k, val] of rows) expect({ k, val }).toEqual({ k, val: SETTING_DEFAULTS[k as SettingKeyType] });
    expect(M68).not.toMatch(/skydropx_low_balance_cents/);
    expect(read(dirOf(/_m66_sdx_d_skydropx$/))).toMatch(/\('skydropx_low_balance_cents', '100000'::jsonb/);
  });
});
