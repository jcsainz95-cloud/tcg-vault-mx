'use client';

import { forwardRef, useId, useImperativeHandle } from 'react';
import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { useNeighborhoodMode, type NeighborhoodMode } from '@/hooks/useNeighborhoodMode';
import { mxStateOptions } from '@/lib/mx-states';

export { sortNeighborhoods, resolveNeighborhoodMatch } from '@/hooks/useNeighborhoodMode';
export type { NeighborhoodMode } from '@/hooks/useNeighborhoodMode';

export interface PostalCodeNeighborhoodFieldsProps {
  postalCode: string;
  neighborhood: string;
  city: string;
  state: string;
  onPostalCode: (cp: string) => void;
  onNeighborhood: (neighborhood: string) => void;
  /** Municipio y estado: los del CP con lista; los tecleados en «todo a mano». */
  onCity: (city: string) => void;
  onState: (state: string) => void;
  /** El modo vigente (§43.18m.1): quien monta valida con el texto de ese modo (§43.18m.7). */
  onModeChange?: (mode: NeighborhoodMode) => void;
  /** Errores ya decididos por quien monta (validación local o respuesta del servidor). */
  postalCodeError?: string;
  neighborhoodError?: string;
  cityError?: string;
  stateError?: string;
  postalCodeId?: string;
  neighborhoodId?: string;
  cityId?: string;
  stateId?: string;
  onBlurPostalCode?: () => void;
  onBlurNeighborhood?: () => void;
  onBlurCity?: () => void;
  onBlurState?: () => void;
}

/**
 * **CP → colonia → municipio y estado** para las direcciones del CLIENTE (libreta, alta inline del buylist,
 * checkout de invitado). v1.80.12.5 (`API_CONTRACT §M4-SHIP.19.25`, `HECHOS.md:57`): **la colonia como
 * Mercado Libre — la lista del CP ayuda, no bloquea.** Diseño: `DESIGN_SYSTEM §43.18m` (v4.19).
 *
 *  - Con lista: `Select` (orden alfabético, única preseleccionada) + botón «Mi colonia no está» que lo
 *    sustituye EN EL MISMO SITIO por un `Input` (mismo `id` y label). Municipio y estado, del CP.
 *  - `404` o `200` sin colonias: colonia, municipio y estado son campos (estado: las 32 entidades). ⛔ Nada
 *    de este caso es un error (CA-7): ni `aria-invalid` en el CP ni `role="alert"`.
 *  - Consultando o falló: «Escribir la colonia a mano» desde el primer instante (CA-8: nunca atascado).
 *  - ⛔ Ninguna `option` centinela en el `select` (UX-ADR-13); ⛔ ningún «Escríbenos» como salida.
 *
 * El `ref` reenviado apunta al control de colonia VIGENTE (`select` o `input`).
 */
