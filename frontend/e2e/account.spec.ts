import { test, expect, type Page } from '@playwright/test';
import { t } from './utils/i18n';
import {
  credentialsFor,
  harnessLimit,
  IS_REAL,
  loginAs,
  needsSeed,
  skipIfSeedMissing,
} from './utils/auth';

/**
 * Stream A · «Mi cuenta», contraseña y contraseña temporal BLOQUEANTE (contrato v1.67/v1.67.1;
 * DESIGN_SYSTEM §33.5–§33.8; ARCHITECTURE §4.47.7). Flujos F11 del encargo:
 *   1. login con temporal → página de contraseña del rol → cambio → aterrizaje por rol / `?next=`
 *   2. el perfil edita el nombre (y el aviso de nombre derivado desaparece al guardar)
 *   3. cuenta solo-Google: la página de contraseña NO tiene campos («Enviarme el enlace»)
 *   4. navegación §33.1/§33.2 y móvil 390 px sin desborde horizontal
 *   5. facturación (§33.6d): vacío → alta en línea → RFC enmascarado
 *
 * Etiquetado (techlead F2-1, `utils/auth.ts`): los flujos de temporal, el cambio normal y la
 * facturación están escritos de forma AGNÓSTICA y taggeados `@real`; contra el backend real usan los
 * ACTORES del seed (`customerTemp` / `operatorTemp`, `utils/env.ts`) y, si el seed no los sembró (o
 * su temporal ya se consumió en una corrida anterior), se SALTAN con la razón (`skipIfSeedMissing`).
 * `needsSeed` queda solo donde falta una fila concreta (usuario con `nameSource='derived'`);
 * `harnessLimit` donde el arnés no puede entrar (solo-Google: sin contraseña ni Google). Este spec ya
 * no usa `mockOnly`: ningún caso depende de un dato de fixture.
 *
 * ⚠ Orden: los casos del cliente temporal van en SERIE (mismo worker, en orden): el que solo mira el
 * rebote y «Cerrar sesión» va ANTES del que consume la temporal; el cambio «normal» va DESPUÉS y entra
 * con la definitiva. En mock cada caso tiene su localStorage limpio y el orden no importa.
 */

/** Contraseña definitiva que fija el flujo 1 (y con la que entra el cambio «normal» en real). */
const DEFINITIVA = 'definitiva-2026';

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth, 'sin desborde horizontal').toBeLessThanOrEqual(overflow.clientWidth);
}

async function loginWith(page: Page, email: string, password: string) {
  await page.goto('/es/login');
  await page.getByLabel(t('es', 'auth.email')).fill(email);
  await page.getByLabel(t('es', 'auth.password')).fill(password);
  await page.getByRole('button', { name: t('es', 'auth.loginCta') }).click();
}

/**
 * Login por formulario de un actor sembrado. Si el backend real contesta «Correo o contraseña
 * incorrectos» el actor no está (seed sin correr / temporal ya consumida): se salta con la razón.
 */
async function loginSeedActor(page: Page, role: 'customerTemp' | 'operatorTemp', password?: string) {
  const creds = credentialsFor(role);
  await loginWith(page, creds.email, password ?? creds.password);
  if (IS_REAL) {
    // Tres salidas posibles del login real: (a) 401 ⇒ el actor no está sembrado; (b) 200 CON bandera ⇒
    // aterriza en la página de contraseña (lo que este spec mide); (c) 200 SIN bandera ⇒ aterriza en el
    // home del rol: la temporal ya se consumió en una corrida anterior. (a) y (c) se saltan con la razón.
    const invalid = page.getByRole('alert').filter({ hasText: t('es', 'error.INVALID_CREDENTIALS') });
    await Promise.race([
      invalid.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined),
      page.waitForURL((u) => !/\/login$/.test(u.pathname), { timeout: 10_000 }).catch(() => undefined),
    ]);
    const landedOnPassword = /\/account\/password/.test(page.url());
    skipIfSeedMissing(
      !landedOnPassword,
      `${role} (${creds.email}) con mustChangePassword=true en seed-e2e.ts (83ec86e) — o su temporal ya se consumió en una corrida anterior: re-sembrar`,
    );
  }
  return creds;
}

async function changeTemporaryPassword(page: Page, current: string, next: string) {
  await page.getByLabel(t('es', 'auth.changePassword.temporaryLabel')).fill(current);
  await page.getByLabel(t('es', 'account.password.new'), { exact: true }).fill(next);
  await page.getByLabel(t('es', 'account.password.confirm'), { exact: true }).fill(next);
  await page.getByRole('button', { name: t('es', 'auth.changePassword.submit') }).click();
}

