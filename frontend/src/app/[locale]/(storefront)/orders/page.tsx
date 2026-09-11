import { Suspense } from 'react';
import { OrdersView } from './OrdersView';

export default function OrdersPage() {
  // useSearchParams (pestaña ?tab=ventas, §33.3) requiere un boundary de Suspense en Next 15.
  return (
    <Suspense>
      <OrdersView />
    </Suspense>
  );
}
