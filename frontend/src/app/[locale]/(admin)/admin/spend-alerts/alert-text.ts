import type { SpendAlertCode, SpendAlertDTO, SpendAlertFactValue } from '@/types/contract';

/**
 * Título y frase de un aviso de gasto (`DESIGN_SYSTEM §43.19.11`) — función PURA, compartida por la lista, el detalle y
 * el filtro.
 *
 * ⛔ **GAS-4 — una cifra, una fuente:** todo dato sale de `facts`, `amountCents` y las referencias del DTO TAL CUAL
 * (AG-5 pinta `diffCents`, ⛔ nunca `chargedCents − quotedCents`). Las únicas comparaciones son con cero sobre datos del
 * servidor (AG-13), no cálculo de dinero.
 * ⛔ **GAS-2 — sin datos del cliente:** la frase lee SOLO las claves de su tipo (lista blanca por código); una clave de
 * más en `facts` (un nombre, un teléfono) no llega a la pantalla. AG-1 dice QUÉ campos cambiaron, nunca los valores.
 */

type T = {
  (key: string, values?: Record<string, string | number>): string;
  has: (key: string) => boolean;
};

export interface AlertTextCtx {
  money: (cents: number) => string;
  dateTime: (iso: string) => string;
  /**
   * El rótulo de un ajuste del dueño por su clave del DTO (`admin.m10.ownerOnly.field.*`, una fuente para el nombre de
   * cada ajuste, §43.20.3); clave sin rótulo ⇒ `field.other`. ⛔ Nunca la clave cruda.
   */
  ownerSetting: (key: string) => string;
}

const num = (v: SpendAlertFactValue | undefined): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: SpendAlertFactValue | undefined): string | null => (typeof v === 'string' && v.trim() ? v : null);
const list = (v: SpendAlertFactValue | undefined): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const person = (v: SpendAlertFactValue | undefined): { name: string | null; role: string | null } | null =>
  v && typeof v === 'object' && !Array.isArray(v) && 'userId' in v ? { name: v.name, role: typeof v.role === 'string' ? v.role : null } : null;

/** AG-22 (§43.20.3): los `act` con frase propia; uno desconocido o ausente ⇒ `act.other`. */
export const AG22_ACTS = [
  'staff_created',
  'staff_password_reset',
  'staff_status_changed',
  'staff_deleted',
  'owner_account_denied',
  'owner_setting_denied',
] as const;
/** AG-9 (§43.19.11 + §43.20.4): las causas con frase propia; otra ⇒ `other`. */
export const AG9_CAUSES = ['charged_not_found', 'orphan', 'duplicate', 'orphan_auto_cancelled', 'orphan_fuse', 'orphan_cancel_unknown'] as const;

