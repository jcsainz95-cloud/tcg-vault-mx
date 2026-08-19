import { Injectable, Logger } from '@nestjs/common';
import { GuestCheckoutService } from '../modules/orders/guest-checkout.service';

/**
 * GuestOrderSweepJobService — barrido de RESERVAS de pedidos de invitado no pagados
 * (v1.21-guest-checkout, amenaza **T9** de ARCHITECTURE §4.21e).
 *
 * Un pedido de invitado `pending` retiene **piezas únicas** en `reserved`. Sin este barrido, un
 * atacante (o simplemente un carrito abandonado tras el 3DS) deja inventario invendible hasta que
 * Stripe cancele el PaymentIntent. El job libera las piezas de las órdenes `pending` con más de
 * `GUEST_ORDER_RESERVATION_TTL_MIN` (60 min), marca la orden `failed` y cancela el PI.
 *
 * Sigue el patrón standalone de `auth-token-sweep` / `buylist-sweep` / `ine-retention`: un `run()`
 * invocable, sin estado, que el SchedulerService programa en cron cuando hay REDIS_URL. La lógica
 * vive en `GuestCheckoutService` (dueño del ciclo de vida del pedido de invitado); aquí solo está
 * el envoltorio de job, para no duplicar reglas de negocio en `jobs/`.
 */
@Injectable()
export class GuestOrderSweepJobService {
  private readonly logger = new Logger(GuestOrderSweepJobService.name);

  constructor(private readonly guestCheckout: GuestCheckoutService) {}

  async run(now = new Date()): Promise<{ swept: number }> {
    const { swept } = await this.guestCheckout.sweepStaleGuestOrders(now);
    this.logger.log(`guest-order-sweep: ${swept} pedidos de invitado sin pagar liberados.`);
    return { swept };
  }
}
