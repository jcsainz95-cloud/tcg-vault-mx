import type { ProductType, Role } from '@/types/contract';

/**
 * §M11-SP.3 — **un predicado** decide quién pone o cambia el precio de venta del sellado (el dueño). Hoy
 * `super_admin` (desviación temporal `D-SP-1`); al fusionar con Skydropx pasa a `me.isOwner`, en el mismo PR de la
 * fusión. ⛔ Ningún otro sitio del front decide el rol del precio del sellado. La hoja no lo usa: lee `canEdit` del
 * servidor.
 *
 * Vive fuera de `role.tsx` (que es el contexto React) a propósito: es pura, y los tests que simulan `useRole` con
 * `vi.mock('@/lib/role')` no tienen que replicarla (se probaría el doble, no el predicado).
 */
export function canSetSealedPrice(role: Role): boolean {
  return role === 'super_admin';
}

/**
 * §M11-SP.13.5.1 (v1.83.3, C-2 del techlead) — de quién es el precio de una pieza sellada, decidido en UN sitio:
 * - `productType !== 'sealed'` ⇒ `'unknown'` (raw/graded no montan nada de esto; P-PRE-1).
 * - sellado con `sealedProductId: string` ⇒ `'linked'` (su precio es del PRODUCTO).
 * - sellado con `sealedProductId: null` ⇒ `'unlinked'` (precio por pieza, antes de IVA).
 * - ⛔ clave **ausente** (u otro valor) ⇒ `'unknown'` ⇒ **solo lectura** (falla cerrado). No es «servidor anterior»:
 *   el servidor anterior ya mandaba la clave en el listado (§M11-SP.13.5); la ausencia de un dato nunca abre un
 *   permiso (`ARCHITECTURE §4.62.9 (d)`).
 */
export type SealedPieceLink = 'linked' | 'unlinked' | 'unknown';

export function sealedPieceLinkOf(row: { productType: ProductType; sealedProductId?: string | null }): SealedPieceLink {
  if (row.productType !== 'sealed') return 'unknown';
  if (typeof row.sealedProductId === 'string') return 'linked';
  if (row.sealedProductId === null) return 'unlinked';
  return 'unknown';
}

/**
 * §M11-SP.13.5.1 — **única** puerta del editor de precio POR PIEZA (`SealedFinalPrice`, D-SP-4): solo la pieza
 * sellada sin producto, y solo el dueño. `'linked'` ⇒ `false` (editor de producto) · `'unknown'` ⇒ `false`.
 */
export function canEditSealedPiecePrice(
  role: Role,
  row: { productType: ProductType; sealedProductId?: string | null },
): boolean {
  return sealedPieceLinkOf(row) === 'unlinked' && canSetSealedPrice(role);
}
