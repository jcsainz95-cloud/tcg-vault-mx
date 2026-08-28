import type { Page, APIRequestContext } from '@playwright/test';
import { test } from '@playwright/test';

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
 * IMPORTANTE-2 (QA) — POR QUÉ CAMBIÓ EL ENV-GATING
 *
 * Antes: `IS_REAL = process.env.E2E_REAL === '1'`. Pero `E2E_REAL` es, en
 * `playwright.config.ts`, la bandera de SELECCIÓN DE SPECS (`grep: /@real/`). Dos preguntas
 * distintas viajaban en la misma variable:
 *
 *   (a) ¿QUÉ specs corro?            → `E2E_REAL=1` ⇒ solo los `@real`.
 *   (b) ¿CONTRA QUÉ habla la APP?    → lo decide quién levantó el frontend.
 *
 * Consecuencia: el modo «suite COMPLETA contra el stack real» (`E2E_BASE_URL` puesto y
 * `E2E_REAL` ausente) — el que el runbook vende como la corrida más exigente, la que de
 * verdad contesta «¿frontend y backend concuerdan?» — autenticaba con el token INVENTADO
 * `'mock.session.token'` contra un frontend con `NEXT_PUBLIC_USE_MOCKS=false`. El backend
 * respondía 401, el interceptor limpiaba la sesión y redirigía a `/login`. Ese modo NO PODÍA
 * AUTENTICAR POR CONSTRUCCIÓN: no era un rojo de producto, era el arnés.
 *
 * Y no era solo local: `.github/workflows/e2e-real.yml` — el gate de CI que corre el smoke de
 * dinero contra el stack completo — fija `E2E_BASE_URL` y **NO** fija `E2E_REAL`. O sea que el
 * gate «real» también autenticaba con el token de mentira.
 *
 * Ahora la pregunta (b) se contesta con la fuente correcta: `playwright.config.ts` hornea
 * `NEXT_PUBLIC_USE_MOCKS=true` en UN solo lugar — el `webServer` que levanta él mismo, que
 * solo existe cuando `E2E_BASE_URL` está AUSENTE. Por lo tanto:
 *
 *   app levantada por Playwright (sin `E2E_BASE_URL`)  ⇒ MOCKS
 *   app levantada por devops/QA (con `E2E_BASE_URL`)   ⇒ BACKEND REAL
 *
 * `E2E_REAL=1` se sigue respetando (implica real) para no romper a quien ya lo usa, y
 * `E2E_MOCKS=1` es la escotilla explícita para el caso raro de una app externa servida con
 * fixtures. Las credenciales/emails viven SOLO aquí (o en `process.env`), no regadas por specs.
 * ─────────────────────────────────────────────────────────────────────────────────────
 */

/** Selección de specs (`playwright.config.ts` → `grep: /@real/`). NO decide cómo se autentica. */
const REAL_SUBSET_SELECTED = process.env.E2E_REAL === '1';

/**
 * La app bajo prueba la levantó alguien más (devops/QA/CI). Es el ÚNICO caso en el que el
 * `webServer` de mocks de `playwright.config.ts` no corre ⇒ la app habla con el backend real.
 */
const APP_IS_EXTERNAL = !!process.env.E2E_BASE_URL;

/** Escotilla explícita: app externa servida con fixtures (demo). Gana sobre todo lo demás. */
const FORCE_MOCK = process.env.E2E_MOCKS === '1';

/**
 * `true` si la APP bajo prueba habla con el backend REAL (y por tanto los tests deben
 * autenticar de verdad, y los oráculos deben ser los del seed, no los de los fixtures).
 */
export const IS_REAL = !FORCE_MOCK && (APP_IS_EXTERNAL || REAL_SUBSET_SELECTED);

/** Regex de estructura de moneda MXN (`MX$1,234.00`): asserts por FORMATO, no por monto de fixture. */
export const MONEY_RE = /MX\$[\d,]+\.\d{2}/;

export type SeedRole = 'customer' | 'admin' | 'operator';

/**
 * Credenciales del seed determinista (`backend/prisma/seed-e2e.ts`). Sobreescribibles por env
 * para no hornearlas si el seed cambia. `role` es el rol del contrato que espera el front.
 */
const CREDENTIALS: Record<SeedRole, { email: string; password: string; role: string }> = {
  customer: {
    email: process.env.E2E_CUSTOMER_EMAIL ?? 'customer@e2e.local',
    password: process.env.E2E_CUSTOMER_PASSWORD ?? 'Customer123!',
    role: 'customer',
  },
  admin: {
    email: process.env.E2E_ADMIN_EMAIL ?? 'admin@e2e.local',
    password: process.env.E2E_ADMIN_PASSWORD ?? 'Admin123!',
    role: 'super_admin',
  },
  operator: {
    email: process.env.E2E_OPERATOR_EMAIL ?? 'operator@e2e.local',
    password: process.env.E2E_OPERATOR_PASSWORD ?? 'Operator123!',
    role: 'vault_operator',
  },
};

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
 * Candidatos de la API real, en orden. `E2E_API_BASE_URL` gana siempre; si no está, se
 * PRUEBA `/health` (público) sobre el host del frontend en los puertos de los stacks conocidos.
 * Adivinar el puerto sería frágil; probarlo no lo es: se usa el primero que contesta salud.
 *   :3099 → `scripts/stack-native.sh` (stack nativo local, el que corre QA)
 *   :3011 → `docker-compose.staging.yml` / `.github/workflows/e2e-real.yml`
 *   :3001 → default de `frontend/src/lib/config.ts`
 */
