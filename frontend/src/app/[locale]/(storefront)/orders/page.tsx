import { Suspense } from 'react';
import { OrdersView } from './OrdersView';
import { RouteMessages } from '@/components/i18n/RouteMessages';

export default function OrdersPage() {
  // useSearchParams (pestaña ?tab=ventas, §33.3) requiere un boundary de Suspense en Next 15.
  // §DYN.6.7 (c1): el ámbito `storefront` de esta página (`RouteMessages`; la raíz manda solo `SHELL`).
  return (
    <RouteMessages scope="storefront">
      <Suspense>
        <OrdersView />
      </Suspense>
    </RouteMessages>
  );
}
