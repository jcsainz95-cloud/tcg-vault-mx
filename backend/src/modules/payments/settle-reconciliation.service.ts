import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StripeService } from './stripe.service';
import { SettleRecord, anomaliesOf } from './settle-line';

/**
 * §BOVEDA-COBRADA-SIN-PIEZAS — lo que va DESPUÉS del commit de una liquidación con anomalías (o de una reparación):
 *  - cancelar el PaymentIntent de las órdenes que R2 puso en `failed` (best-effort; lo reintenta la reparación diaria);
 *  - el aviso RUIDOSO al operador y al dueño (log de error + las filas `order.settle_item_*` ya escritas en la misma tx).
 * ⛔ Nunca lanza (un 5xx haría que Stripe reintentara un settle ya aplicado) y ⛔ nunca mueve dinero ni piezas.
 */
@Injectable()
export class SettleReconciliationService {
  private readonly logger = new Logger(SettleReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
  ) {}

  async afterSettle(input: {
    orderId: string;
    orderNumber: string | null;
    records: SettleRecord[];
    supersededOrderIds: string[];
  }): Promise<void> {
    try {
      const anomalies = anomaliesOf(input.records);
      const label = input.orderNumber ?? input.orderId;
      if (anomalies.length > 0) {
        const attention = anomalies.filter((a) => a.outcome === 'attention');
        this.logger.error(
          `ANOMALÍA al liquidar el pedido ${label}: ${anomalies.length} pieza(s) no estaban reservadas por el pedido ` +
            `(${anomalies.map((a) => `${a.inventoryItemId}:${a.was}→${a.outcome}`).join(', ')}). ` +
            (attention.length > 0 ? `REQUIERE ATENCIÓN DEL DUEÑO: ${attention.length} línea(s) cobradas sin pieza ni copia equivalente.` : 'Resuelto automáticamente.'),
        );
      }
      for (const id of input.supersededOrderIds) await this.cancelPaymentIntentOf(id);
    } catch (e) {
      this.logger.error(`settle-reconciliation: ${(e as Error).message}`);
    }
  }

  /**
   * Cancela el PI de una orden `failed` y, si Stripe no lo deja en `canceled` (p. ej. ya pagado), deja la huella
   * `order.orphan_pi` (la reparación diaria lo reintenta). `kept` ⇒ no se pudo cerrar. Idempotente.
   */
  async cancelPaymentIntentOf(orderId: string): Promise<'canceled' | 'kept' | 'none'> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, select: { id: true, status: true, stripePaymentIntentId: true } });
    if (!order?.stripePaymentIntentId || order.status !== 'failed') return 'none';
    const pi = order.stripePaymentIntentId;
    let status: string | null = null;
    try {
      status = (await this.stripe.cancelPaymentIntent(pi)).status;
    } catch {
      status = await this.stripe.getPaymentIntentStatus(pi).catch(() => null);
    }
    if (status === 'canceled') return 'canceled';
    // Una huella por PI (la reparación diaria lo reintenta cada día; no se repite el renglón).
    const seen = await this.prisma.auditLog.findFirst({ where: { action: 'order.orphan_pi', entityId: orderId }, select: { id: true } }).catch(() => null);
    if (!seen) {
      await this.prisma.auditLog
        .create({ data: { actorUserId: null, actorRole: null, action: 'order.orphan_pi', entityType: 'Order', entityId: orderId, after: { paymentIntentId: pi, status } } })
        .catch((e: unknown) => this.logger.error(`order.orphan_pi no se pudo auditar: ${(e as Error).message}`));
    }
    return 'kept';
  }
}
