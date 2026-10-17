/**
 * card-show-welcome.templates.ts — v1.93⟨cardshow⟩ (API_CONTRACT §CARDSHOW.9 C3-W; §CARDSHOW.6).
 *
 * ⭐ **Correo de BIENVENIDA (C3-W), 3 variantes por `CardShowLeadType` (merchant/sponsor/visitor).**
 * Se envía **una sola vez** al CONFIRMAR un lead (PENDING→`new`), a un buzón **YA confirmado** ⇒ puede
 * llevar contenido **RICO** (`wa.me`, `utm_*`, Google Drive, `mailto:`, `.ics`, Google Maps). Esto es lo
 * que lo distingue del correo de CONFIRMACIÓN C3 (estricto, `card-show-mail.service.ts`): C3-W va a quien
 * **ya probó el consentimiento**, así que la restricción anti-marketing de C3 ⛔ NO le aplica (§4.CARDSHOW.m).
 *
 * ⛔ **Nunca `playerName`** (los leads ni siquiera lo tienen) y ⛔ **ningún nombre de patrocinador**.
 *
 * Reusa el ESQUELETO de marca (`mailShell`, §31) para el shell (marca + pie + aviso de privacidad) y
 * compone el CUERPO con builders RICOS locales que SÍ admiten `mailto:` (el esqueleto estricto solo
 * admite http(s) por diseño, por eso C3-W no usa `ctaRows`/`smallLinkRow` de allí). Los valores de los
 * enlaces viven en `card-show-content.ts` (datos PÚBLICOS del evento).
 */

import { ACCENT, escapeHtml, INK, mailShell, MONO, MUTED, PAPER, SANS, SERIF, spacerRow } from '../buylist/mail-shell';
import {
  CARD_SHOW_MAPS_URL,
  CARD_SHOW_MERCHANT_WA_URL,
  CARD_SHOW_SPONSOR_MAILTO,
  cardShowCalendarIcsUrl,
  WelcomeVariant,
} from './card-show-content';

const LH = 'mso-line-height-rule:exactly';
const PAD = 32;

/** El porqué del pie (§31.6h) — buzón que confirmó explícitamente su registro. */
const WELCOME_FOOTER_WHY = 'Recibes este correo porque confirmaste tu registro para el Card Show de TCG HUNT.';

// ── Builders RICOS locales (mismos tokens de §31, pero el href admite también `mailto:`) ──

function cell(bg: string, style: string, content: string, attrs = ''): string {
  return `<td${attrs ? ` ${attrs}` : ''} bgcolor="${bg}" style="background-color:${bg};${style}">${content}</td>`;
}
function presTable(inner: string, attrs = 'width="100%"'): string {
  return `<table role="presentation" ${attrs} cellpadding="0" cellspacing="0" border="0">${inner}</table>`;
}
function paddedRow(content: string, padY = '0'): string {
  return `<tr>${cell(PAPER, `padding:${padY} ${PAD}px`, content, 'class="px"')}</tr>`;
}

/** C3-W RICO: el href admite http(s) **y `mailto:`** (buzón ya confirmado). Allowlist, no denylist. */
function richSafeUrl(url: string): boolean {
  try {
    const p = new URL(url).protocol;
    return p === 'https:' || p === 'http:' || p === 'mailto:';
  } catch {
    return false;
  }
}

function proseRow(text: string): string {
  return paddedRow(
    presTable(`<tr>${cell(PAPER, `font-family:${SANS};font-size:15px;line-height:1.55;${LH};color:${INK}`, escapeHtml(text))}</tr>`),
  );
}

function headingRow(text: string): string {
  return paddedRow(
    presTable(
      `<tr>${cell(PAPER, `font-family:${SERIF};font-size:22px;line-height:1.15;${LH};font-weight:normal;color:${INK};padding:8px 0 0`, escapeHtml(text))}</tr>`,
    ),
  );
}

