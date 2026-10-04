'use client';

import { forwardRef, useId } from 'react';
import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { usePostalCodeLookup } from '@/hooks/usePostalCodeLookup';
import type { PostalCodeDTO } from '@/types/contract';

export interface PostalCodeNeighborhoodFieldsProps {
  postalCode: string;
  neighborhood: string;
  onPostalCode: (cp: string) => void;
  onNeighborhood: (neighborhood: string) => void;
  /** Llega la lista del CP: la pantalla toma colonia reconciliada, municipio y estado. */
  onResolved: (data: PostalCodeDTO, match: string) => void;
  /** Errores ya decididos por quien monta (validación local o respuesta del servidor). */
  postalCodeError?: string;
  neighborhoodError?: string;
  /** `422 NEIGHBORHOOD_NOT_IN_POSTAL_CODE {allowed}`: la lista del servidor manda. */
  allowedOverride?: string[] | null;
  postalCodeId?: string;
  neighborhoodId?: string;
  onBlurPostalCode?: () => void;
  onBlurNeighborhood?: () => void;
}

/**
 * **CP → colonia de la lista → municipio y estado** para las direcciones del CLIENTE (libreta, alta
 * inline del buylist, checkout de invitado), fase C (`API_CONTRACT §M4-SHIP.19.5`, criterio 235).
 *
 * Es la misma mecánica que el paso 1 de «Capturar guía» (`DESIGN_SYSTEM §43.2b`) y comparte su hook
 * (`usePostalCodeLookup`): con 5 dígitos se consulta `GET /geo/postal-codes/:cp`; la colonia es un
 * `Select` de esa lista (⛔ sin texto libre); municipio y estado **no son campos**: se muestran tal
 * como los da el CP, porque el servidor los sobrescribe con los canónicos.
 *
 * ⛔ Diseño del cliente NO escrito por ux-ui (§43 es la ventana del operador): copy y orden aplican lo
 * mínimo coherente con §43.2b — anotado en `FRONTEND_NOTES` para ux-ui.
 */
export const PostalCodeNeighborhoodFields = forwardRef<HTMLSelectElement, PostalCodeNeighborhoodFieldsProps>(
  function PostalCodeNeighborhoodFields(
    {
      postalCode,
      neighborhood,
      onPostalCode,
      onNeighborhood,
      onResolved,
      postalCodeError,
      neighborhoodError,
      allowedOverride = null,
      postalCodeId,
      neighborhoodId,
      onBlurPostalCode,
      onBlurNeighborhood,
    },
    neighborhoodRef,
  ) {
    const t = useTranslations('addresses');
    const tc = useTranslations('common');
    const reasonId = useId();
    const errId = useId();
    const cp = postalCode;
    const lookup = usePostalCodeLookup(cp, { allowedOverride, selected: neighborhood, onResolved });
    const { cpComplete, neighborhoods } = lookup;

    const cpMessage = postalCodeError ?? (lookup.unknown ? t('geo.cpUnknown', { cp }) : undefined);
    // Municipio y estado SOLO de la respuesta de ESTE CP: nunca los de un CP anterior ni los tecleados.
    const city = lookup.data?.municipality ?? '';
    const state = lookup.data?.state ?? '';
    // Por qué el `Select` no se puede usar todavía (§15.9: ningún control apagado y mudo).
    const reason = !cpComplete
      ? t('geo.cpFirst')
      : lookup.loading
        ? t('geo.loading', { cp })
        : lookup.unknown
          ? t('geo.noNeighborhoods')
          : null;
    const describedBy = [reason ? reasonId : null, neighborhoodError ? errId : null].filter(Boolean).join(' ') || undefined;

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
          error={cpMessage}
          value={postalCode}
          onChange={(e) => onPostalCode(e.target.value.replace(/\D/g, ''))}
          onBlur={onBlurPostalCode}
        />
        <div className="flex flex-col gap-2">
          <Select
            ref={neighborhoodRef}
            id={neighborhoodId}
            label={t('neighborhood')}
            placeholder={t('geo.placeholder')}
            options={neighborhoods.map((n) => ({ value: n, label: n }))}
            value={neighborhoods.includes(neighborhood) ? neighborhood : ''}
            disabled={!cpComplete || neighborhoods.length === 0}
            aria-describedby={describedBy}
            aria-invalid={neighborhoodError ? true : undefined}
            onChange={(e) => onNeighborhood(e.target.value)}
            onBlur={onBlurNeighborhood}
          />
          {reason && (
            <p id={reasonId} className="font-mono text-xs text-muted" aria-live="polite">
              {reason}
            </p>
          )}
          {lookup.failed && (
            <p className="font-mono text-xs text-accent" role="alert">
              {t('geo.failed', { cp })}{' '}
              <button type="button" onClick={lookup.retry} className="text-text underline underline-offset-2 hover:text-accent">
                {tc('retry')}
              </button>
            </p>
          )}
          {neighborhoodError && (
            <p id={errId} className="font-mono text-xs text-accent">
              {neighborhoodError}
            </p>
          )}
        </div>
        {lookup.data && (
          <p className="text-sm text-text" data-testid="address-city-state">
            {t('geo.cityState', { city: city || t('geo.noData'), state: state || t('geo.noData') })}
          </p>
        )}
      </>
    );
  },
);
