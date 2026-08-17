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
 *
 * Modo REAL (`E2E_REAL=1`): filtra automáticamente a los smoke tagueados `@real`
 * (comprar/retirar/vender) — los ÚNICOS diseñados para correr contra el backend real
 * (autentican de verdad vía `utils/auth.loginAs`, descubren datos del seed y asertan
 * estructura, no montos de fixture). Los demás specs (copy/i18n/términos, casos mock-only)
 * NO corren en real. Así el humano/devops solo necesita:
 *   E2E_BASE_URL=http://localhost:3010 E2E_REAL=1 npm run test:e2e
 * (o, equivalente/redundante, añadir `-- --grep @real`). En modo mock (sin `E2E_REAL`)
 * NO se filtra: corre TODA la suite (los `@real` también corren, por su rama mock).
 */

const CHROMIUM = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const isCI = !!process.env.CI;
const isReal = process.env.E2E_REAL === '1';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  // En real, solo el subset @real (smoke de flujos de dinero contra el stack real).
  grep: isReal ? /@real/ : undefined,
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
