import { MailMessage } from '../../mail/mail.port';

/**
 * Plantillas LOCALES al módulo `orders` del correo del GUEST CHECKOUT (v1.21, ARCHITECTURE §4.21g).
 * El módulo `mail` pertenece al stream «Cuentas y acceso» y NO se toca por dentro: `orders` solo
 * inyecta el puerto global `MAIL_PORT` y renderiza aquí — mismo patrón que estrenó `buylist` en
 * v1.18. El layout y el escape HTML están DUPLICADOS a propósito desde `mail/mail.templates.ts`
 * (deuda aceptada BE-43: se absorben en `MailService` cuando ese stream toque `mail/`).
 *
 * MINIMIZACIÓN DE DATOS (norma §4.21g). El correo lleva SOLO: número de pedido, cartas compradas,
 * total pagado y el enlace de seguimiento. PROHIBIDO: dirección completa, teléfono, datos de pago
 * más allá de la terminación, cualquier dato de OTRO pedido y CUALQUIER enlace a una acción
 * (cancelar / reembolsar / cambiar dirección).
 */

type Locale = 'es' | 'en';

// P-21 (rebrand): marca visible "TCG HUNT" (DESIGN_SYSTEM §17.4). "Bóveda"/"vault" en el copy es
// el nombre de la FUNCIÓN de custodia, no de la marca: no cambia.
const BRAND = 'TCG HUNT';

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

function formatMxn(cents: number, locale: Locale): string {
  return new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'es-MX', {
    style: 'currency',
    currency: 'MXN',
  }).format(cents / 100);
}

export interface GuestOrderMailItem {
  name: string;
  setName: string;
  number: string;
}

export interface GuestOrderMailParams {
  orderNumber: string;
  items: GuestOrderMailItem[];
  totalCents: number;
  /** URL del frontend con `?token=` (secreto de URL; nunca se loguea). */
  trackingUrl: string;
}

const COPY = {
  es: {
    confirmSubject: (n: string) => `${BRAND} — Confirmación de tu pedido ${n}`,
    confirmTitle: 'Gracias por tu compra',
    confirmIntro: (n: string) => `Tu pedido <strong>${n}</strong> quedó confirmado y lo estamos preparando.`,
    itemsTitle: 'Lo que compraste',
    total: 'Total pagado',
    trackCta: 'Ver el estado de mi pedido',
    trackNote:
      'Este enlace es personal: quien lo tenga puede ver el estado de tu pedido. No lo compartas. Caduca en 90 días.',
    claimCta:
      'Puedes crear una cuenta con este mismo correo para guardar tu pedido y tus próximas compras en tu bóveda.',
    finalSale:
      'Ventas finales: no hay reembolso a solicitud, salvo carta dañada/equivocada o error de la plataforma.',
    invoice:
      'Para solicitar factura (CFDI), escríbenos por correo con tus datos fiscales citando el número de pedido.',
    resendSubject: (n: string) => `${BRAND} — Enlace de seguimiento de tu pedido ${n}`,
    resendTitle: 'Tu nuevo enlace de seguimiento',
    resendIntro: (n: string) =>
      `Aquí tienes un enlace nuevo para seguir tu pedido <strong>${n}</strong>. Los enlaces anteriores dejaron de funcionar.`,
  },
  en: {
    confirmSubject: (n: string) => `${BRAND} — Your order ${n} is confirmed`,
    confirmTitle: 'Thanks for your purchase',
    confirmIntro: (n: string) => `Your order <strong>${n}</strong> is confirmed and we are preparing it.`,
    itemsTitle: 'What you bought',
    total: 'Total paid',
    trackCta: 'Track my order',
    trackNote:
      'This link is personal: anyone who has it can see your order status. Do not share it. It expires in 90 days.',
    claimCta:
      'You can create an account with this same email to keep this order and your future purchases in your vault.',
    finalSale:
      'All sales are final: no refunds on request, except for a damaged/wrong card or a platform error.',
    invoice:
      'To request an invoice (CFDI), email us your tax details quoting the order number.',
    resendSubject: (n: string) => `${BRAND} — Tracking link for your order ${n}`,
    resendTitle: 'Your new tracking link',
    resendIntro: (n: string) =>
      `Here is a new link to track your order <strong>${n}</strong>. Previous links no longer work.`,
  },
} as const;

