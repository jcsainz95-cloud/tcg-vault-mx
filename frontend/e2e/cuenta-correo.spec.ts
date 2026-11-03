import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { t } from './utils/i18n';
import { credentialsFor, IS_REAL, reserveLoginSlot } from './utils/auth';

/**
 * §CTA — cuenta con solo el correo, «Ingresar a cuenta», «Termina tu cuenta» y franja de confianza (API_CONTRACT §CTA,
 * criterios 945, 969–977). Todos los casos son `@real` y corren en los DOS mundos con el mismo recorrido; solo cambia
 * de dónde sale el dato:
 *  - mocks: el simulador de `lib/api.ts` (`MOCK_TAKEN_EMAIL_RE` da el `409`; un token sin «invalid/used» canjea);
 *  - real: el backend del stack. El `409` lo da la cuenta sembrada `customer`; el token de «Termina tu cuenta» se lee
 *    del CORREO que el stack captura: sin `RESEND_API_KEY` el backend usa `NoopMailAdapter`, que escribe el cuerpo
 *    del correo (con el enlace) en su log en `debug` (`backend/src/modules/mail/noop-mail.adapter.ts`). La ruta del log
 *    es `E2E_BACKEND_LOG` o `<repo>/.native-stack/backend.log` (la de `scripts/stack-native.sh`). ⛔ Si no se puede
 *    leer, el caso FALLA diciendo por qué: no se finge un token.
 * El throttler `signup` (5/min por IP, compartido con `register`) cuenta las altas de este fichero: tres por corrida.
 */

const REPO_ROOT = resolve(__dirname, '..', '..');
const BACKEND_LOG = process.env.E2E_BACKEND_LOG ?? resolve(REPO_ROOT, '.native-stack', 'backend.log');

function uniqueEmail(tag: string): string {
  return `cta-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.local`;
}

/**
 * `which`: CTA-E1 paga (en real crea una sesión de pago que aparta la pieza) ⇒ usa la PRIMERA teja; CTA-E2 entra con la
 * cuenta sembrada y mide que su carrito siga igual ⇒ usa la ÚLTIMA, para no chocar con una pieza que E1 dejó apartada
 * (medido: 2/6 rojas con la misma teja, «ya no está disponible y se quitó de tu carrito»).
 */
async function addCardToCart(page: Page, which: 'first' | 'last' = 'first') {
  await page.goto('/es/catalog');
  const buttons = page.getByRole('button', { name: t('es', 'catalog.addToCart') });
  await (which === 'first' ? buttons.first() : buttons.last()).click();
}

