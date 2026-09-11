import { PasswordPage } from '@/components/domain/account/PasswordPage';

/**
 * `/account/password` — página de contraseña del cliente y, con temporal, pantalla de BLOQUEO
 * (contrato v1.67 «Contraseña temporal OBLIGATORIA» · ARCHITECTURE §4.47.7 · DESIGN_SYSTEM §33.7-8).
 * La URL es contrato con el login y con el interceptor global: no se renombra.
 */
export default async function AccountPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reason?: string }>;
}) {
  const { next, reason } = await searchParams;
  return <PasswordPage surface="storefront" next={next} reason={reason} />;
}
