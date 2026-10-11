import { fetchShipmentLabelPdf } from '@/lib/api';

/**
 * La etiqueta por el PROXY autenticado (`GET /admin/shipments/:id/label.pdf`, §19.8): la sesión viaja en la
 * cabecera (`requestBlob`), así que lo que se abre o se descarga es un `blob:` local — ⛔ nunca la URL de
 * Skydropx, que no viaja en ningún DTO. Decisión de frontend que §43.5 dejó abierta («enlace con cookie o
 * `blob:` tras `fetch`»): la sesión de este cliente es un Bearer en `localStorage`, no una cookie, así que
 * un enlace directo saldría sin credenciales y respondería `401`.
 *
 * `print` abre el PDF en otra pestaña para el diálogo de impresión del navegador; `download` lo guarda con el nombre
 * del `Content-Disposition` del servidor (respaldo: `guia-<ref>.pdf`). Lanza el error del servidor tal cual (`404 LABEL_NOT_AVAILABLE`, `502`…).
 */
export async function openLabelPdf(shipmentId: string, ref: string, mode: 'print' | 'download'): Promise<void> {
  const { blob, filename } = await fetchShipmentLabelPdf(shipmentId);
  if (typeof window === 'undefined' || typeof URL.createObjectURL !== 'function') return;
  const url = URL.createObjectURL(blob);
  if (mode === 'print') {
    window.open(url, '_blank', 'noopener');
  } else {
    const a = document.createElement('a');
    a.href = url;
    // El nombre lo da el SERVIDOR (`Content-Disposition`, p. ej. `sellerLabelFilenameOf` en la guía de entrada); `ref` es
    // solo el respaldo si la cabecera no llega (BSD-TL-D8).
    a.download = filename ?? `guia-${ref}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  // El navegador ya tomó el recurso; se libera después para no cortar la pestaña de impresión.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
