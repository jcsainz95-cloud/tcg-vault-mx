/**
 * label-pdf.service.ts — 🔒 `GET /api/v1/admin/shipments/:id/label.pdf` (API_CONTRACT §M4-SHIP.19.8, §19.18.5 SEC-SDX-5,
 * §19.19.9, §19.31.5 (3); PS-84, PS-90, PS-100, PS-166 (d)). Operador+ por la ruta.
 *
 * Sirve la etiqueta POR PROXY: ⛔ nunca redirige a `labelUrl` (columna interna; podría ser firmada o no exigir sesión).
 *  - Guardas (en este orden): envío inexistente ⇒ `404 NOT_FOUND`; guía manual ⇒ `404 LABEL_NOT_AVAILABLE
 *    {labelSource:'manual'}`; sin guía de Skydropx, sin `labelUrl` o envío `cancelado` ⇒ `404 LABEL_NOT_AVAILABLE`
 *    (reimprimible mientras el envío esté vivo; en `entregado` también).
 *  - Con `shipping_provider='off'` SIGUE funcionando (opera sobre una guía ya comprada, SEC-SDX-12): ⛔ no mira el dial.
 *  - `kind='noop'` ⇒ `409 SHIPPING_PROVIDER_NOT_CONFIGURED {missing:['env']}` (no hay con qué descargar).
 *  - `kind='skydropx'` ⇒ `downloadLabelPdf` (D1c: `assertProviderUrl` en cada salto, ≤ 3 redirecciones, `application/pdf`,
 *    ≤ 5 MB, 10 s; `Authorization` solo al host de la API) ⇒ cualquier incumplimiento `502 {op:'label_download'}`.
 *  - `kind='fake'` ⇒ `FakeShippingProvider.labelPdf()`: un PDF fijo del proceso, ⛔ CERO `fetch` (§19.31.5 (3)).
 *  - Bitácora `shipment.label_printed` (actor, fecha) SOLO si se sirvió el PDF.
 */
import { Inject, Injectable } from '@nestjs/common';
import { BusinessException } from '../../common/business.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { FakeShippingProvider } from '../shipping-provider/fake-shipping-provider';
import { downloadLabelPdf } from '../shipping-provider/label-proxy';
import { ShippingProviderError } from '../shipping-provider/shipping-provider.errors';
import { SHIPPING_PROVIDER_SELECTION } from '../shipping-provider/shipping-provider.module';
import { ShippingProviderSelection } from '../shipping-provider/shipping-provider.factory';
import { LabelActor, ShipmentLabelService } from './label-purchase.service';
import { labelSourceOf } from './label-source';

export interface LabelPdf {
  body: Buffer;
  filename: string;
}

/** `guia-<orderNumber|shipmentId>.pdf`, con el nombre reducido a `[A-Za-z0-9_-]` (va en una cabecera). */
export function labelFilenameOf(orderNumber: string | null | undefined, shipmentId: string): string {
  const base = (orderNumber && orderNumber.trim() !== '' ? orderNumber : shipmentId).replace(/[^A-Za-z0-9_-]/g, '');
  return `guia-${base || 'envio'}.pdf`;
}

@Injectable()
export class ShipmentLabelPdfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly labels: ShipmentLabelService,
    @Inject(SHIPPING_PROVIDER_SELECTION) private readonly selection: ShippingProviderSelection,
  ) {}

  async labelPdf(shipmentId: string, actor: LabelActor): Promise<LabelPdf> {
    const row = await this.prisma.shipmentRequest.findUnique({
      where: { id: shipmentId },
      select: {
        id: true,
        status: true,
        labelSource: true,
        trackingNumber: true,
        labelUrl: true,
        providerShipmentId: true,
        order: { select: { orderNumber: true } },
      },
    });
    if (!row) throw BusinessException.notFound();
    const source = labelSourceOf(row);
    if (source === 'manual') {
      throw new BusinessException('LABEL_NOT_AVAILABLE', 404, 'This label was captured by hand', { labelSource: 'manual' });
    }
    if (source !== 'skydropx' || row.labelUrl === null || row.providerShipmentId === null || row.status === 'cancelado') {
      throw new BusinessException('LABEL_NOT_AVAILABLE', 404, 'No label to print');
    }
    const body = await this.download(row.labelUrl, row.providerShipmentId);
    await this.labels.audit(this.prisma, actor, shipmentId, 'shipment.label_printed', { providerShipmentId: row.providerShipmentId });
    return { body, filename: labelFilenameOf(row.order?.orderNumber, shipmentId) };
  }

  private async download(labelUrl: string, providerShipmentId: string): Promise<Buffer> {
    const sel = this.selection;
    if (sel.kind === 'fake') {
      // ⛔ CERO red: el doble no tiene etiqueta remota (§19.31.5 (3)).
      if (!(sel.port instanceof FakeShippingProvider)) throw ShippingProviderError.notConfigured(['env']).toBusinessException();
      return sel.port.labelPdf(providerShipmentId);
    }
    if (sel.kind === 'noop' || sel.client === null) throw ShippingProviderError.notConfigured(['env']).toBusinessException();
    try {
      return await downloadLabelPdf(labelUrl, { api: sel.client, allowedHosts: sel.urlHosts });
    } catch (e) {
      throw e instanceof ShippingProviderError ? e.toBusinessException() : e;
    }
  }
}
