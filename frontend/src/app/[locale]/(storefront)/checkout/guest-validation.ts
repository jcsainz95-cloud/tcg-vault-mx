import type { GuestAddressInput } from '@/types/contract';
import type { NeighborhoodMode } from '@/hooks/useNeighborhoodMode';
import { isMxPhone, isPostalCode, LINE2_MAX, normalizeMxPhone, REFERENCES_MAX } from '@/lib/address-rules';

// N-3: `normalizeMxPhone` vive desde v1.81 en `lib/address-rules` (la libreta la usa también); se
// re-exporta para no mover a quien ya la importaba de aquí.
export { normalizeMxPhone };

/**
 * Validación LOCAL del checkout de invitado (DESIGN_SYSTEM §15.3, criterios 47 y 48b).
 *
 * Regla de oro: el backend es la autoridad (contrato §4-G.2 valida formato de correo,
 * dirección MX y `acceptedTerms`); esto solo evita un viaje inútil y da error inline.
 * NUNCA se consulta al backend "si ese correo tiene cuenta" (criterio 56 — no enumeración).
 */

/** Formato RFC-5322 simplificado + tope de longitud del contrato (≤ 254). */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;

export function isValidEmail(value: string): boolean {
  const email = value.trim();
  return email.length > 0 && email.length <= 254 && EMAIL_RE.test(email);
}

/**
 * Sugerencia de errata de dominio (§15.3). Es SOLO una sugerencia: nunca rechaza el
 * correo ni bloquea el pago, y no consulta nada al servidor.
 */
const TYPO_DOMAINS: Record<string, string> = {
  'gmial.com': 'gmail.com',
  'gmai.com': 'gmail.com',
  'gmail.co': 'gmail.com',
  'gnail.com': 'gmail.com',
  'hotmial.com': 'hotmail.com',
  'hotmai.com': 'hotmail.com',
  'hotmail.co': 'hotmail.com',
  'outlok.com': 'outlook.com',
  'outloo.com': 'outlook.com',
  'yahho.com': 'yahoo.com',
  'yaho.com': 'yahoo.com',
};

export function suggestEmailTypo(value: string): string | null {
  const email = value.trim().toLowerCase();
  const at = email.lastIndexOf('@');
  if (at < 1) return null;
  const domain = email.slice(at + 1);
  const fixed = TYPO_DOMAINS[domain];
  return fixed ? `${email.slice(0, at)}@${fixed}` : null;
}

/** Campos del formulario de invitado que pueden fallar (ids del DOM = `guest-<field>`). */
export type GuestField =
  | 'email'
  | 'recipientName'
  | 'line1'
  | 'line2'
  | 'postalCode'
  | 'neighborhood'
  | 'city'
  | 'state'
  | 'phone'
  | 'references'
  | 'terms'
  | 'emailConfirmed';

/** `typeRequired`: la colonia vacía en modo a mano (§43.18m.7: «Escribe el nombre de tu colonia.»). */
export type GuestErrorCode = 'required' | 'typeRequired' | 'invalid' | 'unconfirmed' | 'tooLong';

export type GuestErrors = Partial<Record<GuestField, GuestErrorCode>>;

export interface GuestFormState {
  email: string;
  emailConfirmed: boolean;
  acceptedTerms: boolean;
  address: GuestAddressInput;
}

export const EMPTY_GUEST_ADDRESS: GuestAddressInput = {
  recipientName: '',
  line1: '',
  line2: '',
  neighborhood: '',
  city: '',
  state: '',
  postalCode: '',
  // País fijo MX: el envío del MVP es solo nacional (PROJECT §D). Una dirección
  // fuera de MX la rechaza el backend con 422 ADDRESS_NOT_MX (criterio 31/48b).
  country: 'MX',
  phone: '',
  references: '',
};

/**
 * Valida el formulario completo. `postalCode` = ^\d{5}$ y `phone` = 10 dígitos MX,
 * exactamente como el `GuestAddressInput` del contrato §4-G.1 (que exige además
 * `recipientName`, porque un invitado no tiene `User.name`).
 *
 * v1.80.12.5 (§M4-SHIP.19.25, §43.18m.7): la colonia es OBLIGATORIA como texto — de la lista o escrita a
 * mano; el texto del error depende del modo (`geoMode`). En «todo a mano» (CP fuera del catálogo, catálogo
 * vacío o consulta fallida) municipio y estado son campos y también se exigen. `references` ≤ 70.
 */
export function validateGuestForm(state: GuestFormState, geoMode: NeighborhoodMode = 'list'): GuestErrors {
  const errors: GuestErrors = {};
  const email = state.email.trim();
  if (!email) errors.email = 'required';
  else if (!isValidEmail(email)) errors.email = 'invalid';
  else if (!state.emailConfirmed) errors.emailConfirmed = 'unconfirmed';

  const a = state.address;
  if (!a.recipientName.trim()) errors.recipientName = 'required';
  if (!a.line1.trim()) errors.line1 = 'required';
  if ((a.line2 ?? '').trim().length > LINE2_MAX) errors.line2 = 'tooLong';
  if (!isPostalCode(a.postalCode)) errors.postalCode = 'invalid';
  else {
    const manual = geoMode === 'manualNeighborhood' || geoMode === 'manualAll';
    if (!(a.neighborhood ?? '').trim()) errors.neighborhood = manual ? 'typeRequired' : 'required';
    if (geoMode === 'manualAll') {
      if (!(a.city ?? '').trim()) errors.city = 'required';
      if (!(a.state ?? '').trim()) errors.state = 'required';
    }
  }
  if (!isMxPhone(a.phone)) errors.phone = 'invalid';
  if ((a.references ?? '').trim().length > REFERENCES_MAX) errors.references = 'tooLong';

  if (!state.acceptedTerms) errors.terms = 'required';
  return errors;
}

/** Normaliza la dirección para el request (el backend vuelve a validar). */
export function toAddressPayload(address: GuestAddressInput): GuestAddressInput {
  return {
    ...address,
    recipientName: address.recipientName.trim(),
    line1: address.line1.trim(),
    line2: address.line2?.trim() || undefined,
    neighborhood: address.neighborhood.trim(),
    city: address.city.trim(),
    state: address.state.trim(),
    postalCode: address.postalCode.trim(),
    phone: normalizeMxPhone(address.phone),
    references: address.references?.trim() || undefined,
    country: 'MX',
  };
}
