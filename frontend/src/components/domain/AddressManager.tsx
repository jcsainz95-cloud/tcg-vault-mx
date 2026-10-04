'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import {
  listAddresses,
  createAddress,
  updateAddress,
  deleteAddress,
  type AddressInput,
} from '@/lib/api';
import type { AddressDTO, AddressIncompleteField, PostalCodeDTO } from '@/types/contract';
import { ApiClientError } from '@/lib/api-client';
import { isMxPhone, isPostalCode, LINE2_MAX, normalizeMxPhone, REFERENCES_MAX } from '@/lib/address-rules';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';
import { EmptyState } from '@/components/ui/EmptyState';
import { PostalCodeNeighborhoodFields } from './PostalCodeNeighborhoodFields';
import { SUPPORT_CONTACT_FALLBACK } from '@/app/[locale]/(storefront)/checkout/support-contact';

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

/**
 * ⭐ v1.81 (§M4-SHIP.19.5): la dirección vieja que el servidor marca `complete: false` (sin colonia, CP
 * que no es de 5 o teléfono que no es de 10) no sirve para un retiro (`422 ADDRESS_INCOMPLETE`). La
 * DECISIÓN es del servidor (`complete`); ⛔ un DTO sin el campo (caché vieja) no se marca.
 */
export function addressIncomplete(a: Pick<AddressDTO, 'complete'>): boolean {
  return a.complete === false;
}

/**
 * Qué le falta, SOLO para nombrarlo y llevar el foco al campo (la decisión de si está completa es
 * `complete`, del servidor). Mismo orden que `missing` de `422 ADDRESS_INCOMPLETE`.
 */
export function addressMissingFields(a: Pick<AddressDTO, 'neighborhood' | 'postalCode' | 'phone'>): AddressIncompleteField[] {
  const out: AddressIncompleteField[] = [];
  if (!a.neighborhood || a.neighborhood.trim() === '') out.push('neighborhood');
  if (!isPostalCode(a.postalCode ?? '')) out.push('postalCode');
  if (!isMxPhone(a.phone ?? '')) out.push('phone');
  return out;
}

