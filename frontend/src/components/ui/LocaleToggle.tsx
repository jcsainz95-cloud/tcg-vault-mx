'use client';

import { useLocale } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { locales, type AppLocale } from '@/i18n/routing';
import { cn } from '@/lib/cn';

/**
 * LocaleToggle (DESIGN_SYSTEM §6.5): segmented control ES | EN, ancho fijo por
 * segmento. Cambia el locale de next-intl y persiste vía la ruta [locale].
 * No traduce datos de catálogo, solo la UI.
 */
export function LocaleToggle() {
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
      className="inline-flex rounded-full border border-border-strong bg-surface p-0.5"
    >
      {locales.map((loc) => {
        const isActive = loc === active;
        return (
          <button
            key={loc}
            type="button"
            aria-pressed={isActive}
            onClick={() => switchTo(loc)}
            className={cn(
              'w-11 rounded-full px-2 py-1 text-sm font-medium uppercase transition-colors',
              isActive ? 'bg-primary text-primary-fg' : 'text-muted hover:bg-surface-2',
            )}
          >
            {loc}
          </button>
        );
      })}
    </div>
  );
}
