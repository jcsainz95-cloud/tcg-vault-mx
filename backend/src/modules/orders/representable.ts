/**
 * representable.ts — MS-2 (BE-27) · FUENTE ÚNICA del mapeo de overflow de AGREGADOS a error de negocio. PURO.
 *
 * Ejecuta el cómputo de un desglose y, si `grossUpTotal` lanzó por un `totalCents` no representable en Int32
 * (> `MAX_CENTS`), lo traduce a `422 AMOUNT_TOO_LARGE` en vez de dejar propagar un 500 crudo o —peor— reventar al
 * persistir la orden. Un agregado NUNCA se clampa (recortar = subcobro): se RECHAZA. Cualquier otro `Error` (p. ej. mala
 * config de la comisión) se propaga tal cual. Lo usan `OrdersService.representableOrThrow` (que delega aquí),
 * `directShipBreakdownOf` (`shipping-rule.ts`) y los desgloses con código (`discounts/discount-pricing.ts`, TL-ENV-1).
 */
import { BusinessException } from '../../common/business.exception';

export function representableOrThrow<T extends { totalCents: number }>(compute: () => T): T {
  try {
    return compute();
  } catch (e) {
    if (e instanceof Error && e.message.includes('MAX_CENTS')) {
      throw BusinessException.validation('AMOUNT_TOO_LARGE', 'Order amount exceeds the maximum representable value; please split the order.');
    }
    throw e;
  }
}
