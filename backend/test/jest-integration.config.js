/**
 * jest-integration.config.js — Config de la suite de INTEGRACIÓN/E2E (infra real).
 * Propiedad: backend. Separada del `jest.config.js` unitario para que `npm test`
 * (unit, sin infra) NO recoja estos specs y siga verde sin Postgres/Redis/MinIO.
 *
 * Ejecuta: `npm run test:integration` (corre migraciones + seed sintético antes).
 * Requiere: DATABASE_URL, REDIS_URL, S3_*, STRIPE_WEBHOOK_SECRET (ver BACKEND_NOTES).
 */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '..',
  testRegex: 'test/integration/.*\\.e2e-spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/src/$1',
  },
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/test/integration/setup.ts'],
  // Estado de DB compartido entre specs → serializa para evitar carreras.
  maxWorkers: 1,
  testTimeout: 30000,
};
