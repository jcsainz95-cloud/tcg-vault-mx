import { test, expect, type Page } from '@playwright/test';
import { t } from './utils/i18n';
import { IS_REAL, reserveChangePasswordSlot, reserveLoginSlot } from './utils/auth';
import { resolveApiBaseUrl, sessionForCredentials } from './utils/env';
import {
  disposeTempPasswordActor,
  provisionTempPasswordActor,
  type TempPasswordActor,
} from './utils/temp-actors';

/**
 * ─────────────────────────────────────────────────────────────────────────────────────
 * STF-17-E2E (`API_CONTRACT §M6-U.9`, criterio 263 de `PROJECT §U.4`, regla O-4) — el staff SIN
 * CORREO cambia su propia contraseña desde «Mi cuenta», de punta a punta, como lo recorre él.
 *
 * Los pasos del criterio, cada uno con su aserto (los números son los del criterio):
 *   (1) entra con USUARIO + contraseña por la pantalla de siempre (aquí, la temporal del alta: todo
 *       staff nace con `mustChangePassword: true`, P-STF-6 ⇒ primero la cambia por la definitiva);
 *   (2) desde el MENÚ del back-office (la barra de arriba) llega a «Mi cuenta» → «Cambiar contraseña»
 *       ⛔ sin teclear la dirección: cada salto es un clic sobre un enlace;
 *   (3) actual mala ⇒ marca el campo y NO cierra la sesión;
 *   (4) nueva igual a la actual ⇒ rechazada;
 *   (5) actual buena + nueva válida ⇒ guardada, la sesión sigue viva y otra sesión de la cuenta
 *       deja de servir;
 *   (6) sale y entra con la NUEVA ⇒ entra;
 *   (7) con la VIEJA ⇒ no entra.
 *   ⛔ Ningún «crear contraseña» ni «olvidé» dentro de «Mi cuenta» ni en su página de contraseña.
 *   «Ningún correo» no se ve desde el navegador: lo fija STF-17 de backend (`mail.send` = 0).
 *
 * Vale para `vault_operator` y `super_admin` sin correo ⇒ un caso por rol.
 *
 * MUTACIÓN NORMATIVA: quitar el enlace a `/admin/account` de `AdminTopbar.tsx` ⇒ el paso (2) no
 * encuentra «Mi cuenta» DENTRO DE LA BARRA (`banner`) y el caso sale ROJO. El localizador está
 * acotado a la barra a propósito: el «← Mi cuenta» de la página de contraseña o el pie del cajón
 * móvil no pueden salvarlo.
 *
 * DOS ENTORNOS, UN CASO (ningún salto por entorno: el censo `e2e-skip-census` no crece).
 *   · REAL: el actor nace en esta corrida por `POST /admin/users` (alta de equipo SIN correo, con
 *     `username` desechable, `utils/temp-actors.ts`) y se borra al acabar.
 *   · MOCK: entra `ana`/`jefa` (`MOCK_STAFF_USERNAMES`, `lib/api.ts`). La navegación (1)–(5) y la
 *     mutación del menú se miden IGUAL — que es lo que la corrida de mocks de cada PR tiene que
 *     vigilar. Lo que el mock no puede servir, porque no guarda contraseñas ni sesiones, va dentro de
 *     `if (IS_REAL)` y lo dice: la sesión viva por `GET /users/me` en (3) y (5), la otra sesión que
 *     muere en (5), y los logins de (6) y (7).
 *
 * Cupos del producto (5/min/IP cada uno), respetados por el arnés: por rol, CUATRO `POST /auth/login`
 * (temporal, otra sesión por API, nueva, vieja) y CUATRO `POST /auth/change-password` (temporal →
 * definitiva, actual mala, igual, buena). Por eso el `setTimeout` de abajo: puede tocar esperar una
 * ventana del throttler, y ⛔ los asertos no se aflojan.
 * ─────────────────────────────────────────────────────────────────────────────────────
 */

const DEFINITIVA = 'definitiva-stf17-2026';
const NUEVA = 'nueva-stf17-larga-2026';
const MALA = 'wrong-actual-stf17';

/** En mock no hay alta: entra la cuenta sin correo del servidor falso. */
const MOCK_STAFF: Record<StaffKind, { email: string; password: string }> = {
  vault_operator: { email: 'ana', password: 'temporal-ana' },
  super_admin: { email: 'jefa', password: 'temporal-jefa' },
};

type StaffKind = 'vault_operator' | 'super_admin';

async function submitLogin(page: Page, identifier: string, password: string, label: string) {
  await page.goto('/es/login');
  await page.getByLabel(t('es', 'auth.emailOrUsername')).fill(identifier);
  await page.getByLabel(t('es', 'auth.password'), { exact: true }).fill(password);
  if (IS_REAL) await reserveLoginSlot(`staff-without-email · ${label}`);
  await page.getByRole('button', { name: t('es', 'auth.loginCta') }).click();
}

