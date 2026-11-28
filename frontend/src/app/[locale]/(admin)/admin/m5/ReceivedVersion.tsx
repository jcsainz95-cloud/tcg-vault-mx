'use client';

import { useTranslations } from 'next-intl';
import type { AdminSellItemDTO, BuylistStampDTO, CardLanguage } from '@/types/contract';
import { cn } from '@/lib/cn';

/**
 * §BUYLIST-ES F3 (§4.1) · «Idioma recibido: Inglés | Español» por línea, en la mesa de recepción. Default = lo declarado; si
 * coincide no hay nada que capturar. Un toque, objetivo táctil ≥ 44 px, foco visible, radios 0. ⛔ No calcula dinero: solo
 * elige qué versión se manda a `PATCH …/decision` (`receivedLanguage`); el servidor decide si baja, sube o paga igual.
 */
export interface ReceivedPick {
  language: CardLanguage;
  /**
   * §BUYLIST-ES F4 (§4.1): `null` = normal, número = esa liga; `undefined` = la carta no tiene liga que elegir (la dimensión
   * «Versión» no existe y NO se manda `receivedProductId`, para no convertir una promo/deck_exclusive declarada en «normal»).
   */
  productId?: number | null;
}

/** Ligas que ofrece el selector «Versión»: las de `versions[]` (valoradas al cotizar) y la declarada. Vacío ⇒ sin fila de versión. */
export function stampChoices(item: Pick<AdminSellItemDTO, 'versions' | 'stamp'>): BuylistStampDTO[] {
  const out = new Map<number, BuylistStampDTO>();
  if (item.stamp) out.set(item.stamp.productId, item.stamp);
  for (const v of item.versions ?? []) if (v.stamp) out.set(v.stamp.productId, v.stamp);
  return [...out.values()];
}

export function declaredPick(item: Pick<AdminSellItemDTO, 'language' | 'stamp' | 'versions'>): ReceivedPick {
  return {
    language: item.language === 'es' ? 'es' : 'en',
    ...(stampChoices(item).length > 0 ? { productId: item.stamp?.productId ?? null } : {}),
  };
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
  const tn = useTranslations('sellerFlujo.version.name');
  const declared = declaredPick(item);
  const options: CardLanguage[] = ['en', 'es'];
  const stamps = stampChoices(item);
  const stampOpts: { productId: number | null; label: string }[] = [
    { productId: null, label: tn('normal') },
    ...stamps.map((o) => ({ productId: o.productId, label: o.label || tn('league') })),
  ];
  const differs = pick.language !== declared.language || (pick.productId ?? null) !== (declared.productId ?? null);
  const nameOf = (lang: CardLanguage, productId: number | null | undefined) =>
    stamps.length > 0
      ? `${t(lang)} · ${productId == null ? tn('normal') : (stamps.find((s) => s.productId === productId)?.label ?? tn('league'))}`
      : t(lang);
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
                'flex min-h-[44px] flex-1 flex-col items-center justify-center border border-border-strong px-3 py-1 text-[13px] font-semibold focus-visible:shadow-focus focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50',
                i === 1 && '-ml-px',
                selected ? 'bg-text text-primary-fg' : 'bg-transparent text-text hover:border-text',
              )}
            >
              {t(lang)}
              {declared.language === lang && <span className="text-[11px] font-normal leading-tight opacity-80">{t('declared')}</span>}
            </button>
          );
        })}
      </div>
      {stamps.length > 0 && (
        <>
          <span className="eyebrow mt-1">{t('versionLabel')}</span>
          <div role="group" aria-label={t('versionGroup', { card: item.card.name })} className="flex w-full max-w-[420px] flex-wrap">
            {stampOpts.map((o, i) => {
              const selected = (pick.productId ?? null) === o.productId;
              return (
                <button
                  key={o.productId ?? 'normal'}
                  type="button"
                  aria-pressed={selected}
                  disabled={disabled}
                  data-stamp={o.productId ?? 'normal'}
                  onClick={() => {
                    if (!selected) onChange({ ...pick, productId: o.productId });
                  }}
                  className={cn(
                    'flex min-h-[44px] flex-1 flex-col items-center justify-center border border-border-strong px-3 py-1 text-[13px] font-semibold focus-visible:shadow-focus focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50',
                    i > 0 && '-ml-px',
                    selected ? 'bg-text text-primary-fg' : 'bg-transparent text-text hover:border-text',
                  )}
                >
                  {o.label}
                  {(declared.productId ?? null) === o.productId && <span className="text-[11px] font-normal leading-tight opacity-80">{t('declared')}</span>}
                </button>
              );
            })}
          </div>
        </>
      )}
      {differs && (
        <span className="text-xs leading-[1.5] text-muted" data-testid={`received-version-mismatch-${item.id}`}>
          {t('mismatch', { declared: nameOf(declared.language, declared.productId) })}
        </span>
      )}
    </div>
  );
}
