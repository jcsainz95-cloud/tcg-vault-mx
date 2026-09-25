/**
 * vault-placement-races.e2e-spec.ts — ⭐⭐ las CARRERAS de la colocación en bóveda, con el entrelazado
 * FORZADO (API_CONTRACT §M4-VAULT.8 pruebas 6, 13, 18, 24, 25, 32 y la mitad de carrera de la 33).
 *
 * **Cómo se fuerza el orden** (técnica de `helpers/row-lock-barrier.ts`, ⛔ nada de `sleep`): la prueba
 * toma el candado de la FILA que el primer verbo va a escribir en su CAS (o la puerta del cliente, cuando
 * el primer verbo no escribe fila); lanza el verbo A y COMPRUEBA en `pg_stat_activity` que quedó
 * bloqueado; lanza B y comprueba que también; suelta. La cola de espera de Postgres es FIFO ⇒ el orden
 * es el MISMO en toda máquina. Con la puerta del cliente presente, B se bloquea en la puerta detrás de
 * A; sin ella (mutación), B se bloquea en la misma fila — y la barrera sigue sirviendo, que es lo que
 * permite medir las mutaciones del contrato (m1/m2/m3) sin cambiar el arnés.
 *
 * Cada escenario corre N=10 tiradas y reporta la proporción (O-3) en consola: `[VP-RACE <id>] k/N`.
 */
import { E2EHarness } from './helpers/e2e-app';
import { VaultPlacementDb } from './helpers/vault-placement-db';

const RUN = Date.now().toString(36);
const N = 10;

