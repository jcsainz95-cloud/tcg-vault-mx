import { AccountSetupView } from './AccountSetupView';

/**
 * «Termina tu cuenta» (API_CONTRACT §CTA.6, criterio 971). El enlace del correo apunta aquí con `?token=`
 * (`${APP_BASE_URL}/<locale>/account-setup?token=…`). El token se lee en el servidor y viaja por props: la vista lo
 * quita de la barra antes de cualquier petición (D-CTA-10). Pública, sin medición (`lib/measurement/routes.ts`) y con
 * `Referrer-Policy: no-referrer` (`next.config.mjs`).
 */
export default async function AccountSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return <AccountSetupView token={token} />;
}
