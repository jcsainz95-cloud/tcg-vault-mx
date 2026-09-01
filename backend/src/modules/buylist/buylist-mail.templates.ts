import { Finish } from '@prisma/client';
import { envOr } from '../mail/mail-env.util';
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

// P-21 (rebrand): overridable por env sin redeploy (mismo patrón que `disputes.constants.ts`).
// Cae en cascada a `DISPUTE_EVIDENCE_CONTACT` (mismo buzón de soporte) y al valor histórico como
// default para no romper nada mientras devops no cree el buzón @tcghunt.mx. P-21 cierre: `envOr`
// (no `??`) — env definida pero vacía/blanca sigue la cascada hasta el default.
const SUPPORT_EMAIL = envOr(
  process.env.SUPPORT_EMAIL,
  envOr(process.env.DISPUTE_EVIDENCE_CONTACT, 'soporte@tcgvaultmx.com'),
);
// P-21 (rebrand): marca visible "TCG HUNT" (DESIGN_SYSTEM §17.4).
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

/**
 * v1.51 (§4.39n, DESIGN_SYSTEM §23.4.2/§23.4.4-bis) — los **DOS correos del ciclo de oferta** que este
 * pase produce: el **1 (LA OFERTA)** y el **5 (CANCELAMOS LA OFERTA)**.
 *
 * ⚠️ **Un productor por correo, elegido en el CALL-SITE.** No hay `switch (status)` que elija plantilla:
 * `expiredReason` es `null` en dos de los tres productores del correo 3, así que ramificar sobre datos
 * de la fila **elegiría mal**. Cada endpoint llama a la plantilla que le corresponde y a ninguna otra.
 *
 * **MINIMIZACIÓN (norma §4.18c/§4.39n), en los dos:** solo las cartas de ESTA solicitud, sus montos y
 * los plazos. **PROHIBIDO**: CLABE (ni enmascarada), datos de terceros, montos de otras solicitudes y
 * **cualquier cifra interna de la mesa** (posición, sugerencia, tope del operador).
 * **S15-B1:** todo valor dinámico pasa por `escapeHtml`.
 */

/** Fecha **Y HORA** explícitas en `America/Mexico_City` (criterio 154: nunca «en 2 días»). */
function formatDateTime(date: Date | null, locale: Locale): string {
  if (!date) return '—';
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'es-MX', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: 'America/Mexico_City',
  }).format(date);
}

