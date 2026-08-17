import { Finish } from '@prisma/client';
import { MailMessage } from '../mail/mail.port';

/**
 * Plantilla LOCAL al módulo buylist del correo de RECHAZO de ítem (v1.18-buylist-rejects,
 * ARCHITECTURE §4.18c). El módulo `mail` pertenece al stream «Cuentas y acceso» y NO se toca:
 * `buylist` solo inyecta el puerto global `MAIL_PORT` y renderiza aquí. El helper de layout y el
 * escape HTML (S15-B1) están DUPLICADOS a propósito desde `mail/mail.templates.ts` (mismo
 * branding/disciplina); deuda aceptada BE-43 (TECH_DEBT): se absorben en `MailService` cuando el
 * stream «Cuentas y acceso» toque `mail/`.
 *
 * MINIMIZACIÓN DE DATOS (norma §4.18c): el correo lleva SOLO la carta (nombre/set/número), acabado,
 * motivo y los dos plazos con el canal de coordinación. PROHIBIDO: CLABE (ni enmascarada),
 * montos/estado de OTROS ítems, datos de terceros.
 */

type Locale = 'es' | 'en';

const SUPPORT_EMAIL = 'soporte@tcgvaultmx.com';
const BRAND = 'TCG Vault MX';

function normalizeLocale(locale?: string | null): Locale {
  return locale === 'en' ? 'en' : 'es';
}

/** S15-B1: escapa metacaracteres HTML de todo valor dinámico antes de interpolarlo (el `&` primero). */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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

/** Etiquetas legibles del acabado (los datos de catálogo van en inglés por diseño, ARCHITECTURE §6). */
const FINISH_LABELS: Record<Finish, string> = {
  normal: 'Normal',
  reverse_holo: 'Reverse Holo',
  holofoil: 'Holofoil',
  first_edition_holofoil: '1st Edition Holofoil',
};

function formatDate(date: Date | null, locale: Locale): string {
  if (!date) return '—';
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'es-MX', {
    dateStyle: 'long',
    timeZone: 'America/Mexico_City',
  }).format(date);
}

export interface SellItemRejectedParams {
  cardName: string;
  setName: string;
  cardNumber: string;
  finish: Finish;
  reason: string;
  returnDeadlineAt: Date | null;
  abandonDeadlineAt: Date | null;
}

/**
 * Correo al vendedor cuando el admin RECHAZA una de sus cartas (típicamente no-NM). Contenido:
 * qué carta, acabado, motivo y opciones con plazos — devolución antes de `returnDeadlineAt`
 * (A COSTO DEL USUARIO, coordinada con soporte) o abandono en `abandonDeadlineAt`.
 * Firma sugerida por ARCHITECTURE §4.18c. `to` lo fija el llamador (BuylistService).
 */
export function sellItemRejectedTemplate(
  params: SellItemRejectedParams,
  name: string,
  locale?: string | null,
): MailMessage {
  const l = normalizeLocale(locale);
  const finishLabel = FINISH_LABELS[params.finish] ?? params.finish;
  const cardLine = `${params.cardName} · ${params.setName} · #${params.cardNumber}`;
  const safeName = escapeHtml(name);
  const safeCardLine = escapeHtml(cardLine);
  const safeFinish = escapeHtml(finishLabel);
  const safeReason = escapeHtml(params.reason);
  const returnDate = formatDate(params.returnDeadlineAt, l);
  const abandonDate = formatDate(params.abandonDeadlineAt, l);

  if (l === 'en') {
    return {
      to: '', // lo fija el llamador
      subject: 'A card in your sell request was rejected',
      html: layout(
        'A card was rejected',
        `<p>Hi ${safeName},</p>` +
          `<p>During verification we rejected the following card from your sell request:</p>` +
          `<p style="margin:16px 0"><strong>${safeCardLine}</strong><br/>Finish: ${safeFinish}</p>` +
          `<p><strong>Reason:</strong> ${safeReason}</p>` +
          `<p>Your options:</p>` +
          `<ul>` +
          `<li><strong>Return:</strong> request the return of your card before <strong>${escapeHtml(returnDate)}</strong>. Shipping is at your cost; write to ${SUPPORT_EMAIL} to coordinate it.</li>` +
          `<li><strong>Abandonment:</strong> if we don't hear from you by <strong>${escapeHtml(abandonDate)}</strong>, the card will be considered abandoned.</li>` +
          `</ul>` +
          `<p style="font-size:13px;color:#555">This decision only affects the card above; the rest of your request is not modified by this email.</p>`,
      ),
      text:
        `Hi ${name},\n\n` +
        `During verification we rejected the following card from your sell request:\n` +
        `${cardLine} (Finish: ${finishLabel})\n\n` +
        `Reason: ${params.reason}\n\n` +
        `Your options:\n` +
        `- Return: request the return of your card before ${returnDate}. Shipping is at your cost; write to ${SUPPORT_EMAIL} to coordinate it.\n` +
        `- Abandonment: if we don't hear from you by ${abandonDate}, the card will be considered abandoned.\n\n` +
        `${BRAND}`,
    };
  }
  return {
    to: '',
    subject: 'Una carta de tu solicitud de venta fue rechazada',
    html: layout(
      'Una carta fue rechazada',
      `<p>Hola ${safeName}:</p>` +
        `<p>Durante la verificación rechazamos la siguiente carta de tu solicitud de venta:</p>` +
        `<p style="margin:16px 0"><strong>${safeCardLine}</strong><br/>Acabado: ${safeFinish}</p>` +
        `<p><strong>Motivo:</strong> ${safeReason}</p>` +
        `<p>Tus opciones:</p>` +
        `<ul>` +
        `<li><strong>Devolución:</strong> solicita la devolución de tu carta antes del <strong>${escapeHtml(returnDate)}</strong>. El envío corre por tu cuenta; escribe a ${SUPPORT_EMAIL} para coordinarla.</li>` +
        `<li><strong>Abandono:</strong> si no recibimos respuesta antes del <strong>${escapeHtml(abandonDate)}</strong>, la carta se considerará abandonada.</li>` +
        `</ul>` +
        `<p style="font-size:13px;color:#555">Esta decisión solo afecta a la carta indicada; el resto de tu solicitud no se modifica con este correo.</p>`,
    ),
    text:
      `Hola ${name}:\n\n` +
      `Durante la verificación rechazamos la siguiente carta de tu solicitud de venta:\n` +
      `${cardLine} (Acabado: ${finishLabel})\n\n` +
      `Motivo: ${params.reason}\n\n` +
      `Tus opciones:\n` +
      `- Devolución: solicita la devolución de tu carta antes del ${returnDate}. El envío corre por tu cuenta; escribe a ${SUPPORT_EMAIL} para coordinarla.\n` +
      `- Abandono: si no recibimos respuesta antes del ${abandonDate}, la carta se considerará abandonada.\n\n` +
      `${BRAND}`,
  };
}
