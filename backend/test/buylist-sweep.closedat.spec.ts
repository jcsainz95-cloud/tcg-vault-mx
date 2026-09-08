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
 *
 * ⚠️⚠️ **v1.51.22 (B-1) — ESTE SPEC BENDECÍA LA VERSIÓN DÉBIL.** Su aserción de guarda era
 * `expect(where).toMatchObject({ closedAt: null })`, que pasa **exactamente igual** con el `where`
 * incompleto (`{ id, closedAt: null }`) que era el hallazgo. `toMatchObject` afirma un subconjunto:
 * *un test que solo mira el término que sobrevivió no puede detectar los que faltan.* Ahora se exige
 * el predicado **COMPLETO** de cada regla. La carrera (fila movida entre lectura y escritura) vive
 * en `buylist-sweep.write-predicate.spec.ts`, que es su sitio; aquí se cierra el hueco de ESTA
 * aserción para que el spec no vuelva a dar cobertura falsa.
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
    // ⚠️ B-1: la guarda del motor es el PREDICADO ENTERO de la lectura, no solo `closedAt`. Con
    // `toEqual` en vez de `toMatchObject`, quitar un término rompe aquí.
    expect(rej?.where).toEqual({
      id: 'sr-rej',
      status: { in: ['verificacion', 'aprobada'] },
      closedAt: null,
      adjustmentSentAt: { not: null, lte: new Date('2026-08-09T00:00:00Z') },
    });

    const aba = updates.find((u) => u.where.id === 'sr-aba');
    expect(aba?.data).toEqual({ status: 'abandonada', closedAt: NOW });
    expect(aba?.where).toEqual({
      id: 'sr-aba',
      status: { in: ['recibida', 'verificacion', 'aprobada'] },
      closedAt: null,
      receivedAt: { not: null, lte: new Date('2026-07-17T00:00:00Z') },
    });
  });

  it('⚠️ B-1 — las reglas 1 y 2 escriben con el predicado con el que LEYERON', async () => {
    // Las dos que cierran con `closeWithGuideTask`, que era donde vivía el `where` de dos términos.
    const { svc, updates } = build({
      ofertada: [{ id: 'sr-of' }],
      aceptada: [{ id: 'sr-ac' }],
    });
    await svc.run(NOW);

    expect(updates.find((u) => u.where.id === 'sr-of')?.where).toEqual({
      id: 'sr-of',
      status: 'ofertada',
      closedAt: null,
      offerAcceptDeadlineAt: { lte: NOW },
    });
    // Los DOS candados del §P.13, en la ESCRITURA: es el hallazgo B-1 en su forma más cara.
    expect(updates.find((u) => u.where.id === 'sr-ac')?.where).toEqual({
      id: 'sr-ac',
      status: 'aceptada',
      closedAt: null,
      shipDeadlineAt: { not: null, lte: NOW },
      sellerShippedDeclaredAt: null,
      shipmentConfirmedAt: null,
    });
  });
});
