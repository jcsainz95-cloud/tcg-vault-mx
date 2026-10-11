import { M3OrderDetailView } from './M3OrderDetailView';

/**
 * `/admin/m3/[orderId]` — el detalle de una orden (`DESIGN_SYSTEM §37.11a` · contrato `GET /admin/orders/:id`,
 * §M4-SHIP.10/.15.13/.18.6): identidad, envíos con enlace a «Pedidos por preparar», reembolsos (libro y
 * transferencias), `vaultPieces`, «Reclamar» y la confirmación física (`chargeback-inventory`).
 */
export default async function M3OrderPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  return <M3OrderDetailView orderId={orderId} />;
}
