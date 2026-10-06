import { test, expect, type Page, type Route } from '@playwright/test';
import { t } from './utils/i18n';
import { realOnly } from './utils/auth';

/**
 * LIVE-2 pantalla, de punta a punta en el navegador (API_CONTRACT v1.84 §14.2 «Frontend», v1.84.2 §14.15
 * E2-4; DESIGN_SYSTEM §81; FRONTEND_NOTES §103). @real
 *
 * Recorre lo que vive el usuario: tiene sesión guardada, abre una ruta privada (tienda `/account`, panel
 * `/admin`), la API responde `401`, el interceptor pide `POST /auth/refresh` y el backend contesta
 * `401 UNAUTHENTICATED` con `details.reason: 'session_max_age'` ⇒ el guard de hoy lo manda al login con
 * `?next=` y el login termina en `?next=…&reason=session_max_age` con «Tu sesión caducó por seguridad».
 *
 * La API se FINGE con `page.route` (los dos `401`): alcanzar el tope real exige un token de 30/7 días de
 * antigüedad, y lo que se mide aquí es la pantalla, no el backend (el tope lo prueban sus unitarios e
 * integración). Por eso necesita el bundle que habla con una API (`NEXT_PUBLIC_USE_MOCKS` apagado): en
 * el bundle de mocks `api.ts` no llama a `fetch` y no hay `401` que interceptar ⇒ `realOnly`.
 */

const API = /\/api\/v1\//;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
};

async function fakeApi(page: Page, refreshDetails: Record<string, unknown> | undefined) {
  const calls: string[] = [];
  await page.route(API, async (route: Route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const path = new URL(req.url()).pathname;
    calls.push(`${req.method()} ${path}`);
    const error: Record<string, unknown> = { code: 'UNAUTHENTICATED', message: 'Unauthenticated' };
    if (path.endsWith('/auth/refresh') && refreshDetails) error.details = refreshDetails;
    if (path.endsWith('/auth/login')) {
      return route.fulfill({
        status: 401,
        headers: CORS,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' } }),
      });
    }
    return route.fulfill({ status: 401, headers: CORS, contentType: 'application/json', body: JSON.stringify({ error }) });
  });
  return calls;
}

/** Sesión guardada UNA vez (no en cada navegación: el `401` la vacía y no debe resucitar). */
async function seedSession(page: Page, role: 'customer' | 'super_admin') {
  await page.addInitScript((r) => {
    if (window.sessionStorage.getItem('e2e.sma.seeded')) return;
    window.sessionStorage.setItem('e2e.sma.seeded', '1');
    window.localStorage.setItem('tcg.accessToken', 'e2e.access.token');
    window.localStorage.setItem('tcg.refreshToken', 'e2e.refresh.token');
    window.localStorage.setItem(
      'tcg.user',
      JSON.stringify({ id: 'u-sma', email: 'sma@example.com', name: 'SMA', role: r, locale: 'es' }),
    );
  }, role);
}

const ES = t('es', 'auth.sessionMaxAgeLogout');

test.describe('LIVE-2 · login tras el tope absoluto de sesión @real', () => {
  test.beforeEach(() => {
    realOnly('necesita el bundle que llama a la API (sin mocks) para que exista el 401 del refresh');
  });

  for (const { label, role, path, next } of [
    { label: 'tienda', role: 'customer' as const, path: '/es/account', next: '/account' },
    { label: 'panel', role: 'super_admin' as const, path: '/es/admin', next: '/admin' },
  ]) {
    test(`UX-SMA-2 · ${label}: 401 del refresh con reason ⇒ /login?next=${next}&reason=session_max_age con el aviso`, async ({ page }) => {
      const calls = await fakeApi(page, { reason: 'session_max_age' });
      await seedSession(page, role);
      await page.goto(path);

      await expect(page).toHaveURL((u) => u.pathname === '/es/login' && u.searchParams.get('reason') === 'session_max_age');
      expect(new URL(page.url()).searchParams.get('next')).toBe(next);
      expect(calls.some((c) => c === 'POST /api/v1/auth/refresh')).toBe(true);

      const notice = page.getByText(ES, { exact: true });
      await expect(notice).toBeVisible();
      await expect(page.getByRole('status').filter({ hasText: ES })).toHaveCount(1);
      await expect(page.getByRole('alert').filter({ hasText: ES })).toHaveCount(0);
      // Sesión vaciada como hoy.
      expect(await page.evaluate(() => window.localStorage.getItem('tcg.refreshToken'))).toBeNull();

      // UX-SMA-4: desaparece al primer intento y no vuelve aunque falle.
      await page.getByLabel(t('es', 'auth.emailOrUsername')).fill('a@b.com');
      await page.getByLabel(t('es', 'auth.password')).fill('secret123');
      await page.getByRole('button', { name: t('es', 'auth.loginCta') }).click();
      // (Filtrado por texto: Next pinta además su `#__next-route-announcer__` con role="alert".)
      await expect(page.getByRole('alert').filter({ hasText: t('es', 'error.INVALID_CREDENTIALS') })).toBeVisible();
      await expect(notice).toHaveCount(0);
    });
  }

  test('UX-SMA-3 · 401 del refresh SIN reason ⇒ el login de hoy (solo next, sin aviso)', async ({ page }) => {
    await fakeApi(page, undefined);
    await seedSession(page, 'customer');
    await page.goto('/es/account');
    await expect(page).toHaveURL((u) => u.pathname === '/es/login' && u.searchParams.get('next') === '/account');
    await expect(page.getByRole('heading', { name: t('es', 'auth.loginTitle') })).toBeVisible();
    // Margen para que un replace tardío (si lo hubiera) aterrice antes de afirmar su ausencia.
    await page.waitForTimeout(1_000);
    expect(new URL(page.url()).searchParams.get('reason')).toBeNull();
    await expect(page.getByText(ES, { exact: true })).toHaveCount(0);
  });

  test('UX-SMA-1 · recargar /login?reason=session_max_age lo vuelve a pintar (EN)', async ({ page }) => {
    await page.goto('/en/login?next=%2Fvault&reason=session_max_age');
    await expect(page.getByRole('status').filter({ hasText: t('en', 'auth.sessionMaxAgeLogout') })).toBeVisible();
  });
});