/** El enlace «Termina tu cuenta» del último correo a `email`, leído del log del backend (real). */
async function accountSetupLinkFromMail(email: string): Promise<string> {
  if (!existsSync(BACKEND_LOG)) {
    throw new Error(
      `No encuentro el log del backend en ${BACKEND_LOG}: sin él no hay correo que leer. Define E2E_BACKEND_LOG con la ruta del log del stack (NoopMailAdapter).`,
    );
  }
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const log = readFileSync(BACKEND_LOG, 'utf8');
    const at = log.lastIndexOf(`to=${email} `);
    if (at >= 0) {
      const m = /https?:\/\/[^\s"<>]+\/(?:es|en)\/account-setup\?token=[A-Za-z0-9_\-.~%]+/.exec(log.slice(at));
      if (m) return m[0];
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(
    `El log ${BACKEND_LOG} no trae un enlace /account-setup para ${email} en 15 s. ¿El backend corre con NoopMailAdapter y logger en debug?`,
  );
}

/** Abre el alta con solo el correo desde la línea T4 del carrito (criterio 46) y la envía. */
async function signUpEmailOnlyFromT4(page: Page, email: string) {
  await page.getByRole('button', { name: 'crea una cuenta', exact: true }).click();
  const panel = page.locator('#identity-panel');
  await expect(panel.locator('input[type="password"]')).toHaveCount(0);
  await panel.getByLabel(t('es', 'auth.email'), { exact: true }).fill(email);
  await panel.getByRole('button', { name: t('es', 'auth.registerCta') }).click();
}

test.describe('§CTA · cuenta con solo el correo', () => {
  test('@real CTA-E1 upsell de bóveda: solo el correo, cuenta creada, destino bóveda y PAGAR sin aviso de verificar (48, 969, CTA-F3)', async ({
    page,
  }) => {
    await addCardToCart(page);
    await page.goto('/es/checkout');
    const email = uniqueEmail('e1');
    await page.getByLabel(t('es', 'checkout.guest.email.label'), { exact: true }).fill(email);
    await page
      .getByRole('region', { name: t('es', 'checkout.destination.eyebrow') })
      .getByRole('button', { name: `${t('es', 'checkout.destination.vault')} ${t('es', 'checkout.destination.vaultRequiresAccount')}` })
      .click();
    const upsell = page.getByTestId('vault-upsell');
    await expect(upsell).toBeVisible();
    // 969: UN campo (el correo, ya escrito) + la leyenda del 504; nada de contraseña, nombre ni celular.
    await expect(upsell.locator('form input:not([type="hidden"])')).toHaveCount(1);
    await expect(upsell.getByLabel(t('es', 'auth.email'), { exact: true })).toHaveValue(email);
    await expect(upsell.getByTestId('privacy-site-register')).toBeVisible();
    await upsell.getByRole('button', { name: t('es', 'checkout.vaultUpsell.cta') }).click();

    // La vista conmuta al checkout con cuenta, con el carrito y destino bóveda (48).
    await expect(page.getByText(t('es', 'checkout.vaultUpsell.created'))).toBeVisible();
    await expect(page.getByTestId('amount-breakdown')).toBeVisible();
    // §CTA.5: comprar ya no exige correo verificado ⇒ ni el aviso global ni el del 403 en el carrito.
    await expect(page.getByText(t('es', 'verifyEmail.bannerTitle'))).toHaveCount(0);

    // En mocks no hay red: el simulador responde sin `fetch`. En real se espera la respuesta del servidor.
    const session = IS_REAL
      ? page.waitForResponse((r) => /\/checkout\/session$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST', {
          timeout: 15_000,
        })
      : null;
    await page.getByRole('button', { name: /Pagar/ }).click();
    if (session) {
      // Sin la llave de prueba de Stripe el stack responde 503 PAYMENT_PROVIDER_UNAVAILABLE; lo que se mide aquí es que
      // el servidor YA NO responde 403 EMAIL_NOT_VERIFIED a una cuenta sin verificar (§CTA.5, CTA-B5).
      const res = await session;
      expect(res.status(), 'POST /checkout/session de una cuenta recién nacida').not.toBe(403);
    }
    await expect(page.getByText(t('es', 'verifyEmail.blockedTitle'))).toHaveCount(0);
  });

  test('@real CTA-E2 correo con cuenta ⇒ «Ingresar a cuenta» con el correo puesto; entra y el carrito sigue (970, CTA-F2)', async ({
    page,
  }) => {
    await addCardToCart(page, 'last');
    await page.goto('/es/checkout');
    const cartIds = () => page.evaluate(() => JSON.parse(window.localStorage.getItem('tcg.cart') ?? '{}').ids ?? []);
    const before = await cartIds();
    expect(before.length).toBeGreaterThan(0);
    const taken = IS_REAL ? credentialsFor('customer') : { email: 'taken-e2e@dominio.com', password: 'cualquiera' };
    await signUpEmailOnlyFromT4(page, taken.email);

    await expect(page.getByText(t('es', 'auth.emailOnly.taken'))).toBeVisible();
    const enter = page.getByRole('button', { name: t('es', 'auth.emailOnly.login') });
    await expect(page.getByRole('button', { name: t('es', 'auth.forgotPassword') })).toBeVisible();
    await enter.click();
    const panel = page.locator('#identity-panel');
    await expect(panel.getByLabel(t('es', 'auth.email'), { exact: true })).toHaveValue(taken.email);
    await expect(panel.getByLabel(t('es', 'auth.password'), { exact: true })).toBeFocused();
    await panel.getByLabel(t('es', 'auth.password'), { exact: true }).fill(taken.password);
    if (IS_REAL) await reserveLoginSlot('cuenta-correo · Ingresar a cuenta');
    await panel.getByRole('button', { name: t('es', 'auth.loginCta') }).click();

    // Con sesión, el mismo /checkout con el carrito intacto (no navegó a otra página).
    await expect(page.locator('#identity-panel')).toHaveCount(0);
    await expect(page).toHaveURL(/\/es\/checkout$/);
    await expect(page.getByTestId('amount-breakdown')).toBeVisible();
    expect(await cartIds()).toEqual(before);
  });

  test('@real CTA-E3 «Termina tu cuenta» con el enlace del correo: token fuera de la URL, sin Referer, nombre y contraseña, y entra (971, CTA-F4/F8)', async ({
    page,
  }) => {
    await addCardToCart(page);
    await page.goto('/es/checkout');
    const email = uniqueEmail('e3');
    await signUpEmailOnlyFromT4(page, email);
    await expect(page.locator('#identity-panel')).toHaveCount(0);

    const link = IS_REAL ? await accountSetupLinkFromMail(email) : `/es/account-setup?token=tok-mock-valido-${Date.now()}`;
    const path = IS_REAL ? new URL(link).pathname + new URL(link).search : link;
    const token = new URL(path, 'http://x').searchParams.get('token')!;

    // Sale la sesión del alta: el cliente abre el correo en cualquier navegador.
    await page.evaluate(() => window.localStorage.clear());
    const res = await page.goto(path);
    expect(res?.headers()['referrer-policy']).toBe('no-referrer');
    await expect(page.getByRole('heading', { name: t('es', 'accountSetup.title') })).toBeVisible();
    await expect.poll(() => page.url()).not.toContain(token);
    expect(new URL(page.url()).pathname).toBe('/es/account-setup');

    const password = `Cta-${Date.now()}`;
    await page.getByLabel(t('es', 'accountSetup.name'), { exact: true }).fill('Cliente E2E');
    await page.getByLabel(t('es', 'accountSetup.password'), { exact: true }).fill(password);
    await page.getByLabel(t('es', 'accountSetup.confirm'), { exact: true }).fill(password);
    await page.getByRole('button', { name: t('es', 'accountSetup.submit') }).click();
    await expect(page.getByText(t('es', 'accountSetup.successTitle'))).toBeVisible();

    // El enlace sirve UNA vez (971). En mocks el simulador no recuerda tokens: se usa uno marcado como usado.
    await page.goto(IS_REAL ? path : '/es/account-setup?token=used-mock');
    await page.getByLabel(t('es', 'accountSetup.name'), { exact: true }).fill('Otra vez');
    await page.getByLabel(t('es', 'accountSetup.password'), { exact: true }).fill(password);
    await page.getByLabel(t('es', 'accountSetup.confirm'), { exact: true }).fill(password);
    await page.getByRole('button', { name: t('es', 'accountSetup.submit') }).click();
    await expect(page.getByText(t('es', 'accountSetup.invalidTitle'))).toBeVisible();

    // Entra con correo + la contraseña nueva (973).
    await page.goto('/es/login');
    await page.getByLabel(t('es', 'auth.emailOrUsername'), { exact: true }).fill(email);
    await page.getByLabel(t('es', 'auth.password'), { exact: true }).fill(password);
    if (IS_REAL) await reserveLoginSlot('cuenta-correo · entrar tras «Termina tu cuenta»');
    await page.getByRole('button', { name: t('es', 'auth.loginCta') }).click();
    await expect(page).not.toHaveURL(/\/login/);
    const stored = await page.evaluate(() => JSON.parse(window.localStorage.getItem('tcg.user') ?? 'null'));
    expect(stored?.email).toBe(email);
  });
});

test.describe('§CTA · franja de confianza y cabeceras', () => {
  /**
   * 945 + DESIGN_SYSTEM §CTA-UX.1 (vCTA-1, petición 2), medido en navegador a 360×740 (el ancho de ux-ui era aritmética,
   * NO MEDIDO) y a 320×568. Candados, en los dos anchos:
   *  (b) `scrollWidth ≤ innerWidth` (página y franja) y **ningún renglón empieza con «·»**: el carácter visible anterior
   *      a cada «·» está en el MISMO renglón;
   *  (c) cada enlace mide ≥ 44 px de alto.
   * Por qué también 320: medido (2026-11-03), a 360 los dos datos CABEN en un renglón (≈ 300 px de 320), así que ahí
   * ningún separador cae en un salto y (b) no podría morder; a 320 (280 px útiles) los datos parten y el «·» queda en
   * el borde, que es lo que (b) vigila.
   * Además deja anotado (no es candado) cuánto miden WhatsApp e Instagram y si caben juntos en un renglón.
   * Mutaciones: el « ·» pegado al segundo dato (abre renglón a 320 ⇒ (b) rojo); `min-h-[44px]` fuera ⇒ (c) rojo.
   */
  test('@real 945 · franja en la ficha y el carrito: tarjeta, plazo, WhatsApp e Instagram; sin OXXO; a 360 y 320 px sin desborde, sin «·» abriendo renglón y enlaces de 44 px (CTA-UX.1)', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto('/es/catalog');
    const tile = page.locator('a[href*="/catalog/"]').first();
    await tile.click();
    await expect(page).toHaveURL(/\/catalog\/[^/?]+/);
    const ficha = new URL(page.url()).pathname;
    await page.getByRole('button', { name: t('es', 'catalog.addToCart') }).first().click();
    const combos = [360, 320].flatMap((width) => (['ficha', 'carrito'] as const).map((where) => ({ width, where })));
    for (const { width, where } of combos) {
      const height = width === 360 ? 740 : 568;
      await page.setViewportSize({ width, height });
      await page.goto(where === 'ficha' ? ficha : '/es/checkout');
      const strip = page.getByRole('group', { name: t('es', 'about.strip.groupLabel') }).first();
      await expect(strip, where).toBeVisible();
      await expect(strip).toHaveAttribute('data-testid', 'about-strip');
      await expect(strip).toContainText('tarjeta');
      await expect(strip).toContainText('4 a 10 días hábiles');
      await expect(strip).not.toContainText(/oxxo/i);
      const newTab = t('es', 'about.strip.newTab');
      const wa = strip.getByRole('link', { name: `WhatsApp 55 6489 3921${newTab}`, exact: true });
      const ig = strip.getByRole('link', { name: `Instagram @tcghunt.mx${newTab}`, exact: true });
      await expect(wa).toHaveAttribute('href', 'https://wa.me/525564893921');
      await expect(ig).toHaveAttribute('href', 'https://www.instagram.com/tcghunt.mx/');

      // (b) sin desborde: la página y la propia franja.
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${where} ${width}: scrollWidth − innerWidth`).toBeLessThanOrEqual(0);
      const own = await strip.evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(own, `${where} ${width}: la franja desborda su caja`).toBeLessThanOrEqual(0);

      // (b) ningún renglón empieza con «·»: por cada «·», el carácter visible anterior comparte renglón con él.
      const dots = await strip.evaluate((root) => {
        const chars: { ch: string; node: Text; i: number }[] = [];
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
          const el = n.parentElement!;
          if (el.closest('.sr-only')) continue;
          for (let i = 0; i < n.data.length; i++) chars.push({ ch: n.data[i], node: n, i });
        }
        const rectOf = (c: { node: Text; i: number }) => {
          const r = document.createRange();
          r.setStart(c.node, c.i);
          r.setEnd(c.node, c.i + 1);
          const rects = r.getClientRects();
          return rects.length ? rects[0] : null;
        };
        const out: { opensRow: boolean; dotTop: number; prevTop: number | null; prev: string }[] = [];
        chars.forEach((c, k) => {
          if (c.ch !== '·') return;
          const dot = rectOf(c)!;
          let j = k - 1;
          while (j >= 0 && /\s/.test(chars[j].ch)) j--;
          const prev = j >= 0 ? rectOf(chars[j]) : null;
          const opensRow = !prev || Math.abs(prev.top - dot.top) > 2;
          out.push({ opensRow, dotTop: dot.top, prevTop: prev?.top ?? null, prev: j >= 0 ? chars[j].ch : '' });
        });
        return out;
      });
      expect(dots.length, `${where}: separadores «·»`).toBeGreaterThan(0);
      for (const d of dots) expect(d.opensRow, `${where} ${width}: un «·» abre renglón ${JSON.stringify(d)}`).toBe(false);

      // (c) enlaces de 44 px.
      const links = strip.getByRole('link');
      const n = await links.count();
      expect(n).toBe(3);
      for (let i = 0; i < n; i++) {
        const box = await links.nth(i).boundingBox();
        expect(box!.height, `${where} ${width}: alto del enlace ${i}`).toBeGreaterThanOrEqual(44);
      }

      // Medición para ux-ui (no candado): ¿WhatsApp + Instagram caben en un renglón? ¿cuántos renglones de datos?
      const [waBox, igBox, stripBox] = [await wa.boundingBox(), await ig.boundingBox(), await strip.boundingBox()];
      testInfo.annotations.push({
        type: `CTA-UX.1 ${where} ${width}px`,
        description: JSON.stringify({
          strip: Math.round(stripBox!.width),
          whatsapp: Math.round(waBox!.width),
          instagram: Math.round(igBox!.width),
          sameRow: Math.abs(waBox!.y - igBox!.y) < 1,
          stripHeight: Math.round(stripBox!.height),
          dataRows: Math.round((await strip.locator('p').boundingBox())!.height / 16),
        }),
      });
    }
  });

  test('@real CTA-F8 · las tres páginas con token se sirven con Referrer-Policy: no-referrer; el resto, no', async ({ request }) => {
    for (const locale of ['es', 'en']) {
      for (const p of ['account-setup', 'reset-password', 'verify-email']) {
        const res = await request.get(`/${locale}/${p}?token=e2e-no-real`, { maxRedirects: 0 });
        expect(res.status(), `/${locale}/${p}`).toBe(200);
        expect(res.headers()['referrer-policy'], `/${locale}/${p}`).toBe('no-referrer');
      }
      const other = await request.get(`/${locale}/catalog`, { maxRedirects: 0 });
      expect(other.headers()['referrer-policy']).toBe('strict-origin-when-cross-origin');
    }
  });
});
