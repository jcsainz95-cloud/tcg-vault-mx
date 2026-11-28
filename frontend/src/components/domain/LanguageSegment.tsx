'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { AppLocale } from '@/i18n/routing';
import type { BuylistLanguageOffersDTO, CardLanguage } from '@/types/contract';
import { formatMoneyCents } from '@/lib/format';
import { cn } from '@/lib/cn';

/**
 * §BUYLIST-ES §5 · segmento «Inglés | Español» por carta. Cada opción muestra SU monto (el que mandó el servidor en
 * `offers`) y cambiar de opción NO pide red: solo elige cuál de las dos cifras mostrar. ⛔ No calcula dinero.
 * Es un grupo de botones `aria-pressed` (no un menú): un toque, objetivo táctil ≥ 44 px, foco visible, radios 0.
 * Una opción sin oferta (`null`) queda apagada y dice «Sin oferta» (nunca MX$0).
 */
export function LanguageSegment({
  name,
  language,
  offers,
  onChange,
  disabled = false,
  testId = 'language-segment',
}: {
  /** Nombre de la carta, para la etiqueta accesible del grupo. */
  name: string;
  language: CardLanguage;
  offers: BuylistLanguageOffersDTO | undefined;
  onChange: (language: CardLanguage) => void;
  disabled?: boolean;
  testId?: string;
}) {
  const t = useTranslations('buylist.lang');
  const locale = useLocale() as AppLocale;
  const options: CardLanguage[] = ['en', 'es'];
  return (
    <div role="group" aria-label={t('groupLabel', { name })} data-testid={testId} className="mt-2 flex w-full">
      {options.map((lang, i) => {
        const cents = offers?.[lang] ?? null;
        const selected = language === lang;
        // La opción elegida nunca se apaga (aunque no traiga oferta): el vendedor ve dónde está.
        const off = disabled || (!selected && cents == null);
        return (
          <button
            key={lang}
            type="button"
            aria-pressed={selected}
            disabled={off}
            data-lang={lang}
            onClick={() => {
              if (!selected) onChange(lang);
            }}
            className={cn(
              'flex min-h-[44px] flex-1 flex-col items-center justify-center border border-border-strong px-2 py-1 text-center focus-visible:shadow-focus focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50',
              i === 1 && '-ml-px',
              selected ? 'bg-text text-primary-fg' : 'bg-transparent text-text hover:border-text',
            )}
          >
            <span className="text-[13px] font-semibold leading-tight">{t(lang)}</span>
            <span className="tabular font-mono text-[11px] leading-tight">
              {cents != null ? formatMoneyCents(cents, locale) : t('noOffer')}
            </span>
          </button>
        );
      })}
    </div>
  );
}
