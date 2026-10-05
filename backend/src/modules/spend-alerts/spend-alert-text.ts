/**
 * spend-alert-text.ts — 💰 el TÍTULO y la FRASE de cada aviso para los correos al dueño `AVG-1/2/3` (DESIGN_SYSTEM §43.19.11,
 * §43.19.12, §43.20.2–.4, §43.20.7, §43.20.10). Mismos textos que la pantalla (GAS-4: el correo y el panel dicen lo mismo).
 *
 * ⛔ **Lista blanca por construcción (GAS-2, PS-153):** estas funciones reciben `SpendAlertMailView` — campos sueltos del
 * aviso (`facts`, `amountCents`, el nombre del PERSONAL, el número de pedido y el folio), ⛔ nunca la fila del envío ni la del
 * pedido. No hay forma de que un nombre, una dirección, un teléfono, un correo o una CLABE del CLIENTE lleguen aquí: no están
 * en el tipo. AG-1 dice QUÉ campos se corrigieron, nunca los valores.
 */
import { SpendAlertKind } from '@prisma/client';
import { SPEND_ALERT_CODE_OF, SpendFactValue } from './spend-alerts.service';

export type MailLocale = 'es' | 'en';
/** G2 (§19.33.7): el MISMO tipo que `SpendFacts` del servicio — ⛔ una segunda definición que derive. */
export type FactValue = SpendFactValue;

/** Lo único que una plantilla sabe de un aviso. */
export interface SpendAlertMailView {
  id: string;
  kind: SpendAlertKind;
  severity: 'immediate' | 'digest';
  facts: Record<string, FactValue>;
  amountCents: number | null;
  /** Nombre del MIEMBRO DEL PERSONAL sujeto (`User.name`), o `null` (aviso de sistema). */
  subjectName: string | null;
  orderNumber: string | null;
  folio: string | null;
  firstOccurredAt: Date;
}

export function normalizeMailLocale(l: string | null | undefined): MailLocale {
  return l === 'en' ? 'en' : 'es';
}

