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

/**
 * S15-B1: escapa los metacaracteres HTML (`& < > " '`) de cualquier valor dinámico (p. ej.
 * `User.name`, controlado por el usuario) antes de interpolarlo en el cuerpo HTML del correo.
 * Aunque el correo solo llega al propio usuario (impacto acotado), interpolar sin escapar es un
 * defecto de inyección real. El `&` va primero para no re-escapar las entidades ya emitidas.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const BRAND = 'TCG Vault MX';

function layout(title: string, bodyHtml: string): string {
  return [
    `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#111">`,
    `<h2 style="margin:0 0 16px">${BRAND}</h2>`,
    `<h3 style="margin:0 0 12px">${title}</h3>`,
    bodyHtml,
    `<hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>`,
    `<p style="font-size:12px;color:#888">${BRAND}</p>`,
    `</div>`,
  ].join('');
}

function button(url: string, label: string): string {
  return `<p style="margin:20px 0"><a href="${url}" style="background:#111;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block">${label}</a></p>`;
}

export function emailVerificationTemplate(link: string, name: string, locale?: string | null): MailMessage {
  const l = normalizeLocale(locale);
  // S15-B1: escapa los valores dinámicos antes de interpolarlos en el HTML.
  const safeName = escapeHtml(name);
  const safeLink = escapeHtml(link);
  if (l === 'en') {
    return {
      to: '', // lo fija MailService
      subject: 'Verify your email',
      html: layout(
        'Verify your email',
        `<p>Hi ${safeName},</p><p>Confirm your email address to unlock buying, withdrawing and selling on ${BRAND}.</p>${button(safeLink, 'Verify email')}<p style="font-size:13px;color:#555">This link expires in 24 hours. If the button doesn't work, copy this URL:</p><p style="font-size:12px;word-break:break-all;color:#555">${safeLink}</p>`,
      ),
      text: `Hi ${name},\n\nVerify your email for ${BRAND} (link expires in 24 hours):\n${link}\n\nIf you didn't create an account, ignore this message.`,
    };
  }
  return {
    to: '',
    subject: 'Verifica tu correo',
    html: layout(
      'Verifica tu correo',
      `<p>Hola ${safeName}:</p><p>Confirma tu correo para poder comprar, retirar y vender en ${BRAND}.</p>${button(safeLink, 'Verificar correo')}<p style="font-size:13px;color:#555">Este enlace caduca en 24 horas. Si el botón no funciona, copia esta URL:</p><p style="font-size:12px;word-break:break-all;color:#555">${safeLink}</p>`,
    ),
    text: `Hola ${name}:\n\nVerifica tu correo en ${BRAND} (el enlace caduca en 24 horas):\n${link}\n\nSi no creaste una cuenta, ignora este mensaje.`,
  };
}

export function passwordResetTemplate(link: string, name: string, locale?: string | null): MailMessage {
  const l = normalizeLocale(locale);
  // S15-B1: escapa los valores dinámicos antes de interpolarlos en el HTML.
  const safeName = escapeHtml(name);
  const safeLink = escapeHtml(link);
  if (l === 'en') {
    return {
      to: '',
      subject: 'Reset your password',
      html: layout(
        'Reset your password',
        `<p>Hi ${safeName},</p><p>We received a request to reset your ${BRAND} password.</p>${button(safeLink, 'Reset password')}<p style="font-size:13px;color:#555">This link expires in 1 hour. If you didn't request it, ignore this email.</p><p style="font-size:12px;word-break:break-all;color:#555">${safeLink}</p>`,
      ),
      text: `Hi ${name},\n\nReset your ${BRAND} password (link expires in 1 hour):\n${link}\n\nIf you didn't request this, ignore this email.`,
    };
  }
  return {
    to: '',
    subject: 'Restablece tu contraseña',
    html: layout(
      'Restablece tu contraseña',
      `<p>Hola ${safeName}:</p><p>Recibimos una solicitud para restablecer tu contraseña de ${BRAND}.</p>${button(safeLink, 'Restablecer contraseña')}<p style="font-size:13px;color:#555">Este enlace caduca en 1 hora. Si no lo solicitaste, ignora este correo.</p><p style="font-size:12px;word-break:break-all;color:#555">${safeLink}</p>`,
    ),
    text: `Hola ${name}:\n\nRestablece tu contraseña de ${BRAND} (el enlace caduca en 1 hora):\n${link}\n\nSi no lo solicitaste, ignora este correo.`,
  };
}
