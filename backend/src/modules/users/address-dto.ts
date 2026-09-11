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
  isDefault: boolean;
}

/** `AddressDTO` del contrato §11 (v1.67: `recipientName: string | null`). */
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
  isDefault: boolean;
}

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
  'isDefault',
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
    isDefault: a.isDefault,
  };
}
