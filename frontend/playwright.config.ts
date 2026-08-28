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
 * (comprar/retirar/vender, y desde v1.50.3 **el gancho de grading**) — los diseñados para
 * correr contra el backend real: autentican de verdad (`utils/auth.loginAs`), descubren o
 * siembran sus datos por la API del contrato (`utils/grading`) y asertan ESTRUCTURA, no
 * montos de fixture. Los demás specs (copy/i18n/términos, casos mock-only) NO corren en real.
 * Así el humano/devops solo necesita:
 *   E2E_BASE_URL=http://localhost:3010 E2E_REAL=1 npm run test:e2e
 * (o, equivalente/redundante, añadir `-- --grep @real`). En modo mock (sin `E2E_REAL`)
 * NO se filtra: corre TODA la suite (los `@real` también corren, por su rama mock).
 */

const CHROMIUM = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const isCI = !!process.env.CI;
const isReal = process.env.E2E_REAL === '1';

/**
 * Puerto del server de MOCKS que levanta Playwright. Parametrizable para poder correr la suite de
 * mocks **sin chocar** con un stack real ya escuchando en :3000 (el caso normal cuando devops tiene
 * la plataforma arriba). No aplica cuando `E2E_BASE_URL` viene dado: ahí no levantamos nada.
 */
const MOCK_PORT = process.env.E2E_MOCK_PORT ?? '3000';
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${MOCK_PORT}`;

/**
 * Carpeta de build del bundle de mocks. Separada de `.next` A PROPÓSITO: `NEXT_PUBLIC_USE_MOCKS`
 * se hornea en el artefacto, así que compilar los mocks sobre el `.next` del stack real
 * convertiría en modo-fixtures el `next start` que devops tenga corriendo. Ver `next.config.mjs`.
 */
const MOCK_DIST_DIR = process.env.E2E_MOCK_DIST_DIR ?? '.next-e2e-mock';

/**
 * ─────────────────────────────────────────────────────────────────────────────────────
 * EL SERVER DE MOCKS: BUILD DE PRODUCCIÓN, Y NADA DE REUTILIZAR LO QUE HAYA (QA + techlead).
 *
 * Antes: `command: 'npm run dev'` + `reuseExistingServer: !isCI`. Dos trampas encadenadas:
 *
 *  1. **`next dev` no es la app que se despliega.** Otro compilador (sin minificar, sin
 *     `NODE_ENV=production`), otro comportamiento de RSC/caché y otras condiciones de carrera.
 *     Un verde en `dev` no autoriza un deploy; el gate tiene que medir el mismo artefacto.
 *  2. **`reuseExistingServer: true` fabrica falsos verdes silenciosos.** Si en :3000 ya hay un
 *     Next corriendo —el del stack real de devops, por ejemplo—, Playwright **NO** levanta el
 *     suyo, **NO** aplica `NEXT_PUBLIC_USE_MOCKS=true`… y la suite «de mocks» corre contra el
 *     backend real sin decirlo. Y al revés: una suite que se cree real puede estar hablando con
 *     un bundle horneado con fixtures.
 *
 * Ahora: **build + start** (el artefacto de producción) y `reuseExistingServer: false` salvo
 * opt-in explícito. Las dos escotillas están declaradas y son de quien las enciende:
 *   `E2E_DEV_SERVER=1`    → vuelve a `next dev` (iteración local rápida; NO es el gate).
 *   `E2E_REUSE_SERVER=1`  → reutiliza lo que haya en :3000 (asumes tú qué hay ahí).
 * `NEXT_PUBLIC_USE_MOCKS` es una variable `NEXT_PUBLIC_*`: se hornea EN EL BUILD, así que el
 * `env` de aquí tiene que estar puesto para el `build`, no solo para el `start`. Por eso el
 * comando encadena los dos en el mismo proceso.
 * ─────────────────────────────────────────────────────────────────────────────────────
 */
const useDevServer = process.env.E2E_DEV_SERVER === '1';
const reuseExistingServer = process.env.E2E_REUSE_SERVER === '1';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  // En real, solo el subset @real (smoke de flujos de dinero + gancho de grading contra el stack).
  grep: isReal ? /@real/ : undefined,
  // Deshace los cambios GLOBALES de entorno que el arnés necesita (hoy: el interruptor maestro
  // del gancho de grading). Corre cuando TODOS los workers terminaron — un `afterAll` no sirve:
  // corre por worker y apagaría el dial con otros workers todavía navegando.
  globalTeardown: './e2e/global-teardown.ts',
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
        command: useDevServer
          ? `npx next dev -p ${MOCK_PORT}`
          : `npx next build && npx next start -p ${MOCK_PORT}`,
        url: `http://localhost:${MOCK_PORT}/es`,
        // El build de producción entra en el presupuesto: 3 min no alcanzan para compilar.
        timeout: useDevServer ? 180_000 : 600_000,
        reuseExistingServer,
        env: { NEXT_PUBLIC_USE_MOCKS: 'true', NEXT_DIST_DIR: MOCK_DIST_DIR },
      },
});
