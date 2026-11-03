import type { UserDTO } from '@/types/contract';

/**
 * ¿Qué correo manda `POST /auth/verify-email/resend` a esta cuenta? (contrato §CTA.5: con `setupPending` emite
 * «Termina tu cuenta» en vez de «Verifica tu correo»). DESIGN_SYSTEM §CTA-UX.6 petición 9: la etiqueta del botón y el
 * aviso de enviado dicen el correo que de verdad sale. `hasPassword` manda sobre una bandera vieja (como CTA-F5).
 */
export function resendSendsAccountSetup(
  user: Pick<UserDTO, 'accountSetupPending' | 'hasPassword'> | null | undefined,
): boolean {
  return user?.accountSetupPending === true && user.hasPassword !== true;
}
