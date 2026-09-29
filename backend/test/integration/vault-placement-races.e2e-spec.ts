/**
 * vault-placement-races.e2e-spec.ts — ⭐⭐ las CARRERAS de la colocación en bóveda, con el entrelazado
 * FORZADO (API_CONTRACT §M4-VAULT.8 pruebas 6, 13, 18, 24, 25, 32 y la mitad de carrera de la 33), y
 * la 40: el CONTRACARGO contra cada verbo (el único escritor que no toma la puerta; §M4-VAULT.6).
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
/** Marcadores de idempotencia de Stripe que crea la prueba 40 (contracargo): se borran al final. */
const cbEvents: string[] = [];

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
      await h.prisma.processedStripeEvent.deleteMany({ where: { id: { in: cbEvents } } });
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
  //
  // Regresión de la PUERTA del cliente (v1.79.5). ⛔ No canda el `status:'pending'` del `WHERE` del cierre
  // directo: bajo la puerta, el segundo verbo relee en el paso 5, ve `cancelled` y nunca llega al CAS
  // (medido: esa mutación deja 32a/32b verdes). Esa mutación la mata la prueba 40(a), contra el
  // contracargo, que es el único escritor que no toma la puerta.

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

  // ------------------------------------------------------------------ 40 — contracargo vs verbo
  //
  // §M4-VAULT.8 prueba 40 (v1.79.5; cierra C1 de techlead + seguridad + QA IMPORTANTE 3 sobre db7d1c2).
  // El contracargo de una orden `vault` (`PaymentsService.onChargeDisputeVault`, §M4-VAULT.6) es el ÚNICO
  // escritor de `VaultPlacement` que NO toma la puerta del cliente. Entre dos verbos la puerta serializa y
  // el `status:'pending'` de los `WHERE` no tiene rival (por eso la 32 no lo discrimina); contra el
  // contracargo, ese `status` es lo ÚNICO que protege la fila.
  //
  // Orden forzado (y solo éste — el inverso se interbloquea, SEC-VLT-DL aceptado): 1) la barrera toma la
  // fila `VaultPlacement`; 2) A = webhook `charge.dispute.created` firmado, visto esperando CANDADO DE
  // FILA (ya revirtió piezas y orden; espera en su `updateMany` final); 3) B = el verbo, visto esperando
  // la MISMA fila (ya pasó la puerta y releyó `pending`); 4) se suelta: A gana (FIFO) y confirma; B
  // re-evalúa su `WHERE` sobre la versión confirmada. **Canario del arnés:** una tirada en la que no se vio
  // a A y a B esperando candado de fila (⛔ la puerta, que es advisory) NO cuenta: se reporta aparte y la
  // prueba exige N/N tiradas entrelazadas Y correctas.

  type Placement = Awaited<ReturnType<VaultPlacementDb['mkPlacement']>>;

  /** Pone un PaymentIntent a la orden y devuelve el disparador del webhook (event.id propio, se borra al final). */
  async function disputeFor(p: Placement, tag: string) {
    const pi = `pi_vp40_${RUN}_${tag}`;
    await h.prisma.order.update({ where: { id: p.order.id }, data: { stripePaymentIntentId: pi } });
    const evId = `evt_vp40_${RUN}_${tag}`;
    cbEvents.push(evId);
    return () =>
      h.sendStripeWebhook({
        id: evId,
        type: 'charge.dispute.created',
        data: {
          object: { id: `dp_${pi}`, object: 'dispute', payment_intent: pi, amount: 100, currency: 'mxn', status: 'needs_response' },
        },
      }) as Promise<R>;
  }

  /** Pasos 1–4 de la 40. `interleaved` = se vio a A y luego a A+B esperando candado de FILA. */
  async function forcedOnRow(p: Placement, a: () => Promise<R>, b: () => Promise<R>) {
    const hold = await db.holdRow('VaultPlacement', p.placement.id);
    try {
      let aDone = false;
      const pa = a().finally(() => {
        aDone = true;
      });
      const seenA = await db.waitRowBlocked(1, () => aDone);
      let bDone = false;
      const pb = b().finally(() => {
        bDone = true;
      });
      const seenB = seenA && (await db.waitRowBlocked(2, () => bDone));
      await hold.release();
      const [ra, rb] = await Promise.all([pa, pb]);
      return { a: ra, b: rb, interleaved: seenA && seenB };
    } finally {
      await hold.release();
    }
  }

  /** Lo común a (a)–(d): webhook 200, fila cancelled/chargeback sin autor, orden en chargeback, B 409. */
  async function common40(p: Placement, a: R, b: R) {
    const row = await db.placementRow(p.placement.id);
    const order = await h.prisma.order.findUniqueOrThrow({ where: { id: p.order.id } });
    const bCode = b.status === 409 ? `${code(b)}${JSON.stringify(b.body?.error?.details)}` : code(b);
    return {
      row,
      line: `wh=${a.status},B=${bCode},row=${row.status}/${row.cancelReason}/by=${row.cancelledByUserId === null ? 'NULL' : 'operator'},order=${order.status}`,
    };
  }
  const COMMON_OK =
    'wh=200,B=409:PLACEMENT_NOT_PENDING{"status":"cancelled","cancelReason":"chargeback"},row=cancelled/chargeback/by=NULL,order=chargeback';

  function report40(id: string, out: { interleaved: boolean; line: string }[], extraOk: string) {
    const lines = out.map((o) => (o.interleaved ? o.line : `SIN-ENTRELAZADO:${o.line}`));
    const noInterleave = out.filter((o) => !o.interleaved).length;
    const k = out.filter((o) => o.interleaved && o.line === `${COMMON_OK},${extraOk}`).length;
    // eslint-disable-next-line no-console
    console.log(`[VP-RACE ${id}] ${k}/${out.length} (sin entrelazado observado: ${noInterleave}/${out.length}) · ${lines.join(' | ')}`);
    return { k, noInterleave };
  }

  it(`40(a) — contracargo vs confirm {} (cierre directo 6-bis) (N=${N}): 409 {cancelled, chargeback}; preparedAt intacto; 0 bitácoras nothing_to_place`, async () => {
    const out: { interleaved: boolean; line: string }[] = [];
    for (let t = 0; t < N; t += 1) {
      const u = await db.mkUser(`Carrera Cuarenta A ${t}`);
      const p = await db.mkPlacement(u.id, 1, { marks: ['missing'], prepared: true });
      const prepAt = (await db.placementRow(p.placement.id)).preparedAt;
      const r = await forcedOnRow(p, await disputeFor(p, `a${t}`), () => db.confirm(p.placement.id, {}));
      const { row, line } = await common40(p, r.a, r.b);
      const logs = (await db.audits(p.placement.id, 'vault_placement.nothing_to_place')).length;
      out.push({ interleaved: r.interleaved, line: `${line},prepIntact=${row.preparedAt?.getTime() === prepAt?.getTime()},log=${logs}` });
    }
    const { k, noInterleave } = report40('40a', out, 'prepIntact=true,log=0');
    expect(noInterleave).toBe(0);
    expect(k).toBe(N);
  });

  it(`40(b) — contracargo vs confirm {locationId} (reclamo, paso 8) (N=${N}): 409 {cancelled, chargeback}; 0 movimientos 'move'; piezas platform/listed en su sitio de antes; 0 bitácoras placed`, async () => {
    const out: { interleaved: boolean; line: string }[] = [];
    for (let t = 0; t < N; t += 1) {
      const u = await db.mkUser(`Carrera Cuarenta B ${t}`);
      const x = await db.mkDrawer();
      const p = await db.mkPlacement(u.id, 2, { marks: ['picked', 'picked'], prepared: true });
      const ids = p.pieces.map((i) => i.id);
      const locBefore = new Map(
        (await h.prisma.inventoryItem.findMany({ where: { id: { in: ids } } })).map((i) => [i.id, i.locationId]),
      );
      const r = await forcedOnRow(p, await disputeFor(p, `b${t}`), () => db.confirm(p.placement.id, { locationId: x.id }));
      const { line } = await common40(p, r.a, r.b);
      const mv = (await db.movements(ids)).filter((m) => m.reason === 'move').length;
      const pieces = await h.prisma.inventoryItem.findMany({ where: { id: { in: ids } } });
      const piecesOk = pieces.every(
        (i) => i.ownerType === 'platform' && i.status === 'listed' && i.locationId === locBefore.get(i.id),
      );
      const logs = (await db.audits(p.placement.id, 'vault_placement.placed')).length;
      out.push({ interleaved: r.interleaved, line: `${line},mv=${mv},pieces=${piecesOk},log=${logs}` });
    }
    const { k, noInterleave } = report40('40b', out, 'mv=0,pieces=true,log=0');
    expect(noInterleave).toBe(0);
    expect(k).toBe(N);
  });

  it(`40(c) — contracargo vs POST …/prepared (N=${N}): 409 {cancelled, chargeback}; preparedAt y preparedByUserId NULL; 0 bitácoras prepared`, async () => {
    const out: { interleaved: boolean; line: string }[] = [];
    for (let t = 0; t < N; t += 1) {
      const u = await db.mkUser(`Carrera Cuarenta C ${t}`);
      const p = await db.mkPlacement(u.id, 2, { marks: ['picked', 'picked'] });
      const r = await forcedOnRow(p, await disputeFor(p, `c${t}`), () => db.prepare(p.placement.id));
      const { row, line } = await common40(p, r.a, r.b);
      const logs = (await db.audits(p.placement.id, 'vault_placement.prepared')).length;
      out.push({
        interleaved: r.interleaved,
        line: `${line},prepNull=${row.preparedAt === null && row.preparedByUserId === null},log=${logs}`,
      });
    }
    const { k, noInterleave } = report40('40c', out, 'prepNull=true,log=0');
    expect(noInterleave).toBe(0);
    expect(k).toBe(N);
  });

  it(`40(d) — contracargo vs DELETE …/prepared (N=${N}): 409 {cancelled, chargeback}; preparedAt intacto; 0 bitácoras unprepared`, async () => {
    const out: { interleaved: boolean; line: string }[] = [];
    for (let t = 0; t < N; t += 1) {
      const u = await db.mkUser(`Carrera Cuarenta D ${t}`);
      const p = await db.mkPlacement(u.id, 1, { marks: ['picked'], prepared: true });
      const prepAt = (await db.placementRow(p.placement.id)).preparedAt;
      const r = await forcedOnRow(p, await disputeFor(p, `d${t}`), () => db.unprepare(p.placement.id));
      const { row, line } = await common40(p, r.a, r.b);
      const logs = (await db.audits(p.placement.id, 'vault_placement.unprepared')).length;
      out.push({ interleaved: r.interleaved, line: `${line},prepIntact=${row.preparedAt?.getTime() === prepAt?.getTime()},log=${logs}` });
    }
    const { k, noInterleave } = report40('40d', out, 'prepIntact=true,log=0');
    expect(noInterleave).toBe(0);
    expect(k).toBe(N);
  });

  // 40(e) — el WHERE del propio contracargo, secuencial (determinista, N=1). Dos `it` para que la
  // mutación m-e se vea roja en CADA uno por su cuenta (en uno solo, el primer `expect` ocultaría el otro).
  it('40(e1) — contracargo sobre una colocación YA placed: sigue placed con su placedAt/placedBy/cajón, y las piezas vuelven a plataforma EN el cajón', async () => {
    const u1 = await db.mkUser('Cuarenta E Uno');
    const x = await db.mkDrawer();
    const p1 = await db.mkPlacement(u1.id, 1, { marks: ['picked'], prepared: true });
    expect(code(await db.confirm(p1.placement.id, { locationId: x.id }))).toBe('200:placed');
    const placed = await db.placementRow(p1.placement.id);
    const wh1 = await (await disputeFor(p1, 'e1'))();
    expect(wh1.status).toBe(200);
    const after1 = await db.placementRow(p1.placement.id);
    expect({
      status: after1.status,
      placedAt: after1.placedAt?.getTime(),
      placedBy: after1.placedByUserId,
      locationId: after1.locationId,
      cancelReason: after1.cancelReason,
    }).toEqual({
      status: 'placed',
      placedAt: placed.placedAt?.getTime(),
      placedBy: placed.placedByUserId,
      locationId: x.id,
      cancelReason: null,
    });
    const piece1 = await h.prisma.inventoryItem.findUniqueOrThrow({ where: { id: p1.pieces[0].id } });
    expect([piece1.ownerType, piece1.status, piece1.locationId]).toEqual(['platform', 'listed', x.id]);
  });

  it('40(e2) — contracargo sobre una colocación YA cancelled/nothing_to_place: conserva su razón, su autor y su fecha', async () => {
    const u2 = await db.mkUser('Cuarenta E Dos');
    const p2 = await db.mkPlacement(u2.id, 1, { marks: ['missing'], prepared: true });
    expect(code(await db.confirm(p2.placement.id, {}))).toBe('200:nothing_to_place');
    const closed = await db.placementRow(p2.placement.id);
    expect(closed.cancelledByUserId).not.toBeNull();
    const wh2 = await (await disputeFor(p2, 'e2'))();
    expect(wh2.status).toBe(200);
    const after2 = await db.placementRow(p2.placement.id);
    expect([after2.status, after2.cancelReason, after2.cancelledByUserId, after2.cancelledAt?.getTime()]).toEqual([
      'cancelled',
      'nothing_to_place',
      closed.cancelledByUserId,
      closed.cancelledAt?.getTime(),
    ]);
  });
});
