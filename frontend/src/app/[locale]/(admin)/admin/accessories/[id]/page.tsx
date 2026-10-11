import { Suspense } from 'react';
import { AccessoryEditView } from '../AccessoryEditView';

export default async function AccessoryAdminPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <AccessoryEditView id={id} />
    </Suspense>
  );
}
