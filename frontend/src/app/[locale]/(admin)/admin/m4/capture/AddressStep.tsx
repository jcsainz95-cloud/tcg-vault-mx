'use client';

import { forwardRef, useId, useImperativeHandle, useRef } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useNeighborhoodMode } from '@/hooks/useNeighborhoodMode';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Banner } from '@/components/ui/Banner';
import { formatDateTimeMx } from '@/lib/format';
import { mxStateOptions } from '@/lib/mx-states';
import { cn } from '@/lib/cn';
import type { AppLocale } from '@/i18n/routing';
import type { AddressSnapshotDTO, AdminShipmentDTO, CorrectShipmentAddressReq, ShipmentAddressMissingField } from '@/types/contract';

/**
 * Campos del formulario: los de `CorrectShipmentAddressReq` (§19.20.1) y, desde v1.80.12.5 (§M4-SHIP.19.25.1,
 * C-4), `city`/`state`: siempre viajan; el servidor solo los escribe con el CP fuera del catálogo.
 */
export type AddressField = 'recipientName' | 'line1' | 'line2' | 'postalCode' | 'neighborhood' | 'city' | 'state' | 'references';
export const ADDRESS_FIELDS: AddressField[] = ['recipientName', 'line1', 'line2', 'postalCode', 'neighborhood', 'city', 'state', 'references'];

export interface AddressDraft {
  recipientName: string;
  line1: string;
  line2: string;
  postalCode: string;
  neighborhood: string;
  city: string;
  state: string;
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
    city: str(snap?.city),
    state: str(snap?.state),
    references: str(snap?.references),
  };
}

/**
 * Cuerpo del `PUT` + la versión que el operador VIO. v1.80.12.5 (§M4-SHIP.19.25.1): gana `city`/`state`
 * (obligatorios 1..120; con el CP en el catálogo el servidor pone los del CP). ⛔ Sin `phone` (P-ADR-1) ni
 * `country`.
 */
