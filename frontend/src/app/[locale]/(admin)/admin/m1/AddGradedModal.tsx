'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Search } from 'lucide-react';
import { createInventoryItem, searchBuylistCards } from '@/lib/api';
import type { GradingCompany } from '@/types/contract';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { useErrorMessage } from '@/components/ui/QueryState';

const GRADING_COMPANIES: GradingCompany[] = ['PSA', 'CGC'];

/**
 * «Agregar gradeada» — P-20 (DESIGN_SYSTEM §16.9): formulario corto (empresa + grado +
 * certificado + precio de compra) → UN POST /admin/inventory/items (qty 1 forzado: cada slab es
 * único por certNumber). Lanzable desde la pestaña Gradeadas o desde el drill-down del Master Set
 * (con la carta ya fijada). Resultado con folio (patrón §16.5b).
 */
export interface AddGradedModalProps {
  open: boolean;
  onClose: () => void;
  /** Carta prefijada (desde la teja del Master Set); ausente = picker mínimo por búsqueda. */
  card?: { id: string; name: string } | null;
  onCreated?: () => void;
}

export function AddGradedModal({ open, onClose, card, onCreated }: AddGradedModalProps) {
  const t = useTranslations('admin.inventory.addGraded');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();

  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);
  const [company, setCompany] = useState<GradingCompany>('PSA');
  const [grade, setGrade] = useState('10');
  const [cert, setCert] = useState('');
  const [price, setPrice] = useState('');

  const target = card ?? picked;

  const results = useQuery({
    queryKey: ['graded-card-search', search],
    queryFn: () => searchBuylistCards({ q: search, pageSize: 20 }),
    enabled: !card && search.trim() !== '',
  });

  const create = useMutation({
    mutationFn: () =>
      createInventoryItem({
        cardId: target!.id,
        productType: 'graded',
        gradingCompany: company,
        gradeValue: grade,
        certNumber: cert.trim(),
        acquisitionType: 'compra',
        acquisitionCostCents: price.trim() !== '' ? Math.round(Number(price) * 100) : undefined,
      }),
    onSuccess: () => onCreated?.(),
  });

  const certMissing = cert.trim() === '';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('title')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button
            onClick={() => create.mutate()}
            disabled={!target || certMissing || create.isPending}
            loading={create.isPending}
          >
            {t('cta')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {create.isSuccess && create.data && (
          <Banner variant="success" role="status">
            {t('success', { folio: create.data.folio })}
          </Banner>
        )}
        {create.isError && (
          <Banner variant="danger" role="alert">
            {errorMessage(create.error)}
          </Banner>
        )}

        {card ? (
          <p className="text-sm">
            {t('cardLabel')}: <span lang="en" className="font-semibold">{card.name}</span>
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex items-end gap-2">
              <Input
                label={t('searchCard')}
                className="flex-1"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    setSearch(query.trim());
                  }
                }}
              />
              <Button variant="secondary" onClick={() => setSearch(query.trim())} aria-label={tc('search')}>
                <Search size={18} /> {tc('search')}
              </Button>
            </div>
            {picked && (
              <p className="text-sm">
                {t('cardLabel')}: <span lang="en" className="font-semibold">{picked.name}</span>
              </p>
            )}
            {results.data && (
              <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto" role="listbox" aria-label={t('searchCard')}>
                {results.data.data.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={picked?.id === c.id}
                      className={`w-full border px-3 py-2 text-left text-sm ${
                        picked?.id === c.id ? 'border-border-strong bg-surface-2' : 'border-border hover:bg-surface-2'
                      }`}
                      onClick={() => setPicked({ id: c.id, name: c.name })}
                    >
                      <span lang="en">{c.name}</span>
                      <span className="ml-2 font-mono text-xs text-muted">#{c.number}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <Select
          label={t('company')}
          options={GRADING_COMPANIES.map((g) => ({ value: g, label: g }))}
          value={company}
          onChange={(e) => setCompany(e.target.value as GradingCompany)}
        />
        <Input label={t('grade')} inputMode="decimal" value={grade} onChange={(e) => setGrade(e.target.value)} />
        <Input
          label={t('cert')}
          inputMode="numeric"
          value={cert}
          onChange={(e) => setCert(e.target.value)}
          error={certMissing && (create.isError || create.isPending) ? t('certRequired') : undefined}
          hint={t('certHint')}
        />
        <Input
          label={t('price')}
          prefix="MX$"
          inputMode="decimal"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
      </div>
    </Modal>
  );
}