/** Botón RICO + su URL en texto debajo (respaldo de §31.8 r4c). Con esquema no admitido ⇒ sin `<a>`. */
function ctaRow(url: string, label: string, tone: 'accent' | 'ink'): string {
  const bg = tone === 'accent' ? ACCENT : INK;
  const rotulo = `font-family:${SANS};font-size:15px;line-height:16px;${LH};font-weight:bold;letter-spacing:.06em;color:${PAPER};text-decoration:none;display:inline-block`;
  const inner = richSafeUrl(url)
    ? `<a href="${escapeHtml(url)}" style="${rotulo}">${escapeHtml(label)}</a>`
    : `<span style="${rotulo}">${escapeHtml(label)}</span>`;
  const boton = presTable(`<tr>${cell(bg, `border:1px solid ${bg};padding:14px 28px`, inner, 'align="center"')}</tr>`, 'align="center" width="auto"');
  const urlText = paddedRow(
    presTable(
      `<tr>${cell(PAPER, `font-family:${MONO};font-size:12px;line-height:1.5;${LH};color:${MUTED};word-break:break-all;padding:12px 0 0`, escapeHtml(url), 'align="center"')}</tr>`,
    ),
  );
  return paddedRow(presTable(`<tr>${cell(PAPER, 'padding:0', boton, 'align="center"')}</tr>`)) + urlText;
}

/** Prefijo de saludo del dueño: «Hola, {nombre}:» o «Hola:» si no hay nombre (los leads no tienen nombre). */
export function saludo(name?: string | null): string {
  const n = (name ?? '').trim();
  return n ? `Hola, ${n}:` : 'Hola:';
}

interface Variant {
  subject: string;
  preheader: string;
  blocks: string[];
  text: string;
}

// ⭐IMP-1 — pivote a CAPTURA DE INTERÉS: el correo de bienvenida de vendedor ⛔ NO promete «plano» ni
// «mesa #» (se retiraron del producto). Alinea con la landing: «te contactamos en privado con las
// opciones de mesa, sin precios públicos». CTA = WhatsApp con texto GENÉRICO (quiero vender), no apartar
// una mesa concreta.
function merchantVariant(name: string | null | undefined): Variant {
  const s = saludo(name);
  const lines = [
    `${s} Gracias por tu interés en vender en el Card Show CDMX.`,
    'Sábado 5 de diciembre, 11:00–19:00 · Domingo 6 de diciembre, 11:00–18:00',
    'José del Castillo 3, esq. Av. Revolución, San José Insurgentes, CDMX',
    'Te contactamos en privado con las opciones de mesa y la logística (montaje, luz, WiFi para terminal y seguridad en el acceso). Cuéntanos qué vendes y resolvemos el espacio contigo por WhatsApp.',
  ];
  const cierre = 'Nos vemos en diciembre, TCG HUNT × Jakomi TCG Café · tcghunt.mx · @tcghunt.mx';
  return {
    subject: 'Tu interés de venta en el Card Show CDMX · 5 y 6 de diciembre',
    preheader: 'Gracias por tu interés en vender en el Card Show CDMX, 5 y 6 de diciembre — te contactamos.',
    blocks: [
      headingRow('Vender en el Card Show CDMX'),
      ...lines.map(proseRow),
      spacerRow(8),
      ctaRow(CARD_SHOW_MERCHANT_WA_URL, 'Escríbenos por WhatsApp', 'accent'),
      spacerRow(8),
      proseRow(cierre),
    ],
    text:
      `${lines.join('\n\n')}\n\n` +
      `Escríbenos por WhatsApp: ${CARD_SHOW_MERCHANT_WA_URL}\n\n` +
      `${cierre}\n`,
  };
}

// ⭐M-89 (dueño JC 2026-10-17) — SIN cifras ni copy heredado: ⛔ nada de $25,000/$8,500, «presented by»,
// «prize partner» ni «deck». El correo invita a PEDIR LA PROPUESTA de patrocinio (los niveles y montos van
// en la propuesta privada, no en el correo público).
function sponsorVariant(name: string | null | undefined): Variant {
  const s = saludo(name);
  const lines = [
    `${s} Gracias por tu interés en patrocinar el Card Show CDMX, el 5 y 6 de diciembre en San José Insurgentes, CDMX, con entrada libre y foco en Pokémon TCG.`,
    'Tenemos varios niveles de patrocinio con activación, presencia en el evento y en digital. Cuéntanos qué marca representas y te enviamos la propuesta de patrocinio con los detalles.',
  ];
  const cierre =
    'Respóndenos este correo y te buscamos para platicarlo. Juan Carlos Sainz · TCG HUNT × Jakomi TCG Café · tcghunt.mx · WhatsApp 55 6489 3921';
  return {
    subject: 'Patrocinio del Card Show CDMX · pide la propuesta',
    preheader: 'Gracias por tu interés en patrocinar el Card Show CDMX, 5 y 6 de diciembre.',
    blocks: [
      headingRow('Patrocinio del Card Show CDMX'),
      ...lines.map(proseRow),
      spacerRow(8),
      ctaRow(CARD_SHOW_SPONSOR_MAILTO, 'Pide la propuesta de patrocinio', 'accent'),
      spacerRow(8),
      proseRow(cierre),
    ],
    text:
      `${lines.join('\n\n')}\n\n` +
      `Pide la propuesta de patrocinio: ${CARD_SHOW_SPONSOR_MAILTO}\n\n` +
      `${cierre}\n`,
  };
}

