import { defineConfig } from '@playwright/test';

/**
 * Configuración Playwright para los E2E del frontend (teoría → realidad: verifican
 * la app corriendo, no componentes aislados como los unit de vitest).
 *
 * Navegador: Chromium YA instalado en el entorno (`/opt/pw-browsers/chromium`).
 * NO se ejecuta `playwright install` (evita descargas); se apunta el binario con
 * `executablePath`. Se puede sobreescribir con `PLAYWRIGHT_CHROMIUM_PATH`.
 *
 * Base URL: parametrizable por `E2E_BASE_URL` (la app corriendo que levanta
 * devops en CI). Si NO se define, Playwright levanta el server Next en modo mocks
 * (`NEXT_PUBLIC_USE_MOCKS=true`) para poder correr sin backend real.
 */

const CHROMIUM = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: isCI
    ? [['list'], ['html', { open: 'never' }], ['github']]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    locale: 'es-MX',
    timezoneId: 'America/Mexico_City',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 15_000,
    navigationTimeout: 60_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        viewport: { width: 1280, height: 800 },
        launchOptions: { executablePath: CHROMIUM },
      },
    },
  ],
  // Si E2E_BASE_URL viene dado (app ya corriendo en CI), NO levantamos server.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:3000/es',
        timeout: 180_000,
        reuseExistingServer: !isCI,
        env: { NEXT_PUBLIC_USE_MOCKS: 'true' },
      },
});
