import { DisputeStatus } from '@prisma/client';
import { DisputesService, DISPUTE_RESOLVABLE_STATES } from '../src/modules/disputes/disputes.service';
import { DisputeDeadlineJobService } from '../src/jobs/dispute-deadline.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { StripeService } from '../src/modules/payments/stripe.service';
import { BusinessException } from '../src/common/business.exception';
import { matchesWhere } from './helpers/prisma-where';

/**
 * `disputes.resolve-guard.spec.ts` — **§M8 v1.68: `resolve` obedece la doctrina de §M5-T y el job de
 * plazo no revive resueltas** (ARCHITECTURE §4.48.4).
 *
 * ### El defecto que reproduce (medido 2026-09-11)
 * `resolve` hacía `findUnique` + `update({ where: { id } })` **sin término de estado**: una disputa
 * `resuelta_recompra` se podía «resolver» otra vez y `reject` la pasaba a `rechazada` — el `status`
 * perdía el rastro de un money-out. El job hacía `findMany` + `update` por fila (**read-then-write**):
 * una disputa resuelta entre la lectura y la escritura **volvía a `en_revision`**.
 *
 * ### ⚠️ Por qué el Prisma de aquí EVALÚA el `where`
 * La guarda **es** el `where`; un fake que devuelve `{count:1}` a ciegas pasa igual con y sin ella.
 * Aquí `count` es el resultado de evaluar el `where` contra el universo de filas.
 *
 * ### Candados
 * | Mutación | Test que cae |
 * |---|---|
 * | **m6**: volver `resolve` a `update({ where: { id } })` sin guarda | **D-1**: la segunda resolución pasa a `200` y el `status` cambia |
 * | `count !== 1` → sin comprobar | D-1 |
 * | volver el job a `findMany` + `update` por fila | «el job es UN `updateMany` con la guarda en el `where`» y **D-2** |
 * | quitar `status: 'abierta'` del `where` del job | D-2 (la resuelta vuelve a `en_revision`) |
 */

type Row = Record<string, any>;

function dispute(over: Row = {}): Row {
  return {
    id: 'd1',
    userId: 'u1',
    inventoryItemId: 'item1',
    orderItemId: null,
    type: 'condition_raw',
    status: 'abierta' as DisputeStatus,
    description: 'llegó dañada',
    resolution: null,
    repurchaseOrderId: null,
    deadlineAt: new Date('2026-09-08T00:00:00Z'),
    createdAt: new Date('2026-09-01T00:00:00Z'),
    resolvedAt: null,
    resolvedBy: null,
    ...over,
  };
}

/** Prisma de mentira con un UNIVERSO de filas que evalúa el `where` de `updateMany`. */
function harness(rows: Row[]) {
  const universe = rows.map((r) => ({ ...r }));
  const writes: { where: Row; data: Row }[] = [];
  const prisma: any = {
    dispute: {
      findUnique: jest.fn(async ({ where }: { where: Row }) => {
        const r = universe.find((x) => x.id === where.id);
        return r ? { ...r } : null;
      }),
      findMany: jest.fn(async ({ where }: { where: Row }) =>
        universe.filter((r) => matchesWhere(r, where)).map((r) => ({ ...r })),
      ),
      updateMany: jest.fn(async ({ where, data }: { where: Row; data: Row }) => {
        writes.push({ where, data });
        const hit = universe.filter((r) => matchesWhere(r, where));
        for (const r of hit) Object.assign(r, data);
        return { count: hit.length };
      }),
      update: jest.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const r = universe.find((x) => x.id === where.id)!;
        Object.assign(r, data);
        return { ...r };
      }),
    },
    orderItem: { findFirst: jest.fn(async () => ({ unitPriceCents: 12_500 })) },
    inventoryItem: { update: jest.fn(), findUnique: jest.fn() },
    inventoryMovement: { create: jest.fn() },
  };
  prisma.$transaction = jest.fn(async (cb: (tx: unknown) => unknown) => cb(prisma));
  const svc = new DisputesService(prisma as PrismaService, {} as StripeService);
  const job = new DisputeDeadlineJobService(prisma as PrismaService);
  const row = (id: string) => universe.find((r) => r.id === id)!;
  return { svc, job, prisma, row, writes };
}

