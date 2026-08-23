import { Suspense } from 'react';
import { CatalogView } from './CatalogView';

export default function CatalogPage() {
  // useSearchParams (pestaña Gradeadas, ?type=graded) requiere Suspense en Next 15.
  return (
    <Suspense>
      <CatalogView />
    </Suspense>
  );
}
