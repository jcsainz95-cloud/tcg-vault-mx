/**
 * Estado de `/admin/marketing` en la URL (`DESIGN_SYSTEM §MKT-UX.1`): `?pantalla=a…h|acceso`, `&periodo=semana|mes`,
 * `&week=2026-W42` o `&month=2026-10`.
 *
 * ⚠️ Sin `'use client'` a propósito (lección de `m4/tabs.ts`): lo llama `page.tsx`, que es de servidor.
 *
 * Valores fuera de dominio se IGNORAN (candado UX-MKT-7): ⛔ nunca se manda basura al servidor. La FORMA se valida
 * aquí; que la semana o el mes estén CERRADOS lo decide la lista del servidor (`GET …/periods`), no el navegador.
 */
import type { MarketingScreen } from '@/types/contract';

export const MKT_SCREENS: readonly MarketingScreen[] = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
export type MktView = MarketingScreen | 'acceso';
export type MktPeriodKind = 'week' | 'month';

export interface MktUrlState {
  view: MktView;
  kind: MktPeriodKind;
  /** `YYYY-Www` válido de forma, o `null`. */
  week: string | null;
  /** `YYYY-MM` válido de forma, o `null`. */
  month: string | null;
}

type Raw = string | string[] | undefined;
const first = (v: Raw) => (Array.isArray(v) ? v[0] : v);
const WEEK_RE = /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function parseMktUrl(sp: Record<string, Raw>): MktUrlState {
  const p = first(sp.pantalla);
  const view: MktView = p === 'acceso' || (MKT_SCREENS as readonly string[]).includes(p ?? '') ? (p as MktView) : 'a';
  const w = first(sp.week);
  const m = first(sp.month);
  const week = w && WEEK_RE.test(w) ? w : null;
  const month = m && MONTH_RE.test(m) ? m : null;
  const periodo = first(sp.periodo);
  const kind: MktPeriodKind = periodo === 'mes' || (periodo !== 'semana' && month && !week) ? 'month' : 'week';
  return { view, kind, week: kind === 'week' ? week : null, month: kind === 'month' ? month : null };
}

/** Query string canónica (sin los valores por defecto). */
export function mktSearch(s: { view: MktView; kind: MktPeriodKind; week: string | null; month: string | null }): string {
  const q = new URLSearchParams();
  if (s.view !== 'a') q.set('pantalla', s.view);
  if (s.kind === 'month') q.set('periodo', 'mes');
  if (s.kind === 'week' && s.week) q.set('week', s.week);
  if (s.kind === 'month' && s.month) q.set('month', s.month);
  const str = q.toString();
  return str ? `?${str}` : '';
}
