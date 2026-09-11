'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Banner } from '@/components/ui/Banner';
import type { SellRequirements } from '@/hooks/useSellRequirements';
import { EmailNotVerifiedNotice } from './EmailNotVerifiedNotice';

/**
 * Panel de requisitos del flujo de VENDER (buylist). Comunica AL INICIO lo que la cuenta
 * necesita para poder enviar la solicitud, en vez de dejar que el usuario llene todo y
 * reciba un 403 críptico al final (guards del contrato §6: sesión + correo verificado;
 * CLABE en el envío; INE cuando el SERVIDOR dice que hace falta — §M6-K.5, ⛔ sin cifra). El
 * bloqueo real sigue siendo server-side.
 *
 * Dirección 5a: checklist en mono con marcas de texto (✓ / — / !) y notas con regla;
 * sin cajas de color.
 */
export function SellRequirementsPanel({ req }: { req: SellRequirements }) {
  const t = useTranslations('buylist');

  // Durante SSR/primer render no hay sesión resuelta: no pintar gating (evita mismatch).
  if (!req.ready) return null;

  // Sin sesión → "Inicia sesión o crea cuenta para vender" (cotizar sigue siendo libre, P-13).
  if (!req.isAuthenticated) {
    return (
      <Banner variant="warning" role="status" title={t('loginToSellTitle')}>
        {t('loginToSellBody')}
        <span className="mt-3 flex flex-wrap gap-6">
          {/* §33.11 / ARCHITECTURE §4.47.6: `next=/buylist` para volver al cotizador con el carrito
              de venta ya rehidratado (antes aterrizaba en `/` y el árbol se desmontaba). */}
          <Link
            href={{ pathname: '/login', query: { next: '/buylist' } }}
            className="border-b border-accent pb-1 text-xs font-medium text-accent hover:border-text hover:text-text"
          >
            {t('loginCta')}
          </Link>
          <Link
            href={{ pathname: '/register', query: { next: '/buylist' } }}
            className="border-b border-accent pb-1 text-xs font-medium text-accent hover:border-text hover:text-text"
          >
            {t('registerCta')}
          </Link>
        </span>
      </Banner>
    );
  }

  // Correo no verificado → aviso claro + CTA de reenvío (POST /auth/verify-email/resend).
  if (req.emailBlocked) {
    return <EmailNotVerifiedNotice />;
  }

  // Sesión ok → checklist informativo de lo que falta/cumple ANTES de llenar el formulario.
  return (
    <div>
      <p className="eyebrow">{t('requirementsTitle')}</p>
      <ul className="mt-3 flex flex-col gap-2 font-mono text-[11px] leading-[1.6]">
        {req.emailVerified === true && (
          <li className="text-success">
            <span aria-hidden>✓ </span>
            {t('reqEmailVerified')}
          </li>
        )}
        {req.kycLoading ? (
          <li className="text-muted">{t('reqChecking')}</li>
        ) : (
          <>
            {req.clabeOnFile ? (
              <li className="text-success">
                <span aria-hidden>✓ </span>
                {t('reqClabeOnFile', { masked: req.clabeMasked ?? '' })}
              </li>
            ) : (
              <li className="text-muted">
                <span aria-hidden>— </span>
                {t('reqClabeMissing')}
              </li>
            )}
            {req.ineExpected && req.kyc ? (
              /* ⛔ SIN CIFRA (§34.9, decisión (c) del dueño): el veredicto lo da el servidor
                 (`ineRequiredForTotal`) y el umbral no viaja. Publicar el umbral es publicar el
                 manual para quedarse justo debajo. */
              <li className="text-accent">
                <span aria-hidden>! </span>
                {t('reqIneExpected')}
              </li>
            ) : req.ineOnFile ? (
              <li className="text-success">
                <span aria-hidden>✓ </span>
                {t('reqIneOnFile')}
              </li>
            ) : null}
          </>
        )}
      </ul>
    </div>
  );
}
