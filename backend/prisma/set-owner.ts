/**
 * set-owner.ts — 🔒💰 marca la cuenta del DUEÑO (`User.isOwner`), API_CONTRACT §M4-SHIP.19.30.1 (2) (v1.80.12.10, C-20).
 *
 * «El dueño» es una marca explícita: exento de los topes de guías (TG-1/TG-2), fuera de los avisos «sobre una persona»,
 * único que cambia los diales de §Z y destinatario de los correos de control del gasto. La escriben SOLO la migración M-68
 * (con exactamente un candidato) y ESTE script (censo `C-OWN-1`: ningún endpoint, servicio ni job escribe `isOwner`).
 * Misma justificación que `reset-admin-password.ts`: quien puede correr esto tiene la consola de Railway — ya es el dueño.
 *
 * `HECHOS.md` fila «El dueño: una sola cuenta de administrador total» (2026-10-04, «Solo la mía»): la migración lo marca
 * sola y este script NO hace falta salvo que la medición C-20 (a) de la ventana diga otra cosa.
 *
 * Uso (en Railway, contra la BD real):
 *   railway run --service backend -e OWNER_EMAIL='correo@del-dueño' npx ts-node prisma/set-owner.ts
 *
 * Reglas: `OWNER_EMAIL` obligatorio (normalizado como el login: trim + minúsculas). Se NIEGA sin cambios si la cuenta no
 * existe o no cumple `user_owner_shape` con `status='active'` (súper-admin, con correo, activo, no borrado). En UNA tx:
 * quita la marca anterior, pone la nueva y escribe la bitácora `user.owner_set {previousOwnerUserId | null}` con actor de
 * sistema (`actorUserId: null`, `after.actor = 'script:set-owner'`). Imprime solo ids.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { normalizeIdentifier } from '../src/common/validation/credentials';

export const SET_OWNER_ACTOR = 'script:set-owner';

export interface SetOwnerResult {
  ownerUserId: string;
  previousOwnerUserId: string | null;
  changed: boolean;
}

export class SetOwnerRefused extends Error {}

export async function setOwner(prisma: PrismaClient, env: { OWNER_EMAIL?: string }): Promise<SetOwnerResult> {
  const email = normalizeIdentifier(env.OWNER_EMAIL ?? '');
  if (!email) throw new SetOwnerRefused('OWNER_EMAIL es obligatorio');
  return prisma.$transaction(
    async (tx: Prisma.TransactionClient) => {
      const target = await tx.user.findUnique({
        where: { email },
        select: { id: true, role: true, email: true, status: true, deletedAt: true, isOwner: true },
      });
      if (!target) throw new SetOwnerRefused('la cuenta no existe');
      if (target.role !== 'super_admin' || target.email === null || target.status !== 'active' || target.deletedAt !== null) {
        throw new SetOwnerRefused('la cuenta no puede ser la del dueño (súper-admin activo con correo, no borrado)');
      }
      const previous = await tx.user.findFirst({ where: { isOwner: true }, select: { id: true } });
      if (previous?.id === target.id) return { ownerUserId: target.id, previousOwnerUserId: target.id, changed: false };
      await tx.user.updateMany({ where: { isOwner: true }, data: { isOwner: false } });
      await tx.user.update({ where: { id: target.id }, data: { isOwner: true } });
      await tx.auditLog.create({
        data: {
          actorUserId: null,
          actorRole: null,
          action: 'user.owner_set',
          entityType: 'User',
          entityId: target.id,
          after: { previousOwnerUserId: previous?.id ?? null, actor: SET_OWNER_ACTOR },
        },
      });
      return { ownerUserId: target.id, previousOwnerUserId: previous?.id ?? null, changed: true };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const r = await setOwner(prisma, process.env);
    // eslint-disable-next-line no-console
    console.log(r.changed ? `dueño marcado: ${r.ownerUserId} (antes: ${r.previousOwnerUserId ?? 'nadie'})` : `sin cambios: ${r.ownerUserId} ya es el dueño`);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`set-owner: ${e instanceof Error ? e.message : String(e)} — nada cambió`);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) void main();
