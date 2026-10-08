/**
 * accessories-c1.lock-order.spec.ts — 💰 C-1 (gates §AC sobre `dd26ae79`, BACKEND_NOTES §83.gates) con DOBLE de Prisma.
 * Propiedad: backend. La mitad con Postgres real (40P01 forzado) vive en
 * `test/integration/accessories-lock-order.e2e-spec.ts`.
 *
 * Qué fija: con dos renglones de ids CRUZADOS (L1 → B, L2 → A, A < B), el ORDEN en que cada fila de `Accessory` se pide
 * por primera vez es ascendente — el mismo que `reserveAccessories` — en `settleAccessories` (`reserved` y recuperación
 * `released`) y en `restockAccessoriesOnFullRefund`, y el candado cubre TODAS las filas que luego se actualizan.
 * Antes del arreglo el primer contacto era B y luego A (por renglón) ⇒ rojo aquí.
 */
import { reserveAccessories, restockAccessoriesOnFullRefund, settleAccessories } from '../src/modules/orders/accessory-stock';

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';
const C = 'cccccccc-0000-4000-8000-000000000003';

interface Touch {
  sql: string;
  ids: string[];
}

/** Doble de `tx`: registra cada sentencia cruda sobre `"Accessory"` y qué ids toca. */
function fakeTx(lines: unknown[]) {
  const touches: Touch[] = [];
  const record = (strings: TemplateStringsArray, values: unknown[]) => {
    const sql = strings.join('?');
    if (!/"Accessory"/.test(sql)) return;
    const ids = values.flatMap((v) => (Array.isArray(v) ? v : [v])).filter((v): v is string => typeof v === 'string' && [A, B, C].includes(v));
    touches.push({ sql, ids });
  };
  const tx = {
    $queryRaw: jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      record(strings, values);
      return /RETURNING/.test(strings.join('?')) ? [{ stockQty: 5 }] : [];
    }),
    $executeRaw: jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      record(strings, values);
      return 1;
    }),
    orderAccessoryLine: { findMany: jest.fn(async () => lines), updateMany: jest.fn(async () => ({ count: 1 })) },
    accessoryStockMovement: { create: jest.fn(async () => ({})) },
    shipmentAccessoryLine: { createMany: jest.fn(async () => ({ count: 0 })) },
    accessory: { findUnique: jest.fn(async () => ({ stockQty: 10, reservedQty: 0 })) },
  };
  return { tx: tx as never, touches };
}

/** Orden de PRIMER contacto con cada fila de `Accessory` (lo que decide el orden de candados en Postgres). */
const firstTouch = (touches: Touch[]) => {
  const seen: string[] = [];
  for (const t of touches) for (const id of t.ids) if (!seen.includes(id)) seen.push(id);
  return seen;
};
const sorted = (xs: string[]) => [...xs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

const loose = (id: string, accessoryId: string, status: string) => ({
  id,
  orderId: 'o1',
  kind: 'accessory',
  accessoryId,
  quantity: 1,
  status,
  settledWithoutStock: false,
  components: [],
  shipmentLine: null,
});
// Paquete (L1, id menor) con componentes C y B; suelto (L2) con A ⇒ por renglón: B, C, A.
const bundle = (id: string, status: string) => ({
  id,
  orderId: 'o1',
  kind: 'energy_bundle',
  accessoryId: null,
  quantity: 1,
  status,
  settledWithoutStock: false,
  components: [
    { accessoryId: C, quantity: 4 },
    { accessoryId: B, quantity: 8 },
  ],
  shipmentLine: null,
});

describe('💰 C-1 · orden de candados de Accessory con renglones de ids cruzados (doble de Prisma)', () => {
  const cases: [string, unknown[], (tx: never) => Promise<unknown>][] = [
    ['settle (reserved)', [loose('L1', B, 'reserved'), loose('L2', A, 'reserved')], (tx) => settleAccessories(tx, { id: 'o1', orderNumber: null }, 'sr1', new Date())],
    ['settle (recuperación released)', [loose('L1', B, 'released'), loose('L2', A, 'released')], (tx) => settleAccessories(tx, { id: 'o1', orderNumber: null }, 'sr1', new Date())],
    ['settle (paquete + suelto)', [bundle('L1', 'reserved'), loose('L2', A, 'reserved')], (tx) => settleAccessories(tx, { id: 'o1', orderNumber: null }, 'sr1', new Date())],
    ['restock (reembolso total)', [loose('L1', B, 'sold'), loose('L2', A, 'sold')], (tx) => restockAccessoriesOnFullRefund(tx, 'o1', new Date())],
    ['restock (paquete + suelto)', [bundle('L1', 'sold'), loose('L2', A, 'sold')], (tx) => restockAccessoriesOnFullRefund(tx, 'o1', new Date())],
  ];

  it.each(cases)('%s: primer contacto con cada accesorio en orden ascendente, y un FOR UPDATE que cubre todo ANTES de cualquier UPDATE', async (_n, lines, run) => {
    const { tx, touches } = fakeTx(lines);
    await run(tx);
    const order = firstTouch(touches);
    expect(order).toEqual(sorted(order));
    const firstUpdate = touches.findIndex((t) => /UPDATE "Accessory"/.test(t.sql));
    expect(firstUpdate).toBeGreaterThan(0);
    const lock = touches[0];
    expect(lock.sql).toMatch(/FOR UPDATE/);
    expect(lock.sql).toMatch(/ORDER BY id COLLATE "C"/);
    const updated = new Set(touches.filter((t) => /UPDATE "Accessory"/.test(t.sql)).flatMap((t) => t.ids));
    expect(sorted(lock.ids)).toEqual(lock.ids);
    for (const id of updated) expect(lock.ids).toContain(id);
  });

  it('referencia: reserveAccessories ya pedía en orden ascendente (el orden con el que hay que coincidir)', async () => {
    const { tx, touches } = fakeTx([]);
    await reserveAccessories(tx, 'o2', new Map([[B, 1], [A, 1], [C, 1]]));
    expect(firstTouch(touches)).toEqual([A, B, C]);
  });

  it('pedido sin renglones que muevan existencias ⇒ no emite candado', async () => {
    const { tx, touches } = fakeTx([loose('L1', B, 'released')].map((l) => ({ ...l, status: 'sold' })));
    await settleAccessories(tx, { id: 'o1', orderNumber: null }, 'sr1', new Date());
    expect(touches).toEqual([]);
  });
});
