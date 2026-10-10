import { Suspense } from 'react';
import { AccessoryEditView } from '../AccessoryEditView';

export default function NewAccessoryPage() {
  return (
    <Suspense>
      <AccessoryEditView />
    </Suspense>
  );
}
