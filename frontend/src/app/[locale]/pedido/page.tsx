import type { Metadata } from 'next';
import { TrackingPageClient } from './TrackingPageClient';

/**
 * Ruta pública de seguimiento del pedido de invitado — `/[locale]/pedido?token=…`.
 *
 * Cabeceras/metadatos exigidos por el contrato §4-G.7 y DESIGN_SYSTEM §15.6:
 *  - `noindex, nofollow`: la URL lleva (por un instante) un token; no debe indexarse.
 *  - `Referrer-Policy: no-referrer` (vía `<meta name="referrer">`): que el token no viaje
 *    en el `Referer` hacia terceros (imágenes de catálogo remotas incluidas).
 * El `Cache-Control: no-store` de la RESPUESTA de la API lo pone el backend (§4-G.3).
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

export default function PublicOrderTrackingPage() {
  return <TrackingPageClient />;
}
