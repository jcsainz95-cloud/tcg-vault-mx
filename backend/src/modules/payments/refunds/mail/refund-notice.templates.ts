/**
 * §R.3 (v1.80…v1.80.3) — los CINCO avisos del dinero que vuelve y de la CLABE: `AV-12` (carta que no salió,
 * reembolsada; variante `case_refund`), `AV-13` (carta de tu retiro por reponer), `AV-14` (te vamos a
 * depositar por transferencia), `AV-15` (ya te depositamos), `AV-16` (se actualizó la CLABE de tu cuenta).
 *
 * Plantillas LOCALES al dueño del hecho (el libro de reembolsos vive en `payments`), sobre el MISMO shell
 * que los demás correos (`buylist/mail-shell`, §31). Reglas §R.4/§R.5 que estas plantillas cumplen POR FORMA:
 *  - ⛔ Nunca actor, componentes, `failureCode`, motivo interno (`reason`), referencias de mercado, ni la
 *    CLABE en claro (solo su máscara). Reciben CAMPOS SUELTOS, jamás la fila (criterio 209).
 *  - ES/EN por `locale` del destinatario.
 */
import { MailMessage } from '../../../mail/mail.port';
import {
  appUrl,
  ctaRows,
  eyebrowRow,
  headingRow,
  mailShell,
  monoRow,
  proseRow,
  ruleRow,
  smallPrintRow,
  spacerRow,
  totalsRows,
} from '../../../buylist/mail-shell';

type Locale = 'es' | 'en';

function normalizeLocale(locale?: string | null): Locale {
  return locale === 'en' ? 'en' : 'es';
}

const BRAND = 'TCG HUNT';