test.describe('cuenta · contraseña temporal bloqueante (§33.8) · cliente', () => {
  test.describe.configure({ mode: 'serial' });

  test('@real con la bandera activa, la tienda pública rebota (paso 3) y «Cerrar sesión» sale a /login', async ({ page }) => {
    // Sesión por API del actor con temporal (en mock: bandera inyectada por `loginAs`). No consume la
    // temporal: solo mira el rebote y la salida.
    if (IS_REAL) {
      const ok = await loginAs(page, 'customerTemp').then(() => true, () => false);
      skipIfSeedMissing(!ok, 'customerTemp con mustChangePassword=true en seed-e2e.ts (login por API falló)');
    } else {
      await loginAs(page, 'customerTemp');
    }
    await page.goto('/es/catalog');
    await expect(page).toHaveURL(/\/es\/account\/password\?next=%2Fcatalog&reason=required$/);
    await page.getByRole('button', { name: t('es', 'nav.logout') }).click();
    await expect(page).toHaveURL(/\/es\/login$/);
  });

  test('@real cliente con temporal: login → /account/password (sin «Continuar») → cambio → «Listo» → tienda', async ({ page }) => {
    const creds = await loginSeedActor(page, 'customerTemp');

    await expect(page).toHaveURL(/\/es\/account\/password$/);
    await expect(page.getByRole('heading', { level: 1, name: t('es', 'auth.changePassword.title') })).toBeVisible();
    await expect(page.getByText(t('es', 'auth.changePassword.body'))).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continuar', exact: true })).toHaveCount(0);
    // Sin «← Mi cuenta» en la PÁGINA (rebotaría). El header del rol sí se ve (§33.8): su «Mi cuenta» no cuenta.
    await expect(page.locator('main').getByRole('link', { name: /Mi cuenta/ })).toHaveCount(0);
    // Única otra salida: cerrar sesión.
    await expect(page.getByRole('button', { name: t('es', 'nav.logout') })).toBeVisible();

    // Temporal por temporal no es cambiarla (422 PASSWORD_SAME_AS_CURRENT).
    await changeTemporaryPassword(page, creds.password, creds.password);
    await expect(page.getByLabel(t('es', 'account.password.new'), { exact: true })).toHaveAttribute('aria-invalid', 'true');

    await changeTemporaryPassword(page, creds.password, DEFINITIVA);
    await expect(page.getByRole('status')).toHaveText(t('es', 'account.password.successTitle'));
    const done = page.getByRole('button', { name: t('es', 'auth.changePassword.done') });
    await expect(done).toBeFocused();
    await done.click();
    // Sin `next`, «Listo» aterriza en la cuenta del rol.
    await expect(page).toHaveURL(/\/es\/account$/);
    await expect(page.getByRole('heading', { level: 1, name: t('es', 'account.title') })).toBeVisible();
    // La bandera quedó en false: navegar a la tienda ya no rebota.
    await page.goto('/es/vault');
    await expect(page).toHaveURL(/\/es\/vault$/);
  });

  test('@real cuenta con contraseña: /account/password cambia y ofrece «Cambiar otra vez» sin redirigir', async ({ page }) => {
    // En real entra el actor ya con su definitiva (el caso anterior la fijó): cambiar la contraseña del
    // `customer` compartido revocaría la sesión que usan los demás workers. En mock, cualquier cliente.
    const creds = IS_REAL ? { ...credentialsFor('customerTemp'), password: DEFINITIVA } : credentialsFor('customer');
    await loginWith(page, creds.email, creds.password);
    if (IS_REAL) {
      const invalid = page.getByRole('alert').filter({ hasText: t('es', 'error.INVALID_CREDENTIALS') });
      const missing = await Promise.race([
        invalid.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true, () => false),
        page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 10_000 }).then(() => false, () => false),
      ]);
      skipIfSeedMissing(missing, 'customerTemp con la definitiva del caso anterior (el flujo de temporal no corrió)');
    }
    await page.goto('/es/account/password');
    await expect(page.getByRole('heading', { level: 1, name: t('es', 'account.password.changeTitle') })).toBeVisible();
    await page.getByLabel(t('es', 'account.password.current')).fill(creds.password);
    await page.getByLabel(t('es', 'account.password.new'), { exact: true }).fill('nueva-larga-2026');
    await page.getByLabel(t('es', 'account.password.confirm'), { exact: true }).fill('nueva-larga-2026');
    await page.getByRole('button', { name: t('es', 'account.password.submit') }).click();
    await expect(page.getByRole('status')).toHaveText(t('es', 'account.password.successTitle'));
    await expect(page.getByRole('button', { name: t('es', 'account.password.changeAgain') })).toBeVisible();
    await expect(page).toHaveURL(/\/es\/account\/password$/);
  });
});

