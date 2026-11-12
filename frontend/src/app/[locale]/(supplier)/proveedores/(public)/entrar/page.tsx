import { SupplierLoginForm } from '@/components/supplier/SupplierLoginForm';

/** `?changed=1`: viene de cambiar la contraseña (el servidor cerró todas las sesiones). */
export default async function SupplierLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ changed?: string }>;
}) {
  const { changed } = await searchParams;
  return <SupplierLoginForm passwordChanged={changed === '1'} />;
}
