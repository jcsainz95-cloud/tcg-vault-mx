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
  // ⚠️ v1.51.15 (§11 `SellItemDTO.condition`) — **UN CUERPO, TRES LECTORES.** La condición por línea y
  // la consecuencia salen de `offerTermsCopy`, **no de literales locales**. Antes había DOS copias
  // byte a byte del mismo texto VINCULANTE (aquí y allá) que solo coincidían por disciplina; el
  // contrato exige que `item.condition` sea **«el MISMO string que usó el correo»** (criterio 161(d):
  // la pantalla de aceptación lo muestra *palabra por palabra*), y eso **no se puede garantizar con
  // dos literales** — se garantiza con una sola fuente. *La copia se cura eliminando la copia.*
  // El texto renderizado NO cambia: los literales eran idénticos. Lo que cambia es que ahora **no
  // pueden divergir** en el próximo cambio de copy.
  const terms = offerTermsCopy(locale, {
    shippingFeeCents: params.shippingFeeCents,
    netCents: params.netCents,
  });
  const condition = terms.perLineConditionLabel;
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
  const consequence = terms.consequence;
  const totalsHtml =
    `<p style="margin:16px 0">` +
    `${escapeHtml(en ? 'Value of the cards' : 'Valor de las cartas')}: <strong>${escapeHtml(money(params.grossCents, l))}</strong><br/>` +
    `${escapeHtml(en ? 'Shipping we cover' : 'Envío que ponemos nosotros')}: − ${escapeHtml(money(params.shippingFeeCents, l))}<br/>` +
    `<strong style="font-size:18px">${escapeHtml(en ? 'DEPOSITED TO YOU' : 'SE TE DEPOSITAN')}: ${escapeHtml(money(params.netCents, l))}</strong></p>`;
  const shippingProse = terms.rule;
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
 * ### ⚠️ v1.51.15 — ESTA FUNCIÓN ES LA FUENTE ÚNICA, y tiene TRES lectores
 * 1. **`SellOfferPublicDTO.terms`** — el bloque legal de la pantalla de aceptación.
 * 2. **El correo de oferta** (`sellOfferTemplate`) — que hasta v1.51.15 llevaba **su propia copia
 *    byte a byte** de estos dos textos. Coincidían **por disciplina**, no por construcción.
 * 3. **`SellItemDTO.condition`** (proyección de CLIENTE) — la condición pegada al monto de cada
 *    línea comprada, que §11 define como *«**el MISMO string que usó el correo**»*.
 *
 * ⚠️ **v1.51.15 · BL-23(2): `rule` necesita LOS MONTOS**, por eso la firma los toma. Se pasan
 * **siempre** desde los dos productores reales (el correo y `offerPublicDTO`), que los tienen
 * congelados en la fila. El `?? 0` del default existe **solo** para los lectores que quieren el texto
 * sin cifras (tests de copy): **una oferta jamás se emite por esa vía** — la guarda de proyección
 * (BL-24) exige `rule` no vacío sobre la proyección REAL, con los montos REALES.
 *
 * El criterio 161(d) exige que la pantalla de aceptación muestre la condición **palabra por
 * palabra**. Con tres literales en tres archivos eso es una promesa que se rompe en el primer cambio
 * de copy y **sin que ningún test lo note**; con un cuerpo, es una propiedad. *Si cambias el texto
 * aquí, cambia en los tres sitios a la vez — que es exactamente lo que el contrato pide.*
 *
 * - `perLineConditionLabel` — la **frase cortísima** que se pinta pegada al monto de cada línea
 *   comprada. Es corta a propósito: se repite N veces y la ceguera por repetición es real; el detalle
 *   vive en `consequence`, en **un solo** bloque destacado.
 * - `consequence` — qué pasa con la carta que no llegue NM (no se compra, no se paga, se devuelve:
 *   7 días a su costo, abandono a 30) **más** que el rechazo de una línea **NO cancela la compra de
 *   las demás y NO reprecia ninguna** (criterio 161b).
 */
