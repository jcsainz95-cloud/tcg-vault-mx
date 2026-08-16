import { useTranslations } from 'next-intl';
import { LocaleToggle } from '@/components/ui/LocaleToggle';
import { Link } from '@/i18n/navigation';

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
        <Link href="/" className="flex items-center gap-3">
          <span aria-hidden className="block h-[22px] w-[22px] shrink-0 bg-accent" />
          <span className="font-serif text-lg font-medium uppercase leading-none tracking-wordmark text-on-ink">
            {t('appName')}
          </span>
        </Link>

        <div className="hidden lg:block">
          <p className="max-w-[420px] font-serif text-[34px] leading-[1.35] text-on-ink">
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
