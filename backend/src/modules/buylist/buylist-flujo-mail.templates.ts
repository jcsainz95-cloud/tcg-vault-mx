import { Finish } from '@prisma/client';
import { MailMessage } from '../mail/mail.port';
import {
  cardLineRows,
  ctaRows,
  eyebrowRow,
  headingRow,
  mailShell,
  proseRow,
  ruleRow,
  smallPrintRow,
  spacerRow,
  termsBoxRows,
} from './mail-shell';
import { BRAND, FINISH_LABELS, formatDate, formatDateTime, money, normalizeLocale, sellRequestFooterWhy } from './buylist-mail.templates';

/**
 * §BUYLIST-FLUJO F2 (docs/API_CONTRACT_BUYLIST_FLUJO.md §4 y §7) — correos C1 («Tus cartas te esperan») y C2 («No llegó»).
 * Mismo esqueleto `mail-shell` y misma norma de minimizacion que `buylist-mail.templates.ts` (§4.18c): solo carta, causa, montos
 * DE ESA linea y plazos; ⛔ domicilio del vendedor, CLABE, datos de terceros, montos de otras solicitudes, cifras de la mesa.
 * La direccion que SI sale es la de la TIENDA (`skydropx_origin_snapshot`, §DIR-TIENDA); sin ella el correo lo dice, no la inventa.
 */

export type FlujoCause = 'condition_mismatch' | 'wrong_card' | 'other' | 'revision_declined' | 'revision_expired';

export interface FlujoCard {
  cardName: string;
  setName: string;
  cardNumber: string;
  finish: Finish;
}

export interface PickupCardLine extends FlujoCard {
  cause: FlujoCause;
  /** Condicion que declaro el vendedor (solo `condition_mismatch`), ya legible. */
  declaredCondition?: string | null;
  /** Nota del dueño: obligatoria en `other`, opcional en `wrong_card`. */
  note?: string | null;
  /** `revision_*`: nuestra propuesta y la oferta original, en centavos de ESA linea. */
  proposedCents?: number | null;
  offeredCents?: number | null;
}

export interface SellItemsPickupParams {
  folio: string;
  cards: PickupCardLine[];
  /** Direccion de la tienda ya compuesta; `null` ⇒ «te confirmaremos la direccion al responder». */
  storeAddress: string | null;
  /** Enlace a la solicitud del portal (`buylistPortalUrl`); `undefined` ⇒ el correo dice «responde este correo». */
  portalUrl?: string;
  returnDeadlineAt: Date;
  abandonDeadlineAt: Date;
  /** Dias de respuesta de una baja (solo para el texto de `revision_expired`). */
  responseDays: number;
  /** `true` ⇒ con esto no quedo ninguna carta viva y la solicitud se cerro. */
  requestClosed: boolean;
}

const cardLabel = (c: FlujoCard) => `${c.cardName} (${c.setName} · #${c.cardNumber})`;

function causeSentence(c: PickupCardLine, en: boolean, locale: 'es' | 'en', responseDays: number): string {
  const card = cardLabel(c);
  switch (c.cause) {
    case 'condition_mismatch': {
      const d = c.declaredCondition ? ` (${c.declaredCondition})` : '';
      return en
        ? `${card} arrived in a different condition than the one you declared${d}, so we did not include it in the payment.`
        : `${card} llegó en una condición distinta a la que declaraste${d}, por eso no la incluimos en el pago.`;
    }
    case 'wrong_card': {
      const n = c.note ? ` (${c.note})` : '';
      return en
        ? `Instead of ${card} there was a different card${n}, so we did not include it in the payment.`
        : `En lugar de ${card} venía otra carta${n}, por eso no la incluimos en el pago.`;
    }
    case 'other':
      return `${card}: ${c.note ?? ''}`.trim();
    case 'revision_declined': {
      const prop = money(c.proposedCents ?? 0, locale);
      const orig = money(c.offeredCents ?? 0, locale);
      return en
        ? `We did not reach an agreement on the price of ${card} (our proposal: ${prop}; your original offer: ${orig}).`
        : `No llegamos a un acuerdo en el precio de ${card} (nuestra propuesta: ${prop}; tu oferta original: ${orig}).`;
    }
    case 'revision_expired': {
      const prop = money(c.proposedCents ?? 0, locale);
      return en
        ? `We did not receive your reply to the ${prop} proposal for ${card} within ${responseDays} days, so we did not buy it.`
        : `No recibimos tu respuesta a la propuesta de ${prop} por ${card} en ${responseDays} días, así que no la compramos.`;
    }
  }
}