export const PostalCodeNeighborhoodFields = forwardRef<HTMLInputElement | HTMLSelectElement, PostalCodeNeighborhoodFieldsProps>(
  function PostalCodeNeighborhoodFields(
    {
      postalCode,
      neighborhood,
      city,
      state,
      onPostalCode,
      onNeighborhood,
      onCity,
      onState,
      onModeChange,
      postalCodeError,
      neighborhoodError,
      cityError,
      stateError,
      postalCodeId,
      neighborhoodId,
      cityId,
      stateId,
      onBlurPostalCode,
      onBlurNeighborhood,
      onBlurCity,
      onBlurState,
    },
    forwardedRef,
  ) {
    const t = useTranslations('addresses');
    const tc = useTranslations('common');
    const autoNeighborhoodId = useId();
    const autoStateId = useId();
    const reasonId = useId();
    const errId = useId();
    const hintId = useId();
    const introId = useId();
    const exitId = useId();
    const cp = postalCode;
    const geo = useNeighborhoodMode({
      postalCode: cp,
      neighborhood,
      onNeighborhood,
      onCityState: (c, s) => {
        onCity(c);
        onState(s);
      },
      onModeChange,
    });
    useImperativeHandle(forwardedRef, () => geo.control() as HTMLInputElement | HTMLSelectElement);
    const { lookup, mode, neighborhoods } = geo;
    const controlId = neighborhoodId ?? autoNeighborhoodId;
    const stateControlId = stateId ?? autoStateId;
    const manual = mode === 'manualNeighborhood' || mode === 'manualAll';

    // Por qué el `Select` no se puede usar todavía (§15.9: ningún control apagado y mudo).
    const reason =
      mode !== 'pending' ? null : !lookup.cpComplete ? t('geo.cpFirst') : lookup.loading ? t('geo.loading', { cp }) : null;
    // «Todo a mano»: el texto que lo explica (⛔ no es un error, CA-7). Si lo eligió el cliente, el neutro.
    const intro =
      mode === 'manualAll' ? (geo.manualAllChosen ? t('geo.manualAllIntro') : t('geo.cpNotInCatalog', { cp })) : null;
    const describedBy =
      [reason ? reasonId : null, intro ? introId : null, neighborhoodError ? errId : null, manual ? hintId : null]
        .filter(Boolean)
        .join(' ') || undefined;

    // UN solo hueco para la salida (§43.18m.3): el lector nunca encuentra dos botones de modo a la vez.
    const linkBtn = 'min-h-6 py-1.5 text-left text-text underline underline-offset-2 hover:text-accent';
    let exit: React.ReactNode = null;
    if (mode === 'list') {
      exit = (
        <button id={exitId} type="button" className={`${linkBtn} self-start text-sm`} onClick={geo.toManualNeighborhood}>
          {t('geo.notListedCta')}
        </button>
      );
    } else if (geo.canBackToList) {
      exit = (
        <button id={exitId} type="button" className={`${linkBtn} self-start text-sm`} onClick={geo.toList}>
          {t('geo.backToList', { cp })}
        </button>
      );
    } else if (mode === 'pending' && lookup.cpComplete && !lookup.failed) {
      exit = (
        <button id={exitId} type="button" className={`${linkBtn} self-start text-sm`} onClick={geo.toManualAll}>
          {t('geo.typeInstead')}
        </button>
      );
    }

    return (
      <>
        <Input
          id={postalCodeId}
          label={t('postalCode')}
          inputMode="numeric"
          maxLength={5}
          autoComplete="postal-code"
          className="tabular-nums"
          hint={t('geo.cpHint')}
          // FC-16 / CA-7: el CP fuera del catálogo NO es un error del CP; solo lo que decida quien monta.
          error={postalCodeError}
          value={postalCode}
          onChange={(e) => onPostalCode(e.target.value.replace(/\D/g, ''))}
          onBlur={onBlurPostalCode}
        />
        {intro && (
          <p id={introId} className="text-sm text-text" aria-live="polite" data-testid="address-geo-intro">
            {intro}
          </p>
        )}
        <div className="flex flex-col gap-2">
          {manual ? (
            <Input
              ref={geo.controlRef as React.Ref<HTMLInputElement>}
              id={controlId}
              label={t('neighborhood')}
              type="text"
              autoComplete="address-level3"
              value={neighborhood}
              aria-describedby={describedBy}
              aria-invalid={neighborhoodError ? true : undefined}
              onChange={(e) => geo.typeNeighborhood(e.target.value)}
              onBlur={onBlurNeighborhood}
            />
          ) : (
            <Select
              ref={geo.controlRef as React.Ref<HTMLSelectElement>}
              id={controlId}
              label={t('neighborhood')}
              placeholder={t('geo.placeholder')}
              options={neighborhoods.map((n) => ({ value: n, label: n }))}
              value={neighborhoods.includes(neighborhood) ? neighborhood : ''}
              disabled={mode !== 'list'}
              aria-describedby={describedBy}
              aria-invalid={neighborhoodError ? true : undefined}
              onChange={(e) => onNeighborhood(e.target.value)}
              onBlur={onBlurNeighborhood}
            />
          )}
          {reason && (
            <p id={reasonId} className="font-mono text-xs text-muted" aria-live="polite">
              {reason}
            </p>
          )}
          {mode === 'pending' && lookup.failed && (
            <p className="flex flex-wrap items-baseline gap-x-1 font-mono text-xs">
              {/* §43.18m.5: aquí SÍ falló algo nuestro ⇒ `role="alert"` solo en el texto del fallo (FC-20). */}
              <span className="text-accent" role="alert">
                {t('geo.failed', { cp })}
              </span>
              <button type="button" onClick={lookup.retry} className={linkBtn}>
                {tc('retry')}
              </button>
              <span aria-hidden>·</span>
              <button id={exitId} type="button" onClick={geo.toManualAll} className={linkBtn}>
                {t('geo.typeInstead')}
              </button>
            </p>
          )}
          {neighborhoodError && (
            <p id={errId} className="font-mono text-xs text-accent">
              {neighborhoodError}
            </p>
          )}
          {manual && (
            <p id={hintId} className="font-mono text-xs text-muted">
              {t('geo.manualHint')}
            </p>
          )}
          {exit}
        </div>
        {mode === 'manualAll' ? (
          <>
            <Input
              id={cityId}
              label={t('city')}
              type="text"
              autoComplete="address-level2"
              value={city}
              error={cityError}
              onChange={(e) => onCity(e.target.value)}
              onBlur={onBlurCity}
            />
            <div className="flex flex-col gap-2">
              <Select
                id={stateControlId}
                label={t('state')}
                placeholder={t('geo.statePlaceholder')}
                autoComplete="address-level1"
                options={mxStateOptions(state)}
                value={state.trim()}
                aria-invalid={stateError ? true : undefined}
                aria-describedby={stateError ? `${stateControlId}-err` : undefined}
                onChange={(e) => onState(e.target.value)}
                onBlur={onBlurState}
              />
              {stateError && (
                <p id={`${stateControlId}-err`} className="font-mono text-xs text-accent">
                  {stateError}
                </p>
              )}
            </div>
          </>
        ) : (
          (mode === 'list' || mode === 'manualNeighborhood') &&
          lookup.data && (
            <p className="text-sm text-text" data-testid="address-city-state">
              {t('geo.cityState', {
                city: lookup.data.municipality || t('geo.noData'),
                state: lookup.data.state || t('geo.noData'),
              })}
            </p>
          )
        )}
      </>
    );
  },
);
