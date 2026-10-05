'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { GuestAddressInput } from '@/types/contract';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { PostalCodeNeighborhoodFields, type NeighborhoodMode } from '@/components/domain/PostalCodeNeighborhoodFields';
import { LINE2_MAX, REFERENCES_MAX } from '@/lib/address-rules';
import { PrivacySiteNote, privacyPlainTags } from '@/components/legal/PrivacyNoticeLink';
import { VaultUpsellPanel } from './VaultUpsellPanel';
import { suggestEmailTypo, type GuestErrors, type GuestField, type GuestFormState } from './guest-validation';

export type Destination = 'ship' | 'vault';

export interface GuestCheckoutFormProps {
  state: GuestFormState;
  onChange: (patch: Partial<GuestFormState>) => void;
  onAddressChange: (patch: Partial<GuestAddressInput>) => void;
  /** errores calculados; solo se PINTAN cuando el campo se tocó o se intentó pagar */
  errors: GuestErrors;
  touched: Partial<Record<GuestField, boolean>>;
  onBlurField: (field: GuestField) => void;
  /** true tras un intento de pago con errores: pinta el resumen `role="alert"` */
  submitAttempted: boolean;
  /**
   * Contador de intentos de pago (sube en CADA clic en pagar). El foco va al resumen solo cuando cambia
   * este número — nunca cuando cambia el número de errores (FRONTEND_NOTES §91).
   */
  submitAttemptId: number;
  destination: Destination;
  onDestinationChange: (destination: Destination) => void;
  upsellOpen: boolean;
  shippingFeeLabel?: string;
  onDismissUpsell: () => void;
  onAccountReady: () => void;
  /**
   * Un `400 VALIDATION_ERROR {field, max}` de la sesión sobre la colonia, el municipio o el estado, pintado
   * BAJO su campo (§43.18m.7, `geo.tooLong`). Lo retira quien monta al tocar ese campo. v1.80.12.5
   * (§M4-SHIP.19.25): ⛔ ya no hay `422` geográficos que pintar.
   */
  serverAddressError?: { field: 'neighborhood' | 'city' | 'state'; message: string } | null;
  /** El modo de la colonia (§43.18m.1): la validación de quien monta depende de él. */
  onGeoModeChange?: (mode: NeighborhoodMode) => void;
}

export const FIELD_ORDER: GuestField[] = [
  'email',
  'emailConfirmed',
  'recipientName',
  'line1',
  'line2',
  'postalCode',
  'neighborhood',
  // §43.18m.7 / FC-23: municipio y estado (solo existen en «todo a mano») van tras la colonia, como en el DOM.
  'city',
  'state',
  // §43.18b: referencias antes que teléfono (mismo orden que el DOM: el resumen de errores lo sigue).
  'references',
  'phone',
  'terms',
];

/** id del control en el DOM (para los enlaces del resumen de errores). */
export const FIELD_ID: Record<GuestField, string> = {
  email: 'guest-email',
  emailConfirmed: 'guest-email-confirm',
  recipientName: 'guest-recipientName',
  line1: 'guest-line1',
  line2: 'guest-line2',
  postalCode: 'guest-postalCode',
  neighborhood: 'guest-neighborhood',
  city: 'guest-city',
  state: 'guest-state',
  phone: 'guest-phone',
  references: 'guest-references',
  terms: 'guest-terms',
};

/**
 * `GuestCheckoutForm` (DESIGN_SYSTEM §15.3, criterios 47 y 48b) — composición de `Input`,
 * checkbox y radios; NO es un componente base nuevo.
 *
 * Reglas que NO se pueden relajar:
 *  - El correo es el ÚNICO canal del pedido: se valida formato y se **lee de vuelta** en
 *    una casilla obligatoria (§15.3). Editarlo desmarca la casilla y se anuncia por
 *    `aria-live` — el pago queda bloqueado con explicación textual, nunca un botón mudo.
 *  - Prohibido preguntarle al backend si ese correo tiene cuenta (criterio 56): el campo
 *    se comporta idéntico exista o no la cuenta. Sin "bienvenido de nuevo", sin avatar.
 *  - País fijo México (criterio 31/48b); el `422 ADDRESS_NOT_MX` sigue siendo del backend.
 */
