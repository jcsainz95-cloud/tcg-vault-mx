/**
 * wishlist.settings.spec.ts — rev v1.87⟨wishlist⟩ WSH-T30 (API_CONTRACT §WSH.2): las OCHO claves de §WSH.2 en
 * `SETTING_DTO_MAP` (nombre del DTO ⇒ clave de BD), su seed (`SETTING_DEFAULTS`, idéntico al `INSERT` de M-74), su dominio
 * (fuera ⇒ el validador devuelve mensaje ⇒ `422 VALIDATION_ERROR` por clave) y la paridad del enum interno
 * `WishlistNoticeStatus` (schema en disco ⇄ línea canónica de §0 del contrato).
 * ⛔ Oráculo escrito a mano desde la tabla del contrato.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SETTING_DEFAULTS, SETTING_DTO_MAP, SETTING_VALIDATORS, SettingKeyType } from '../src/modules/settings/settings.constants';

const TABLE: { dto: string; db: string; seed: unknown; ok: unknown[]; bad: unknown[] }[] = [
  { dto: 'wishlistEnabled', db: 'wishlist_enabled', seed: 'off', ok: ['on', 'off'], bad: ['ON', true, 1, ''] },
  { dto: 'wishlistMaxPerAccount', db: 'wishlist_max_per_account', seed: 20, ok: [1, 20, 200], bad: [0, 201, 1.5, '20'] },
  { dto: 'wishlistMaxIvaMode', db: 'wishlist_max_iva_mode', seed: 'with_iva', ok: ['with_iva', 'without_iva'], bad: ['con', '', null] },
  { dto: 'wishlistDailyMailCap', db: 'wishlist_daily_mail_cap', seed: 3, ok: [1, 20], bad: [0, 21, -1] },
  { dto: 'wishlistMailWindowMin', db: 'wishlist_mail_window_min', seed: 30, ok: [0, 720], bad: [-1, 721, 2.5] },
  { dto: 'wishlistTargetMarginPct', db: 'wishlist_target_margin_pct', seed: 15, ok: [0, 100], bad: [-1, 101, '15'] },
  { dto: 'wishlistMarginBasis', db: 'wishlist_margin_basis', seed: 'cost', ok: ['cost', 'sale'], bad: ['costo', ''] },
  { dto: 'sealedRestockMaxPendingPerEmail', db: 'sealed_restock_max_pending_per_email', seed: 5, ok: [1, 50], bad: [0, 51] },
];

describe('WSH-T30 — las ocho claves de §WSH.2', () => {
  it.each(TABLE)('$dto ⇒ $db en SETTING_DTO_MAP', ({ dto, db }) => {
    expect(SETTING_DTO_MAP[dto]).toBe(db);
  });

  it.each(TABLE)('$db: seed = $seed', ({ db, seed }) => {
    expect(SETTING_DEFAULTS[db as SettingKeyType]).toEqual(seed);
  });

  it.each(TABLE)('$db: dominio (dentro ⇒ null; fuera ⇒ mensaje)', ({ db, ok, bad }) => {
    const v = SETTING_VALIDATORS[db as SettingKeyType];
    expect(v).toBeDefined();
    for (const x of ok) expect(v(x)).toBeNull();
    for (const x of bad) expect(typeof v(x)).toBe('string');
  });

  it('el INSERT de M-74 siembra EXACTAMENTE `SETTING_DEFAULTS` (ni una clave más, ni un valor distinto)', () => {
    const sql = readFileSync(
      join(__dirname, '..', 'prisma', 'migrations', '20261027120000_m74_wishlist', 'migration.sql'),
      'utf8',
    );
    const rows = [...sql.matchAll(/\('([a-z_]+)', '([^']+)'::jsonb, 'migration:m74-wishlist'/g)].map((m) => [m[1], JSON.parse(m[2])]);
    expect(Object.fromEntries(rows)).toEqual(Object.fromEntries(TABLE.map((t) => [t.db, t.seed])));
  });
});

describe('WSH-T30 — paridad de `WishlistNoticeStatus` (banda 3: schema en disco ⇄ contrato)', () => {
  it('la línea canónica de §0 = el enum del schema', () => {
    const contract = readFileSync(join(__dirname, '..', '..', 'docs', 'API_CONTRACT.md'), 'utf8');
    const line = /^WishlistNoticeStatus\s+=\s+(.+)$/m.exec(contract);
    expect(line).not.toBeNull();
    const fromContract = line![1].replace(/\/\/.*$/, '').split('|').map((v) => v.trim()).filter(Boolean).sort();
    const schema = readFileSync(join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');
    const block = /enum WishlistNoticeStatus \{([\s\S]*?)\}/.exec(schema);
    expect(block).not.toBeNull();
    const fromSchema = block![1].split('\n').map((l) => l.replace(/\/\/.*$/, '').trim()).filter(Boolean).sort();
    expect(fromContract).toEqual(['pending', 'sent', 'skipped', 'suppressed']);
    expect(fromSchema).toEqual(fromContract);
  });
});
