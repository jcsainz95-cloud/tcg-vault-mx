import { BusinessException } from '../../common/business.exception';

/** Cota compartida por `User.name`, `Address.recipientName` y `GuestAddressInput.recipientName` (contrato §1). */
export const PERSON_NAME_MAX = 120;

export type PersonNameField = 'name' | 'recipientName';

/**
 * v1.67 (contrato §1 `PATCH /users/me` y «Direcciones»; ARCHITECTURE §4.47.4/§4.47.5) — **normaliza y
 * valida un nombre de persona en UN solo sitio.** Reglas: `trim` server-side; tras el trim, **1..120**
 * caracteres.
 *
 * Quién corta qué (v1.67.1, techlead F2-6 — esto describe lo que pasa, no lo que se querría):
 *  - **Ausente o no-string** (`POST /users/me/addresses` sin `recipientName`, `{ name: 42 }`…): lo corta
 *    ANTES el `ValidationPipe` global (`@IsString()` del DTO) con `400 VALIDATION_ERROR` y `message[]`
 *    de class-validator — **sin `details.field`** (el pipe no lo emite; darle esa forma exige un
 *    `exceptionFactory` en `main.ts`, anotado en `docs/TECH_DEBT.md`). Esta función **no llega a verlo**.
 *  - **Lo que sí llega aquí**: `""`/solo espacios (el DTO recorta pero no exige longitud), `null` (un
 *    `@IsOptional()` lo deja pasar) y `>120`. Los tres ⇒ `400 VALIDATION_ERROR` **con `details.field`**
 *    (la forma que el contrato pide para que el front marque el campo).
 *
 * Vive en el servicio y no solo en el DTO porque `@IsOptional()` deja pasar `null` — y un
 * `PATCH { recipientName: null }` escribiría `NULL` en una dirección que ya tenía destinatario, justo
 * lo que el contrato prohíbe («no vaciable»)—, y porque es aquí donde se puede decir QUÉ campo falló.
 * El DTO recorta y exige string; la regla de negocio se decide aquí.
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
