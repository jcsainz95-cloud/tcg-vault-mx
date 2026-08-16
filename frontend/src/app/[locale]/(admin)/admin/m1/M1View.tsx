'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { getAdminInventory, getLocations } from '@/lib/api';
import { mockCards } from '@/lib/mock/fixtures';
import type {
  ProductType,
  SealedSubtype,
  GradingCompany,
  AcquisitionType,
  Finish,
  InventoryItemDTO,
} from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { FinishBadge } from '@/components/domain/FinishBadge';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Banner } from '@/components/ui/Banner';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { PriceTag } from '@/components/ui/PriceTag';
import { QueryState } from '@/components/ui/QueryState';

const PRODUCT_TYPES: ProductType[] = ['raw', 'graded', 'sealed'];
const SEALED_SUBTYPES: SealedSubtype[] = ['box', 'etb', 'bundle', 'tin', 'blister'];
const GRADING_COMPANIES: GradingCompany[] = ['PSA', 'CGC'];
const ACQ: AcquisitionType[] = ['aportacion_en_especie', 'buylist', 'compra'];
// v1.6-finish: orden de despliegue del acabado; la etiqueta legible viene de i18n `finish`.
const FINISH_ORDER: Finish[] = ['normal', 'reverse_holo', 'holofoil', 'first_edition_holofoil'];

export function M1View() {
  const t = useTranslations('admin.m1');
  const tt = useTranslations('admin.m1.table');
  const tSub = useTranslations('status.sealedSubtype');
  const tFinish = useTranslations('finish');
  const tc = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const [open, setOpen] = useState(false);
  const [cardId, setCardId] = useState<string>(mockCards[0]?.id ?? '');
  const [productType, setProductType] = useState<ProductType>('raw');
  // v1.6-finish: acabado de la copia física; se valida contra card.availableFinishes al alta.
  const [finish, setFinish] = useState<Finish>('normal');
  const [sealedSubtype, setSealedSubtype] = useState<SealedSubtype>('box');
  const [gradingCompany, setGradingCompany] = useState<GradingCompany>('PSA');
  const [gradeValue, setGradeValue] = useState('10');
  const [certNumber, setCertNumber] = useState('');
  const [listPrice, setListPrice] = useState('');
  const [acq, setAcq] = useState<AcquisitionType>('aportacion_en_especie');
  const [pct, setPct] = useState('70');

  // Gradeada: certNumber es obligatorio para publicar (contrato §M1, v1.2).
  const gradedCertMissing = productType === 'graded' && certNumber.trim() === '';

  // v1.6-finish: acabados disponibles de la carta elegida (solo raw/singles; graded/sealed = normal).
  const selectedCard = mockCards.find((c) => c.id === cardId);
  const availableFinishes: Finish[] = selectedCard
    ? FINISH_ORDER.filter((f) => selectedCard.availableFinishes.includes(f))
    : ['normal'];
  const showFinishSelect = productType === 'raw' && availableFinishes.length > 1;

  const inventory = useQuery({ queryKey: ['admin-inventory'], queryFn: getAdminInventory });
  const locations = useQuery({ queryKey: ['locations'], queryFn: getLocations });

  const columns: Column<InventoryItemDTO>[] = [
    { key: 'folio', header: tt('folio'), render: (i) => <span className="tabular">{i.folio}</span> },
    { key: 'card', header: tt('card'), render: (i) => <span lang="en">{i.card.name}</span> },
    { key: 'type', header: tt('type'), render: (i) => i.productType },
    {
      key: 'finish',
      header: tt('finish'),
      render: (i) => (i.finish ? <FinishBadge finish={i.finish} productType={i.productType} /> : '—'),
    },
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
            <Button onClick={() => setOpen(false)} disabled={gradedCertMissing}>
              {t('createItem')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {/* v1.2: alta SIN foto propia; la imagen es la de catálogo remota de pokemontcg.io */}
          <Banner variant="info">{t('noPhotoNotice')}</Banner>
          <Select
            label={t('cardName')}
            options={mockCards.map((c) => ({ value: c.id, label: `${c.name} · ${c.setName}` }))}
            value={cardId}
            onChange={(e) => {
              setCardId(e.target.value);
              // Reinicia el acabado al primero disponible de la nueva carta (normal va primero).
              const card = mockCards.find((c) => c.id === e.target.value);
              setFinish(FINISH_ORDER.find((f) => card?.availableFinishes.includes(f)) ?? 'normal');
            }}
          />
          <Select
            label={t('productType')}
            options={PRODUCT_TYPES.map((p) => ({ value: p, label: p }))}
            value={productType}
            onChange={(e) => setProductType(e.target.value as ProductType)}
          />
          {productType === 'raw' && (
            // Raw solo NM (v1.1): sin selector de grados; condición fija.
            <p className="rounded-md bg-success-bg px-3 py-2 text-sm text-success">{t('conditionNm')}</p>
          )}
          {/* v1.6-finish: acabado de la copia física, poblado de card.availableFinishes.
              graded/sellado son siempre normal → se muestra la nota fija en su lugar. */}
          {showFinishSelect ? (
            <Select
              label={t('finish')}
              options={availableFinishes.map((f) => ({ value: f, label: tFinish(f) }))}
              value={finish}
              onChange={(e) => setFinish(e.target.value as Finish)}
            />
          ) : (
            productType !== 'raw' && (
              <p className="rounded-md bg-surface-2/60 px-3 py-2 text-sm text-muted">
                {t('finishFixedNormal')}
              </p>
            )
          )}
          {productType === 'graded' && (
            // Gradeada (v1.2): empresa + grado + certNumber (requerido para publicar).
            <>
              <Select
                label={t('gradingCompany')}
                options={GRADING_COMPANIES.map((g) => ({ value: g, label: g }))}
                value={gradingCompany}
                onChange={(e) => setGradingCompany(e.target.value as GradingCompany)}
              />
              <Input
                label={t('gradeValue')}
                type="text"
                inputMode="decimal"
                value={gradeValue}
                onChange={(e) => setGradeValue(e.target.value)}
              />
              <Input
                label={t('certNumberRequired')}
                type="text"
                inputMode="numeric"
                required
                value={certNumber}
                onChange={(e) => setCertNumber(e.target.value)}
                error={gradedCertMissing ? t('certNumberError') : undefined}
              />
            </>
          )}
          {productType === 'sealed' && (
            // Sellado: subtipo + precio manual MXN obligatorio para publicar (§3.6).
            <>
              <Select
                label={t('sealedSubtype')}
                options={SEALED_SUBTYPES.map((s) => ({ value: s, label: tSub(s) }))}
                value={sealedSubtype}
                onChange={(e) => setSealedSubtype(e.target.value as SealedSubtype)}
              />
              <Input
                label={t('listPriceRequired')}
                type="text"
                inputMode="decimal"
                prefix="MX$"
                required
                value={listPrice}
                onChange={(e) => setListPrice(e.target.value)}
              />
            </>
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
