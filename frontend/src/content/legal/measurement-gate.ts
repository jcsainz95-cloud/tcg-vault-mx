import type { LegalDocument } from './privacidad.es';
import { textsOf } from './legal-gate';

/**
 * ARCHITECTURE §14.1 (D-MKT2-0b) · candado C-D1 — **encender la medición exige el aviso nuevo.**
 *
 * Con `NEXT_PUBLIC_MEASUREMENT_MODE=on`, el aviso que se va a publicar tiene que:
 *  1. tener `measurementDisclosure` (versión + fechas de aprobación del dueño y revisión legal);
 *  2. haber perdido la frase vieja «No usamos cookies de publicidad ni de analítica»
 *     (`privacidad.es.ts`, apartado 8);
 *  3. nombrar Google Analytics, Meta, `_fbp`, `_fbc`, `th_first_utm`, `th_consent` y la retención de
 *     14 meses.
 * Con `off`, nada de esto se exige (el aviso nuevo puede salir antes, §D5.4).
 *
 * El rótulo para el registro del build es el de DESIGN_SYSTEM MKT2-UX.12 (`formatMeasurementNoticeReport`,
 * candado C-F17). ⛔ El rótulo no imprime IDs ni secretos: solo modo, conteo y problemas de texto.
 * ⛔ Este fichero no escribe el aviso: lo trae el abogado.
 */

export type NoticeMeasurementMode = 'off' | 'on';

/** La frase del aviso actual que deja de ser cierta al encender (sin el `**` de negrita). */
export const OLD_NO_MEASUREMENT_SENTENCE = 'No usamos cookies de publicidad ni de analítica';

/** Lo que el aviso tiene que nombrar (orden = el de MKT2-UX.12). */
export const REQUIRED_MEASUREMENT_TERMS: ReadonlyArray<{ label: string; re: RegExp }> = [
  { label: 'Google Analytics', re: /Google Analytics/ },
  { label: 'Meta', re: /\bMeta\b/ },
  { label: '_fbp', re: /_fbp\b/ },
  { label: '_fbc', re: /_fbc\b/ },
  { label: 'th_first_utm', re: /\bth_first_utm\b/ },
  { label: 'th_consent', re: /\bth_consent\b/ },
  { label: 'retención de 14 meses', re: /\b14\s+meses\b/i },
];

const VERSION_RE = /^[A-Za-z0-9._-]{1,32}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Texto plano del aviso: sin `**` de negrita y con espacios normalizados. */
function plainText(doc: LegalDocument): string {
  return textsOf(doc)
    .join('\n')
    .replace(/\*\*/g, '')
    .replace(/[ \t ]+/g, ' ');
}

/** Problemas de la declaración de medición. Vacío ⇒ el aviso declara la medición. */
export function measurementNoticeProblems(doc: LegalDocument): string[] {
  const problems: string[] = [];
  const d = doc.measurementDisclosure;
  if (d === null || d === undefined) {
    problems.push('measurementDisclosure es null: el aviso no declara la medición');
  } else {
    const bad: string[] = [];
    if (!VERSION_RE.test(d.version ?? '')) bad.push('version');
    if (!DATE_RE.test(d.approvedByOwnerOn ?? '')) bad.push('approvedByOwnerOn');
    if (!DATE_RE.test(d.legalReviewOn ?? '')) bad.push('legalReviewOn');
    if (bad.length > 0) problems.push(`measurementDisclosure mal formado: ${bad.join(', ')}`);
  }
  const text = plainText(doc);
  if (text.includes(OLD_NO_MEASUREMENT_SENTENCE)) {
    problems.push(`el aviso aún dice «${OLD_NO_MEASUREMENT_SENTENCE}»`);
  }
  const missing = REQUIRED_MEASUREMENT_TERMS.filter((t) => !t.re.test(text)).map((t) => t.label);
  if (missing.length > 0) problems.push(`el aviso no nombra: ${missing.join(', ')}`);
  return problems;
}

/** Problemas según el modo: con `off`, ninguno. */
export function measurementGateProblems(mode: NoticeMeasurementMode, doc: LegalDocument): string[] {
  return mode === 'on' ? measurementNoticeProblems(doc) : [];
}

/**
 * Rótulo de MKT2-UX.12 (C-F17). Primera línea = código greppable:
 *  - `MEASUREMENT_NOTICE_REQUIRED mode=on problems=<N>` + explicación + cada problema + salidas (a)/(b);
 *  - `MEASUREMENT_NOTICE_OK mode=on version=<v>` o `MEASUREMENT_NOTICE_OK mode=off` (una sola línea).
 */
export function formatMeasurementNoticeReport(
  mode: NoticeMeasurementMode,
  problems: readonly string[],
  version: string | null,
): string[] {
  if (mode === 'off') return ['MEASUREMENT_NOTICE_OK mode=off'];
  if (problems.length === 0) return [`MEASUREMENT_NOTICE_OK mode=on version=${version ?? ''}`];
  return [
    `MEASUREMENT_NOTICE_REQUIRED mode=on problems=${problems.length}`,
    '  El build NO se publica: la medición está encendida (NEXT_PUBLIC_MEASUREMENT_MODE=on) y el aviso de privacidad no la declara.',
    ...problems.map((p) => `  - ${p}`),
    '  Para publicar: (a) publica el aviso revisado (measurementDisclosure con versión y fechas) o (b) pon NEXT_PUBLIC_MEASUREMENT_MODE=off.',
    '  El sitio en línea no cambia con este build.',
  ];
}
