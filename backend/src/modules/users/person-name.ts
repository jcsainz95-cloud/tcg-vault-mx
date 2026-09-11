import { BusinessException } from '../../common/business.exception';

/** Cota compartida por `User.name`, `Address.recipientName` y `GuestAddressInput.recipientName` (contrato §1). */
export const PERSON_NAME_MAX = 120;

export type PersonNameField = 'name' | 'recipientName';

/**
 * v1.67 (contrato §1 `PATCH /users/me` y «Direcciones»; ARCHITECTURE §4.47.4/§4.47.5) — **normaliza y
 * valida un nombre de persona en UN solo sitio.** Reglas: `trim` server-side; tras el trim, **1..120**
 * caracteres. Vacío, ausente, `null`, no-string o mayor ⇒ `400 VALIDATION_ERROR` con
 * `details.field` (la forma que el contrato pide para que el front marque el campo).
 *
 * Vive en el servicio y no solo en el DTO porque el `ValidationPipe` global no emite `details.field`
 * (serializa `message[]`), y porque `@IsOptional()` deja pasar `null` — y un `PATCH { recipientName:
 * null }` escribiría `NULL` en una dirección que ya tenía destinatario, justo lo que el contrato
 * prohíbe («no vaciable»). El DTO recorta y exige string; la regla de negocio se decide aquí.
 */
export function assertPersonName(value: unknown, field: PersonNameField): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (trimmed.length === 0) {
    throw BusinessException.badRequest('VALIDATION_ERROR', `${field} is required (1..${PERSON_NAME_MAX} chars)`, {
      field,
    });
  }
  if (trimmed.length > PERSON_NAME_MAX) {
    throw BusinessException.badRequest(
      'VALIDATION_ERROR',
      `${field} must be at most ${PERSON_NAME_MAX} chars`,
      { field, max: PERSON_NAME_MAX },
    );
  }
  return trimmed;
}
