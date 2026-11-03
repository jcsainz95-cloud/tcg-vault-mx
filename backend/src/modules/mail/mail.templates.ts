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
 * texto (el respaldo de §31.6g); la letra chica (caducidad y «copia esta URL») va DESPUÉS del botón,
 * en el mismo orden que restablecer (QA m-3). Rótulos de CTA: `DESIGN_SYSTEM §41.4` filas 7 y 8.
 */
export function emailVerificationTemplate(link: string, name: string | null, locale?: string | null): MailMessage {
  const l = normalizeLocale(locale);
  const hi = greeting(l, name);
  // v1.117.2 (D-CTA-12; DESIGN_SYSTEM §CTA-UX.3b, texto exacto): la página pide la contraseña actual o una nueva, y el correo
  // lo avisa ANTES de abrirlo. El botón va en mayúsculas como todo CTA de correo (§41.4). Candado: `test/mail.verify-email-copy.spec.ts`.
  if (l === 'en') {
    const intro = `Confirm your email for your ${BRAND} account.`;
    const notice = VERIFY_EMAIL_PASSWORD_NOTICE.en;
    return {
      to: '', // lo fija MailService
      subject: 'Verify your email',
      html: accountMail(l, 'Verify your email', intro, [
        proseRow(hi),
        spacerRow(16),
        proseRow(intro),
        spacerRow(32),
        ctaRows(link, 'CONFIRM MY EMAIL', 'ink'),
        spacerRow(24),
        proseRow(notice),
        spacerRow(16),
        smallPrintRow("This link expires in 24 hours. If the button doesn't work, copy this URL:"),
      ]),
      text: `${hi}\n\n${intro}\n${link}\n\n${notice}\n\nThis link expires in 24 hours.`,
    };
  }
  const intro = `Confirma tu correo para tu cuenta en ${BRAND}.`;
  const notice = VERIFY_EMAIL_PASSWORD_NOTICE.es;
  return {
    to: '',
    subject: 'Verifica tu correo',
    html: accountMail(l, 'Verifica tu correo', intro, [
      proseRow(hi),
      spacerRow(16),
      proseRow(intro),
      spacerRow(32),
      ctaRows(link, 'CONFIRMAR MI CORREO', 'ink'),
      spacerRow(24),
      proseRow(notice),
      spacerRow(16),
      smallPrintRow('Este enlace caduca en 24 horas. Si el botón no funciona, copia esta URL:'),
    ]),
    text: `${hi}\n\n${intro}\n${link}\n\n${notice}\n\nEste enlace caduca en 24 horas.`,
  };
}

/** DESIGN_SYSTEM §CTA-UX.3b — aviso de «Verifica tu correo»: al abrir el enlace se pide la contraseña (texto exacto ES/EN). */
export const VERIFY_EMAIL_PASSWORD_NOTICE = {
  es: 'Al abrir el enlace te pediremos tu contraseña. Si no creaste esta cuenta o no la recuerdas, ábrelo igual: podrás elegir una nueva. El enlace sirve una vez.',
  en: "When you open the link we'll ask for your password. If you didn't create this account or don't remember it, open it anyway: you can choose a new one. The link works once.",
} as const;

/**
 * v1.117⟨cuenta-correo⟩ (API_CONTRACT §CTA.6) — «Termina tu cuenta»: correo de AUTENTICACIÓN (como verificación y
 * restablecimiento; fuera de §R). El enlace abre la PÁGINA `/<locale>/account-setup?token=` (nombre + contraseña, `POST`
 * desde ella). Dice qué es, que el enlace sirve una vez y caduca en 24 h, y que si no creó la cuenta puede ignorarlo.
 * ⛔ Sin datos de pedidos, importes ni dirección. Texto PROVISIONAL de backend: el final lo fija ux-ui (§CTA.10).
 */
export function accountSetupTemplate(link: string, name: string | null, locale?: string | null): MailMessage {
  const l = normalizeLocale(locale);
  const hi = greeting(l, name);
  if (l === 'en') {
    const intro = `You created a ${BRAND} account with this email. To finish it, add your name and a password.`;
    const once = 'The link works only once and expires in 24 hours.';
    // Preheader de 40–90 caracteres (N3 de `buylist.mail-shell.spec.ts`).
    const preheader = `Add your name and a password to your ${BRAND} account.`;
    return {
      to: '',
      subject: 'Finish your account',
      html: accountMail(l, 'Finish your account', preheader, [
        proseRow(hi),
        spacerRow(16),
        proseRow(intro),
        spacerRow(16),
        proseRow(once),
        spacerRow(32),
        ctaRows(link, 'FINISH MY ACCOUNT', 'ink'),
        spacerRow(24),
        smallPrintRow("If you didn't create this account, ignore this email. If the button doesn't work, copy this URL:"),
      ]),
      text: `${hi}\n\n${intro}\n${once}\n${link}\n\nIf you didn't create this account, ignore this email.`,
    };
  }
  const intro = `Creaste una cuenta en ${BRAND} con este correo. Para terminarla, ponle tu nombre y una contraseña.`;
  const once = 'El enlace sirve una sola vez y caduca en 24 horas.';
  const preheader = `Ponle tu nombre y una contraseña a tu cuenta de ${BRAND}.`;
  return {
    to: '',
    subject: 'Termina tu cuenta',
    html: accountMail(l, 'Termina tu cuenta', preheader, [
      proseRow(hi),
      spacerRow(16),
      proseRow(intro),
      spacerRow(16),
      proseRow(once),
      spacerRow(32),
      ctaRows(link, 'TERMINAR MI CUENTA', 'ink'),
      spacerRow(24),
      smallPrintRow('Si no creaste esta cuenta, ignora este correo. Si el botón no funciona, copia esta URL:'),
    ]),
    text: `${hi}\n\n${intro}\n${once}\n${link}\n\nSi no creaste esta cuenta, ignora este correo.`,
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
        ctaRows(link, 'RESET MY PASSWORD', 'ink'),
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
      ctaRows(link, 'RESTABLECER MI CONTRASEÑA', 'ink'),
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
