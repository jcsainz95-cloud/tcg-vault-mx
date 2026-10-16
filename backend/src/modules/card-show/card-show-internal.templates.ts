/**
 * card-show-internal.templates.ts — v1.93⟨cardshow⟩ (API_CONTRACT §CARDSHOW.9 internos; §CARDSHOW.11).
 *
 * Correos INTERNOS del Card Show (a buzones del PROPIO equipo, no a público):
 *  - **AVISO** al confirmar un `merchant`/`sponsor` (copy verbatim del dueño, 16-oct).
 *  - **RESUMEN DIARIO** de visitantes.
 *
 * ⛔ **NO** están sujetos a la restricción de enlaces de C3 (van al equipo): pueden llevar los datos
 * operativos que el equipo necesite. Siguen acotados por ≤ 10/h (§CARDSHOW.11), que lo gobierna el
 * servicio (`reserveInternalNotice`). Van sobre el esqueleto de marca (`mailShell`, audiencia `staff`
 * ⇒ sin fila de aviso de privacidad, porque el destinatario es personal, PRIV-6).
 *
 * ⛔ **Ningún `playerName`** (el aviso es de LEADS, que ni siquiera lo tienen) y ⛔ ningún nombre de
 * patrocinador (el aviso lleva el NOMBRE DE CONTACTO del lead o su correo, nunca un patrocinador).
 */

import { escapeHtml, INK, mailShell, MONO, PAPER, SANS } from '../buylist/mail-shell';

const LH = 'mso-line-height-rule:exactly';
const PAD = 32;

function cell(bg: string, style: string, content: string, attrs = ''): string {
  return `<td${attrs ? ` ${attrs}` : ''} bgcolor="${bg}" style="background-color:${bg};${style}">${content}</td>`;
}
function presTable(inner: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${inner}</table>`;
}
function proseRow(text: string): string {
  return `<tr>${cell(PAPER, `padding:0 ${PAD}px`, presTable(`<tr>${cell(PAPER, `font-family:${SANS};font-size:15px;line-height:1.55;${LH};color:${INK}`, escapeHtml(text))}</tr>`), 'class="px"')}</tr>`;
}
function monoRow(text: string): string {
  return `<tr>${cell(PAPER, `padding:0 ${PAD}px`, presTable(`<tr>${cell(PAPER, `font-family:${MONO};font-size:12px;line-height:1.5;${LH};color:${INK};word-break:break-all`, escapeHtml(text))}</tr>`), 'class="px"')}</tr>`;
}

/** Fecha+hora legible en America/Mexico_City para el cuerpo del aviso. */
export function cdmxDateTime(d: Date): string {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

/** Fecha corta (YYYY-MM-DD) en America/Mexico_City para el asunto del resumen. */
export function cdmxDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

const TIPO_LABEL: Record<'merchant' | 'sponsor', string> = { merchant: 'Vendedor', sponsor: 'Patrocinador' };

export interface InternalNoticeParams {
  type: 'merchant' | 'sponsor';
  /** Nombre del lead si lo hubiera (hoy los leads no persisten nombre ⇒ «—»). ⛔ nunca `playerName`. */
  name?: string | null;
  email: string;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  createdAt: Date;
  /** Enlace al panel «Card Show · Prospectos» (dominio propio; enlace libre por ser interno). */
  adminLink: string;
}

/** Aviso interno al confirmar vendedor/patrocinador (copy verbatim del dueño). */
export function renderInternalNotice(p: InternalNoticeParams): { subject: string; html: string; text: string } {
  const tipo = TIPO_LABEL[p.type];
  const nombre = (p.name ?? '').trim() || '—';
  const quien = (p.name ?? '').trim() || p.email;
  const fuente = `${p.utmSource ?? '—'}/${p.utmMedium ?? '—'}/${p.utmCampaign ?? '—'}`;
  const fecha = cdmxDateTime(p.createdAt);
  const subject = `[Card Show] Nuevo ${tipo.toLowerCase()}: ${quien}`;
  const cuerpo =
    `Nuevo registro en la landing del Card Show. Tipo: ${tipo} · Nombre: ${nombre} · Correo: ${p.email} · ` +
    `Fuente: ${fuente} · Fecha: ${fecha} · Ver en el admin: ${p.adminLink}`;
  const html = mailShell({
    locale: 'es',
    title: subject,
    preheader: `Nuevo ${tipo.toLowerCase()} en la landing del Card Show.`,
    blocks: [proseRow(cuerpo)],
    footerWhy: 'Aviso interno del equipo TCG HUNT (landing del Card Show).',
    audience: 'staff',
  });
  return { subject, html, text: `${cuerpo}\n` };
}

export interface DailySummaryVisitor {
  name?: string | null; // los leads no persisten nombre ⇒ «—»
  email: string;
  utmSource?: string | null;
}

export interface DailySummaryParams {
  /** Fecha del resumen (se formatea a YYYY-MM-DD CDMX para el asunto). */
  date: Date;
  /** Visitantes NUEVOS (confirmados) del día. */
  nuevos: DailySummaryVisitor[];
  /** Total acumulado de visitantes confirmados a la fecha. */
  totalAcumulado: number;
}

/** Resumen diario de visitantes (interno). */
export function renderVisitorDailySummary(p: DailySummaryParams): { subject: string; html: string; text: string } {
  const fecha = cdmxDate(p.date);
  const n = p.nuevos.length;
  const subject = `[Card Show] Visitantes del ${fecha}: ${n} nuevos`;
  const encabezado = `Visitantes nuevos del ${fecha}: ${n}. Total acumulado de visitantes confirmados: ${p.totalAcumulado}.`;
  const listaLineas = p.nuevos.map((v) => `${(v.name ?? '').trim() || '—'} · ${v.email} · ${v.utmSource ?? '—'}`);
  const blocks = [proseRow(encabezado), ...(listaLineas.length ? listaLineas.map(monoRow) : [proseRow('Sin visitantes nuevos este día.')])];
  const html = mailShell({
    locale: 'es',
    title: subject,
    preheader: `${n} visitantes nuevos del Card Show el ${fecha}.`,
    blocks,
    footerWhy: 'Resumen diario interno del equipo TCG HUNT (landing del Card Show).',
    audience: 'staff',
  });
  const text = `${encabezado}\n\n${listaLineas.length ? listaLineas.join('\n') : 'Sin visitantes nuevos este día.'}\n`;
  return { subject, html, text };
}