export function GuestCheckoutForm({
  state,
  onChange,
  onAddressChange,
  errors,
  touched,
  onBlurField,
  submitAttempted,
  submitAttemptId,
  destination,
  onDestinationChange,
  upsellOpen,
  shippingFeeLabel,
  onDismissUpsell,
  onAccountReady,
  serverAddressError = null,
  onGeoModeChange,
}: GuestCheckoutFormProps) {
  const t = useTranslations('checkout');
  const ta = useTranslations('addresses');
  const tp = useTranslations('privacy.sites');
  const summaryRef = useRef<HTMLDivElement>(null);
  const vaultRadioRef = useRef<HTMLInputElement>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const visible = (field: GuestField) => !!errors[field] && (submitAttempted || !!touched[field]);
  const listed = FIELD_ORDER.filter((f) => !!errors[f]);

  // El resumen recibe el foco al fallar el intento de pago (DESIGN_SYSTEM §15.3): sustituye al scroll a ciegas.
  // ⛔ Depende SOLO de `submitAttemptId` (cada clic en pagar). Con `listed.length` en las dependencias, la
  // primera letra tecleada en un campo con error cambiaba el número de errores y el foco saltaba al resumen:
  // solo entraba esa letra (FRONTEND_NOTES §91). El resumen se monta en el mismo render que sube el contador,
  // así que el ref ya existe cuando corre el efecto; si no hay errores no hay resumen y no se mueve el foco.
  useEffect(() => {
    if (submitAttemptId > 0) summaryRef.current?.focus();
  }, [submitAttemptId]);

  function messageFor(field: GuestField): string {
    const code = errors[field];
    if (!code) return '';
    if (field === 'email') return code === 'required' ? t('guest.email.required') : t('guest.email.invalid');
    if (field === 'emailConfirmed') return t('guest.payBlocked.email');
    if (field === 'terms') return t('guest.acceptTermsRequired');
    if (field === 'postalCode') return ta('postalCodeInvalid');
    if (field === 'phone') return ta('phoneInvalid');
    if (field === 'neighborhood') return ta(code === 'typeRequired' ? 'geo.neighborhoodTypeRequired' : 'geo.neighborhoodRequired');
    if (field === 'city') return ta('geo.cityRequired');
    if (field === 'state') return ta('geo.stateRequired');
    if (field === 'line2') return ta('line2TooLong', { max: String(LINE2_MAX) });
    if (field === 'references') return ta('referencesTooLong', { max: String(REFERENCES_MAX) });
    return ta('required');
  }

  function labelFor(field: GuestField): string {
    switch (field) {
      case 'email':
        return t('guest.email.label');
      case 'emailConfirmed':
        return t('guest.email.label');
      case 'recipientName':
        return t('guest.recipientName');
      case 'terms':
        // §80.1 / F-5: el resumen necesita texto plano; se deriva de LA MISMA clave que la casilla
        // (⛔ nunca una segunda copia de una frase legal).
        return tp.markup('guestCheckout', privacyPlainTags);
      case 'references':
        return ta('references');
      default:
        return ta(field);
    }
  }

  function geoError(field: 'neighborhood' | 'city' | 'state'): string | undefined {
    if (serverAddressError?.field === field) return serverAddressError.message;
    return visible(field) ? messageFor(field) : undefined;
  }

  const typo = suggestEmailTypo(state.email);
  const showTypo = !!typo && typo !== state.email.trim().toLowerCase();

  function setEmail(value: string) {
    // Al editar el correo la confirmación se cae (§15.3) y se anuncia por aria-live.
    const patch: Partial<GuestFormState> = { email: value };
    if (state.emailConfirmed) {
      patch.emailConfirmed = false;
      setConfirmReset(true);
    }
    onChange(patch);
  }

  return (
    <div>
      {submitAttempted && listed.length > 0 && (
        <div
          ref={summaryRef}
          tabIndex={-1}
          role="alert"
          className="mb-8 border-l-2 border-accent py-1 pl-4 outline-none"
        >
          <p className="text-sm font-medium text-text">{t('guest.errorSummary', { count: listed.length })}</p>
          <ul className="mt-2 flex flex-col gap-1">
            {listed.map((field) => (
              <li key={field}>
                <a href={`#${FIELD_ID[field]}`} className="text-sm text-accent underline underline-offset-4">
                  {labelFor(field)}: {messageFor(field)}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ---- Grupo 1 · CONTACTO ---------------------------------------------------- */}
      <section aria-labelledby="guest-contact-group">
        <h2 id="guest-contact-group" className="eyebrow">
          {t('guest.contactGroup')}
        </h2>
        <div className="mt-5 max-w-[520px]">
          <Input
            id={FIELD_ID.email}
            label={t('guest.email.label')}
            type="email"
            inputMode="email"
            autoComplete="email"
            spellCheck={false}
            value={state.email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => onBlurField('email')}
            error={visible('email') ? messageFor('email') : undefined}
            hint={t('guest.email.help')}
          />
          {showTypo && (
            <p className="mt-2 text-xs text-muted">
              {t('guest.email.typoSuggestion', { suggestion: typo })}{' '}
              <button
                type="button"
                onClick={() => setEmail(typo)}
                className="border-b border-accent text-accent hover:border-text hover:text-text"
              >
                {t('guest.email.typoAccept')}
              </button>
            </p>
          )}
        </div>
      </section>

      {/* ---- Grupo 2 · ENVÍO ------------------------------------------------------- */}
      <section aria-labelledby="guest-shipping-group" className="mt-10 border-t border-border pt-8">
        <h2 id="guest-shipping-group" className="eyebrow">
          {t('guest.shippingGroup')}
        </h2>
        <div className="mt-5 flex max-w-[620px] flex-col gap-6">
          <Input
            id={FIELD_ID.recipientName}
            label={t('guest.recipientName')}
            autoComplete="name"
            value={state.address.recipientName}
            onChange={(e) => onAddressChange({ recipientName: e.target.value })}
            onBlur={() => onBlurField('recipientName')}
            error={visible('recipientName') ? messageFor('recipientName') : undefined}
          />
          <Input
            id={FIELD_ID.line1}
            label={ta('line1')}
            autoComplete="address-line1"
            value={state.address.line1}
            onChange={(e) => onAddressChange({ line1: e.target.value })}
            onBlur={() => onBlurField('line1')}
            error={visible('line1') ? messageFor('line1') : undefined}
          />
          <Input
            id={FIELD_ID.line2}
            label={ta('line2')}
            autoComplete="address-line2"
            value={state.address.line2 ?? ''}
            onChange={(e) => onAddressChange({ line2: e.target.value })}
            onBlur={() => onBlurField('line2')}
            error={visible('line2') ? messageFor('line2') : undefined}
          />
          {/* v1.80.12.5 (§M4-SHIP.19.25, §43.18m): CP → colonia de la lista o escrita → municipio y estado
              del CP; sin lista, los tres se escriben. La tienda nunca deja de vender por el catálogo. */}
          <PostalCodeNeighborhoodFields
            postalCodeId={FIELD_ID.postalCode}
            neighborhoodId={FIELD_ID.neighborhood}
            cityId={FIELD_ID.city}
            stateId={FIELD_ID.state}
            postalCode={state.address.postalCode}
            neighborhood={state.address.neighborhood}
            city={state.address.city}
            state={state.address.state}
            onPostalCode={(postalCode) => onAddressChange({ postalCode })}
            onNeighborhood={(neighborhood) => onAddressChange({ neighborhood })}
            onCity={(city) => onAddressChange({ city })}
            onState={(st) => onAddressChange({ state: st })}
            onModeChange={onGeoModeChange}
            onBlurPostalCode={() => onBlurField('postalCode')}
            onBlurNeighborhood={() => onBlurField('neighborhood')}
            onBlurCity={() => onBlurField('city')}
            onBlurState={() => onBlurField('state')}
            postalCodeError={visible('postalCode') ? messageFor('postalCode') : undefined}
            neighborhoodError={geoError('neighborhood')}
            cityError={geoError('city')}
            stateError={geoError('state')}
          />
          {/* §43.18b: las referencias acompañan al lugar, antes que el teléfono. */}
          <Textarea
            id={FIELD_ID.references}
            label={ta('references')}
            hint={ta('referencesHint', { max: String(REFERENCES_MAX) })}
            rows={2}
            counter={{ max: REFERENCES_MAX }}
            value={state.address.references ?? ''}
            onChange={(e) => onAddressChange({ references: e.target.value })}
            onBlur={() => onBlurField('references')}
            error={visible('references') ? messageFor('references') : undefined}
          />
          <Input
            id={FIELD_ID.phone}
            label={ta('phone')}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={state.address.phone}
            onChange={(e) => onAddressChange({ phone: e.target.value })}
            onBlur={() => onBlurField('phone')}
            error={visible('phone') ? messageFor('phone') : undefined}
            hint={ta('phoneHint')}
          />
          {/* País fijo MX, mismo tratamiento que el formulario de direcciones (§15.3). */}
          <div className="flex flex-col">
            <span className="eyebrow">{ta('country')}</span>
            <p className="mt-3 border-b border-border-strong pb-3 text-base text-text">{ta('countryMx')}</p>
          </div>
        </div>
      </section>

      {/* ---- Destino de la compra + upsell de bóveda -------------------------------- */}
      <section aria-labelledby="guest-destination-group" className="mt-10 border-t border-border pt-8">
        <h2 id="guest-destination-group" className="eyebrow">
          {t('destination.eyebrow')}
        </h2>
        <div className="mt-5 max-w-[620px]" role="radiogroup" aria-labelledby="guest-destination-group">
          <label className="flex min-h-[44px] cursor-pointer items-start gap-4 border-t border-border py-4">
            <input
              type="radio"
              name="guest-destination"
              value="ship"
              checked={destination === 'ship'}
              onChange={() => onDestinationChange('ship')}
              className="mt-1 h-4 w-4 shrink-0 cursor-pointer appearance-none rounded-full border border-border-strong checked:border-[5px] checked:border-text"
            />
            <span className="min-w-0 flex-1">
              <span className="block text-sm text-text">{t('destination.ship')}</span>
              {shippingFeeLabel && (
                <span className="mt-1 block font-mono text-[11px] text-muted">
                  {t('destination.shipFeeHint', { amount: shippingFeeLabel })}
                </span>
              )}
            </span>
          </label>
          {/*
           * Criterio 48: la bóveda queda SELECCIONABLE. Nada de `disabled`, `aria-disabled`,
           * candado ni tooltip de error: la micro-etiqueta "REQUIERE CUENTA" es honestidad
           * previa, y al elegirla se despliega el upsell (§15.4).
           */}
          <label className="flex min-h-[44px] cursor-pointer items-start gap-4 border-y border-border py-4">
            <input
              ref={vaultRadioRef}
              type="radio"
              name="guest-destination"
              value="vault"
              checked={destination === 'vault'}
              onChange={() => onDestinationChange('vault')}
              /* Sin `aria-expanded`/`aria-controls`: el rol `radio` no los admite. El panel
                 que se despliega debajo es un `role="region"` etiquetado por su propio h3,
                 y el foco viaja a ese encabezado al abrirse (§15.4). */
              className="mt-1 h-4 w-4 shrink-0 cursor-pointer appearance-none rounded-full border border-border-strong checked:border-[5px] checked:border-text"
            />
            <span className="min-w-0 flex-1">
              <span className="block text-sm text-text">{t('destination.vault')}</span>
              <span className="mt-1 block font-mono text-[11px] uppercase tracking-label text-muted">
                {t('destination.vaultRequiresAccount')}
              </span>
            </span>
          </label>

          <div id="vault-upsell-panel">
            {upsellOpen && (
              <VaultUpsellPanel
                shippingFeeLabel={shippingFeeLabel}
                defaultEmail={state.email}
                defaultName={state.address.recipientName}
                onDismiss={onDismissUpsell}
                onAccountReady={onAccountReady}
                onEscape={() => vaultRadioRef.current?.focus()}
              />
            )}
          </div>
        </div>
      </section>

      {/* ---- Lectura de vuelta del correo + términos --------------------------------- */}
      <section className="mt-10 border-t border-border pt-8">
        <label
          htmlFor={FIELD_ID.emailConfirmed}
          className="flex min-h-[44px] max-w-[620px] cursor-pointer items-start gap-3 text-sm leading-relaxed text-text"
        >
          <input
            id={FIELD_ID.emailConfirmed}
            type="checkbox"
            checked={state.emailConfirmed}
            disabled={!state.email.trim()}
            onChange={(e) => {
              setConfirmReset(false);
              onChange({ emailConfirmed: e.target.checked });
            }}
            className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-[color:var(--color-accent)]"
          />
          <span>
            {t.rich('guest.email.confirmCheckbox', {
              email: state.email || '—',
              mono: (chunks) => <span className="font-mono text-text">{chunks}</span>,
            })}
          </span>
        </label>
        <p aria-live="polite" className="mt-2 min-h-[1rem] font-mono text-xs text-muted">
          {confirmReset ? t('guest.email.confirmReset') : ''}
        </p>

        <label
          htmlFor={FIELD_ID.terms}
          className="mt-5 flex min-h-[44px] max-w-[620px] cursor-pointer items-start gap-3 text-sm leading-relaxed text-text"
        >
          <input
            id={FIELD_ID.terms}
            type="checkbox"
            checked={state.acceptedTerms}
            onChange={(e) => onChange({ acceptedTerms: e.target.checked })}
            className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-[color:var(--color-accent)]"
          />
          {/* LIVE-8 · sitio 3 (§14.14 E-9 lote 2; DESIGN_SYSTEM §80.2/§80.3; criterio 505 i): «términos» y
              «aviso de privacidad» enlazan dentro de la etiqueta (pestaña nueva); el aviso solo si se sirve. */}
          <PrivacySiteNote site="guestCheckout" as="span" />
        </label>
        {visible('terms') && (
          <p className="mt-2 font-mono text-xs text-accent">{messageFor('terms')}</p>
        )}
      </section>
    </div>
  );
}