function money(cents: number, locale: Locale): string {
  return new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

function footerWhy(en: boolean): string {
  return en
    ? 'You are receiving this email because you have an order or a shipment with us.'
    : 'Recibes este correo porque tienes un pedido o un envío con nosotros.';
}

function reasonText(reason: 'not_found' | 'damaged', en: boolean): string {
  if (reason === 'damaged') return en ? 'it arrived damaged' : 'llegó dañada';
  return en ? 'we could not find it' : 'no la encontramos';
}

/** Una carta que se devuelve: qué carta, por qué, cuánto. ⛔ Sin actor ni componentes. */
export interface RefundedCardLine {
  name: string;
  setName: string | null;
  reason: 'not_found' | 'damaged' | null;
  amountCents: number;
}

export interface Av12Params {
  /** Número de pedido o folio del retiro (lo que el cliente reconoce). */
  reference: string;
  /** `null` ⇒ es un retiro de bóveda (el enlace va a «Mi bóveda › retiros»). */
  orderNumber: string | null;
  /** v1.80 (hueco 5 / N-8): el DETALLE del pedido (`/orders/{id}`), ⛔ nunca la lista. */
  orderId?: string | null;
  /**
   * 🔒 v1.80.12.16 (§M4-SHIP.19.35.1): el enlace del CTA de un PEDIDO, resuelto por el SERVICIO (`orderMailLinkOf`): `orders/<id>`
   * para registrado/reclamado, `pedido?token=…` para el invitado, `null` ⇒ SIN CTA (pedido fuera del tope de edad o emisión fallida).
   * Ausente (`undefined`) ⇒ el enlace de siempre (retiro o llamador legacy).
   */
  customerUrl?: string | null;
  cards: RefundedCardLine[];
  /** Cierre: no sale nada y se devolvió todo (incluye el envío). */
  nothingShips: boolean;
  /** Variante `case_refund` (§M4-SHIP.15.7): «no pudimos reponer tu carta». */
  variant: 'item_missing' | 'case_refund';
  totalCents: number;
}

/** `AV-12` — Carta que no salió, reembolsada. Un correo por acto (agrupa las filas reclamadas). */
export function refundNoticeTemplate(params: Av12Params, locale?: string | null): Omit<MailMessage, 'to'> {
  const l = normalizeLocale(locale);
  const en = l === 'en';
  const isCase = params.variant === 'case_refund';
  const title = isCase
    ? en
      ? 'We could not replace your card, so we refunded it'
      : 'No pudimos reponer tu carta y te devolvimos su valor'
    : params.nothingShips
      ? en
        ? 'Your order could not ship: we refunded it in full'
        : 'Tu pedido no pudo salir: te devolvimos todo'
      : en
        ? 'A card did not ship: we refunded it'
        : 'Una carta no salió: te devolvimos su dinero';
  const lines = params.cards.map((c) => {
    const why = c.reason ? ` (${reasonText(c.reason, en)})` : '';
    const set = c.setName ? ` · ${c.setName}` : '';
    return `${c.name}${set}${why}: ${money(c.amountCents, l)}`;
  });
  const intro = isCase
    ? en
      ? 'We looked for an identical replacement and could not get one. We are returning its value to you.'
      : 'Buscamos reponerla con una idéntica y no la conseguimos. Te devolvemos su valor.'
    : en
      ? 'While preparing your package we found that the card(s) below could not ship.'
      : 'Al preparar tu paquete encontramos que la(s) carta(s) de abajo no podía(n) salir.';
  const rest = params.nothingShips
    ? en
      ? 'Nothing else ships: we refunded the full amount, shipping included.'
      : 'No sale nada más: te devolvimos el importe completo, envío incluido.'
    : en
      ? 'The rest of your order continues on its way.'
      : 'El resto de tu pedido sigue su curso.';
  const bankNote = en
    ? 'Your bank decides when it shows up; it usually takes a few business days.'
    : 'Tu banco decide cuándo aparece; suele tardar unos días hábiles.';
  const totalLabel = en ? 'REFUNDED' : 'TE DEVOLVIMOS';
  const total = money(params.totalCents, l);
  // N-8 (DESIGN_SYSTEM §37.7): `/orders/{id}` para un pedido; `/vault?tab=withdrawals` para un retiro. ⛔ Ningún enlace a lista.
  const url =
    params.customerUrl !== undefined
      ? (params.customerUrl ?? undefined)
      : params.orderNumber
        ? appUrl(params.orderId ? `orders/${params.orderId}` : 'orders', l)
        : appUrl('vault?tab=withdrawals', l);
  const ctaLabel = params.orderNumber ? (en ? 'SEE MY ORDER' : 'VER MI PEDIDO') : en ? 'SEE MY SHIPMENT' : 'VER MI ENVÍO';
  const blocks = [
    eyebrowRow(params.orderNumber ? (en ? 'YOUR ORDER' : 'TU PEDIDO') : en ? 'YOUR SHIPMENT' : 'TU ENVÍO', params.reference),
    headingRow(title, 22),
    spacerRow(24),
    proseRow(intro),
    spacerRow(16),
    ...lines.map((t) => monoRow(t)),
    spacerRow(24),
    ruleRow(),
    spacerRow(24),
    totalsRows([], { label: totalLabel, amount: total }),
    spacerRow(16),
    proseRow(rest),
    spacerRow(24),
    smallPrintRow(bankNote),
    spacerRow(32),
    ...(url ? [ctaRows(url, ctaLabel, 'ink')] : []),
  ];
  return {
    subject: en ? `${BRAND} — Refund for ${params.reference}` : `${BRAND} — Reembolso de ${params.reference}`,
    html: mailShell({ locale: l, title, preheader: `${title}. ${totalLabel}: ${total}`, blocks, footerWhy: footerWhy(en) }),
    text: [title, '', intro, '', ...lines, '', `${totalLabel}: ${total}`, '', rest, '', bankNote, ...(url ? ['', url] : []), '', BRAND].join('\n'),
  };
}

export interface Av13Params {
  shipmentId: string;
  cards: { name: string; setName: string | null; reason: 'not_found' | 'damaged' }[];
}

/** `AV-13` — Carta de tu RETIRO por reponer: la estamos reponiendo; el envío sale completo cuando la tengamos. */
export function replacementPendingTemplate(params: Av13Params, locale?: string | null): Omit<MailMessage, 'to'> {
  const l = normalizeLocale(locale);
  const en = l === 'en';
  const title = en ? 'One of your cards is being replaced' : 'Estamos reponiendo una carta de tu retiro';
  const intro = en
    ? 'While preparing your shipment we found the card(s) below could not go out as they are.'
    : 'Al preparar tu envío encontramos que la(s) carta(s) de abajo no podía(n) salir así.';
  const lines = params.cards.map((c) => `${c.name}${c.setName ? ` · ${c.setName}` : ''} (${reasonText(c.reason, en)})`);
  const plan = en
    ? 'We are getting you an identical one. Your shipment leaves complete as soon as we have it; if we cannot get one, we will refund its value to you.'
    : 'Te estamos consiguiendo una idéntica. Tu envío sale completo en cuanto la tengamos; si no la conseguimos, te devolvemos su valor.';
  const url = appUrl('vault?tab=withdrawals', l);
  const blocks = [
    eyebrowRow(en ? 'YOUR SHIPMENT' : 'TU ENVÍO', params.shipmentId),
    headingRow(title, 22),
    spacerRow(24),
    proseRow(intro),
    spacerRow(16),
    ...lines.map((t) => monoRow(t)),
    spacerRow(24),
    proseRow(plan),
    spacerRow(32),
    ...(url ? [ctaRows(url, en ? 'SEE MY SHIPMENT' : 'VER MI ENVÍO', 'ink')] : []),
  ];
  return {
    subject: en ? `${BRAND} — Your shipment is delayed: we are replacing a card` : `${BRAND} — Tu envío se retrasa: estamos reponiendo una carta`,
    html: mailShell({ locale: l, title, preheader: intro, blocks, footerWhy: footerWhy(en) }),
    text: [title, '', intro, '', ...lines, '', plan, ...(url ? ['', url] : []), '', BRAND].join('\n'),
  };
}

export interface Av14Params {
  transferCents: number;
  cardCents: number;
  /** Máscara de la CLABE registrada (`maskClabe`), o `null` si no tiene. ⛔ Nunca la CLABE entera. */
  clabeMasked: string | null;
}

/** `AV-14` — Te vamos a depositar por transferencia (y cómo registrar la CLABE si no la tiene). */
export function manualRefundAnnouncedTemplate(params: Av14Params, locale?: string | null): Omit<MailMessage, 'to'> {
  const l = normalizeLocale(locale);
  const en = l === 'en';
  const title = en ? 'We will deposit your refund by bank transfer' : 'Te vamos a depositar por transferencia';
  const intro = en
    ? 'We could not replace your card. We are refunding its value, and part of it goes by bank transfer (SPEI).'
    : 'No pudimos reponer tu carta. Te devolvemos su valor y una parte va por transferencia (SPEI).';
  const amounts = [
    `${en ? 'BY TRANSFER' : 'POR TRANSFERENCIA'}: ${money(params.transferCents, l)}`,
    ...(params.cardCents > 0 ? [`${en ? 'BACK TO YOUR CARD' : 'REGRESA A TU TARJETA'}: ${money(params.cardCents, l)}`] : []),
  ];
  const clabeLine = params.clabeMasked
    ? en
      ? `We will deposit to your registered CLABE ending ${params.clabeMasked.slice(-4)}.`
      : `Depositaremos a tu CLABE registrada, terminación ${params.clabeMasked.slice(-4)}.`
    : en
      ? 'You have no CLABE on file: please register it in your account so we can deposit.'
      : 'No tienes una CLABE registrada: regístrala en tu cuenta para poder depositarte.';
  const url = params.clabeMasked ? appUrl('account', l) : appUrl('account#kyc', l);
  const blocks = [
    eyebrowRow(en ? 'YOUR REFUND' : 'TU REEMBOLSO'),
    headingRow(title, 22),
    spacerRow(24),
    proseRow(intro),
    spacerRow(16),
    ...amounts.map((t) => monoRow(t)),
    spacerRow(24),
    proseRow(clabeLine),
    spacerRow(32),
    ...(url ? [ctaRows(url, params.clabeMasked ? (en ? 'MY ACCOUNT' : 'MI CUENTA') : en ? 'REGISTER MY CLABE' : 'REGISTRAR MI CLABE', params.clabeMasked ? 'ink' : 'accent')] : []),
  ];
  return {
    subject: en ? `${BRAND} — We will deposit your refund` : `${BRAND} — Te vamos a depositar tu reembolso`,
    html: mailShell({ locale: l, title, preheader: intro, blocks, footerWhy: footerWhy(en) }),
    text: [title, '', intro, '', ...amounts, '', clabeLine, ...(url ? ['', url] : []), '', BRAND].join('\n'),
  };
}

export interface Av15Params {
  transferCents: number;
  /** Clave de rastreo SPEI; `null` si el dueño no la capturó (D-11). */
  speiReference: string | null;
}

/** `AV-15` — Ya te depositamos (monto y clave de rastreo si la hay). */
export function manualRefundPaidTemplate(params: Av15Params, locale?: string | null): Omit<MailMessage, 'to'> {
  const l = normalizeLocale(locale);
  const en = l === 'en';
  const title = en ? 'We deposited your refund' : 'Ya te depositamos tu reembolso';
  const amount = `${en ? 'DEPOSITED' : 'TE DEPOSITAMOS'}: ${money(params.transferCents, l)}`;
  const ref = params.speiReference
    ? en
      ? `SPEI tracking key: ${params.speiReference} (with it you can download the receipt at Banxico's CEP site).`
      : `Clave de rastreo SPEI: ${params.speiReference} (con ella descargas el comprobante en el CEP de Banxico).`
    : en
      ? 'Your bank decides when it shows up; it usually takes minutes, at most one business day.'
      : 'Tu banco decide cuándo aparece; suele ser en minutos, a lo más un día hábil.';
  const url = appUrl('account', l);
  const blocks = [
    eyebrowRow(en ? 'YOUR REFUND' : 'TU REEMBOLSO'),
    headingRow(title, 22),
    spacerRow(24),
    monoRow(amount),
    spacerRow(24),
    proseRow(ref),
    spacerRow(32),
    ...(url ? [ctaRows(url, en ? 'MY ACCOUNT' : 'MI CUENTA', 'ink')] : []),
  ];
  return {
    subject: en ? `${BRAND} — Your refund was deposited` : `${BRAND} — Tu reembolso ya fue depositado`,
    html: mailShell({ locale: l, title, preheader: amount, blocks, footerWhy: footerWhy(en) }),
    text: [title, '', amount, '', ref, ...(url ? ['', url] : []), '', BRAND].join('\n'),
  };
}

export interface Av16Params {
  previousMasked: string | null;
  newMasked: string;
  changedAt: Date;
}

/** `AV-16` — Se actualizó la CLABE de tu cuenta (máscara anterior o «no tenías», nueva, fecha). */
export function clabeChangedTemplate(params: Av16Params, locale?: string | null): Omit<MailMessage, 'to'> {
  const l = normalizeLocale(locale);
  const en = l === 'en';
  const title = en ? 'The CLABE on your account was updated' : 'Se actualizó la CLABE de tu cuenta';
  const when = params.changedAt.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  const before = params.previousMasked
    ? `${en ? 'Previous' : 'Anterior'}: ${params.previousMasked}`
    : en
      ? 'Previous: you had no CLABE on file'
      : 'Anterior: no tenías CLABE registrada';
  const after = `${en ? 'New' : 'Nueva'}: ${params.newMasked}`;
  const warn = en
    ? 'If this was not you, write to support right away.'
    : 'Si no fuiste tú, escríbenos de inmediato a soporte.';
  const url = appUrl('account#kyc', l);
  const blocks = [
    eyebrowRow(en ? 'YOUR ACCOUNT' : 'TU CUENTA'),
    headingRow(title, 22),
    spacerRow(24),
    proseRow(en ? `On ${when} the CLABE where we deposit to you changed.` : `El ${when} cambió la CLABE a la que te depositamos.`),
    spacerRow(16),
    monoRow(before),
    monoRow(after),
    spacerRow(24),
    smallPrintRow(warn),
    spacerRow(32),
    ...(url ? [ctaRows(url, en ? 'REVIEW MY ACCOUNT' : 'REVISAR MI CUENTA', 'accent')] : []),
  ];
  return {
    subject: en ? `${BRAND} — Your CLABE was updated` : `${BRAND} — Se actualizó tu CLABE`,
    html: mailShell({ locale: l, title, preheader: `${after}. ${warn}`, blocks, footerWhy: footerWhy(en) }),
    text: [title, '', before, after, '', when, '', warn, ...(url ? ['', url] : []), '', BRAND].join('\n'),
  };
}
