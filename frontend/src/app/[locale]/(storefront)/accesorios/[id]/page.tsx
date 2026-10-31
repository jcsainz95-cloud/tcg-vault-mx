import { AccessoryDetailView } from './AccessoryDetailView';
import { RouteMessages } from '@/components/i18n/RouteMessages';

export default async function AccessoryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // §DYN.6.7 (c1): el ámbito `storefront` de esta página (`RouteMessages`; la raíz manda solo `SHELL`).
  return (
    <RouteMessages scope="storefront">
      <AccessoryDetailView id={id} />
    </RouteMessages>
  );
}