test.describe('cuenta · contraseña temporal bloqueante (§33.8) · operador', () => {
  test('@real operador con temporal y marcador de /admin/m4: rebote con banner y next → cambio → «Listo» → M4', async ({ page }) => {
    const creds = await loginSeedActor(page, 'operatorTemp');
    await expect(page).toHaveURL(/\/es\/admin\/account\/password$/);

    // Paso 3 de §33.8: cualquier módulo rebota a la página de contraseña con next + reason.
    await page.goto('/es/admin/m4');
    await expect(page).toHaveURL(/\/es\/admin\/account\/password\?next=%2Fadmin%2Fm4&reason=required$/);
    // `getByRole('alert')` también resuelve el route announcer de Next (vacío): se filtra por texto.
    await expect(page.getByRole('alert').filter({ hasText: t('es', 'auth.changePassword.requiredNotice') })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: t('es', 'auth.changePassword.title') })).toBeVisible();

    await changeTemporaryPassword(page, creds.password, DEFINITIVA);
    await page.getByRole('button', { name: t('es', 'auth.changePassword.done') }).click();
    await expect(page).toHaveURL(/\/es\/admin\/m4$/);
  });
});

test.describe('cuenta · perfil y contraseña (§33.6, §33.7)', () => {
  test('el perfil edita el nombre: con nombre derivado el aviso existe y desaparece al guardar', async ({ page }) => {
    needsSeed('un usuario LOCAL con nameSource=derived (no está en la lista del seed: temporal / solo-Google / pedido de invitado)');
    await loginAs(page, 'customer');
    await page.addInitScript(() => {
      const raw = window.localStorage.getItem('tcg.user');
      if (raw) {
        window.localStorage.setItem(
          'tcg.user',
          JSON.stringify({ ...JSON.parse(raw), name: 'jcsainz95', authProvider: 'google', nameSource: 'derived', hasPassword: true }),
        );
      }
    });
    await page.goto('/es/account');
    await expect(page.getByRole('heading', { level: 1, name: t('es', 'account.title') })).toBeVisible();
    const note = page.getByTestId('name-derived-note');
    await expect(note).toHaveText(t('es', 'account.profile.name.derivedFromEmail'));
    const name = page.getByLabel(t('es', 'account.profile.name.label'));
    await expect(name).toHaveValue('jcsainz95');
    await name.fill('Juan Carlos Sainz');
    await page.getByRole('button', { name: t('es', 'account.save') }).first().click();
    await expect(page.getByRole('status').filter({ hasText: t('es', 'account.saved') })).toBeVisible();
    await expect(note).toHaveCount(0);
    // Persistió en la sesión local (espejo del 200 del contrato).
    const stored = await page.evaluate(() => JSON.parse(window.localStorage.getItem('tcg.user') ?? '{}'));
    expect(stored.name).toBe('Juan Carlos Sainz');
    expect(stored.nameSource).toBe('user');
  });

  test('cuenta solo-Google: sin formulario de crear; «Enviarme el enlace» y ENLACE ENVIADO', async ({ page }) => {
    harnessLimit('una cuenta solo-Google no tiene contraseña y el arnés no tiene Google: no hay forma de obtener su sesión contra el backend real');
    await loginAs(page, 'customer');
    await page.addInitScript(() => {
      const raw = window.localStorage.getItem('tcg.user');
      if (raw) window.localStorage.setItem('tcg.user', JSON.stringify({ ...JSON.parse(raw), authProvider: 'google', hasPassword: false }));
    });
    await page.goto('/es/account');
    await expect(page.getByText(t('es', 'account.password.summaryNone'))).toBeVisible();
    await page.getByRole('link', { name: t('es', 'account.password.goCreate') }).click();
    await expect(page).toHaveURL(/\/es\/account\/password$/);
    await expect(page.getByRole('heading', { level: 1, name: t('es', 'account.password.createTitle') })).toBeVisible();
    await expect(page.getByLabel(t('es', 'account.password.current'))).toHaveCount(0);
    await expect(page.getByLabel(t('es', 'account.password.new'), { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: t('es', 'account.password.createSend') }).click();
    await expect(page.getByRole('status')).toHaveText(t('es', 'account.password.createSentTitle'));
  });

  test('@real facturación (§33.6d): vacío «Sin datos de facturación» → alta en línea → RFC enmascarado y «Editar»', async ({ page }) => {
    await loginAs(page, 'customer');
    await page.goto('/es/account');
    const section = page.getByRole('region', { name: t('es', 'account.billing.title') });
    await expect(section).toBeVisible();
    // Sin perfil (404 ⇒ null): el vacío con su CTA, NUNCA seis «—» con «Editar». Con perfil (una corrida
    // real anterior lo dejó): «Editar». Las dos entradas llevan al mismo formulario en línea.
    const add = section.getByRole('button', { name: t('es', 'account.billing.add') });
    const edit = section.getByRole('button', { name: t('es', 'account.billing.edit') });
    await expect(add.or(edit)).toBeVisible();
    if (await add.isVisible()) {
      await expect(section.getByText(t('es', 'account.billing.emptyTitle'))).toBeVisible();
      await expect(section.locator('dd', { hasText: '—' })).toHaveCount(0);
      await add.click();
    } else {
      await edit.click();
    }
    await section.getByLabel(t('es', 'account.billing.rfc')).fill('xaxx010101000');
    await section.getByLabel(t('es', 'account.billing.razonSocial')).fill('Ash Ketchum');
    await section.getByLabel(t('es', 'account.billing.regimenFiscal')).fill('612');
    await section.getByLabel(t('es', 'account.billing.usoCfdi')).fill('G03');
    await section.getByLabel(t('es', 'account.billing.postalCode')).fill('06600');
    await section.getByRole('button', { name: t('es', 'account.save') }).click();
    await expect(section.getByRole('status')).toHaveText(t('es', 'account.saved'));
    // `rfcMasked` (contrato v1.67.1): 3 en claro + un `*` por carácter restante. Nunca el RFC en claro.
    await expect(section.getByText('XAX**********')).toBeVisible();
    await expect(section.getByText('XAXX010101000')).toHaveCount(0);
    await expect(edit).toBeVisible();
  });
});

test.describe('cuenta · navegación (§33.1, §33.2) y móvil', () => {
  test('@real header con sesión: cinco entradas, sin nombre ni «Cerrar sesión»; «Mi cuenta» → /account', async ({ page }) => {
    await loginAs(page, 'customer');
    await page.goto('/es/catalog');
    const header = page.locator('header');
    const nav = header.getByRole('navigation').first();
    await expect(nav.getByRole('link')).toHaveText([
      t('es', 'nav.buy'),
      t('es', 'nav.buylist'),
      t('es', 'nav.vault'),
      t('es', 'nav.ordersAndSales'),
      t('es', 'nav.myAccount'),
    ]);
    await expect(header.getByRole('button', { name: t('es', 'nav.logout') })).toHaveCount(0);
    await nav.getByRole('link', { name: t('es', 'nav.myAccount') }).click();
    await expect(page).toHaveURL(/\/es\/account$/);
    // «Cerrar sesión» vive en la última sección de la cuenta.
    await expect(page.getByRole('button', { name: t('es', 'nav.logout') })).toBeVisible();
  });

  test('@real topbar del panel: «Mi cuenta» → /admin/account con perfil, correo, contraseña y sesión (sin libreta/CFDI/KYC)', async ({ page }) => {
    await loginAs(page, 'operator');
    await page.goto('/es/admin');
    await page.getByRole('link', { name: t('es', 'nav.myAccount') }).click();
    await expect(page).toHaveURL(/\/es\/admin\/account$/);
    await expect(page.getByRole('heading', { level: 2, name: t('es', 'account.profile.title') })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: t('es', 'account.password.title') })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: t('es', 'account.addresses.title') })).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 2, name: t('es', 'account.billing.title') })).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 2, name: t('es', 'account.kyc.title') })).toHaveCount(0);
  });

  test('móvil 390×844: /account y /account/password sin desborde horizontal; inputs a 16px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAs(page, 'customer');
    await page.goto('/es/account');
    await expect(page.getByRole('heading', { level: 1, name: t('es', 'account.title') })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    const fontSize = await page.getByLabel(t('es', 'account.profile.name.label')).evaluate((el) => getComputedStyle(el).fontSize);
    expect(parseFloat(fontSize)).toBeGreaterThanOrEqual(16);
    await page.goto('/es/account/password');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