async function submitPasswordForm(page: Page, current: string, next: string, currentLabel: string, submit: string, label: string) {
  await page.getByLabel(currentLabel).fill(current);
  await page.getByLabel(t('es', 'account.password.new'), { exact: true }).fill(next);
  await page.getByLabel(t('es', 'account.password.confirm'), { exact: true }).fill(next);
  if (IS_REAL) await reserveChangePasswordSlot(`staff-without-email · ${label}`);
  await page.getByRole('button', { name: submit }).click();
}

/** `GET /users/me` con el token que la PÁGINA tiene guardado: ¿sigue viva esta sesión? */
async function meStatusOfPage(page: Page): Promise<number> {
  const token = await page.evaluate(() => window.localStorage.getItem('tcg.accessToken'));
  return meStatus(token ?? '');
}

async function meStatus(accessToken: string): Promise<number> {
  const apiBase = await resolveApiBaseUrl();
  const res = await fetch(`${apiBase}/users/me`, { headers: { Authorization: `Bearer ${accessToken}` } });
  return res.status;
}

async function logoutFromTopbar(page: Page) {
  await page.getByRole('banner').getByRole('button', { name: t('es', 'nav.logout') }).click();
  await expect(page).toHaveURL(/\/es\/login$/);
}

/** Dentro de «Mi cuenta» y de su página de contraseña no hay «crear» ni «olvidé». */
async function expectNoCreateNorForgot(page: Page) {
  await expect(page.locator('main a[href*="forgot-password"]')).toHaveCount(0);
  await expect(page.getByRole('main').getByText(t('es', 'account.password.goCreate'), { exact: true })).toHaveCount(0);
  await expect(page.getByRole('main').getByText(t('es', 'account.password.createTitle'), { exact: true })).toHaveCount(0);
  await expect(page.getByRole('main').getByText(t('es', 'auth.forgotPassword'))).toHaveCount(0);
}

