import { SPEND_ALERT_CODE_BY_KIND, type SpendAlertKind, type SpendAlertSeverity } from '@/types/contract';

/** Los filtros de «Avisos de gasto» en la URL (módulo sin `'use client'`: lo lee la página de servidor). */
export interface SpendAlertsUrlFilters {
  kind?: SpendAlertKind;
  severity?: SpendAlertSeverity;
  subjectUserId?: string;
  from?: string;
  to?: string;
  unseen?: boolean;
  page?: number;
}

export const KINDS = Object.keys(SPEND_ALERT_CODE_BY_KIND) as SpendAlertKind[];
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
  const page = Number(one('page'));
  if (Number.isInteger(page) && page > 1) out.page = page;
  return out;
}

