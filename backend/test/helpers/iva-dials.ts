/**
 * iva-dials.ts — ⭐ **el doble de los DOS diales que derivan `P`, para los tests unitarios.**
 * (`ARCHITECTURE §4.44.b`, `API_CONTRACT §M10-IVA.3`, D56.)
 *
 * ### Por qué existe y por qué está aquí y no copiado en veinte ficheros
 * Desde D56, **todo** camino que produzca un precio de cara al cliente —catálogo, quote, checkout,
 * envío— necesita `t` (`iva_transfer_pct`) y `r` (`iva_pct`). Los tests unitarios construyen sus
 * servicios a mano con dobles de `SettingsService`, así que sin este helper cada fichero inventaría
 * su propia pareja de diales. **Veinte fixtures de dinero sin una fuente común es cómo un candado
 * acaba midiendo una posición del dial que el código nunca usa.**
 *
 * ### ⚠️ El default es el NEUTRO, y eso es deliberado
 * `t = 100`, `r = 16` es **el arranque** del sistema (`SETTING_DEFAULTS`), y con esa posición la
 * especificación reproduce el cobro de antes del corte **al centavo** (criterio **185**). Un test que
 * no diga nada del dial está diciendo *«la posición neutra»*, que es lo que quiere decir.
 *
 * ⛔ **No es un valor por defecto del CÓDIGO.** En producción no hay ninguno: sin diales, la
 * derivación **lanza** (`CatalogService.ivaDialsOf`, `ivaIsIncluded`). Este helper es un doble de
 * prueba y solo vive en `test/`.
 */
import type { IvaDials } from '../../src/common/money';

/** El neutro: dial de traslación al 100 %, tasa 16 %. */
export const IVA_DIALS_NEUTRAL: IvaDials = { ivaTransferPct: 100, ivaRatePct: 16 };

/**
 * Devuelve un `getIvaDials` listo para pegar en un doble de `SettingsService`.
 *
 * @example
 *   const settings: any = { getNumber: jest.fn(async () => 16), ...ivaDialsStub() };
 */
export function ivaDialsStub(dials: IvaDials = IVA_DIALS_NEUTRAL) {
  return { getIvaDials: async (): Promise<IvaDials> => dials };
}
