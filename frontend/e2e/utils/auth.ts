import type { Page } from '@playwright/test';
import { test } from '@playwright/test';
import {
  CREDENTIALS,
  IS_REAL,
  type InjectedSession,
  type SeedRole,
  sessionFor,
} from './env';

/**
 * Helper de autenticación para los E2E, ENV-AWARE (mock vs backend real).
 *
 * Problema que resuelve: los smoke de flujos de dinero (comprar/retirar/vender)
 * "verdes" corrían SIEMPRE en modo mock — un `addInitScript` inyectaba `tcg.user`
 * en localStorage sin autenticar contra el backend. Contra el stack real esos
 * flujos necesitan un token JWT verdadero (holdings, checkout/session, shipments,
 * buylist/requests están detrás de JwtAuthGuard). Este helper unifica ambos modos:
 *
 * - REAL: `POST {API}/auth/login` con credenciales sembradas (seed-e2e determinista) y
 *   persiste el `TokenPair`+`user` en localStorage con el MISMO shape que `persistSession`
 *   (`frontend/src/lib/api.ts`): `tcg.accessToken`, `tcg.refreshToken`, `tcg.user`. Así el
 *   `api-client` manda el Bearer real y el interceptor puede refrescar el token.
 * - MOCK: inyecta solo `tcg.user` (las ramas mock de `api.ts` no validan token; el user
 *   habilita el gating de UI, p. ej. crear solicitud).
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * IMPORTANTE-2 (QA) — POR QUÉ EL ENV-GATING VIVE EN `./env`
 *
 * `E2E_REAL` es, en `playwright.config.ts`, la bandera de SELECCIÓN DE SPECS (`grep: /@real/`).
 * Dos preguntas distintas viajaban en la misma variable:
 *
 *   (a) ¿QUÉ specs corro?            → `E2E_REAL=1` ⇒ solo los `@real`.
 *   (b) ¿CONTRA QUÉ habla la APP?    → lo decide quién levantó el frontend.
 *
 * La (b) se contesta con la fuente correcta: `playwright.config.ts` hornea
 * `NEXT_PUBLIC_USE_MOCKS=true` en UN solo lugar — el `webServer` que levanta él mismo, que
 * solo existe cuando `E2E_BASE_URL` está AUSENTE. Por lo tanto:
 *
 *   app levantada por Playwright (sin `E2E_BASE_URL`)  ⇒ MOCKS
 *   app levantada por devops/QA (con `E2E_BASE_URL`)   ⇒ BACKEND REAL
 *
 * `E2E_REAL=1` se sigue respetando (implica real) y `E2E_MOCKS=1` es la escotilla explícita
 * para una app externa servida con fixtures. Todo eso, más las credenciales y el canje de
 * token, vive en `./env` — que NO importa `@playwright/test` para que el `globalTeardown`
 * (que corre fuera del runner) pueda reutilizarlo.
 * ─────────────────────────────────────────────────────────────────────────────────────
 */

export { IS_REAL, sessionFor };
export type { SeedRole, InjectedSession };

/** Regex de estructura de moneda MXN (`MX$1,234.00`): asserts por FORMATO, no por monto de fixture. */
export const MONEY_RE = /MX\$[\d,]+\.\d{2}/;

/**
 * Credenciales del rol, para los specs que ESCRIBEN el formulario de login en vez de canjear el
 * token por API (p. ej. el smoke de «login se muestra y redirige»). Contra el stack real hay que
 * teclear credenciales que EXISTAN: si no, el formulario responde 401 y el test mide el arnés, no
 * el producto. En mock cualquier par sirve (la rama mock no valida).
 */
export function credentialsFor(role: SeedRole = 'customer'): { email: string; password: string } {
  const { email, password } = CREDENTIALS[role];
  return IS_REAL ? { email, password } : { email: 'cliente@example.com', password: 'secret123' };
}

/**
 * Persiste la sesión en localStorage ANTES de cargar la app (addInitScript corre en cada
 * navegación antes que los scripts de página). Espeja `persistSession` de `api.ts`.
 */