/**
 * **C1 — «TUS CARTAS TE ESPERAN»** (anexo §4/§7). UN correo por solicitud con todas las lineas no aceptadas en ese acto: la causa
 * de cada una y el bloque de recoger (en persona, gratis, en la tienda; o envio a cargo del vendedor) con sus dos fechas.
 * Reemplaza el texto de «devolucion a tu costo» solo para rechazos con `rejectionCode` (los legacy siguen con el correo 4/29).
 */
export function sellItemsPickupTemplate(params: SellItemsPickupParams, name: string, locale?: string | null): MailMessage {
  const l = normalizeLocale(locale);
  const en = l === 'en';
  const n = params.cards.length;
  const one = n === 1;
  const returnDate = formatDate(params.returnDeadlineAt, l);
  const abandonDate = formatDate(params.abandonDeadlineAt, l);

  const subject = en
    ? one
      ? 'Your card is waiting for you'
      : `Your ${n} cards are waiting for you`
    : one
      ? 'Tu carta te espera'
      : `Tus ${n} cartas te esperan`;
  const eyebrow = en ? (one ? 'CARD NOT ACCEPTED' : 'CARDS NOT ACCEPTED') : one ? 'CARTA NO ACEPTADA' : 'CARTAS NO ACEPTADAS';
  const title = en ? 'Your cards are waiting for you' : 'Tus cartas te esperan';
  const intro = en
    ? `When we checked your package (request ${params.folio}) we did not accept ${one ? 'this card' : 'these cards'}:`
    : `Al revisar tu paquete (solicitud ${params.folio}) no aceptamos ${one ? 'esta carta' : 'estas cartas'}:`;
  const causes = params.cards.map((c) => causeSentence(c, en, l, params.responseDays));
  const where = params.storeAddress
    ? params.storeAddress
    : en
      ? "the store (we'll confirm the address when you reply)"
      : 'la tienda (te confirmaremos la dirección al responder)';
  const choose = params.portalUrl
    ? en
      ? ` Choose here: ${params.portalUrl}.`
      : ` Elige aquí: ${params.portalUrl}.`
    : en
      ? ' Choose by replying to this email.'
      : ' Elige respondiendo este correo.';
  const pickupLabel = en ? 'YOUR CARDS ARE WAITING' : 'TUS CARTAS TE ESPERAN';
  const pickup1 = en
    ? `You can pick ${one ? 'it' : 'them'} up at ${where} at no cost (reply to this email and we'll agree on a day and time) or ask us to ship ${one ? 'it' : 'them'} to you at your own cost.${choose}`
    : `Puedes pasar por ${one ? 'ella' : 'ellas'} a ${where} sin costo (responde este correo y acordamos día y hora) o pedir que te ${one ? 'la' : 'las'} enviemos a tu cargo.${choose}`;
  const pickup2 = en
    ? `You have until ${returnDate} to choose and until ${abandonDate} to pick ${one ? 'it' : 'them'} up; after that date ${one ? 'it is' : 'they are'} considered abandoned.`
    : `Tienes hasta el ${returnDate} para elegir y hasta el ${abandonDate} para ${one ? 'recogerla' : 'recogerlas'}; pasada esa fecha ${one ? 'se considera abandonada' : 'se consideran abandonadas'}.`;
  const closing = params.requestClosed
    ? en
      ? "As we didn't accept any card, your request is closed and there is no payment."
      : 'Como no aceptamos ninguna carta, tu solicitud queda cerrada y no hay pago.'
    : en
      ? "The other cards in your request are not changed by this email."
      : 'Las demás cartas de tu solicitud no cambian con este correo.';

  const cardBlocks = params.cards.flatMap((c, i) => [
    ...(i > 0 ? [spacerRow(16)] : []),
    cardLineRows({ title: c.cardName, meta: `${c.setName} · #${c.cardNumber} · ${FINISH_LABELS[c.finish] ?? c.finish}` }),
  ]);
  const blocks = [
    eyebrowRow(eyebrow, params.folio),
    headingRow(title, 22),
    spacerRow(24),
    proseRow(`${en ? 'Hi' : 'Hola'} ${name}${en ? ',' : ':'}`),
    spacerRow(16),
    proseRow(intro),
    spacerRow(24),
    ruleRow(),
    spacerRow(16),
    ...cardBlocks,
    spacerRow(16),
    ruleRow(),
    spacerRow(24),
    ...causes.flatMap((t, i) => [...(i > 0 ? [spacerRow(8)] : []), proseRow(t)]),
    spacerRow(32),
    termsBoxRows(pickupLabel, [pickup1, pickup2]),
    spacerRow(32),
    smallPrintRow(closing),
  ];
  const text =
    `${en ? `Hi ${name},` : `Hola ${name}:`}\n\n${eyebrow} · ${params.folio}\n\n${title}\n\n${intro}\n` +
    `${params.cards.map((c) => `- ${cardLabel(c)} (${en ? 'Finish' : 'Acabado'}: ${FINISH_LABELS[c.finish] ?? c.finish})`).join('\n')}\n\n` +
    `${causes.join('\n')}\n\n${pickupLabel}\n- ${pickup1}\n- ${pickup2}\n\n${closing}\n\n${BRAND}`;
  return {
    to: '',
    subject,
    html: mailShell({ locale: l, title, preheader: intro, blocks, footerWhy: sellRequestFooterWhy(en) }),
    text,
  };
}

