import { Suspense } from 'react';
import { VaultView } from './VaultView';

export default function VaultPage() {
  // useSearchParams (pestaña ?tab=retiros, §33.4) requiere un boundary de Suspense en Next 15.
  return (
    <Suspense>
      <VaultView />
    </Suspense>
  );
}
