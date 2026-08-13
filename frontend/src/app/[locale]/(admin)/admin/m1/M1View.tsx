'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { getAdminInventory, getLocations } from '@/lib/api';
import { mockCards } from '@/lib/mock/fixtures';
import type { ProductType, RawCondition, AcquisitionType, InventoryItemDTO } from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents } from '@/lib/format';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Banner } from '@/components/ui/Banner';
import { PhotoUploader } from '@/components/ui/PhotoUploader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { PriceTag } from '@/components/ui/PriceTag';
import { QueryState } from '@/components/ui/QueryState';

const PRODUCT_TYPES: ProductType[] = ['raw', 'graded', 'sealed'];
const CONDITIONS: RawCondition[] = ['NM', 'LP', 'MP', 'HP', 'DMG'];
const ACQ: AcquisitionType[] = ['aportacion_en_especie', 'buylist', 'compra'];

export function M1View() {
  const t = useTranslations('admin.m1');
  const tt = useTranslations('admin.m1.table');
  const tc = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const [open, setOpen] = useState(false);
  const [productType, setProductType] = useState<ProductType>('raw');
  const [acq, setAcq] = useState<AcquisitionType>('aportacion_en_especie');
  const [pct, setPct] = useState('70');

  const inventory = useQuery({ queryKey: ['admin-inventory'], queryFn: getAdminInventory });
  const locations = useQuery({ queryKey: ['locations'], queryFn: getLocations });

  const columns: Column<InventoryItemDTO>[] = [
    { key: 'folio', header: tt('folio'), render: (i) => <span className="tabular">{i.folio}</span> },
    { key: 'card', header: tt('card'), render: (i) => <span lang="en">{i.card.name}</span> },
    { key: 'type', header: tt('type'), render: (i) => i.productType },
    { key: 'location', header: tt('location'), render: (i) => <span className="tabular">{i.location?.label ?? '—'}</span> },
    { key: 'status', header: tt('status'), render: (i) => <StatusBadge domain="inventory" value={i.status} /> },
    {
      key: 'reference',
      header: tt('reference'),
      align: 'right',
      render: (i) =>
        i.referenceValue ? (
          <PriceTag reference={i.referenceValue} mode="reference" />
        ) : (
          '—'
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-h1 font-bold">{t('title')}</h1>
        <Button onClick={() => setOpen(true)}>
          <Plus size={18} /> {t('newItem')}
        </Button>
      </div>

      <QueryState
        isLoading={inventory.isLoading}
        isError={inventory.isError}
        error={inventory.error}
        onRetry={() => inventory.refetch()}
      >
        {inventory.data && (
          <div className="rounded-lg border border-border bg-surface p-2">
            <DataTable columns={columns} rows={inventory.data} rowKey={(i) => i.id} />
          </div>
        )}
      </QueryState>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t('newItemTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {tc('cancel')}
            </Button>
            <Button onClick={() => setOpen(false)}>{t('createItem')}</Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-4">
            <PhotoUploader label={t('photosFront')} hint="Buena luz, carta centrada" />
            <PhotoUploader label={t('photosBack')} hint="Sin reflejos" />
          </div>
          <Select
            label={t('cardName')}
            options={mockCards.map((c) => ({ value: c.id, label: `${c.name} · ${c.setName}` }))}
          />
          <Select
            label={t('productType')}
            options={PRODUCT_TYPES.map((p) => ({ value: p, label: p }))}
            value={productType}
            onChange={(e) => setProductType(e.target.value as ProductType)}
          />
          {productType === 'raw' && (
            <Select label={t('condition')} options={CONDITIONS.map((c) => ({ value: c, label: c }))} />
          )}
          <Select
            label={t('location')}
            options={(locations.data ?? []).map((l) => ({ value: l.id, label: l.label }))}
          />
          <Select
            label={t('acquisitionType')}
            options={ACQ.map((a) => ({ value: a, label: a }))}
            value={acq}
            onChange={(e) => setAcq(e.target.value as AcquisitionType)}
          />
          {acq === 'aportacion_en_especie' && (
            <>
              <Input
                label={t('acquisitionPct')}
                type="number"
                inputMode="numeric"
                value={pct}
                onChange={(e) => setPct(e.target.value)}
              />
              <Banner variant="info">{t('costHint', { pct })}</Banner>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
