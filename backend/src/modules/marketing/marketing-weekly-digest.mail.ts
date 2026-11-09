/**
 * marketing-weekly-digest.mail.ts — el correo del lunes (MKT_PANEL_V2 §3). PURO: `r1` + `r2` (régimen `small_cells`) ⇒
 * asunto, texto y HTML. ⛔ Sin datos personales: solo agregados, nombres de carta, términos de c6 ya filtrados y páginas de
 * Google (nunca consultas). ⛔ Nunca `r3` (el diario solo existe en la vista del dueño).
 */
import type { AggTable } from './marketing-aggregates.types';
import { ctaRows, headingRow, mailShell, proseRow, sectionLabelRow, spacerRow } from '../buylist/mail-shell';

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** «2–8 nov» o «27 oct–2 nov» desde dos días `YYYY-MM-DD`. */
export function weekRangeLabel(from: string, to: string): string {
  const [, m1, d1] = from.split('-').map(Number);
  const [, m2, d2] = to.split('-').map(Number);
  return m1 === m2 ? `${d1}–${d2} ${MESES[m2 - 1]}` : `${d1} ${MESES[m1 - 1]}–${d2} ${MESES[m2 - 1]}`;
}

const cell = (v: unknown): string => (v === null || v === undefined ? '—' : typeof v === 'number' ? new Intl.NumberFormat('es-MX').format(v) : String(v));
const delta = (r: Record<string, unknown>): string => {
  if (typeof r.delta_abs !== 'number') return typeof r.actual === 'number' ? '≈' : '';
  const sign = r.delta_abs > 0 ? '+' : r.delta_abs < 0 ? '−' : '';
  const pct = typeof r.delta_pct === 'number' ? ` (${sign}${Math.abs(r.delta_pct)} %)` : ' (nuevo)';
  return `${sign}${cell(Math.abs(r.delta_abs))}${pct}`;
};

export function weeklyDigestMail(r1: AggTable, r2: AggTable, from: string, to: string, panelUrl: string): { subject: string; text: string; html: string } {
  const label = weekRangeLabel(from, to);
  const subject = `Tu semana en TCG HUNT: ${label}`;
  const figures = r1.rows.map((r) => ({ cifra: cell(r.cifra), actual: cell(r.actual), anterior: cell(r.anterior), d: delta(r) }));
  const alerts = r2.rows.map((r) => ({ titulo: cell(r.titulo), evidencia: r.evidencia ? cell(r.evidencia) : '', accion: r.accion ? cell(r.accion) : '' }));
  const footerWhy = 'Recibes este correo porque eres el dueño de TCG HUNT. Solo lleva cifras agregadas: ningún dato de clientes.';
  const text = [
    subject,
    '',
    'Cifras (esta semana · semana anterior · cambio):',
    ...figures.map((f) => `- ${f.cifra}: ${f.actual} · ${f.anterior} · ${f.d}`),
    '',
    'Qué hacer esta semana:',
    ...alerts.map((a) => `- ${a.titulo}${a.evidencia ? ` — ${a.evidencia}` : ''}${a.accion ? ` ${a.accion}` : ''}`),
    '',
    `Abre el panel: ${panelUrl}`,
    '',
    footerWhy,
  ].join('\n');
  const blocks = [
    headingRow(subject, 22),
    spacerRow(16),
    sectionLabelRow('Cifras · esta semana · semana anterior · cambio'),
    ...figures.flatMap((f) => [proseRow(`${f.cifra}: ${f.actual} · ${f.anterior}${f.d ? ` · ${f.d}` : ''}`), spacerRow(8)]),
    spacerRow(16),
    sectionLabelRow('Qué hacer esta semana'),
    ...alerts.flatMap((a) => [proseRow(`${a.titulo}${a.evidencia ? ` — ${a.evidencia}` : ''}${a.accion ? ` ${a.accion}` : ''}`), spacerRow(8)]),
    spacerRow(24),
    ctaRows(panelUrl, 'ABRIR EL PANEL', 'accent'),
  ];
  const html = mailShell({ locale: 'es', audience: 'staff', title: subject, preheader: subject, blocks, footerWhy });
  return { subject, text, html };
}
