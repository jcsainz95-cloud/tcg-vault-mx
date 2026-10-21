import { useTranslations } from 'next-intl';
import { StorefrontHeader } from '@/components/layout/StorefrontHeader';
import { VerifyEmailBanner } from '@/components/domain/VerifyEmailBanner';
import { PrivateRouteGuard } from '@/components/layout/PrivateRouteGuard';
import { Link } from '@/i18n/navigation';
import { PrivacyNoticeLink } from '@/components/legal/PrivacyNoticeLink';
import { resolveLegalEntity } from './footer';
import { ConsentBannerSlot } from '@/components/consent/ConsentBanner';
import { CookiePreferencesLink } from '@/components/consent/CookiePreferencesLink';

/*
 * Dirección 5a: el ancho de lectura es 1280px (max-w-7xl) y el margen crece a 32px
 * en escritorio (DESIGN_SYSTEM §4.1), alineado con el `.gutter`. El contenido de cada vista trae su propia
 * retícula reglada, así que el main no mete padding vertical propio: las secciones
 * se separan con reglas de borde a borde.
 */
export default function StorefrontLayout({ children }: { children: React.ReactNode }) {
  return (
    // MKT2-UX.5: mientras el banner de cookies siga sin respuesta, su alto (`--consent-banner-h`, 0
    // sin banner) se reserva abajo para que el pie no quede tapado.
    <div className="flex min-h-dvh flex-col pb-[var(--consent-banner-h,0px)]">
      <SkipLink />
      {/* MKT2-UX.3: el banner va en el DOM justo tras el skip-link (visualmente, abajo). Con el
          modo `off` o fuera de la lista blanca de medición no se monta. */}
      <ConsentBannerSlot />
      <StorefrontHeader />
      {/* Banner persistente "verifica tu correo" (emailVerified=false). No bloquea la
          navegación; el bloqueo real de acciones sensibles lo hace el backend. */}
      <VerifyEmailBanner />
      <main id="main" className="mx-auto w-full max-w-7xl flex-1">
        {/* Guard cliente: rutas privadas (/vault, /orders, /shipments, /checkout) sin
            sesión → /login?next=… (modo real). Inerte en mock/demo. */}
        <PrivateRouteGuard>{children}</PrivateRouteGuard>
      </main>
      {/* Makeover 1a: footer mono de UNA línea, py 26px como el artboard. */}
      <footer className="border-t border-border">
        <div className="gutter mx-auto max-w-7xl py-[26px]">
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
  const ts = useTranslations('seo');
  // Footer legal (§17.3): «TCG HUNT · tcghunt.mx · © {año} [razón social]» en mono.
  // El dominio va SIEMPRE en minúsculas (§17.4) — se exceptúa del uppercase del bloque.
  // La razón social está abierta con el humano (P-21): `footer.legalEntity` data-driven.
  // Si aún no hay razón social, se omite (degradación con gracia): queda «TCG HUNT ·
  // tcghunt.mx · © {año}», coherente y sin placeholder colgando.
  // D7: el año es dinámico (§20.10 «© {año}»), no un literal que caduque.
  const legalEntity = resolveLegalEntity(t('footer.legalEntity'));
  return (
    <div className="flex flex-col gap-3 font-mono text-[11px] uppercase tracking-label text-muted sm:flex-row sm:items-center sm:justify-between">
      <p>
        {t('brand.name')} · <span className="normal-case">{t('brand.domain')}</span> ·{' '}
        {`© ${new Date().getFullYear()}`}
        {legalEntity ? ` ${legalEntity}` : ''}
      </p>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {/* §MKT tienda §E4/§E6: páginas de contenido (guías enlazadas desde el pie, v1 §2.5). */}
        <Link href="/como-funciona" className="text-text hover:text-accent">
          {ts('nav.howItWorks')}
        </Link>
        <Link href="/preguntas" className="text-text hover:text-accent">
          {ts('nav.faq')}
        </Link>
        <Link href="/guias" className="text-text hover:text-accent">
          {ts('nav.guides')}
        </Link>
        <Link href="/terminos" className="text-text hover:text-accent">
          {tn('terms')}
        </Link>
        {/* LIVE-8 · sitio 1 (DESIGN_SYSTEM §80, variante `nav`): solo cuando /privacidad se sirve
            (sin marcadores en producción); la decisión viene del layout de [locale]. */}
        <PrivacyNoticeLink variant="nav" className="text-text hover:text-accent" />
        {/* MKT2-UX.8 sitio 1: junto al aviso, mismas clases. Con el modo `off` no existe. */}
        <CookiePreferencesLink variant="nav" className="text-text hover:text-accent" />
      </div>
    </div>
  );
}
