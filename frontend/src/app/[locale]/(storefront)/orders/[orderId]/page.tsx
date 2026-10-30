import { OrderDetailView } from './OrderDetailView';
import { RouteMessages } from '@/components/i18n/RouteMessages';

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  // §DYN.6.7 (c1): el ámbito `storefront` de esta página (`RouteMessages`; la raíz manda solo `SHELL`).
  return (
    <RouteMessages scope="storefront">
      <OrderDetailView orderId={orderId} />
    </RouteMessages>
  );
}
