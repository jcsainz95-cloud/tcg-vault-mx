import { fetchSellRequestLabelPdf } from '@/lib/api';
import { asApiError } from '@/lib/api-client';

/**
 * 💰 rev BSD-1 (§BSD.4.4, DESIGN_SYSTEM §BSD-UX.4b) — **la etiqueta del vendedor**, por el PROXY autenticado
 * (`GET /buylist/requests/:id/label.pdf`). La sesión de este cliente es un Bearer (no una cookie), así que un enlace directo
 * saldría sin credenciales: se pide con `requestBlob` y se guarda el `blob:` local. ⛔ Nunca la URL de Skydropx (no viaja en
 * ningún DTO de cliente).
 *
 * El nombre del archivo es el del servidor (`Content-Disposition`); si no llega, `guia-<8 primeros del folio>.pdf` (el mismo
 * patrón que §BSD.4.4 y el adjunto de AV-7).
 */
export async function downloadSellerLabel(sellRequestId: string): Promise<void> {
  const { blob, filename } = await fetchSellRequestLabelPdf(sellRequestId);
  if (typeof window === 'undefined' || typeof URL.createObjectURL !== 'function') return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `guia-${sellRequestId.slice(0, 8)}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Qué frase pinta un fallo de la descarga (§BSD-UX.4b): `404` — `LABEL_NOT_AVAILABLE` **y** `NOT_FOUND`, el mismo texto
 * (sin oráculo) — ⇒ `unavailable` (y la pantalla relee la solicitud); `502`, `409 SHIPPING_PROVIDER_NOT_CONFIGURED`, red o
 * cualquier otra cosa ⇒ `temporary` (reintentar es un clic).
 */
export function sellerLabelErrorKind(e: unknown): 'unavailable' | 'temporary' {
  return asApiError(e)?.status === 404 ? 'unavailable' : 'temporary';
}
