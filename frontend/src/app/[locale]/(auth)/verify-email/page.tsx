import { VerifyEmailView } from './VerifyEmailView';

/**
 * Ruta de verificación de correo. El link del correo apunta aquí con `?token=`
 * (contrato §1: `${APP_BASE_URL}/<locale>/verify-email?token=…`). El token se lee en
 * el server component y se pasa al cliente para consumirlo al montar.
 */
export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return <VerifyEmailView token={token} />;
}
