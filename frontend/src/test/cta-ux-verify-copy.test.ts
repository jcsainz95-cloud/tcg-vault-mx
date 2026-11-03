import { describe, expect, it } from 'vitest';
import es from '../../messages/es.json';
import en from '../../messages/en.json';

/**
 * Candados de copy de la verificación de correo y de la entrada (DESIGN_SYSTEM §CTA-UX.3b y §CTA-UX.6 peticiones 8 y 9).
 * Mutaciones: devolver «comprar»/“buy” a cualquier texto de verificación (9); devolver «Log in» a cualquier clave de
 * `en.json` (8).
 */
type Tree = { [k: string]: string | Tree };
function strings(o: unknown, prefix: string): Array<[string, string]> {
  if (typeof o === 'string') return [[prefix, o]];
  if (o && typeof o === 'object') {
    return Object.entries(o as Tree).flatMap(([k, v]) => strings(v, prefix ? `${prefix}.${k}` : k));
  }
  return [];
}
const get = (m: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], m);

/** Los textos «de verificación»: lo que la cuenta lee sobre verificar su correo (aviso, página, Mi cuenta, 403). */
const VERIFY_SCOPES = ['verifyEmail', 'verifyEmailPage', 'account.email', 'error.EMAIL_NOT_VERIFIED'];

describe('CTA-UX.6 (9) · ningún texto de verificación promete «comprar» (comprar no exige verificar, §CTA.5)', () => {
  it.each([
    ['es', es, /\bcompr\w*/i],
    ['en', en, /\b(buy\w*|purchas\w*)/i],
  ] as const)('%s', (_l, messages, forbidden) => {
    const offenders = VERIFY_SCOPES.flatMap((scope) => strings(get(messages, scope), scope)).filter(([, v]) =>
      forbidden.test(v),
    );
    expect(offenders).toEqual([]);
  });

  it('los ámbitos existen (un candado sobre nada no muerde)', () => {
    for (const scope of VERIFY_SCOPES) {
      expect(strings(get(es, scope), scope).length).toBeGreaterThan(0);
      expect(strings(get(en, scope), scope).length).toBeGreaterThan(0);
    }
  });

  it.each([
    ['account.email.unverifiedBody', 'Verifica tu correo para vender, retirar y ver tus pedidos anteriores.', 'Verify your email to sell, withdraw and see your earlier orders.'],
    ['verifyEmail.bannerBody', 'Verifica tu correo para vender, retirar y ver tus pedidos anteriores.', 'Verify your email to sell, withdraw and see your earlier orders.'],
    ['verifyEmail.successBody', 'Ya puedes vender, retirar y ver tus pedidos anteriores.', 'You can now sell, withdraw and see your earlier orders.'],
    ['account.email.resendSetupCta', 'Reenviar enlace para terminar tu cuenta', 'Resend the link to finish your account'],
    ['verifyEmail.resendCta', 'Reenviar correo de verificación', 'Resend verification email'],
  ])('%s con el texto de §CTA-UX.6 (9)', (path, esText, enText) => {
    expect(get(es, path)).toBe(esText);
    expect(get(en, path)).toBe(enText);
  });
});

describe('CTA-UX.6 (8) · regla EN única: «Sign in», nunca «Log in»', () => {
  it('ningún texto de en.json dice «log in» (en cualquier caja)', () => {
    // Las etiquetas de texto enriquecido (`<login>…</login>`) son nombres de clave, no texto visible.
    const offenders = strings(en, '').filter(([, v]) => /\blog\s?in\b/i.test(v.replace(/<\/?[\w-]+>/g, ' ')));
    expect(offenders).toEqual([]);
  });

  it.each([
    ['auth.loginTitle', 'Sign in'],
    ['auth.sessionMaxAgeLogout', 'Your session expired for security reasons. Sign in again.'],
    ['accountSetup.successBody', 'Your account is complete. Sign in with your email and your password.'],
    ['wishlist.guest.login', 'Sign in to add it'],
    ['wishlist.mailAction.invalidHint', 'Sign in to check your wishlist.'],
  ])('las cinco claves nombradas por ux-ui: %s', (path, want) => {
    expect(get(en, path)).toBe(want);
  });

  it('ES no cambia: «Iniciar sesión» sigue en auth.loginTitle', () => {
    expect(get(es, 'auth.loginTitle')).toBe('Iniciar sesión');
  });
});
