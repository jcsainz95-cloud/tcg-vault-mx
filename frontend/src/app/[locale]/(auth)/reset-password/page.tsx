import { ResetPasswordView } from './ResetPasswordView';

/**
 * Ruta de restablecimiento de contraseña. El link del correo apunta aquí con `?token=`
 * (contrato §1: `${APP_BASE_URL}/<locale>/reset-password?token=…`).
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return <ResetPasswordView token={token} />;
}
