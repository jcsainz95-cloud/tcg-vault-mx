import { SPEND_ALERT_CODE_BY_KIND, SPEND_ALERT_SWITCHABLE_CODES, type SpendAlertCode, type SpendAlertKind, type SpendAlertSeverity } from '@/types/contract';

/** Los filtros de «Avisos de gasto» en la URL (módulo sin `'use client'`: lo lee la página de servidor). */
export interface SpendAlertsUrlFilters {
  kind?: SpendAlertKind;
  severity?: SpendAlertSeverity;
  subjectUserId?: string;
  from?: string;
  to?: string;
  unseen?: boolean;
  /** §43.20.5: `true` ⇒ solo los apagados; `false` ⇒ sin los apagados; ausente ⇒ todos. */
  muted?: boolean;
  page?: number;
}

export const KINDS = Object.keys(SPEND_ALERT_CODE_BY_KIND) as SpendAlertKind[];
/**
 * OWN-3 (§43.20.0): AG-21 y AG-22 vigilan la cuenta y los ajustes del dueño — se ven (filtro, lista, «Avisos
 * encendidos») pero ⛔ nunca se apagan ni entran en `spendAlertsDisabled`.
 */
export const ALWAYS_ON_CODES: readonly SpendAlertCode[] = ['AG-21', 'AG-22'];
/** El filtro «Tipo» (§43.20.5): los trece que se apagan más AG-21 y AG-22, en orden de código. AG-14…AG-20 fuera. */
export const FILTER_KINDS = KINDS.filter((k) => {
  const c = SPEND_ALERT_CODE_BY_KIND[k];
  return SPEND_ALERT_SWITCHABLE_CODES.includes(c) || ALWAYS_ON_CODES.includes(c);
});
export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Lee los filtros de la URL (página de servidor) sin confiar en nada: lo que no es válido se descarta. */
export function parseSpendAlertFilters(sp: Record<string, string | string[] | undefined>): SpendAlertsUrlFilters {
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]?.[0] : sp[k]) as string | undefined;
  const out: SpendAlertsUrlFilters = {};
  const kind = one('kind');
  if (kind && (KINDS as string[]).includes(kind)) out.kind = kind as SpendAlertKind;
  const severity = one('severity');
  if (severity === 'immediate' || severity === 'digest') out.severity = severity;
  const subject = one('subjectUserId');
  if (subject && /^[\w-]{1,64}$/.test(subject)) out.subjectUserId = subject;
  const from = one('from');
  if (from && DAY_RE.test(from)) out.from = from;
  const to = one('to');
  if (to && DAY_RE.test(to)) out.to = to;
  if (one('unseen') === 'true') out.unseen = true;
  const muted = one('muted');
  if (muted === 'true' || muted === 'false') out.muted = muted === 'true';
  const page = Number(one('page'));
  if (Number.isInteger(page) && page > 1) out.page = page;
  return out;
}

