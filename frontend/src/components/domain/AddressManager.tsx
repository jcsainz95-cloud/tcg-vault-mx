'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import {
  listAddresses,
  createAddress,
  updateAddress,
  deleteAddress,
  type AddressInput,
} from '@/lib/api';
import type { AddressDTO } from '@/types/contract';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';
import { EmptyState } from '@/components/ui/EmptyState';

/**
 * WS-F · F2 — Gestor de direcciones de envío (contrato §1, solo MX). Lista + alta + marcar
 * predeterminada + borrar. Reutilizable: en el retiro actúa como PICKER (radio de selección,
 * `selectable`), y puede montarse en una sección de cuenta como libreta simple.
 *
 * País fijo a MX (envío solo nacional en el MVP): el formulario no ofrece cambiarlo, así se
 * evita el `422 ADDRESS_NOT_MX` del backend en el camino feliz (que sigue existiendo como
 * guardarraíl server-side y se muestra con gracia si ocurriera).
 */
export interface AddressManagerProps {
  /** Si true, cada dirección es seleccionable (radio) para elegir destino del retiro. */
  selectable?: boolean;
  selectedId?: string;
  onSelect?: (id: string) => void;
}

const EMPTY_FORM: AddressInput = {
  line1: '',
  line2: '',
  neighborhood: '',
  city: '',
  state: '',
  postalCode: '',
  country: 'MX',
  phone: '',
  isDefault: false,
};

export function AddressManager({ selectable, selectedId, onSelect }: AddressManagerProps) {
  const t = useTranslations('addresses');
  const getMessage = useErrorMessage();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['addresses'], queryFn: listAddresses });
  const [formOpen, setFormOpen] = useState(false);

  const addresses = useMemo(() => query.data ?? [], [query.data]);

  // Auto-selección de la predeterminada (o la primera) cuando el padre no fijó selección.
  useEffect(() => {
    if (!selectable || !onSelect || selectedId || addresses.length === 0) return;
    const def = addresses.find((a) => a.isDefault) ?? addresses[0];
    onSelect(def.id);
  }, [selectable, onSelect, selectedId, addresses]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['addresses'] });

  const setDefaultMut = useMutation({
    mutationFn: (id: string) => updateAddress(id, { isDefault: true }),
    onSuccess: invalidate,
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteAddress(id),
    onSuccess: invalidate,
  });

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="eyebrow">{t('title')}</h3>
        <Button size="sm" variant="secondary" onClick={() => setFormOpen(true)}>
          {t('add')}
        </Button>
      </div>

      <QueryState
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        onRetry={() => query.refetch()}
      >
        {addresses.length === 0 ? (
          <EmptyState title={t('emptyTitle')} body={t('emptyBody')} />
        ) : (
          <ul>
            {addresses.map((a) => (
              <AddressRow
                key={a.id}
                address={a}
                selectable={selectable}
                selected={selectedId === a.id}
                onSelect={onSelect}
                onSetDefault={() => setDefaultMut.mutate(a.id)}
                onDelete={() => deleteMut.mutate(a.id)}
                busy={setDefaultMut.isPending || deleteMut.isPending}
              />
            ))}
          </ul>
        )}
        {(setDefaultMut.isError || deleteMut.isError) && (
          <p role="alert" className="mt-3 font-mono text-xs text-accent">
            {getMessage(setDefaultMut.error ?? deleteMut.error)}
          </p>
        )}
      </QueryState>

      <AddressFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onCreated={(created) => {
          setFormOpen(false);
          invalidate();
          if (selectable) onSelect?.(created.id);
        }}
      />
    </div>
  );
}

