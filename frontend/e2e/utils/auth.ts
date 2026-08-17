import type { Page } from '@playwright/test';

/**
 * Helper de autenticación para los E2E, ENV-AWARE (mock vs backend real).
 *
 * Problema que resuelve: los smoke de flujos de dinero (comprar/retirar/vender)
 * "verdes" corrían SIEMPRE en modo mock — un `addInitScript` inyectaba `tcg.user`
 * en localStorage sin autenticar contra el backend. Contra el stack real esos
 * flujos necesitan un token JWT verdadero (holdings, checkout/session, shipments,
 * buylist/requests están detrás de JwtAuthGuard). Este helper unifica ambos modos:
 *
 * - REAL  (`E2E_REAL=1`): `POST {API}/auth/login` con credenciales sembradas
 *   (seed-e2e determinista) y persiste el `TokenPair`+`user` en localStorage con el
 *   MISMO shape que `persistSession` (`frontend/src/lib/api.ts`): `tcg.accessToken`,
 *   `tcg.refreshToken`, `tcg.user`. Así el `api-client` manda el Bearer real y el
 *   interceptor puede refrescar el token.
 * - MOCK  (por defecto): inyecta solo `tcg.user` (las ramas mock de `api.ts` no
 *   validan token; el user habilita el gating de UI, p. ej. crear solicitud).
 *
 * Las credenciales/emails viven SOLO aquí (o en `process.env`), no regadas por specs.
 */

/** `true` si los tests deben pegarle al backend REAL. Ver `playwright.config.ts` (grep @real). */
export const IS_REAL = process.env.E2E_REAL === '1';

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
 * Base de la API real. En el stack de staging el backend escucha en `:3011/api/v1`
 * (ver `docker-compose.staging.yml` / `e2e-real.yml`). Sobreescribible con `E2E_API_BASE_URL`.
 */
function apiBaseUrl(): string {
  return process.env.E2E_API_BASE_URL ?? 'http://localhost:3011/api/v1';
}

interface InjectedSession {
  accessToken: string;
  refreshToken: string;
  user: Record<string, unknown>;
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
    // Login real: canjea credenciales por el TokenPair del contrato (§1 AuthResponse).
    const res = await page.request.post(`${apiBaseUrl()}/auth/login`, {
      data: { email: creds.email, password: creds.password },
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok()) {
      throw new Error(
        `loginAs('${role}') falló contra el backend real: ${res.status()} ${await res
          .text()
          .catch(() => '')}. ¿Stack de staging arriba y seed:synthetic corrido?`,
      );
    }
    const body = (await res.json()) as InjectedSession;
    const session: InjectedSession = {
      accessToken: body.accessToken,
      refreshToken: body.refreshToken,
      user: body.user,
    };
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
