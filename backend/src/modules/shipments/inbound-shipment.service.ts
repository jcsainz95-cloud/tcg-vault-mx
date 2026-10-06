/**
 * inbound-shipment.service.ts — 💰 rev BSD-1, paso B-2 (API_CONTRACT §BSD.4.1, §BSD.4.4; ARCHITECTURE §4.BSD (a)(i)):
 *
 *  - `POST /api/v1/admin/buylist/:id/inbound-shipment` — abrir (o recuperar) la **fila de entrada** de una solicitud
 *    `aceptada`: una `ShipmentRequest` con `kind='buylist_inbound'`, sobre la que trabaja el MISMO motor de compra de guías
 *    (⛔ ningún sitio nuevo de compra, §BSD.3). Idempotente; ⛔ no gasta (sin `@MoneyOut`).
 *  - `GET /api/v1/buylist/requests/:id/label.pdf` — la etiqueta para el VENDEDOR, por proxy (⛔ nunca `labelUrl`), con la
 *    MISMA descarga que la ruta admin y el adjunto de AV-7 (`downloadLabelPdfVia`).
 *
 * Fila de entrada (CHECK `shipment_kind_link`): `userId`, `orderId` y PaymentIntent NULOS y montos en 0 ⇒ ninguna lista de
 * cliente ni ningún sumador de ingresos la puede ver aunque se equivoque. El domicilio es la COPIA de
 * `pickupAddressSnapshot` con las claves exactas de §BSD.4.1 (⛔ sin `addressId`).
 */
import { Inject, Injectable } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { PRICE_CONVENTION_OF_NEW_ROWS } from '../../common/money';
import { SHIPPING_PROVIDER_SELECTION } from '../shipping-provider/shipping-provider.module';
import { ShippingProviderSelection } from '../shipping-provider/shipping-provider.factory';
import { ShipmentQuoteService } from './label-quote.service';
import { ShipmentLabelService } from './label-purchase.service';
import { ShipmentsService } from './shipments.service';
import { BUYLIST_INBOUND_KIND } from './label-subject';
import { guideNotAllowed, inboundAddressSnapshotOf, labelPdfAvailableOf, manualGuideTaken, sellerLabelFilenameOf } from './label-inbound';
import { downloadLabelPdfVia } from './label-pdf-download';
import { LabelPdf } from './label-pdf.service';

export interface InboundActor {
  id: string;
  role: Role;
}

/** §BSD.4.1: sin cuerpo (`{}`); cualquier clave ⇒ `400 VALIDATION_ERROR {field}`. */
export function parseInboundShipmentBody(raw: unknown): void {
  if (raw === undefined || raw === null) return;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw BusinessException.badRequest('VALIDATION_ERROR', 'The body must be an empty object', { field: 'body' });
  const keys = Object.keys(raw as Record<string, unknown>);
  if (keys.length > 0) throw BusinessException.badRequest('VALIDATION_ERROR', `Unexpected field ${keys[0]}`, { field: keys[0] });
}

/** ¿El error es el `@unique` de `ShipmentRequest.sellRequestId` (dos aperturas a la vez)? */
function isSellRequestUniqueViolation(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002') return false;
  return /sellRequestId/.test(JSON.stringify(e.meta?.target ?? ''));
}