describe('§M4-VAULT — carreras con entrelazado forzado (Postgres real)', () => {
  let h: E2EHarness;
  let db: VaultPlacementDb;

  beforeAll(async () => {
    h = await E2EHarness.create();
    db = new VaultPlacementDb(h, RUN);
    await db.init();
  });

  afterAll(async () => {
    if (h) {
      await db.limpiar();
      await h.close();
    }
  });

  type R = { status: number; body: any };
  const code = (r: R) => (r.status === 200 ? `200:${r.body.outcome ?? (r.body.changed ? 'changed' : 'same')}` : `${r.status}:${r.body?.error?.code}`);

  /**
   * A se lanza primero y se COMPRUEBA bloqueado; luego B, que se bloquea detrás (en la puerta, o en la
   * misma fila) — **o termina sin bloquearse**, que es justo lo que pasa cuando una mutación quita la
   * serialización (p. ej. sin puerta, un `PATCH` no escribe la fila que la barrera sostiene): esa
   * tirada se evalúa igual, con A todavía bloqueado cuando B terminó. Se suelta la barrera SIEMPRE
   * (`finally`): una barrera que no se suelta cuelga la suite entera. Devuelve [A, B].
   */
  async function forced(
    barrier: () => Promise<{ release: () => Promise<void> }>,
    a: () => Promise<R>,
    b: () => Promise<R>,
  ): Promise<[R, R]> {
    const hold = await barrier();
    try {
      const pa = a();
      await db.waitBlocked(1);
      let bDone = false;
      const pb = b().finally(() => {
        bDone = true;
      });
      await db.waitBlocked(2, () => bDone);
      await hold.release();
      return await Promise.all([pa, pb]);
    } finally {
      await hold.release();
    }
  }

  function report(id: string, outcomes: string[], ok: (o: string) => boolean) {
    const k = outcomes.filter(ok).length;
    // eslint-disable-next-line no-console
    console.log(`[VP-RACE ${id}] ${k}/${outcomes.length} · ${outcomes.join(' | ')}`);
    return k;
  }

  // ------------------------------------------------------------------ 6 / 33

  it(`6 — dos confirm al MISMO cajón (N=${N}): un placed + un already_placed, UN juego de movimientos, UNA bitácora`, async () => {
    const out: string[] = [];
    for (let t = 0; t < N; t += 1) {
      const u = await db.mkUser(`Carrera Seis ${t}`);
      const x = await db.mkDrawer();
      const p = await db.mkPlacement(u.id, 2, { marks: ['picked', 'picked'], prepared: true });
      const [a, b] = await forced(
        () => db.holdRow('VaultPlacement', p.placement.id),
        () => db.confirm(p.placement.id, { locationId: x.id }),
        () => db.confirm(p.placement.id, { locationId: x.id }),
      );
      const mv = (await db.movements(p.pieces.map((i) => i.id))).length;
      const logs = (await db.audits(p.placement.id)).length;
      out.push(`${code(a)},${code(b)},mv=${mv},log=${logs}`);
    }
    const k = report('6-same', out, (o) => o === '200:placed,200:already_placed,mv=2,log=1');
    expect(k).toBe(N);
  });

  it(`6 / 33 — dos confirm a cajones DISTINTOS (N=${N}): un 200 + un 409 {placed, location del ganador} sin llave locationId`, async () => {
    const out: string[] = [];
    for (let t = 0; t < N; t += 1) {
      const u = await db.mkUser(`Carrera Seis B ${t}`);
      const x = await db.mkDrawer();
      const y = await db.mkDrawer();
      const p = await db.mkPlacement(u.id, 1, { marks: ['picked'], prepared: true });
      const [a, b] = await forced(
        () => db.holdRow('VaultPlacement', p.placement.id),
        () => db.confirm(p.placement.id, { locationId: x.id }),
        () => db.confirm(p.placement.id, { locationId: y.id }),
      );
      const d = b.body?.error?.details;
      const detailOk =
        JSON.stringify(d) === JSON.stringify({ status: 'placed', location: { id: x.id, label: x.label, zone: 'customer_custody' } });
      const mv = (await db.movements(p.pieces.map((i) => i.id))).length;
      out.push(`${code(a)},${code(b)},details=${detailOk},mv=${mv}`);
    }
    const k = report('6-diff', out, (o) => o === '200:placed,409:PLACEMENT_NOT_PENDING,details=true,mv=1');
    expect(k).toBe(N);
  });

  // ------------------------------------------------------------------ 13

  it(`13 — la puerta del cliente muerde (N=${N}): cliente NUEVO, dos pedidos a X y a Y ⇒ un 200 + un 422 not_customer_drawer; NUNCA dos cajones`, async () => {
    const out: string[] = [];
    for (let t = 0; t < N; t += 1) {
      const u = await db.mkUser(`Carrera Trece ${t}`);
      const x = await db.mkDrawer();
      const y = await db.mkDrawer();
      const p1 = await db.mkPlacement(u.id, 1, { marks: ['picked'], prepared: true });
      const p2 = await db.mkPlacement(u.id, 1, { marks: ['picked'], prepared: true });
      const [a, b] = await forced(
        () => db.holdRow('VaultPlacement', [p1.placement.id, p2.placement.id]),
        () => db.confirm(p1.placement.id, { locationId: x.id }),
        () => db.confirm(p2.placement.id, { locationId: y.id }),
      );
      const drawers = (await db.physical(u.id)).body.drawer.kind;
      const reason = b.body?.error?.details?.reason;
      out.push(`${code(a)},${code(b)}/${reason},drawer=${drawers}`);
    }
    const k = report('13', out, (o) => o === '200:placed,422:LOCATION_NOT_AVAILABLE/not_customer_drawer,drawer=single');
    expect(k).toBe(N);
  });

  // ------------------------------------------------------------------ 18

  it(`18 — palomear vs preparar, las DOS órdenes (N=${N} cada una): NUNCA preparedAt con una colocable pending`, async () => {
    const out: string[] = [];
    for (let t = 0; t < N; t += 1) {
      for (const order of ['prepare-first', 'unmark-first'] as const) {
        const u = await db.mkUser(`Carrera Dieciocho ${t} ${order}`);
        const p = await db.mkPlacement(u.id, 1, { marks: ['picked'] });
        const prep = () => db.prepare(p.placement.id);
        const unmark = () => db.mark(p.placement.id, p.items[0].id, 'pending');
        const [a, b] =
          order === 'prepare-first'
            ? await forced(() => db.holdRow('VaultPlacement', p.placement.id), prep, unmark)
            : await forced(() => db.holdRow('VaultPlacementItem', p.items[0].id), unmark, prep);
        const row = await db.placementRow(p.placement.id);
        const item = await h.prisma.vaultPlacementItem.findUniqueOrThrow({ where: { id: p.items[0].id } });
        const violation = row.preparedAt !== null && item.prepStatus === 'pending';
        out.push(`${order}:${code(a)},${code(b)},violation=${violation}`);
      }
    }
    const k = report('18', out, (o) =>
      o === 'prepare-first:200:prepared,409:PREPARATION_CLOSED,violation=false' ||
      o === 'unmark-first:200:changed,409:PREPARATION_INCOMPLETE,violation=false',
    );
    expect(k).toBe(2 * N);
  });

  // ------------------------------------------------------------------ 24

  it(`24 — deshacer vs confirm, las DOS órdenes (N=${N} cada una): (a) unprepared + NOT_PREPARED, 0 movimientos; (b) placed + NOT_PENDING, preparedAt intacto; NUNCA 500`, async () => {
    const out: string[] = [];
    for (let t = 0; t < N; t += 1) {
      for (const order of ['delete-first', 'confirm-first'] as const) {
        const u = await db.mkUser(`Carrera Veinticuatro ${t} ${order}`);
        const x = await db.mkDrawer();
        const p = await db.mkPlacement(u.id, 2, { marks: ['picked', 'missing'], prepared: true });
        const prepAt = (await db.placementRow(p.placement.id)).preparedAt;
        const del = () => db.unprepare(p.placement.id);
        const conf = () => db.confirm(p.placement.id, { locationId: x.id });
        const barrier = () => db.holdRow('VaultPlacement', p.placement.id);
        const [a, b] = order === 'delete-first' ? await forced(barrier, del, conf) : await forced(barrier, conf, del);
        const row = await db.placementRow(p.placement.id);
        const mv = (await db.movements(p.pieces.map((i) => i.id))).length;
        const locs = await h.prisma.inventoryItem.findMany({ where: { id: { in: p.pieces.map((i) => i.id) } } });
        const moved = locs.filter((l) => l.locationId === x.id).length;
        let state: string;
        if (row.status === 'pending') state = `pending/prep=${row.preparedAt !== null}/mv=${mv}/moved=${moved}`;
        else state = `${row.status}/prepIntact=${row.preparedAt?.getTime() === prepAt?.getTime()}`;
        out.push(`${order}:${code(a)},${code(b)},${state}`);
      }
    }
    const k = report('24', out, (o) =>
      o === 'delete-first:200:unprepared,409:PLACEMENT_NOT_PREPARED,pending/prep=false/mv=0/moved=0' ||
      o === 'confirm-first:200:placed,409:PLACEMENT_NOT_PENDING,placed/prepIntact=true',
    );
    expect(out.some((o) => o.includes(':500'))).toBe(false);
    expect(k).toBe(2 * N);
  });

  // ------------------------------------------------------------------ 25

  it(`25 — deshacer vs palomear, las DOS órdenes (N=${N} cada una): el PATCH antes ⇒ 409 CLOSED sin escribir; después ⇒ escribe`, async () => {
    const out: string[] = [];
    for (let t = 0; t < N; t += 1) {
      for (const order of ['delete-first', 'patch-first'] as const) {
        const u = await db.mkUser(`Carrera Veinticinco ${t} ${order}`);
        const p = await db.mkPlacement(u.id, 1, { marks: ['picked'], prepared: true });
        const before = await h.prisma.vaultPlacementItem.findUniqueOrThrow({ where: { id: p.items[0].id } });
        const del = () => db.unprepare(p.placement.id);
        const patch = () => db.mark(p.placement.id, p.items[0].id, 'missing');
        const [a, b] =
          order === 'delete-first'
            ? await forced(() => db.holdRow('VaultPlacement', p.placement.id), del, patch)
            : await forced(() => db.holdGate(u.id), patch, del);
        const item = await h.prisma.vaultPlacementItem.findUniqueOrThrow({ where: { id: p.items[0].id } });
        const written = item.prepStatus !== before.prepStatus;
        out.push(`${order}:${code(a)},${code(b)},written=${written}`);
      }
    }
    const k = report('25', out, (o) =>
      o === 'delete-first:200:unprepared,200:changed,written=true' ||
      o === 'patch-first:409:PREPARATION_CLOSED,200:unprepared,written=false',
    );
    expect(k).toBe(2 * N);
  });

  // ------------------------------------------------------------------ 32

  it(`32a — confirm {} (cierre sin cajón) vs deshacer, las DOS órdenes (N=${N} cada una); NUNCA 500 ni cancelled reabierta`, async () => {
    const out: string[] = [];
    for (let t = 0; t < N; t += 1) {
      for (const order of ['confirm-first', 'delete-first'] as const) {
        const u = await db.mkUser(`Carrera TreintaDos ${t} ${order}`);
        const p = await db.mkPlacement(u.id, 1, { marks: ['missing'], prepared: true });
        const conf = () => db.confirm(p.placement.id, {});
        const del = () => db.unprepare(p.placement.id);
        const barrier = () => db.holdRow('VaultPlacement', p.placement.id);
        const [a, b] = order === 'confirm-first' ? await forced(barrier, conf, del) : await forced(barrier, del, conf);
        const row = await db.placementRow(p.placement.id);
        const det = order === 'confirm-first' ? JSON.stringify(b.body?.error?.details) : '';
        out.push(`${order}:${code(a)},${code(b)},${row.status}/${row.cancelReason}${det ? `,${det}` : ''}`);
      }
    }
    const k = report('32a', out, (o) =>
      o === 'confirm-first:200:nothing_to_place,409:PLACEMENT_NOT_PENDING,cancelled/nothing_to_place,{"status":"cancelled","cancelReason":"nothing_to_place"}' ||
      o === 'delete-first:200:unprepared,409:PLACEMENT_NOT_PREPARED,pending/null',
    );
    expect(out.some((o) => o.includes(':500'))).toBe(false);
    expect(k).toBe(2 * N);
  });

  it(`32b — dos confirm {} a la vez (N=${N}): un 200 nothing_to_place + un 409 {cancelled}, UNA bitácora`, async () => {
    const out: string[] = [];
    for (let t = 0; t < N; t += 1) {
      const u = await db.mkUser(`Carrera TreintaDos B ${t}`);
      const p = await db.mkPlacement(u.id, 1, { marks: ['missing'], prepared: true });
      const [a, b] = await forced(
        () => db.holdRow('VaultPlacement', p.placement.id),
        () => db.confirm(p.placement.id, {}),
        () => db.confirm(p.placement.id, {}),
      );
      const logs = (await db.audits(p.placement.id)).length;
      out.push(`${code(a)},${code(b)},log=${logs}`);
    }
    const k = report('32b', out, (o) => o === '200:nothing_to_place,409:PLACEMENT_NOT_PENDING,log=1');
    expect(k).toBe(N);
  });
});
