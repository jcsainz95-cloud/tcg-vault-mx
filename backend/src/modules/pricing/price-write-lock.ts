import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * §PRICE-PATTERN 6.6 (IMP-B, PP-11) — candado consultivo COMPARTIDO entre la INGESTA de precios de mercado y la PRUEBA del job `pattern-reclassify`.
 *  - La ingesta (`persistMarketReference`, `persistArbiterReference`, `upsertVariantPrice`, los imports de set) lo toma en modo COMPARTIDO
 *    (`pg_advisory_xact_lock_shared`): muchas escrituras de ingesta a la vez, sin estorbarse.
 *  - Cada LOTE de la prueba (≤ 50 cartas, una transacción de ≤ 60 s) lo toma EXCLUSIVO: mientras dura, la ingesta espera (≤ 60 s) y nadie escribe
 *    precios a mitad de la medición; al COMMIT/ROLLBACK se suelta solo.
 * Censo: `lock-keys.census.spec.ts` (clave propia, distinta de las demás).
 */
export const PRICE_WRITE_LOCK_KEY = 91_170_218;
/** La ingesta espera como máximo lo que dura un lote de la prueba (60 s) más margen de commit. */
export const PRICE_WRITE_INGEST_TX_TIMEOUT_MS = 70_000;

/** Toma el candado EXCLUSIVO dentro de `tx` (lote de la prueba). Se libera al terminar la transacción. */
export async function lockPriceWriteExclusive(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PRICE_WRITE_LOCK_KEY}::bigint)`;
}

/** Toma el candado COMPARTIDO dentro de `tx` (ingesta). Reentrante: tomarlo dos veces en la misma transacción es inocuo. */
export async function lockPriceWriteShared(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(${PRICE_WRITE_LOCK_KEY}::bigint)`;
}

/**
 * Ejecuta `fn` con el candado compartido: si `db` YA es una transacción, solo lo toma (se suelta cuando ella cierre); si es el cliente raíz, abre una
 * transacción corta que lo sostiene mientras `fn` escribe. Los bucles calientes de la ingesta llaman esto UNA vez por tanda de filas.
 */
export async function withPriceWriteShared<T>(db: Prisma.TransactionClient | PrismaService, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  if (!('$transaction' in db)) {
    await lockPriceWriteShared(db);
    return fn(db);
  }
  return (db as PrismaService).$transaction(
    async (tx) => {
      await lockPriceWriteShared(tx);
      return fn(tx);
    },
    { timeout: PRICE_WRITE_INGEST_TX_TIMEOUT_MS, maxWait: 10_000 },
  );
}