for (const kind of ['vault_operator', 'super_admin'] as const) {
  test.describe(`STF-17-E2E · ${kind} sin correo · contraseña desde Mi cuenta`, () => {
    let actor: TempPasswordActor | null = null;

    test.beforeAll(async () => {
      if (IS_REAL) actor = await provisionTempPasswordActor(kind);
    });

    test.afterAll(async () => {
      await disposeTempPasswordActor(actor);
      actor = null;
    });

    test(`@real ${kind}: usuario → menú → Mi cuenta → Cambiar contraseña → (3)…(7)`, async ({ page }) => {
      test.setTimeout(IS_REAL ? 300_000 : 90_000);
      const creds = IS_REAL ? { email: actor!.email, password: actor!.password } : MOCK_STAFF[kind];
      // Un usuario, no un correo: si el alta devolviera un correo, este ciclo no mide lo que dice.
      expect(creds.email).not.toContain('@');

      // ── (1) Entra con su USUARIO. Con la temporal del alta, la pantalla de siempre lo manda a
      //     crear su definitiva; «Listo» lo deja en el panel.
      // M-5 (QA sobre da6d910e): con la temporal pendiente el panel pinta su menú, pero ⛔ no pide
      // nada que el servidor vaya a negar con `403 PASSWORD_CHANGE_REQUIRED` (antes: el contador
      // de «Pedidos por preparar»). En mock no hay red: la lista queda vacía y no mide (lo mide la
      // Vitest de `AdminShell.mustChange`).
      const deniedWhileTemporary: string[] = [];
      const onResponse = (r: import('@playwright/test').Response) => {
        if (r.status() === 403) deniedWhileTemporary.push(`${r.request().method()} ${new URL(r.url()).pathname}`);
      };
      page.on('response', onResponse);
      await submitLogin(page, creds.email, creds.password, '(1) temporal');
      await expect(page).toHaveURL(/\/es\/admin\/account\/password$/);
      await expect(page.getByRole('heading', { level: 1, name: t('es', 'auth.changePassword.title') })).toBeVisible();
      // El menú ya está montado (su contador se pediría al montar).
      await expect(page.getByRole('navigation').getByRole('link', { name: t('es', 'admin.modules.m4') }).first()).toBeVisible();
      await page.waitForLoadState('networkidle');
      page.off('response', onResponse);
      expect(deniedWhileTemporary, 'M-5: nada denegado con la temporal pendiente').toEqual([]);
      await submitPasswordForm(
        page,
        creds.password,
        DEFINITIVA,
        t('es', 'auth.changePassword.temporaryLabel'),
        t('es', 'auth.changePassword.submit'),
        '(1) temporal → definitiva',
      );
      await page.getByRole('button', { name: t('es', 'auth.changePassword.done') }).click();
      await expect(page).toHaveURL(/\/es\/admin\/account$/);

      // ── (2) Desde el MENÚ, sin teclear direcciones: al «Resumen» por el menú lateral, y de ahí
      //     «Mi cuenta» en la barra de arriba y «Cambiar contraseña» en su sección.
      await page.getByRole('navigation').getByRole('link', { name: t('es', 'admin.modules.dashboard'), exact: true }).first().click();
      await expect(page).toHaveURL(/\/es\/admin$/);
      await page.getByRole('banner').getByRole('link', { name: t('es', 'nav.myAccount') }).click();
      await expect(page).toHaveURL(/\/es\/admin\/account$/);
      await expect(page.getByRole('heading', { level: 1, name: t('es', 'account.title') })).toBeVisible();
      await expect(page.getByText(t('es', 'account.usernameLine', { username: creds.email }))).toBeVisible();
      await expectNoCreateNorForgot(page);
      await page.getByRole('link', { name: t('es', 'account.password.goChange') }).click();
      await expect(page).toHaveURL(/\/es\/admin\/account\/password$/);
      await expect(page.getByRole('heading', { level: 1, name: t('es', 'account.password.changeTitle') })).toBeVisible();
      await expectNoCreateNorForgot(page);

      const currentField = page.getByLabel(t('es', 'account.password.current'));
      const submit = t('es', 'account.password.submit');

      // ── (3) Actual mala ⇒ el campo «Contraseña actual» queda marcado y la sesión sigue.
      await submitPasswordForm(page, MALA, NUEVA, t('es', 'account.password.current'), submit, '(3) actual mala');
      await expect(currentField).toHaveAttribute('aria-invalid', 'true');
      await expect(page).toHaveURL(/\/es\/admin\/account\/password$/);
      await expect(page.getByRole('status').filter({ hasText: t('es', 'account.password.successTitle') })).toHaveCount(0);
      if (IS_REAL) expect(await meStatusOfPage(page), '(3) la sesión NO se cierra con la actual mala').toBe(200);

      // ── (4) Nueva igual a la actual ⇒ rechazada, con su texto, bajo «Contraseña nueva».
      await submitPasswordForm(page, DEFINITIVA, DEFINITIVA, t('es', 'account.password.current'), submit, '(4) igual');
      await expect(page.getByText(t('es', 'account.password.sameAsCurrent'))).toBeVisible();
      await expect(page.getByLabel(t('es', 'account.password.new'), { exact: true })).toHaveAttribute('aria-invalid', 'true');
      await expect(page.getByRole('status').filter({ hasText: t('es', 'account.password.successTitle') })).toHaveCount(0);

      // ── (5) Actual buena + nueva válida ⇒ guardada; esta sesión vive y OTRA de la cuenta muere.
      //     La otra sesión se abre por API ANTES del cambio, con la contraseña vigente.
      const other = IS_REAL ? await sessionForCredentials(`STF-17-E2E otra sesión (${kind})`, { email: creds.email, password: DEFINITIVA }) : null;
      if (other) expect(await meStatus(other.accessToken), '(5) la otra sesión sirve antes del cambio').toBe(200);
      await submitPasswordForm(page, DEFINITIVA, NUEVA, t('es', 'account.password.current'), submit, '(5) cambio bueno');
      await expect(page.getByRole('status').filter({ hasText: t('es', 'account.password.successTitle') })).toBeVisible();
      await expect(page.getByText(t('es', 'account.password.successOtherSessions'))).toBeVisible();
      if (IS_REAL) {
        expect(await meStatusOfPage(page), '(5) ESTA sesión sigue viva').toBe(200);
        expect(await meStatus(other!.accessToken), '(5) la OTRA sesión deja de servir').toBe(401);
      }
      // La sesión del navegador sigue operando el panel: «Mi cuenta» por el menú otra vez.
      await page.getByRole('banner').getByRole('link', { name: t('es', 'nav.myAccount') }).click();
      await expect(page.getByRole('heading', { level: 1, name: t('es', 'account.title') })).toBeVisible();

      if (IS_REAL) {
        // ── (6) Sale y entra con la NUEVA ⇒ entra al panel.
        await logoutFromTopbar(page);
        await submitLogin(page, creds.email, NUEVA, '(6) nueva');
        await expect(page).toHaveURL(/\/es\/admin$/);

        // ── (7) Sale y prueba con la VIEJA ⇒ no entra: se queda en el login con el texto de usuario.
        await logoutFromTopbar(page);
        await submitLogin(page, creds.email, DEFINITIVA, '(7) vieja');
        await expect(page.getByRole('alert').filter({ hasText: t('es', 'auth.invalidCredentialsUsername') })).toBeVisible();
        await expect(page).toHaveURL(/\/es\/login$/);
      }
    });
  });
}
