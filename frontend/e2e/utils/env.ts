import { clearStateByPrefix, clearTokenState, sharedOnce } from './state';

/**
 * Plumbing de ENTORNO de los E2E: qué backend hay detrás, con qué credenciales se entra y cómo
 * se le habla. **Sin ninguna importación de `@playwright/test`** a propósito: esto lo consumen
 * tanto los specs (vía `./auth`) como el `globalTeardown` de `playwright.config.ts`, que corre
 * fuera del runner y no puede cargar el módulo de test.
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

export type SeedRole = 'customer' | 'admin' | 'operator';

/**
 * Credenciales del seed determinista (`backend/prisma/seed-e2e.ts`). Sobreescribibles por env
 * para no hornearlas si el seed cambia. `role` es el rol del contrato que espera el front.
 */
export const CREDENTIALS: Record<SeedRole, { email: string; password: string; role: string }> = {
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

/** Memo por proceso: la resolución cuesta un par de GET y no cambia a media corrida. */
let resolvedApiBaseUrl: string | null = null;

/**
 * Resuelve la base de la API real probando `GET {base}/health` (endpoint público del contrato).
 * Si ninguna contesta, falla con un mensaje que dice exactamente qué hacer — mucho mejor que un
 * 401 misterioso tres asserts más adelante.
 */
export async function resolveApiBaseUrl(): Promise<string> {
  if (resolvedApiBaseUrl) return resolvedApiBaseUrl;
  const candidates = apiCandidates();
  for (const base of candidates) {
    try {
      const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(5_000) });
      if (res.ok) {
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

export interface InjectedSession {
  accessToken: string;
  refreshToken: string;
  user: Record<string, unknown>;
}

/**
 * Margen mínimo de vida que debe quedarle al access token para reutilizarlo. El contrato (§1)
 * lo emite a 15 min; con 3 min de colchón ningún test arranca con un token que caduque a mitad.
 */
const TOKEN_MIN_REMAINING_MS = 3 * 60 * 1000;

/** Techo de reutilización aunque el `exp` diera más: una corrida larga renueva, no arrastra. */
const SESSION_MAX_AGE_MS = 10 * 60 * 1000;

/** `exp` (epoch ms) del JWT, o `null` si no es un JWT legible. Sin verificar firma: solo caducidad. */
function tokenExpiryMs(accessToken: string): number | null {
  const payload = accessToken.split('.')[1];
  if (!payload) return null;
  try {
    const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: number };
    return typeof json.exp === 'number' ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * ¿La sesión cacheada sirve todavía? Se comprueba la caducidad REAL del token, no solo la edad
 * del archivo: así una corrida que reutiliza el estado de otra corrida reciente no arranca con
 * un token muerto y vuelve a fabricar el 401 silencioso que este helper vino a matar.
 */
function sessionIsFresh(session: InjectedSession, publishedAt: number): boolean {
  if (Date.now() - publishedAt > SESSION_MAX_AGE_MS) return false;
  const exp = tokenExpiryMs(session.accessToken);
  return exp === null ? true : exp - Date.now() > TOKEN_MIN_REMAINING_MS;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Canje de credenciales por `TokenPair` contra el backend real.
 *
 * Corre SIEMPRE dentro del candado de `sharedOnce`, así que es el único login de su rol en toda
 * la corrida. El reintento ante `429` se mantiene como red de seguridad para el caso en que otra
 * cosa (otra suite, un humano, un `curl` de QA) haya gastado el cupo de la ventana: seis intentos
 * con backoff exponencial cubren **más de 60 s**, que es la ventana COMPLETA del throttler
 * (`@Throttle({ ttl: 60_000, limit: 5 })`). El de antes —4 intentos, ~15 s— se rendía DENTRO de
 * la ventana: por eso «reintentaba, pero no lo suficiente».
 */
async function loginViaApi(
  apiBase: string,
  role: SeedRole,
  creds: { email: string; password: string },
): Promise<InjectedSession> {
  const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 32_000];
  let last = '';
  for (let attempt = 0; attempt < BACKOFF_MS.length; attempt++) {
    const res = await fetch(`${apiBase}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: creds.email, password: creds.password }),
    });
    if (res.ok) {
      const body = (await res.json()) as InjectedSession;
      return { accessToken: body.accessToken, refreshToken: body.refreshToken, user: body.user };
    }
    last = `${res.status} ${await res.text().catch(() => '')}`;
    // Solo el 429 es transitorio. Un 401 es credencial mala: reintentarlo solo gasta cupo.
    if (res.status !== 429) break;
    await sleep(BACKOFF_MS[attempt]);
  }
  throw new Error(
    `loginAs('${role}') falló contra el backend real (${apiBase}): ${last}. ` +
      `¿Stack arriba y seed:synthetic corrido?`,
  );
}

/**
 * Prefijo de TODA entrada de estado que contenga credenciales. Lo comparten `sessionKey` y
 * `clearSessions`: la purga de IMP-A se apoya en que ningún otro tipo de estado lo use.
 */
const SESSION_KEY_PREFIX = 'session:';

function sessionKey(apiBase: string, role: SeedRole, email: string): string {
  return `${SESSION_KEY_PREFIX}${apiBase}:${role}:${email}`;
}

/**
 * IMP-A (QA) — **borra del disco todos los `TokenPair` que la corrida dejó**.
 *
 * Lo llama el `globalTeardown`. No resuelve la API base ni habla con la red **a propósito**: el
 * caso en que más importa purgar es justamente aquel en que el stack se cayó a mitad, y un
 * teardown que necesitara la API para saber qué borrar dejaría los tokens ahí. Por eso la purga
 * es **por prefijo de la clave lógica** (ver `clearStateByPrefix`).
 *
 * Lo que se borra son ACCESS **y REFRESH** tokens reales del seed —incluido el de `super_admin`—
 * y con `E2E_BASE_URL` apuntando a staging serían los de staging. Que caduquen solos no es una
 * mitigación: el refresh renueva la sesión.
 *
 * Efecto colateral aceptado y declarado: si dos corridas comparten `E2E_STATE_DIR`, la que
 * termine primero invalida la caché de sesión de la otra, que volverá a hacer login (a lo sumo
 * 3 canjes). Aislar corridas concurrentes es para lo que existe `E2E_STATE_DIR`.
 */
export function clearSessions(): number {
  // Dos redes, y las dos hacen falta: por CLAVE (lo que esta corrida escribió) y por CONTENIDO
  // (los archivos que dejaron corridas anteriores a este arreglo, que no llevan la clave en el
  // sobre — son exactamente los `0644` que QA encontró y que nadie iba a limpiar nunca).
  return clearStateByPrefix(SESSION_KEY_PREFIX) + clearTokenState();
}

/**
 * ─────────────────────────────────────────────────────────────────────────────────────
 * SESIÓN REAL COMPARTIDA ENTRE WORKERS (bloqueante de QA: la suite en modo real no era
 * reproducible).
 *
 * Antes: `Map` a nivel de módulo ⇒ memoización POR WORKER. `fullyParallel: true` +
 * `workers: undefined` abre un worker por núcleo, así que los canjes contra `POST /auth/login`
 * eran `roles × núcleos`. El backend limita ese endpoint a **5/min por IP** y todos los workers
 * salen de la MISMA IP: desde dos núcleos la suite se comía su propio cupo y `loginAs('customer')`
 * moría con `429 RATE_LIMITED` — un rojo del ARNÉS que además dejaba el login del stack inservible
 * ~60 s para quien estuviera mirando en paralelo. El verde dependía de la máquina.
 *
 * Ahora: `sharedOnce` (candado de archivo + caché en disco). El canje ocurre **una vez por rol y
 * por corrida**; los demás workers esperan y reutilizan el mismo `TokenPair`. Cota dura de logins
 * por API = **3** (uno por rol), independiente del número de núcleos.
 *
 * El throttler NO se toca: es una defensa legítima del producto. Lo que se corrige es el arnés.
 * ─────────────────────────────────────────────────────────────────────────────────────
 */
export async function sessionFor(role: SeedRole = 'customer'): Promise<InjectedSession> {
  const creds = CREDENTIALS[role];
  const apiBase = await resolveApiBaseUrl();
  // La clave incluye la API y el email: cambiar de stack o de credenciales INVALIDA la caché,
  // en vez de reutilizar en silencio un token de otro entorno.
  return sharedOnce<InjectedSession>(sessionKey(apiBase, role, creds.email), {
    isFresh: sessionIsFresh,
    compute: () => loginViaApi(apiBase, role, creds),
    // El que espera puede quedarse hasta ~2.5 min: el que tiene el candado puede estar dentro del
    // backoff de 63 s del throttler. Rendirse antes solo cambiaría un 429 por un timeout.
    timeoutMs: 150_000,
  });
}

export interface ApiResult<T> {
  status: number;
  body: T;
}

/**
 * Llamada AUTENTICADA a la API real. Devuelve status + cuerpo sin lanzar, para que el llamador
 * pueda afirmar sobre códigos de error del contrato (409/422) igual que sobre los 200.
 */
export async function apiAs<T = unknown>(
  role: SeedRole,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  const apiBase = await resolveApiBaseUrl();
  const { accessToken } = await sessionFor(role);
  const res = await fetch(`${apiBase}${path}`, {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let parsed: unknown = undefined;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed as T };
}

/** Igual que `apiAs`, pero exige 2xx: el fallo se ve donde ocurre y con el cuerpo del backend. */
export async function apiAsOk<T = unknown>(
  role: SeedRole,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await apiAs<T>(role, method, path, body);
  if (res.status < 200 || res.status >= 300) {
    throw new Error(
      `${method} ${path} respondió ${res.status}: ${JSON.stringify(res.body)?.slice(0, 400)}`,
    );
  }
  return res.body;
}