function visitorVariant(name: string | null | undefined, base: string): Variant {
  const s = saludo(name);
  const ics = cardShowCalendarIcsUrl(base);
  const lines = [
    `${s} Ya estás registrado. Te esperamos en el Card Show CDMX.`,
    'Sábado 5 de diciembre, 11:00–19:00 · Domingo 6 de diciembre, 11:00–18:00',
    'José del Castillo 3, esq. Av. Revolución, San José Insurgentes, CDMX · Entrada libre',
    'Vas a encontrar vendedores de singles y sellado, el torneo main de Pokémon cada día (inscripción MX$200; la puedes pagar por adelantado o en sitio), mesas libres para jugar e intercambiar y comida. Llega en Metro a Mixcoac (Líneas 7 y 12), a 5 minutos caminando.',
  ];
  const cierre = 'Los horarios finales del torneo salen en los próximos días en @tcghunt.mx. TCG HUNT × Jakomi TCG Café · tcghunt.mx';
  return {
    subject: '¡Nos vemos en el Card Show CDMX! · 5 y 6 de diciembre',
    preheader: 'Te esperamos en el Card Show CDMX, 5 y 6 de diciembre, entrada libre.',
    blocks: [
      headingRow('¡Nos vemos en el Card Show CDMX!'),
      ...lines.map(proseRow),
      spacerRow(8),
      ctaRow(ics, 'Agregar al calendario', 'accent'),
      spacerRow(8),
      ctaRow(CARD_SHOW_MAPS_URL, 'Cómo llegar', 'ink'),
      spacerRow(8),
      proseRow(cierre),
    ],
    text:
      `${lines.join('\n\n')}\n\n` +
      `Agregar al calendario: ${ics}\n` +
      `Cómo llegar: ${CARD_SHOW_MAPS_URL}\n\n` +
      `${cierre}\n`,
  };
}

function buildVariant(type: WelcomeVariant, name: string | null | undefined, base: string): Variant {
  switch (type) {
    case 'merchant':
      return merchantVariant(name);
    case 'sponsor':
      return sponsorVariant(name);
    case 'visitor':
      return visitorVariant(name, base);
    default: {
      // Exhaustividad: si el enum crece, el typecheck obliga a añadir la variante aquí.
      const _never: never = type;
      throw new Error(`Card Show: tipo de lead sin variante de bienvenida: ${String(_never)}`);
    }
  }
}

export interface WelcomeParams {
  to: string;
  type: WelcomeVariant;
  /** Los leads no persisten nombre ⇒ hoy siempre ausente (saludo «Hola:»). Se admite para reuso futuro. */
  name?: string | null;
  /** One-click (RFC 8058) con token de un solo uso, propósito `unsubscribe`, atado a la fila del lead. */
  unsubscribeOneClickUrl: string;
  /** Origen propio para armar el enlace `.ics` (mismo `publicBase()` que los enlaces de confirmación). */
  base: string;
}

/** Renderiza la bienvenida C3-W. Público para que las pruebas afirmen variante, enlaces ricos y 0 `playerName`. */
export function renderWelcome(p: WelcomeParams): { to: string; subject: string; html: string; text: string; headers: Record<string, string> } {
  const v = buildVariant(p.type, p.name, p.base);
  const html = mailShell({
    locale: 'es',
    title: v.subject,
    preheader: v.preheader,
    blocks: v.blocks,
    footerWhy: WELCOME_FOOTER_WHY,
  });
  return {
    to: p.to,
    subject: v.subject,
    html,
    text: v.text,
    headers: {
      'List-Unsubscribe': `<${p.unsubscribeOneClickUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}
