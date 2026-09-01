import { BuylistSweepJobService } from '../src/jobs/buylist-sweep.service';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * v1.8-ronda-c / SEC-D2 — el barrido sella `closedAt` en las transiciones TERMINALES, que es lo que
 * ancla la **retención del INE** (LFPDPPP): sin `closedAt` la purga no sabe desde cuándo contar.
 *
 * ⚠️ **v1.51 (§4.39j) — el barrido pasó a SIETE reglas y este spec se actualiza sin perder su tesis.**
 * Lo que cambió de forma: las transiciones van por `updateMany` con guarda (`closedAt: null`) en vez
 * de `update` a pelo, la regla del abandono está **re-anclada en `receivedAt`**, y el retorno del job
 * gana las cifras nuevas. Lo que NO cambia: **toda terminal sella `closedAt = now`**.
 */
describe('BuylistSweepJobService.run — closedAt en transiciones terminales', () => {
  const NOW = new Date('2026-08-16T00:00:00Z');

  function build(rows: Record<string, Record<string, unknown>[]>) {
    const updates: { where: Record<string, unknown>; data: Record<string, unknown> }[] = [];
    const prisma: any = {
      sellRequest: {
        // El fake responde por REGLA (según el `status` pedido), no por orden de llamada: un mock
        // posicional se rompe en cuanto se añade una query, y aquí se añadieron cuatro.
        findMany: jest.fn(async ({ where }: any) => {
          const st = where?.status;
          const key = typeof st === 'string' ? st : (st?.in?.[0] ?? 'otro');
          return rows[key] ?? [];
        }),
        findUnique: jest.fn(async () => ({
          shipmentTrackingNumber: null,
          guideCancellationDoneAt: null,
        })),
        updateMany: jest.fn(async (args: any) => {
          updates.push(args);
          return { count: 1 };
        }),
        update: jest.fn(async () => {
          throw new Error('el barrido NO transiciona con `update`: la guarda es el updateMany');
        }),
      },
    };
    const svc = new BuylistSweepJobService(prisma as PrismaService);
    return { svc, updates };
  }

  it('rechazada (ajuste 7d) y abandonada (30d) llevan closedAt = now', async () => {
    const { svc, updates } = build({
      // Regla 5 — ajuste sin responder (el `in` empieza por `verificacion`).
      verificacion: [{ id: 'sr-rej' }],
      // Regla 6 — abandono, RE-ANCLADO en `receivedAt` (el `in` empieza por `recibida`).
      recibida: [{ id: 'sr-aba' }],
    });
    const res = await svc.run(NOW);
    expect(res).toMatchObject({ rejected: 1, abandoned: 1 });

    const rej = updates.find((u) => u.where.id === 'sr-rej');
    expect(rej?.data).toEqual({ status: 'rechazada', closedAt: NOW });
    // La guarda del motor: no se pisa una solicitud que otro cerró mientras tanto.
    expect(rej?.where).toMatchObject({ closedAt: null });

    const aba = updates.find((u) => u.where.id === 'sr-aba');
    expect(aba?.data).toEqual({ status: 'abandonada', closedAt: NOW });
    expect(aba?.where).toMatchObject({ closedAt: null });
  });
});