// =================================================================================================
describe('§M8 · `resolve` — la guarda de estado va en el `where` del `updateMany`, con `count === 1`', () => {
  it('D-1 ⭐ `repurchase` y luego `reject` sobre la misma disputa ⇒ 200 · 409 CONFLICT, sigue `resuelta_recompra`', async () => {
    const h = harness([dispute()]);
    const primera = await h.svc.resolve('d1', 'repurchase', 'daño confirmado', 'admin1');
    expect(primera.status).toBe('resuelta_recompra');
    expect(h.row('d1').status).toBe('resuelta_recompra');
    const resueltaEn = h.row('d1').resolvedAt;
    expect(resueltaEn).toBeInstanceOf(Date);

    const err = await h.svc.resolve('d1', 'reject', 'me arrepentí', 'admin2').catch((e) => e);
    expect(err).toBeInstanceOf(BusinessException);
    expect(err.getStatus()).toBe(409);
    expect(err.getResponse()).toMatchObject({
      code: 'CONFLICT',
      details: { status: 'resuelta_recompra', resolvedAt: resueltaEn },
    });
    // Cero escritura: el estado, la fecha, el actor y la nota de la PRIMERA resolución siguen.
    expect(h.row('d1').status).toBe('resuelta_recompra');
    expect(h.row('d1').resolvedAt).toEqual(resueltaEn);
    expect(h.row('d1').resolvedBy).toBe('admin1');
    expect(h.row('d1').resolution).toContain('daño confirmado');
    expect(h.prisma.dispute.update).not.toHaveBeenCalled();
  });

  it('⛔ NO es idempotente: repetir la MISMA resolución también es 409 (dos registros de un money-out)', async () => {
    const h = harness([dispute()]);
    await h.svc.resolve('d1', 'repurchase', 'daño', 'admin1');
    await expect(h.svc.resolve('d1', 'repurchase', 'daño', 'admin1')).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it.each([['abierta'], ['en_revision']] as const)('desde `%s` (viva) sí resuelve', async (status) => {
    const h = harness([dispute({ status })]);
    const res = await h.svc.resolve('d1', 'reject', 'sin evidencia', 'op1');
    expect(res.status).toBe('rechazada');
    expect(h.row('d1').resolvedBy).toBe('op1');
  });

  it.each([['resuelta_recompra'], ['rechazada']] as const)(
    'desde `%s` (ya resuelta) ⇒ 409 CONFLICT { status, resolvedAt } y cero escritura',
    async (status) => {
      const antes = new Date('2026-09-04T00:00:00Z');
      const h = harness([dispute({ status, resolvedAt: antes, resolvedBy: 'x' })]);
      const err = await h.svc.resolve('d1', 'reject', 'otra vez', 'op1').catch((e) => e);
      expect(err.getResponse()).toMatchObject({
        code: 'CONFLICT',
        details: { status, resolvedAt: antes },
      });
      expect(h.row('d1').status).toBe(status);
      expect(h.row('d1').resolvedBy).toBe('x');
    },
  );

  it('el `where` lleva `id` y `status in DISPUTE_RESOLVABLE_STATES` — evaluado contra los cuatro estados', async () => {
    const h = harness([dispute()]);
    await h.svc.resolve('d1', 'reject', 'n', 'op1');
    const w = h.writes.find((x) => 'status' in x.data)!.where;
    expect(w).toEqual({ id: 'd1', status: { in: [...DISPUTE_RESOLVABLE_STATES] } });
    for (const s of Object.values(DisputeStatus)) {
      const viva = (DISPUTE_RESOLVABLE_STATES as readonly string[]).includes(s);
      expect(matchesWhere(dispute({ status: s }), w)).toBe(viva);
    }
  });

  it('⚠️ la carrera: la fila cambia entre el `findUnique` y el `updateMany` ⇒ 409 con el estado REAL', async () => {
    // El `findUnique` de arriba autoriza (404) y aporta `inventoryItemId`; NO protege la fila.
    const h = harness([dispute()]);
    const resueltaEn = new Date('2026-09-06T00:00:00Z');
    h.prisma.dispute.findUnique.mockImplementationOnce(async () => dispute()); // lectura VIEJA: abierta
    Object.assign(h.row('d1'), { status: 'rechazada', resolvedAt: resueltaEn, resolvedBy: 'otro' });
    const err = await h.svc.resolve('d1', 'repurchase', 'n', 'admin1').catch((e) => e);
    expect(err.getResponse()).toMatchObject({
      code: 'CONFLICT',
      details: { status: 'rechazada', resolvedAt: resueltaEn },
    });
    expect(h.row('d1').status).toBe('rechazada');
    expect(h.row('d1').resolvedBy).toBe('otro');
  });

  it('disputa inexistente ⇒ 404 (no 409)', async () => {
    const h = harness([]);
    await expect(h.svc.resolve('nope', 'reject', 'n', 'op1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

// =================================================================================================
describe('§M8 · job `dispute-deadline` — UN `updateMany` con la guarda en el `where`, cero read-then-write', () => {
  const AHORA = new Date('2026-09-11T12:00:00Z');
  const VENCIDA = new Date('2026-09-10T00:00:00Z');
  const FUTURA = new Date('2026-09-20T00:00:00Z');

  it('mueve a `en_revision` SOLO las `abierta` vencidas y devuelve `{ expired: count }`', async () => {
    const h = harness([
      dispute({ id: 'vencida', deadlineAt: VENCIDA }),
      dispute({ id: 'futura', deadlineAt: FUTURA }),
      dispute({ id: 'ya-en-revision', status: 'en_revision', deadlineAt: VENCIDA }),
      dispute({ id: 'recompra', status: 'resuelta_recompra', deadlineAt: VENCIDA, resolvedAt: AHORA }),
      dispute({ id: 'rechazada', status: 'rechazada', deadlineAt: VENCIDA, resolvedAt: AHORA }),
    ]);
    const res = await h.job.run(AHORA);
    expect(res).toEqual({ expired: 1 });
    expect(h.row('vencida').status).toBe('en_revision');
    expect(h.row('futura').status).toBe('abierta');
    expect(h.row('ya-en-revision').status).toBe('en_revision');
    expect(h.row('recompra').status).toBe('resuelta_recompra');
    expect(h.row('rechazada').status).toBe('rechazada');
  });

  it('el job es UN `updateMany` con `status: abierta` y `deadlineAt <= now` en el `where`; sin `findMany` ni `update`', async () => {
    const h = harness([dispute({ id: 'vencida', deadlineAt: VENCIDA })]);
    await h.job.run(AHORA);
    expect(h.prisma.dispute.findMany).not.toHaveBeenCalled();
    expect(h.prisma.dispute.update).not.toHaveBeenCalled();
    expect(h.prisma.dispute.updateMany).toHaveBeenCalledTimes(1);
    expect(h.prisma.dispute.updateMany).toHaveBeenCalledWith({
      where: { status: 'abierta', deadlineAt: { lte: AHORA } },
      data: { status: 'en_revision' },
    });
  });

  it('D-2 ⭐ disputa `abierta` vencida: resolverla Y correr el job (en ese orden) ⇒ sigue resuelta', async () => {
    const h = harness([dispute({ id: 'd1', deadlineAt: VENCIDA })]);
    await h.svc.resolve('d1', 'repurchase', 'daño', 'admin1');
    expect(h.row('d1').status).toBe('resuelta_recompra');
    const res = await h.job.run(AHORA);
    expect(res.expired).toBe(0);
    expect(h.row('d1').status).toBe('resuelta_recompra'); // rojo si queda `en_revision`
  });

  it('D-2 (la carrera literal): resuelta ENTRE una lectura previa y la escritura del job ⇒ no revive', async () => {
    // Con read-then-write, un `findMany` que ya vio la fila `abierta` la escribiría igual. Con la
    // guarda en el `where`, la escritura evalúa el estado del INSTANTE de escribir.
    const h = harness([dispute({ id: 'd1', deadlineAt: VENCIDA })]);
    // Se simula «el job ya leyó»: la resolución llega antes de que el job escriba.
    h.prisma.dispute.updateMany.mockImplementationOnce(async (args: { where: Row; data: Row }) => {
      await h.svc.resolve('d1', 'reject', 'sin evidencia', 'op1');
      const hit = [h.row('d1')].filter((r) => matchesWhere(r, args.where));
      for (const r of hit) Object.assign(r, args.data);
      return { count: hit.length };
    });
    const res = await h.job.run(AHORA);
    expect(res.expired).toBe(0);
    expect(h.row('d1').status).toBe('rechazada');
  });
});