function AddressRow({
  address,
  selectable,
  selected,
  onSelect,
  onSetDefault,
  onDelete,
  busy,
}: {
  address: AddressDTO;
  selectable?: boolean;
  selected?: boolean;
  onSelect?: (id: string) => void;
  onSetDefault: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const t = useTranslations('addresses');
  const line = [address.line1, address.line2, address.neighborhood].filter(Boolean).join(', ');
  const cityLine = `${address.city}, ${address.state} ${address.postalCode} · ${address.country}`;

  const body = (
    <>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-text">{line}</p>
        <p className="tabular mt-1 font-mono text-[11px] text-muted">{cityLine}</p>
        <p className="tabular mt-0.5 font-mono text-[11px] text-muted">{address.phone}</p>
        {address.isDefault && (
          <span className="mt-1 inline-block font-mono text-[10px] uppercase tracking-label text-success">
            {t('default')}
          </span>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2">
        {!address.isDefault && (
          <button
            type="button"
            onClick={onSetDefault}
            disabled={busy}
            className="font-mono text-[11px] text-muted hover:text-text disabled:opacity-50"
          >
            {t('setDefault')}
          </button>
        )}
        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          className="font-mono text-[11px] text-muted hover:text-accent disabled:opacity-50"
        >
          {t('delete')}
        </button>
      </div>
    </>
  );

  if (selectable) {
    return (
      <li>
        <label className="flex cursor-pointer items-start gap-4 border-t border-border py-4 last:border-b">
          <input
            type="radio"
            name="shipping-address"
            checked={!!selected}
            onChange={() => onSelect?.(address.id)}
            aria-label={line}
            className="mt-1 h-4 w-4 shrink-0 cursor-pointer appearance-none rounded-full border border-border-strong checked:border-[5px] checked:border-text"
          />
          {body}
        </label>
      </li>
    );
  }

  return <li className="flex items-start gap-4 border-t border-border py-4 last:border-b">{body}</li>;
}

function AddressFormModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (created: AddressDTO) => void;
}) {
  const t = useTranslations('addresses');
  const getMessage = useErrorMessage();
  const [form, setForm] = useState<AddressInput>(EMPTY_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const mut = useMutation({
    mutationFn: (body: AddressInput) => createAddress(body),
    onSuccess: (created) => {
      setForm(EMPTY_FORM);
      setErrors({});
      onCreated(created);
    },
  });

  function set<K extends keyof AddressInput>(key: K, value: AddressInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!form.line1.trim()) e.line1 = t('required');
    if (!form.city.trim()) e.city = t('required');
    if (!form.state.trim()) e.state = t('required');
    if (form.postalCode.trim().length < 3) e.postalCode = t('postalCodeInvalid');
    if (form.phone.trim().length < 7) e.phone = t('phoneInvalid');
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function submit() {
    if (!validate()) return;
    mut.mutate({ ...form, country: 'MX' });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('newTitle')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button variant="primary" loading={mut.isPending} onClick={submit}>
            {t('save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input label={t('line1')} value={form.line1} onChange={(e) => set('line1', e.target.value)} error={errors.line1} />
        <Input label={t('line2')} value={form.line2 ?? ''} onChange={(e) => set('line2', e.target.value)} />
        <Input
          label={t('neighborhood')}
          value={form.neighborhood ?? ''}
          onChange={(e) => set('neighborhood', e.target.value)}
        />
        <div className="grid grid-cols-2 gap-4">
          <Input label={t('city')} value={form.city} onChange={(e) => set('city', e.target.value)} error={errors.city} />
          <Input label={t('state')} value={form.state} onChange={(e) => set('state', e.target.value)} error={errors.state} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Input
            label={t('postalCode')}
            inputMode="numeric"
            value={form.postalCode}
            onChange={(e) => set('postalCode', e.target.value)}
            error={errors.postalCode}
          />
          <Input
            label={t('phone')}
            inputMode="tel"
            value={form.phone}
            onChange={(e) => set('phone', e.target.value)}
            error={errors.phone}
          />
        </div>
        {/* País fijo MX (envío solo nacional en el MVP). */}
        <div className="flex flex-col">
          <span className="eyebrow">{t('country')}</span>
          <p className="mt-3 border-b border-border-strong pb-3 text-base text-text">{t('countryMx')}</p>
        </div>
        <label className="flex items-center gap-3 text-sm text-text">
          <input
            type="checkbox"
            checked={!!form.isDefault}
            onChange={(e) => set('isDefault', e.target.checked)}
            className="h-4 w-4 shrink-0 cursor-pointer appearance-none border border-border-strong checked:border-text checked:bg-text"
          />
          {t('makeDefault')}
        </label>
        {mut.isError && (
          <p role="alert" className="font-mono text-xs text-accent">
            {getMessage(mut.error)}
          </p>
        )}
      </div>
    </Modal>
  );
}
