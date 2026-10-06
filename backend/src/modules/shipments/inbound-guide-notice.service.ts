/**
 * inbound-guide-notice.service.ts — 💰 rev BSD-1, paso B-2 (API_CONTRACT §BSD.3 fila «Post-commit tras guía con número»,
 * §BSD.8.2; `DESIGN_SYSTEM §BSD-UX.2`): **AV-7 con la etiqueta** al vendedor cuando la guía de ENTRADA de Skydropx obtiene
 * su número (en la respuesta de la compra, `persistLabeled`, o en el job de «en proceso», `setTrackingFromProvider`).
 *
 *  - ⛔ AV-4 no (la fila de entrada no tiene cliente); el aviso es el AV-7 de la solicitud, con el MISMO sello
 *    (`SellRequest.guideNoticeSentAt`), reclamado por `UPDATE … WHERE guideNoticeSentAt IS NULL` (`count === 1` ⇒ se manda;
 *    `0` ⇒ otra corrida ganó). Es el mecanismo de `claimAndNotifySellRequest` (buylist), repetido aquí porque aquel es
 *    privado del servicio de buylist; el sello y su reinicio por valor (`writeSellRequestGuide`) son los mismos.
 *  - El PDF se descarga POST-COMMIT con el MISMO cuerpo que la descarga del vendedor (`downloadLabelPdfVia`, ≤ 5 MB). Si
 *    falla, el correo **sale igual sin adjunto** (variante S0) y queda el log `buylist.guide_mail_without_pdf`; ⛔ no se
 *    reintenta el correo (el sello ya se reclamó).
 *  - «+R»: si la fila de entrada ya tuvo otra guía cancelada por re-emisión (`ShipmentPaidLabel.cancelKind='reissue'`), la
 *    línea «sustituye a la anterior» (Q-BSD-2: sí por defecto).
 *  - Best-effort: ⛔ nunca lanza (el hecho ya se comiteó; *el aviso cuelga del hecho, el hecho no cuelga del aviso*).
 */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MAIL_PORT, MailPort } from '../mail/mail.port';
import { SHIPPING_PROVIDER_SELECTION } from '../shipping-provider/shipping-provider.module';
import { ShippingProviderSelection } from '../shipping-provider/shipping-provider.factory';
import { sellGuideTemplate } from '../buylist/buylist-notice.templates';
import { buylistPortalUrl } from '../buylist/buylist-mail.templates';
import { providerTrackingUrlOf } from './customer-timeline';
import { labelPdfAvailableOf, sellerLabelFilenameOf } from './label-inbound';
import { downloadLabelPdfVia } from './label-pdf-download';

@Injectable()
export class InboundGuideNoticeService {
  private readonly logger = new Logger(InboundGuideNoticeService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SHIPPING_PROVIDER_SELECTION) private readonly selection: ShippingProviderSelection,
    @Optional() @Inject(MAIL_PORT) private readonly mail?: MailPort,
  ) {}

  /** AV-7 con la etiqueta de la guía de entrada `shipmentId` (post-commit, best-effort). */
  async notifyLabeled(shipmentId: string): Promise<void> {
    try {
      const row = await this.prisma.shipmentRequest.findUnique({
        where: { id: shipmentId },
        select: {
          sellRequestId: true,
          status: true,
          labelSource: true,
          providerShipmentId: true,
          providerCanceledAt: true,
          trackingNumber: true,
          labelUrl: true,
          trackingUrl: true,
        },
      });
      if (!row?.sellRequestId) return;
      const sr = await this.prisma.sellRequest.findUnique({
        where: { id: row.sellRequestId },
        select: {
          id: true,
          status: true,
          shipmentCarrier: true,
          shipmentTrackingNumber: true,
          shipDeadlineAt: true,
          user: { select: { name: true, email: true, locale: true, anonymizedAt: true } },
        },
      });
      // ⛔ Sin guía viva con número (cancelada, re-emitida o cerrada entre el commit y aquí) no se manda nada.
      if (!sr || !sr.shipmentCarrier || !sr.shipmentTrackingNumber || !labelPdfAvailableOf(sr, row)) return;
      if (sr.shipmentTrackingNumber !== row.trackingNumber) return;
      if (!this.mail) {
        this.logger.warn(`buylist inbound guide mail skipped for ${sr.id}: MAIL_PORT unavailable`);
        return;
      }
      const user = sr.user;
      // §R.5.a: ⛔ ni sin correo ni a una cuenta anonimizada.
      if (!user?.email || user.anonymizedAt) {
        this.logger.warn(`buylist inbound guide mail skipped for ${sr.id}: no recipient email`);
        return;
      }
      // EL sello de AV-7 (una vez por par paquetería/número; `writeSellRequestGuide` lo limpia solo si el par cambia). La
      // solicitud sigue `aceptada` y abierta EN EL `WHERE` (la misma guarda que el sello de `claimAndNotifySellRequest`, B-3):
      // si «Declinar» o la regla 8 ganaron entre el commit de la guía y aquí, ⛔ no se avisa de una guía ya cancelada.
      const sealed = await this.prisma.sellRequest.updateMany({
        where: { id: sr.id, status: 'aceptada', closedAt: null, guideNoticeSentAt: null, shipmentTrackingNumber: row.trackingNumber },
        data: { guideNoticeSentAt: new Date() },
      });
      if (sealed.count !== 1) return;
      const replaced = (await this.prisma.shipmentPaidLabel.count({ where: { shipmentRequestId: shipmentId, cancelKind: 'reissue' } })) > 0;
      let pdf: Buffer | null = null;
      if (row.labelUrl && row.providerShipmentId) {
        try {
          pdf = await downloadLabelPdfVia(this.selection, row.labelUrl, row.providerShipmentId);
        } catch (e) {
          pdf = null;
          this.logger.warn(`buylist.guide_mail_without_pdf sellRequestId=${sr.id} reason=${e instanceof Error ? e.constructor.name : 'unknown'}`);
        }
      }
      if (!pdf) this.logger.warn(`buylist.guide_mail_without_pdf sellRequestId=${sr.id}`);
      const msg = sellGuideTemplate(
        {
          folio: sr.id,
          carrier: sr.shipmentCarrier,
          trackingNumber: sr.shipmentTrackingNumber,
          shipDeadlineAt: sr.shipDeadlineAt,
          portalUrl: buylistPortalUrl(sr.id, user.locale),
          skydropx: { pdfAttached: pdf !== null, replaced, trackingUrl: providerTrackingUrlOf(row) },
        },
        user.name ?? '',
        user.locale,
      );
      await this.mail.send({
        ...msg,
        to: user.email,
        ...(pdf ? { attachments: [{ filename: sellerLabelFilenameOf(sr.id), content: pdf, contentType: 'application/pdf' as const }] } : {}),
      });
    } catch (e) {
      this.logger.error(`buylist inbound guide mail failed for shipment ${shipmentId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
