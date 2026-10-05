module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  // La suite de integración (`*.e2e-spec.ts`, infra real) corre aparte con
  // test/jest-integration.config.js; se excluye del `npm test` unitario.
  testPathIgnorePatterns: ['/node_modules/', '/test/integration/'],
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  collectCoverageFrom: ['src/**/*.(t|j)s'],
  coverageDirectory: './coverage',
  testEnvironment: 'node',
  // ⭐💰🔒 PS-99 (c) — la red a *.skydropx.com vetada en TODA la suite (API_CONTRACT §M4-SHIP.19.19.17).
  // ⛔ No se quita: `test/skydropx.no-real-purchase.spec.ts` lo exige aquí y en el de integración.
  setupFiles: ['<rootDir>/test/setup/forbid-skydropx-network.ts'],
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/src/$1',
  },
};
