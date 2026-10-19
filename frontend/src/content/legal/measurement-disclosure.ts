/**
 * ARCHITECTURE §14.1 (D-MKT2-0b) — metadatos de la DECLARACIÓN de medición del aviso de privacidad.
 *
 * `null` = el aviso NO declara la medición (hoy). Con `NEXT_PUBLIC_MEASUREMENT_MODE=on`, `null` hace
 * fallar el build (`publish-check.ts` · `measurementNoticeProblems`). ⛔ Este fichero NO lleva texto
 * del aviso: el texto lo trae el abogado y vive en `privacidad.es.ts`. Aquí solo van la versión y las
 * dos fechas que el dueño confirma al publicarlo.
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
  /** AAAA-MM-DD de la revisión del abogado. */
  legalReviewOn: string;
}

export const MEASUREMENT_DISCLOSURE: MeasurementDisclosure | null = null;
