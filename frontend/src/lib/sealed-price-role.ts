import type { Role } from '@/types/contract';

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