export interface SellItemNotReceivedParams {
  folio: string;
  card: FlujoCard;
  /** `true` ⇒ la solicitud se cerro sin pago. */
  requestClosed: boolean;
  /** `true` ⇒ la oferta anuncio un envio que se descuenta del pago (D25). */
  hasShippingFee: boolean;
}

/**
 * **C2 — «NO LLEGÓ»** (anexo §4, variante sin recoger). Dice que la carta no venia en el paquete, que no entra al pago, y que
 * no hay nada que devolver: ⛔ sin plazos, ⛔ sin «recoger», ⛔ sin promesa de devolucion. Invita a responder con la guia si el
 * vendedor cree que si la mando.
 */
export function sellItemNotReceivedTemplate(params: SellItemNotReceivedParams, name: string, locale?: string | null): MailMessage {
  const l = normalizeLocale(locale);
  const en = l === 'en';
  const card = cardLabel(params.card);
  const title = en ? "A card didn't arrive" : 'Una carta no llegó';
  const eyebrow = en ? 'CARD NOT RECEIVED' : 'CARTA NO RECIBIDA';
  const intro = en
    ? `We checked your package (request ${params.folio}) and ${card} was not inside.`
    : `Revisamos tu paquete (solicitud ${params.folio}) y ${card} no venía dentro.`;
  const payment = params.requestClosed
    ? en
      ? "We did not include it in the payment. As we didn't accept any card, your request is closed and there is no payment."
      : 'No la incluimos en el pago. Como no aceptamos ninguna carta, tu solicitud queda cerrada y no hay pago.'
    : params.hasShippingFee
      ? en
        ? 'We did not include it in the payment: you will be paid for the rest, minus the shipping you accepted.'
        : 'No la incluimos en el pago: se te deposita el resto, menos el envío que aceptaste.'
      : en
        ? 'We did not include it in the payment: you will be paid for the rest.'
        : 'No la incluimos en el pago: se te deposita el resto.';
  const nothing = en
    ? "Since we didn't receive it, we have nothing to return to you."
    : 'Como no la recibimos, no tenemos nada que devolverte.';
  const reply = en
    ? 'If you believe you did send it, reply to this email with your tracking number.'
    : 'Si crees que sí la mandaste, responde este correo con tu guía.';
  const blocks = [
    eyebrowRow(eyebrow, params.folio),
    headingRow(title, 22),
    spacerRow(24),
    proseRow(`${en ? 'Hi' : 'Hola'} ${name}${en ? ',' : ':'}`),
    spacerRow(16),
    proseRow(intro),
    spacerRow(16),
    ruleRow(),
    spacerRow(16),
    cardLineRows({
      title: params.card.cardName,
      meta: `${params.card.setName} · #${params.card.cardNumber} · ${FINISH_LABELS[params.card.finish] ?? params.card.finish}`,
    }),
    spacerRow(16),
    ruleRow(),
    spacerRow(24),
    proseRow(payment),
    spacerRow(16),
    proseRow(nothing),
    spacerRow(16),
    proseRow(reply),
  ];
  const text = `${en ? `Hi ${name},` : `Hola ${name}:`}\n\n${eyebrow} · ${params.folio}\n\n${title}\n\n${intro}\n\n${payment}\n${nothing}\n${reply}\n\n${BRAND}`;
  return {
    to: '',
    subject: en ? 'A card in your sell request did not arrive' : 'Una carta de tu solicitud de venta no llegó',
    html: mailShell({ locale: l, title, preheader: intro, blocks, footerWhy: sellRequestFooterWhy(en) }),
    text,
  };
}