/** MXN desde centavos (`MX$` en los dos idiomas, §41.5). */
export function mailMoney(cents: number | null | undefined, l: MailLocale): string {
  const n = typeof cents === 'number' && Number.isFinite(cents) ? cents : 0;
  const abs = new Intl.NumberFormat(l === 'en' ? 'en-US' : 'es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n) / 100);
  return `${n < 0 ? '−' : ''}MX$${abs}`;
}

/** Hora `HH:mm` en México. */
export function mailTime(d: Date): string {
  return new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
}

/** Día largo en México («3 de octubre» / «October 3»). */
export function mailDay(ymd: string, l: MailLocale): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Intl.DateTimeFormat(l === 'en' ? 'en-US' : 'es-MX', { timeZone: 'UTC', day: 'numeric', month: 'long' }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}

const PERSON_NONE: Record<MailLocale, string> = { es: 'una cuenta sin nombre', en: 'an account with no name' };

function person(name: string | null | undefined, l: MailLocale): string {
  const t = (name ?? '').trim();
  return t || PERSON_NONE[l];
}

function joinAnd(items: string[], l: MailLocale): string {
  if (items.length <= 1) return items.join('');
  const last = items[items.length - 1];
  return `${items.slice(0, -1).join(', ')} ${l === 'en' ? 'and' : 'y'} ${last}`;
}

/** `{ref}` sin artículo (§43.20.7): «pedido TCG-000123» / «envío ENV-000045» / «envío sin folio». */
export function refOf(v: Pick<SpendAlertMailView, 'orderNumber' | 'folio'>, l: MailLocale): string {
  if (v.orderNumber) return l === 'en' ? `order ${v.orderNumber}` : `pedido ${v.orderNumber}`;
  if (v.folio) return l === 'en' ? `shipment ${v.folio}` : `envío ${v.folio}`;
  return l === 'en' ? 'a shipment' : 'envío sin folio';
}

/** `{ref corta}` del asunto de `AVG-1` y de las líneas de `AVG-2/3`; `null` sin pedido ni envío (AG-7 abierto, AG-9 fusible, AG-21, AG-22). */
export function shortRefOf(v: Pick<SpendAlertMailView, 'orderNumber' | 'folio'>, l: MailLocale): string | null {
  if (!v.orderNumber && !v.folio) return null;
  return refOf(v, l);
}

const TITLES: Record<string, [string, string]> = {
  'AG-1': ['Corrigió la dirección y compró la guía', 'Corrected the address and bought the label'],
  'AG-2': ['Cerca del tope de guías', 'Close to the label limit'],
  'AG-3': ['Guía negada por el tope', 'Label refused by the limit'],
  'AG-4': ['Cancelar y volver a comprar', 'Cancel and buy again'],
  'AG-5': ['Se cobró distinto de lo cotizado', 'Charged differently from the quote'],
  'AG-6': ['Cargo extra de la paquetería', 'Carrier extra charge'],
  'AG-7': ['Saldo de Skydropx bajo', 'Low Skydropx balance'],
  'AG-8': ['Reembolso de cancelación que no llegó', "Cancellation refund that didn't arrive"],
  'AG-9': ['Cobro sin guía o guía de más', 'Charge without a label, or extra label'],
  'AG-10': ['Guía comprada que no sale', "Bought label that hasn't shipped"],
  'AG-11': ['Paquete devuelto o destruido', 'Parcel returned or destroyed'],
  'AG-12': ['Incidencia de la paquetería', 'Carrier issue'],
  'AG-13': ['Guía cara o con margen negativo', 'Expensive label or negative margin'],
  'AG-22': ['Cambios de otro súper-admin', 'Changes by another super admin'],
};

/** El título del aviso (asunto sin marca, titular). */
export function spendAlertTitle(v: Pick<SpendAlertMailView, 'kind' | 'facts'>, l: MailLocale): string {
  const code = SPEND_ALERT_CODE_OF[v.kind];
  const i = l === 'en' ? 1 : 0;
  if (code === 'AG-21') {
    return v.facts.cause === 'no_owner' ? ['No hay cuenta de dueño', 'There is no owner account'][i] : ['Cambió la cuenta del dueño', 'The owner account changed'][i];
  }
  return TITLES[code]?.[i] ?? (l === 'en' ? `Spending alert ${code}` : `Aviso de gasto ${code}`);
}

const num = (x: FactValue | undefined): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const str = (x: FactValue | undefined): string | null => (typeof x === 'string' && x.trim() !== '' ? x : null);
const strs = (x: FactValue | undefined): string[] => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : []);
const obj = (x: FactValue | undefined): Record<string, unknown> | null => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : null);

const FIELD: Record<string, [string, string]> = {
  recipientName: ['destinatario', 'recipient'],
  line1: ['calle y número', 'street and number'],
  line2: ['interior', 'unit'],
  postalCode: ['CP', 'postal code'],
  neighborhood: ['colonia', 'neighborhood'],
  city: ['municipio', 'municipality'],
  state: ['estado', 'state'],
  country: ['país', 'country'],
  references: ['referencias', 'references'],
};

const CHARGE_KIND: Record<string, [string, string]> = {
  overweight: ['sobrepeso', 'overweight'],
  extended_zone: ['zona extendida', 'extended zone'],
  return: ['devolución', 'return'],
  other: ['otro cargo', 'other charge'],
};

const SETTING_LABEL: Record<string, [string, string]> = {
  operatorLabelCap24hCents: ['el tope de guías por persona', 'the per-person label limit'],
  shippingLabelReissueMaxPerShipment: ['las recompras de guía por envío', 'the label rebuys per shipment'],
  spendAlertsDisabled: ['qué avisos están encendidos', 'which alerts are switched on'],
  spendAlertLabelCapWarnPct: ['el aviso de cercanía al tope', 'the near-limit alert'],
  spendAlertShipmentCancelCount: ['el aviso de guías canceladas por envío', 'the cancelled-labels-per-shipment alert'],
  spendAlertPersonCancelCount24h: ['el aviso de guías canceladas por persona', 'the cancelled-labels-per-person alert'],
  spendAlertChargeDriftImmediateCents: ['el aviso de cobro distinto de lo cotizado', 'the charged-versus-quoted alert'],
  spendAlertExtraChargeImmediateCents: ['el aviso de cargo extra', 'the extra-charge alert'],
  skydropxLowBalanceCents: ['el aviso de saldo bajo', 'the low-balance alert'],
  spendAlertCancelRefundDays: ['el aviso de reembolso de cancelación', 'the cancellation-refund alert'],
  spendAlertLabelNotShippedDays: ['el aviso de guía que no sale', 'the unshipped-label alert'],
  shippingLabelPurchase: ['quién puede comprar guías', 'who can buy labels'],
};

