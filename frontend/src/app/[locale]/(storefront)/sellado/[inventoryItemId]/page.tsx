import { SealedDetailView } from './SealedDetailView';

export default async function SealedDetailPage({
  params,
}: {
  params: Promise<{ inventoryItemId: string }>;
}) {
  const { inventoryItemId } = await params;
  return <SealedDetailView inventoryItemId={inventoryItemId} />;
}
