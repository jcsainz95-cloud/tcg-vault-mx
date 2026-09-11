import { Injectable, Logger } from '@nestjs/common';
import { OrdersService } from '../modules/orders/orders.service';
import { GuestCheckoutService } from '../modules/orders/guest-checkout.service';

/**
 * OrderReservationSweepJobService — barrido ÚNICO de RESERVAS vencidas (v1.68, API_CONTRACT §4-R.4,
 * ARCHITECTURE §4.48.2; cierra D-SB-1). Sustituye a `guest-order-sweep` (v1.21, amenaza T9).
 *
 * Una orden `pending` retiene **piezas únicas** en `reserved`. Antes solo se barrían los pedidos de
 * INVITADO por `createdAt`; una orden de BÓVEDA `pending` no se barría nunca (D-SB-1). Ahora la pieza
 * lleva su vencimiento (`reservedUntil`, M-53) y el barrido es uno para las DOS rutas: por orden, B3
 * primero (cancelar el PI y comprobar `canceled`; si no, NO se libera y se reintenta en la próxima
 * pasada), luego liberar con la guarda de dueño y `Order → failed`.
 *
 * `run()` encadena DOS pasadas: la de verdad (`OrdersService.sweepExpiredReservations`) y la RAMA
 * LEGADA (`GuestCheckoutService.sweepStaleGuestOrders`: invitados `pending` con piezas sin dueño,
 * anteriores a M-53), que se retira con el conteo de ARCHITECTURE §4.48.7(5).
 *
 * Sigue el patrón standalone de `auth-token-sweep` / `buylist-sweep`: un `run()` invocable, sin
 * estado, que el SchedulerService programa en cron (cada 15 min, env `GUEST_ORDER_SWEEP_CRON` conservada)
 * cuando hay REDIS_URL. La regla de negocio vive en `orders/`; aquí solo está el envoltorio.
 */
@Injectable()
export class OrderReservationSweepJobService {
  private readonly logger = new Logger(OrderReservationSweepJobService.name);

  constructor(
    private readonly orders: OrdersService,
    private readonly guestCheckout: GuestCheckoutService,
  ) {}

  async run(now = new Date()): Promise<{ swept: number; skipped: number; legacySwept: number }> {
    const { swept, skipped } = await this.orders.sweepExpiredReservations(now);
    const { swept: legacySwept } = await this.guestCheckout.sweepStaleGuestOrders(now);
    this.logger.log(
      `order-reservation-sweep: ${swept} reservas vencidas liberadas, ${skipped} pospuestas (PI vivo), ` +
        `${legacySwept} pedidos legados de invitado liberados.`,
    );
    return { swept, skipped, legacySwept };
  }
}
