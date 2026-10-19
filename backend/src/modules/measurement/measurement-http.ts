/**
 * measurement-http.ts — el ÚNICO sitio por el que la medición sale a la red (GA4 Measurement Protocol y Meta CAPI).
 * Puerto inyectable: las pruebas lo sustituyen por un doble (⛔ no hay red a Google/Meta desde CI ni desde aquí).
 *
 * ⛔ Este módulo no registra nada: ni URL (lleva `api_secret`), ni cuerpo, ni error del proveedor. Devuelve solo el código
 * HTTP; un fallo de red/timeout se devuelve como `null` (el drenador lo trata como reintentable).
 */
export const MEASUREMENT_HTTP = Symbol('MEASUREMENT_HTTP');

export interface MeasurementHttp {
  /** POST JSON. Devuelve el código HTTP o `null` si no hubo respuesta (red, DNS, timeout). ⛔ Nunca lanza. */
  postJson(url: string, body: unknown, timeoutMs: number): Promise<number | null>;
}

/** Implementación real sobre `fetch` global (Node ≥ 18). */
export const fetchMeasurementHttp: MeasurementHttp = {
  async postJson(url, body, timeoutMs) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      // El cuerpo de la respuesta no se lee ni se guarda (⛔ texto de error del proveedor).
      await res.body?.cancel().catch(() => undefined);
      return res.status;
    } catch {
      return null;
    }
  },
};