/** MXN desde centavos, sin inventar decimales. */
function money(cents: number, locale: Locale): string {
  return new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

export interface OfferMailLine {
  cardName: string;
  setName: string;
  cardNumber: string;
  finish: Finish;
  /** `null` en las líneas que NO compramos — y **jamás `0`**: cero es un precio y aquí no hay precio. */
  offeredPriceCents: number | null;
}

export interface SellOfferParams {
  folio: string;
  lines: OfferMailLine[];
  grossCents: number;
  shippingFeeCents: number;
  netCents: number;
  acceptDeadlineAt: Date;
  /** Dirección de origen ya confirmada por el vendedor para ESTA solicitud (snapshot, D36). */
  pickupAddressLine: string | null;
  /** URL del portal; vacío ⇒ el CTA se degrada a instrucción de texto (nunca un botón muerto). */
  portalUrl?: string;
}

/**
 * **CORREO 1 — LA OFERTA** (D2/D16, criterios 133/134/161(b)).
 *
 * *«La resta se ENSEÑA, no se esconde»*: van **los tres montos** —valor de las cartas, envío que
 * ponemos y **lo que se deposita**—, nunca uno solo. Un correo que anuncie $1,480 y termine en un
 * depósito de $1,350 destruye exactamente la confianza que la oferta vinculante venía a construir.
 *
 * - **La condición va EN LA LÍNEA**, pegada al monto, no en una leyenda al pie: es imposible leer el
 *   precio sin barrer la condición.
 * - **Lo que NO compramos se lista, con nombre y SIN monto** (criterio 118). **Prohibido `MX$ 0.00`**
 *   ahí, y **prohibido explicar por qué**: es deliberación interna.
 * - **El plazo va con FECHA Y HORA explícitas** (criterio 154). El front **no** recalcula días hábiles.
 * - **NO se acepta desde el correo** (criterio 146): el enlace lleva a la pantalla, la sesión decide.
 * - **El correo NO compra etiqueta** (D21): solo anuncia que el envío corre por nuestra cuenta y que
 *   la guía llega **al aceptar**. *Solo se gasta etiqueta en quien ya dijo que sí.*
 */
export function sellOfferTemplate(
  params: SellOfferParams,
  name: string,
  locale?: string | null,
): MailMessage {
  const l = normalizeLocale(locale);
  const en = l === 'en';
  const buy = params.lines.filter((x) => x.offeredPriceCents != null);
  const skip = params.lines.filter((x) => x.offeredPriceCents == null);
  const condition = en ? 'only if it arrives Near Mint' : 'siempre que llegue en Near Mint';
  const deadline = formatDateTime(params.acceptDeadlineAt, l);
  const safeName = escapeHtml(name);
  const idOf = (x: OfferMailLine) =>
    `${x.cardName} · ${x.setName} · #${x.cardNumber} · ${FINISH_LABELS[x.finish] ?? x.finish}`;

  const buyHtml = buy
    .map(
      (x) =>
        `<p style="margin:10px 0"><strong>${escapeHtml(idOf(x))}</strong><br/>` +
        `<span style="color:#555">${escapeHtml(condition)}</span> — ` +
        `<strong>${escapeHtml(money(x.offeredPriceCents as number, l))}</strong></p>`,
    )
    .join('');
  // Sin monto y sin motivo: cero es un precio, y el porqué es deliberación interna.
  const skipHtml = skip
    .map(
      (x) =>
        `<p style="margin:8px 0;color:#666">${escapeHtml(idOf(x))} — ` +
        `${escapeHtml(en ? 'Not included in this offer' : 'No entra en esta oferta')}</p>`,
    )
    .join('');
  const consequence = en
    ? `If a card doesn't arrive Near Mint we don't buy it, we don't pay for it and we send it back: you have 7 days to arrange the return, at your cost, and after 30 days it is considered abandoned. Rejecting one card does NOT cancel the purchase of the others and does NOT change any price: the ones that do arrive Near Mint are paid at the price in this offer.`
    : `Si una carta no llega en Near Mint no se compra, no se paga y te la devolvemos: tienes 7 días para gestionar la devolución, a tu costo, y a los 30 días se considera abandonada. Rechazar una carta NO cancela la compra de las demás y NO cambia el precio de ninguna: las que sí lleguen en Near Mint se pagan al precio de esta oferta.`;
  const totalsHtml =
    `<p style="margin:16px 0">` +
    `${escapeHtml(en ? 'Value of the cards' : 'Valor de las cartas')}: <strong>${escapeHtml(money(params.grossCents, l))}</strong><br/>` +
    `${escapeHtml(en ? 'Shipping we cover' : 'Envío que ponemos nosotros')}: − ${escapeHtml(money(params.shippingFeeCents, l))}<br/>` +
    `<strong style="font-size:18px">${escapeHtml(en ? 'DEPOSITED TO YOU' : 'SE TE DEPOSITAN')}: ${escapeHtml(money(params.netCents, l))}</strong></p>`;
  const shippingProse = en
    ? `We provide the shipping label. Its cost, ${money(params.shippingFeeCents, l)}, is a flat fee and is ALWAYS deducted from what we pay you: you pay nothing out of pocket. The amount deposited to you is ${money(params.netCents, l)}.`
    : `Nosotros ponemos la guía de envío. Su costo, ${money(params.shippingFeeCents, l)}, es una tarifa fija y SIEMPRE se descuenta de lo que te pagamos: tú no pagas nada de tu bolsillo. La cifra que se te deposita es ${money(params.netCents, l)}.`;
  const deadlineProse = en
    ? `You have until ${deadline}. If you don't respond before that time, the offer cancels itself.`
    : `Tienes hasta el ${deadline}. Si no respondes antes de esa hora, la oferta se cancela sola.`;
  const ctaProse = en
    ? 'You will sign in with your account: this offer cannot be accepted from an email link.'
    : 'Entrarás con tu cuenta: esta oferta no se acepta desde un enlace del correo.';
  const cta = params.portalUrl
    ? `<p style="margin:20px 0"><a href="${escapeHtml(params.portalUrl)}" style="background:#111;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block">${escapeHtml(en ? 'View and respond to the offer' : 'Ver y responder la oferta')}</a></p>`
    : `<p style="margin:20px 0"><strong>${escapeHtml(en ? 'Sign in to your account and open your sell request to respond.' : 'Entra a tu cuenta y abre tu solicitud para responder.')}</strong></p>`;
  const pickup = params.pickupAddressLine
    ? `<p style="font-size:13px;color:#555">${escapeHtml(en ? 'When you accept we send you the label; the package ships from:' : 'Al aceptar te mandamos la guía; el paquete sale desde:')} ${escapeHtml(params.pickupAddressLine)}. ${escapeHtml(en ? 'If you moved, correct it from your account before accepting.' : 'Si te mudaste, corrígela desde tu cuenta antes de aceptar.')}</p>`
    : '';

  const title = en
    ? `We're buying ${buy.length} of your ${params.lines.length} cards`
    : `Te compramos ${buy.length} de tus ${params.lines.length} cartas`;
  const intro = en
    ? 'This offer is conditional, and this is how it works: we buy each card at the price below AS LONG AS IT ARRIVES NEAR MINT.'
    : 'Esta oferta es condicional y así funciona: compramos cada carta al precio de abajo SIEMPRE QUE LLEGUE EN NEAR MINT.';

  const text =
    `${en ? 'Hi' : 'Hola'} ${name}:\n\n` +
    `${en ? 'PURCHASE OFFER' : 'OFERTA DE COMPRA'} · ${params.folio}\n\n` +
    `${title}\n\n${intro}\n\n` +
    `${en ? 'WE BUY' : 'COMPRAMOS'} (${buy.length})\n` +
    buy
      .map((x) => `- ${idOf(x)} — ${condition} — ${money(x.offeredPriceCents as number, l)}`)
      .join('\n') +
    (skip.length
      ? `\n\n${en ? "WE DON'T BUY" : 'NO COMPRAMOS'} (${skip.length})\n` +
        skip.map((x) => `- ${idOf(x)}`).join('\n')
      : '') +
    `\n\n${consequence}\n\n` +
    `${en ? 'Value of the cards' : 'Valor de las cartas'}: ${money(params.grossCents, l)}\n` +
    `${en ? 'Shipping we cover' : 'Envío que ponemos nosotros'}: -${money(params.shippingFeeCents, l)}\n` +
    `${en ? 'DEPOSITED TO YOU' : 'SE TE DEPOSITAN'}: ${money(params.netCents, l)}\n\n` +
    `${shippingProse}\n\n${deadlineProse}\n${ctaProse}\n\n` +
    (params.pickupAddressLine
      ? `${en ? 'Ships from' : 'Sale desde'}: ${params.pickupAddressLine}\n\n`
      : '') +
    `${BRAND}`;

  return {
    to: '', // lo fija el llamador
    subject: en ? 'We have an offer for your cards' : 'Tenemos una oferta por tus cartas',
    html: layout(
      title,
      `<p style="font-size:12px;color:#888">${escapeHtml(en ? 'PURCHASE OFFER' : 'OFERTA DE COMPRA')} · ${escapeHtml(params.folio)}</p>` +
        `<p>${escapeHtml(en ? 'Hi' : 'Hola')} ${safeName}:</p>` +
        `<p>${escapeHtml(intro)}</p>` +
        `<p style="font-size:11px;color:#888;letter-spacing:.06em">${escapeHtml(en ? 'WE BUY' : 'COMPRAMOS')} (${buy.length})</p>` +
        buyHtml +
        (skip.length
          ? `<p style="font-size:11px;color:#888;letter-spacing:.06em">${escapeHtml(en ? "WE DON'T BUY" : 'NO COMPRAMOS')} (${skip.length})</p>${skipHtml}`
          : '') +
        `<div style="background:#EFEBE2;padding:12px;margin:16px 0"><p style="margin:0;font-size:13px">${escapeHtml(consequence)}</p></div>` +
        totalsHtml +
        `<p>${escapeHtml(shippingProse)}</p>` +
        `<p>${escapeHtml(deadlineProse)}</p>` +
        cta +
        `<p style="font-size:13px;color:#555">${escapeHtml(ctaProse)}</p>` +
        pickup,
    ),
    text,
  };
}

/**
 * **CORREO 5 — CANCELAMOS LA OFERTA** (v1.51.4, §4.39n · DESIGN_SYSTEM §23.4.4-bis).
 *
 * **Un solo productor:** `POST /admin/buylist/:id/offer/cancel` sobre una oferta **`sent`**, y nada
 * más. **NO lo manda el barrido** —ahí el hecho real es *«no procederemos»*, que es el correo 4—.
 *
 * Es el **único desenlace del ciclo que NO cierra nada**: la solicitud vuelve a `cotizada`, **viva**,
 * con los 7 días hábiles íntegros (D38). Por eso **no es una variante del correo 3**: aquél afirma
 * *«hubo una oferta y **tu** plazo venció»*, y aquí **no venció nada** — **cancelamos nosotros**.
 * Mandarle el 3 le imputaría un incumplimiento por un acto nuestro, y su CTA (*«cotizar de nuevo»*) lo
 * mandaría a **duplicar una solicitud abierta**.
 *
 * **PROHIBIDO aquí:** la palabra «venció», cualquier plazo del vendedor, **cualquier monto** (los de la
 * oferta cancelada se limpiaron de la fila y **no se resucitan**), el motivo interno y el CTA de volver
 * a cotizar.
 */
export function sellOfferCancelledTemplate(
  params: { folio: string; offerSentAt: Date | null; portalUrl?: string },
  name: string,
  locale?: string | null,
): MailMessage {
  const l = normalizeLocale(locale);
  const en = l === 'en';
  const sentOn = formatDate(params.offerSentAt, l);
  const title = en ? 'We cancelled the offer we sent you' : 'Cancelamos la oferta que te mandamos';
  const body1 = en
    ? `The offer from ${sentOn} is no longer valid: we cancelled it ourselves. It is nothing on your side.`
    : `La oferta del ${sentOn} ya no es válida: la cancelamos nosotros. No es nada de tu parte.`;
  const body2 = en
    ? 'Your request is still active and we are reviewing it again; we will write to you with a new offer or with our answer.'
    : 'Tu solicitud sigue viva y volvemos a revisarla; te escribiremos con una oferta nueva o con nuestra respuesta.';
  const ctaLabel = en ? 'View my request' : 'Ver mi solicitud';
  const cta = params.portalUrl
    ? `<p style="margin:20px 0"><a href="${escapeHtml(params.portalUrl)}" style="background:#111;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block">${escapeHtml(ctaLabel)}</a></p>`
    : `<p style="margin:20px 0"><strong>${escapeHtml(en ? 'Sign in to your account to see your request.' : 'Entra a tu cuenta para ver tu solicitud.')}</strong></p>`;

  return {
    to: '',
    subject: en ? 'We cancelled the offer we sent you' : 'Cancelamos la oferta que te mandamos',
    html: layout(
      title,
      `<p style="font-size:12px;color:#888">${escapeHtml(params.folio)}</p>` +
        `<p>${escapeHtml(en ? 'Hi' : 'Hola')} ${escapeHtml(name)}:</p>` +
        `<p>${escapeHtml(body1)}</p><p>${escapeHtml(body2)}</p>` +
        cta,
    ),
    text:
      `${en ? 'Hi' : 'Hola'} ${name}:\n\n${params.folio}\n\n${title}\n\n${body1}\n\n${body2}\n\n${BRAND}`,
  };
}

/**
 * v1.51 (§11 `SellOfferPublicDTO.terms`) — **el texto legal lo RENDERIZA EL BACKEND**, con las
 * MISMAS plantillas que el correo. La redacción es de ux-ui (DESIGN_SYSTEM §23.4.2); el render es
 * nuestro, para que **la pantalla y el correo no puedan decir cosas distintas**.
 *
 * - `perLineConditionLabel` — la **frase cortísima** que se pinta pegada al monto de cada línea
 *   comprada. Es corta a propósito: se repite N veces y la ceguera por repetición es real; el detalle
 *   vive en `consequence`, en **un solo** bloque destacado.
 * - `consequence` — qué pasa con la carta que no llegue NM (no se compra, no se paga, se devuelve:
 *   7 días a su costo, abandono a 30) **más** que el rechazo de una línea **NO cancela la compra de
 *   las demás y NO reprecia ninguna** (criterio 161b).
 */
export function offerTermsCopy(locale?: string | null): {
  perLineConditionLabel: string;
  consequence: string;
} {
  const en = normalizeLocale(locale) === 'en';
  return {
    perLineConditionLabel: en ? 'only if it arrives Near Mint' : 'siempre que llegue en Near Mint',
    consequence: en
      ? `If a card doesn't arrive Near Mint we don't buy it, we don't pay for it and we send it back: you have 7 days to arrange the return, at your cost, and after 30 days it is considered abandoned. Rejecting one card does NOT cancel the purchase of the others and does NOT change any price: the ones that do arrive Near Mint are paid at the price in this offer.`
      : `Si una carta no llega en Near Mint no se compra, no se paga y te la devolvemos: tienes 7 días para gestionar la devolución, a tu costo, y a los 30 días se considera abandonada. Rechazar una carta NO cancela la compra de las demás y NO cambia el precio de ninguna: las que sí lleguen en Near Mint se pagan al precio de esta oferta.`,
  };
}

/**
 * v1.51 (D36) — una línea legible del **snapshot** de dirección de origen, para el correo de oferta.
 *
 * ⚠️ Lee **el snapshot de la solicitud**, jamás la libreta viva: el vendedor confirmó ESE origen para
 * ESTA solicitud. Es tolerante a la forma porque la columna es `Json?` y las filas legacy pueden
 * traer cualquier cosa: lo que no se pueda leer se omite (**una dirección a medias en un correo es
 * peor que ninguna**).
 */
export function pickupAddressLine(snapshot: unknown): string | null {
  if (snapshot == null || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  const s = snapshot as Record<string, unknown>;
  const parts = ['line1', 'line2', 'neighborhood', 'city', 'state', 'postalCode']
    .map((k) => s[k])
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((v) => v.trim());
  return parts.length > 0 ? parts.join(', ') : null;
}
