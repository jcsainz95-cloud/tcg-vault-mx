import { defineConfig } from '@playwright/test';

/**
 * Fase 2 de marketing con el modo ENCENDIDO (ARCHITECTURE §14.11: «job de E2E con el modo encendido y
 * peticiones a terceros interceptadas»). Solo `e2e/measurement-on.spec.ts`.
 *
 *     npx playwright test -c playwright.measurement-on.config.ts
 *
 * Construye su PROPIO bundle de MOCKS (`.next-e2e-mkt-on`, puerto 3007 por defecto) con
 * `NEXT_PUBLIC_MEASUREMENT_MODE=on`, IDs de prueba con forma válida y una versión de aviso de E2E
 * (`next.config.mjs` solo la hornea con `NEXT_PUBLIC_USE_MOCKS=true`). Usa `npx next build`, no
 * `npm run build`: la puerta C-D1 (prebuild) es para lo que se PUBLICA, y este bundle no se publica.
 * ⛔ Nada sale a Google/Meta: el spec intercepta esos hosts en el contexto antes de navegar.
 */

const CHROMIUM = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const PORT = process.env.E2E_MKT_ON_PORT ?? '3007';
const DIST = process.env.E2E_MKT_ON_DIST_DIR ?? '.next-e2e-mkt-on';
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './e2e',
  testMatch: 'measurement-on.spec.ts',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: 0,
  workers: isCI ? 1 : 2,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['./e2e/reporters/not-measured.ts']],
  // L-8 (caso badge) siembra el gancho de grading en real (`gradingScenario()`, enciende el dial): el MISMO
  // teardown que la suite principal lo apaga al terminar. En mocks no hace I/O.
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'es-MX',
    timezoneId: 'America/Mexico_City',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 60_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium', viewport: { width: 1280, height: 800 }, launchOptions: { executablePath: CHROMIUM } },
    },
  ],
  webServer: {
    command: `npx next build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/es`,
    timeout: 600_000,
    reuseExistingServer: process.env.E2E_REUSE_SERVER === '1',
    env: {
      NEXT_PUBLIC_USE_MOCKS: 'true',
      NEXT_DIST_DIR: DIST,
      NEXT_PUBLIC_MEASUREMENT_MODE: 'on',
      NEXT_PUBLIC_GA4_MEASUREMENT_ID: 'G-E2ETEST1',
      NEXT_PUBLIC_META_PIXEL_ID: '1234567890123',
      NEXT_PUBLIC_MEASUREMENT_E2E_NOTICE_VERSION: 'e2e-mkt2-1',
    },
  },
});
