import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * D9 — M-100 leída como TEXTO (mismo patrón y misma razón que `migration.m50-no-default.spec.ts`): el DDL final de un
 * `ADD COLUMN … NOT NULL DEFAULT` + `DROP DEFAULT` es idéntico al correcto, así que solo el texto ve la FORMA. Complementa al
 * candado de estado de `test/integration/d9-fee-convention.e2e-spec.ts` (information_schema contra Postgres real).
 */
const ROOT = join(__dirname, '..', 'prisma');
const sql = readFileSync(join(ROOT, 'migrations', '20261120120000_m100_fee_convention', 'migration.sql'), 'utf8')
  .split('\n')
  .filter((l) => !l.trimStart().startsWith('--'))
  .join('\n');
const schema = readFileSync(join(ROOT, 'schema.prisma'), 'utf8');

describe('M-100 — `feeConvention`: NOT NULL sin default, backfill explícito, ningún importe tocado', () => {
  it('⛔ ninguna sentencia da DEFAULT a `feeConvention`', () => {
    for (const stmt of sql.match(/ALTER TABLE[^;]+;/gi) ?? []) {
      if (/"feeConvention"/.test(stmt)) expect(stmt).not.toMatch(/DEFAULT/i);
    }
  });
  it('orden obligatorio: ADD nullable → UPDATE FEE_ON_TOP → SET NOT NULL, en las DOS tablas', () => {
    for (const t of ['Order', 'ShipmentRequest']) {
      const add = sql.indexOf(`ALTER TABLE "${t}" ADD COLUMN "feeConvention" "FeeConvention";`);
      const upd = sql.indexOf(`UPDATE "${t}" SET "feeConvention" = 'FEE_ON_TOP' WHERE "feeConvention" IS NULL;`);
      const nn = sql.indexOf(`ALTER TABLE "${t}" ALTER COLUMN "feeConvention" SET NOT NULL;`);
      expect(add).toBeGreaterThanOrEqual(0);
      expect(upd).toBeGreaterThan(add);
      expect(nn).toBeGreaterThan(upd);
    }
  });
  it('⛔ el backfill solo escribe la convención: ni un UPDATE a importes ni a `stripeFeeCents`', () => {
    for (const u of sql.match(/UPDATE[^;]+;/gi) ?? []) {
      expect(u).toMatch(/SET "feeConvention" = 'FEE_ON_TOP'/);
      expect(u).not.toMatch(/Cents|"stripeFee/);
    }
  });
  it('schema.prisma: `feeConvention` sin @default en Order y ShipmentRequest; `stripeFeeCents Int?`', () => {
    const lines = schema.split('\n').filter((l) => /^\s*feeConvention\s/.test(l));
    expect(lines).toHaveLength(2);
    for (const l of lines) expect(l).not.toMatch(/@default/);
    expect(schema.split('\n').filter((l) => /^\s*stripeFeeCents\s+Int\?/.test(l))).toHaveLength(2);
  });
});
