import {
  ctaRows,
  eyebrowRow,
  headingRow,
  mailShell,
  proseRow,
  smallPrintRow,
  spacerRow,
} from '../buylist/mail-shell';
import { MailMessage } from './mail.port';

/**
 * Plantillas bilingües (ES/EN) de los correos transaccionales. ARCHITECTURE §4.11.
 * El texto vive en el backend porque el correo se envía server-side (a diferencia de la UI,
 * que se traduce en el front). Se elige el idioma por `User.locale` (default ES).
 */

type Locale = 'es' | 'en';

function normalizeLocale(locale?: string | null): Locale {
  return locale === 'en' ? 'en' : 'es';
}

// P-21 (rebrand): marca visible "TCG HUNT" (DESIGN_SYSTEM §17.4 — mayúsculas, con espacio).
const BRAND = 'TCG HUNT';

/**
 * P-MAIL-MARCA (2026-10-06) — los tres correos de cuenta van sobre el esqueleto de marca de
 * `DESIGN_SYSTEM §31` (`mailShell`): mismo bloque de marca, retícula, pie en tinta y fila «Aviso de
 * privacidad» (criterio 507) que los demás. Es el «pase 2» de §31.15. El escape de HTML lo hacen los
 * builders del esqueleto (S15-B1): aquí todo entra como TEXTO PLANO.
 *
 * ⚠️ `audience` queda en su defecto `'customer'` en los tres: son correos **mixtos** (pueden ir a un
 * cliente o a un empleado) y `API_CONTRACT §14.18` E5-1 dice que un mixto **es de cliente** y lleva el pie.
 */
function accountEyebrow(l: Locale): string {
  // §31.9 filas 7 y 8: `SEGURIDAD DE LA CUENTA` sin folio (§31.13.16: no se inventa un identificador).
  return eyebrowRow(l === 'en' ? 'ACCOUNT SECURITY' : 'SEGURIDAD DE LA CUENTA');
}

/** §31.6h — la línea del «por qué recibes esto» de los correos de cuenta. */
function accountFooterWhy(l: Locale): string {
  return l === 'en'
    ? `You are receiving this email because this address is linked to a ${BRAND} account.`
    : `Recibes este correo porque esta dirección está ligada a una cuenta de ${BRAND}.`;
}

function accountMail(l: Locale, title: string, preheader: string, body: string[]): string {
  return mailShell({
    locale: l,
    title,
    preheader,
    blocks: [accountEyebrow(l), headingRow(title, 22), spacerRow(24), ...body],
    footerWhy: accountFooterWhy(l),
  });
}

/**
 * v1.67 (§4.47.5): saludo con o SIN nombre. `name` llega ya decidido por `greetingName()` (null ⇒ el
 * nombre es derivado o vacío y no se afirma). Devuelve TEXTO PLANO: en el HTML lo escapa `proseRow`
 * (S15-B1 — `User.name` lo controla el usuario).
 */
function greeting(l: Locale, name: string | null): string {
  if (l === 'en') return name === null ? 'Hi,' : `Hi ${name},`;
  return name === null ? 'Hola:' : `Hola ${name}:`;
}

/**
 * `name`: el que decidió `greetingName()` — `string` para saludar con nombre, `null` para saludar sin
 * él (v1.67, nombre derivado). Los llamadores antiguos que pasan un `string` siguen funcionando.
 *
 * El enlace abre una PÁGINA del front (`/<locale>/verify-email?token=`), que consume el token con un
 * `POST`: ⛔ el correo nunca lleva un GET que actúe. `ctaRows` emite el botón y, debajo, la URL en
 * texto (el respaldo de §31.6g); la frase «copia esta URL» va justo antes del botón.
 */
export function emailVerificationTemplate(link: string, name: string | null, locale?: string | null): MailMessage {
  const l = normalizeLocale(locale);
  const hi = greeting(l, name);
  if (l === 'en') {
    const intro = `Confirm your email address to unlock buying, withdrawing and selling on ${BRAND}.`;
    return {
      to: '', // lo fija MailService
      subject: 'Verify your email',
      html: accountMail(l, 'Verify your email', intro, [
        proseRow(hi),
        spacerRow(16),
        proseRow(intro),
        spacerRow(24),
        smallPrintRow("This link expires in 24 hours. If the button doesn't work, copy this URL:"),
        spacerRow(24),
        ctaRows(link, 'VERIFY EMAIL', 'ink'),
      ]),
      text: `${hi}\n\nVerify your email for ${BRAND} (link expires in 24 hours):\n${link}\n\nIf you didn't create an account, ignore this message.`,
    };
  }
  const intro = `Confirma tu correo para poder comprar, retirar y vender en ${BRAND}.`;
  return {
    to: '',
    subject: 'Verifica tu correo',
    html: accountMail(l, 'Verifica tu correo', intro, [
      proseRow(hi),
      spacerRow(16),
      proseRow(intro),
      spacerRow(24),
      smallPrintRow('Este enlace caduca en 24 horas. Si el botón no funciona, copia esta URL:'),
      spacerRow(24),
      ctaRows(link, 'VERIFICAR CORREO', 'ink'),
    ]),
    text: `${hi}\n\nVerifica tu correo en ${BRAND} (el enlace caduca en 24 horas):\n${link}\n\nSi no creaste una cuenta, ignora este mensaje.`,
  };
}

