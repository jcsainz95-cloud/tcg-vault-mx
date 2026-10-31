import { Suspense } from 'react';
import { ShipmentsView } from './ShipmentsView';
import { RouteMessages } from '@/components/i18n/RouteMessages';

export default function ShipmentsPage() {
  // useSearchParams (preselección ?item=) requiere un boundary de Suspense en Next 15.
  // §DYN.6.7 (c1): el ámbito `storefront` de esta página (`RouteMessages`; la raíz manda solo `SHELL`).
  return (
    <RouteMessages scope="storefront">
      <Suspense>
        <ShipmentsView />
      </Suspense>
    </RouteMessages>
  );
}
