/**
 * ARCHITECTURE §14.4 (D-MKT2-8, v1.109) · candado C-F5 — el PASO de crear la solicitud de venta vive en su
 * propia ruta, EXCLUIDA de la medición (`lib/measurement/routes.ts`), porque es el que pinta CLABE e INE
 * (`BuylistKycForm`). El cotizador (`/buylist`) sí se mide: su documento ya no pinta ninguno de los dos.
 *
 * Se llega con NAVEGACIÓN DURA (documento nuevo), siempre, con la medición encendida o apagada: así la
 * propiedad «nunca un campo de CLABE/INE en un documento con `gtag`/`fbq`» no depende de que el parche del
 * router de `MeasurementProvider` esté puesto. El carrito de venta persiste en `localStorage`
 * (`useSellCart`, `tcg.sellCart`), así que el documento nuevo lo rehidrata y lo recotiza.
 */

/** Ruta del paso, SIN prefijo de idioma. ⛔ No entra en `MEASURED_ROUTE_PATTERNS`. */
export const SELL_REQUEST_STEP_PATH = '/buylist/solicitud';

/** URL con idioma del paso (`/es/buylist/solicitud`). */
export function sellRequestStepHref(locale: string): string {
  return `/${locale}${SELL_REQUEST_STEP_PATH}`;
}

/** Navegación DURA al paso: `location.assign`, nunca el router de Next (`assign` inyectable solo para pruebas). */
export function goToSellRequestStep(locale: string, assign: (url: string) => void = (u) => window.location.assign(u)): void {
  assign(sellRequestStepHref(locale));
}
