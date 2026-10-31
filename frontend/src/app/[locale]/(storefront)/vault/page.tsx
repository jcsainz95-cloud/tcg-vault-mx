import { Suspense } from 'react';
import { VaultView } from './VaultView';
import { RouteMessages } from '@/components/i18n/RouteMessages';

export default function VaultPage() {
  // useSearchParams (pestaña ?tab=retiros, §33.4) requiere un boundary de Suspense en Next 15.
  // §DYN.6.7 (c1): el ámbito `storefront` de esta página (`RouteMessages`; la raíz manda solo `SHELL`).
  return (
    <RouteMessages scope="storefront">
      <Suspense>
        <VaultView />
      </Suspense>
    </RouteMessages>
  );
}
