import { PrintSheetView } from './PrintSheetView';

/**
 * `/admin/m4/print` — la hoja de preparación imprimible (`DESIGN_SYSTEM §37.11c`, criterio 232): la misma
 * respuesta de la cola, en papel, con casilla por carta y ⛔ sin precios, correo, teléfono ni importes.
 * `?destination=ship|vault` y `?shipment=<id>` / `?placement=<id>` acotan lo que sale.
 */
export default async function PrintSheetPage({
  searchParams,
}: {
  searchParams: Promise<{ destination?: string | string[]; shipment?: string | string[]; placement?: string | string[] }>;
}) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const destination = one(sp.destination);
  return (
    <PrintSheetView
      destination={destination === 'ship' || destination === 'vault' ? destination : undefined}
      shipmentId={one(sp.shipment)}
      placementId={one(sp.placement)}
    />
  );
}
