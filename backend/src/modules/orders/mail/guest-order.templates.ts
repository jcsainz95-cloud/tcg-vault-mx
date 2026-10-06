import {
  ctaRows,
  eyebrowRow,
  headingRow,
  mailShell,
  proseRow,
  ruleRow,
  sectionLabelRow,
  smallPrintRow,
  spacerRow,
  totalsRows,
} from '../../buylist/mail-shell';
import { MailMessage } from '../../mail/mail.port';

/**
 * Plantillas LOCALES al módulo `orders` del correo del GUEST CHECKOUT (v1.21, ARCHITECTURE §4.21g).
 * El módulo `mail` pertenece al stream «Cuentas y acceso» y NO se toca por dentro: `orders` solo
 * inyecta el puerto global `MAIL_PORT` y renderiza aquí — mismo patrón que estrenó `buylist` en
 * v1.18. P-MAIL-MARCA (2026-10-06): el HTML va sobre el esqueleto de marca `mailShell`
 * (`DESIGN_SYSTEM §31`), igual que `order-notice.templates.ts`; el `layout()` y el `escapeHtml`
 * duplicados se fueron (el escape lo hacen los builders del esqueleto, S15-B1).
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

/** §31.6h — la línea del «por qué recibes esto»: la misma que el aviso del pedido con cuenta. */
function guestFooterWhy(l: Locale): string {
  return l === 'en'
    ? 'You are receiving this email because you placed an order with us.'
    : 'Recibes este correo porque hiciste un pedido con nosotros.';
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
    confirmIntro: (n: string) => `Tu pedido ${n} quedó confirmado y lo estamos preparando.`,
    eyebrow: 'TU PEDIDO',
    itemsLabel: 'LO QUE COMPRASTE',
    totalLabel: 'TOTAL PAGADO',
    trackButton: 'VER EL ESTADO DE MI PEDIDO',
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
      `Aquí tienes un enlace nuevo para seguir tu pedido ${n}. Los enlaces anteriores dejaron de funcionar.`,
  },
  en: {
    confirmSubject: (n: string) => `${BRAND} — Your order ${n} is confirmed`,
    confirmTitle: 'Thanks for your purchase',
    confirmIntro: (n: string) => `Your order ${n} is confirmed and we are preparing it.`,
    eyebrow: 'YOUR ORDER',
    itemsLabel: 'WHAT YOU BOUGHT',
    totalLabel: 'TOTAL PAID',
    trackButton: 'TRACK MY ORDER',
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
      `Here is a new link to track your order ${n}. Previous links no longer work.`,
  },
} as const;

function itemsText(items: GuestOrderMailItem[]): string {
  return items.map((i) => `- ${i.name} — ${i.setName} #${i.number}`).join('\n');
}

/**
 * Correo de CONFIRMACIÓN de compra (criterio 49): resumen + enlace tokenizado + oferta de cuenta.
 * Composición = la de `orderSettledTemplate` (AV-2, el mismo hecho para el cliente con cuenta).
 * ⛔ El único botón es el de SEGUIMIENTO (una página que solo LEE, §4.21g): ninguna acción.
 */
export function guestOrderConfirmationTemplate(
  params: GuestOrderMailParams,
  locale?: string | null,
): Omit<MailMessage, 'to'> {
  const l = normalizeLocale(locale);
  const t = COPY[l];
  const url = params.trackingUrl;
  const intro = t.confirmIntro(params.orderNumber);
  const total = formatMxn(params.totalCents, l);
  const lineas = params.items.map((i) => `${i.name} — ${i.setName} #${i.number}`);
  const html = mailShell({
    locale: l,
    title: t.confirmTitle,
    preheader: intro,
    blocks: [
      eyebrowRow(t.eyebrow, params.orderNumber),
      headingRow(t.confirmTitle, 22),
      spacerRow(24),
      proseRow(intro),
      spacerRow(24),
      ruleRow(),
      spacerRow(24),
      sectionLabelRow(t.itemsLabel),
      spacerRow(8),
      ...lineas.map((x) => proseRow(x)),
      spacerRow(24),
      totalsRows([], { label: t.totalLabel, amount: total }),
      spacerRow(32),
      ctaRows(url, t.trackButton, 'ink'),
      spacerRow(24),
      smallPrintRow(t.trackNote),
      spacerRow(8),
      smallPrintRow(t.claimCta),
      spacerRow(8),
      smallPrintRow(t.finalSale),
      spacerRow(8),
      smallPrintRow(t.invoice),
    ],
    footerWhy: guestFooterWhy(l),
  });
  const text = [
    t.confirmTitle,
    '',
    `${t.itemsTitle}:`,
    itemsText(params.items),
    '',
    `${t.total}: ${total}`,
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
  const url = params.trackingUrl;
  const intro = t.resendIntro(params.orderNumber);
  const html = mailShell({
    locale: l,
    title: t.resendTitle,
    preheader: intro,
    blocks: [
      eyebrowRow(t.eyebrow, params.orderNumber),
      headingRow(t.resendTitle, 22),
      spacerRow(24),
      proseRow(intro),
      spacerRow(32),
      ctaRows(url, t.trackButton, 'ink'),
      spacerRow(24),
      smallPrintRow(t.trackNote),
    ],
    footerWhy: guestFooterWhy(l),
  });
  const text = [t.resendTitle, '', `${t.trackCta}: ${url}`, t.trackNote].join('\n');
  return { subject: t.resendSubject(params.orderNumber), html, text };
}
