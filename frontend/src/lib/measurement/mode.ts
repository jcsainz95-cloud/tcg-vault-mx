/**
 * §MKT.H.1 / ARCHITECTURE §14.1 — el interruptor de la Fase 2 de marketing en el frontend.
 *
 * `NEXT_PUBLIC_MEASUREMENT_MODE` se hornea en el build (`next.config.mjs` la normaliza a `off` | `on`
 * para que SIEMPRE llegue como literal al compilador). Ausente, vacía, `ON`, `true`… ⇒ `off`.
 *
 * ⚠️ C-F1 depende de que la comparación con el literal esté ESCRITA en cada sitio que decide si entra
 * código de medición al bundle (`process.env.NEXT_PUBLIC_MEASUREMENT_MODE === 'on'`): el compilador
 * la sustituye por `"off" === 'on'`, la evalúa a `false` y no recorre la rama (el `import()` del
 * cargador no llega a crear su trozo). Una constante exportada desde aquí NO sirve para eso: entre
 * módulos el compilador no sabe su valor. Por eso este fichero solo da utilidades puras.
 */

export type MeasurementMode = 'off' | 'on';

/** Solo el texto exacto `on` enciende. Todo lo demás (también `ON`) es `off` (C-B1, espejo). */
export function parseMeasurementMode(raw: unknown): MeasurementMode {
  return raw === 'on' ? 'on' : 'off';
}

/** Forma válida de los IDs públicos (§MKT.H.1). Un ID que no cumple ⇒ esa etiqueta no carga. */
export const GA4_ID_RE = /^G-[A-Z0-9]{4,12}$/;
export const META_PIXEL_ID_RE = /^\d{10,20}$/;

export interface MeasurementIds {
  ga4: string | null;
  pixel: string | null;
}

export function parseMeasurementIds(raw: { ga4?: string | null; pixel?: string | null }): MeasurementIds {
  const ga4 = (raw.ga4 ?? '').trim();
  const pixel = (raw.pixel ?? '').trim();
  return {
    ga4: GA4_ID_RE.test(ga4) ? ga4 : null,
    pixel: META_PIXEL_ID_RE.test(pixel) ? pixel : null,
  };
}

/** Los IDs del build (lectura en tiempo de llamada: en pruebas se pueden fijar con `vi.stubEnv`). */
export function measurementIdsFromEnv(): MeasurementIds {
  return parseMeasurementIds({
    ga4: process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID,
    pixel: process.env.NEXT_PUBLIC_META_PIXEL_ID,
  });
}

/**
 * ¿Hay algo que pedir? `on` y al menos una etiqueta con ID válido (ARCHITECTURE §14.1, fail-closed:
 * «si no carga ninguna, el banner tampoco se muestra»; DESIGN_SYSTEM MKT2-UX.0 CK-1).
 */
export function measurementActive(mode: MeasurementMode, ids: MeasurementIds): boolean {
  return mode === 'on' && (ids.ga4 !== null || ids.pixel !== null);
}

/** Modo del proceso, leído en tiempo de llamada (pruebas). En el bundle, el literal ya está horneado. */
export function measurementModeFromEnv(): MeasurementMode {
  return parseMeasurementMode(process.env.NEXT_PUBLIC_MEASUREMENT_MODE);
}