export interface SellItemRevisionParams {
  folio: string;
  card: FlujoCard;
  /** Lo ofertado y lo propuesto, en centavos DE ESTA linea (nunca de otras). */
  offeredCents: number;
  proposedCents: number;
  cause: 'condition_mismatch' | 'wrong_card' | 'other';
  declaredCondition?: string | null;
  note?: string | null;
  /** `revisionProposedAt` + 7 d; la plantilla ⛔ no suma dias: lo recibe. */
  expiresAt: Date;
  responseDays: number;
  /** Enlace a la solicitud del portal (ahi estan Aceptar/Rechazar); sin el, el correo lo dice. */
  portalUrl?: string;
  /** `true` ⇒ C4 (recordatorio del mismo pedido). */
  reminder: boolean;
}

/**
 * **C3 — «PROPUESTA DE NUEVO PRECIO»** y **C4** (su recordatorio) (anexo §7). La carta, el precio original, el propuesto, la causa,
 * el vencimiento (fecha y hora, nunca «en N dias» suelto) y dos botones (Aceptar/Rechazar) que llevan al portal: la respuesta
 * NUNCA se ejecuta desde un enlace anonimo (misma regla que la oferta). Dice con todas sus letras que sin «si» no se paga menos.
 */
export function sellItemRevisionTemplate(params: SellItemRevisionParams, name: string, locale?: string | null): MailMessage {
  const l = normalizeLocale(locale);
  const en = l === 'en';
  const card = cardLabel(params.card);
  const when = formatDateTime(params.expiresAt, l);
  const orig = money(params.offeredCents, l);
  const prop = money(params.proposedCents, l);
  const subject = params.reminder
    ? en
      ? 'Reminder: your answer on the new price for a card expires soon'
      : 'Recordatorio: tu respuesta sobre el nuevo precio de una carta vence pronto'
    : en
      ? 'We propose a new price for a card in your sell request'
      : 'Te proponemos un nuevo precio por una carta de tu solicitud';
  const eyebrow = en ? 'NEW PRICE PROPOSAL' : 'PROPUESTA DE NUEVO PRECIO';
  const title = params.reminder
    ? en
      ? 'Your answer expires soon'
      : 'Tu respuesta vence pronto'
    : en
      ? 'We propose a new price'
      : 'Te proponemos un nuevo precio';
  const intro = params.reminder
    ? en
      ? `We are reminding you that you have not answered our new price proposal for ${card} (request ${params.folio}).`
      : `Te recordamos que aún no respondes nuestra propuesta de nuevo precio por ${card} (solicitud ${params.folio}).`
    : en
      ? `When we checked your package (request ${params.folio}) we found a difference in ${card}.`
      : `Al revisar tu paquete (solicitud ${params.folio}) encontramos una diferencia en ${card}.`;
  const d = params.declaredCondition ? ` (${params.declaredCondition})` : '';
  const n = params.note ? ` (${params.note})` : '';
  const causeLine =
    params.cause === 'condition_mismatch'
      ? en
        ? `It arrived in a different condition than the one you declared${d}.`
        : `Llegó en una condición distinta a la que declaraste${d}.`
      : params.cause === 'wrong_card'
        ? en
          ? `A different card than the declared one arrived${n}.`
          : `Llegó una carta distinta a la declarada${n}.`
        : (params.note ?? '');
  const priceOriginal = en ? `Original offer price: ${orig}` : `Precio original de tu oferta: ${orig}`;
  const priceProposed = en ? `Price we propose: ${prop}` : `Precio que te proponemos: ${prop}`;
  const termsLabel = en ? 'YOUR DECISION' : 'TU DECISIÓN';
  const terms1 = en
    ? `You have ${params.responseDays} days: until ${when}. Accept or reject from your request; we never pay a lower price without your yes.`
    : `Tienes ${params.responseDays} días: hasta el ${when}. Acepta o rechaza desde tu solicitud; nunca pagamos un precio menor sin tu «sí».`;
  const terms2 = en
    ? "If you don't answer, we will not buy this card and it will be ready for you to pick up."
    : 'Si no respondes, no compraremos esta carta y quedará lista para que la recojas.';
  const noLink = en ? 'Answer from your sell request in your account.' : 'Responde desde tu solicitud, en tu cuenta.';
  const labelAccept = en ? 'ACCEPT THE NEW PRICE' : 'ACEPTAR EL NUEVO PRECIO';
  const labelReject = en ? 'REJECT' : 'RECHAZAR';
  const blocks = [
    eyebrowRow(eyebrow, params.folio),
    headingRow(title, 22),
    spacerRow(24),
    proseRow(`${en ? 'Hi' : 'Hola'} ${name}${en ? ',' : ':'}`),
    spacerRow(16),
    proseRow(intro),
    spacerRow(24),
    ruleRow(),
    spacerRow(16),
    cardLineRows({
      title: params.card.cardName,
      meta: `${params.card.setName} · #${params.card.cardNumber} · ${FINISH_LABELS[params.card.finish] ?? params.card.finish}`,
    }),
    spacerRow(16),
    ruleRow(),
    spacerRow(24),
    ...(causeLine ? [proseRow(causeLine), spacerRow(16)] : []),
    proseRow(priceOriginal),
    spacerRow(8),
    proseRow(priceProposed),
    spacerRow(32),
    termsBoxRows(termsLabel, [terms1, terms2]),
    spacerRow(32),
    ...(params.portalUrl
      ? [ctaRows(params.portalUrl, labelAccept, 'accent'), spacerRow(8), ctaRows(params.portalUrl, labelReject, 'ink')]
      : [smallPrintRow(noLink)]),
  ];
  const text =
    `${en ? `Hi ${name},` : `Hola ${name}:`}\n\n${eyebrow} · ${params.folio}\n\n${title}\n\n${intro}\n${causeLine}\n\n` +
    `${priceOriginal}\n${priceProposed}\n\n${termsLabel}\n- ${terms1}\n- ${terms2}\n\n` +
    `${params.portalUrl ? `${labelAccept} / ${labelReject}: ${params.portalUrl}` : noLink}\n\n${BRAND}`;
  return {
    to: '',
    subject,
    html: mailShell({ locale: l, title, preheader: intro, blocks, footerWhy: sellRequestFooterWhy(en) }),
    text,
  };
}
