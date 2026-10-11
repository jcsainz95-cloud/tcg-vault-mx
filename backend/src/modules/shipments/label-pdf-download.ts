/**
 * label-pdf-download.ts — 🔒 la DESCARGA de la etiqueta de Skydropx por proxy, UN cuerpo (API_CONTRACT §M4-SHIP.19.8,
 * §19.18.5 SEC-SDX-5, §19.31.5 (3); rev BSD-1 §BSD.4.4 y §BSD.8.2). Tres llamadores: la ruta admin
 * (`ShipmentLabelPdfService`), la del VENDEDOR (`GET /buylist/requests/:id/label.pdf`) y el adjunto de AV-7.
 *
 *  - `kind='fake'` ⇒ el PDF fijo del doble, ⛔ CERO `fetch`;
 *  - `kind='noop'` (o sin cliente) ⇒ `409 SHIPPING_PROVIDER_NOT_CONFIGURED {missing:['env']}`;
 *  - `kind='skydropx'` ⇒ `downloadLabelPdf` (`assertProviderUrl` en cada salto, ≤ 3 redirecciones, `application/pdf`,
 *    ≤ 5 MB, 10 s) ⇒ cualquier incumplimiento `502 SHIPPING_PROVIDER_ERROR {op:'label_download'}`.
 * ⛔ Nunca redirige a `labelUrl`. Fichero sin servicios (solo la selección del proveedor): sin ciclo de imports.
 */
import { FakeShippingProvider } from '../shipping-provider/fake-shipping-provider';
import { downloadLabelPdf } from '../shipping-provider/label-proxy';
import { ShippingProviderError } from '../shipping-provider/shipping-provider.errors';
import { ShippingProviderSelection } from '../shipping-provider/shipping-provider.factory';

export async function downloadLabelPdfVia(sel: ShippingProviderSelection, labelUrl: string, providerShipmentId: string): Promise<Buffer> {
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
