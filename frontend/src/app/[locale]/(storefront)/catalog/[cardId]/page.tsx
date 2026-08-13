import { CardDetailView } from './CardDetailView';

export default async function CardDetailPage({
  params,
}: {
  params: Promise<{ cardId: string }>;
}) {
  const { cardId } = await params;
  return <CardDetailView cardId={cardId} />;
}
