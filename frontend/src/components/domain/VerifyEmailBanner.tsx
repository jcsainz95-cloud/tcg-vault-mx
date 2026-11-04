'use client';

import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { useSession } from '@/lib/session';
import { useResendVerification } from '@/hooks/useResendVerification';
import { resendSendsAccountSetup } from './account/resend-kind';

/**
 * Banner persistente "verifica tu correo" del shell de la tienda (contrato §1, v1.5).
 * Se muestra cuando el usuario logueado tiene `emailVerified=false`. La verificación NO
 * bloquea la navegación (el bloqueo real de acciones sensibles lo hace el backend con
 * `403 EMAIL_NOT_VERIFIED`), por eso es un aviso `warning`, no un error. CTA "Reenviar
 * correo de verificación" → POST /auth/verify-email/resend (autenticado) con feedback.
 *
 * `ready` evita el mismatch de hidratación: mientras la sesión no está lista no se pinta.
 */
export function VerifyEmailBanner() {
  const t = useTranslations('verifyEmail');
  const { user, ready } = useSession();
  const { status, resend } = useResendVerification();
  const pathname = usePathname();

  // Solo clientes sin verificar. Google entra con emailVerified=true (no afectado).
  // ⭐ v1.80.9 (DESIGN_SYSTEM §42.7, UX-13): una cuenta del equipo SIN correo trae `emailVerified:false`
  // (CHECK 4) y no tiene correo que verificar ⇒ no se pinta.
  if (!ready || !user || user.emailVerified !== false || user.email == null) return null;
  // DESIGN_SYSTEM §CTA-UX.6 petición 9 (contrato §CTA.5: comprar ya NO exige correo verificado). El aviso solo va donde
  // verificar desbloquea algo: Mi cuenta, pedidos anteriores, vender y retirar (`isVerifyBannerPath`). Nunca en
  // catálogo, ficha, carrito ni `/checkout` (CTA-F3).
  if (!isVerifyBannerPath(pathname)) return null;
  // El botón dice lo que el servidor manda (§CTA.5 `verify-email/resend`): con la cuenta pendiente (sin contraseña) el
  // reenvío emite «Termina tu cuenta», no «Verifica tu correo».
  const setupPending = resendSendsAccountSetup(user);

  return (
    // Dirección 5a: franja de papel con regla; el aviso lo marca la nota, no un fondo de color.
    <div className="border-b border-border">
      <div className="mx-auto max-w-7xl px-5 py-3 sm:px-6 lg:px-8">
        <Banner
          variant="warning"
          role="status"
          title={t('bannerTitle')}
          className="p-0"
          action={
            status === 'sent' ? (
              <span className="shrink-0 whitespace-nowrap text-sm font-medium text-success">
                {setupPending ? t('sentSetup') : t('sent')}
              </span>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                loading={status === 'sending'}
                onClick={resend}
                className="shrink-0 whitespace-nowrap"
              >
                {status === 'sending' ? t('sending') : setupPending ? t('resendSetupCta') : t('resendCta')}
              </Button>
            )
          }
        >
          {t('bannerBody')}
          {status === 'rateLimited' && (
            <span className="mt-1 block text-warning">{t('rateLimited')}</span>
          )}
          {status === 'error' && <span className="mt-1 block text-danger">{t('resendError')}</span>}
        </Banner>
      </div>
    </div>
  );
}

/**
 * Rutas donde se pinta el aviso (§CTA-UX.6 petición 9), medidas contra los `@RequireEmailVerified()` del backend
 * (`'verified'`, 2026-11-03): `/account` (y subrutas: Mi cuenta), `/orders` (ver y reclamar pedidos anteriores:
 * `GET /orders/claimable`, `POST /orders/claim`), `/buylist` (vender: `POST /buylist/requests`; la petición dice «/sell»,
 * que no existe) y `/shipments` (retiro de bóveda: `POST /shipments`). Sin ruta conocida ⇒ `false`.
 */
const VERIFY_BANNER_PATH = /^\/(es|en)\/(account|orders|buylist|shipments)(\/|$)/;
export function isVerifyBannerPath(pathname: string | null | undefined): boolean {
  return pathname != null && VERIFY_BANNER_PATH.test(pathname.split(/[?#]/)[0] ?? '');
}
