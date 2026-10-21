/**
 * C-B11 (API_CONTRACT v1.106 §MKT.H.7/.11) — Postgres REAL: `MeasurementContext` con exactamente un sujeto. Con los dos
 * (`orderId` y `sellRequestId`) o con ninguno ⇒ `23514` (check_violation); con uno ⇒ OK. Canario: quitar el CHECK del SQL de
 * m86 ⇒ las dos primeras pasan a OK y esta prueba sale roja.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const RUN = Date.now().toString(36);
const ids: string[] = [];

/** SQLSTATE del error de Postgres (Prisma lo envuelve en P2010 con `meta.code`), u 'ok'. */
async function sqlstate(id: string, orderId: string | null, sellRequestId: string | null): Promise<string> {
  ids.push(id);
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "MeasurementContext" ("id", "orderId", "sellRequestId", "expiresAt") VALUES ($1, $2, $3, now() + interval '1 day')`,
      id,
      orderId,
      sellRequestId,
    );
    return 'ok';
  } catch (e) {
    const err = e as { meta?: { code?: string }; code?: string; message?: string };
    return err.meta?.code ?? err.code ?? String(err.message);
  }
}

afterAll(async () => {
  await prisma.measurementContext.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

describe('C-B11 · CHECK "MeasurementContext_one_subject"', () => {
  it('el CHECK existe en el esquema actual con num_nonnulls(orderId, sellRequestId) = 1', async () => {
    const rows = await prisma.$queryRawUnsafe<{ def: string }[]>(
      `SELECT pg_get_constraintdef(c.oid) AS def FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE c.conname = 'MeasurementContext_one_subject' AND n.nspname = current_schema()`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].def).toMatch(/num_nonnulls\("orderId", "sellRequestId"\) = 1/);
  });

  it('los dos sujetos ⇒ 23514; ninguno ⇒ 23514; solo pedido o solo solicitud ⇒ OK', async () => {
    expect(await sqlstate(`cb11-both-${RUN}`, `o-${RUN}`, `s-${RUN}`)).toBe('23514');
    expect(await sqlstate(`cb11-none-${RUN}`, null, null)).toBe('23514');
    expect(await sqlstate(`cb11-order-${RUN}`, `o1-${RUN}`, null)).toBe('ok');
    expect(await sqlstate(`cb11-sell-${RUN}`, null, `s1-${RUN}`)).toBe('ok');
  });
});