async function injectSession(page: Page, session: InjectedSession): Promise<void> {
  await page.addInitScript((s: InjectedSession) => {
    window.localStorage.setItem('tcg.accessToken', s.accessToken);
    window.localStorage.setItem('tcg.refreshToken', s.refreshToken);
    window.localStorage.setItem('tcg.user', JSON.stringify(s.user));
    // El rol admin/operador se refleja también en `tcg.role` (demo de máscara financiera).
    const role = (s.user as { role?: string }).role;
    if (role && role !== 'customer') window.localStorage.setItem('tcg.role', role);
  }, session);
}

/**
 * Autentica al usuario `role` de forma env-aware. DEBE llamarse ANTES de `page.goto`
 * (usa `addInitScript`, que aplica en la siguiente navegación).
 */
export async function loginAs(page: Page, role: SeedRole = 'customer'): Promise<InjectedSession> {
  const creds = CREDENTIALS[role];

  if (IS_REAL) {
    // Login real COMPARTIDO entre workers (ver `sessionFor` en `./env`): uno por rol y por
    // corrida, no uno por worker — que es lo que tumbaba la suite con `429 RATE_LIMITED`.
    const session = await sessionFor(role);
    await injectSession(page, session);
    return session;
  }

  // MOCK: sin backend, basta el `user` (las ramas mock de api.ts ignoran el token).
  const session: InjectedSession = {
    accessToken: 'mock.session.token',
    refreshToken: 'mock.refresh.token',
    user: {
      id: `u-e2e-${role}`,
      email: creds.email,
      name: `E2E ${role}`,
      role: creds.role,
      locale: 'es',
      status: 'active',
      authProvider: 'local',
      emailVerified: true,
    },
  };
  await injectSession(page, session);
  return session;
}

/**
 * Marca un test como MOCK-ONLY: depende de algo que SOLO existe en modo mock — datos literales de
 * `src/lib/mock/fixtures.ts` (una pieza `pending` Y otra `settled` a la vez, el folio INV-000110,
 * el bounty de MX$4,800.00) o una afordancia de DEMO (el switcher «Ver como», que en modo real no
 * se pinta porque el rol lo dicta el JWT). Contra el stack real nada de eso está prometido, así que
 * el test se SALTA CON SU RAZÓN IMPRESA en el reporte, en vez de pintar un rojo que no significa
 * nada. Un `skip` con motivo es una clasificación; 59 rojos indistinguibles no lo son.
 *
 * Regla (para no esconder bugs bajo la alfombra): esto es SOLO para dependencias de datos/afordancias
 * de mock. Copy, i18n, navegación, guardas, desgloses y cualquier cosa que el backend deba servir NO
 * son mock-only: si eso falla contra el stack real es un desacuerdo de verdad entre frontend y
 * backend y TIENE que verse rojo.
 *
 * ⚠️ Y NO es una escotilla para «no supe escribirlo agnóstico»: si el test se puede escribir contra
 * datos descubiertos (como el gancho de grading, que se siembra por API en `./grading`), se escribe
 * agnóstico y se etiqueta `@real`. Marcar mock-only algo verificable en real deja el gate vacío,
 * que es el bloqueante que QA levantó sobre `grading-estimate.spec.ts`.
 */
export function mockOnly(reason: string): void {
  test.skip(IS_REAL, `mock-only (dato de fixture): ${reason}`);
}

/**
 * Marca un test que SÍ está escrito de forma agnóstica al entorno pero que el **seed real no puede
 * satisfacer hoy**: no hay ninguna solicitud de buylist en cola, ninguna disputa abierta, ninguna
 * tercera carta raw publicada… Pasaría tal cual el día que el seed siembre esa fila.
 *
 * Se distingue de `mockOnly` A PROPÓSITO: `mockOnly` dice «este test no puede correr contra un
 * backend real sin reescribirlo»; `needsSeed` dice «este test está bien y falta el DATO» — que es
 * una petición accionable a quien mantiene `backend/prisma/seed-e2e.ts`, no una limitación. Meter
 * las dos cosas en el mismo cajón volvería a esconder el hueco, que es de lo que trata este arreglo.
 */
export function needsSeed(reason: string): void {
  test.skip(IS_REAL, `falta dato en el seed real: ${reason}`);
}

/** Inverso de `mockOnly`: el test solo tiene sentido contra el backend real (p. ej. un 409 del contrato). */
export function realOnly(reason: string): void {
  test.skip(!IS_REAL, `solo-real: ${reason}`);
}
