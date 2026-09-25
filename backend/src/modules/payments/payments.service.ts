import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { MovementReason, Order, OrderItem, Prisma } from '@prisma/client';
import Stripe from 'stripe';
import { PrismaService } from '../../prisma/prisma.service';
import { StripeService } from './stripe.service';
import { GuestOrderMailService } from '../orders/guest-order-mail.service';
import { AuditService } from '../audit/audit.service';
import { readFrozenCardFacts } from '../orders/order-item-card';
import { clearReservation, releaseReservationData, reservationGuard } from '../orders/reservation';
import { PRICE_CONVENTION_OF_NEW_ROWS } from '../../common/money';
// v1.74 (§R.3) — `AV-2` (pedido liquidado, al REGISTRADO) y `AV-3` (reembolso total). Plantillas
// LOCALES a `orders` (dueño del hecho); el puerto se inyecta `@Optional()` y el envío es best-effort.
import { MAIL_PORT, MailPort } from '../mail/mail.port';
import {
  orderRefundedTemplate,
  orderSettledTemplate,
} from '../orders/mail/order-notice.templates';

/**
 * PaymentsService — Manejo idempotente de webhooks Stripe. ARCHITECTURE §3.3, §4.3.
 * Transiciones transaccionales de titularidad (pending→settled) y reversión por
 * contracargo, con InventoryMovement. Idempotencia por event.id (ProcessedStripeEvent).
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
    // v1.21-guest-checkout: correo + enlace tokenizado al liquidar un pedido de invitado.
    private readonly guestMail: GuestOrderMailService,
    // B3 (v1.21.2): las anomalías de inventario al liquidar quedan en la bitácora, no solo en logs.
    private readonly audit: AuditService,
    // v1.74 (§R): `@Optional()` — los tests unitarios construyen este servicio a mano, y sobre todo:
    // ⛔ **un fallo de correo NUNCA puede hacer que el webhook de Stripe responda != 2xx** (un 5xx
    // haría que Stripe reintentara un settle ya aplicado). Candado `C-AV-10`.
    @Optional() @Inject(MAIL_PORT) private readonly mail?: MailPort,
  ) {}

  /**
   * ⭐ **§R — el envoltorio best-effort de los dos avisos de pedido.** Post-commit, nunca propaga, y
   * ⛔ **nunca loguea el correo del destinatario**. Mismo régimen que `GuestOrderMailService`, que es
   * el precedente vivo: *«un 5xx haría que Stripe reintentara un settle ya aplicado»*.
   */
  private async safeNotify(
    orderId: string,
    build: () => Promise<{ to: string; subject: string; html: string; text: string } | null>,
  ): Promise<void> {
    try {
      if (!this.mail) {
        this.logger.warn(`order notice mail skipped for ${orderId}: MAIL_PORT unavailable`);
        return;
      }
      // ⚠️⚠️ **LA RESOLUCIÓN DEL DESTINATARIO VA DENTRO DEL `try`, Y NO ES DETALLE.** Resolverla
      // fuera dejaba una consulta a la BD en el camino del webhook **sin red**: un fallo suyo
      // propagaba, el webhook respondía != 2xx y **Stripe reintentaba un settle ya aplicado**. Es
      // exactamente lo que `C-AV-10` mide, y se descubrió porque dos specs con un mock sin
      // `prisma.user` se pusieron rojos — *el mock incompleto era el canario del fallo real*.
      const msg = await build();
      if (!msg) return;
      await this.mail.send(msg);
    } catch (e) {
      this.logger.error(
        `order notice mail failed for ${orderId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /**
   * ⭐⭐ **`AV-2` — LA NEGACIÓN EXACTA DEL `if (!order.guestEmail) return null`** (§R.5, criterio 200).
   *
   * Se manda **si y solo si** `guestEmail == null` **y** `userId != null`. Las dos mitades importan:
   * la primera garantiza que **ningún pedido reciba dos confirmaciones** (criterio **206**, que falla
   * por exceso); la segunda, que no se intente escribir a un pedido sin dueño.
   * ⛔ **Y no se le escribe a una cuenta anonimizada** (§R.5.a).
   * **Una sola vez, sin columna:** el early-return por `status === 'settled'` del settle ⇒ un
   * reintento de Stripe no duplica.
   */
  private async notifyOrderSettled(order: Order & { items: OrderItem[] }): Promise<void> {
    if (order.guestEmail || !order.userId) return;
    await this.safeNotify(order.id, async () => {
      const user = await this.prisma.user.findUnique({
        where: { id: order.userId as string },
        select: { email: true, locale: true, anonymizedAt: true },
      });
      if (!user?.email || user.anonymizedAt) {
        this.logger.warn(`order notice mail skipped for ${order.id}: no recipient email`);
        return null;
      }
      return {
        // ⛔ La plantilla recibe CAMPOS SUELTOS, jamás la fila: `Order.ivaTransferPct` es una
        // columna, y un correo que renderizara «la orden» lo filtraría solo (criterio 209).
        ...orderSettledTemplate(
          {
            orderNumber: order.orderNumber ?? '',
            items: order.items.map((oi) => {
              const snap = readFrozenCardFacts(oi.cardSnapshot);
              return {
                name: snap.name ?? '',
                setName: snap.setName ?? '',
                number: snap.number ?? '',
              };
            }),
            totalCents: order.totalCents,
          },
          order.locale ?? user.locale,
        ),
        to: user.email,
      };
    });
  }

  verifyAndParse(payload: Buffer, signature: string): Stripe.Event {
    return this.stripe.constructEvent(payload, signature);
  }

  /**
   * Punto de entrada del webhook. Idempotente por event.id.
   *
   * Idempotencia ATÓMICA (fix QA #2): se intenta `create` del registro PRIMERO y se
   * usa la violación de unique (P2002) como guardia de "ya procesado". Así, dos
   * entregas concurrentes del mismo event.id no pueden doble-procesar (solo una gana
   * el insert; la otra ve P2002 y hace no-op).
   *
   * "Procesado SOLO tras éxito" (fix QA #1): si el handler lanza, se BORRA el registro
   * de idempotencia y se RE-LANZA la excepción. El controller responde != 2xx y Stripe
   * reintenta; el evento NO queda marcado como procesado. Los eventos ya procesados o
   * no manejados retornan normalmente (el controller responde 200).
   */
  async handleEvent(event: Stripe.Event): Promise<void> {
    // Guardia de idempotencia atómica: intenta reservar el event.id.
    try {
      await this.prisma.processedStripeEvent.create({
        data: { id: event.id, type: event.type },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        this.logger.debug(`Stripe event ${event.id} ya procesado/en curso; ignorado.`);
        return;
      }
      throw e;
    }

    try {
      switch (event.type) {
        case 'payment_intent.succeeded':
          await this.onPaymentSucceeded(event.data.object as Stripe.PaymentIntent);
          break;
        case 'payment_intent.payment_failed':
          await this.onPaymentFailed((event.data.object as Stripe.PaymentIntent).id);
          break;
        // B5: PaymentIntent cancelado → libera la reserva (igual que un fallo de pago).
        case 'payment_intent.canceled':
          await this.onPaymentCanceled((event.data.object as Stripe.PaymentIntent).id);
          break;
        case 'charge.refunded':
          await this.onChargeRefunded(event.data.object as Stripe.Charge);
          break;
        case 'charge.dispute.created':
          await this.onChargeDispute(event.data.object as Stripe.Dispute);
          break;
        // M1/Fix 5: cierre de disputa (ganamos/perdimos) → estado terminal.
        case 'charge.dispute.closed':
          await this.onChargeDisputeClosed(event.data.object as Stripe.Dispute);
          break;
        case 'charge.dispute.funds_reinstated':
          // Fondos reinstalados = ganamos la disputa.
          await this.onChargeDisputeClosed(event.data.object as Stripe.Dispute, 'won');
          break;
        default:
          this.logger.debug(`Evento no manejado: ${event.type}`);
      }
    } catch (e) {
      // El handler falló (p. ej. DB transitoria): revierte la marca de idempotencia
      // para que Stripe pueda reintegrar el evento en un reintento, y propaga el error.
      await this.prisma.processedStripeEvent
        .delete({ where: { id: event.id } })
        .catch(() => undefined);
      throw e;
    }
  }

  /** payment_intent.succeeded → Order settled + items settled; o liquida envío → picking. */
  async onPaymentSucceeded(pi: Stripe.PaymentIntent): Promise<void> {
    const paymentIntentId = pi.id;
    const order = await this.prisma.order.findUnique({
      where: { stripePaymentIntentId: paymentIntentId },
      include: { items: true },
    });
    if (order) {
      if (order.status === 'settled') return;
      // H1 (money-safety) — DEFENSA EN PROFUNDIDAD antes de liquidar: el monto y la moneda del
      // PaymentIntent DEBEN coincidir con lo que la orden cobró (`totalCents`, en MXN). Aunque el
      // PaymentIntent lo crea el servidor (`attachPaymentIntent`, importe derivado del breakdown),
      // liquidar por un evento cuyo monto/`currency` no cuadra abriría un descuadre de dinero.
      // Se valida `amount_received` (lo efectivamente CAPTURADO en un PI `succeeded`) con fallback
      // a `amount` (lo solicitado): con captura parcial, `amount` seguiría cuadrando aunque entrara
      // menos dinero. El fallback es `??` a propósito: un `amount_received` de 0 NO cae a `amount`.
      // Stripe manda `currency` en minúsculas. NO se liquida si discrepa; se AUDITA y se retorna
      // 200 (el marcador de idempotencia queda: un evento que siempre discrepará no debe reintentar).
      const receivedCents = pi.amount_received ?? pi.amount;
      if (receivedCents !== order.totalCents || pi.currency !== 'mxn') {
        this.logger.error(
          `H1: descuadre monto/moneda al liquidar el pedido ${order.orderNumber ?? order.id} ` +
            `(${order.id}): esperado ${order.totalCents} mxn, recibido ${receivedCents} ${pi.currency}. ` +
            'NO se liquida.',
        );
        await this.audit
          .log({
            actorUserId: null,
            actorRole: null,
            action: 'order.settle_amount_mismatch',
            entityType: 'Order',
            entityId: order.id,
            after: {
              expectedCents: order.totalCents,
              receivedCents,
              expectedCurrency: 'mxn',
              receivedCurrency: pi.currency,
            },
          })
          .catch((e: unknown) =>
            this.logger.error(`No se pudo auditar el descuadre de settle: ${(e as Error).message}`),
          );
        return;
      }
      // v1.21-guest-checkout: SEGUNDA RUTA DE FULFILLMENT. Un pedido `direct_ship` NO deposita en
      // bóveda (el invitado no tiene): sus piezas siguen siendo de la plataforma y avanzan por
      // `status` hasta salir por la puerta. ARCHITECTURE §4.21c.
      if (order.fulfillmentMode === 'direct_ship') {
        await this.settleDirectShipOrder(order);
        return;
      }
      // v1.68: piezas que NO estaban reservadas por esta orden al liquidar (se auditan fuera del tx).
      const anomalies: { inventoryItemId: string; was: string }[] = [];
      // v1.79 (M-59, §M4-VAULT.2-bis): UN instante para UN hecho — `Order.settledAt` y
      // `VaultPlacement.createdAt` son el mismo valor, escrito explícitamente en las dos filas.
      const now = new Date();
      await this.prisma.$transaction(async (tx) => {
        await tx.order.update({
          where: { id: order.id },
          data: { status: 'settled', settledAt: now },
        });
        for (const oi of order.items) {
          const item = await tx.inventoryItem.findUnique({ where: { id: oi.inventoryItemId } });
          if (!item) continue;
          // Transición de reserva a custodia liquidada: reserved → in_custody, settled.
          // v1.68 (§4-R.2 regla 2): SOLO si la pieza sigue `reserved` por ESTA orden (o legada). Un
          // settle de una orden que ya no es dueña NO mueve la pieza (defensa en profundidad: su PI
          // se canceló antes de la sustitución, no debería ocurrir). Se limpia dueño/vencimiento.
          const moved = await tx.inventoryItem.updateMany({
            where: { id: oi.inventoryItemId, ...reservationGuard(order.id) },
            data: { status: 'in_custody', ownershipStatus: 'settled', ...clearReservation },
          });
          if (moved.count !== 1) {
            // Reintento del webhook con la pieza ya en custodia de este comprador: idempotencia
            // legítima. Cualquier otro estado es una ANOMALÍA: se registra, no se toca (no se le
            // quita la pieza a nadie automáticamente).
            if (item.status === 'in_custody' && item.ownerUserId === order.userId) continue;
            this.logger.error(
              `settle: pieza ${oi.inventoryItemId} NO reservada por el pedido ${order.orderNumber ?? order.id} ` +
                `al liquidar (estaba ${item.status}, dueño ${item.reservedByOrderId ?? 'ninguno'}); no se mueve.`,
            );
            anomalies.push({ inventoryItemId: oi.inventoryItemId, was: item.status });
            continue;
          }
          await tx.inventoryMovement.create({
            data: {
              itemId: oi.inventoryItemId,
              fromStatus: item.status,
              toStatus: 'in_custody',
              reason: MovementReason.settle,
              note: `order ${order.id} settled`,
            },
          });
        }
        // v1.79 (M-59) — nace la colocación, en ESTA transacción y DESPUÉS del bucle de piezas.
        await this.createVaultPlacement(tx, order, now);
      });
      if (anomalies.length > 0) {
        await this.audit
          .log({
            actorUserId: null,
            actorRole: null,
            action: 'order.settle_item_not_reserved',
            entityType: 'Order',
            entityId: order.id,
            after: { anomalies },
          })
          .catch((e: unknown) =>
            this.logger.error(`No se pudo auditar la anomalía de settle: ${(e as Error).message}`),
          );
      }
      // v1.74 (§R) — `AV-2`, POST-COMMIT y best-effort. Las DOS ramas del settle lo mandan (bóveda
      // aquí, `direct_ship` en `settleDirectShipOrder`): el criterio 200 no distingue por ruta de
      // fulfillment, distingue por **quién recibe**.
      await this.notifyOrderSettled(order);
      return;
    }
    // ¿Es el pago de un envío? Avanza a picking.
    const shipment = await this.prisma.shipmentRequest.findUnique({
      where: { stripePaymentIntentId: paymentIntentId },
    });
    if (shipment && shipment.status === 'solicitado') {
      // ⭐⭐ `REL-B/REL-C` — precondición EN EL `WHERE`, no en el `if` de arriba. Éste era el ÚNICO
      // escritor del sistema capaz de **retroceder** el estado de un envío: el `if` decide sobre una
      // lectura sin candado, así que un operador que avanzara `solicitado → picking → guia →
      // enviado` mientras el webhook viajaba dejaba que esta escritura devolviera la fila a
      // `picking` — reabriendo el camino a `enviado` y con él **un segundo `AV-5`**. La monotonía
      // del grafo es la premisa de que `AV-5`/`AV-6` no necesiten columna de sello
      // (`shipments.service.ts#claimAndNotify`), así que este `WHERE` es parte de ese candado.
      await this.prisma.shipmentRequest.updateMany({
        where: { id: shipment.id, status: 'solicitado' },
        data: { status: 'picking', pickingAt: new Date() },
      });
    }
  }

  /**
   * v1.79 / v1.79.1 (M-59, API_CONTRACT §M4-VAULT.2-bis, ARCHITECTURE §4.21q) — nace la COLOCACIÓN
   * de una orden `vault` recién liquidada y sus filas por carta. ÚNICO creador de `VaultPlacement`.
   *
   * Se llama SOLO desde la rama `vault` de `onPaymentSucceeded`, dentro de su `$transaction` ⇒ una
   * orden `vault` liquidada sin colocación, o una colocación sin liquidación, o sin sus filas por
   * carta, son imposibles (`INV-VP-1`, `INV-VP-5`).
   *
   * ⭐⭐ Idempotente y a prueba de carrera por CONSTRUCCIÓN, no por lectura previa:
   *  - `createMany … skipDuplicates` ⇒ `INSERT … ON CONFLICT DO NOTHING` sobre `orderId @unique`.
   *    ⛔ No `create` a secas: dos entregas concurrentes pasan las dos el `status === 'settled'`
   *    (leído FUERA de la tx) y la segunda reventaría con `P2002` ⇒ 500 y reintento de Stripe.
   *    ⛔ No `findFirst` + `create`: es la lectura sin candado que `REL-B` enseñó a no escribir.
   *  - El id sale de `findUniqueOrThrow` por `orderId` (sentencia nueva ⇒ bajo READ COMMITTED ve la
   *    fila de quien ganó). ⛔ No del retorno de `createMany`: con `skipDuplicates` no dice cuál.
   *  - Filas por carta: TODAS las `OrderItem` de la orden (⛔ sin filtrar por el estado de la pieza:
   *    una carta que ya no se puede colocar se muestra `blocked` en la cola), `ON CONFLICT DO
   *    NOTHING` sobre `orderItemId @unique`.
   *
   * ⛔ CERO DINERO: no lee ni escribe importes. ⛔ No toca la pieza (`InventoryStatus` no cambia).
   */
  private async createVaultPlacement(
    tx: Prisma.TransactionClient,
    order: Order & { items: OrderItem[] },
    now: Date,
  ): Promise<void> {
    await tx.vaultPlacement.createMany({
      data: [{ orderId: order.id, createdAt: now }],
      skipDuplicates: true,
    });
    const { id: placementId } = await tx.vaultPlacement.findUniqueOrThrow({
      where: { orderId: order.id },
      select: { id: true },
    });
    if (order.items.length === 0) return;
    await tx.vaultPlacementItem.createMany({
      data: order.items.map((oi) => ({
        placementId,
        orderItemId: oi.id,
        inventoryItemId: oi.inventoryItemId,
      })),
      skipDuplicates: true,
    });
  }

  /**
   * v1.21-guest-checkout — liquidación de un pedido con ENVÍO DIRECTO (§4-G.6, ARCHITECTURE §4.21c).
   *
   * Diferencias con la ruta de bóveda, todas deliberadas:
   *  - Los items NO cambian de dueño: siguen `ownerType='platform'`, `ownerUserId=null`,
   *    `ownershipStatus=null`. Solo avanza `status`: `reserved → picking` (vendida y en
   *    preparación, aún físicamente en el almacén).
   *  - Se CREA el `ShipmentRequest` de fulfillment (`userId=null`, `orderId`, `status='picking'`)
   *    ya pagado: nace en `picking` y NUNCA pasa por `solicitado`.
   *  - Sus montos van en CERO a propósito: el ingreso del envío vive en `Order.shippingFeeCents`
   *    (mismo PaymentIntent). Repetirlo aquí lo contaría DOS VECES en el P&L de M7 (§4.21b).
   *  - Se capturan marca + últimos 4 de la tarjeta (único dato de pago que se persiste).
   *
   * Idempotente: el early-return por `status==='settled'`, la guardia `status:'reserved'` de cada
   * pieza y la búsqueda del envío activo hacen que un reintento de Stripe no duplique nada.
   * El correo es POST-COMMIT y BEST-EFFORT: su fallo NO revierte el pago ni falla el webhook.
   */
  private async settleDirectShipOrder(order: Order & { items: OrderItem[] }): Promise<void> {
    const card = order.stripePaymentIntentId
      ? await this.stripe.getCardDetails(order.stripePaymentIntentId).catch(() => null)
      : null;
    const now = new Date();
    // B3: anomalías de inventario detectadas al liquidar (ver dentro del bucle). Se reportan FUERA
    // de la transacción para que el log y la auditoría no dependan de su commit.
    const anomalies: { inventoryItemId: string; was: string; recovered: boolean }[] = [];

    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: order.id },
        data: {
          status: 'settled',
          settledAt: now,
          ...(card ? { paymentMethodBrand: card.brand, paymentMethodLast4: card.last4 } : {}),
        },
      });
      for (const oi of order.items) {
        const item = await tx.inventoryItem.findUnique({ where: { id: oi.inventoryItemId } });
        if (!item) continue;
        // Guardia positiva: solo una pieza aún `reserved` avanza (idempotencia ante reintentos).
        // v1.68 (§4-R.2 regla 2): … y reservada por ESTA orden (o legada); se limpia dueño/vencimiento.
        const moved = await tx.inventoryItem.updateMany({
          where: { id: oi.inventoryItemId, ...reservationGuard(order.id) },
          data: { status: 'picking', ...clearReservation },
        });
        if (moved.count === 1) {
          await tx.inventoryMovement.create({
            data: {
              itemId: oi.inventoryItemId,
              fromStatus: item.status,
              toStatus: 'picking',
              reason: MovementReason.settle,
              note: `guest order ${order.orderNumber ?? order.id} settled (direct_ship)`,
            },
          });
          continue;
        }

        // B3 (v1.21.2) — la pieza NO estaba `reserved` al liquidar. Esto NO es un no-op: es una
        // ANOMALÍA. Así sobrevivió el bug del barrido: un `continue` mudo en el camino del dinero.
        // Un reintento del webhook la deja ya en `picking` (idempotencia legítima); cualquier otro
        // estado significa que la reserva se soltó por debajo (p. ej. el barrido liberó la pieza y
        // el pago se confirmó después).
        if (item.status === 'picking') continue;

        // Recuperación: si la pieza volvió al pool y NADIE la tomó, el pedido PAGADO manda — se
        // re-congela en `picking`, que es donde debía estar. Restaura el invariante «ShipmentItem
        // en envío no terminal ⇒ item fuera de {listed, in_stock}» y corta el double-sell ANTES de
        // que ocurra.
        const recovered = await tx.inventoryItem.updateMany({
          where: { id: oi.inventoryItemId, status: { in: ['listed', 'in_stock'] } },
          data: { status: 'picking', ...clearReservation },
        });
        if (recovered.count === 1) {
          await tx.inventoryMovement.create({
            data: {
              itemId: oi.inventoryItemId,
              fromStatus: item.status,
              toStatus: 'picking',
              reason: MovementReason.settle,
              note:
                `ANOMALÍA: pieza no reservada al liquidar el pedido ` +
                `${order.orderNumber ?? order.id} (estaba ${item.status}); re-congelada por pago confirmado`,
            },
          });
          anomalies.push({ inventoryItemId: oi.inventoryItemId, was: item.status, recovered: true });
          continue;
        }

        // La pieza ya está en manos de otro flujo (reservada por otro checkout, enviada, perdida…):
        // NO se le quita a nadie automáticamente. Queda registrada para intervención humana.
        anomalies.push({ inventoryItemId: oi.inventoryItemId, was: item.status, recovered: false });
      }
      // A lo más UN envío activo por orden (invariante de aplicación, §4-G.10).
      const existing = await tx.shipmentRequest.findFirst({
        where: { orderId: order.id, status: { not: 'cancelado' } },
      });
      if (!existing) {
        await tx.shipmentRequest.create({
          data: {
            userId: null,
            orderId: order.id,
            addressSnapshot: (order.shippingAddressSnapshot ?? {}) as Prisma.InputJsonValue,
            status: 'picking',
            pickingAt: now,
            // CERO a propósito (ver arriba): el ingreso del envío ya está en Order.shippingFeeCents.
            shippingFeeCents: 0,
            ivaCents: 0,
            processingFeeCents: 0,
            totalCents: 0,
            // ⭐⭐ D56 / criterio **214**, `IVA-12(a)`: la convención se escribe SIEMPRE, también en
            // el envío de fulfillment con **montos en cero** (el ingreso vive en
            // `Order.shippingFeeCents`). *La convención es ABSOLUTA: no depende de que los importes
            // sean 0.* Una fila sin convención no se puede leer, valga lo que valga.
            priceConvention: PRICE_CONVENTION_OF_NEW_ROWS,
            items: { create: order.items.map((oi) => ({ inventoryItemId: oi.inventoryItemId })) },
          },
        });
      }
    });

    // B3 — las anomalías son RUIDOSAS: log de error + AuditLog consultable (M10). Nunca se
    // liquidan en silencio: cada una significa que una pieza única no estaba donde el pedido
    // pagado suponía, y las no recuperadas exigen intervención humana.
    if (anomalies.length > 0) {
      const unrecovered = anomalies.filter((a) => !a.recovered);
      const detail = anomalies
        .map((a) => `${a.inventoryItemId}:${a.was}${a.recovered ? '→picking' : ':SIN RECUPERAR'}`)
        .join(', ');
      this.logger.error(
        `ANOMALÍA al liquidar el pedido ${order.orderNumber ?? order.id}: ${anomalies.length} ` +
          `pieza(s) no estaban 'reserved' (${detail}). ` +
          (unrecovered.length > 0
            ? 'Requiere INTERVENCIÓN HUMANA: la pieza está comprometida con otro flujo.'
            : 'Recuperadas: el pago confirmado manda sobre una reserva liberada.'),
      );
      await this.audit
        .log({
          actorUserId: null,
          actorRole: null,
          action: 'order.settle_inventory_anomaly',
          entityType: 'Order',
          entityId: order.id,
          after: { anomalies, needsHumanReview: unrecovered.length > 0 },
        })
        .catch((e: unknown) =>
          this.logger.error(`No se pudo auditar la anomalía de settle: ${(e as Error).message}`),
        );
    }

    // POST-COMMIT, BEST-EFFORT (§4.21g): un fallo del correo se loguea; la red de seguridad es el
    // `checkoutToken` ya devuelto por el checkout + el reenvío self-service + el de soporte.
    await this.guestMail
      .sendConfirmation({
        id: order.id,
        orderNumber: order.orderNumber,
        guestEmail: order.guestEmail,
        locale: order.locale,
        totalCents: order.totalCents,
        // v1.51-b (§5.2): se lee la clase (F) por el ÚNICO lector declarado del blob
        // (`readFrozenCardFacts`) en vez de un cast ad-hoc con una forma paralela. Mismo
        // comportamiento (los `?? ''` se conservan); lo que cambia es que ya no hay una segunda
        // definición de «qué trae el snapshot» que pueda divergir de la del contrato.
        // El correo NO lleva imagen: la clase (P) no entra aquí.
        items: order.items.map((oi) => {
          const snap = readFrozenCardFacts(oi.cardSnapshot);
          return { name: snap.name ?? '', setName: snap.setName ?? '', number: snap.number ?? '' };
        }),
      })
      .catch((e: unknown) =>
        this.logger.error(`guest confirmation mail failed for ${order.id}: ${(e as Error).message}`),
      );
    // v1.74 (§R) — `AV-2` para el pedido de envío directo **de un cliente REGISTRADO**. Los dos
    // envíos son mutuamente excluyentes por construcción (`guestEmail` poblado ⇔ el de arriba;
    // `guestEmail` nulo ⇔ éste), así que ⛔ nadie recibe dos confirmaciones.
    await this.notifyOrderSettled(order);
  }

  /** payment_intent.payment_failed → Order failed + libera reserva (reserved→listed). */
  async onPaymentFailed(paymentIntentId: string): Promise<void> {
    await this.failAndRelease(paymentIntentId, 'payment_failed');
  }

  /** B5: payment_intent.canceled → misma compensación que un fallo (libera la reserva). */
  async onPaymentCanceled(paymentIntentId: string): Promise<void> {
    await this.failAndRelease(paymentIntentId, 'canceled');
  }

  /**
   * Compensación común para pago fallido/cancelado: libera la reserva de una orden
   * (reserved→listed, item vuelve a plataforma) o cancela un envío `solicitado` (para
   * que sus items dejen de estar bloqueados por ITEM_IN_ANOTHER_SHIPMENT).
   */
  private async failAndRelease(paymentIntentId: string, cause: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { stripePaymentIntentId: paymentIntentId },
      include: { items: true },
    });
    if (order) {
      if (order.status !== 'pending') return;
      await this.prisma.$transaction(async (tx) => {
        await tx.order.update({ where: { id: order.id }, data: { status: 'failed' } });
        for (const oi of order.items) {
          // v1.68 (§4-R.2 regla 2, candado R-2): SOLO libera lo PROPIO. Tras una sustitución O1→O2, el
          // `payment_intent.canceled` del PI de O1 llega después y NO debe soltar la pieza que O2
          // acaba de reservar: `reservedByOrderId = O1` no matchea. La exclusión la da el motor.
          await tx.inventoryItem.updateMany({
            where: { id: oi.inventoryItemId, ...reservationGuard(order.id) },
            data: releaseReservationData,
          });
        }
      });
      return;
    }
    // ¿Es el pago de un envío aún no liquidado? Cancélalo para liberar los items.
    const shipment = await this.prisma.shipmentRequest.findUnique({
      where: { stripePaymentIntentId: paymentIntentId },
    });
    if (shipment && shipment.status === 'solicitado') {
      // `REL-B/REL-C`: la precondición baja al motor. `cancelado` es terminal, así que esto no puede
      // retroceder nada — pero sí puede cancelar un envío que otro acababa de mover a `picking`, y
      // un envío que ya está en la cola de picking no se cancela por un webhook rezagado.
      await this.prisma.shipmentRequest.updateMany({
        where: { id: shipment.id, status: 'solicitado' },
        data: { status: 'cancelado' },
      });
      this.logger.debug(`Shipment ${shipment.id} cancelado por ${cause}.`);
    }
  }

  /**
   * charge.refunded → Order `refunded`. A1 (VENTAS FINALES): el reembolso NO re-agrega el
   * item al inventario (no auto-revert); es un remedio excepcional del super_admin ya
   * autorizado (money-out).
   * M2: distingue reembolso PARCIAL vs TOTAL (`amount_refunded` vs `amount`); solo el
   * reembolso total transiciona la orden a `refunded`.
   */
  async onChargeRefunded(charge: Stripe.Charge): Promise<void> {
    const pi = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
    if (!pi) return;
    const order = await this.prisma.order.findUnique({ where: { stripePaymentIntentId: pi } });
    if (!order) return;

    const amount = charge.amount ?? 0;
    const amountRefunded = charge.amount_refunded ?? 0;
    const fullyRefunded = amount > 0 && amountRefunded >= amount;
    if (!fullyRefunded) {
      // M2: reembolso parcial → no cambia el estado terminal de la orden (queda registrado
      // en Stripe; la conciliación fina de importes parciales es de M7/Finanzas).
      this.logger.log(
        `Order ${order.id}: reembolso PARCIAL (${amountRefunded}/${amount}); sin cambio de estado.`,
      );
      return;
    }
    if (order.status === 'refunded') return;
    await this.prisma.order.update({
      where: { id: order.id },
      data: { status: 'refunded', refundedAt: new Date() },
    });
    // ⭐ `AV-3` (§R.3) — POST-COMMIT y best-effort. Destinatario: `guestEmail ?? user.email` (§R.5:
    // *el reembolso le toca a los dos*). ⛔ Nunca a una cuenta anonimizada (§R.5.a).
    await this.safeNotify(order.id, async () => {
      const recipient = order.guestEmail
        ? { email: order.guestEmail, locale: order.locale }
        : await this.prisma.user
            .findUnique({
              where: { id: order.userId ?? '' },
              select: { email: true, locale: true, anonymizedAt: true },
            })
            .then((u) =>
              u && !u.anonymizedAt ? { email: u.email, locale: order.locale ?? u.locale } : null,
            );
      if (!recipient) {
        this.logger.warn(`order notice mail skipped for ${order.id}: no recipient email`);
        return null;
      }
      return {
        ...orderRefundedTemplate(
          { orderNumber: order.orderNumber ?? '', totalCents: order.totalCents },
          recipient.locale,
        ),
        to: recipient.email,
      };
    });
  }

  /**
   * charge.dispute.created (contracargo) → Order `chargeback`.
   *
   * v1.21.2 (T1) — **ramifica por `Order.fulfillmentMode`**, el único discriminador canónico de
   * ruta de fulfillment (D4, ARCHITECTURE §4.21d). El `switch` es EXHAUSTIVO y RUIDOSO: un modo
   * nuevo **lanza** en vez de comportarse como otro en silencio.
   *  - `vault`: comportamiento v1.21 sin cambio (abajo).
   *  - `direct_ship`: tabla normativa de §4-G.6 — **el envío manda** (§4.21c-bis).
   */
  async onChargeDispute(dispute: Stripe.Dispute): Promise<void> {
    const pi = typeof dispute.payment_intent === 'string' ? dispute.payment_intent : dispute.payment_intent?.id;
    if (!pi) return;
    const order = await this.prisma.order.findUnique({
      where: { stripePaymentIntentId: pi },
      include: { items: true },
    });
    if (!order) return;
    switch (order.fulfillmentMode) {
      case 'direct_ship':
        return this.onChargeDisputeDirectShip(order);
      case 'vault':
        return this.onChargeDisputeVault(order);
      default: {
        const mode: string = order.fulfillmentMode;
        this.logger.error(
          `Contracargo sobre un fulfillmentMode no soportado (${mode}) en la orden ${order.id}: ` +
            'no se aplica ningún reverso automático. Requiere decidir su regla de inventario.',
        );
        throw new Error(`Unsupported fulfillmentMode in chargeback: ${mode}`);
      }
    }
  }

  /**
   * v1.21.2 (T1, §4-G.6 / ARCHITECTURE §4.21c-bis) — contracargo de un pedido con **ENVÍO
   * DIRECTO**. La decisión la toma el **estado del envío**, no el del item:
   *
   * Tabla normativa (§4-G.6, copiada LITERAL — este docblock no la reinterpreta):
   *
   * | Envío | ShipmentRequest | InventoryItem | needsManual |
   * |---|---|---|---|
   * | no existe / `cancelado` | — | **`reserved → listed`** + `chargeback_return` | `false` |
   * | `solicitado\|picking\|guia` | **→ `cancelado`** (misma tx) | **CONGELADO** en `picking` | `true` |
   * | `enviado\|entregado` | sin cambio | sin cambio | `true` |
   *
   * **Por qué NO se re-lista con envío vivo:** re-listar es una acción automática que vuelve a
   * VENDER, y el envío seguía en `pickingList()` ⇒ la misma pieza única podía venderse a un
   * segundo comprador mientras el operador la metía en la caja del contracargo (double-sell
   * físico). Además un contracargo no prueba nada todavía: podemos ganar la disputa. Por eso la
   * pieza se **congela** (doblemente fuera de venta: `picking ∉ {listed,in_stock}` y su envío sale
   * de la cola) y el desenlace lo confirma un humano con
   * `POST /admin/orders/:id/chargeback-inventory` (§M3).
   *
   * **T1-b (techlead) — la fila 1 autoriza SOLO `reserved → listed`, y solo eso hace el código.**
   * Una pieza en `reserved` nunca se pagó ni se movió del estante: re-listarla es trivialmente
   * correcto. Una en **`picking`** pertenece a un pedido LIQUIDADO que el operador ya sacó del
   * estante; que su envío esté `cancelado` **no** significa que la carta volviera sola a su slot.
   * Ampliarlo a `picking` reabría el double-sell por un camino 100% automático: una **segunda**
   * `charge.dispute.created` (otro `event.id`, así que no la deduplica el guard de idempotencia)
   * encuentra el envío ya `cancelado`, cae en esta rama y re-listaría la pieza congelada.
   * Una pieza en `picking` con envío cancelado **se queda congelada** y va al desenlace humano.
   *
   * **`chargebackNeedsManual` es MONÓTONO aquí: solo sube a `true`, nunca baja.** Bajarlo es
   * competencia EXCLUSIVA de `resolveChargebackInventory` (la confirmación humana). Si un segundo
   * evento de disputa lo bajara, el caso desaparecería de la cola de M3 sin que nadie hubiera
   * confirmado dónde está la carta — se perdería la única señal de que faltaba una decisión.
   */
  private async onChargeDisputeDirectShip(order: Order & { items: OrderItem[] }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Envío de FULFILLMENT de esta orden (el más reciente). Un retiro de bóveda no lleva
      // `orderId`, así que esta consulta nunca lo confunde con el envío de la orden.
      const shipment = await tx.shipmentRequest.findFirst({
        where: { orderId: order.id },
        orderBy: { requestedAt: 'desc' },
      });
      const status = shipment?.status;
      const isLive = status === 'solicitado' || status === 'picking' || status === 'guia';
      const isShippedOut = status === 'enviado' || status === 'entregado';
      let needsManual = false;

      if (isLive) {
        // Sale de la cola de picking en la MISMA transacción (pickingList() filtra status:'picking').
        // `REL-B/REL-C`: la precondición (`isLive`, leído sin candado) baja al `WHERE`. Una `$tx` no
        // basta —`READ COMMITTED` no bloquea el `findFirst` de arriba— y `needsManual` ya es
        // monótono, así que el peor caso de `count === 0` es «otro lo cerró primero», no una
        // regresión de estado.
        await tx.shipmentRequest.updateMany({
          where: { id: shipment!.id, status: { in: ['solicitado', 'picking', 'guia'] } },
          data: { status: 'cancelado' },
        });
        // La pieza NO se toca: queda CONGELADA en `picking` (fuera de venta) hasta que un humano
        // confirme dónde está físicamente.
        needsManual = true;
      } else if (isShippedOut) {
        // Ya salió: no la tenemos, no se re-agrega. Gestión manual (pelear la disputa con la guía).
        needsManual = true;
      } else {
        // Sin envío (orden `pending`) o envío ya `cancelado`.
        // T1-b: la guardia es `status: 'reserved'` EXACTO — la letra de la fila 1 de la tabla.
        // Una pieza en `picking` NO se re-lista aquí: se queda congelada para el desenlace humano
        // (su envío cancelado no prueba que la carta haya vuelto al estante).
        for (const oi of order.items) {
          const item = await tx.inventoryItem.findUnique({ where: { id: oi.inventoryItemId } });
          if (!item) continue;
          // v1.68 (§4-R.2 regla 2): reservada por ESTA orden (o legada); limpia dueño/vencimiento.
          const reverted = await tx.inventoryItem.updateMany({
            where: { id: oi.inventoryItemId, ...reservationGuard(order.id) },
            data: releaseReservationData,
          });
          if (reverted.count !== 1) {
            // Pieza fuera de `reserved` (típicamente `picking` congelada por una disputa previa):
            // no se toca y el caso sigue necesitando confirmación humana.
            if (item.status === 'picking' || item.status === 'shipped') needsManual = true;
            continue;
          }
          await tx.inventoryMovement.create({
            data: {
              itemId: oi.inventoryItemId,
              fromStatus: item.status,
              toStatus: 'listed',
              reason: MovementReason.chargeback_return,
              note: `chargeback order ${order.orderNumber ?? order.id}`,
            },
          });
        }
      }

      await tx.order.update({
        where: { id: order.id },
        data: {
          status: 'chargeback',
          // MONÓTONO (T1-b): `undefined` = no se toca. El webhook solo puede SUBIR el flag; bajarlo
          // es competencia exclusiva del desenlace humano (`resolveChargebackInventory`).
          chargebackNeedsManual: needsManual ? true : undefined,
        },
      });
    });
  }

  /**
   * Contracargo de un pedido a BÓVEDA (comportamiento v1.21, sin cambio). Consciente del estado
   * FÍSICO de la carta:
   *  - Sigue en bóveda (no enviada/entregada) → revierte a plataforma (`listed`) +
   *    InventoryMovement `chargeback_return` (la tenemos, la recuperamos).
   *  - Ya enviada/entregada (retiro del cliente) → NO se re-agrega: gestión manual.
   *
   * Aquí SÍ es correcto preguntar por `ShipmentItem` en `enviado|entregado`: el retiro de bóveda
   * nace del cliente y **no** lleva `orderId`, así que no hay "envío de la orden" que consultar.
   * (En `direct_ship` ese criterio era el bug: un envío en `picking`/`guia` no coincidía.)
   */
  private async onChargeDisputeVault(order: Order & { items: OrderItem[] }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      let needsManual = false;
      for (const oi of order.items) {
        const item = await tx.inventoryItem.findUnique({ where: { id: oi.inventoryItemId } });
        if (!item) continue;
        // ¿La carta ya salió físicamente (enviada/entregada)? En el RETIRO DE BÓVEDA el estado
        // del InventoryItem no se mueve hasta la entrega, así que la señal canónica es un
        // ShipmentItem cuyo ShipmentRequest esté en `enviado`/`entregado`.
        // (v1.21.2: esto vale SOLO aquí. En `direct_ship` el item sí avanza con el envío
        // —picking/shipped/delivered— y la decisión la toma el estado del envío, ver arriba.)
        const shippedOut = await tx.shipmentItem.findFirst({
          where: {
            inventoryItemId: oi.inventoryItemId,
            shipmentRequest: { status: { in: ['enviado', 'entregado'] } },
          },
        });
        if (shippedOut) {
          // Ya no la tenemos: no se re-agrega al inventario; gestión manual.
          needsManual = true;
          continue;
        }
        // Sigue en bóveda: revertir a inventario de plataforma.
        // v1.68 (§4-R.2 regla 2): si la pieza está `reserved`, solo si es de ESTA orden (o legada); una
        // pieza reservada por OTRA orden no se toca (queda para gestión manual). Fuera de `reserved`
        // (lo normal: `in_custody` tras el settle) se revierte como hoy y se limpia dueño/vencimiento.
        const reverted = await tx.inventoryItem.updateMany({
          where: {
            id: oi.inventoryItemId,
            OR: [
              { status: { not: 'reserved' } },
              { reservedByOrderId: order.id },
              { reservedByOrderId: null },
            ],
          },
          data: {
            ownerType: 'platform',
            ownerUserId: null,
            ownershipStatus: null,
            status: 'listed',
            ...clearReservation,
          },
        });
        if (reverted.count !== 1) {
          needsManual = true;
          continue;
        }
        await tx.inventoryMovement.create({
          data: {
            itemId: oi.inventoryItemId,
            fromStatus: item.status,
            toStatus: 'listed',
            reason: MovementReason.chargeback_return,
            note: `chargeback order ${order.id}`,
          },
        });
      }
      await tx.order.update({
        where: { id: order.id },
        data: { status: 'chargeback', chargebackNeedsManual: needsManual },
      });
      // v1.79 (M-59, §M4-VAULT.6) — tras un contracargo ninguna pieza de esta orden sigue siendo
      // «del cliente en custodia» ⇒ no hay nada que colocar. Misma tx, al final, sin actor (lo
      // canceló el sistema). El estado va en el `WHERE`: una colocación ya `placed`/`cancelled` no se
      // toca, y `count === 0` NO es error.
      await tx.vaultPlacement.updateMany({
        where: { orderId: order.id, status: 'pending' },
        data: {
          status: 'cancelled',
          cancelledAt: new Date(),
          cancelledByUserId: null,
          cancelReason: 'chargeback',
        },
      });
    });
  }

  /**
   * Fix 5 (M1): cierre de disputa. `charge.dispute.closed` trae `dispute.status`
   * (`won`/`lost`); `charge.dispute.funds_reinstated` fuerza `won`.
   *  - Ganamos → estado terminal correcto: los fondos vuelven (Order `settled`). Si el item
   *    se revirtió y seguía en bóveda, se QUEDA en inventario (no se toca aquí).
   *  - Perdimos → `chargeback` terminal.
   *
   * **v1.21.2 (T1) — `direct_ship`: el flag `chargebackNeedsManual` NO se limpia aquí.** Ganar la
   * disputa **NO re-expide automáticamente**: el envío original ya fue `cancelado` y la pieza sigue
   * CONGELADA, así que el caso debe seguir visible en la cola de M3 hasta que un humano confirme
   * dónde está la carta y ejecute `POST /admin/orders/:id/chargeback-inventory` (`reexpedir` si
   * ganamos, `recuperada`/`no_recuperada` si no). Automatizarlo presupondría una realidad física
   * que nadie comprobó. **Lo mismo aplica al desenlace `lost`** por la misma razón: limpiar el flag
   * dejaría la pieza congelada para siempre y fuera de toda cola. En la ruta de **bóveda** no hay
   * pieza congelada, así que se conserva el comportamiento v1.21 (el flag se limpia).
   */
  async onChargeDisputeClosed(dispute: Stripe.Dispute, forced?: 'won' | 'lost'): Promise<void> {
    const pi = typeof dispute.payment_intent === 'string' ? dispute.payment_intent : dispute.payment_intent?.id;
    if (!pi) return;
    const order = await this.prisma.order.findUnique({ where: { stripePaymentIntentId: pi } });
    if (!order) return;

    // `undefined` = no se toca el flag (lo resolverá el humano en `chargeback-inventory`).
    const clearManualFlag = order.fulfillmentMode === 'direct_ship' ? undefined : false;

    const outcome = forced ?? (dispute.status === 'won' ? 'won' : dispute.status === 'lost' ? 'lost' : null);
    if (outcome === 'won') {
      await this.prisma.order.update({
        where: { id: order.id },
        data: {
          status: 'settled',
          settledAt: order.settledAt ?? new Date(),
          disputeOutcome: 'won',
          chargebackNeedsManual: clearManualFlag,
        },
      });
    } else if (outcome === 'lost') {
      await this.prisma.order.update({
        where: { id: order.id },
        data: {
          status: 'chargeback',
          disputeOutcome: 'lost',
          chargebackNeedsManual: clearManualFlag,
        },
      });
    } else {
      this.logger.debug(`dispute.closed status=${dispute.status}: sin cambio terminal.`);
    }
  }
}
