/**
 * ARCHITECTURE §14.1 (D-MKT2-0b, forma v1.111) — metadatos de la DECLARACIÓN de medición del aviso de privacidad.
 *
 * `null` = el aviso NO declara la medición. Con `NEXT_PUBLIC_MEASUREMENT_MODE=on`, `null` hace fallar el build
 * (`publish-check.ts` · `measurementNoticeProblems`). ⛔ Este fichero NO lleva texto del aviso: el texto aprobado
 * por el dueño (`docs/specs/AVISO_MEDICION_APROBADO.md`) vive en `privacidad.es.ts`. Aquí solo van la versión y
 * las fechas.
 *
 * Vive aparte del aviso para que el navegador pueda leer la versión (va en `th_consent` y en el
 * objeto `measurement` de las peticiones, §MKT.H.2) sin cargar el texto entero del aviso. El aviso
 * la referencia (`privacyNoticeEs.measurementDisclosure`): una sola fuente.
 */

export interface MeasurementDisclosure {
  /** ≤32, `[A-Za-z0-9._-]` (§MKT.H.2 `noticeVersion`). Cambiarla vuelve a preguntar a todos. */
  version: string;
  /** AAAA-MM-DD en que el dueño aprobó el texto. */
  approvedByOwnerOn: string;
  /**
   * AAAA-MM-DD de una revisión legal externa, o `null`. **Exactamente una** de `legalReviewOn` y
   * `legalReviewWaivedByOwnerOn` lleva fecha (`measurementNoticeProblems` y la mínima de `next.config.mjs`).
   * ⛔ La fecha del dueño nunca va aquí: el código afirmaría una revisión que no existió.
   */
  legalReviewOn: string | null;
  /** AAAA-MM-DD en que el dueño renunció a la revisión legal externa, o `null`. */
  legalReviewWaivedByOwnerOn: string | null;
}

// Aprobado por el dueño el 2026-10-26 (HECHOS.md, «Aviso de privacidad con la medición: aprobado»); sin revisión
// legal externa por decisión del dueño del 2026-10-23 (HECHOS.md). ⛔ Sin `;` dentro del objeto: next.config.mjs lo
// lee como texto hasta el primer `;`.
export const MEASUREMENT_DISCLOSURE: MeasurementDisclosure | null = {
  version: '2026-10-medicion-1',
  approvedByOwnerOn: '2026-10-26',
  legalReviewOn: null,
  legalReviewWaivedByOwnerOn: '2026-10-23',
};
