import { SupplierActivateForm } from '@/components/supplier/SupplierActivateForm';

/** El token viaja en `?token=` (un solo uso, 72 h). */
export default async function SupplierActivatePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return <SupplierActivateForm token={token ?? ''} />;
}
