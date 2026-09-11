import { PasswordPage } from '@/components/domain/account/PasswordPage';

/**
 * `/admin/account/password` — página de contraseña del staff y, con temporal, pantalla de BLOQUEO
 * (contrato v1.67 · ARCHITECTURE §4.47.7 · DESIGN_SYSTEM §33.7-8). URL de contrato con el login y
 * con el interceptor global.
 */
export default async function AdminAccountPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reason?: string }>;
}) {
  const { next, reason } = await searchParams;
  return <PasswordPage surface="admin" next={next} reason={reason} />;
}
