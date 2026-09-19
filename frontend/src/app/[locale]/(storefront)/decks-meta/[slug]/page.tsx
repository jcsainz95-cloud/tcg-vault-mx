import { DeckDetailView } from './DeckDetailView';

export default async function DeckDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <DeckDetailView slug={slug} />;
}
