'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
 * WS-F · F2 — Gestor de direcciones de envío (contrato §1, solo MX). Lista + alta + editar + marcar
 * predeterminada + borrar. Reutilizable: en el retiro actúa como PICKER (radio de selección,
 * `selectable`), y en «Mi cuenta» como libreta simple (DESIGN_SYSTEM §33.6c).
 *
 * v1.67 (M-52, §33.10a): la dirección gana **`recipientName`** (nombre de quien recibe — dato de
 * etiqueta, obligatorio al crear), la acción **«Editar»** (`PATCH`) y la marca **«Falta el nombre de
 * quien recibe»** + «Completar» en filas anteriores al cambio. ⛔ El destinatario NUNCA se rellena en
 * silencio con `User.name`: el prellenado lo decide quien monta (`defaultRecipientName`) y solo con
 * `nameSource !== 'derived'`.
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
  /** «Mi cuenta» ya pinta el `h2` de la sección: no se repite el eyebrow interno. */
  hideTitle?: boolean;
  /** Prellenado del destinatario al CREAR (solo si el nombre de cuenta no es derivado). */
  defaultRecipientName?: string;
}

/** `true` si la fila es anterior a M-52 (sin destinatario). Lo usa también el retiro (§33.10b). */
export function addressMissingRecipient(a: Pick<AddressDTO, 'recipientName'>): boolean {
  return a.recipientName == null || a.recipientName.trim() === '';
}

