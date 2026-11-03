import { VerifyEmailView } from './VerifyEmailView';

/**
 * Ruta de verificación de correo. El link del correo apunta aquí con `?token=`
 * (contrato §1: `${APP_BASE_URL}/<locale>/verify-email?token=…`). El token se lee en
 * el server component y se pasa al cliente, que lo quita de la barra (D-CTA-10) y NO lo canjea al montar: canjear es
 * enviar el formulario con la contraseña actual o una nueva (v1.117.2, D-CTA-12, CTA-F9).
 */
export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return <VerifyEmailView token={token} />;
}
