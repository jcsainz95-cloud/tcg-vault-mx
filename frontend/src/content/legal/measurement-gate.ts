import type { LegalDocument } from './privacidad.es';
import { textsOf } from './legal-gate';

/**
 * ARCHITECTURE §14.1 (D-MKT2-0b) · candado C-D1 — **encender la medición exige el aviso nuevo.**
 *
 * Con `NEXT_PUBLIC_MEASUREMENT_MODE=on`, el aviso que se va a publicar tiene que:
 *  1. tener `measurementDisclosure` (versión, fecha de aprobación del dueño y EXACTAMENTE una de
 *     `legalReviewOn` / `legalReviewWaivedByOwnerOn`, v1.111);
 *  2. haber perdido la frase vieja «No usamos cookies de publicidad ni de analítica»
 *     (`privacidad.es.ts`, apartado 8);
 *  3. nombrar Google Analytics, Meta, `_fbp`, `_fbc`, `th_first_utm`, `th_consent` y la retención de
 *     14 meses.
 * Con `off`, nada de esto se exige (el aviso nuevo puede salir antes, §D5.4).
 *
 * El rótulo para el registro del build es el de DESIGN_SYSTEM MKT2-UX.12 (`formatMeasurementNoticeReport`,
 * candado C-F17). ⛔ El rótulo no imprime IDs ni secretos: solo modo, conteo y problemas de texto.
 * ⛔ Este fichero no escribe el aviso: el texto aprobado por el dueño vive en `privacidad.es.ts`.
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

/** v1.111 · exactamente una fecha de revisión. Mismos textos en `next.config.mjs` (paridad probada). */
export const MEASUREMENT_REVIEW_BOTH =
  'measurementDisclosure con las dos fechas (legalReviewOn y legalReviewWaivedByOwnerOn): debe llevar exactamente una';
export const MEASUREMENT_REVIEW_NONE =
  'measurementDisclosure sin fecha en legalReviewOn ni en legalReviewWaivedByOwnerOn: debe llevar exactamente una';

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
    // v1.111: las dos claves siempre escritas (ausente ⇒ mal formada), cada una 'AAAA-MM-DD' o `null`.
    const reviewKeys = ['legalReviewOn', 'legalReviewWaivedByOwnerOn'] as const;
    for (const k of reviewKeys) {
      const v = (d as unknown as Record<string, unknown>)[k];
      if (!(k in d) || !(v === null || (typeof v === 'string' && DATE_RE.test(v)))) bad.push(k);
    }
    if (bad.length > 0) problems.push(`measurementDisclosure mal formado: ${bad.join(', ')}`);
    else {
      const dated = reviewKeys.filter((k) => d[k] !== null).length;
      if (dated === 2) problems.push(MEASUREMENT_REVIEW_BOTH);
      if (dated === 0) problems.push(MEASUREMENT_REVIEW_NONE);
    }
  }
  // MKT.H.13 (v1.105): el botón «Preferencias de cookies» va en un párrafo propio al final del apartado
  // `cookies` (`CookiePreferencesNoticeSlot`), fuera del texto aprobado. Sin ese apartado no tiene sitio.
  if (!doc.sections.some((s) => s.id === 'cookies')) {
    problems.push('el aviso no tiene apartado `cookies` (ahí va «Preferencias de cookies»)');
  }
  const text = plainText(doc);
  if (text.includes(OLD_NO_MEASUREMENT_SENTENCE)) {
    problems.push(`el aviso aún dice «${OLD_NO_MEASUREMENT_SENTENCE}»`);
  }
  const missing = REQUIRED_MEASUREMENT_TERMS.filter((t) => !t.re.test(text)).map((t) => t.label);
  if (missing.length > 0) problems.push(`el aviso no nombra: ${missing.join(', ')}`);
  return problems;
}

/**
 * ARCHITECTURE §14.1 (D-MKT2-0c, v1.106) — lo que se puede fusionar APAGADO pero no encender. Con `on`,
 * cada entrada es un problema de la puerta; con `off`, no cuenta. Una entrada sale **en el mismo commit**
 * que trae su `closedBy` (la prueba que la cierra) en verde.
 */
export interface EncenderBlocker {
  id: string;
  what: string;
  owner: 'backend' | 'frontend' | 'devops';
  closedBy: string;
}

/**
 * Abiertos (TL-MKT2b-f, 2026-10-19). Salieron antes: R4 (C-F8 `lib/measurement/item.test.ts`, C-B10
 * `backend/test/measurement.item.spec.ts` y la paridad `lib/measurement/item.cross.test.ts`) y D2 (`DRAIN_BUDGET_MS`,
 * `backend/test/measurement.drain.spec.ts`), merge `13cf3653`; MKT-TL2 (`backend/test/marketing-cross-table.audit.spec.ts`,
 * `marketing-populations.registry.spec.ts` y `marketing-tl2.expiry.spec.ts` verdes; ficha cerrada en TECH_DEBT), `86ee9bdb`.
 * El formato (ARCHITECTURE §14.1 D-MKT2-0c) no tiene estado «cumplida»: una entrada sale en el mismo commit que
 * trae su `closedBy` en verde, y lo anota su dueño en su ficha de TECH_DEBT. MKT-F2-4 salió el 2026-10-26 (backend:
 * C-B11 verde contra Postgres y reversa de m86 ⇒ `migrate deploy` rc 0, sobre `a05a6e68`; ficha cerrada en TECH_DEBT).
 * SEC-MED-1 entró el 2026-10-26 (seguridad, veredicto `2f5a59c0`) y salió el mismo día (frontend, D-MKT2-11 v1.112.2):
 * C-F4 (`lib/measurement/utm.test.ts`, `track.url.test.ts`) y C-F3 con `?q=` (`e2e/measurement-on.spec.ts` «SEC-MED-1») verdes;
 * ficha cerrada en TECH_DEBT.
 * SEC-MKT-2: paridad con `docs/TECH_DEBT.md` en `measurement-gate.test.ts` — una entrada no sale mientras su ficha
 * siga abierta, y una entrada nueva se registra en `ENCENDER_REGISTRY` de esa prueba.
 */
export const ENCENDER_BLOCKERS: readonly EncenderBlocker[] = [
  {
    id: 'MKT-F2-3',
    // Versión = la fila de `META-GRAPH-VERSION` en API_CONTRACT §MKT.H.1 (v1.112); se cierra con el botón de §MKT.H.12.
    what: "META_GRAPH_API_VERSION ('v26.0') sin verificar vigente para la fecha de encendido",
    owner: 'backend',
    closedBy:
      'evento de prueba de Meta aceptado (POST /admin/measurement/meta-test-event, §MKT.H.12) con la versión fijada en backend/src/modules/measurement/measurement.config.ts, línea META-GRAPH-VERIFIED en BACKEND_NOTES §MKT.H (TECH_DEBT MKT-F2-3)',
  },
];

/** Problemas según el modo: con `off`, ninguno. Con `on`, los del aviso + uno por bloqueo abierto. */
export function measurementGateProblems(
  mode: NoticeMeasurementMode,
  doc: LegalDocument,
  blockers: readonly EncenderBlocker[] = ENCENDER_BLOCKERS,
): string[] {
  if (mode !== 'on') return [];
  return [
    ...measurementNoticeProblems(doc),
    ...blockers.map((b) => `bloqueo de encendido abierto: ${b.id} (${b.owner}) — ${b.what}`),
  ];
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
