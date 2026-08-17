import { ShipmentDetailView } from './ShipmentDetailView';

export default async function ShipmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ShipmentDetailView shipmentId={id} />;
}
