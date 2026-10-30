import { Suspense } from 'react';
import { SealedShopView } from './SealedShopView';
import { RouteMessages } from '@/components/i18n/RouteMessages';

export default function SealedShopPage() {
  // StoreTabs usa useSearchParams (pestaña Gradeadas): requiere Suspense en Next 15.
  // §DYN.6.7 (c1): el ámbito `storefront` de esta página (`RouteMessages`; la raíz manda solo `SHELL`).
  return (
    <RouteMessages scope="storefront">
      <Suspense>
        <SealedShopView />
      </Suspense>
    </RouteMessages>
  );
}
