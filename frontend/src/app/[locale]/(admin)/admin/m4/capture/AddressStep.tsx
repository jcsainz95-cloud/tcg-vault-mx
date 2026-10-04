'use client';

import { forwardRef, useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { getPostalCode } from '@/lib/api';
import { asApiError } from '@/lib/api-client';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Banner } from '@/components/ui/Banner';
import { formatDateTimeMx } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { AppLocale } from '@/i18n/routing';
import type { AddressSnapshotDTO, AdminShipmentDTO, CorrectShipmentAddressReq, ShipmentAddressMissingField } from '@/types/contract';

/** Campos del formulario (los seis de `CorrectShipmentAddressReq`, §19.20.1). */
export type AddressField = 'recipientName' | 'line1' | 'line2' | 'postalCode' | 'neighborhood' | 'references';
export const ADDRESS_FIELDS: AddressField[] = ['recipientName', 'line1', 'line2', 'postalCode', 'neighborhood', 'references'];

export interface AddressDraft {
  recipientName: string;
  line1: string;
  line2: string;
  postalCode: string;
  neighborhood: string;
  references: string;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export function draftOf(snap: AddressSnapshotDTO | null | undefined): AddressDraft {
  return {
    recipientName: str(snap?.recipientName),
    line1: str(snap?.line1),
    line2: str(snap?.line2),
    postalCode: str(snap?.postalCode),
    neighborhood: str(snap?.neighborhood),
    references: str(snap?.references),
  };
}

/** Cuerpo del `PUT`: seis campos + la versión que el operador VIO. ⛔ Sin `city`/`state`/`phone`. */
export function correctionBody(draft: AddressDraft, expectedAddressVersion: number): CorrectShipmentAddressReq {
  return {
    expectedAddressVersion,
    recipientName: draft.recipientName,
    line1: draft.line1,
    line2: draft.line2.trim() === '' ? null : draft.line2,
    postalCode: draft.postalCode,
    neighborhood: draft.neighborhood,
    references: draft.references.trim() === '' ? null : draft.references,
  };
}

/** `missing` (§19.5) ⇒ el primer campo del formulario al que va el foco. */
export function firstFieldOf(missing: ShipmentAddressMissingField[]): AddressField {
  for (const f of ['recipientName', 'line1', 'postalCode', 'neighborhood'] as const) if (missing.includes(f)) return f;
  return 'recipientName';
}

export interface AddressFormHandle {
  focusField: (f: AddressField) => void;
}

interface FormProps {
  saved: AddressSnapshotDTO;
  draft: AddressDraft;
  onDraft: (d: AddressDraft) => void;
  fieldErrors: Partial<Record<AddressField, string>>;
  /** `422 NEIGHBORHOOD_NOT_IN_POSTAL_CODE {allowed}`: la lista que manda el servidor manda sobre la consultada. */
  allowedOverride: string[] | null;
  /** Falta la colonia (43.2c): el texto encima del formulario. */
  neighborhoodMissing: boolean;
  formId: string;
}

/**
 * **Paso 1 · modo corregir** (`DESIGN_SYSTEM §43.2b`). Seis controles editables; municipio, estado y
 * teléfono ⛔ no son campos (salen del CP / P-ADR-1). El CP manda: con 5 dígitos se consulta
 * `GET /geo/postal-codes/:cp` (una vez por CP, en caché) y la colonia es un `select` de esa lista.
 */
export const AddressForm = forwardRef<AddressFormHandle, FormProps>(function AddressForm(
  { saved, draft, onDraft, fieldErrors, allowedOverride, neighborhoodMissing, formId },
  ref,
) {
  const t = useTranslations('admin.m4.tracking.sdx.address');
  const noteId = useId();
  const cpReasonId = useId();
  const refs = {
    recipientName: useRef<HTMLInputElement>(null),
    line1: useRef<HTMLInputElement>(null),
    line2: useRef<HTMLInputElement>(null),
    postalCode: useRef<HTMLInputElement>(null),
    neighborhood: useRef<HTMLSelectElement>(null),
    references: useRef<HTMLTextAreaElement>(null),
  };
  useImperativeHandle(ref, () => ({ focusField: (f) => refs[f].current?.focus() }));

  const cp = draft.postalCode;
  const cpComplete = /^\d{5}$/.test(cp);
  const postal = useQuery({
    queryKey: ['postal-code', cp],
    queryFn: () => getPostalCode(cp),
    enabled: cpComplete,
    retry: false,
    staleTime: Infinity,
  });
  const cpUnknown = cpComplete && postal.isError && ['POSTAL_CODE_UNKNOWN', 'NOT_FOUND'].includes(asApiError(postal.error)?.code ?? '');
  const neighborhoods = useMemo(
    () => (!cpComplete ? [] : allowedOverride ?? (postal.data?.postalCode === cp ? postal.data.neighborhoods : [])),
    [cpComplete, allowedOverride, postal.data, cp],
  );

  // La colonia elegida que NO está en la lista del CP nuevo vuelve al placeholder (UX-SDX-23).
  useEffect(() => {
    if (!postal.data || postal.data.postalCode !== cp) return;
    if (draft.neighborhood && !neighborhoods.includes(draft.neighborhood)) onDraft({ ...draft, neighborhood: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postal.data, cp]);

  const city = postal.data && postal.data.postalCode === cp ? postal.data.municipality : str(saved.city);
  const state = postal.data && postal.data.postalCode === cp ? postal.data.state : str(saved.state);
  const set = (k: AddressField) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    onDraft({ ...draft, [k]: e.target.value });

  return (
    <form id={formId} aria-describedby={noteId} className="flex flex-col gap-4" onSubmit={(e) => e.preventDefault()} noValidate>
      <div id={noteId} className="flex flex-col gap-1">
        {neighborhoodMissing && <p className="text-sm text-text">{t('neighborhoodMissing', { cp: str(saved.postalCode) })}</p>}
        <p className="text-sm text-text">{t('scopeNote')}</p>
        <p className="text-sm text-muted">{t('auditNote')}</p>
      </div>
      <Input
        ref={refs.recipientName}
        label={t('field.recipient')}
        type="text"
        autoComplete="off"
        hint={t('hint.recipient')}
        error={fieldErrors.recipientName}
        value={draft.recipientName}
        onChange={set('recipientName')}
      />
      <Input ref={refs.line1} label={t('field.line1')} type="text" error={fieldErrors.line1} value={draft.line1} onChange={set('line1')} />
      <Input ref={refs.line2} label={t('field.line2')} type="text" error={fieldErrors.line2} value={draft.line2} onChange={set('line2')} />
      <Input
        ref={refs.postalCode}
        label={t('field.postalCode')}
        type="text"
        inputMode="numeric"
        maxLength={5}
        autoComplete="off"
        hint={t('hint.postalCode')}
        error={fieldErrors.postalCode ?? (cpUnknown ? t('cpUnknown', { cp }) : undefined)}
        value={draft.postalCode}
        onChange={set('postalCode')}
      />
      <div className="flex flex-col gap-1">
        <Select
          ref={refs.neighborhood}
          label={t('neighborhoodLabel', { cp: cpComplete ? cp : str(saved.postalCode) })}
          placeholder={t('neighborhoodPlaceholder')}
          options={neighborhoods.map((n) => ({ value: n, label: n }))}
          value={neighborhoods.includes(draft.neighborhood) ? draft.neighborhood : ''}
          disabled={!cpComplete}
          aria-describedby={!cpComplete ? cpReasonId : undefined}
          aria-invalid={fieldErrors.neighborhood ? true : undefined}
          onChange={set('neighborhood')}
        />
        {!cpComplete && (
          <p id={cpReasonId} className="font-mono text-xs text-muted">
            {t('cpFirst')}
          </p>
        )}
        {fieldErrors.neighborhood && <p className="font-mono text-xs text-accent">{fieldErrors.neighborhood}</p>}
      </div>
      <Textarea
        ref={refs.references}
        label={t('field.references')}
        hint={t('hint.references')}
        rows={2}
        error={fieldErrors.references}
        value={draft.references}
        onChange={set('references')}
      />
      <p className="text-sm text-text">{t('cityState', { city: city || t('noData'), state: state || t('noData') })}</p>
      <p className="text-sm text-muted">{t('phoneReadOnly', { phone: str(saved.phone) || t('phoneNone') })}</p>
    </form>
  );
});

/** **Paso 1 · modo leer** (`§43.2a`): la `<dl>` del snapshot con cada ausencia nombrada (SK8). */
export function AddressReadView({ shipment }: { shipment: AdminShipmentDTO }) {
  const t = useTranslations('admin.m4.tracking.sdx.address');
  const locale = useLocale() as AppLocale;
  const snap = (shipment.addressSnapshot ?? {}) as AddressSnapshotDTO;
  const v = (k: string) => {
    const x = snap[k];
    return typeof x === 'string' && x.trim() !== '' ? x.trim() : null;
  };
  const corrected = shipment.address?.corrected ?? null;
  const rows: { label: string; value: string | null; none: string; tone: 'accent' | 'muted' | 'text'; tabular?: boolean; omitIfNull?: boolean }[] = [
    { label: t('recipient'), value: v('recipientName'), none: t('recipientMissing'), tone: 'accent' },
    { label: t('line1'), value: v('line1'), none: t('noData'), tone: 'accent' },
    { label: t('line2'), value: v('line2'), none: '', tone: 'text', omitIfNull: true },
    { label: t('neighborhood'), value: v('neighborhood'), none: t('neighborhoodNone'), tone: 'accent' },
    { label: t('postalCode'), value: v('postalCode'), none: t('postalCodeNone'), tone: 'accent', tabular: true },
    { label: t('city'), value: v('city'), none: t('noData'), tone: 'text' },
    { label: t('state'), value: v('state'), none: t('noData'), tone: 'text' },
    { label: t('phone'), value: v('phone'), none: t('phoneNone'), tone: 'accent', tabular: true },
    { label: t('references'), value: v('references'), none: t('referencesNone'), tone: 'muted' },
  ];
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-[minmax(0,10rem)_1fr] gap-x-3 gap-y-1" data-testid="sdx-address-dl">
        {rows
          .filter((r) => !(r.omitIfNull && r.value === null))
          .map((r) => (
            <div key={r.label} className="contents">
              <dt className="text-sm text-muted">{r.label}</dt>
              <dd className={cn('text-sm', r.value === null ? (r.tone === 'accent' ? 'text-accent' : r.tone === 'muted' ? 'text-muted' : 'text-text') : 'text-text', r.tabular && 'tabular')}>
                {r.value ?? r.none}
              </dd>
            </div>
          ))}
      </dl>
      {corrected && (
        <p className="text-sm text-text" data-testid="sdx-address-corrected">
          {t('corrected', { name: corrected.by.name?.trim() || t('unnamed'), datetime: formatDateTimeMx(corrected.at, locale) })}
        </p>
      )}
    </div>
  );
}

/** Banner del teléfono que no se corrige aquí (P-ADR-1). */
export function PhoneMissingBanner() {
  const t = useTranslations('admin.m4.tracking.sdx');
  return (
    <Banner variant="warning" role="status">
      {t('error.phone')}
    </Banner>
  );
}
