'use client';

import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { listAddresses } from '@/lib/api';
import type { AddressDTO } from '@/types/contract';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { QueryState } from '@/components/ui/QueryState';
import { AddressFormFields, useAddressForm } from './AddressManager';

/** Una línea legible de la dirección para el `Select` (sin PII de más de la necesaria). */
export function pickupAddressSummary(a: AddressDTO): string {
  const street = [a.line1, a.line2, a.neighborhood].filter(Boolean).join(', ');
  return `${street} · ${a.city}, ${a.state} ${a.postalCode}`;
}

export interface BuylistPickupAddressFieldProps {
  /** `addressId` elegido. Vacío = todavía no hay elección (el CTA de crear se apaga). */
  value: string;
  onChange: (addressId: string) => void;
  /** Error inline del campo (422 PICKUP_ADDRESS_REQUIRED / PICKUP_ADDRESS_NOT_FOUND). */
  error?: string | null;
  /** Id del texto que explica POR QUÉ, para el `aria-describedby` del botón apagado (§15.9). */
  describedById?: string;
}

/**
 * DIRECCIÓN DE ORIGEN del buylist (contrato §6 · `POST /buylist/requests` con `addressId`
 * OBLIGATORIO, v1.51.3 · D36/D37 · DESIGN_SYSTEM §23.3j).
 *
 * **Por qué se pide aquí y no al aceptar la oferta:** la guía la ponemos nosotros (D16) y una
 * etiqueta no se imprime sin domicilio de remitente. Descubrir al aceptar que no sabemos a dónde
 * va convertiría un requisito en un incidente con el trato ya cerrado.
 *
 * **La regla que gobierna este componente: la UI PRESELECCIONA, el id VIAJA EXPLÍCITO.** No hay
 * fallback silencioso a la dirección `isDefault` —esa es la diferencia con la CLABE, que sí lo
 * admite porque en archivo hay exactamente una y es del propio usuario verificado—. La libreta
 * tiene N filas: elegir por el vendedor es elegir de dónde salen sus cartas y a dónde mandamos una
 * etiqueta que pagamos nosotros. *La comodidad va en la pantalla; la afirmación va en el contrato.*
 *
 * **Reusa la libreta que YA existe** (`GET`/`POST /users/me/addresses`, §5): `buylist` no escribe
 * domicilios por un segundo camino —sería una segunda validación de CP que se desfasa—. Con
 * direcciones guardadas se ofrece un `Select` con la predeterminada preseleccionada (el recurrente
 * no teclea nada); sin ninguna, el alta INLINE, que queda en su libreta para la próxima vez.
 */
export function BuylistPickupAddressField({
  value,
  onChange,
  error,
  describedById,
}: BuylistPickupAddressFieldProps) {
  const t = useTranslations('buylist');
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['addresses'], queryFn: listAddresses });
  // `useMemo` para que la identidad no cambie en cada render (el efecto de preselección
  // depende de ella).
  const addresses = useMemo(() => query.data ?? [], [query.data]);

  // Preselección de la predeterminada (o la primera). Es COMODIDAD de pantalla: el valor queda en
  // el estado del formulario y de ahí viaja explícito en el body.
  useEffect(() => {
    if (addresses.length === 0) return;
    if (value && addresses.some((a) => a.id === value)) return;
    const preferred = addresses.find((a) => a.isDefault) ?? addresses[0];
    onChange(preferred.id);
  }, [addresses, value, onChange]);

  return (
    <section className="flex flex-col gap-3">
      {/* El POR QUÉ va SIEMPRE visible (no solo cuando el botón se apaga): es el motivo por el que
          pedimos un dato que antes no pedíamos. */}
      <p id={describedById} className="text-sm leading-[1.7] text-text">
        {t('request.address.why')}
      </p>

      <QueryState
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        onRetry={() => query.refetch()}
      >
        {addresses.length > 0 ? (
          <>
            <Select
              label={t('request.address.label')}
              aria-describedby={describedById}
              options={addresses.map((a) => ({ value: a.id, label: pickupAddressSummary(a) }))}
              value={value}
              onChange={(e) => onChange(e.target.value)}
            />
            <p className="font-mono text-[11px] leading-[1.6] text-muted">
              {t('request.address.printed')}
            </p>
          </>
        ) : (
          /* Sin ninguna dirección: alta INLINE (nunca un modal encima del modal) y queda en la
             libreta. Mismo formulario y misma validación que el gestor de direcciones. El
             encabezado solo existe en esta rama: con `Select`, el rótulo YA es su etiqueta. */
          <InlineAddressCapture
            title={t('request.address.label')}
            onCreated={(created) => {
              void qc.invalidateQueries({ queryKey: ['addresses'] });
              onChange(created.id);
            }}
          />
        )}
      </QueryState>

      {error && (
        /* §23.3j: los 422 de dirección se pintan INLINE en el campo, nunca como toast. */
        <p role="alert" className="font-mono text-[11px] leading-[1.6] text-accent">
          {error}
        </p>
      )}
    </section>
  );
}

function InlineAddressCapture({
  title,
  onCreated,
}: {
  title: string;
  onCreated: (created: AddressDTO) => void;
}) {
  const tAddr = useTranslations('addresses');
  const state = useAddressForm(onCreated);
  return (
    <div className="flex flex-col gap-4 border-l border-border-strong pl-4">
      <p className="eyebrow">{title}</p>
      <AddressFormFields state={state} />
      <Button
        variant="secondary"
        className="self-start"
        loading={state.isPending}
        onClick={state.submit}
      >
        {tAddr('save')}
      </Button>
    </div>
  );
}
