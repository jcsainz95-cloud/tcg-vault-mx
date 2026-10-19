/**
 * Doble en memoria de las tablas que tocan `MeasurementService` y `MeasurementDrainService` (pruebas unitarias).
 * ⚠️ `order.findUnique` / `sellRequest.findUnique` devuelven la fila ENTERA (con PII) aunque el código pida `select`:
 * así C-B3 prueba que el código proyecta campo a campo y no copia la fila.
 */
import type { MeasurementOutbox } from '@prisma/client';

type Row = Record<string, unknown>;

export function measurementPrismaDouble(seed: { orders?: Row[]; sellRequests?: Row[]; contexts?: Row[]; outbox?: Partial<MeasurementOutbox>[] } = {}) {
  const orders = new Map<string, Row>((seed.orders ?? []).map((o) => [o.id as string, o]));
  const sellRequests = new Map<string, Row>((seed.sellRequests ?? []).map((o) => [o.id as string, o]));
  const contexts: Row[] = (seed.contexts ?? []).map((c) => ({ expiresAt: new Date('2999-01-01T00:00:00Z'), ...c }));
  const outbox: MeasurementOutbox[] = (seed.outbox ?? []).map(
    (r, i) =>
      ({
        id: `row${i}`,
        attempts: 0,
        lastStatus: null,
        createdAt: new Date(0),
        nextAttemptAt: new Date(0),
        expiresAt: new Date('2999-01-01T00:00:00Z'),
        ...r,
      }) as MeasurementOutbox,
  );
  let seq = outbox.length;
  const matches = (row: Row, where: Row): boolean =>
    Object.entries(where).every(([k, v]) => {
      const cur = row[k];
      if (v && typeof v === 'object' && !(v instanceof Date)) {
        const op = v as { lte?: Date; gt?: Date; in?: unknown[] };
        if (op.in) return op.in.includes(cur);
        if (!(cur instanceof Date)) return false;
        if (op.lte) return cur.getTime() <= op.lte.getTime();
        if (op.gt) return cur.getTime() > op.gt.getTime();
      }
      if (v instanceof Date) return cur instanceof Date && cur.getTime() === v.getTime();
      return cur === v;
    });
  const prisma = {
    order: { findUnique: jest.fn(async ({ where }: { where: { id: string } }) => orders.get(where.id) ?? null) },
    sellRequest: { findUnique: jest.fn(async ({ where }: { where: { id: string } }) => sellRequests.get(where.id) ?? null) },
    measurementContext: {
      findUnique: jest.fn(async ({ where }: { where: Row }) => contexts.find((c) => matches(c, where)) ?? null),
      findFirst: jest.fn(async ({ where }: { where: Row }) => contexts.find((c) => matches(c, where)) ?? null),
      createMany: jest.fn(async ({ data }: { data: Row[] }) => {
        contexts.push(...data);
        return { count: data.length };
      }),
      deleteMany: jest.fn(async ({ where }: { where: Row }) => {
        const before = contexts.length;
        for (let i = contexts.length - 1; i >= 0; i -= 1) if (matches(contexts[i], where)) contexts.splice(i, 1);
        return { count: before - contexts.length };
      }),
    },
    measurementOutbox: {
      /** Respeta `@@unique(destination, eventId)` con `skipDuplicates` (como `ON CONFLICT DO NOTHING`). */
      createMany: jest.fn(async ({ data, skipDuplicates }: { data: Row[]; skipDuplicates?: boolean }) => {
        let n = 0;
        for (const d of data) {
          const dup = outbox.some((r) => r.destination === d.destination && r.eventId === d.eventId);
          if (dup && skipDuplicates) continue;
          if (dup) throw Object.assign(new Error('P2002'), { code: 'P2002' });
          outbox.push({ id: `row${seq++}`, attempts: 0, lastStatus: null, createdAt: new Date(0), ...d } as MeasurementOutbox);
          n += 1;
        }
        return { count: n };
      }),
      findMany: jest.fn(async ({ where, take }: { where: Row; take?: number }) =>
        outbox.filter((r) => matches(r as unknown as Row, where)).slice(0, take ?? 1e9).map((r) => ({ ...r })),
      ),
      updateMany: jest.fn(async ({ where, data }: { where: Row; data: Row }) => {
        let n = 0;
        for (const r of outbox) if (matches(r as unknown as Row, where)) Object.assign(r, data), (n += 1);
        return { count: n };
      }),
      deleteMany: jest.fn(async ({ where }: { where: Row }) => {
        const before = outbox.length;
        for (let i = outbox.length - 1; i >= 0; i -= 1) if (matches(outbox[i] as unknown as Row, where)) outbox.splice(i, 1);
        return { count: before - outbox.length };
      }),
    },
  };
  return { prisma, outbox, contexts, orders, sellRequests };
}
