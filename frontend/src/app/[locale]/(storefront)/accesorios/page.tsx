import { Suspense } from 'react';
import { AccessoriesShopView } from './AccessoriesShopView';
import { RouteMessages } from '@/components/i18n/RouteMessages';

export default function AccessoriesPage() {
  // StoreTabs y el filtro leen la URL con useSearchParams: requiere Suspense en Next 15.
  // §DYN.6.7 (c1): el ámbito `storefront` de esta página (`RouteMessages`; la raíz manda solo `SHELL`).
  return (
    <RouteMessages scope="storefront">
      <Suspense>
        <AccessoriesShopView />
      </Suspense>
    </RouteMessages>
  );
}
