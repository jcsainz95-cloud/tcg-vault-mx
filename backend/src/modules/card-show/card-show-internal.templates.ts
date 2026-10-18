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
  /** ⭐M-84 nombre o MARCA del lead (desde M-84 SÍ se persiste y es obligatorio ⇒ se muestra el real). ⛔ nunca `playerName`. */
  name?: string | null;
  /** ⭐M-84 teléfono MX del lead (obligatorio merchant/sponsor; «—» si faltara). Correo INTERNO al staff ⇒ puede llevarlo. */
  phone?: string | null;
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
  const telefono = (p.phone ?? '').trim() || '—';
  const quien = (p.name ?? '').trim() || p.email;
  const fuente = `${p.utmSource ?? '—'}/${p.utmMedium ?? '—'}/${p.utmCampaign ?? '—'}`;
  const fecha = cdmxDateTime(p.createdAt);
  const subject = `[Card Show] Nuevo ${tipo.toLowerCase()}: ${quien}`;
  const cuerpo =
    `Nuevo registro en la landing del Card Show. Tipo: ${tipo} · Nombre: ${nombre} · Teléfono: ${telefono} · Correo: ${p.email} · ` +
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

// ───────────────────────────── ⭐M-84 Correo-resumen periódico (§CARDSHOW.15) ─────────────────────────────

/**
 * Conteos AGREGADOS de una ventana temporal. ⛔ 0 PII: solo cifras (nunca `name`/`phone`/`email`/`playerName`).
 */
export interface SummaryWindowCounts {
  leadsByType: Record<string, number>; // merchant/sponsor/visitor
  gameInterest: Record<string, number>; // juego de interés de visitantes
  raffleOptIns: number; // visitantes con raffleOptIn=true
  playersByGame: Record<string, number>;
  playersByDay: Record<string, number>; // sat/sun
  leadsTotal: number;
  playersTotal: number;
}

export interface LeadsSummaryParams {
  generatedAt: Date;
  today: SummaryWindowCounts;
  last7d: SummaryWindowCounts;
  total: SummaryWindowCounts;
  /** Enlace de descarga AUTENTICADO (detrás de sesión super_admin) al export de leads. ⛔ NO se adjunta CSV. */
  leadsCsvUrl: string;
  /** Enlace de descarga AUTENTICADO al export del torneo (contiene PII de posibles menores ⇒ nunca en el cuerpo). */
  playersCsvUrl: string;
}

/** Representa un objeto de conteos `{clave: n}` como `clave=a: 1 · clave=b: 2` (orden estable). */
function countsLine(label: string, counts: Record<string, number>): string {
  const keys = Object.keys(counts).sort();
  const body = keys.length ? keys.map((k) => `${k}: ${counts[k]}`).join(' · ') : '—';
  return `${label}: ${body}`;
}

function windowBlock(title: string, w: SummaryWindowCounts): string[] {
  return [
    `— ${title} —`,
    `Leads confirmados: ${w.leadsTotal}`,
    countsLine('  por tipo', w.leadsByType),
    countsLine('  interés de juego (visitantes)', w.gameInterest),
    `  opt-ins de rifa: ${w.raffleOptIns}`,
    `Preinscripciones confirmadas: ${w.playersTotal}`,
    countsLine('  por juego', w.playersByGame),
    countsLine('  por día', w.playersByDay),
  ];
}

/**
 * ⭐M-84 (§CARDSHOW.15, ARCHITECTURE §4.CARDSHOW.q) — Resumen periódico INTERNO: SOLO conteos + enlaces de
 * descarga autenticados. ⛔ 0 PII en el cuerpo (ni `name`/`phone`/`email`/`playerName`/`playerId`) — el CSV de
 * players contiene nombres de posibles MENORES, que §CARDSHOW.12 prohíbe enviar a terceros: por eso ⛔ no se
 * adjunta y la PII solo se materializa tras autenticarse. Solo filas CONFIRMADAS (⛔ sin PENDING), sin IP.
 */
export function renderLeadsSummary(p: LeadsSummaryParams): { subject: string; html: string; text: string } {
  const fecha = cdmxDate(p.generatedAt);
  const subject = `[Card Show] Resumen ${fecha}: ${p.today.leadsTotal} leads + ${p.today.playersTotal} preinscritos hoy`;
  const lineas = [
    ...windowBlock('Hoy', p.today),
    '',
    ...windowBlock('Últimos 7 días', p.last7d),
    '',
    ...windowBlock('Total acumulado', p.total),
    '',
    `Descargar CSV de leads (requiere sesión): ${p.leadsCsvUrl}`,
    `Descargar CSV del torneo (requiere sesión): ${p.playersCsvUrl}`,
  ];
  const blocks = [proseRow('Resumen del Card Show (solo confirmados). Los datos personales viven tras tu sesión del panel: descárgalos con los enlaces de abajo.'), ...lineas.map((l) => (l === '' ? proseRow(' ') : monoRow(l)))];
  const html = mailShell({
    locale: 'es',
    title: subject,
    preheader: `Resumen del Card Show al ${fecha} (solo conteos; PII tras autenticación).`,
    blocks,
    footerWhy: 'Resumen periódico interno del equipo TCG HUNT (landing del Card Show).',
    audience: 'staff',
  });
  const text = `${lineas.join('\n')}\n`;
  return { subject, html, text };
}
