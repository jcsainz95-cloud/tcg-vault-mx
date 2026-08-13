'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { getAdminDisputes } from '@/lib/api';
import { useRole } from '@/lib/role';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { QueryState } from '@/components/ui/QueryState';
import type { DisputeDTO } from '@/types/contract';

function PhotoColumn({ title, urls }: { title: string; urls?: string[] }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-semibold">{title}</p>
      <div className="grid grid-cols-2 gap-2">
        {(urls ?? []).map((u, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={i} src={u} alt={title} className="aspect-[5/7] w-full rounded-md border border-border object-contain" />
        ))}
      </div>
    </div>
  );
}

export function M8View() {
  const t = useTranslations('admin.m8');
  const tm = useTranslations('admin');
  const { isSuperAdmin } = useRole();
  const query = useQuery({ queryKey: ['admin-disputes'], queryFn: getAdminDisputes });
  const [selected, setSelected] = useState<DisputeDTO | null>(null);
  const active = selected ?? query.data?.[0] ?? null;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-h1 font-bold">{t('title')}</h1>

      <QueryState
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        onRetry={() => query.refetch()}
      >
        <div className="grid gap-6 lg:grid-cols-[280px,1fr]">
          <div className="flex flex-col gap-2">
            {(query.data ?? []).map((d) => (
              <button
                key={d.id}
                onClick={() => setSelected(d)}
                className={
                  active?.id === d.id
                    ? 'rounded-lg border border-primary bg-surface-2 p-3 text-left'
                    : 'rounded-lg border border-border bg-surface p-3 text-left hover:bg-surface-2'
                }
              >
                <div className="flex items-center justify-between">
                  <span className="tabular text-sm font-medium">{d.id}</span>
                  <StatusBadge domain="dispute" value={d.status} />
                </div>
                <p className="mt-1 text-xs text-muted" lang="en">
                  {d.item?.card.name} · {d.item?.folio}
                </p>
              </button>
            ))}
          </div>

          {active && (
            <div className="flex flex-col gap-5 rounded-lg border border-border bg-surface p-5">
              <h2 className="text-h3 font-semibold">{t('compareTitle')}</h2>
              <p className="text-sm text-muted">{active.description}</p>
              <div className="grid gap-6 sm:grid-cols-2">
                <PhotoColumn title={t('ingressPhotos')} urls={active.ingressPhotoUrls} />
                <PhotoColumn title={t('claimPhotos')} urls={active.claimPhotoUrls} />
              </div>
              <div className="flex flex-wrap gap-3">
                <Button
                  variant="accent"
                  disabled={!isSuperAdmin}
                  title={!isSuperAdmin ? tm('masked') : undefined}
                >
                  {t('resolveRepurchase')}
                </Button>
                <Button variant="secondary">{t('resolveReject')}</Button>
              </div>
              <p className="text-xs text-muted">{tm('moneyOutNote')}</p>
            </div>
          )}
        </div>
      </QueryState>
    </div>
  );
}
