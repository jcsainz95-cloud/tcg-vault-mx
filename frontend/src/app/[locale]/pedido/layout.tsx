import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { LocaleToggle } from '@/components/ui/LocaleToggle';
import { LogoTcgHunt } from '@/components/domain/LogoTcgHunt';
import { SUPPORT_CONTACT_FALLBACK } from '../(storefront)/checkout/support-contact';

/**
 * Chrome REDUCIDO de la vista pública de seguimiento (DESIGN_SYSTEM §15.6).
 *
 * Cabecera con logo + `LocaleToggle` y NADA más: sin buscador, sin carrito, sin "Mi cuenta"
 * y sin navegación a Bóveda/Buylist/Mis órdenes. Motivo: la página **no implica sesión** y
 * no debe ofrecer superficies que sugieran una (ni muros de login que se lean como error).
 * Pie con términos y correo de soporte, nada más.
 *
 * Deliberadamente NO usa el layout de `(storefront)`: ese trae `StorefrontHeader` (carrito,
 * sesión, nav privado), `VerifyEmailBanner` y `PrivateRouteGuard`.
 */
export default function PublicTrackingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <SkipLink />
      <TrackingHeader />
      <main id="main" className="mx-auto w-full max-w-7xl flex-1">
        {children}
      </main>
      <TrackingFooter />
    </div>
  );
}

function SkipLink() {
  const t = useTranslations('common');
  return (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-fg"
    >
      {t('skipToContent')}
    </a>
  );
}

function TrackingHeader() {
  const t = useTranslations('common');
  return (
    <header className="border-b border-border bg-bg">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-5 py-4 sm:px-6 lg:px-8">
        {/* Marca sin enlace a la tienda (chrome reducido §15.6). §17.3 v1.7.1:
            solo-mira 28px (mínimo) + wordmark en tinta sólida (--font-brand); a
            tamaño de UI, sin degradado. */}
        <span className="flex items-center gap-3">
          <LogoTcgHunt variant="mark" size={28} decorative />
          <span className="font-brand text-[15px] font-bold uppercase leading-none tracking-[0.04em] text-text">
            {t('brand.name')}
          </span>
        </span>
        <LocaleToggle />
      </div>
    </header>
  );
}

function TrackingFooter() {
  const t = useTranslations('track');
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-5 py-8 font-mono text-[11px] uppercase tracking-label text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        <a href={`mailto:${SUPPORT_CONTACT_FALLBACK}`} className="text-text hover:text-accent">
          {SUPPORT_CONTACT_FALLBACK}
        </a>
        <Link href="/terminos" className="text-text hover:text-accent">
          {t('footerTerms')}
        </Link>
      </div>
    </footer>
  );
}
