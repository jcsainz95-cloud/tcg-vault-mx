import { Suspense } from 'react';
import { AccessoriesShopView } from './AccessoriesShopView';

export default function AccessoriesPage() {
  // StoreTabs y el filtro leen la URL con useSearchParams: requiere Suspense en Next 15.
  return (
    <Suspense>
      <AccessoriesShopView />
    </Suspense>
  );
}