export function correctionBody(draft: AddressDraft, expectedAddressVersion: number): CorrectShipmentAddressReq {
  return {
    expectedAddressVersion,
    recipientName: draft.recipientName,
    line1: draft.line1,
    line2: draft.line2.trim() === '' ? null : draft.line2,
    postalCode: draft.postalCode,
    neighborhood: draft.neighborhood,
    city: draft.city,
    state: draft.state,
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
  /** Parche FUNCIONAL sobre el borrador: el CP manda colonia, municipio y estado en el mismo pase. */
  onPatch: (patch: Partial<AddressDraft>) => void;
  fieldErrors: Partial<Record<AddressField, string>>;
  /** Falta la colonia (43.2c): el texto encima del formulario. */
  neighborhoodMissing: boolean;
  formId: string;
  /**
   * 💰 rev BSD-1 (DESIGN_SYSTEM §BSD-UX.5a) — **modo entrada**: el snapshot es el ORIGEN (el vendedor). «Destinatario» pasa a
   * «Quién envía», la frase de alcance cambia y, con el campo vacío, se SUGIERE el nombre de la cuenta (`sellerName`).
   * ⛔ BX7: «Usar este nombre» solo RELLENA el campo y le da el foco; se guarda con «Guardar dirección» (0 `PUT` antes).
   */
  inbound?: { sellerName: string } | null;
}

/**
 * **Paso 1 · modo corregir** (`DESIGN_SYSTEM §43.2b` + §43.18m.6). El CP manda: con 5 dígitos se consulta
 * `GET /geo/postal-codes/:cp` y la colonia es un `select` de esa lista **o escrita a mano** («La colonia no
 * está en la lista»); con el CP fuera del catálogo, colonia, municipio y estado son campos (C-4). El teléfono
 * ⛔ no es campo (P-ADR-1).
 *
 * FC-25 (parte 1, CA-9): al abrir con una colonia guardada que NO está en la lista del CP guardado, el
 * formulario abre con ella **a mano** — antes, `onResolved` la cambiaba por `''` al llegar la lista y un
 * «Guardar dirección» sin tocar la borraba. La regla vive en `useNeighborhoodMode` (la misma del cliente).
 */
export const AddressForm = forwardRef<AddressFormHandle, FormProps>(function AddressForm(
  { saved, draft, onPatch, fieldErrors, neighborhoodMissing, formId, inbound },
  ref,
) {
  const t = useTranslations('admin.m4.tracking.sdx.address');
  const ti = useTranslations('admin.m4.tracking.sdx.inbound');
  const suggestionId = useId();
  const recipientId = useId();
  const tg = useTranslations('addresses.geo');
  const tc = useTranslations('common');
  const noteId = useId();
  const cpReasonId = useId();
  const hintId = useId();
  const introId = useId();
  const stateId = useId();
  const refs = {
    recipientName: useRef<HTMLInputElement>(null),
    line1: useRef<HTMLInputElement>(null),
    line2: useRef<HTMLInputElement>(null),
    postalCode: useRef<HTMLInputElement>(null),
    city: useRef<HTMLInputElement>(null),
    state: useRef<HTMLSelectElement>(null),
    references: useRef<HTMLTextAreaElement>(null),
  };

  const cp = draft.postalCode;
  // El CP manda (§43.2b) y la colonia ayuda, no bloquea (§43.18m): UN cuerpo con la libreta y el invitado.
  const geo = useNeighborhoodMode({
    postalCode: cp,
    neighborhood: draft.neighborhood,
    onNeighborhood: (neighborhood) => onPatch({ neighborhood }),
    onCityState: (city, state) => onPatch({ city, state }),
  });
  useImperativeHandle(ref, () => ({
    focusField: (f) => (f === 'neighborhood' ? geo.control()?.focus() : refs[f].current?.focus()),
  }));
  const { lookup, mode, neighborhoods } = geo;
  const cpComplete = lookup.cpComplete;
  const manual = mode === 'manualNeighborhood' || mode === 'manualAll';
  const set = (k: AddressField) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    onPatch({ [k]: e.target.value });

  const reason = mode !== 'pending' ? null : !cpComplete ? t('cpFirst') : lookup.loading ? t('loadingNeighborhoods', { cp }) : null;
  // C-4: el CP fuera del catálogo YA NO es un error del CP (se guarda con lo escrito); es un aviso.
  const intro = mode === 'manualAll' ? (geo.manualAllChosen ? tg('manualAllIntro') : t('cpUnknown', { cp })) : null;
  const describedBy = [reason ? cpReasonId : null, intro ? introId : null, manual ? hintId : null].filter(Boolean).join(' ') || undefined;
  const linkBtn = 'min-h-6 py-1.5 text-left text-text underline underline-offset-2 hover:text-accent';
  // BX7: la sugerencia solo con el campo VACÍO y un nombre de cuenta que sugerir.
  const showSuggestion = !!inbound && inbound.sellerName.trim() !== '' && draft.recipientName.trim() === '';
  const label = manual ? t('neighborhoodManualLabel') : t('neighborhoodLabel', { cp: cpComplete ? cp : str(saved.postalCode) });

  return (
    <form id={formId} aria-describedby={noteId} className="flex flex-col gap-4" onSubmit={(e) => e.preventDefault()} noValidate>
      <div id={noteId} className="flex flex-col gap-1">
        {neighborhoodMissing && <p className="text-sm text-text">{t('neighborhoodMissing', { cp: str(saved.postalCode) })}</p>}
        {inbound ? (
          <>
            <p className="text-sm text-text">{ti('scopeNote')}</p>
            <p className="text-sm text-muted">{ti('resyncNote')}</p>
          </>
        ) : (
          <p className="text-sm text-text">{t('scopeNote')}</p>
        )}
        <p className="text-sm text-muted">{t('auditNote')}</p>
      </div>
      <Input
        ref={refs.recipientName}
        label={inbound ? ti('sender') : t('field.recipient')}
        type="text"
        autoComplete="off"
        hint={inbound ? ti('senderHint') : t('hint.recipient')}
        error={fieldErrors.recipientName}
        value={draft.recipientName}
        onChange={set('recipientName')}
        id={recipientId}
        // La sugerencia se une al campo SIN perder su ayuda/error (Input solo une el suyo).
        aria-describedby={showSuggestion ? `${recipientId}-${fieldErrors.recipientName ? 'err' : 'hint'} ${suggestionId}` : undefined}
      />
      {showSuggestion && (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1" data-testid="sdx-inbound-suggestion">
          <p id={suggestionId} className="text-sm text-text">
            {ti('senderSuggestion', { sellerName: inbound!.sellerName })}
          </p>
          <button
            type="button"
            className={`${linkBtn} text-sm`}
            onClick={() => {
              onPatch({ recipientName: inbound!.sellerName });
              refs.recipientName.current?.focus();
            }}
            data-testid="sdx-inbound-use-suggestion"
          >
            {ti('useSuggestion')}
          </button>
        </div>
      )}
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
        error={fieldErrors.postalCode}
        value={draft.postalCode}
        onChange={set('postalCode')}
      />
      {intro && (
        <p id={introId} className="text-sm text-text" aria-live="polite" data-testid="sdx-address-geo-intro">
          {intro}
        </p>
      )}
      <div className="flex flex-col gap-1">
        {manual ? (
          <Input
            ref={geo.controlRef as React.Ref<HTMLInputElement>}
            label={label}
            type="text"
            autoComplete="off"
            value={draft.neighborhood}
            aria-describedby={describedBy}
            aria-invalid={fieldErrors.neighborhood ? true : undefined}
            onChange={(e) => geo.typeNeighborhood(e.target.value)}
          />
        ) : (
          <Select
            ref={geo.controlRef as React.Ref<HTMLSelectElement>}
            label={label}
            placeholder={t('neighborhoodPlaceholder')}
            options={neighborhoods.map((n) => ({ value: n, label: n }))}
            value={neighborhoods.includes(draft.neighborhood) ? draft.neighborhood : ''}
            // Como antes de §43.18m: apagado solo sin CP de 5. Mientras consulta sigue enfocable (el paso 1 abre con
            // el foco en «Colonia» cuando falta, §43.2c, y la lista llega después).
            disabled={!cpComplete}
            aria-describedby={describedBy}
            aria-invalid={fieldErrors.neighborhood ? true : undefined}
            onChange={(e) => onPatch({ neighborhood: e.target.value })}
          />
        )}
        {reason && (
          <p id={cpReasonId} className="font-mono text-xs text-muted">
            {reason}
          </p>
        )}
        {mode === 'pending' && lookup.failed && (
          <p className="flex flex-wrap items-baseline gap-x-1 font-mono text-xs">
            <span className="text-accent" role="alert">
              {tg('failed', { cp })}
            </span>
            <button type="button" onClick={lookup.retry} className={linkBtn}>
              {tc('retry')}
            </button>
            <span aria-hidden>·</span>
            <button type="button" onClick={geo.toManualAll} className={linkBtn}>
              {tg('typeInstead')}
            </button>
          </p>
        )}
        {fieldErrors.neighborhood && <p className="font-mono text-xs text-accent">{fieldErrors.neighborhood}</p>}
        {manual && (
          <p id={hintId} className="font-mono text-xs text-muted">
            {tg('manualHint')}
          </p>
        )}
        {mode === 'list' ? (
          <button type="button" className={`${linkBtn} self-start text-sm`} onClick={geo.toManualNeighborhood}>
            {t('notListedCta')}
          </button>
        ) : geo.canBackToList ? (
          <button type="button" className={`${linkBtn} self-start text-sm`} onClick={geo.toList}>
            {t('backToList', { cp })}
          </button>
        ) : mode === 'pending' && cpComplete && !lookup.failed ? (
          <button type="button" className={`${linkBtn} self-start text-sm`} onClick={geo.toManualAll}>
            {tg('typeInstead')}
          </button>
        ) : null}
      </div>
      {mode === 'manualAll' && (
        <>
          <Input ref={refs.city} label={t('field.city')} type="text" autoComplete="off" error={fieldErrors.city} value={draft.city} onChange={set('city')} />
          <div className="flex flex-col gap-1">
            <Select
              ref={refs.state}
              id={stateId}
              label={t('field.state')}
              placeholder={tg('statePlaceholder')}
              options={mxStateOptions(draft.state)}
              value={draft.state.trim()}
              aria-invalid={fieldErrors.state ? true : undefined}
              onChange={set('state')}
            />
            {fieldErrors.state && <p className="font-mono text-xs text-accent">{fieldErrors.state}</p>}
          </div>
        </>
      )}
      <Textarea
        ref={refs.references}
        label={t('field.references')}
        hint={t('hint.references')}
        rows={2}
        error={fieldErrors.references}
        value={draft.references}
        onChange={set('references')}
      />
      {mode !== 'manualAll' && (
        <>
          <p className="text-sm text-text">{t('cityState', { city: draft.city || t('noData'), state: draft.state || t('noData') })}</p>
          {/* Un `400 {field:city|state}` sin campo a la vista (p. ej. guardar mientras se consulta el CP): no se pierde. */}
          {(fieldErrors.city || fieldErrors.state) && (
            <p className="font-mono text-xs text-accent">{fieldErrors.city ?? fieldErrors.state}</p>
          )}
        </>
      )}
      <p className="text-sm text-muted">{t('phoneReadOnly', { phone: str(saved.phone) || t('phoneNone') })}</p>
    </form>
  );
});

/** **Paso 1 · modo leer** (`§43.2a`): la `<dl>` del snapshot con cada ausencia nombrada (SK8). */
export function AddressReadView({ shipment, inbound = false }: { shipment: AdminShipmentDTO; inbound?: boolean }) {
  const t = useTranslations('admin.m4.tracking.sdx.address');
  const ti = useTranslations('admin.m4.tracking.sdx.inbound');
  const locale = useLocale() as AppLocale;
  const snap = (shipment.addressSnapshot ?? {}) as AddressSnapshotDTO;
  const v = (k: string) => {
    const x = snap[k];
    return typeof x === 'string' && x.trim() !== '' ? x.trim() : null;
  };
  const corrected = shipment.address?.corrected ?? null;
  // §M4-SHIP.19.25.3 / §43.18m.6 (FC-26, UX-ADR-12): el SERVIDOR dice si la colonia se comprobó contra el
  // catálogo (`neighborhoodCheck`, calculado al leer). ⛔ La pantalla no lo deduce comparando con la lista; sin
  // el dato (servidor anterior) ⇒ cero marcas. ⛔ No bloquea nada: es para revisar (`HECHOS.md:50`, `:57`).
  // Sin colonia (o sin CP de 5) la fila ya dice «Falta…» (`missing`): ahí no se añade «escrita a mano».
  const check = shipment.address?.neighborhoodCheck;
  const cpOf = v('postalCode') ?? '';
  const flaggable = v('neighborhood') !== null && /^\d{5}$/.test(cpOf);
  const manualNeighborhood = flaggable && (check === 'not_in_postal_code_list' || check === 'postal_code_not_in_catalog');
  const manualAll = flaggable && check === 'postal_code_not_in_catalog';
  const rows: { label: string; value: string | null; none: string; tone: 'accent' | 'muted' | 'text'; tabular?: boolean; omitIfNull?: boolean; mark?: string }[] = [
    // 💰 rev BSD-1 (§BSD-UX.5a): en modo entrada el snapshot es el ORIGEN ⇒ «Quién envía» / «Falta quién envía».
    { label: inbound ? ti('sender') : t('recipient'), value: v('recipientName'), none: inbound ? ti('senderMissing') : t('recipientMissing'), tone: 'accent' },
    { label: t('line1'), value: v('line1'), none: t('noData'), tone: 'accent' },
    { label: t('line2'), value: v('line2'), none: '', tone: 'text', omitIfNull: true },
    { label: t('neighborhood'), value: v('neighborhood'), none: t('neighborhoodNone'), tone: 'accent', mark: manualNeighborhood ? t('manualMark', { cp: cpOf }) : undefined },
    { label: t('postalCode'), value: v('postalCode'), none: t('postalCodeNone'), tone: 'accent', tabular: true },
    { label: t('city'), value: v('city'), none: t('noData'), tone: 'text' },
    { label: t('state'), value: v('state'), none: t('noData'), tone: 'text', mark: manualAll ? t('manualCityStateMark', { cp: cpOf }) : undefined },
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
                {r.mark && (
                  <span className="block font-mono text-[11px] text-accent" data-testid="sdx-address-manual-mark">
                    {r.mark}
                  </span>
                )}
              </dd>
            </div>
          ))}
      </dl>
      {corrected && (
        <p className="text-sm text-text" data-testid="sdx-address-corrected">
          {t('corrected', { name: corrected.by.name?.trim() || t('unnamed'), datetime: formatDateTimeMx(corrected.at, locale) })}
        </p>
      )}
      {manualNeighborhood && (
        <p className="text-sm text-text" data-testid="sdx-address-manual-review">
          {manualAll ? t('manualReview.all', { cp: cpOf }) : t('manualReview.neighborhood')}
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
