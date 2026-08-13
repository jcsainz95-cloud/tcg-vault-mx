import { CardDetailView } from './CardDetailView';

export default function CardDetailPage({ params }: { params: { cardId: string } }) {
  return <CardDetailView cardId={params.cardId} />;
}
