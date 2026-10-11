import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { isThrottlerDisabled } from '../../config/test-env';

/**
 * ⭐ D2d (API_CONTRACT §M4-SHIP.19.10: «`refresh-tracking` … `@Throttle 6/min` por envío») — el cubo cuelga del ENVÍO
 * (`:id` de la ruta), no de la IP ni del actor: cada clic en «Actualizar rastreo» es una lectura a Skydropx (≤ 2 req/s
 * para toda la cuenta), y lo que se protege es esa cuota. Mismo patrón que `ActorThrottlerGuard` (`admin/`), sin tocarlo.
 * ⚠️ El guard global sigue con su cuenta por IP (dos cubos, gana el más estricto).
 */
@Injectable()
export class ShipmentThrottlerGuard extends ThrottlerGuard {
  protected async shouldSkip(context: Parameters<ThrottlerGuard['shouldSkip']>[0]): Promise<boolean> {
    // Bajo `NODE_ENV=test` la suite golpea en ráfaga (misma excepción que `AppThrottlerGuard`).
    if (isThrottlerDisabled()) return true;
    return super.shouldSkip(context);
  }

  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    return shipmentThrottleKey(req);
  }
}

/** La llave del cubo: `shipment:<id>` (función pura; la prueba la usa). */
export function shipmentThrottleKey(req: Record<string, unknown>): string {
  const params = req.params as { id?: unknown } | undefined;
  return typeof params?.id === 'string' && params.id !== '' ? `shipment:${params.id}` : 'shipment:anon';
}
