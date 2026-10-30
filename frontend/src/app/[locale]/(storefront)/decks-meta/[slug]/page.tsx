import { DeckDetailView } from './DeckDetailView';
import { RouteMessages } from '@/components/i18n/RouteMessages';

export default async function DeckDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  // §DYN.6.7 (c1): el ámbito `storefront` de esta página (`RouteMessages`; la raíz manda solo `SHELL`).
  return (
    <RouteMessages scope="storefront">
      <DeckDetailView slug={slug} />
    </RouteMessages>
  );
}
