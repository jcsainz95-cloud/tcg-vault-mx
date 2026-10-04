/**
 * address-rules.ts — EL juego de cotas y reglas de una dirección MX (fase C, M-64; API_CONTRACT §M4-SHIP.19.5,
 * §19.20.1, §4-G.1, §1 «Direcciones»). Propiedad: backend (`users`).
 *
 * §19.20.1 pide «un juego de validadores compartido, ⛔ no una copia» entre `GuestAddressInput`, la libreta y la
 * corrección de la dirección del envío. Las cotas vigentes se MIDIERON en `GuestAddressInput`
 * (`orders/dto/guest-checkout.dto.ts`, sobre 3238ece1): `line1` 200, `line2` 200, `neighborhood`/`city`/`state`/
 * `recipientName` 120, CP `^\d{5}$`, teléfono `^\d{10}$`. Donde §19.20.1 decía otra cifra (`line2` 0..120) manda la
 * del invitado, como ordena el propio contrato. Los tres DTO citan ESTAS constantes.
 */
import { BusinessException } from '../../common/business.exception';
import { PERSON_NAME_MAX } from './person-name';

export const ADDRESS_LIMITS = {
  recipientName: PERSON_NAME_MAX,
  line1: 200,
  line2: 200,
  neighborhood: 120,
  city: 120,
  state: 120,
  references: 70,
} as const;
export const POSTAL_CODE_PATTERN = /^\d{5}$/;
export const PHONE_PATTERN = /^\d{10}$/;

export type AddressMissingField = 'neighborhood' | 'postalCode' | 'phone';

/** Lo que una dirección (fila de la libreta o snapshot) necesita para servir a una guía. */
export interface CompletenessInput {
  neighborhood?: unknown;
  postalCode?: unknown;
  phone?: unknown;
}

/**
 * `AddressDTO.complete` (§19.5) = `neighborhood ≠ null ∧ postalCode ~ ^\d{5}$ ∧ phone ~ ^\d{10}$`; aquí devuelve
 * QUÉ falta, en el orden de `ADDRESS_INCOMPLETE.details.missing`. Una colonia en blanco cuenta como ausente.
 */
export function addressMissing(a: CompletenessInput): AddressMissingField[] {
  const missing: AddressMissingField[] = [];
  if (typeof a.neighborhood !== 'string' || a.neighborhood.trim().length === 0) missing.push('neighborhood');
  if (typeof a.postalCode !== 'string' || !POSTAL_CODE_PATTERN.test(a.postalCode)) missing.push('postalCode');
  if (typeof a.phone !== 'string' || !PHONE_PATTERN.test(a.phone)) missing.push('phone');
  return missing;
}

export function isAddressComplete(a: CompletenessInput): boolean {
  return addressMissing(a).length === 0;
}

/** `""`/solo espacios/ausente ⇒ `null`; si no, el valor recortado. Para los opcionales (`line2`, `references`). */
export function blankToNull(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length === 0 ? null : t;
}

function invalid(field: string, reason: string, extra: Record<string, unknown> = {}): BusinessException {
  return BusinessException.badRequest('VALIDATION_ERROR', `${field}: ${reason}`, { field, reason, ...extra });
}

/** Texto obligatorio: string, trim, 1..max. ⇒ `400 VALIDATION_ERROR {field}`. */
export function requiredText(body: Record<string, unknown>, field: keyof typeof ADDRESS_LIMITS): string {
  const v = body[field];
  if (typeof v !== 'string' || v.trim().length === 0) throw invalid(field, 'required');
  const t = v.trim();
  if (t.length > ADDRESS_LIMITS[field]) throw invalid(field, 'too_long', { max: ADDRESS_LIMITS[field] });
  return t;
}

/** Texto opcional: ausente/`null`/blanco ⇒ `null`; si no, trim + ≤ max. ⇒ `400 VALIDATION_ERROR {field}`. */
export function optionalText(body: Record<string, unknown>, field: keyof typeof ADDRESS_LIMITS): string | null {
  const v = body[field];
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') throw invalid(field, 'not_a_string');
  const t = v.trim();
  if (t.length === 0) return null;
  if (t.length > ADDRESS_LIMITS[field]) throw invalid(field, 'too_long', { max: ADDRESS_LIMITS[field] });
  return t;
}

export function requiredPostalCode(body: Record<string, unknown>, field = 'postalCode'): string {
  const v = body[field];
  if (typeof v !== 'string' || !POSTAL_CODE_PATTERN.test(v.trim())) throw invalid(field, 'pattern', { pattern: '^\\d{5}$' });
  return v.trim();
}
