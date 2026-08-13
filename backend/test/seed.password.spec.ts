/**
 * SEC-C1: el seed NO usa contraseñas hardcodeadas. Exige `SEED_ADMIN_PASSWORD` /
 * `SEED_OPERATOR_PASSWORD` por env y FALLA en entornos no-locales si faltan (nunca
 * defaults débiles). En local se permite un fallback SOLO para desarrollo.
 */

// PrismaClient se construye al importar seed.ts; le damos un DATABASE_URL dummy
// (no se conecta) y cargamos los helpers vía require perezoso tras fijar el env.
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://u:p@localhost:5432/db?schema=public';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { requiredSeedPassword, isLocalEnv } = require('../prisma/seed');

describe('seed — SEC-C1 política de contraseñas', () => {
  const OLD = { ...process.env };
  afterEach(() => {
    process.env = { ...OLD };
  });

  it('en entorno NO-local, falla si falta la env (sin defaults débiles)', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.SEED_ADMIN_PASSWORD;
    expect(() => requiredSeedPassword('SEED_ADMIN_PASSWORD', 'weak')).toThrow(/required/i);
  });

  it('en entorno NO-local, usa el valor de la env cuando está presente', () => {
    process.env.NODE_ENV = 'staging';
    process.env.SEED_ADMIN_PASSWORD = 'A-Strong-Secret-123';
    expect(requiredSeedPassword('SEED_ADMIN_PASSWORD', 'weak')).toBe('A-Strong-Secret-123');
  });

  it('en local (development/test), permite fallback SOLO para desarrollo', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.SEED_OPERATOR_PASSWORD;
    expect(requiredSeedPassword('SEED_OPERATOR_PASSWORD', 'dev-fallback')).toBe('dev-fallback');
    expect(isLocalEnv()).toBe(true);
  });

  it('nunca hay una contraseña literal hardcodeada como default en el seed', () => {
    // El fallback local es un parámetro explícito; no existe `Operador123!`/`ChangeMe123!`.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('../prisma/seed.ts'), 'utf8');
    expect(src).not.toContain('Operador123!');
    expect(src).not.toContain('ChangeMe123!');
  });
});
