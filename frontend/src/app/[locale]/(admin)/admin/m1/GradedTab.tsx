'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { getGradedInventory, overridePrice } from '@/lib/api';
import type { GradedInventoryGroupDTO } from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents } from '@/lib/format';
import { useRole } from '@/lib/role';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';

/**
 * Pestaña «Gradeadas» — P-20 (DESIGN_SYSTEM §16.9). Lista agregada por (carta, empresa, grado).
 * El valor de mercado por grado es MANUAL en este stream (decisión v1.28): «Fijar valor…» llama
 * al override de mercado EXISTENTE (POST /admin/pricing/override, productType:"graded"). Solo
 * super_admin fija valores; vault_operator ve `SIN VALOR` honesto. El drill-down por grupo lo
 * abre el padre (VariantDrawer con productType=graded, certs visibles).
 */
export interface GradedTabProps {
  onOpenGroup: (group: GradedInventoryGroupDTO) => void;
  onAddGraded: () => void;
  onToast?: (msg: string) => void;
}

export function GradedTab({ onOpenGroup, onAddGraded, onToast }: GradedTabProps) {
  const t = useTranslations('admin.inventory.gradedTab');
  const locale = useLocale() as AppLocale;
  const { isSuperAdmin } = useRole();
  const errorMessage = useErrorMessage();
  const [q, setQ] = useState('');
  // Mini-form inline «Fijar valor…» (uno a la vez).
  const [fixingKey, setFixingKey] = useState<string | null>(null);
  const [fixInput, setFixInput] = useState('');

  const groups = useQuery({
    queryKey: ['graded-inventory', q],
    queryFn: () => getGradedInventory({ q: q.trim() || undefined }),
  });

  const keyOf = (g: GradedInventoryGroupDTO) => `${g.cardId}|${g.gradingCompany}|${g.gradeValue}`;

  const fixValue = useMutation({
    mutationFn: (g: GradedInventoryGroupDTO) =>
      overridePrice({
        cardId: g.cardId,
        productType: 'graded',
        gradeKey: `graded:${g.gradingCompany}:${g.gradeValue}`,
        priceMxnCents: Math.round(Number(fixInput) * 100),
      }),
    onSuccess: () => {
      setFixingKey(null);
      setFixInput('');
      onToast?.(t('valueFixed'));
      void groups.refetch();
    },
  });

  const columns: Column<GradedInventoryGroupDTO>[] = [
    {
      key: 'card',
      header: t('colCard'),
      render: (g) => (
        <button type="button" className="flex items-center gap-3 text-left hover:text-accent" onClick={() => onOpenGroup(g)}>
          {g.card.imageSmallUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={g.card.imageSmallUrl} alt="" aria-hidden loading="lazy" className="h-12 w-auto bg-surface-2 object-contain" />
          )}
          <span className="flex min-w-0 flex-col">
            <span lang="en" className="font-medium">
              {g.card.name}
            </span>
            <span className="font-mono text-xs text-muted">
              <span lang="en">{g.card.setName}</span> · <span className="tabular">#{g.card.number}</span>
            </span>
          </span>
        </button>
      ),
    },
    {
      key: 'grade',
      header: t('colGrade'),
      render: (g) => (
        // Estilo GradedCertChip de grado (accent §7.2c) — SIN cert (el cert es de la pieza).
        <span className="border border-accent px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-[0.06em] text-accent">
          {g.gradingCompany} {g.gradeValue}
        </span>
      ),
    },
    { key: 'count', header: t('colPieces'), align: 'right', render: (g) => <span className="tabular">{g.count}</span> },
    {
      key: 'value',
      header: t('colValue'),
      align: 'right',
      render: (g) => {
        const key = keyOf(g);
        if (fixingKey === key) {
          return (
            <span className="flex items-end justify-end gap-2">
              <Input
                label={t('fixValueLabel')}
                hint={t('fixValueHelper')}
                prefix="MX$"
                inputMode="decimal"
                className="w-28"
                value={fixInput}
                onChange={(e) => setFixInput(e.target.value)}
              />
              <Button
                size="sm"
                variant="secondary"
                loading={fixValue.isPending}
                disabled={fixValue.isPending || !(Number(fixInput) > 0)}
                onClick={() => fixValue.mutate(g)}
              >
                {t('fixValueSave')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setFixingKey(null)}>
                {t('fixValueCancel')}
              </Button>
            </span>
          );
        }
        return (
          <span className="flex items-baseline justify-end gap-2">
            {g.marketReferenceMxnCents != null ? (
              <span className="font-mono tabular-nums" title={t('manualValueTitle')}>
                {formatMoneyCents(g.marketReferenceMxnCents, locale)}
                <span className="font-medium"> ·M</span>
              </span>
            ) : (
              <span className="border border-accent px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] text-accent">
                {t('noValue')}
              </span>
            )}
            {isSuperAdmin && (
              <button
                type="button"
                className="border-b border-accent pb-0.5 text-xs text-accent hover:text-text"
                onClick={() => {
                  setFixingKey(key);
                  setFixInput(
                    g.marketReferenceMxnCents != null ? String(g.marketReferenceMxnCents / 100) : '',
                  );
                }}
              >
                {t('fixValue')}
              </button>
            )}
          </span>
        );
      },
    },
    ...(isSuperAdmin
      ? [
          {
            key: 'cost',
            header: t('colCost'),
            align: 'right' as const,
            render: (g: GradedInventoryGroupDTO) => (
              <span className="font-mono tabular-nums">
                {g.totalCostCents != null ? formatMoneyCents(g.totalCostCents, locale) : '—'}
              </span>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Input
          label={t('search')}
          className="w-64"
          placeholder={t('searchPlaceholder')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Button variant="secondary" onClick={onAddGraded}>
          <Plus size={18} /> {t('addGraded')}
        </Button>
      </div>
      {fixValue.isError && (
        <Banner variant="danger" role="alert">
          {errorMessage(fixValue.error)}
        </Banner>
      )}
      <QueryState
        isLoading={groups.isLoading}
        isError={groups.isError}
        error={groups.error}
        onRetry={() => groups.refetch()}
      >
        {groups.data &&
          (groups.data.data.length === 0 ? (
            <EmptyState
              title={t('emptyTitle')}
              body={t('emptyBody')}
              action={
                <Button variant="secondary" onClick={onAddGraded}>
                  {t('addGraded')}
                </Button>
              }
            />
          ) : (
            <DataTable columns={columns} rows={groups.data.data} rowKey={keyOf} />
          ))}
      </QueryState>
    </div>
  );
}
