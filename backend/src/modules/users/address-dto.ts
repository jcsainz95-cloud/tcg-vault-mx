/**
 * address-dto.ts — **LA ÚNICA proyección de `Address` → `AddressDTO` (contrato §11) en todo el backend.**
 * Propiedad: backend (módulo `users`).
 *
 * v1.67.1 (techlead F2-2, `D-CTA-8`, contrato §M6): antes había DOS copias de esta lista blanca —
 * `UsersService.toAddressDTO` y `toAdminUserAddressRef` en `admin.service.ts`— y la segunda **omitía
 * `recipientName`**, así que la ficha 360° de M6 no servía como remedio del retiro «sin destinatario»
 * (`422 RECIPIENT_NAME_REQUIRED`, §5/§M4). Una lista blanca copiada a mano diverge en silencio la
 * primera vez que alguien añade una columna: por eso el contrato prohíbe la segunda copia y esta
 * función se exporta para que `/users/me/addresses` (§1) y `GET /admin/users/:id` (§M6) emitan
 * **exactamente la misma forma** (`test/address-dto.parity.spec.ts` lo exige).
 *
 * v2.1.9 (S49-R4) — por qué se proyecta y no se devuelve la fila: no hay secreto en una dirección
 * (es del propio usuario que pregunta), pero la norma «ningún endpoint devuelve una entidad Prisma»
 * sólo vale si es universal: mientras la respuesta SEA la fila, cualquier columna futura (una
 * geocodificación, un flag de verificación, un id de proveedor logístico) viaja al cliente sin que
 * nadie lo decida. `userId`, `createdAt` y `updatedAt` se quedan fuera a propósito.
 */

import { isAddressComplete } from './address-rules';

/** Las columnas de `Address` que la proyección lee. Estructural: cualquier fila Prisma la cumple. */
export interface AddressRow {
  id: string;
  recipientName: string | null;
  line1: string;
  line2: string | null;
  neighborhood: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone: string;
  /** ⭐ v1.81 (M-64, §M4-SHIP.19.5): referencias para el repartidor. */
  references: string | null;
  isDefault: boolean;
}

/** `AddressDTO` del contrato §11 (v1.67: `recipientName: string | null`; v1.81: `references`, `complete`). */
export interface AddressDTO {
  id: string;
  recipientName: string | null;
  line1: string;
  line2: string | null;
  neighborhood: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone: string;
  references: string | null;
  isDefault: boolean;
  /**
   * ⭐ v1.81 (§M4-SHIP.19.5) — DERIVADO (⛔ no es columna): `neighborhood ≠ null ∧ postalCode ~ ^\d{5}$ ∧ phone ~
   * ^\d{10}$` (`addressMissing`, `address-rules.ts`). `false` ⇒ un retiro con ella da `422 ADDRESS_INCOMPLETE`.
   */
  complete: boolean;
}

/**
 * ⭐ v1.81 — las COLUMNAS que la proyección lee (lo que un `select` de Prisma pide). `complete` no está: se deriva.
 */
export const ADDRESS_ROW_KEYS: readonly (keyof AddressRow)[] = [
  'id',
  'recipientName',
  'line1',
  'line2',
  'neighborhood',
  'city',
  'state',
  'postalCode',
  'country',
  'phone',
  'references',
  'isDefault',
] as const;

/**
 * Las claves de `AddressDTO`, en el orden del contrato. Se exporta para que el test de paridad y
 * cualquier aserción de forma citen UNA lista, no una copia.
 */
export const ADDRESS_DTO_KEYS: readonly (keyof AddressDTO)[] = [
  'id',
  'recipientName',
  'line1',
  'line2',
  'neighborhood',
  'city',
  'state',
  'postalCode',
  'country',
  'phone',
  'references',
  'isDefault',
  'complete',
] as const;

export function toAddressDTO(a: AddressRow): AddressDTO {
  return {
    id: a.id,
    // v1.67 (M-52): `null` SOLO en filas anteriores a la migración (contrato §11 `AddressDTO`).
    recipientName: a.recipientName,
    line1: a.line1,
    line2: a.line2,
    neighborhood: a.neighborhood,
    city: a.city,
    state: a.state,
    postalCode: a.postalCode,
    country: a.country,
    phone: a.phone,
    references: a.references,
    isDefault: a.isDefault,
    complete: isAddressComplete(a),
  };
}