/** El enlace abre la PÁGINA `/<locale>/reset-password?token=` (el cambio es un `POST` desde ella). */
export function passwordResetTemplate(link: string, name: string | null, locale?: string | null): MailMessage {
  const l = normalizeLocale(locale);
  const hi = greeting(l, name);
  if (l === 'en') {
    const intro = `We received a request to reset your ${BRAND} password.`;
    return {
      to: '',
      subject: 'Reset your password',
      html: accountMail(l, 'Reset your password', intro, [
        proseRow(hi),
        spacerRow(16),
        proseRow(intro),
        spacerRow(32),
        ctaRows(link, 'RESET PASSWORD', 'ink'),
        spacerRow(24),
        smallPrintRow("This link expires in 1 hour. If you didn't request it, ignore this email."),
      ]),
      text: `${hi}\n\nReset your ${BRAND} password (link expires in 1 hour):\n${link}\n\nIf you didn't request this, ignore this email.`,
    };
  }
  const intro = `Recibimos una solicitud para restablecer tu contraseña de ${BRAND}.`;
  return {
    to: '',
    subject: 'Restablece tu contraseña',
    html: accountMail(l, 'Restablece tu contraseña', intro, [
      proseRow(hi),
      spacerRow(16),
      proseRow(intro),
      spacerRow(32),
      ctaRows(link, 'RESTABLECER CONTRASEÑA', 'ink'),
      spacerRow(24),
      smallPrintRow('Este enlace caduca en 1 hora. Si no lo solicitaste, ignora este correo.'),
    ]),
    text: `${hi}\n\nRestablece tu contraseña de ${BRAND} (el enlace caduca en 1 hora):\n${link}\n\nSi no lo solicitaste, ignora este correo.`,
  };
}

/**
 * v1.80 (C7, `ARCHITECTURE §4.57.2` #10) — aviso al titular STAFF (`super_admin`/`vault_operator`) de
 * que su cuenta quedó con candado por intentos fallidos. Máx. 1 cada 24 h por cuenta (lo decide el
 * llamador). ⛔ Sin enlaces, sin IP, sin conteos: nada que un tercero pueda usar si lee el buzón, y
 * nada que parezca un phishing de «pulsa aquí». ES del contrato §1 (ux-ui fija el final).
 *
 * P-MAIL-MARCA: va sobre `mailShell` **sin CTA** (el esqueleto no añade ninguna acción: la marca es
 * texto + `<img>` y el pie en tinta no lleva `<a>`). El único `href` es el «Aviso de privacidad», que
 * ya llevaba y que E5-1 exige (correo mixto ⇒ de cliente).
 */
export function passwordLockAlertTemplate(name: string | null, locale?: string | null): MailMessage {
  const l = normalizeLocale(locale);
  const hi = greeting(l, name);
  if (l === 'en') {
    const body =
      `There were several failed attempts to sign in to your ${BRAND} account. ` +
      "If it was you, you don't need to do anything. If not, your password is still safe; " +
      'if you want, change it from your account.';
    return {
      to: '',
      subject: 'Failed sign-in attempts on your account',
      html: accountMail(l, 'Failed sign-in attempts', `There were several failed attempts to sign in to your ${BRAND} account.`, [
        proseRow(hi),
        spacerRow(16),
        proseRow(body),
      ]),
      text: `${hi}\n\n${body}`,
    };
  }
  const body =
    `Hubo varios intentos fallidos de entrar a tu cuenta de ${BRAND}. ` +
    'Si fuiste tú, no tienes que hacer nada. Si no, tu contraseña sigue a salvo; ' +
    'si quieres, cámbiala desde tu cuenta.';
  return {
    to: '',
    subject: 'Intentos fallidos de entrar a tu cuenta',
    html: accountMail(l, 'Intentos fallidos de entrar', `Hubo varios intentos fallidos de entrar a tu cuenta de ${BRAND}.`, [
      proseRow(hi),
      spacerRow(16),
      proseRow(body),
    ]),
    text: `${hi}\n\n${body}`,
  };
}