const API_PORT_CANDIDATES = ['3099', '3011', '3001'];

function apiCandidates(): string[] {
  const explicit = process.env.E2E_API_BASE_URL;
  if (explicit) return [explicit];
  const appUrl = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
  let origin: URL;
  try {
    origin = new URL(appUrl);
  } catch {
    origin = new URL('http://localhost:3000');
  }
  return API_PORT_CANDIDATES.map((port) => `${origin.protocol}//${origin.hostname}:${port}/api/v1`);
}

/** Memo por worker: la resolución cuesta un par de GET y no cambia a media corrida. */
let resolvedApiBaseUrl: string | null = null;

/**
 * Resuelve la base de la API real probando `GET {base}/health` (endpoint público del contrato).
 * Si ninguna contesta, falla con un mensaje que dice exactamente qué hacer — mucho mejor que un
 * 401 misterioso tres asserts más adelante.
 */
async function resolveApiBaseUrl(request: APIRequestContext): Promise<string> {
  if (resolvedApiBaseUrl) return resolvedApiBaseUrl;
  const candidates = apiCandidates();
  for (const base of candidates) {
    try {
      const res = await request.get(`${base}/health`, { timeout: 5_000 });
      if (res.ok()) {
        resolvedApiBaseUrl = base;
        return base;
      }
    } catch {
      // Candidato caído/inexistente: se prueba el siguiente.
    }
  }
  throw new Error(
    `No se encontró la API real. Probé: ${candidates.join(', ')}. ` +
      `Levanta el stack (./scripts/stack-native.sh up) o fija E2E_API_BASE_URL=<url>/api/v1.`,
  );
}

interface InjectedSession {
  accessToken: string;
  refreshToken: string;
  user: Record<string, unknown>;
}

/**
 * Sesión REAL memoizada POR ROL y POR WORKER. Sin esto, cada test canjea credenciales por su
 * cuenta y el `ThrottlerGuard` del backend responde `429 RATE_LIMITED` a `/auth/login` a media
 * suite — un rojo del arnés disfrazado de rojo de producto, que es exactamente lo que este
 * encargo vino a quitar. Playwright aísla procesos por worker, así que el mapa es por worker:
 * 3 roles × N workers logins, no uno por test.
 *
 * TTL corto (10 min) contra el access token de 15 min del contrato (§1): una suite larga renueva
 * en vez de arrastrar un token vencido y volver a fabricar el bug del 401 silencioso.
 */
const SESSION_TTL_MS = 10 * 60 * 1000;
const sessionCache = new Map<SeedRole, { session: InjectedSession; at: number }>();

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
 * Canje de credenciales por `TokenPair` contra el backend real, con reintento ante `429`.
 * El throttler es una defensa legítima del producto (no se toca): el arnés se adapta esperando,
 * porque N workers arrancando a la vez son una ráfaga aunque cada uno entre una sola vez.
 */
async function loginViaApi(
  page: Page,
  apiBase: string,
  role: SeedRole,
  creds: { email: string; password: string },
): Promise<InjectedSession> {
  let last = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await page.request.post(`${apiBase}/auth/login`, {
      data: { email: creds.email, password: creds.password },
      headers: { 'Content-Type': 'application/json' },
    });
    if (res.ok()) {
      const body = (await res.json()) as InjectedSession;
      return { accessToken: body.accessToken, refreshToken: body.refreshToken, user: body.user };
    }
    last = `${res.status()} ${await res.text().catch(() => '')}`;
    if (res.status() !== 429) break;
    await page.waitForTimeout(1_000 * 2 ** attempt);
  }
  throw new Error(
    `loginAs('${role}') falló contra el backend real (${apiBase}): ${last}. ` +
      `¿Stack arriba y seed:synthetic corrido?`,
  );
}

/**
 * Autentica al usuario `role` de forma env-aware. DEBE llamarse ANTES de `page.goto`
 * (usa `addInitScript`, que aplica en la siguiente navegación).
 */
export async function loginAs(page: Page, role: SeedRole = 'customer'): Promise<InjectedSession> {
  const creds = CREDENTIALS[role];

  if (IS_REAL) {
    const cached = sessionCache.get(role);
    if (cached && Date.now() - cached.at < SESSION_TTL_MS) {
      await injectSession(page, cached.session);
      return cached.session;
    }
    // Login real: canjea credenciales por el TokenPair del contrato (§1 AuthResponse).
    const apiBase = await resolveApiBaseUrl(page.request);
    const session = await loginViaApi(page, apiBase, role, creds);
    sessionCache.set(role, { session, at: Date.now() });
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
 */
export function mockOnly(reason: string): void {
  test.skip(IS_REAL, `mock-only (dato de fixture): ${reason}`);
}

/**
 * Marca un test que SÍ está escrito de forma agnóstica al entorno pero que el **seed real no puede
 * satisfacer hoy**: no hay ninguna solicitud de buylist en cola, ninguna disputa abierta, ninguna
 * referencia de mercado para gradeadas… Pasaría tal cual el día que el seed siembre esa fila.
 *
 * Se distingue de `mockOnly` A PROPÓSITO: `mockOnly` dice «este test no puede correr contra un
 * backend real sin reescribirlo»; `needsSeed` dice «este test está bien y falta el DATO» — que es
 * una petición accionable a quien mantiene `backend/prisma/seed-e2e.ts`, no una limitación. Meter
 * las dos cosas en el mismo cajón volvería a esconder el hueco, que es de lo que trata este arreglo.
 */
export function needsSeed(reason: string): void {
  test.skip(IS_REAL, `falta dato en el seed real: ${reason}`);
}