@Injectable()
export class InboundShipmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quotes: ShipmentQuoteService,
    private readonly labels: ShipmentLabelService,
    private readonly shipments: ShipmentsService,
    @Inject(SHIPPING_PROVIDER_SELECTION) private readonly selection: ShippingProviderSelection,
  ) {}

  // ================================================================ POST /admin/buylist/:id/inbound-shipment

  async open(sellRequestId: string, raw: unknown, actor: InboundActor): Promise<{ created: boolean; shipment: unknown }> {
    parseInboundShipmentBody(raw);
    // 1. Dial `shipping_provider ≠ 'skydropx'` ⇒ `404 FEATURE_DISABLED` (como `quote`).
    await this.quotes.assertProviderOn();
    let res: { created: boolean; shipmentId: string };
    try {
      res = await this.openTx(sellRequestId, actor);
    } catch (e) {
      // 4. Dos llamadas a la vez ⇒ el `@unique` gana: se relee ⇒ `created:false`. ⛔ Nunca `500`.
      if (!isSellRequestUniqueViolation(e)) throw e;
      const row = await this.prisma.shipmentRequest.findUnique({ where: { sellRequestId }, select: { id: true } });
      if (!row) throw e;
      res = { created: false, shipmentId: row.id };
    }
    const shipment = await this.shipments.adminGet(res.shipmentId, actor, this.labels.labelOptionsFor.bind(this.labels));
    return { created: res.created, shipment };
  }

  private async openTx(sellRequestId: string, actor: InboundActor): Promise<{ created: boolean; shipmentId: string }> {
    return this.prisma.$transaction(
      async (tx) => {
        // 2. El candado de la solicitud (I-BSD-4) y las guardas, en el orden del contrato.
        const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "SellRequest" WHERE id = ${sellRequestId} FOR UPDATE`;
        if (locked.length === 0) throw BusinessException.notFound();
        const sr = await tx.sellRequest.findUniqueOrThrow({
          where: { id: sellRequestId },
          select: {
            status: true,
            closedAt: true,
            sellerShippedDeclaredAt: true,
            shipmentTrackingNumber: true,
            pickupAddressSnapshot: true,
            inboundShipment: { select: { id: true, labelSource: true } },
          },
        });
        if (sr.status !== 'aceptada') throw guideNotAllowed(sr.status, 'status');
        if (sr.closedAt !== null) throw guideNotAllowed(sr.status, 'closed');
        if (sr.sellerShippedDeclaredAt !== null) throw guideNotAllowed(sr.status, 'seller_declared_shipped');
        if (sr.shipmentTrackingNumber !== null && sr.inboundShipment?.labelSource !== 'skydropx') throw manualGuideTaken();
        if (sr.pickupAddressSnapshot === null) {
          throw new BusinessException('PICKUP_ADDRESS_MISSING', 422, 'This sell request has no pickup address snapshot', { sellRequestId });
        }
        // 3. Ya existe ⇒ la misma fila (I-BSD-3: a lo sumo una por solicitud; la re-emisión la reutiliza).
        if (sr.inboundShipment) return { created: false, shipmentId: sr.inboundShipment.id };
        const row = await tx.shipmentRequest.create({
          data: {
            kind: BUYLIST_INBOUND_KIND,
            sellRequestId,
            userId: null,
            orderId: null,
            status: 'solicitado',
            shippingFeeCents: 0,
            ivaCents: 0,
            processingFeeCents: 0,
            totalCents: 0,
            priceConvention: PRICE_CONVENTION_OF_NEW_ROWS,
            addressSnapshot: inboundAddressSnapshotOf(sr.pickupAddressSnapshot) as Prisma.InputJsonValue,
          },
          select: { id: true },
        });
        // Bitácora SIN PII (ni el domicilio ni el nombre): solo qué fila se abrió.
        await tx.auditLog.create({
          data: {
            actorUserId: actor.id,
            actorRole: actor.role,
            action: 'buylist.inbound_shipment_opened',
            entityType: 'SellRequest',
            entityId: sellRequestId,
            after: { shipmentId: row.id },
          },
        });
        return { created: true, shipmentId: row.id };
      },
      { maxWait: 10_000, timeout: 30_000 },
    );
  }

  // ================================================================ GET /buylist/requests/:id/label.pdf

  /**
   * §BSD.4.4 — dueño de la solicitud. Ajena o inexistente ⇒ `404 NOT_FOUND` (la MISMA respuesta: anti-IDOR); fuera de
   * `aceptada`, guía manual (`{labelSource:'manual'}`) o sin guía viva de entrada con número ⇒ `404 LABEL_NOT_AVAILABLE`;
   * `noop` ⇒ `409 {missing:['env']}`; fallo de descarga ⇒ `502 {op:'label_download'}`. Bitácora `buylist.label_downloaded`
   * (actor = el vendedor) solo si se sirvió.
   */
  async sellerLabelPdf(sellRequestId: string, actor: InboundActor): Promise<LabelPdf> {
    const sr = await this.prisma.sellRequest.findFirst({
      where: { id: sellRequestId, userId: actor.id },
      select: {
        id: true,
        status: true,
        shipmentTrackingNumber: true,
        inboundShipment: {
          select: { id: true, status: true, labelSource: true, providerShipmentId: true, providerCanceledAt: true, trackingNumber: true, labelUrl: true },
        },
      },
    });
    if (!sr) throw BusinessException.notFound();
    const row = sr.inboundShipment;
    if (sr.status === 'aceptada' && sr.shipmentTrackingNumber !== null && row?.labelSource !== 'skydropx') {
      throw new BusinessException('LABEL_NOT_AVAILABLE', 404, 'This label was captured by hand', { labelSource: 'manual' });
    }
    if (!row || !labelPdfAvailableOf(sr, row) || row.labelUrl === null || row.providerShipmentId === null) {
      throw new BusinessException('LABEL_NOT_AVAILABLE', 404, 'No label to download');
    }
    const body = await downloadLabelPdfVia(this.selection, row.labelUrl, row.providerShipmentId);
    await this.prisma.auditLog.create({
      data: {
        actorUserId: actor.id,
        actorRole: actor.role,
        action: 'buylist.label_downloaded',
        entityType: 'SellRequest',
        entityId: sr.id,
        after: { shipmentId: row.id, providerShipmentId: row.providerShipmentId },
      },
    });
    return { body, filename: sellerLabelFilenameOf(sr.id) };
  }
}
