/**
 * **La regla del nombre del cliente (§36.4 · V1/V2)**, en UN solo sitio.
 *
 * `null` es la única marca de ausencia que manda el servidor (`customerDisplayName`, §M4-VAULT.3:
 * en blanco o fabricado del correo ⇒ `null`); una cadena en blanco (servidor no conforme) se lee
 * igual. Devuelve el nombre recortado o `null`. ⛔ Nunca reconstruye un nombre desde el correo.
 *
 * La usan `CustomerNameBlock` (tarjeta de la cola y vista «Qué debe haber») y la cabecera de
 * `VaultDetailView`. Antes la cabecera repetía el `trim` a mano: tres sitios para una regla
 * (D6 del techlead). Módulo sin `'use client'`: es lógica pura, importable desde cualquier lado.
 */
export function customerDisplayName(name: string | null | undefined): string | null {
  const trimmed = name?.trim();
  return trimmed ? trimmed : null;
}
