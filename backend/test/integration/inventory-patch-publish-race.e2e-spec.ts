/**
 * inventory-patch-publish-race.e2e-spec.ts — M-1 del gate de QA sobre `b8a3e4ce` (INV-SP-8,
 * API_CONTRACT §M1 `#M1-patch-price-guard`: «todo o nada, nada escrito»), camino PUBLICANTE del
 * `PATCH /admin/inventory/items/:id` (`status: 'listed'` sobre una pieza que no lo estaba).
 *
 * *El defecto (viene de v1.51, fase 8):* el camino publicante escribía los campos del body
 * (incluido `listPriceCents`) con un `update` por `id` **y después** hacía el CAS `claimListed`.
 * Si un checkout reservaba la pieza entre la lectura y la escritura, el CAS perdía ⇒ `422
 * ITEM_NOT_PUBLISHABLE`… pero el precio ya estaba escrito sobre una pieza `reserved`.
 *
 * *El orden se FUERZA, no se sortea* (`helpers/row-lock-barrier.ts`): la prueba toma `FOR UPDATE`
 * sobre la fila, el `PATCH` lee (sin candado), resuelve precio y **se bloquea en su primera
 * escritura** sobre la fila (comprobado en `pg_stat_activity`); con la petición parada ahí, la
 * prueba hace lo que haría el CAS de reserva del checkout (`in_stock → reserved`) y suelta. Así el
 * entrelazado es el mismo en toda máquina: con el defecto, 10/10 rojas; sin él, 10/10 verdes.
 *
 * El control (misma barrera, nadie reserva) demuestra que la barrera sola no fabrica el `422`.
 */
import { E2EHarness } from './helpers/e2e-app';
import { VaultPlacementDb } from './helpers/vault-placement-db';
import { diferida, esperarBloqueoDeFila } from './helpers/row-lock-barrier';

const RUN = `pr${Date.now().toString(36)}`;
const N = 10;
const SEEDED = 777;
const NEW_PRICE = 45678;

describe('M1 PATCH publicante — carrera con la reserva: todo o nada (INV-SP-8, Postgres real)', () => {
  let h: E2EHarness;
  let db: VaultPlacementDb;

  beforeAll(async () => {
    h = await E2EHarness.create();
    db = new VaultPlacementDb(h, RUN);
    await db.init();
  });

  afterAll(async () => {
    if (h) {
      await h.prisma.auditLog.deleteMany({ where: { entityType: 'InventoryItem', entityId: { in: db.items } } });
      await db.limpiar();
      await h.close();
    }
  });

  const patch = (id: string, json: Record<string, unknown>) =>
    h.api('PATCH', `/admin/inventory/items/${id}`, { token: db.opToken, json });
  const state = (id: string) =>
    h.prisma.inventoryItem.findUniqueOrThrow({ where: { id }, select: { status: true, listPriceCents: true } });

  /**
   * Lanza el `PATCH` publicante con la fila bloqueada, espera (comprobado) a que se pare en la
   * escritura, aplica `mientras` dentro de la transacción que bloquea y suelta.
   */
  async function patchConBarrera(id: string, mientras: 'reservar' | 'nada') {
    const candadoPuesto = diferida();
    const peticionParada = diferida();
    const tx = h.prisma.$transaction(
      async (t) => {
        await t.$executeRawUnsafe(`SELECT id FROM "InventoryItem" WHERE id = $1 FOR UPDATE`, id);
        candadoPuesto.abrir();
        await peticionParada.promesa;
        if (mientras === 'reservar') {
          // Lo que hace el CAS de reserva del checkout: `in_stock → reserved`, gana la carrera.
          await t.inventoryItem.update({ where: { id }, data: { status: 'reserved' } });
        }
      },
      { timeout: 30000, maxWait: 30000 },
    );
    let pPatch: ReturnType<typeof patch> | undefined;
    try {
      await candadoPuesto.promesa;
      pPatch = patch(id, { status: 'listed', listPriceCents: NEW_PRICE });
      await esperarBloqueoDeFila(h.prisma, 'InventoryItem', 1);
    } finally {
      peticionParada.abrir();
    }
    await tx;
    return pPatch!;
  }

  it(`⭐ la reserva gana entre lectura y escritura ⇒ 422 ITEM_NOT_PUBLISHABLE y NADA escrito (N=${N})`, async () => {
    const fallos: string[] = [];
    for (let i = 0; i < N; i += 1) {
      const p = await db.mkPiece(null, db.shopLocationId, { status: 'in_stock' });
      await h.prisma.inventoryItem.update({ where: { id: p.id }, data: { listPriceCents: SEEDED } });
      const r = await patchConBarrera(p.id, 'reservar');
      const s = await state(p.id);
      const ok =
        r.status === 422 &&
        r.body?.error?.code === 'ITEM_NOT_PUBLISHABLE' &&
        s.status === 'reserved' &&
        s.listPriceCents === SEEDED;
      if (!ok) fallos.push(`#${i}: ${r.status} ${r.body?.error?.code ?? ''} → ${s.status}/${s.listPriceCents}`);
    }
    // Se reporta la proporción entera, no la primera roja.
    expect({ rojas: fallos.length, de: N, fallos }).toEqual({ rojas: 0, de: N, fallos: [] });
  });

  it(`control: misma barrera, nadie reserva ⇒ 200, listed y precio escrito (N=${N})`, async () => {
    const fallos: string[] = [];
    for (let i = 0; i < N; i += 1) {
      const p = await db.mkPiece(null, db.shopLocationId, { status: 'in_stock' });
      await h.prisma.inventoryItem.update({ where: { id: p.id }, data: { listPriceCents: SEEDED } });
      const r = await patchConBarrera(p.id, 'nada');
      const s = await state(p.id);
      const ok =
        r.status === 200 &&
        r.body?.status === 'listed' &&
        r.body?.listPriceCents === NEW_PRICE &&
        s.status === 'listed' &&
        s.listPriceCents === NEW_PRICE;
      if (!ok) fallos.push(`#${i}: ${r.status} ${JSON.stringify(r.body?.error ?? {})} → ${s.status}/${s.listPriceCents}`);
    }
    expect({ rojas: fallos.length, de: N, fallos }).toEqual({ rojas: 0, de: N, fallos: [] });
  });
});
