import { describe, expect, it } from 'vitest';
import es from '../../messages/es.json';
import en from '../../messages/en.json';

/**
 * CTA-UX.6 petición 1 (DESIGN_SYSTEM §CTA-UX.2–4, vCTA-1): los textos marcados **cambia** y las tres claves nuevas,
 * tal como los fijó ux-ui, en ES y EN. Un texto que vuelve al de antes (p. ej. «Entra con tu contraseña», que una
 * cuenta pendiente no tiene) pone esto rojo. Mutación: devolver cualquiera de estas claves a su valor anterior.
 */
type Messages = typeof es;
const get = (m: Messages, path: string): unknown =>
  path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], m);

const EXPECTED: Record<string, { es: string; en: string }> = {
  // §CTA-UX.2
  'auth.emailOnly.hint': {
    es: 'Solo tu correo. Te mandamos un enlace para ponerle contraseña a tu cuenta.',
    en: "Just your email. We'll send you a link to set a password.",
  },
  'auth.emailOnly.taken': {
    es: 'Ese correo ya tiene una cuenta. Ingresa y sigue con tu compra: tu carrito no cambia.',
    en: "That email already has an account. Sign in and keep going: your cart doesn't change.",
  },
  'auth.emailOnly.login': { es: 'Ingresar a cuenta', en: 'Sign in to your account' },
  // §CTA-UX.3
  'accountSetup.subtitle': {
    es: 'Dinos tu nombre y elige una contraseña. Después entras con tu correo y esa contraseña.',
    en: 'Tell us your name and choose a password. Then you sign in with your email and that password.',
  },
  'accountSetup.blocked': {
    es: 'Esta cuenta está bloqueada. Escríbenos y te ayudamos.',
    en: "This account is blocked. Contact us and we'll help.",
  },
  'accountSetup.genericError': { es: 'No se pudo completar. Inténtalo de nuevo.', en: "Couldn't save. Try again." },
  'accountSetup.goToLogin': { es: 'Entrar', en: 'Sign in' },
  'accountSetup.sendAnother': { es: 'Mandar otro', en: 'Send another' },
  // §CTA-UX.4
  'account.password.setupTitle': { es: 'Ponle contraseña a tu cuenta', en: 'Set a password for your account' },
  'account.password.setupSummary': {
    es: 'Tu cuenta aún no tiene contraseña. Ponle una para entrar con tu correo desde cualquier lugar.',
    en: "Your account doesn't have a password yet. Set one to sign in with your email from anywhere.",
  },
  'account.password.setupBody': {
    es: 'Tu cuenta nació solo con tu correo, así que no te pedimos una contraseña actual. Elige tu contraseña; el nombre es opcional.',
    en: "Your account was created with just your email, so we don't ask for a current password. Choose a password; the name is optional.",
  },
  'account.password.setupNameHint': { es: 'Cómo quieres que te llamemos.', en: "What you'd like us to call you." },
  'account.email.correctOpen': { es: 'Corregir mi correo', en: 'Correct my email' },
  // §CTA-UX.1
  'about.strip.groupLabel': { es: 'Pago, entrega y contacto', en: 'Payment, delivery and contact' },
  'about.strip.newTab': { es: ' (se abre en otra pestaña)', en: ' (opens in a new tab)' },
};

describe('CTA-UX.6 (1) · textos de §CTA-UX en ES y EN', () => {
  it.each(Object.entries(EXPECTED))('%s', (path, want) => {
    expect(get(es, path)).toBe(want.es);
    expect(get(en, path)).toBe(want.en);
  });

  it('paridad de claves en los namespaces que tocó §CTA-UX', () => {
    for (const ns of ['auth.emailOnly', 'accountSetup', 'about.strip', 'account.email', 'account.password']) {
      const a = Object.keys(get(es, ns) as object).sort();
      const b = Object.keys(get(en, ns) as object).sort();
      expect(b, ns).toEqual(a);
    }
  });

  /** CTA-UX.5 / petición 5: la nota «con IVA incluido, igual que nuestro precio de venta» no se usaba y sale. */
  it('referenceExplainerWithMarket ya no existe en ningún idioma', () => {
    expect(JSON.stringify(es)).not.toContain('referenceExplainerWithMarket');
    expect(JSON.stringify(en)).not.toContain('referenceExplainerWithMarket');
  });
});