const ROLE: Record<string, [string, string]> = { super_admin: ['súper-admin', 'super admin'], vault_operator: ['operador', 'operator'] };

function targetOf(f: Record<string, FactValue>, l: MailLocale, withRole = true): string {
  const t = obj(f.target);
  if (!t) return l === 'en' ? 'a staff account' : 'una cuenta del personal';
  const name = person(typeof t.name === 'string' ? t.name : null, l);
  const role = typeof t.role === 'string' ? ROLE[t.role] : undefined;
  return withRole && role ? `${name} (${role[l === 'en' ? 1 : 0]})` : name;
}

/** La frase del aviso (§43.19.11 con §43.20.7 en ES; AG-21 §43.20.2; AG-22 §43.20.3). Todo dato sale de `facts`/`amountCents`. */
export function spendAlertSentence(v: SpendAlertMailView, l: MailLocale): string {
  const en = l === 'en';
  const i = en ? 1 : 0;
  const f = v.facts;
  const ref = refOf(v, l);
  const who = person(v.subjectName, l);
  const m = (c: FactValue | undefined | number | null) => mailMoney(num(c as FactValue), l);
  const code = SPEND_ALERT_CODE_OF[v.kind];
  switch (code) {
    case 'AG-1': {
      const fields = joinAnd(strs(f.changedKeys).map((k) => FIELD[k]?.[i] ?? (en ? 'another field' : 'otro campo')), l);
      return en
        ? `${who} corrected the address of ${ref} (${fields}) and bought its label: ${str(f.carrierName) ?? ''}, ${m(f.chargedCents)}.`
        : `${who} corrigió la dirección del ${ref} (${fields}) y compró su guía: ${str(f.carrierName) ?? ''}, ${m(f.chargedCents)}.`;
    }
    case 'AG-2':
      return en
        ? `${who} has spent ${m(f.usedCents)} on labels in the last 24 hours: ${num(f.pct) ?? ''}% of their ${m(f.capCents)} limit.`
        : `${who} lleva ${m(f.usedCents)} en guías en las últimas 24 horas: el ${num(f.pct) ?? ''} % de su tope de ${m(f.capCents)}.`;
    case 'AG-3':
      return en
        ? `${who} was refused the label for ${ref} (${m(f.priceCents)}): it would have taken them over their ${m(f.capCents)} 24-hour limit (they had spent ${m(f.usedCents)}). You can buy it yourself or raise their limit.`
        : `A ${who} se le negó la guía del ${ref} (${m(f.priceCents)}): con ella pasaba su tope de ${m(f.capCents)} en 24 horas (llevaba ${m(f.usedCents)}). Puedes comprarla tú o subir su tope.`;
    case 'AG-4': {
      const k = num(f.cancelledCount) ?? 0;
      const u = num(f.unknownRefunds) ?? 0;
      const unknown = u > 0 ? (en ? `; no refund amount for ${u}` : `; sin cifra de reembolso en ${u}`) : '';
      const actors = joinAnd(strs(f.actors), l);
      const triggers = strs(f.triggers);
      if (v.folio || v.orderNumber) {
        if (triggers.length === 1 && triggers[0] === 'reissue_denied') {
          return en ? `Another label for ${ref} was refused: it had already used all its rebuys.` : `Se negó una guía más para el ${ref}: ya había usado todas sus recompras.`;
        }
        return en
          ? `There are ${k} cancelled labels on ${ref}${actors ? ` (${actors})` : ''}. Balance not recovered: ${m(f.unrecoveredCents)}${unknown}.`
          : `Van ${k} guías canceladas en el ${ref}${actors ? ` (${actors})` : ''}. Saldo no recuperado: ${m(f.unrecoveredCents)}${unknown}.`;
      }
      return en
        ? `${who} cancelled ${k} labels in the last 24 hours. Balance not recovered: ${m(f.unrecoveredCents)}${unknown}.`
        : `${who} canceló ${k} guías en las últimas 24 horas. Saldo no recuperado: ${m(f.unrecoveredCents)}${unknown}.`;
    }
    case 'AG-5': {
      const d = num(f.diffCents) ?? 0;
      const signed = `${d >= 0 ? '+' : '−'}${mailMoney(Math.abs(d), l)}`;
      return en
        ? `The label for ${ref} was charged ${m(f.chargedCents)}; it was quoted at ${m(f.quotedCents)} (${signed}).`
        : `La guía del ${ref} se cobró en ${m(f.chargedCents)}; se cotizó en ${m(f.quotedCents)} (${signed}).`;
    }
    case 'AG-6': {
      const kind = (str(f.kind) && CHARGE_KIND[str(f.kind)!]?.[i]) || CHARGE_KIND.other[i];
      return en
        ? `Extra charge from ${str(f.carrierName) ?? ''} on ${ref}: ${kind}, ${m(f.amountCents ?? v.amountCents)}.`
        : `Cargo extra de ${str(f.carrierName) ?? ''} en el ${ref}: ${kind}, ${m(f.amountCents ?? v.amountCents)}.`;
    }
    case 'AG-7':
      if (num(f.requiredCents) !== null) {
        return en
          ? `A label for ${ref} couldn't be bought: the balance wasn't enough (${m(f.requiredCents)} was needed).`
          : `Una guía del ${ref} no se pudo comprar: el saldo no alcanzaba (hacían falta ${m(f.requiredCents)}).`;
      }
      return en
        ? `Your Skydropx balance dropped to ${m(f.balanceCents)} (we alert below ${m(f.thresholdCents)}). Top it up in the Skydropx panel.`
        : `Tu saldo de Skydropx bajó a ${m(f.balanceCents)} (avisamos debajo de ${m(f.thresholdCents)}). Recarga en el panel de Skydropx.`;
    case 'AG-8':
      if (num(f.refundedCents) !== null) {
        return en
          ? `The cancelled label for ${ref} cost ${m(f.chargedCents)} and Skydropx refunded ${m(f.refundedCents)}: ${m(f.unrefundedCents)} is missing.`
          : `La guía cancelada del ${ref} costó ${m(f.chargedCents)} y Skydropx devolvió ${m(f.refundedCents)}: faltan ${m(f.unrefundedCents)}.`;
      }
      return en
        ? `The label for ${ref} was cancelled and Skydropx didn't say how much it refunded; we can't confirm that ${m(f.chargedCents)} came back. Check it in your Skydropx panel.`
        : `Se canceló la guía del ${ref} y Skydropx no dijo cuánto devolvió; no podemos confirmar que regresaran ${m(f.chargedCents)}. Revísalo en tu panel de Skydropx.`;
    case 'AG-9': {
      const r = str(f.providerReference) ?? '';
      const amount = m(f.expectedChargeCents ?? v.amountCents);
      switch (f.cause) {
        case 'charged_not_found':
          return en
            ? `Skydropx charged ${amount} for the label for ${ref} and we couldn't find the label. Look it up in your Skydropx panel as “Pedido ${r}”.`
            : `Skydropx descontó ${amount} por la guía del ${ref} y no encontramos la guía. Búscala en tu panel de Skydropx como «Pedido ${r}».`;
        case 'orphan':
          return en
            ? `Skydropx has a paid label from an earlier attempt on ${ref} (“Pedido ${r}”, ${amount}) that wasn't cancelled automatically. Cancel it in your Skydropx panel to get the balance back.`
            : `Skydropx tiene una guía pagada de un intento anterior del ${ref} («Pedido ${r}», ${amount}) que no se canceló sola. Cancélala en tu panel de Skydropx para recuperar el saldo.`;
        case 'duplicate':
          return en
            ? `Skydropx created two labels for the same purchase on ${ref} (“Pedido ${r}”): it charged twice. Cancel the extra one in your Skydropx panel.`
            : `Skydropx creó dos guías para la misma compra del ${ref} («Pedido ${r}»): se cobró dos veces. Cancela la que sobra en tu panel de Skydropx.`;
        case 'orphan_auto_cancelled':
          return en
            ? `We automatically cancelled an extra label for ${ref} (“Pedido ${r}”, ${amount}). You don't need to do anything; if the balance doesn't come back, we'll let you know.`
            : `Cancelamos sola una guía de más del ${ref} («Pedido ${r}», ${amount}). No tienes que hacer nada; si el saldo no regresa, te avisamos.`;
        case 'orphan_fuse':
          return en
            ? 'Several extra labels were already cancelled automatically today, so for safety we stopped cancelling them automatically until tomorrow. Check the extra labels in your Skydropx panel.'
            : 'Hoy ya se cancelaron solas varias guías de más y, por seguridad, dejamos de cancelarlas solas hasta mañana. Revisa las guías de más en tu panel de Skydropx.';
        case 'orphan_cancel_unknown':
          return en
            ? `We tried to cancel an extra label for ${ref} automatically (“Pedido ${r}”, ${amount}) and Skydropx didn't answer: we don't know if it was cancelled. We won't retry on our own; look it up in your Skydropx panel and cancel it there if it's still active.`
            : `Intentamos cancelar sola una guía de más del ${ref} («Pedido ${r}», ${amount}) y Skydropx no contestó: no sabemos si se canceló. No lo volvemos a intentar solos; búscala en tu panel de Skydropx y cancélala ahí si sigue activa.`;
        default:
          return en ? `Check the labels for ${ref} in your Skydropx panel.` : `Revisa las guías del ${ref} en tu panel de Skydropx.`;
      }
    }
    case 'AG-10':
      return en
        ? `The label for ${ref} (${str(f.carrierName) ?? ''}, ${m(f.chargedCents)}) was bought ${num(f.daysSincePurchase) ?? ''} days ago and the parcel hasn't shipped. If it isn't going to, cancel it to get the balance back.`
        : `La guía del ${ref} (${str(f.carrierName) ?? ''}, ${m(f.chargedCents)}) se compró hace ${num(f.daysSincePurchase) ?? ''} días y el paquete no ha salido. Si ya no va a salir, cancélala para recuperar el saldo.`;
    case 'AG-11': {
      const what = f.status === 'destroyed' ? (en ? 'was destroyed by the carrier' : 'fue destruido por la paquetería') : en ? 'is on its way back to the store' : 'viene de regreso a la tienda';
      return en
        ? `The parcel for ${ref} (${str(f.carrierName) ?? ''}) ${what}. The label cost ${m(f.chargedCents)}.`
        : `El paquete del ${ref} (${str(f.carrierName) ?? ''}) ${what}. La guía costó ${m(f.chargedCents)}.`;
    }
    case 'AG-12': {
      const map: Record<string, [string, string]> = {
        exception: ['una incidencia', 'an issue'],
        retained: ['el paquete retenido', 'the parcel held'],
        delivery_attempt: ['un intento de entrega fallido', 'a failed delivery attempt'],
      };
      const what = map[str(f.status) ?? '']?.[i] ?? map.exception[i];
      return en ? `${str(f.carrierName) ?? ''} reports ${what} on ${ref}.` : `${str(f.carrierName) ?? ''} reporta ${what} en el ${ref}.`;
    }
    case 'AG-13': {
      const parts: string[] = [];
      const margin = num(f.marginCents);
      const over = num(f.overRecommendedCents);
      if (margin !== null && margin < 0) parts.push(en ? `with a negative margin (${m(margin)})` : `con margen negativo (${m(margin)})`);
      if (over !== null && over > 0) {
        parts.push(
          en
            ? `${m(over)} above the recommended one (${m(f.priceCents)} vs ${m(f.recommendedPriceCents)})`
            : `${m(over)} por encima de la recomendada (${m(f.priceCents)} contra ${m(f.recommendedPriceCents)})`,
        );
      }
      return en ? `${who} bought the label for ${ref} ${parts.join(' and ')}.` : `${who} compró la guía del ${ref} ${parts.join(' y ')}.`;
    }
    case 'AG-21': {
      const prev = obj(f.previousOwner);
      const curr = obj(f.currentOwner);
      const prevName = person(prev && typeof prev.name === 'string' ? prev.name : null, l);
      const currName = person(curr && typeof curr.name === 'string' ? curr.name : null, l);
      const tail = en
        ? "While that lasts, nobody is exempt from the limits, nobody can change the spending settings and alerts send no email. It's fixed by marking the owner account from the server."
        : 'Mientras siga así, nadie queda sin tope, nadie puede cambiar los ajustes de gasto y los avisos no mandan correo. Se arregla marcando la cuenta del dueño desde el servidor.';
      if (f.cause === 'no_owner') {
        if (prev) return en ? `${prevName}'s account stopped being the owner's and no other was marked. ${tail}` : `La cuenta de ${prevName} dejó de ser la del dueño y ninguna otra quedó marcada. ${tail}`;
        return en ? `No account is marked as the owner's. ${tail}` : `Ninguna cuenta está marcada como la del dueño. ${tail}`;
      }
      if (!prev) {
        return en
          ? `${currName}'s account is now marked as the owner's; before, there was none. From now on it's the only one with no limit, the one that changes the spending settings and the one that gets these emails.`
          : `La cuenta de ${currName} quedó marcada como la del dueño; antes no había ninguna. Desde ahora es la única sin tope, la que cambia los ajustes de gasto y la que recibe estos correos.`;
      }
      return en
        ? `The owner account changed from ${prevName} to ${currName}. That mark can only be changed from the server: if you weren't expecting this, check it today with whoever runs it.`
        : `La cuenta del dueño pasó de ${prevName} a ${currName}. Esa marca solo se cambia desde el servidor: si no lo esperabas, revísalo hoy con quien lo administra.`;
    }
    case 'AG-22': {
      switch (f.act) {
        case 'staff_created':
          return en ? `${who} created an account for ${targetOf(f, l)}.` : `${who} creó una cuenta para ${targetOf(f, l)}.`;
        case 'staff_password_reset':
          return en ? `${who} reset the password of ${targetOf(f, l)}.` : `${who} restableció la contraseña de ${targetOf(f, l)}.`;
        case 'staff_status_changed':
          return en
            ? `${who} blocked or reactivated the account of ${targetOf(f, l)}; its current state is in “Users”.`
            : `${who} bloqueó o reactivó la cuenta de ${targetOf(f, l)}; cómo quedó se ve en «Usuarios».`;
        case 'staff_deleted':
          return en ? `${who} deleted the account of ${targetOf(f, l)}.` : `${who} borró la cuenta de ${targetOf(f, l)}.`;
        case 'owner_account_denied':
          return en
            ? `${who} tried to reset, block or delete the owner account (${targetOf(f, l, false)}). The system refused: nothing changed.`
            : `${who} intentó restablecer, bloquear o borrar la cuenta del dueño (${targetOf(f, l, false)}). El sistema se lo negó: no cambió nada.`;
        case 'owner_setting_denied': {
          const keys = strs(f.keys);
          const labels = keys.length > 0 ? keys.map((k) => SETTING_LABEL[k]?.[i] ?? (en ? 'an owner setting' : 'un ajuste del dueño')) : [en ? 'an owner setting' : 'un ajuste del dueño'];
          return en
            ? `${who} tried to change ${joinAnd([...new Set(labels)], l)}. Only the owner can change that: nothing was saved.`
            : `${who} intentó cambiar ${joinAnd([...new Set(labels)], l)}. Solo el dueño puede cambiarlo: no se guardó nada.`;
        }
        default:
          return en ? `${who} made a change to a staff account.` : `${who} hizo un cambio en una cuenta del personal.`;
      }
    }
    default:
      return en ? `There is a new spending alert (${code}).` : `Hay un aviso de gasto nuevo (${code}).`;
  }
}

/** AG con la línea «Frenar» (§43.19.12): los 🔴 de guías. */
export const SPEND_STOP_LINE_CODES: ReadonlySet<string> = new Set(['AG-1', 'AG-3', 'AG-4', 'AG-5', 'AG-7', 'AG-8', 'AG-9']);
