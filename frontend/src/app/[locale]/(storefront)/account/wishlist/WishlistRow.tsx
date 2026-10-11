'use client';

import { forwardRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Info } from 'lucide-react';
import { updateWishlistItem } from '@/lib/api';
import { asApiError } from '@/lib/api-client';
import { formatDate, formatMoneyCents } from '@/lib/format';
import { Link } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';
import type { WishlistItemDTO, WishlistMaxPct } from '@/types/contract';
import { CardImage } from '@/components/ui/CardImage';
import { CardCode } from '@/components/domain/CardCode';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { IvaLabel } from '@/components/ui/IvaLabel';

/**
 * El renglón de un deseo (DESIGN_SYSTEM §WSH-UX.4 · `WishlistItemDTO`, API_CONTRACT §WSH.4).
 *
 * ⛔ **WSH-2 · una cifra, una fuente.** «Hoy» = `maxToday.maxDisplayCents`; «desde» = `availableNow.fromDisplayCents`;
 * **«cabe / arriba» = `availableNow.fits`** (v1.87.1, Q-WSH-UX-3: lo calcula el servidor). La comparación temporal del
 * diseño (WSH-UX.4 c) queda retirada: este fichero no compara pesos (candado `wishlist-wsh-locks.test.ts`).
 */
export const WishlistRow = forwardRef<
  HTMLElement,
  {
    item: WishlistItemDTO;
    ivaRatePct: number;
    onPatched: (dto: WishlistItemDTO) => void;
    onGone: (id: string) => void;
    onRemove: (item: WishlistItemDTO) => void;
    removing: boolean;
  }
>(function WishlistRow({ item, ivaRatePct, onPatched, onGone, onRemove, removing }, ref) {
  const t = useTranslations('wishlist');
  const tFinish = useTranslations('finish');
  const locale = useLocale() as AppLocale;
  const [pct, setPct] = useState<WishlistMaxPct>(item.maxPct);
  const [saved, setSaved] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [failed, setFailed] = useState(false);

  // ⛔ El `select` no guarda al cambiar (con teclado, cada flecha sería un PATCH): solo «Guardar» (WSH-UX-6).
  const patch = useMutation({
    mutationFn: () => updateWishlistItem(item.id, pct),
    onMutate: () => {
      setSaved(false);
      setFailed(false);
    },
    onSuccess: (dto) => {
      onPatched(dto);
      setPct(dto.maxPct);
      setSaved(true);
    },
    onError: (e) => {
      const err = asApiError(e);
      if (err?.status === 404 && err.code !== 'FEATURE_DISABLED') onGone(item.id);
      else setFailed(true);
    },
  });

  const finishLabel = tFinish(item.finish);
  const helpId = `wishlist-approx-${item.id}`;
  const fits = item.availableNow?.fits;

  return (
    <article
      ref={ref}
      tabIndex={-1}
      data-testid="wishlist-row"
      aria-labelledby={`wishlist-row-${item.id}`}
      className="flex gap-4 border-b border-border py-5 outline-none focus-visible:shadow-focus"
    >
      <CardImage src={item.card.imageSmallUrl} alt="" className="w-12 shrink-0 sm:w-14" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <h3 id={`wishlist-row-${item.id}`} lang="en" className="text-[15px] font-medium text-text">
            {item.card.name}
          </h3>
          <Button
            variant="ghost"
            size="sm"
            loading={removing}
            onClick={() => onRemove(item)}
            aria-label={t('row.removeLabel', { card: item.card.name, finish: finishLabel })}
          >
            {t('row.remove')}
          </Button>
        </div>
        <p className="mt-1 font-mono text-[12px] text-muted">
          <span lang="en">{item.card.setName}</span> · <CardCode code={null} number={item.card.number} /> · {finishLabel}{' '}
          · {t('row.condition')}
        </p>

        <p className="mt-3 text-sm text-text">{t('row.maxPct', { pct: item.maxPct })}</p>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="sm:w-48">
            <Select
              label={t('row.pctLabel')}
              options={([5, 10, 16] as const).map((p) => ({ value: String(p), label: t('row.pctOption', { pct: p }) }))}
              value={String(pct)}
              onChange={(e) => {
                setPct(Number(e.target.value) as WishlistMaxPct);
                setSaved(false);
              }}
            />
          </div>
          {pct !== item.maxPct && (
            <Button variant="secondary" size="sm" loading={patch.isPending} onClick={() => patch.mutate()}>
              {t('row.save')}
            </Button>
          )}
        </div>
        {saved && (
          <p role="status" className="mt-2 font-mono text-[11px] uppercase tracking-label text-success">
            {t('saved')}
          </p>
        )}
        {failed && (
          <p role="alert" className="mt-2 text-sm text-accent">
            {t('error.generic')}
          </p>
        )}

        <div className="mt-3">
          {item.maxToday.status === 'priced' ? (
            <p className="flex flex-wrap items-center gap-x-2">
              <span className="tabular text-[15px] text-text">
                {t('row.today', { amount: formatMoneyCents(item.maxToday.maxDisplayCents, locale) })}
              </span>
              <IvaLabel ivaIncluded ivaRatePct={ivaRatePct} />
              <span aria-hidden className="text-muted">
                ·
              </span>
              <span className="font-mono text-[11px] text-muted">{t('approx')}</span>
              <button
                type="button"
                aria-label={t('approxHelpLabel')}
                aria-expanded={helpOpen}
                aria-controls={helpId}
                onClick={() => setHelpOpen((v) => !v)}
                className="inline-flex h-11 w-11 items-center justify-center text-muted hover:text-text focus-visible:shadow-focus"
              >
                <Info size={16} aria-hidden />
              </button>
            </p>
          ) : (
            <p className="text-sm text-muted">{t('noMarket')}</p>
          )}
          {helpOpen && (
            <p id={helpId} className="mt-1 text-xs text-muted">
              {t('approxHelp')}
            </p>
          )}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          {item.availableNow == null ? (
            <span className="text-sm text-muted">{t('row.notYet')}</span>
          ) : (
            <>
              <span className="tabular text-sm text-text">
                {t('row.available', {
                  count: item.availableNow.count,
                  amount: formatMoneyCents(item.availableNow.fromDisplayCents, locale),
                })}
              </span>
              {fits === true && <Badge tone="success">{t('row.fits')}</Badge>}
              {fits === false && <Badge tone="neutral">{t('row.above')}</Badge>}
              <Link
                href={`/catalog/${item.card.id}`}
                className="border-b border-text pb-0.5 text-sm text-text hover:border-accent hover:text-accent"
              >
                {t('row.seeCard')} →
              </Link>
            </>
          )}
        </div>

        <p className="mt-2 text-xs text-muted">
          {item.lastNotifiedAt
            ? t('row.lastNotified', { date: formatDate(item.lastNotifiedAt, locale) })
            : t('row.neverNotified')}
        </p>
      </div>
    </article>
  );
});
