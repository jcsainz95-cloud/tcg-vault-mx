'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';
import { getSettings, listAdminAccessories, updateSettings } from '@/lib/api';
import { useErrorMessage } from '@/components/ui/QueryState';
import { useRole } from '@/lib/role';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { formatMoneyCents } from '@/lib/format';
import { ACCESSORY_CATEGORIES, type AccessoryCategory, type AdminAccessoryDTO } from '@/types/contract';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { AccessoryPhoto } from '@/components/domain/accessories/AccessoryPhoto';
import { centsToPesosInput, pesosInputToCents } from './money-input';

type StatusFilter = '' | 'published' | 'unpublished';

/**
 * Lista del panel de accesorios (`API_CONTRACT §AC.11`, `DESIGN_SYSTEM §AC-UX.9a/.11`). Lo que impide publicar
 * (SIN FOTO, SIN PRECIO) va en bermellón con texto; los estados en versalitas con texto (§2.4).
 */
export function AccessoriesAdminView() {
  const t = useTranslations('admin.accessories');
  const ta = useTranslations('accessories');
  const locale = useLocale() as AppLocale;
  const { isSuperAdmin } = useRole();
  const [category, setCategory] = useState<AccessoryCategory | ''>('');
  const [qInput, setQInput] = useState('');
  const q = useDebouncedValue(qInput.trim(), 300);
  const [status, setStatus] = useState<StatusFilter>('');
  const [soldOut, setSoldOut] = useState(false);
  const [page, setPage] = useState(1);

  const params = {
    category: category || undefined,
    q: q || undefined,
    active: status === '' ? undefined : status === 'published',
    soldOut: soldOut || undefined,
    page,
  };
  const query = useQuery({ queryKey: ['admin-accessories', params], queryFn: () => listAdminAccessories(params) });
  const filtered = !!(category || q || status || soldOut);
  const items = query.data?.items ?? [];
  const energyPrices = new Set(items.filter((a) => a.category === 'energy' && a.priceCents !== null).map((a) => a.priceCents));
  const totalPages = Math.max(1, Math.ceil((query.data?.total ?? 0) / (query.data?.pageSize ?? 24)));

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-h1 font-semibold text-text">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted">{t('subtitle')}</p>
        </div>
        <Link
          href="/admin/accessories/new"
          className="inline-flex min-h-[44px] items-center bg-primary px-5 text-[11px] font-medium uppercase tracking-label text-primary-fg hover:bg-primary-hover"
        >
          {t('new')}
        </Link>
      </header>

      {isSuperAdmin && <AccessorySettingsBlock />}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Select
          label={t('filters.category')}
          value={category}
          onChange={(e) => {
            setCategory(e.target.value as AccessoryCategory | '');
            setPage(1);
          }}
          options={[{ value: '', label: t('filters.allCategories') }, ...ACCESSORY_CATEGORIES.map((c) => ({ value: c, label: ta(`category.${c}`) }))]}
        />
        <Input label={t('filters.search')} value={qInput} maxLength={60} onChange={(e) => setQInput(e.target.value)} />
        <Select
          label={t('filters.status')}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as StatusFilter);
            setPage(1);
          }}
          options={[
            { value: '', label: t('filters.statusAll') },
            { value: 'published', label: t('filters.statusPublished') },
            { value: 'unpublished', label: t('filters.statusUnpublished') },
          ]}
        />
        <label className="flex min-h-[44px] items-center gap-3 self-end text-sm text-text">
          <input
            type="checkbox"
            checked={soldOut}
            onChange={(e) => {
              setSoldOut(e.target.checked);
              setPage(1);
            }}
          />
          {t('filters.soldOutOnly')}
        </label>
      </div>

      {energyPrices.size > 1 && <p className="text-sm text-muted">{t('energyPricesDiffer')}</p>}

      {query.isLoading ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : query.isError ? (
        <Banner
          variant="danger"
          role="alert"
          action={
            <Button variant="secondary" size="sm" onClick={() => query.refetch()}>
              {t('retry')}
            </Button>
          }
        >
          {t('loadError')}
        </Banner>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-start gap-3 border-y border-border py-10">
          <p className="text-sm text-text">{t('emptyFiltered')}</p>
          {filtered && (
            <Button
              variant="ghost"
              onClick={() => {
                setCategory('');
                setQInput('');
                setStatus('');
                setSoldOut(false);
                setPage(1);
              }}
            >
              {t('clearFilters')}
            </Button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-y border-border text-left">
                {(['photo', 'name', 'category', 'price', 'stock', 'status', 'suggested'] as const).map((c) => (
                  <th key={c} scope="col" className="eyebrow py-2 pr-4 font-medium">
                    {t(`cols.${c}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <AdminRow key={a.id} a={a} locale={locale} />
              ))}
            </tbody>
          </table>
          {totalPages > 1 && (
            <div className="mt-4 flex items-center gap-3">
              <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                ←
              </Button>
              <span className="tabular font-mono text-xs text-muted">
                {page} / {totalPages}
              </span>
              <Button variant="ghost" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                →
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const TAG = 'font-mono text-[11px] uppercase tracking-label';

function AdminRow({ a, locale }: { a: AdminAccessoryDTO; locale: AppLocale }) {
  const t = useTranslations('admin.accessories');
  const ta = useTranslations('accessories');
  const status = !a.active ? 'unpublished' : a.availableQty <= 0 ? 'soldOut' : 'published';
  return (
    <tr data-testid={`admin-accessory-${a.id}`} className="border-b border-border align-top">
      <td className="py-3 pr-4">
        {a.photo ? (
          <AccessoryPhoto src={a.photo.thumbUrl} alt="" fallbackText={a.name} className="h-12 w-12" />
        ) : (
          <div className="flex h-12 w-12 items-center justify-center border border-dashed border-border">
            <span className="font-mono text-[10px] text-accent">{t('noPhoto')}</span>
          </div>
        )}
      </td>
      <td className="py-3 pr-4">
        <Link href={`/admin/accessories/${a.id}`} className="text-text underline underline-offset-4 hover:text-accent">
          {a.name}
        </Link>
      </td>
      <td className="py-3 pr-4 text-text">
        {a.category === 'energy' && a.energyType ? t('categoryEnergy', { type: ta(`energyType.${a.energyType}`) }) : ta(`category.${a.category}`)}
      </td>
      <td className="tabular py-3 pr-4 font-mono">
        {a.priceCents === null ? <span className="text-accent">{t('noPrice')}</span> : formatMoneyCents(a.priceCents, locale)}
      </td>
      <td className="py-3 pr-4">
        <span className="tabular text-text">{a.stockQty}</span>
        {a.reservedQty > 0 && (
          <span className="block text-xs text-muted">{t('stockSub', { reserved: a.reservedQty, available: a.availableQty })}</span>
        )}
      </td>
      <td className="py-3 pr-4">
        <span className={`${TAG} ${status === 'published' ? 'text-success' : status === 'soldOut' ? 'text-accent' : 'text-muted'}`}>
          {t(`status.${status}`)}
        </span>
      </td>
      <td className="py-3 pr-4">{a.suggested && <span className={`${TAG} text-muted`}>{t('suggested')}</span>}</td>
    </tr>
  );
}

/**
 * ★ §AC-UX.11 — diales `energy_bundle_price_cents` y `accessory_suggestion_count` en `PUT /admin/settings`. Plegado
 * por defecto. El precio de cada energía suelta se edita en su ficha (es el precio de ese producto, §AC.2 (3)).
 */
function AccessorySettingsBlock() {
  const t = useTranslations('admin.accessories.settings');
  const getError = useErrorMessage('operator');
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['admin-settings'], queryFn: getSettings });
  const [price, setPrice] = useState('');
  const [count, setCount] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!settings.data || loaded) return;
    setPrice(centsToPesosInput(settings.data.energyBundlePriceCents ?? null));
    setCount(settings.data.accessorySuggestionCount === undefined ? '' : String(settings.data.accessorySuggestionCount));
    setLoaded(true);
  }, [settings.data, loaded]);
  const priceCents = pesosInputToCents(price);
  const countN = count.trim() === '' ? null : Number(count);
  const priceBad = priceCents === null || Number.isNaN(priceCents) || priceCents < 1 || priceCents > 100_000;
  const countBad = countN === null || !Number.isInteger(countN) || countN < 0 || countN > 6;
  const save = useMutation({
    mutationFn: () => updateSettings({ energyBundlePriceCents: priceCents!, accessorySuggestionCount: countN! }),
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: ['admin-settings'] });
    },
    onError: (e) => setError(getError(e)),
  });
  return (
    <details className="border-y border-border py-3">
      <summary className="cursor-pointer list-none">
        <h2 className="inline text-h3 font-semibold text-text">{t('title')}</h2>
      </summary>
      <div className="mt-4 grid max-w-xl gap-4">
        <Input
          label={t('bundlePrice')}
          prefix="$"
          inputMode="decimal"
          value={price}
          hint={t('bundlePriceHelp')}
          error={price && priceBad ? t('bundlePriceRange') : undefined}
          onChange={(e) => setPrice(e.target.value)}
        />
        <Input
          label={t('suggestionCount')}
          inputMode="numeric"
          value={count}
          hint={t('suggestionCountHelp')}
          error={count && countBad ? t('countRange') : undefined}
          onChange={(e) => setCount(e.target.value)}
        />
        <Button className="self-start" disabled={priceBad || countBad} loading={save.isPending} onClick={() => save.mutate()}>
          {t('save')}
        </Button>
        {save.isSuccess && (
          <Banner variant="success" role="status">
            {t('saved')}
          </Banner>
        )}
        {error && (
          <Banner variant="danger" role="alert">
            {error}
          </Banner>
        )}
      </div>
    </details>
  );
}
