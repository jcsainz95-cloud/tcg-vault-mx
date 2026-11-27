import { PrismaService } from '../../prisma/prisma.service';

/**
 * §AUTO-ENLACE fase 2 — llave del candado consultivo COMPARTIDO entre `catalog-auto-link` y `price-ingest`
 * (DECISIONES §AUTO-ENLACE 3). `catalog-auto-link` lo toma EXCLUSIVO (`pg_try_advisory_xact_lock`) durante toda su corrida;
 * `price-ingest` (parent del fan-out y barrido secuencial) lo consulta COMPARTIDO al arrancar y, si el auto-enlace lo tiene, se salta.
 */
export const AUTO_LINK_PRICE_LOCK_KEY = 7_241_100_501;

/**
 * `true` si ahora mismo una corrida de `catalog-auto-link` tiene el candado (consulta instantánea). Va en una transacción corta
 * (`xact`): el pool reparte conexiones, así que un candado de sesión no se podría soltar de forma fiable.
 */
export async function autoLinkLockHeld(prisma: Pick<PrismaService, '$transaction'>): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock_shared(${AUTO_LINK_PRICE_LOCK_KEY}::bigint) AS ok`;
    return rows[0]?.ok !== true;
  });
}
