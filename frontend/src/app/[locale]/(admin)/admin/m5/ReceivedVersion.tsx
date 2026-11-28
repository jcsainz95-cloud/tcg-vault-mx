'use client';

import { useTranslations } from 'next-intl';
import type { AdminSellItemDTO, CardLanguage } from '@/types/contract';
import { cn } from '@/lib/cn';

/**
 * §BUYLIST-ES F3 (§4.1) · «Idioma recibido: Inglés | Español» por línea, en la mesa de recepción. Default = lo declarado; si
 * coincide no hay nada que capturar. Un toque, objetivo táctil ≥ 44 px, foco visible, radios 0. ⛔ No calcula dinero: solo
 * elige qué versión se manda a `PATCH …/decision` (`receivedLanguage`); el servidor decide si baja, sube o paga igual.
 */
export interface ReceivedPick {
  language: CardLanguage;
}

export function declaredPick(item: Pick<AdminSellItemDTO, 'language'>): ReceivedPick {
  return { language: item.language === 'es' ? 'es' : 'en' };
}

export function ReceivedVersionSelector({
  item,
  pick,
  onChange,
  disabled = false,
}: {
  item: AdminSellItemDTO;
  pick: ReceivedPick;
  onChange: (next: ReceivedPick) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('admin.m5.flow.f2.version');
  const declared = declaredPick(item);
  const options: CardLanguage[] = ['en', 'es'];
  const differs = pick.language !== declared.language;
  return (
    <div className="flex basis-full flex-col gap-1" data-testid={`received-version-${item.id}`}>
      <span className="eyebrow" id={`received-lang-label-${item.id}`}>
        {t('label')}
      </span>
      <div role="group" aria-label={t('group', { card: item.card.name })} className="flex w-full max-w-[320px]">
        {options.map((lang, i) => {
          const selected = pick.language === lang;
          return (
            <button
              key={lang}
              type="button"
              aria-pressed={selected}
              disabled={disabled}
              data-lang={lang}
              onClick={() => {
                if (!selected) onChange({ ...pick, language: lang });
              }}
              className={cn(
                'flex min-h-[44px] flex-1 items-center justify-center gap-1 border border-border-strong px-3 py-1 text-[13px] font-semibold focus-visible:shadow-focus focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50',
                i === 1 && '-ml-px',
                selected ? 'bg-text text-primary-fg' : 'bg-transparent text-text hover:border-text',
              )}
            >
              {t(lang)}
              {declared.language === lang && <span className="text-[11px] font-normal opacity-80">· {t('declared')}</span>}
            </button>
          );
        })}
      </div>
      {differs && (
        <span className="text-xs leading-[1.5] text-muted" data-testid={`received-version-mismatch-${item.id}`}>
          {t('mismatch', { declared: t(declared.language) })}
        </span>
      )}
    </div>
  );
}
