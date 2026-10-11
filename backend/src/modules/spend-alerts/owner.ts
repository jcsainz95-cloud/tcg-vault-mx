/**
 * owner.ts — 🔒💰 ¿es la cuenta del DUEÑO? (API_CONTRACT §M4-SHIP.19.30.1 (3), C-20 / SDX-Z-1 — sustituye §19.29.3).
 *
 * Función PURA con un conjunto explícito (patrón C-13): la MARCA `User.isOwner` **y** súper-admin **y** con correo **y**
 * activa **y** no borrada. ⛔ Ni «súper-admin con correo» (M-63 conservó el correo de todo súper-admin anterior a v1.80.9),
 * ⛔ ni `role !== 'vault_operator'`. Se lee de la BASE en la tx (⛔ nunca del JWT).
 *
 * Decide: exento de TG-1/TG-2; fuera de los avisos «sobre una persona» (AG-1…AG-4, AG-13, AG-22); destinatario de los
 * correos de control del gasto; único que mueve los diales de §Z. Sin dueño ⇒ falla cerrado (nadie exento).
 */
import { Role, UserStatus } from '@prisma/client';

export interface OwnerCandidate {
  isOwner: boolean;
  role: Role;
  email: string | null;
  status: UserStatus;
  deletedAt: Date | null;
}

export function isOwnerAccount(u: OwnerCandidate | null | undefined): boolean {
  if (!u) return false;
  return u.isOwner === true && u.role === Role.super_admin && u.email !== null && u.email.trim() !== '' && u.status === UserStatus.active && u.deletedAt === null;
}

/** El `select` mínimo para `isOwnerAccount` (una lectura, en la tx del llamador). */
export const OWNER_SELECT = { isOwner: true, role: true, email: true, status: true, deletedAt: true } as const;
