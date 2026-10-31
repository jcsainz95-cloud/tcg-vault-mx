'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { GuestAddressInput } from '@/types/contract';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { PostalCodeNeighborhoodFields, type NeighborhoodMode } from '@/components/domain/PostalCodeNeighborhoodFields';
import { LINE2_MAX, REFERENCES_MAX } from '@/lib/address-rules';
import { PrivacySiteNote, privacyPlainTags } from '@/components/legal/PrivacyNoticeLink';
import { RefundPromiseLine } from '../_shared/ShippingFeeHint';
import { suggestEmailTypo, type GuestErrors, type GuestField, type GuestFormState } from './guest-validation';

/** Destino de la compra; la fila de estado vive en `GuestCheckoutView` (CHK-MOVIL.2.3). */
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
  // CHK-MOVIL.2.2 (opción A): correo y su lectura de vuelta bajo el campo; luego quien recibe, CP (rellena colonia,
  // municipio y estado), colonia, calle y número, teléfono; al final lo opcional plegado. Mismo orden que el DOM.
  'email',
  'emailConfirmed',
  'recipientName',
  'postalCode',
  'neighborhood',
  // §43.18m.7 / FC-23: municipio y estado (solo existen en «todo a mano») van tras la colonia, como en el DOM.
  'city',
  'state',
  'line1',
  'phone',
  // Plegados tras «Interior y referencias (opcional)» (T5); se abren solos si traen error.
  'line2',
  'references',
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
 * `GuestCheckoutForm` (DESIGN_SYSTEM §15.3 y §CHK-MOVIL.2.2, criterios 47 y 48b) — composición de `Input` y
 * casillas; NO es un componente base nuevo. El destino (fila de estado + bóveda) va ANTES, en la vista.
 *
 * Reglas que NO se pueden relajar:
 *  - El correo es el ÚNICO canal del pedido: se valida formato y se **lee de vuelta** en
 *    una casilla obligatoria (§15.3), justo bajo el campo. Editarlo desmarca la casilla y se anuncia por
 *    `aria-live` — el pago queda bloqueado con explicación textual, nunca un botón mudo.
 *  - Prohibido preguntarle al backend si ese correo tiene cuenta (criterio 56): el campo
 *    se comporta idéntico exista o no la cuenta. Sin "bienvenido de nuevo", sin avatar.
 *  - País fijo México (criterio 31/48b), dicho en la cabecera del grupo («ENVÍO A MÉXICO»); el
 *    `422 ADDRESS_NOT_MX` sigue siendo del backend.
 *  - Ningún campo del contrato se quita (`GuestAddressInput`, §4-G.1/§4-G.2): `line2` y `references` solo se
 *    PLIEGAN (T5), cerrados por defecto y abiertos solos si traen error.
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
  serverAddressError = null,
  onGeoModeChange,
}: GuestCheckoutFormProps) {
  const t = useTranslations('checkout');
  const ta = useTranslations('addresses');
  const tp = useTranslations('privacy.sites');
  const summaryRef = useRef<HTMLDivElement>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [foldOpen, setFoldOpen] = useState(false);

  const visible = (field: GuestField) => !!errors[field] && (submitAttempted || !!touched[field]);
  const listed = FIELD_ORDER.filter((f) => !!errors[f]);
  // T5: plegado por defecto; un error visible en lo plegado lo abre (el resumen enlaza a esos campos).
  const optionalOpen = foldOpen || visible('line2') || visible('references');

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
    <div data-testid="guest-form">
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
                <a href={`#${FIELD_ID[field]}`} className="text-sm text-accent underline underline-offset-4 [overflow-wrap:anywhere]">
                  {labelFor(field)}: {messageFor(field)}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ---- Grupo 1 · CONTACTO: correo + su lectura de vuelta bajo el campo (CHK-MOVIL.3 A) ------------- */}
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
          <label
            htmlFor={FIELD_ID.emailConfirmed}
            className="mt-4 flex min-h-[44px] cursor-pointer items-start gap-3 text-sm leading-relaxed text-text"
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
            <span className="min-w-0 [overflow-wrap:anywhere]">
              {/* B4b (PENDIENTES E2E-GUEST-GUION): sin correo escrito, texto neutro — nunca «Confirmo que — es correcto». */}
              {state.email.trim()
                ? t.rich('guest.email.confirmCheckbox', {
                    email: state.email.trim(),
                    mono: (chunks) => <span className="font-mono text-text">{chunks}</span>,
                  })
                : t('guest.email.confirmCheckboxEmpty')}
            </span>
          </label>
          <p aria-live="polite" className="mt-2 min-h-[1rem] font-mono text-xs text-muted">
            {confirmReset ? t('guest.email.confirmReset') : ''}
          </p>
        </div>
      </section>

      {/* ---- Grupo 2 · ENVÍO A MÉXICO: 5 obligatorios en el orden de CHK-MOVIL.2.2 + lo opcional plegado ---- */}
      <section aria-labelledby="guest-shipping-group" className="mt-8 border-t border-border pt-8">
        <h2 id="guest-shipping-group" className="eyebrow">
          {t('guest.shippingGroupMx')}
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
          {/* v1.80.12.5 (§M4-SHIP.19.25, §43.18m): CP → colonia de la lista o escrita → municipio y estado
              del CP (una línea de texto; campos solo en «todo a mano»). El CP va ANTES de la calle porque rellena. */}
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

          {/* T5: interior y referencias, plegados (no se quitan: son del contrato). */}
          <div className="border-y border-border">
            <button
              type="button"
              aria-expanded={optionalOpen}
              aria-controls="guest-optional-fields"
              onClick={() => setFoldOpen(!optionalOpen)}
              className="flex min-h-[44px] w-full items-center gap-2 text-left text-sm text-text"
            >
              <span aria-hidden className="font-mono">
                {optionalOpen ? '−' : '+'}
              </span>
              {t('guest.optionalFold')}
            </button>
            <div id="guest-optional-fields" hidden={!optionalOpen} className="flex flex-col gap-6 pb-6 pt-2">
              {optionalOpen && (
                <>
                  <Input
                    id={FIELD_ID.line2}
                    label={ta('line2')}
                    autoComplete="address-line2"
                    value={state.address.line2 ?? ''}
                    onChange={(e) => onAddressChange({ line2: e.target.value })}
                    onBlur={() => onBlurField('line2')}
                    error={visible('line2') ? messageFor('line2') : undefined}
                  />
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
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ---- Términos (con el aviso de privacidad) ------------------------------------------------------- */}
      <section className="mt-8">
        <label
          htmlFor={FIELD_ID.terms}
          className="flex min-h-[44px] max-w-[620px] cursor-pointer items-start gap-3 text-sm leading-relaxed text-text"
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
        {/* T8 junto a la única mención de «ventas finales» antes de pagar (B4; DESIGN_SYSTEM §CHK-MOVIL.4). */}
        <RefundPromiseLine className="mt-2 max-w-[620px] pl-7" />
      </section>
    </div>
  );
}
