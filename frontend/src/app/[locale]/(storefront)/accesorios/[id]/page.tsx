import { AccessoryDetailView } from './AccessoryDetailView';

export default async function AccessoryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AccessoryDetailView id={id} />;
}
