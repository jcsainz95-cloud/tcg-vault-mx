import { Suspense } from 'react';
import { SealedShopView } from './SealedShopView';

export default function SealedShopPage() {
  // StoreTabs usa useSearchParams (pestaña Gradeadas): requiere Suspense en Next 15.
  return (
    <Suspense>
      <SealedShopView />
    </Suspense>
  );
}