function itemsHtml(items: GuestOrderMailItem[]): string {
  const rows = items
    .map(
      (i) =>
        `<li style="margin:0 0 6px">${escapeHtml(i.name)} — ${escapeHtml(i.setName)} #${escapeHtml(i.number)}</li>`,
    )
    .join('');
  return `<ul style="padding-left:18px;margin:0 0 16px">${rows}</ul>`;
}

function itemsText(items: GuestOrderMailItem[]): string {
  return items.map((i) => `- ${i.name} — ${i.setName} #${i.number}`).join('\n');
}

/** Correo de CONFIRMACIÓN de compra (criterio 49): resumen + enlace tokenizado + oferta de cuenta. */
export function guestOrderConfirmationTemplate(
  params: GuestOrderMailParams,
  locale?: string | null,
): Omit<MailMessage, 'to'> {
  const l = normalizeLocale(locale);
  const t = COPY[l];
  const n = escapeHtml(params.orderNumber);
  const url = params.trackingUrl;
  const html = layout(
    t.confirmTitle,
    [
      `<p>${t.confirmIntro(n)}</p>`,
      `<p style="margin:16px 0 6px"><strong>${t.itemsTitle}</strong></p>`,
      itemsHtml(params.items),
      `<p><strong>${t.total}:</strong> ${escapeHtml(formatMxn(params.totalCents, l))}</p>`,
      `<p style="margin:24px 0"><a href="${escapeHtml(url)}" style="background:#111;color:#fff;padding:12px 18px;border-radius:6px;text-decoration:none">${t.trackCta}</a></p>`,
      `<p style="font-size:12px;color:#666">${t.trackNote}</p>`,
      `<p style="font-size:12px;color:#666">${t.claimCta}</p>`,
      `<p style="font-size:12px;color:#666">${t.finalSale}</p>`,
      `<p style="font-size:12px;color:#666">${t.invoice}</p>`,
    ].join(''),
  );
  const text = [
    t.confirmTitle,
    '',
    `${t.itemsTitle}:`,
    itemsText(params.items),
    '',
    `${t.total}: ${formatMxn(params.totalCents, l)}`,
    '',
    `${t.trackCta}: ${url}`,
    t.trackNote,
    t.claimCta,
    t.finalSale,
    t.invoice,
  ].join('\n');
  return { subject: t.confirmSubject(params.orderNumber), html, text };
}

/** Correo de REENVÍO del enlace (self-service §4-G.4 o soporte §4-G.9b). Rota: el anterior muere. */
export function guestTrackingLinkTemplate(
  params: Omit<GuestOrderMailParams, 'items' | 'totalCents'>,
  locale?: string | null,
): Omit<MailMessage, 'to'> {
  const l = normalizeLocale(locale);
  const t = COPY[l];
  const n = escapeHtml(params.orderNumber);
  const url = params.trackingUrl;
  const html = layout(
    t.resendTitle,
    [
      `<p>${t.resendIntro(n)}</p>`,
      `<p style="margin:24px 0"><a href="${escapeHtml(url)}" style="background:#111;color:#fff;padding:12px 18px;border-radius:6px;text-decoration:none">${t.trackCta}</a></p>`,
      `<p style="font-size:12px;color:#666">${t.trackNote}</p>`,
    ].join(''),
  );
  const text = [t.resendTitle, '', `${t.trackCta}: ${url}`, t.trackNote].join('\n');
  return { subject: t.resendSubject(params.orderNumber), html, text };
}