export function offerTermsCopy(
  locale?: string | null,
  amounts?: { shippingFeeCents: number; netCents: number },
): {
  perLineConditionLabel: string;
  consequence: string;
  rule: string;
} {
  const l = normalizeLocale(locale);
  const en = l === 'en';
  const shipping = money(amounts?.shippingFeeCents ?? 0, l);
  const net = money(amounts?.netCents ?? 0, l);
  return {
    perLineConditionLabel: en ? 'only if it arrives Near Mint' : 'siempre que llegue en Near Mint',
    consequence: en
      ? `If a card doesn't arrive Near Mint we don't buy it, we don't pay for it and we send it back: you have 7 days to arrange the return, at your cost, and after 30 days it is considered abandoned. Rejecting one card does NOT cancel the purchase of the others and does NOT change any price: the ones that do arrive Near Mint are paid at the price in this offer.`
      : `Si una carta no llega en Near Mint no se compra, no se paga y te la devolvemos: tienes 7 días para gestionar la devolución, a tu costo, y a los 30 días se considera abandonada. Rechazar una carta NO cancela la compra de las demás y NO cambia el precio de ninguna: las que sí lleguen en Near Mint se pagan al precio de esta oferta.`,
    // ⚠️ v1.51.15 · **BL-23(2)** — **LA PROSA DEL DESCUENTO, CON LOS MONTOS YA INTERPOLADOS.**
    // §23.5b obliga al portal a llevarla: bajo D43 **es el único sitio donde el vendedor puede
    // RELEER la resta** (el correo la estrena y el recordatorio no la repite). Vivía solo dentro de
    // la plantilla del correo, así que el frontend **tuvo que duplicarla en su i18n** — la única
    // copia de copy que ese pase se vio obligado a crear (DESIGN_SYSTEM §23.5h la permite **como
    // puente**, y este campo es lo que la deja sin objeto).
    // ⚠️ **Y lo que de verdad cierra: sin el campo, el front interpolaría ÉL los tres montos de una
    // oferta VINCULANTE.** No es copy duplicado, es **la presentación del dinero fabricándose en dos
    // sitios que pueden divergir** — justo lo que §23.5a existe para impedir.
    rule: en
      ? `We provide the shipping label. Its cost, ${shipping}, is a flat fee and is ALWAYS deducted from what we pay you: you pay nothing out of pocket. The amount deposited to you is ${net}.`
      : `Nosotros ponemos la guía de envío. Su costo, ${shipping}, es una tarifa fija y SIEMPRE se descuenta de lo que te pagamos: tú no pagas nada de tu bolsillo. La cifra que se te deposita es ${net}.`,
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

/**
 * v1.51 (§4.39n · DESIGN_SYSTEM §23.4.3/§23.4.4/§23.4.5) — **los correos 2, 3 y 4 del ciclo.**
 *
 * ⚠️ **UN PRODUCTOR POR CORREO, elegido en el CALL-SITE.** Nada de `switch (status)`: `expiredReason`
 * es `null` en dos de los tres productores del 3, así que ramificar sobre datos de la fila
 * **elegiría mal**. El barrido llama a la plantilla que corresponde a **su regla**, y `decline` llama
 * a la del correo 4 — **la misma, con el mismo texto** que la regla 7 (*un correo por hecho, no un
 * correo por camino*).
 */

/** Variante del recordatorio (correo 2). Son **el mismo hecho** con dos acciones distintas. */
export type OfferReminderKind = 'accept' | 'ship';

export interface SellOfferReminderParams {
  kind: OfferReminderKind;
  folio: string;
  /** Nº de cartas compradas — el recordatorio NO re-lista el desglose. */
  buyLineCount: number;
  /** ⚠️ SOLO el neto: es el único monto vinculante, y repetir la resta lo volvería una oferta nueva. */
  netCents: number;
  deadlineAt: Date;
  /** Solo en `ship`: paquetería y número de guía, para que pueda usarlos. */
  carrier?: string | null;
  trackingNumber?: string | null;
  portalUrl?: string;
}

/**
 * **CORREO 2 — EL RECORDATORIO** (D23). *«Te queda un día.»*
 *
 * **UNA SOLA VEZ por plazo** — lo garantiza el barrido sellando `offerAcceptReminderSentAt` /
 * `shipReminderSentAt`, no esta plantilla. *Un segundo recordatorio idéntico destruye la credibilidad
 * del primero.*
 *
 * ### ⚠️ La regla que más fácil se rompe
 * El bloque congelado **repite la condición NM junto a la cifra**. La tentación de un recordatorio es
 * ser «ligero» y quedarse con el monto — y un correo que repite el neto **sin** decir *«siempre que
 * lleguen en Near Mint»* **degrada la condición a letra chica por omisión**, que es exactamente lo
 * que D30 vino a impedir.
 *
 * **No re-lista el desglose:** un recordatorio que repite la tabla completa **se lee como una oferta
 * nueva** y arruina la propiedad más valiosa del ciclo — que hay **una** oferta y **no se edita**.
 * **Mismos números, congelados:** si mostrara un monto o una fecha distintos de los del correo 1,
 * sería un defecto **bloqueante**, no una discrepancia menor.
 */
export function sellOfferReminderTemplate(
  params: SellOfferReminderParams,
  name: string,
  locale?: string | null,
): MailMessage {
  const l = normalizeLocale(locale);
  const en = l === 'en';
  const accept = params.kind === 'accept';
  const deadline = formatDateTime(params.deadlineAt, l);
  const title = accept
    ? en
      ? 'Your offer expires tomorrow'
      : 'Tu oferta vence mañana'
    : en
      ? 'Your package needs to ship tomorrow'
      : 'Tu paquete debe salir mañana';
  // ⚠️ La condición NM viaja PEGADA al conteo de cartas, en una línea corta.
  const frozen = en
    ? `YOUR OFFER · ${params.folio}\n${params.buyLineCount} card(s), only if they arrive Near Mint\nDEPOSITED TO YOU: ${money(params.netCents, l)}\nExpires ${deadline}`
    : `TU OFERTA · ${params.folio}\n${params.buyLineCount} carta(s), siempre que lleguen en Near Mint\nSE TE DEPOSITAN: ${money(params.netCents, l)}\nVence el ${deadline}`;
  const ask = accept
    ? en
      ? 'You still have to respond to the offer.'
      : 'Todavía tienes que responder la oferta.'
    : en
      ? 'Your package still has to be dropped off.'
      : 'Tu paquete todavía tiene que salir.';
  // §P.13: la salida que evita que alguien pierda su venta por una demora NUESTRA.
  const alreadySent = accept
    ? ''
    : en
      ? 'If you already dropped it off, tell us from your account and we stop the clock.'
      : 'Si ya lo depositaste, avísanos desde tu cuenta y detenemos el reloj.';
  const guide =
    !accept && params.trackingNumber
      ? en
        ? `Carrier: ${params.carrier ?? ''} · Tracking: ${params.trackingNumber}`
        : `Paquetería: ${params.carrier ?? ''} · Guía: ${params.trackingNumber}`
      : '';
  const ctaLabel = accept
    ? en
      ? 'View and respond to the offer'
      : 'Ver y responder la oferta'
    : en
      ? 'Go to my request'
      : 'Ir a mi solicitud';
  const cta = params.portalUrl
    ? `<p style="margin:20px 0"><a href="${escapeHtml(params.portalUrl)}" style="background:#111;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block">${escapeHtml(ctaLabel)}</a></p>`
    : `<p style="margin:20px 0"><strong>${escapeHtml(en ? 'Sign in to your account to continue.' : 'Entra a tu cuenta para continuar.')}</strong></p>`;

  return {
    to: '',
    subject: title,
    html: layout(
      title,
      `<p>${escapeHtml(en ? 'Hi' : 'Hola')} ${escapeHtml(name)}:</p>` +
        `<p>${escapeHtml(ask)}</p>` +
        `<div style="background:#EFEBE2;padding:12px;margin:16px 0"><p style="margin:0;font-size:13px;white-space:pre-line">${escapeHtml(frozen)}</p></div>` +
        (guide ? `<p style="font-family:monospace">${escapeHtml(guide)}</p>` : '') +
        (alreadySent ? `<p>${escapeHtml(alreadySent)}</p>` : '') +
        cta,
    ),
    text:
      `${en ? 'Hi' : 'Hola'} ${name}:\n\n${title}\n\n${ask}\n\n${frozen}\n` +
      (guide ? `\n${guide}\n` : '') +
      (alreadySent ? `\n${alreadySent}\n` : '') +
      `\n${BRAND}`,
  };
}

/** Variante del correo 3. **3a** = no respondió la oferta · **3b** = aceptó y el paquete no salió. */
export type SellExpiredKind = 'no_response' | 'not_shipped';

/**
 * **CORREO 3 — EXPIRACIÓN** (barrido, reglas 1 y 2). **Dos productores, un hecho de fondo:** *«se te
 * venció un plazo y la solicitud queda cerrada»*.
 *
 * ⚠️ **SIN MONTOS, ni siquiera en 3b** — donde el monto ya no se va a pagar y mencionarlo **solo
 * duele**. Y **este correo NO lo manda la cancelación de una oferta** (ése es el 5): aquél afirma que
 * *hubo una oferta y **tu** plazo venció*, y en una cancelación **no venció nada** — cancelamos
 * nosotros.
 */
export function sellRequestExpiredTemplate(
  params: { kind: SellExpiredKind; folio: string; closedAt: Date; portalUrl?: string },
  name: string,
  locale?: string | null,
): MailMessage {
  const l = normalizeLocale(locale);
  const en = l === 'en';
  const noResponse = params.kind === 'no_response';
  const when = formatDate(params.closedAt, l);
  const title = noResponse
    ? en
      ? 'Your offer expired'
      : 'Tu oferta venció'
    : en
      ? 'Your sell request expired'
      : 'Tu solicitud de venta venció';
  const body1 = noResponse
    ? en
      ? `The deadline to respond ended on ${when} and the offer is no longer valid. No card was purchased and you have nothing pending.`
      : `El plazo para responder terminó el ${when} y la oferta ya no es válida. No se compró ninguna carta y no tienes nada pendiente.`
    : en
      ? `You accepted the offer, but the package did not ship within the deadline, which ended on ${when}. The request is closed and no card was purchased.`
      : `Aceptaste la oferta, pero el paquete no salió dentro del plazo, que terminó el ${when}. La solicitud queda cerrada y no se compró ninguna carta.`;
  const body2 = en
    ? 'If you still want to sell, you can get a new quote whenever you like.'
    : 'Si sigues queriendo vender, puedes cotizar de nuevo cuando quieras.';
  const ctaLabel = en ? 'Get a new quote' : 'Cotizar de nuevo';
  const cta = params.portalUrl
    ? `<p style="margin:20px 0"><a href="${escapeHtml(params.portalUrl)}" style="background:#111;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block">${escapeHtml(ctaLabel)}</a></p>`
    : '';
  return {
    to: '',
    subject: title,
    html: layout(
      title,
      `<p style="font-size:12px;color:#888">${escapeHtml(params.folio)}</p>` +
        `<p>${escapeHtml(en ? 'Hi' : 'Hola')} ${escapeHtml(name)}:</p>` +
        `<p>${escapeHtml(body1)}</p><p>${escapeHtml(body2)}</p>` +
        cta,
    ),
    text: `${en ? 'Hi' : 'Hola'} ${name}:\n\n${params.folio}\n\n${title}\n\n${body1}\n\n${body2}\n\n${BRAND}`,
  };
}

/**
 * **CORREO 4 — «NO PROCEDEREMOS»** (D33/D39). **DOS productores, UN solo correo:** el barrido (regla
 * 7) y `POST …/decline`. **Misma plantilla, mismo texto** — al vendedor no le corresponde saber si le
 * contestamos rápido o dejamos correr el reloj: *un correo por hecho, no un correo por camino.*
 *
 * ### ⚠️ Es el más corto y el más fácil de arruinar. Su trabajo es CERRAR SIN ACUSAR Y SIN EXPLICAR.
 * **PROHIBIDO aquí, y cada prohibición tiene su razón:**
 * - **Decir POR QUÉ no ofertamos** — abre una negociación que no existe y filtra criterio interno.
 * - **Cualquier referencia al TIEMPO transcurrido** («tras revisar», «después de 7 días», «perdón por
 *   la demora») — delata **por qué camino** se cerró, que es justo lo que la fusión de productores
 *   prohíbe.
 * - **Cualquier MONTO**, ni el total cotizado: nombrarlo junto a «no procederemos» se lee como *«te
 *   íbamos a pagar esto y no lo hicimos»*, y la cotización **nunca fue vinculante**.
 * - **Fórmulas vagas** («no pudimos procesar», «seguimos revisando») — dejan al vendedor esperando.
 * - **Culpar o insinuar incumplimiento**, y **la palabra «venció»**: aquí **no venció nada suyo**. Es
 *   el motivo entero por el que este correo existe separado del 3.
 */
export function sellRequestNotPursuedTemplate(
  params: { folio: string; portalUrl?: string },
  name: string,
  locale?: string | null,
): MailMessage {
  const l = normalizeLocale(locale);
  const en = l === 'en';
  const title = en ? 'We will not proceed with the offer' : 'No vamos a proceder con la oferta';
  const body1 = en
    ? `About your sell request ${params.folio}: we will not proceed with the offer.`
    : `Sobre tu solicitud ${params.folio}: no vamos a proceder con la oferta.`;
  // Lo único que de verdad le sirve saber: que no tiene nada que hacer.
  const body2 = en
    ? "There is nothing pending on your side: don't send any card, no shipping label was generated and you owe us nothing."
    : 'No hay nada pendiente de tu parte: no mandes ninguna carta, no se generó ninguna guía y no nos debes nada.';
  const body3 = en
    ? 'Prices move all the time. You can get a new quote whenever you like.'
    : 'Los precios se mueven todo el tiempo. Puedes volver a cotizar cuando quieras.';
  const ctaLabel = en ? 'Get a new quote' : 'Cotizar de nuevo';
  const cta = params.portalUrl
    ? `<p style="margin:20px 0"><a href="${escapeHtml(params.portalUrl)}" style="background:#111;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block">${escapeHtml(ctaLabel)}</a></p>`
    : '';
  return {
    to: '',
    subject: title,
    html: layout(
      title,
      `<p style="font-size:12px;color:#888">${escapeHtml(params.folio)}</p>` +
        `<p>${escapeHtml(en ? 'Hi' : 'Hola')} ${escapeHtml(name)}:</p>` +
        `<p>${escapeHtml(body1)}</p><p>${escapeHtml(body2)}</p><p>${escapeHtml(body3)}</p>` +
        cta,
    ),
    text: `${en ? 'Hi' : 'Hola'} ${name}:\n\n${params.folio}\n\n${title}\n\n${body1}\n\n${body2}\n\n${body3}\n\n${BRAND}`,
  };
}

/**
 * v1.51.13 · **BL-21** (ARCHITECTURE §4.39n.1) — **la URL del CTA de los correos del ciclo, en UN
 * solo sitio.**
 *
 * ```
 * {origen público}/{locale}/buylist/{sellRequestId}
 * ```
 *
 * ### Por qué vive AQUÍ y no en cada servicio
 * El `{locale}` **no es un adorno ni un default: es EL MISMO valor con el que se renderizó el cuerpo**
 * — sale del mismo `normalizeLocale` que usan las plantillas, tres líneas más arriba. *Un correo
 * tiene UN idioma, y el cuerpo y el botón lo comparten.* Construirlos por vías distintas es
 * exactamente cómo se manda **un correo en inglés cuyo botón abre una pantalla en español**, y sería
 * en el correo donde el vendedor **acepta una oferta vinculante**.
 *
 * ### Las tres cosas que estaban mal antes (y las tres eran independientes)
 * 1. **Sin prefijo de idioma.** El frontend corre con `localePrefix: 'always'` ⇒ `/buylist/...`
 *    redirige a `/es/...` y el vendedor que eligió inglés **aterriza en español**.
 * 2. ~~**Path con forma de API**, no de pantalla~~ ⛔ **CORREGIDO por el arquitecto en v1.51.15
 *    (BL-23.1): esta frase estaba MAL y se podía leer al revés.** **Espejar la ruta del recurso es
 *    BUENO**; lo roto era **la falta del `{locale}`** y **que no existía pantalla detrás**. La
 *    pantalla del portal vive en **`/[locale]/buylist/requests/[id]`**, y v1.51.13 fijó
 *    `/{locale}/buylist/{id}` — backend implementó esa forma, así que **el enlace seguía roto, ahora
 *    por DIVERGENCIA**: mandábamos a una ruta y la pantalla vivía en otra. **Manda la del
 *    frontend**: `/buylist` **no es una colección, es una SECCIÓN** que ya renderiza pantalla propia;
 *    colgarle un `[id]` afirmaría que *todo* lo que hay bajo `/buylist` es una solicitud.
 *    ⚠️ *Sin esta nota, alguien quitaría `requests/` para cumplir una regla que nunca se escribió.*
 * 3. **Era el ÚNICO enlace de correo del proyecto fuera del molde.** Los otros dos (`auth.service` y
 *    `guest-order-mail.service`) son idénticos entre sí y ambos llevan locale: no fue un olvido
 *    puntual, fue **un enlace escrito fuera de un patrón que ya existía**.
 *
 * ### Segmento, no query param
 * El seguimiento de invitado usa `?token=` **porque el token es un SECRETO de URL**. Aquí el
 * `sellRequestId` **no es secreto** (el portal está autenticado y el vendedor ya ve ese id), así que
 * *la razón que obligó al query param allí no existe aquí* y manda la regla normal: **un recurso se
 * direcciona con un segmento**.
 *
 * ### ⚠️ El origen es UN ORIGEN, NO UNA LISTA — y no es el de CORS
 * Sale de la variable **dedicada** `APP_PUBLIC_URL`, cuyo único trabajo es *«la URL pública del
 * frontend»*: un esquema+host(+puerto), **sin path y sin barra final** (se normaliza aquí).
 * **PROHIBIDO rellenarla copiando la allow-list de CORS**, que en producción va separada por comas:
 * produciría `https://a,https://b/es/buylist/...` — **un href roto en un correo de dinero**.
 * *(Los otros dos enlaces del proyecto derivan su origen de `APP_BASE_URL.split(',')[0]`, o sea del
 * primer elemento de esa allow-list. Funciona, pero **el orden de una lista de CORS no significa
 * nada**: reordenarla movería en silencio el origen de todos los correos. Por eso éste sale de la
 * variable dedicada. Footgun heredado, registrado en BL-21; no se migra aquí.)*
 *
 * ### Sin origen configurado ⇒ `undefined`, y el correo SALE IGUAL
 * Las plantillas degradan a **instrucción de texto**. **El correo nunca se bloquea por no poder
 * construir el CTA** —la oferta es vinculante y el vendedor tiene que enterarse— y **jamás se emite
 * un href relativo, parcial o a medias**: o el enlace es completo y correcto, o no hay enlace.
 */
export function buylistPortalUrl(sellRequestId: string, locale?: string | null): string | undefined {
  const origin = envOr(process.env.APP_PUBLIC_URL, '').trim().replace(/\/+$/, '');
  if (!origin) return undefined;
  // ⚠️ EL MISMO normalizador que eligió el idioma del cuerpo, no una cascada paralela.
  // v1.51.15 · BL-23(1): `…/buylist/requests/{id}` — la ruta REAL de la pantalla. Ver el punto 2.
  return `${origin}/${normalizeLocale(locale)}/buylist/requests/${encodeURIComponent(sellRequestId)}`;
}
