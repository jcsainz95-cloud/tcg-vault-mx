import { Suspense } from 'react';
import { ShipmentsView } from './ShipmentsView';

export default function ShipmentsPage() {
  // useSearchParams (preselección ?item=) requiere un boundary de Suspense en Next 15.
  return (
    <Suspense>
      <ShipmentsView />
    </Suspense>
  );
}
