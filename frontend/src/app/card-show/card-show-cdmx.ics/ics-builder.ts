/**
 * Constructor del VCALENDAR del Card Show CDMX. Vive FUERA de `route.ts` a propósito: Next.js (App
 * Router) no admite exports extra en un `route.ts` (solo `GET/POST/...` y su config), y el build de
 * producción falla si `buildCardShowIcs` se exporta desde ahí. `route.ts` lo IMPORTA y lo usa en `GET()`;
 * `route.test.ts` lo importa de aquí.
 *
 * Sirve un VCALENDAR válido con DOS VEVENT (sáb 5 y dom 6 dic 2026, America/Mexico_City). Fecha/sede/textos
 * se IMPORTAN de `@/content/card-show` (no se duplican).
 *
 * Zona horaria: VTIMEZONE America/Mexico_City (sin DST desde 2022-10-30 → offset fijo -06:00, que
 * coincide con `countdownTargetIso`). Abre bien en Google/Apple Calendar.
 */
import { CARD_SHOW } from '@/content/card-show';

const TZID = 'America/Mexico_City';

/** Fecha/hora propia del VCALENDAR (fija → salida determinista y cacheable). */
const DTSTAMP = '20261016T000000Z';

// Saturday start DERIVADO de content ('2026-12-05T11:00:00-06:00' → '20261205' + '110000').
const [satDate, satStart] = (() => {
  const [fecha, hora] = CARD_SHOW.countdownTargetIso.split('T');
  return [fecha.replace(/-/g, ''), hora.slice(0, 8).replace(/:/g, '')];
})();

interface Evento {
  uid: string;
  /** YYYYMMDD en hora local de CDMX. */
  date: string;
  /** HHMMSS inicio. */
  start: string;
  /** HHMMSS fin. */
  end: string;
}

const EVENTOS: Evento[] = [
  { uid: 'card-show-cdmx-2026-sat@tcghunt.mx', date: satDate, start: satStart, end: '190000' },
  { uid: 'card-show-cdmx-2026-sun@tcghunt.mx', date: '20261206', start: '110000', end: '180000' },
];

const SUMMARY = `${CARD_SHOW.hero.titulo} CDMX`;
const LOCATION = CARD_SHOW.comoLlegar.direccion;
const DESCRIPTION = `${CARD_SHOW.hero.entrada}. ${CARD_SHOW.hero.presenta}.`;
const URL = CARD_SHOW.canonicalUrl;

/** Escapa un valor de texto iCalendar (RFC 5545 §3.3.11). */
function esc(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Plegado de líneas RFC 5545 §3.1: ≤75 octetos; continuación con un espacio inicial (cuenta al límite). */
function foldLine(line: string): string {
  const enc = new TextEncoder();
  const parts: string[] = [];
  let cur = '';
  let curBytes = 0;
  let limit = 75;
  for (const ch of Array.from(line)) {
    const b = enc.encode(ch).length;
    if (curBytes + b > limit) {
      parts.push(cur);
      cur = ch;
      curBytes = b;
      limit = 74; // las líneas de continuación llevan un espacio inicial que cuenta
    } else {
      cur += ch;
      curBytes += b;
    }
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

/** Construye el cuerpo VCALENDAR completo (CRLF, líneas plegadas). Exportado para pruebas y para `route.ts`. */
export function buildCardShowIcs(): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//TCG HUNT//Card Show CDMX//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VTIMEZONE',
    `TZID:${TZID}`,
    'BEGIN:STANDARD',
    'DTSTART:20221030T020000',
    'TZOFFSETFROM:-0500',
    'TZOFFSETTO:-0600',
    'TZNAME:CST',
    'END:STANDARD',
    'END:VTIMEZONE',
  ];

  for (const e of EVENTOS) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}`,
      `DTSTAMP:${DTSTAMP}`,
      `DTSTART;TZID=${TZID}:${e.date}T${e.start}`,
      `DTEND;TZID=${TZID}:${e.date}T${e.end}`,
      `SUMMARY:${esc(SUMMARY)}`,
      `LOCATION:${esc(LOCATION)}`,
      `DESCRIPTION:${esc(DESCRIPTION)}`,
      `URL:${esc(URL)}`,
      'STATUS:CONFIRMED',
      'TRANSP:OPAQUE',
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');

  return lines.map(foldLine).join('\r\n') + '\r\n';
}
