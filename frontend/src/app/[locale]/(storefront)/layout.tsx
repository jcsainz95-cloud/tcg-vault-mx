import { useTranslations } from 'next-intl';
import { StorefrontHeader } from '@/components/layout/StorefrontHeader';
import { VerifyEmailBanner } from '@/components/domain/VerifyEmailBanner';
import { PrivateRouteGuard } from '@/components/layout/PrivateRouteGuard';
import { Link } from '@/i18n/navigation';

/*
 * Dirección 5a: el ancho de lectura es 1280px (max-w-7xl) y el margen crece a 32px
 * en escritorio (DESIGN_SYSTEM §4.1), alineado con el `.gutter`. El contenido de cada vista trae su propia
 * retícula reglada, así que el main no mete padding vertical propio: las secciones
 * se separan con reglas de borde a borde.
 */
export default function StorefrontLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <SkipLink />
      <StorefrontHeader />
      {/* Banner persistente "verifica tu correo" (emailVerified=false). No bloquea la
          navegación; el bloqueo real de acciones sensibles lo hace el backend. */}
      <VerifyEmailBanner />
      <main id="main" className="mx-auto w-full max-w-7xl flex-1">
        {/* Guard cliente: rutas privadas (/vault, /orders, /shipments, /checkout) sin
            sesión → /login?next=… (modo real). Inerte en mock/demo. */}
        <PrivateRouteGuard>{children}</PrivateRouteGuard>
      </main>
      <footer className="border-t border-border">
        <div className="mx-auto max-w-7xl px-5 py-8 sm:px-6 lg:px-8">
          <Footer />
        </div>
      </footer>
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

function Footer() {
  const t = useTranslations('common');
  const tn = useTranslations('nav');
  // Footer legal (§17.3): «TCG HUNT · tcghunt.mx · © 2026 [razón social]» en mono.
  // El dominio va SIEMPRE en minúsculas (§17.4) — se exceptúa del uppercase del bloque.
  // La razón social está abierta con el humano (P-21): placeholder `footer.legalEntity`.
  return (
    <div className="flex flex-col gap-3 font-mono text-[11px] uppercase tracking-label text-muted sm:flex-row sm:items-center sm:justify-between">
      <p>
        {t('brand.name')} · <span className="normal-case">{t('brand.domain')}</span> · © 2026{' '}
        {t('footer.legalEntity')}
      </p>
      <Link href="/terminos" className="text-text hover:text-accent">
        {tn('terms')}
      </Link>
    </div>
  );
}
