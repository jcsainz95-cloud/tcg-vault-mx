'use client';

import { useLocale } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { locales, type AppLocale } from '@/i18n/routing';
import { cn } from '@/lib/cn';

/**
 * LocaleToggle (DESIGN_SYSTEM §6.5): cambia el locale de next-intl y persiste vía
 * la ruta [locale]. No traduce datos de catálogo, solo la UI.
 *
 * Dirección 5a: el segmented control con pastilla se convierte en el par
 * tipográfico «ES / EN» del diseño — el activo en tinta, el otro en gris, la barra
 * como separador inerte. Sigue siendo un `group` de botones con aria-pressed.
 *
 * `tone="ink"` invierte los valores para los paneles oscuros (hero de auth): sobre
 * tinta el activo va en papel, si no el locale seleccionado se vuelve invisible.
 */
export function LocaleToggle({ tone = 'paper' }: { tone?: 'paper' | 'ink' } = {}) {
  const active = useLocale() as AppLocale;
  const router = useRouter();
  const pathname = usePathname();

  function switchTo(next: AppLocale) {
    if (next === active) return;
    // Persistencia con sesión: PATCH /users/me { locale } cuando exista backend.
    router.replace(pathname, { locale: next });
  }

  return (
    <div
      role="group"
      aria-label="Idioma / Language"
      className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-label"
    >
      {locales.map((loc, i) => {
        const isActive = loc === active;
        const onInk = tone === 'ink';
        return (
          <span key={loc} className="inline-flex items-center gap-1.5">
            {i > 0 && (
              <span aria-hidden className={onInk ? 'text-on-ink-muted' : 'text-muted'}>
                /
              </span>
            )}
            <button
              type="button"
              aria-pressed={isActive}
              onClick={() => switchTo(loc)}
              className={cn(
                'py-1 transition-colors',
                onInk
                  ? isActive
                    ? 'text-on-ink'
                    : 'text-on-ink-muted hover:text-on-ink'
                  : isActive
                    ? 'text-text'
                    : 'text-muted hover:text-text',
              )}
            >
              {loc}
            </button>
          </span>
        );
      })}
    </div>
  );
}