const EMPTY_FORM: AddressInput = {
  recipientName: '',
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

function formFromAddress(a: AddressDTO): AddressInput {
  return {
    recipientName: a.recipientName ?? '',
    line1: a.line1,
    line2: a.line2 ?? '',
    neighborhood: a.neighborhood ?? '',
    city: a.city,
    state: a.state,
    postalCode: a.postalCode,
    country: a.country,
    phone: a.phone,
    isDefault: !!a.isDefault,
  };
}

type EditorState = { mode: 'create' } | { mode: 'edit'; address: AddressDTO; focusRecipient?: boolean };

export function AddressManager({
  selectable,
  selectedId,
  onSelect,
  hideTitle,
  defaultRecipientName,
}: AddressManagerProps) {
  const t = useTranslations('addresses');
  const getMessage = useErrorMessage();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['addresses'], queryFn: listAddresses });
  const [editor, setEditor] = useState<EditorState | null>(null);

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
        {hideTitle ? <span /> : <h3 className="eyebrow">{t('title')}</h3>}
        <Button size="sm" variant="secondary" onClick={() => setEditor({ mode: 'create' })}>
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
                onEdit={() => setEditor({ mode: 'edit', address: a })}
                onComplete={() => setEditor({ mode: 'edit', address: a, focusRecipient: true })}
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
        open={editor !== null}
        address={editor?.mode === 'edit' ? editor.address : undefined}
        focusRecipient={editor?.mode === 'edit' ? editor.focusRecipient : undefined}
        defaultRecipientName={defaultRecipientName}
        onClose={() => setEditor(null)}
        onSaved={(saved) => {
          const created = editor?.mode === 'create';
          setEditor(null);
          invalidate();
          if (selectable && created) onSelect?.(saved.id);
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
  onEdit,
  onComplete,
  onDelete,
  busy,
}: {
  address: AddressDTO;
  selectable?: boolean;
  selected?: boolean;
  onSelect?: (id: string) => void;
  onSetDefault: () => void;
  onEdit: () => void;
  onComplete: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const t = useTranslations('addresses');
  const line = [address.line1, address.line2, address.neighborhood].filter(Boolean).join(', ');
  const cityLine = `${address.city}, ${address.state} ${address.postalCode} · ${address.country}`;
  const missingRecipient = addressMissingRecipient(address);

  const body = (
    <>
      <div className="min-w-0 flex-1">
        {missingRecipient ? (
          <p className="flex flex-wrap items-baseline gap-x-3 font-mono text-[11px] text-accent">
            <span>{t('recipientMissing')}</span>
            <button
              type="button"
              onClick={onComplete}
              disabled={busy}
              className="font-mono text-[11px] text-text underline underline-offset-2 hover:text-accent disabled:opacity-50"
            >
              {t('complete')}
            </button>
          </p>
        ) : (
          <p className="truncate text-sm text-text">{t('recipientLine', { name: address.recipientName ?? '' })}</p>
        )}
        <p className="mt-0.5 truncate text-sm text-text">{line}</p>
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
          onClick={onEdit}
          disabled={busy}
          className="font-mono text-[11px] text-muted hover:text-text disabled:opacity-50"
        >
          {t('edit')}
        </button>
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

/**
 * Estado del formulario de dirección (contrato §1 · `POST` / `PATCH /users/me/addresses`).
 *
 * Se extrae del modal —sin cambiar una sola regla— porque hay DOS presentaciones del mismo
 * formulario y una sola validación: el modal de la libreta y el alta INLINE del paso de crear la
 * solicitud de buylist (DESIGN_SYSTEM §23.3j: «si no tiene ninguna, el formulario de alta inline,
 * y queda en su libreta»). Un segundo camino de alta con su propia validación de CP se desfasaría
 * del primero — que es exactamente lo que el contrato evita al no dejar que `buylist` escriba en
 * la libreta.
 */
export interface AddressFormState {
  form: AddressInput;
  errors: Record<string, string>;
  set: <K extends keyof AddressInput>(key: K, value: AddressInput[K]) => void;
  submit: () => void;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  /** `'edit'` cuando se montó con `address` (el `submit` hace `PATCH`, no `POST`). */
  mode: 'create' | 'edit';
}

export interface AddressFormOptions {
  /** Dirección a EDITAR (modo `PATCH`). Sin ella, alta (`POST`). */
  address?: AddressDTO;
  /** Prellenado del destinatario en alta (nunca en edición). */
  defaultRecipientName?: string;
}

export function useAddressForm(
  onSaved: (saved: AddressDTO) => void,
  options: AddressFormOptions = {},
): AddressFormState {
  const t = useTranslations('addresses');
  const { address, defaultRecipientName } = options;
  const initial = (): AddressInput =>
    address ? formFromAddress(address) : { ...EMPTY_FORM, recipientName: defaultRecipientName ?? '' };
  const [form, setForm] = useState<AddressInput>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Si cambia la dirección que se edita (otro «Editar» sin desmontar), se rehidrata el formulario.
  const addressId = address?.id;
  useEffect(() => {
    setForm(initial());
    setErrors({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addressId]);

  const mut = useMutation({
    mutationFn: (body: AddressInput) =>
      address ? updateAddress(address.id, body) : createAddress(body),
    onSuccess: (saved) => {
      setForm({ ...EMPTY_FORM, recipientName: defaultRecipientName ?? '' });
      setErrors({});
      onSaved(saved);
    },
  });

  function set<K extends keyof AddressInput>(key: K, value: AddressInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!form.recipientName.trim()) e.recipientName = t('required');
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
    // País fijo MX (envío solo nacional): el backend sigue siendo la puerta (422 ADDRESS_NOT_MX).
    mut.mutate({ ...form, recipientName: form.recipientName.trim(), country: 'MX' });
  }

  return {
    form,
    errors,
    set,
    submit,
    isPending: mut.isPending,
    isError: mut.isError,
    error: mut.error,
    mode: address ? 'edit' : 'create',
  };
}

/** Campos del formulario de dirección. La ACCIÓN (guardar) la pone quien lo monta: el modal en su
 *  footer, el alta inline con su propio botón. `focusRecipient`: foco inicial en el destinatario
 *  (acción «Completar» de una fila sin nombre, §33.10a). */
export function AddressFormFields({
  state,
  focusRecipient,
}: {
  state: AddressFormState;
  focusRecipient?: boolean;
}) {
  const t = useTranslations('addresses');
  const getMessage = useErrorMessage();
  const { form, errors, set } = state;
  const recipientRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!focusRecipient) return;
    // Tras el foco inicial del `Modal` (efecto del padre, que corre DESPUÉS de éste): se difiere un tick.
    const id = window.setTimeout(() => recipientRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [focusRecipient]);
  return (
    <div className="flex flex-col gap-4">
      {/* v1.67: el destinatario va PRIMERO, encima de «Calle y número» (§33.10a). */}
      <Input
        ref={recipientRef}
        label={t('recipientName')}
        name="recipientName"
        autoComplete="name"
        value={form.recipientName}
        onChange={(e) => set('recipientName', e.target.value)}
        hint={errors.recipientName ? undefined : t('recipientNameHint')}
        error={errors.recipientName}
        required
      />
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
      {state.isError && (
        <p role="alert" className="font-mono text-xs text-accent">
          {getMessage(state.error)}
        </p>
      )}
    </div>
  );
}

/**
 * Modal de alta/edición. Exportado para que el retiro (§33.10b) pueda ofrecer «Completar» inline
 * sobre la dirección elegida sin duplicar el formulario. Con `address` es edición («Editar
 * dirección», `PATCH`); sin ella, alta («Nueva dirección», `POST`).
 */
export function AddressFormModal({
  open,
  address,
  focusRecipient,
  defaultRecipientName,
  onClose,
  onSaved,
}: {
  open: boolean;
  address?: AddressDTO;
  focusRecipient?: boolean;
  defaultRecipientName?: string;
  onClose: () => void;
  onSaved: (saved: AddressDTO) => void;
}) {
  const t = useTranslations('addresses');
  const state = useAddressForm(onSaved, { address, defaultRecipientName });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={address ? t('editTitle') : t('newTitle')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button variant="primary" loading={state.isPending} onClick={state.submit}>
            {t('save')}
          </Button>
        </>
      }
    >
      <AddressFormFields state={state} focusRecipient={open && focusRecipient} />
    </Modal>
  );
}