/** «a, b y c» — une lo que falta con la conjunción del idioma (sin `Intl.ListFormat`: jsdom/Node varían). */
export function joinMissing(parts: string[], and: string): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} ${and} ${parts[parts.length - 1]}`;
}

/**
 * §43.18 CA-5: **una sola fuente** de palabras para el mismo hueco — la fila de la libreta, el formulario en
 * modo completar y el bloque del retiro dicen lo mismo (`addresses.incomplete.missing.*` + `.and`).
 * Lista vacía ⇒ `''` (quien monta pinta el genérico: ⛔ nunca la marca sin texto, CA-3).
 */
export function useMissingText(): (missing: readonly AddressIncompleteField[]) => string {
  const t = useTranslations('addresses');
  return useCallback(
    (missing) => joinMissing(missing.map((m) => t(`incomplete.missing.${m}`)), t('incomplete.and')),
    [t],
  );
}

/** Campo al que va el foco al abrir el formulario. */
export type AddressFocusField = 'recipientName' | AddressIncompleteField;

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
  references: '',
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
    references: a.references ?? '',
    isDefault: !!a.isDefault,
  };
}

type EditorState =
  | { mode: 'create' }
  | { mode: 'edit'; address: AddressDTO; focusField?: AddressFocusField; completeMissing?: AddressIncompleteField[] };

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
                onComplete={() => setEditor({ mode: 'edit', address: a, focusField: 'recipientName' })}
                onCompleteAddress={() => {
                  const missing = addressMissingFields(a);
                  setEditor({ mode: 'edit', address: a, focusField: missing[0] ?? 'neighborhood', completeMissing: missing });
                }}
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
        focusField={editor?.mode === 'edit' ? editor.focusField : undefined}
        completeMissing={editor?.mode === 'edit' ? editor.completeMissing : undefined}
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
  onCompleteAddress,
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
  onCompleteAddress: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const t = useTranslations('addresses');
  const missingText = useMissingText();
  const lineId = useId();
  const line = [address.line1, address.line2, address.neighborhood].filter(Boolean).join(', ');
  const cityLine = `${address.city}, ${address.state} ${address.postalCode} · ${address.country}`;
  const missingRecipient = addressMissingRecipient(address);
  const incomplete = addressIncomplete(address);
  // §43.18f (CA-3): la marca ⇔ `complete === false` (servidor); el texto nombra lo que falta o es el genérico.
  const rowMissing = incomplete ? missingText(addressMissingFields(address)) : '';

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
        <p id={lineId} className="mt-0.5 truncate text-sm text-text">
          {line}
        </p>
        {incomplete && (
          <p className="mt-1 flex flex-wrap items-baseline gap-x-3 font-mono text-[11px] text-accent" data-testid="address-incomplete">
            <span>{rowMissing ? t('incomplete.rowMissing', { missing: rowMissing }) : t('incomplete.row')}</span>
            {/* §43.18f: objetivo táctil ≥ 24 px (WCAG 2.5.8) y, con varias filas incompletas, dice de cuál es. */}
            <button
              type="button"
              onClick={onCompleteAddress}
              disabled={busy}
              aria-describedby={lineId}
              className="py-1.5 font-mono text-[11px] text-text underline underline-offset-2 hover:text-accent disabled:opacity-50"
            >
              {t('incomplete.cta')}
            </button>
          </p>
        )}
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
  /** ⭐ v1.81: `422 NEIGHBORHOOD_NOT_IN_POSTAL_CODE {allowed}` — la lista del servidor manda sobre la consultada. */
  allowedOverride: string[] | null;
  /** ⭐ v1.81: llegó la lista del CP — colonia reconciliada y municipio/estado canónicos al formulario. */
  resolvePostalCode: (data: PostalCodeDTO, match: string) => void;
  /** `true` si el error del servidor ya se pintó bajo un campo (no se repite abajo). */
  errorOnField: boolean;
}

export interface AddressFormOptions {
  /** Dirección a EDITAR (modo `PATCH`). Sin ella, alta (`POST`). */
  address?: AddressDTO;
  /** Prellenado del destinatario en alta (nunca en edición). */
  defaultRecipientName?: string;
}

/** Campos que un `400 VALIDATION_ERROR {field}` puede señalar y que tienen control en el formulario. */
const FIELD_KEYS = new Set(['recipientName', 'line1', 'line2', 'postalCode', 'neighborhood', 'phone', 'references']);

/**
 * El error del servidor que se pinta BAJO un campo (fase C, §M4-SHIP.19.5). `null` ⇒ va abajo, genérico.
 * ⚠️ El `400` del `ValidationPipe` no trae `details.field` (`BACKEND_NOTES §58.2` punto 2): solo los
 * `400` del servicio (p. ej. `required_with_postal_code`) y los dos `422` de colonia caen aquí.
 */
export function addressServerFieldError(
  error: unknown,
  t: (key: string, values?: Record<string, string>) => string,
  postalCode: string,
): { field: string; message: string; allowed?: string[] } | null {
  if (!(error instanceof ApiClientError)) return null;
  const d = error.details ?? {};
  const cp = typeof d.postalCode === 'string' ? d.postalCode : postalCode;
  if (error.code === 'NEIGHBORHOOD_NOT_IN_POSTAL_CODE') {
    const allowed = Array.isArray(d.allowed) ? d.allowed.filter((x): x is string => typeof x === 'string') : undefined;
    return { field: 'neighborhood', message: t('geo.notInCp', { cp }), allowed };
  }
  if (error.code === 'POSTAL_CODE_UNKNOWN') {
    return { field: 'postalCode', message: t('geo.cpUnknown', { cp, contact: SUPPORT_CONTACT_FALLBACK }) };
  }
  if (error.code === 'VALIDATION_ERROR' && typeof d.field === 'string' && FIELD_KEYS.has(d.field)) {
    if (d.field === 'neighborhood') return { field: 'neighborhood', message: t('geo.neighborhoodRequired') };
    if (d.field === 'postalCode') return { field: 'postalCode', message: t('postalCodeInvalid') };
    if (d.field === 'phone') return { field: 'phone', message: t('phoneInvalid') };
    if (d.field === 'line2') return { field: 'line2', message: t('line2TooLong', { max: String(LINE2_MAX) }) };
    if (d.field === 'references') return { field: 'references', message: t('referencesTooLong', { max: String(REFERENCES_MAX) }) };
    return { field: d.field, message: t('required') };
  }
  return null;
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
  const [allowedOverride, setAllowedOverride] = useState<string[] | null>(null);
  const [errorOnField, setErrorOnField] = useState(false);

  // Si cambia la dirección que se edita (otro «Editar» sin desmontar), se rehidrata el formulario.
  const addressId = address?.id;
  useEffect(() => {
    setForm(initial());
    setErrors({});
    setAllowedOverride(null);
    setErrorOnField(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addressId]);

  const mut = useMutation({
    mutationFn: (body: AddressInput) =>
      address ? updateAddress(address.id, body) : createAddress(body),
    onSuccess: (saved) => {
      setForm({ ...EMPTY_FORM, recipientName: defaultRecipientName ?? '' });
      setErrors({});
      setAllowedOverride(null);
      setErrorOnField(false);
      onSaved(saved);
    },
    onError: (e) => {
      const onField = addressServerFieldError(e, t, form.postalCode);
      setErrorOnField(!!onField);
      if (!onField) return;
      setErrors((prev) => ({ ...prev, [onField.field]: onField.message }));
      if (onField.allowed) setAllowedOverride(onField.allowed);
    },
  });

  function set<K extends keyof AddressInput>(key: K, value: AddressInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    // Tocar el campo retira su error; cambiar el CP retira además la lista del `422` (era de otro CP).
    setErrors((e) => {
      if (!(key in e)) return e;
      const { [key as string]: _drop, ...rest } = e;
      return rest;
    });
    if (key === 'postalCode') setAllowedOverride(null);
  }

  function resolvePostalCode(data: PostalCodeDTO, match: string) {
    // El servidor sobrescribe municipio y estado con los del CP: el formulario manda esos mismos.
    setForm((f) => ({ ...f, neighborhood: match, city: data.municipality, state: data.state }));
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!form.recipientName.trim()) e.recipientName = t('required');
    if (!form.line1.trim()) e.line1 = t('required');
    if ((form.line2 ?? '').trim().length > LINE2_MAX) e.line2 = t('line2TooLong', { max: String(LINE2_MAX) });
    if (!isPostalCode(form.postalCode)) e.postalCode = t('postalCodeInvalid');
    else if (!form.neighborhood.trim()) e.neighborhood = t('geo.neighborhoodRequired');
    if (!isMxPhone(form.phone)) e.phone = t('phoneInvalid');
    if ((form.references ?? '').trim().length > REFERENCES_MAX) {
      e.references = t('referencesTooLong', { max: String(REFERENCES_MAX) });
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function submit() {
    if (!validate()) return;
    const references = (form.references ?? '').trim();
    // País fijo MX (envío solo nacional): el backend sigue siendo la puerta (422 ADDRESS_NOT_MX).
    mut.mutate({
      ...form,
      recipientName: form.recipientName.trim(),
      postalCode: form.postalCode.trim(),
      phone: normalizeMxPhone(form.phone),
      // Alta: vacío ⇒ no se manda. Edición: vacío ⇒ `null` (borra la que hubiera).
      references: references !== '' ? references : address ? null : undefined,
      country: 'MX',
    });
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
    allowedOverride,
    resolvePostalCode,
    errorOnField,
  };
}

/** Campos del formulario de dirección. La ACCIÓN (guardar) la pone quien lo monta: el modal en su
 *  footer, el alta inline con su propio botón. `focusField`: foco inicial (acción «Completar» de una
 *  fila sin nombre, §33.10a, o de una dirección incompleta, v1.81).
 *
 *  ⭐ v1.81 (§M4-SHIP.19.5): CP → colonia de la lista del CP (`Select`, ⛔ sin texto libre) → municipio
 *  y estado mostrados tal como los da el CP (⛔ no son campos); `references` opcional ≤ 70. */
export function AddressFormFields({
  state,
  focusField,
}: {
  state: AddressFormState;
  focusField?: AddressFocusField;
}) {
  const t = useTranslations('addresses');
  const getMessage = useErrorMessage();
  const { form, errors, set } = state;
  const recipientRef = useRef<HTMLInputElement>(null);
  const neighborhoodRef = useRef<HTMLSelectElement>(null);
  const formRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focusField) return;
    // Tras el foco inicial del `Modal` (efecto del padre, que corre DESPUÉS de éste): se difiere un tick.
    const id = window.setTimeout(() => {
      if (focusField === 'recipientName') recipientRef.current?.focus();
      else if (focusField === 'neighborhood' && neighborhoodRef.current && !neighborhoodRef.current.disabled) {
        neighborhoodRef.current.focus();
      } else {
        const target = focusField === 'neighborhood' ? 'postalCode' : focusField;
        formRef.current?.querySelector<HTMLInputElement>(`[data-field="${target}"] input`)?.focus();
      }
    }, 0);
    return () => window.clearTimeout(id);
  }, [focusField]);
  return (
    <div ref={formRef} className="flex flex-col gap-4">
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
      <Input label={t('line2')} value={form.line2 ?? ''} onChange={(e) => set('line2', e.target.value)} error={errors.line2} />
      <div data-field="postalCode" className="flex flex-col gap-4">
        <PostalCodeNeighborhoodFields
          ref={neighborhoodRef}
          postalCode={form.postalCode}
          neighborhood={form.neighborhood}
          onPostalCode={(v) => set('postalCode', v)}
          onNeighborhood={(v) => set('neighborhood', v)}
          onResolved={state.resolvePostalCode}
          postalCodeError={errors.postalCode}
          neighborhoodError={errors.neighborhood}
          allowedOverride={state.allowedOverride}
        />
      </div>
      {/* §43.18b: las referencias acompañan al lugar (van antes que el teléfono, como §43.2b). */}
      <Textarea
        label={t('references')}
        hint={t('referencesHint', { max: String(REFERENCES_MAX) })}
        rows={2}
        counter={{ max: REFERENCES_MAX }}
        value={form.references ?? ''}
        onChange={(e) => set('references', e.target.value)}
        error={errors.references}
      />
      <div data-field="phone">
        <Input
          label={t('phone')}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={form.phone}
          onChange={(e) => set('phone', e.target.value)}
          hint={errors.phone ? undefined : t('phoneHint')}
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
      {state.isError && !state.errorOnField && (
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
  focusField,
  completeMissing,
  defaultRecipientName,
  onClose,
  onSaved,
}: {
  open: boolean;
  address?: AddressDTO;
  focusField?: AddressFocusField;
  /**
   * §43.18g · **modo completar** (fila «Dirección incompleta» y bloque del retiro): título «Completar
   * dirección» y, encima de los campos, qué falta y que lo guardado queda en la libreta. `[]` ⇒ genérico.
   */
  completeMissing?: AddressIncompleteField[];
  defaultRecipientName?: string;
  onClose: () => void;
  onSaved: (saved: AddressDTO) => void;
}) {
  const t = useTranslations('addresses');
  const missingText = useMissingText();
  const state = useAddressForm(onSaved, { address, defaultRecipientName });
  const completing = !!address && completeMissing !== undefined;
  const introMissing = completing ? missingText(completeMissing) : '';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={completing ? t('incomplete.cta') : address ? t('editTitle') : t('newTitle')}
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
      {completing && (
        <p className="mb-4 text-sm text-text" data-testid="address-complete-intro">
          {introMissing ? t('incomplete.formIntro', { missing: introMissing }) : t('incomplete.formIntroGeneric')}
        </p>
      )}
      <AddressFormFields state={state} focusField={open ? focusField : undefined} />
    </Modal>
  );
}