/** «a, b y c» con la conjunción del idioma. */
export function joinAnd(t: T, parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} ${t('and')} ${parts[parts.length - 1]}`;
}

export function refOf(t: T, a: SpendAlertDTO): string {
  if (a.order?.orderNumber) return t('ref.order', { orderNumber: a.order.orderNumber });
  if (a.shipment?.folio) return t('ref.shipment', { folio: a.shipment.folio });
  return t('ref.none');
}

export function personOf(t: T, a: SpendAlertDTO): string {
  return a.subject?.name?.trim() || t('personNone');
}

/** Título del aviso. AG-21 cambia de título si no hay dueño. */
export function alertTitle(t: T, a: Pick<SpendAlertDTO, 'code' | 'facts'>): string {
  if (a.code === 'AG-21' && a.facts.cause === 'no_owner') return t('kind.AG-21.titleNoOwner');
  return titleOfCode(t, a.code);
}

export function titleOfCode(t: T, code: SpendAlertCode): string {
  return t.has(`kind.${code}.title`) ? t(`kind.${code}.title`) : t('kind.generic.title', { code });
}

/** La frase de §43.19.11 con los datos del aviso. Sin texto propio (AG-14…AG-20) ⇒ frase genérica. */
export function alertText(t: T, a: SpendAlertDTO, ctx: AlertTextCtx): string {
  const f = a.facts;
  const none = t('noData');
  const m = (v: SpendAlertFactValue | undefined) => {
    const n = num(v);
    return n === null ? none : ctx.money(n);
  };
  const ref = refOf(t, a);
  const who = personOf(t, a);
  const carrier = str(f.carrierName) ?? none;
  switch (a.code) {
    case 'AG-1': {
      const fields = list(f.changedKeys).map((k) => (t.has(`field.${k}`) ? t(`field.${k}`) : k));
      return t('kind.AG-1.text', { person: who, ref, fields: joinAnd(t, fields), carrier, charged: m(f.chargedCents) });
    }
    case 'AG-2':
      return t('kind.AG-2.text', { person: who, used: m(f.usedCents), pct: num(f.pct) ?? none, cap: m(f.capCents) });
    case 'AG-3':
      return t('kind.AG-3.text', { person: who, ref, price: m(f.priceCents), cap: m(f.capCents), used: m(f.usedCents) });
    case 'AG-4': {
      const u = num(f.unknownRefunds);
      const unknown = u !== null && u > 0 ? t('kind.AG-4.unknown', { u }) : '';
      const base = { k: num(f.cancelledCount) ?? none, unrecovered: m(f.unrecoveredCents), unknown };
      const text = a.shipment
        ? t('kind.AG-4.textShipment', { ...base, ref, who: joinAnd(t, list(f.actors)) || none })
        : t('kind.AG-4.textPerson', { ...base, person: who });
      // 🔒 v1.80.12.10 (S-GAS-5): con `triggers ∋ reissue_denied` se dice además que se negó la siguiente guía.
      return list(f.triggers).includes('reissue_denied') ? `${t('kind.AG-4.denied', { ref })} ${text}` : text;
    }
    case 'AG-5': {
      const d = num(f.diffCents);
      // El dato del servidor con su signo (U+2212), ⛔ no una resta.
      const diff = d === null ? none : `${d < 0 ? '−' : '+'}${ctx.money(Math.abs(d))}`;
      return t('kind.AG-5.text', { ref, charged: m(f.chargedCents), quoted: m(f.quotedCents), diff });
    }
    case 'AG-6': {
      const kind = str(f.kind);
      // S-GAS-4: dominio cerrado `ShipmentCostAdjustmentKind`; un valor sin rótulo ⇒ «otro cargo».
      const type = kind && t.has(`chargeKind.${kind}`) ? t(`chargeKind.${kind}`) : t('chargeKind.other');
      return t('kind.AG-6.text', { carrier, ref, type, amount: m(f.amountCents ?? a.amountCents) });
    }
    case 'AG-7':
      if (f.requiredCents !== undefined) return t('kind.AG-7.textInsufficient', { ref, required: m(f.requiredCents) });
      return t('kind.AG-7.textOpen', { balance: m(f.balanceCents), threshold: m(f.thresholdCents) });
    case 'AG-8':
      if (num(f.refundedCents) !== null) {
        return t('kind.AG-8.textA', { ref, charged: m(f.chargedCents), refunded: m(f.refundedCents), unrefunded: m(f.unrefundedCents) });
      }
      return t('kind.AG-8.textB', { ref, charged: m(f.chargedCents) });
    case 'AG-9': {
      const cause = str(f.cause);
      const key = cause && (AG9_CAUSES as readonly string[]).includes(cause) ? cause : 'other';
      return t(`kind.AG-9.${key}`, { ref, amount: m(f.expectedChargeCents ?? a.amountCents), reference: str(f.providerReference) ?? none });
    }
    case 'AG-10':
      return t('kind.AG-10.text', { ref, carrier, charged: m(f.chargedCents), d: num(f.daysSincePurchase) ?? none });
    case 'AG-11':
      return t('kind.AG-11.text', { ref, carrier, status: str(f.status) ?? 'other', charged: m(f.chargedCents) });
    case 'AG-12':
      return t('kind.AG-12.text', { ref, carrier, status: str(f.status) ?? 'other' });
    case 'AG-13': {
      const margin = num(f.marginCents);
      const over = num(f.overRecommendedCents);
      const parts: string[] = [];
      if (margin !== null && margin < 0) parts.push(t('kind.AG-13.negative', { margin: `−${ctx.money(Math.abs(margin))}` }));
      if (over !== null && over > 0) {
        parts.push(t('kind.AG-13.over', { over: ctx.money(over), price: m(f.priceCents), recommended: m(f.recommendedPriceCents) }));
      }
      return t('kind.AG-13.text', { person: who, ref, parts: joinAnd(t, parts) });
    }
    case 'AG-21': {
      // §43.20.2: la variante la deciden `cause` y si `previousOwner` es `null`. ⛔ Ningún correo ni `userId` en pantalla.
      const prevP = person(f.previousOwner);
      const prev = prevP?.name?.trim() || t('personNone');
      const cur = person(f.currentOwner)?.name?.trim() || t('personNone');
      if (f.cause === 'no_owner') return prevP ? t('kind.AG-21.textNoOwnerFrom', { previous: prev }) : t('kind.AG-21.textNoOwner');
      return prevP ? t('kind.AG-21.textChanged', { previous: prev, current: cur }) : t('kind.AG-21.textFirst', { current: cur });
    }
    case 'AG-22': {
      // §43.20.3: una frase por `act`; `{target}` con rol, `{owner}` sin rol, `{settings}` por los rótulos de los ajustes.
      const act = str(f.act);
      const key = act && (AG22_ACTS as readonly string[]).includes(act) ? act : 'other';
      const tp = person(f.target);
      const name = tp?.name?.trim() || t('personNone');
      const roleLabel = tp?.role && t.has(`kind.AG-22.role.${tp.role}`) ? t(`kind.AG-22.role.${tp.role}`) : null;
      const target = !tp ? t('kind.AG-22.targetNone') : roleLabel ? t('kind.AG-22.target', { name, role: roleLabel }) : name;
      const labels = [...new Set(list(f.keys).map((k) => ctx.ownerSetting(k)))];
      const settings = joinAnd(t, labels.length ? labels : [ctx.ownerSetting('other')]);
      return t(`kind.AG-22.act.${key}`, { person: who, target, owner: tp ? name : t('kind.AG-22.targetNone'), settings });
    }
    default:
      return t('kind.generic.text');
  }
}

/**
 * La lista blanca de `facts` que el DETALLE pinta (§43.19.8): solo estas claves y en este orden; ⛔ cualquier otra
 * (`recipientName`, `phone`… de un servidor equivocado) no se pinta (UX-GAS-6).
 */
export const FACT_MONEY = [
  'chargedCents',
  'quotedCents',
  'diffCents',
  'amountCents',
  'priceCents',
  'usedCents',
  'capCents',
  'unrecoveredCents',
  'balanceCents',
  'thresholdCents',
  'requiredCents',
  'refundedCents',
  'unrefundedCents',
  'expectedChargeCents',
  'marginCents',
  'recommendedPriceCents',
  'overRecommendedCents',
] as const;
export const FACT_INT = ['revisionCount', 'cancelledCount', 'unknownRefunds', 'daysSincePurchase', 'pct'] as const;
export const FACT_WHITELIST = [
  'changedKeys',
  'carrierName',
  ...FACT_MONEY,
  'correctionAt',
  ...FACT_INT,
  'actors',
  'kind',
  'cancelKind',
  'cause',
  'status',
  'providerReference',
] as const;
