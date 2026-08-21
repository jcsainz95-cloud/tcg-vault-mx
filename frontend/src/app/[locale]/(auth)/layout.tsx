import { useTranslations } from 'next-intl';
import { LocaleToggle } from '@/components/ui/LocaleToggle';
import { Link } from '@/i18n/navigation';
import { LogoTcgHunt } from '@/components/domain/LogoTcgHunt';

/**
 * 6g — El formulario deja de ser una tarjeta flotante sobre un fondo vacío.
 * Media pantalla de tinta con la promesa de bóveda en mincho, media de papel con
 * el formulario. En móvil el panel de tinta se reduce a la cabecera de marca.
 *
 * El LocaleToggle se pinta UNA sola vez y cambia de sitio con la dirección del
 * flex (a la derecha de la marca en móvil, al pie en escritorio). Duplicarlo por
 * breakpoint dejaba dos grupos "Idioma / Language" en el DOM aunque uno estuviera
 * oculto, y cualquier consulta por rol encontraba dos botones "en".
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations('common');
  const tv = useTranslations('vault');

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_620px]">
      <aside className="flex items-center justify-between gap-6 bg-ink p-6 lg:flex-col lg:items-stretch lg:justify-between lg:gap-10 lg:p-11">
        {/* Marca sobre tinta (§17.3 v1.7.1): solo-mira variante oscura 28px (mínimo —
            por debajo los gaps no leen) + wordmark en papel (--font-brand). El
            degradado claro está PROHIBIDO sobre tinta (§17.2). */}
        <Link href="/" aria-label={t('brand.homeAria')} className="flex items-center gap-3">
          <LogoTcgHunt variant="mark-dark" size={28} decorative />
          <span className="font-brand text-[17px] font-bold uppercase leading-none tracking-[0.04em] text-on-ink">
            {t('brand.name')}
          </span>
        </Link>

        <div className="hidden lg:block">
          {/* Hero de auth (§17.3): el lockup completo en variante oscura — la primera
              pantalla donde el degradado del rebrand "se estrena". */}
          <LogoTcgHunt variant="lockup-dark" className="w-full max-w-[340px]" />
          <p className="mt-10 max-w-[420px] font-serif text-[34px] leading-[1.35] text-on-ink">
            {tv('trustBanner')}
          </p>
          <p className="mt-7 font-mono text-[11px] uppercase leading-none tracking-eyebrow text-on-ink-muted">
            {t('tagline')} · MXN
          </p>
        </div>

        <div className="shrink-0">
          <LocaleToggle tone="ink" />
        </div>
      </aside>

      <main className="flex flex-col justify-center px-6 py-14 sm:px-10 lg:px-[72px] lg:py-20">
        {children}
      </main>
    </div>
  );
}
