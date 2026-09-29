/**
 * full-refund-vault.e2e-spec.ts — §M4-SHIP.18 «reembolso total de una compra a bóveda» (PS-55…PS-66), los verbos de
 * inventario con guarda (§M4-SHIP.17.1: PS-41/PS-42), la vista del operador y la merma (PS-49), la re-compra y el ciclo
 * (PS-52) y M7 (PS-40), contra Postgres REAL (app Nest completa por HTTP, doble de Stripe CON ESTADO). Propiedad:
 * backend. Carreras: entrelazado FORZADO por barrera de fila (prueba 40), N ≥ 10, proporción con su N
 * (`[PS-RACE …] k/N`). Mutaciones (cada PS nombra la suya) se demuestran sobre COPIA del árbol entero, ⛔ nunca aquí.
 */
import { MAIL_PORT, MailMessage, MailPort } from '../../src/modules/mail/mail.port';
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { R, ShipPrepDb } from './helpers/ship-prep-db';
import { SettingKey } from '../../src/modules/settings/settings.constants';

const RUN = Date.now().toString(36);
const N = 10;

describe('§M4-SHIP.18 — reembolso total de bóveda, guardas de inventario, vista del operador (Postgres real)', () => {
  let h: E2EHarness;
  let db: ShipPrepDb;
  let bandeja: MailMessage[] = [];
  let spy: jest.SpyInstance;
  const av3 = () => bandeja.filter((m) => /Reembolso de tu pedido/.test(m.subject));
  const av12 = () => bandeja.filter((m) => /Reembolso de (?!tu pedido)/.test(m.subject));
  const code = (r: R) => (r.status === 200 || r.status === 201 ? `${r.status}:${r.body.outcome ?? 'ok'}` : `${r.status}:${r.body?.error?.code}`);
  const report = (id: string, outcomes: string[], ok: (o: string) => boolean) => {
    const k = outcomes.filter(ok).length;
    // eslint-disable-next-line no-console
    console.log(`[PS-RACE ${id}] ${k}/${outcomes.length} · N=${outcomes.length} · ${outcomes.join(' | ')}`);
    return k;
  };
  const setCap = (v: number) =>
    h.prisma.configSetting.upsert({
      where: { key: SettingKey.OPERATOR_REFUND_CAP_24H_CENTS },
      create: { key: SettingKey.OPERATOR_REFUND_CAP_24H_CENTS, valueJson: v },
      update: { valueJson: v },
    });

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    db = new ShipPrepDb(h, RUN);
    await db.init();
    const port = h.app.get<MailPort>(MAIL_PORT);
    spy = jest.spyOn(port, 'send').mockImplementation(async (msg: MailMessage) => {
      bandeja.push(msg);
      return {};
    });
    await setCap(1_000_000_000);
  });

  afterAll(async () => {
    spy?.mockRestore();
    await setCap(500000);
    await db.cleanup();
    await h?.close();
  });

  beforeEach(() => {
    bandeja = [];
    h.stripe.refundOutcome = 'ok';
    h.stripe.refundDelayMs = 0;
  });

  /** M3 total (POST ⇒ 201). Se normaliza a 200 para leer «aceptado» en las aserciones. */
  const m3 = async (orderId: string): Promise<R> => {
    const r = await db.m3Refund(orderId, { reason: 'cobro duplicado', confirmPiecesWithCustomer: true });
    return r.status === 201 ? { ...r, status: 200 } : r;
  };
  const fullRow = (orderId: string) => db.refunds({ orderId, kind: 'order_full' });
  const moves = async (ids: string[], reason?: string) => (await db.movements(ids)).filter((m) => !reason || m.reason === reason);
  /** Orden vault colocada (cajón propio) con `n` cartas en custodia. */
  const placedVault = async (name: string, prices: number[] = [50000, 30000]) => {
    const u = await db.mkUser(name);
    const drawer = await db.mkDrawer();
    const vo = await db.mkVaultOrder(u.id, { prices, placement: 'placed', locationId: drawer.id });
    return { u, drawer, vo };
  };

  // ================================================================ PS-55 / PS-56 / PS-58

  it('PS-55 💰 — orden `vault` colocada: M3 total ⇒ tras la confirmación la carta es plataforma `picking` en el cajón, un `refund_return` con el actor, `needsManual`, sello; sale de holdings; `POST /shipments` 422; no se publica', async () => {
    const { u, drawer, vo } = await placedVault('PS55');
    const tok = await db.loginCustomer(u.email);
    const addr = await db.mkAddress(u.id);
    const r = await m3(vo.order.id);
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('refunded');
    for (const p of vo.pieces) {
      expect(await db.piece(p.id)).toMatchObject({ status: 'picking', ownerType: 'platform', ownerUserId: null, ownershipStatus: null, locationId: drawer.id });
      const mv = await moves([p.id], 'refund_return');
      expect(mv).toHaveLength(1);
      expect(mv[0]).toMatchObject({ fromStatus: 'in_custody', toStatus: 'picking', actorUserId: db.adminId });
    }
    const o = await db.order(vo.order.id);
    expect(o).toMatchObject({ status: 'refunded', chargebackNeedsManual: true });
    expect(o.fullRefundClosedAt).not.toBeNull();
    expect((await db.holdings(tok)).body.data.map((x: any) => x.inventoryItemId)).not.toContain(vo.pieces[0].id);
    const sh = await db.createShipment(tok, { inventoryItemIds: [vo.pieces[0].id], addressId: addr.id });
    expect(sh.status).toBe(422);
    // 🔒 v1.80.7 (punto 3): una pieza que ya NO es del cliente no se explica — `NOT_FOUND` manda (regla M-25);
    // `ITEM_NOT_IN_CUSTODY` queda para lo que SÍ es suyo y no está `in_custody`. Mutación: `classifyItems` busca por
    // `id` sin `ownerUserId` ⇒ `ITEM_NOT_IN_CUSTODY` ⇒ rojo.
    expect(sh.body.error.code).toBe('NOT_FOUND');
    expect((await db.piece(vo.pieces[0].id)).status).not.toBe('listed');
    expect(av3()).toHaveLength(1);
    expect(av3()[0].text).toMatch(/bóveda|vault/i);
    // Mutación: (a) no llamar a la rama `vault` desde `onFullRefund` ⇒ la carta sigue en «Mi bóveda»; (b) `in_stock` en vez de `picking`.
  });

  it('PS-56 💰 — colocación `pending` + M3 ⇒ `cancelled/full_refund` por el súper-admin; `confirm` ⇒ 409 {cancelReason:full_refund}; una `placed` sigue `placed`', async () => {
    const u = await db.mkUser('PS56');
    const vo = await db.mkVaultOrder(u.id, { placement: 'pending' });
    expect((await m3(vo.order.id)).status).toBe(200);
    const p = await db.vaultPlacementRow(vo.placement!.id);
    expect(p).toMatchObject({ status: 'cancelled', cancelReason: 'full_refund', cancelledByUserId: db.adminId });
    const c = await db.vpConfirm(vo.placement!.id, {});
    expect(c.status).toBe(409);
    expect(c.body.error).toMatchObject({ code: 'PLACEMENT_NOT_PENDING', details: { status: 'cancelled', cancelReason: 'full_refund' } });
    const { vo: placed } = await placedVault('PS56b');
    expect((await m3(placed.order.id)).status).toBe(200);
    expect((await db.vaultPlacementRow(placed.placement!.id)).status).toBe('placed');
    // Mutación: omitir la cancelación ⇒ sigue `pending`; quitar `status:'pending'` del WHERE ⇒ el CHECK aborta sobre una `placed`.
  });

  it('PS-58 💰 — Stripe RECHAZA ⇒ fila `failed`; la carta sigue del cliente `in_custody`, colocación `pending`, orden `settled`, sello null', async () => {
    const u = await db.mkUser('PS58');
    const vo = await db.mkVaultOrder(u.id, { placement: 'pending' });
    h.stripe.refundOutcome = 'definitive';
    const r = await m3(vo.order.id);
    expect(r.status).toBe(200);
    expect((await fullRow(vo.order.id))[0].status).toBe('failed');
    expect(await db.piece(vo.pieces[0].id)).toMatchObject({ status: 'in_custody', ownerType: 'customer', ownerUserId: u.id });
    expect((await db.vaultPlacementRow(vo.placement!.id)).status).toBe('pending');
    const o = await db.order(vo.order.id);
    expect(o.status).toBe('settled');
    expect(o.fullRefundClosedAt).toBeNull();
    expect(av3()).toHaveLength(0);
    // Mutación: mover `reclaimVaultOnFullRefund` a la tx que crea la fila ⇒ el cliente queda sin carta y sin dinero.
  });

  // ================================================================ PS-57 — webhook, secuencias y carreras

  it('PS-57 💰 — `charge.refunded` total ⇒ mismos efectos con actor null; directa M3 → recuperada → webhook tardío no escribe; inversa webhook → retry 200; carreras (N≥10)', async () => {
    // webhook solo
    const a = await placedVault('PS57a');
    expect((await db.chargeRefunded(a.vo.pi, a.vo.order.totalCents)).status).toBe(200);
    for (const p of a.vo.pieces) {
      expect(await db.piece(p.id)).toMatchObject({ status: 'picking', ownerType: 'platform' });
      const mv = await moves([p.id], 'refund_return');
      expect(mv).toHaveLength(1);
      expect(mv[0].actorUserId).toBeNull();
    }
    expect(await db.order(a.vo.order.id)).toMatchObject({ status: 'refunded', chargebackNeedsManual: true });
    expect(av3()).toHaveLength(1);
    // secuencia directa
    bandeja = [];
    const b = await placedVault('PS57b');
    expect((await m3(b.vo.order.id)).status).toBe(200);
    expect((await db.chargebackInventory(b.vo.order.id, 'recuperada')).status).toBe(200);
    expect((await db.order(b.vo.order.id)).chargebackNeedsManual).toBe(false);
    expect((await db.chargeRefunded(b.vo.pi, b.vo.order.totalCents)).status).toBe(200);
    expect((await db.order(b.vo.order.id)).chargebackNeedsManual).toBe(false);
    for (const p of b.vo.pieces) expect(await moves([p.id], 'refund_return')).toHaveLength(1);
    expect(await db.audits(b.vo.order.id, 'order.full_refund_closed')).toHaveLength(1);
    expect(await db.audits(b.vo.order.id, 'order.vault_reclaimed')).toHaveLength(0);
    expect(av3()).toHaveLength(1);
    // secuencia inversa (M5): tx1 con transitorio → webhook → retry con `succeeded`
    bandeja = [];
    const c = await placedVault('PS57c');
    h.stripe.refundOutcome = 'transient';
    expect((await m3(c.vo.order.id)).status).toBe(200);
    const row = (await fullRow(c.vo.order.id))[0];
    expect(row.status).toBe('requested');
    expect((await db.chargeRefunded(c.vo.pi, c.vo.order.totalCents)).status).toBe(200);
    const sealAt = (await db.order(c.vo.order.id)).fullRefundClosedAt;
    expect(sealAt).not.toBeNull();
    h.stripe.refundOutcome = 'succeeded';
    const rt = await db.retry(row.id, db.adminToken);
    expect(rt.status).toBe(200);
    expect((await fullRow(c.vo.order.id))[0].status).toBe('succeeded');
    expect(await db.order(c.vo.order.id)).toMatchObject({ status: 'refunded' });
    expect((await db.order(c.vo.order.id)).fullRefundClosedAt).toEqual(sealAt);
    for (const p of c.vo.pieces) expect(await moves([p.id], 'refund_return')).toHaveLength(1);
    expect(await db.audits(c.vo.order.id, 'order.full_refund_closed')).toHaveLength(1);
    expect(av3()).toHaveLength(1);
    h.stripe.refundOutcome = 'ok';
    // carrera: confirmación de M3 (retry) vs webhook, barrera en `Order`
    const outcomes: string[] = [];
    let inter = 0;
    for (let i = 0; i < N; i += 1) {
      bandeja = [];
      const t = await placedVault(`PS57r ${i}`);
      h.stripe.refundOutcome = 'transient';
      expect((await m3(t.vo.order.id)).status).toBe(200);
      const rw = (await fullRow(t.vo.order.id))[0];
      h.stripe.refundOutcome = 'succeeded';
      const res = await db.forced(
        () => db.holdRow('Order', t.vo.order.id),
        () => db.retry(rw.id, db.adminToken),
        () => db.chargeRefunded(t.vo.pi, t.vo.order.totalCents),
      );
      if (res.interleaved) inter += 1;
      const mv = (await db.movements(t.vo.pieces.map((p) => p.id))).filter((m) => m.reason === 'refund_return').length;
      const logs = (await db.audits(t.vo.order.id, 'order.full_refund_closed')).length;
      const ok = mv === t.vo.pieces.length && logs === 1 && av3().length === 1 && (await db.order(t.vo.order.id)).status === 'refunded';
      outcomes.push(`${code(res.a)},${code(res.b)},mv=${mv},log=${logs},av3=${av3().length}${ok ? '' : ',VIOLATION'}`);
    }
    h.stripe.refundOutcome = 'ok';
    expect(report('PS-57-m3-vs-webhook', outcomes, (o) => !o.includes('VIOLATION'))).toBe(N);
    expect(inter).toBe(N);
    // carrera: dos entregas simultáneas del webhook
    const outcomes2: string[] = [];
    let inter2 = 0;
    for (let i = 0; i < N; i += 1) {
      bandeja = [];
      const t = await placedVault(`PS57w ${i}`);
      const res = await db.forced(
        () => db.holdRow('Order', t.vo.order.id),
        () => db.chargeRefunded(t.vo.pi, t.vo.order.totalCents),
        () => db.chargeRefunded(t.vo.pi, t.vo.order.totalCents),
      );
      if (res.interleaved) inter2 += 1;
      const mv = (await db.movements(t.vo.pieces.map((p) => p.id))).filter((m) => m.reason === 'refund_return').length;
      const logs = (await db.audits(t.vo.order.id, 'order.full_refund_closed')).length;
      const ok = mv === t.vo.pieces.length && logs === 1 && av3().length === 1;
      outcomes2.push(`${res.a.status},${res.b.status},mv=${mv},log=${logs},av3=${av3().length}${ok ? '' : ',VIOLATION'}`);
    }
    expect(report('PS-57-webhook-x2', outcomes2, (o) => !o.includes('VIOLATION'))).toBe(N);
    expect(inter2).toBe(N);
    // Mutación: (a) no-op total del sello ⇒ PS-63 roja; (b) `WHERE status='settled'` estricto ⇒ la inversa da 409; (c) sin leer el sello bajo candado ⇒ dos AV-3 en ≥1 tirada.
  });

  it('PS-57c 🔴💰 — un solo orden de candados entre la confirmación de M3 (`retry`) y el taller (`prepared` de un retiro con una carta de la orden), barrera en la fila del retiro (N≥10): cero 40P01/503/500; `prepared` 409 WITHDRAWAL_LINE_ORIGIN_REFUNDED y la pieza `returned`; `retry` 200, fila `succeeded`, orden `refunded`, sello, un AV-3', async () => {
    // v1.80.7 punto 17 (techlead): `applyStripeOutcome` hacía `Order → refunded` ANTES de `onFullRefund` (que toma
    // envíos → piezas → `Order`): sostenía `Order` mientras pedía el retiro; `prepared` (envío → piezas → `Order`)
    // sostenía el retiro mientras pedía `Order` ⇒ `40P01`. Ahora la confirmación sigue el orden del webhook.
    // Mutación: volver a `Order → refunded` antes de `onFullRefund` ⇒ `deadlocks` sube y un 503 en ≥1 tirada.
    // v1.80.7.2 (QA: la rama «prepared 200 + in_packed» salió 0/20): con ESTE fixture es INALCANZABLE — la fila
    // `order_full` `requested` (tx1 de M3) existe ANTES de la carrera, y `prepared` la mira bajo candado
    // (`shipment-prep.service.ts` · `WITHDRAWAL_LINE_ORIGIN_REFUNDED`) ⇒ 409 siempre. Se asevera la única rama
    // alcanzable; «preparado ANTES de la fila ⇒ la confirmación deja la carta intacta» lo cubre PS-63.
    const deadlocks = async () => Number((await h.prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT deadlocks AS n FROM pg_stat_database WHERE datname = current_database()`))[0].n);
    const before = await deadlocks();
    const outcomes: string[] = [];
    let inter = 0;
    let prepared409 = 0;
    for (let i = 0; i < N; i += 1) {
      bandeja = [];
      const t = await placedVault(`PS57c ${i}`);
      const w = await db.mkWithdrawal(t.u.id, [t.vo.pieces[0].id], 'picking', { picked: true });
      h.stripe.refundOutcome = 'transient';
      expect((await m3(t.vo.order.id)).status).toBe(200); // tx1: fila `requested`; el retiro sin preparar no da 409
      const rw = (await fullRow(t.vo.order.id))[0];
      expect(rw.status).toBe('requested');
      h.stripe.refundOutcome = 'succeeded';
      const res = await db.forced(
        () => db.holdRow('ShipmentRequest', w.shipment.id),
        () => db.prepare(w.shipment.id, 0, db.adminToken), // A: el taller, PRIMERO en la cola del retiro
        () => db.retry(rw.id, db.adminToken), // B: la confirmación; con el orden viejo llega sosteniendo `Order`
      );
      if (res.interleaved) inter += 1;
      const piece = await db.piece(t.vo.pieces[0].id);
      const order = await db.order(t.vo.order.id);
      const row = (await fullRow(t.vo.order.id))[0];
      const ws = await db.shipment(w.shipment.id);
      const no5xx = res.a.status < 500 && res.b.status < 500;
      const returned = piece.ownerType === 'platform' && piece.status === 'picking' && (await moves([piece.id], 'refund_return')).length === 1;
      const branchA = res.a.status === 409 && res.a.body?.error?.code === 'WITHDRAWAL_LINE_ORIGIN_REFUNDED' && returned && ws.preparedAt === null;
      if (branchA) prepared409 += 1;
      const ok = no5xx && res.b.status === 200 && row.status === 'succeeded' && order.status === 'refunded' && order.fullRefundClosedAt !== null && av3().length === 1 && branchA;
      outcomes.push(`${code(res.a)},${code(res.b)},piece=${piece.status}/${piece.ownerType},order=${order.status},row=${row.status},av3=${av3().length}${ok ? '' : ',VIOLATION'}`);
    }
    h.stripe.refundOutcome = 'ok';
    await new Promise((r) => setTimeout(r, 1500));
    const delta = (await deadlocks()) - before;
    // eslint-disable-next-line no-console
    console.log(`[PS-RACE PS-57c] deadlocks Δ=${delta} · prepared 409+returned ${prepared409}/${N}`);
    expect(report('PS-57c', outcomes, (o) => !o.includes('VIOLATION'))).toBe(N);
    expect(inter).toBe(N);
    expect(delta).toBe(0);
  });

  it('PS-57d 💰 — contracargo y confirmación de M3, UNA semántica con el webhook (v1.80.7.2, D-a): (seq) disputa commit → `retry` ⇒ cierre por reembolso total hecho con la orden `chargeback` (sello, flag, colocación, cero `refund_return`, cero AV-3) y `charge.refunded` después ⇒ cero escrituras; (race, N=10) disputa encolada primero en `Order` vs `retry` ⇒ misma foto, cero 40P01/503/500', async () => {
    // §M4-SHIP.18.2 (M5), norma v1.80.7.2: la tx de confirmación NO lee `Order.status` sin candado (paso (2) quitado);
    // `onFullRefund` corre siempre, como en el webhook, y la clasificación va DESPUÉS de (4), bajo el candado de (3).
    // Mutaciones: (a) el código de hoy (lectura previa sin candado ⇒ fin) ⇒ (seq) sello `null` ⇒ rojo; (b) semántica
    // (a) del techlead (leer `status` tras el `FOR UPDATE` y salir sin escribir) ⇒ sello `null` en (seq) y en (race).
    const dispute = (pi: string) => h.sendStripeWebhook({ type: 'charge.dispute.created', data: { object: { object: 'dispute', payment_intent: pi } } });
    /** Orden `vault` `settled`, UNA carta `in_custody`, colocación `pending`, y la fila `order_full` `requested` (tx1 de M3, Stripe transitorio). */
    const armed = async (name: string) => {
      const u = await db.mkUser(name);
      const vo = await db.mkVaultOrder(u.id, { prices: [50000], placement: 'pending' });
      h.stripe.refundOutcome = 'transient';
      expect((await m3(vo.order.id)).status).toBe(200);
      const row = (await fullRow(vo.order.id))[0];
      expect(row.status).toBe('requested');
      return { u, vo, row };
    };
    /** La foto final que asevera la norma v1.80.7.2 (la misma en seq y en race). `placementReason` = quien llegó primero. */
    const photo = async (t: Awaited<ReturnType<typeof armed>>, placementReason: 'chargeback' | 'full_refund') => {
      const order = await db.order(t.vo.order.id);
      const row = (await fullRow(t.vo.order.id))[0];
      const ids = t.vo.pieces.map((p) => p.id);
      const refundReturns = (await moves(ids, 'refund_return')).length;
      const chargebackReturns = (await moves(ids, 'chargeback_return')).length;
      const placement = await db.vaultPlacementRow(t.vo.placement!.id);
      const closed = (await db.audits(t.vo.order.id, 'order.full_refund_closed')).length;
      const ok =
        row.status === 'succeeded' &&
        order.status === 'chargeback' &&
        order.fullRefundClosedAt !== null &&
        order.chargebackNeedsManual === true &&
        refundReturns === 0 &&
        chargebackReturns === t.vo.pieces.length &&
        placement.status === 'cancelled' &&
        placement.cancelReason === placementReason &&
        closed === 1 &&
        av3().length === 0;
      return { ok, desc: `row=${row.status},order=${order.status},seal=${order.fullRefundClosedAt ? 'set' : 'null'},flag=${order.chargebackNeedsManual},refund_return=${refundReturns},chargeback_return=${chargebackReturns},placement=${placement.status}/${placement.cancelReason},closed=${closed},av3=${av3().length}` };
    };

    // (seq) — la que falla HOY: disputa COMMIT, después `retry`.
    bandeja = [];
    const s = await armed('PS57d seq');
    expect((await dispute(s.vo.pi)).status).toBe(200);
    expect(await db.order(s.vo.order.id)).toMatchObject({ status: 'chargeback', fullRefundClosedAt: null });
    h.stripe.refundOutcome = 'succeeded';
    const rt = await db.retry(s.row.id, db.adminToken);
    expect(rt.status).toBe(200);
    const seq = await photo(s, 'chargeback');
    // eslint-disable-next-line no-console
    console.log(`[PS-57d seq] ${seq.desc}`);
    expect(seq.desc).toBe(
      `row=succeeded,order=chargeback,seal=set,flag=true,refund_return=0,chargeback_return=${s.vo.pieces.length},placement=cancelled/chargeback,closed=1,av3=0`,
    );
    expect(seq.ok).toBe(true);
    // …y el `charge.refunded` de ese mismo reembolso llega después ⇒ CERO escrituras (convergencia con el webhook).
    const snap = async () => ({
      order: await db.order(s.vo.order.id),
      pieces: await Promise.all(s.vo.pieces.map((p) => db.piece(p.id))),
      moves: await db.movements(s.vo.pieces.map((p) => p.id)),
      audits: await db.audits(s.vo.order.id),
      placement: await db.vaultPlacementRow(s.vo.placement!.id),
      rows: await db.refunds({ orderId: s.vo.order.id }),
    });
    const before = await snap();
    expect((await db.chargeRefunded(s.vo.pi, s.vo.order.totalCents)).status).toBe(200);
    expect(await snap()).toEqual(before);
    expect(av3()).toHaveLength(0);

    // (race, N=10) — barrera en `Order`; A = disputa (toma la pieza, espera `Order`), B = `retry` (espera la pieza detrás de A).
    const outcomes: string[] = [];
    let inter = 0;
    for (let i = 0; i < N; i += 1) {
      bandeja = [];
      const t = await armed(`PS57d race ${i}`);
      h.stripe.refundOutcome = 'succeeded';
      const res = await db.forced(
        () => db.holdRow('Order', t.vo.order.id),
        () => dispute(t.vo.pi),
        () => db.retry(t.row.id, db.adminToken),
      );
      if (res.interleaved) inter += 1;
      const p = await photo(t, 'chargeback');
      const ok = res.a.status === 200 && res.b.status === 200 && p.ok;
      outcomes.push(`${code(res.a)},${code(res.b)},${p.desc}${ok ? '' : ',VIOLATION'}`);
    }
    h.stripe.refundOutcome = 'ok';
    expect(report('PS-57d-dispute-vs-retry', outcomes, (o) => !o.includes('VIOLATION'))).toBe(N);
    expect(inter).toBe(N);
  });

  it('PS-61b — `chargeback-inventory` (recuperada) vs `reclaim-vault` sobre la misma orden `vault` `refunded` sellada, barrera en una pieza devuelta (N≥10): mismo orden (piezas → Order) ⇒ cero interbloqueos, nunca 5xx, los dos 200 y las piezas `listed`', async () => {
    // Techlead (v1.80.7, encargo): `resolveChargebackInventory` reclamaba `Order` (el claim) y DESPUÉS tomaba las piezas;
    // `reclaim-vault`/`unprepare` toman piezas → `Order`. Con el reclamo encolado primero en la pieza y el claim ya
    // hecho ⇒ `40P01` ⇒ 503. Mutación: devolver el claim antes de `vaultReclaimTargets` ⇒ `deadlocks` sube.
    const deadlocks = async () => Number((await h.prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT deadlocks AS n FROM pg_stat_database WHERE datname = current_database()`))[0].n);
    const before = await deadlocks();
    const outcomes: string[] = [];
    let inter = 0;
    for (let i = 0; i < N; i += 1) {
      const t = await placedVault(`PS61b ${i}`);
      expect((await db.chargeRefunded(t.vo.pi, t.vo.order.totalCents)).status).toBe(200);
      expect(await db.order(t.vo.order.id)).toMatchObject({ status: 'refunded', chargebackNeedsManual: true });
      const res = await db.forced(
        () => db.holdRow('InventoryItem', t.vo.pieces[0].id),
        () => db.reclaimVault(t.vo.order.id, { note: 'carrera 61b' }), // A: piezas → Order, PRIMERO en la cola
        () => db.chargebackInventory(t.vo.order.id, 'recuperada'), // B: con el orden viejo llega sosteniendo `Order`
      );
      if (res.interleaved) inter += 1;
      const order = await db.order(t.vo.order.id);
      const pieces = await Promise.all(t.vo.pieces.map((p) => db.piece(p.id)));
      const no5xx = res.a.status < 500 && res.b.status < 500;
      const ok = no5xx && res.a.status === 200 && res.b.status === 200 && order.chargebackNeedsManual === false && pieces.every((p) => p.status === 'listed' && p.ownerType === 'platform');
      outcomes.push(`${code(res.a)},${code(res.b)},needsManual=${order.chargebackNeedsManual},pieces=${pieces.map((p) => p.status).join('/')}${ok ? '' : ',VIOLATION'}`);
    }
    await new Promise((r) => setTimeout(r, 1500));
    const delta = (await deadlocks()) - before;
    // eslint-disable-next-line no-console
    console.log(`[PS-RACE PS-61b] deadlocks Δ=${delta}`);
    expect(report('PS-61b', outcomes, (o) => !o.includes('VIOLATION'))).toBe(N);
    expect(inter).toBe(N);
    expect(delta).toBe(0);
  });

  // ================================================================ PS-59 / PS-63 / PS-66 — el retiro preparado

  it('PS-59 💰 — carta en un retiro `picking` PREPARADO ⇒ M3 409 VAULT_PIECE_IN_PACKED_WITHDRAWAL (cero filas); tras deshacer ⇒ 200, pieza `returned`, línea `blocked`; `prepared` sin 409; no pasa a `withdrawn`; por webhook ⇒ intacta, `in_packed_withdrawal`, flag', async () => {
    const a = await placedVault('PS59a');
    const other = await placedVault('PS59o');
    // retiro con una carta de A y una de OTRA compra liquidada
    const w = await db.mkWithdrawal(a.u.id, [a.vo.pieces[0].id], 'picking');
    const lineA = w.lines[0];
    await db.mark(w.shipment.id, lineA.id, { status: 'picked' });
    expect((await db.prepare(w.shipment.id, 0)).status).toBe(200);
    const r = await m3(a.vo.order.id);
    expect(r.status).toBe(409);
    expect(r.body.error).toMatchObject({ code: 'VAULT_PIECE_IN_PACKED_WITHDRAWAL', details: { items: [expect.objectContaining({ inventoryItemId: a.vo.pieces[0].id, shipmentId: w.shipment.id })] } });
    expect(await fullRow(a.vo.order.id)).toHaveLength(0);
    expect(await moves([a.vo.pieces[0].id])).toHaveLength(0);
    expect((await db.unprepare(w.shipment.id)).status).toBe(200);
    // segunda carta del retiro: de OTRA compra (para que el retiro siga vivo)
    void other;
    const r2 = await m3(a.vo.order.id);
    expect(r2.status).toBe(200);
    expect(await db.piece(a.vo.pieces[0].id)).toMatchObject({ status: 'picking', ownerType: 'platform' });
    const q = (await db.queue()).body.data.find((x: any) => x.shipmentId === w.shipment.id);
    expect(q.items.find((i: any) => i.inventoryItemId === a.vo.pieces[0].id).availability.kind).toBe('blocked');
    expect(q.preparation).toMatchObject({ blocked: 1, refundPreviewCents: 21405 });
    // (retiro de UNA carta ⇒ el cierre de PS-66; el mixto se mide abajo)
    const detail = await db.adminOrder(a.vo.order.id);
    expect(detail.body.vaultPieces.find((p: any) => p.inventoryItemId === a.vo.pieces[0].id)).toMatchObject({ state: 'returned', pendingConfirmation: true });
    // mixto: retiro con la carta de A y una de OTRA compra ⇒ `prepared` 200 sin 409, `entregado` no la pasa a withdrawn
    const b = await placedVault('PS59b');
    const w2 = await db.mkWithdrawal(b.u.id, [b.vo.pieces[0].id], 'picking');
    // la de otra compra del MISMO cliente
    const b2 = await db.mkVaultOrder(b.u.id, { prices: [20000], placement: 'placed', locationId: b.drawer.id });
    await h.prisma.shipmentItem.create({ data: { shipmentRequestId: w2.shipment.id, inventoryItemId: b2.pieces[0].id } });
    expect((await m3(b.vo.order.id)).status).toBe(200);
    const lines = await h.prisma.shipmentItem.findMany({ where: { shipmentRequestId: w2.shipment.id } });
    await db.mark(w2.shipment.id, lines.find((l) => l.inventoryItemId === b2.pieces[0].id)!.id, { status: 'picked' });
    const prep = await db.prepare(w2.shipment.id, 0);
    expect(prep.status).toBe(200);
    expect(prep.body.outcome).toBe('prepared');
    expect((await db.tracking(w2.shipment.id)).status).toBeLessThan(300);
    expect((await db.status(w2.shipment.id, 'enviado')).status).toBe(200);
    expect((await db.status(w2.shipment.id, 'entregado')).status).toBe(200);
    expect((await db.piece(b2.pieces[0].id)).status).toBe('withdrawn');
    expect(await db.piece(b.vo.pieces[0].id)).toMatchObject({ status: 'picking', ownerType: 'platform' });
    // por webhook con el retiro preparado ⇒ intacta EN ESA PASADA, `in_packed_withdrawal`, flag true
    const c = await placedVault('PS59c');
    const w3 = await db.mkWithdrawal(c.u.id, [c.vo.pieces[0].id], 'picking');
    await db.mark(w3.shipment.id, w3.lines[0].id, { status: 'picked' });
    expect((await db.prepare(w3.shipment.id, 0)).status).toBe(200);
    expect((await db.chargeRefunded(c.vo.pi, c.vo.order.totalCents)).status).toBe(200);
    expect(await db.piece(c.vo.pieces[0].id)).toMatchObject({ status: 'in_custody', ownerType: 'customer' });
    expect(await db.piece(c.vo.pieces[1].id)).toMatchObject({ status: 'picking', ownerType: 'platform' });
    const d3 = await db.adminOrder(c.vo.order.id);
    expect(d3.body.chargebackNeedsManual).toBe(true);
    expect(d3.body.vaultPieces.find((p: any) => p.inventoryItemId === c.vo.pieces[0].id).state).toBe('in_packed_withdrawal');
    // Mutación: (a) quitar la precondición ⇒ M3 200 con la carta en la caja; (b) tratar «preparado» como «sin preparar».
  });

  it('PS-63 💰🔒 — reclamo POR PIEZA: retiro preparado antes de la fila ⇒ confirmación deja la carta intacta; tracking 409; deshacer preparado la reclama; guía + reclaim-vault con confirmUnpacked; B12 por pieza', async () => {
    const a = await placedVault('PS63a');
    const w = await db.mkWithdrawal(a.u.id, [a.vo.pieces[0].id], 'picking');
    await db.mark(w.shipment.id, w.lines[0].id, { status: 'picked' });
    expect((await db.prepare(w.shipment.id, 0)).status).toBe(200);
    // fixture: la fila `order_full` nace DESPUÉS del preparado (la ventana que la guarda de tx1 no ve)
    const row = await h.prisma.paymentRefund.create({
      data: { idempotencyKey: `order-full:${a.vo.order.id}`, kind: 'order_full', orderId: a.vo.order.id, amountCents: a.vo.order.totalCents, merchandiseCents: 80000, merchandiseIvaCents: 80000 - Math.floor(80000 / 1.16), shippingCents: 0, shippingIvaCents: 0, processingFeeCents: 4617, status: 'requested', requestedByUserId: db.adminId, requestedByRole: 'super_admin', reason: 'fixture PS-63' },
    });
    h.stripe.refundOutcome = 'succeeded';
    const rt = await db.retry(row.id, db.adminToken);
    expect(rt.status).toBe(200);
    h.stripe.refundOutcome = 'ok';
    expect((await fullRow(a.vo.order.id))[0].status).toBe('succeeded');
    const o = await db.order(a.vo.order.id);
    expect(o).toMatchObject({ status: 'refunded', chargebackNeedsManual: true });
    expect(o.fullRefundClosedAt).not.toBeNull();
    expect(await db.piece(a.vo.pieces[0].id)).toMatchObject({ status: 'in_custody', ownerType: 'customer' });
    const d = await db.adminOrder(a.vo.order.id);
    expect(d.body.vaultPieces.find((p: any) => p.inventoryItemId === a.vo.pieces[0].id).state).toBe('in_packed_withdrawal');
    const closedLog = (await db.audits(a.vo.order.id, 'order.full_refund_closed'))[0].after as any;
    expect(closedLog.untouched.map((x: any) => x.inventoryItemId)).toContain(a.vo.pieces[0].id);
    expect(av3()).toHaveLength(1);
    // tracking ⇒ 409 con la carta
    const t = await db.tracking(w.shipment.id);
    expect(t.status).toBe(409);
    expect(t.body.error).toMatchObject({ code: 'WITHDRAWAL_LINE_ORIGIN_REFUNDED', details: { items: [expect.objectContaining({ inventoryItemId: a.vo.pieces[0].id })] } });
    expect((await db.shipment(w.shipment.id)).status).toBe('picking');
    // deshacer preparado ⇒ reclama
    bandeja = [];
    const un = await db.unprepare(w.shipment.id);
    expect(un.status).toBe(200);
    expect(un.body.outcome).toBe('unprepared');
    expect(un.body.reclaimed).toEqual([{ orderId: a.vo.order.id, inventoryItemIds: [a.vo.pieces[0].id] }]);
    expect(await db.piece(a.vo.pieces[0].id)).toMatchObject({ status: 'picking', ownerType: 'platform' });
    const mv = await moves([a.vo.pieces[0].id], 'refund_return');
    expect(mv).toHaveLength(1);
    expect(mv[0].actorUserId).toBe(db.operatorId);
    expect(await db.audits(a.vo.order.id, 'order.vault_reclaimed')).toHaveLength(1);
    expect((await db.order(a.vo.order.id)).fullRefundClosedAt).toEqual(o.fullRefundClosedAt);
    expect(av3()).toHaveLength(0);
    // webhook tardío ⇒ cero escrituras
    const before = await db.movements([a.vo.pieces[0].id, a.vo.pieces[1].id]);
    expect((await db.chargeRefunded(a.vo.pi, a.vo.order.totalCents)).status).toBe(200);
    expect(await db.movements([a.vo.pieces[0].id, a.vo.pieces[1].id])).toEqual(before);
    expect(await db.audits(a.vo.order.id, 'order.full_refund_closed')).toHaveLength(1);
    // POST /shipments con ella ⇒ 422
    const tok = await db.loginCustomer(a.u.email);
    const addr = await db.mkAddress(a.u.id);
    const sh = await db.createShipment(tok, { inventoryItemIds: [a.vo.pieces[0].id], addressId: addr.id });
    expect(sh.status).toBe(422);
    expect(sh.body.error.code).toBe('NOT_FOUND'); // v1.80.7 punto 3 (M-25): ya no es suya ⇒ no se explica

    // Variante `guia`: webhook con el retiro en guía
    const g = await placedVault('PS63g');
    const g2 = await db.mkVaultOrder(g.u.id, { prices: [20000], placement: 'placed', locationId: g.drawer.id });
    const wg = await db.mkWithdrawal(g.u.id, [g.vo.pieces[0].id, g2.pieces[0].id], 'picking');
    for (const l of wg.lines) await db.mark(wg.shipment.id, l.id, { status: 'picked' });
    expect((await db.prepare(wg.shipment.id, 0)).status).toBe(200);
    expect((await db.tracking(wg.shipment.id)).status).toBeLessThan(300);
    expect((await db.chargeRefunded(g.vo.pi, g.vo.order.totalCents)).status).toBe(200);
    expect(await db.piece(g.vo.pieces[0].id)).toMatchObject({ status: 'in_custody', ownerType: 'customer' });
    const env = await db.status(wg.shipment.id, 'enviado');
    expect(env.status).toBe(409);
    expect(env.body.error.code).toBe('WITHDRAWAL_LINE_ORIGIN_REFUNDED');
    const noConfirm = await db.reclaimVault(g.vo.order.id, { note: 'sin sacarla de la caja' });
    expect(noConfirm.status).toBe(200);
    expect(noConfirm.body.reclaimed).toEqual([]);
    expect(await db.piece(g.vo.pieces[0].id)).toMatchObject({ status: 'in_custody', ownerType: 'customer' });
    const yes = await db.reclaimVault(g.vo.order.id, { note: 'saqué la carta de la caja', confirmUnpacked: true });
    expect(yes.status).toBe(200);
    expect(yes.body.reclaimed).toEqual([g.vo.pieces[0].id]);
    expect(await db.piece(g.vo.pieces[0].id)).toMatchObject({ status: 'picking', ownerType: 'platform' });
    expect(await moves([g.vo.pieces[0].id], 'refund_return')).toHaveLength(1);
    const lg = (await db.audits(g.vo.order.id, 'order.vault_reclaimed'))[0].after as any;
    expect(lg.unpackedConfirmed).toBe(true);
    expect((await h.prisma.shipmentItem.findFirst({ where: { shipmentRequestId: wg.shipment.id, inventoryItemId: g.vo.pieces[0].id } }))!.prepStatus).toBe('picked');
    expect((await db.status(wg.shipment.id, 'enviado')).status).toBe(200);
    expect((await db.status(wg.shipment.id, 'entregado')).status).toBe(200);
    expect((await db.piece(g2.pieces[0].id)).status).toBe('withdrawn');
    expect((await db.piece(g.vo.pieces[0].id)).status).toBe('picking');
    // idempotencia
    const again = await db.reclaimVault(g.vo.order.id, { note: 'otra vez', confirmUnpacked: true });
    expect(again.status).toBe(200);
    expect(again.body.reclaimed).toEqual([]);
    expect(await moves([g.vo.pieces[0].id], 'refund_return')).toHaveLength(1);

    // B12 (v1.80.6): dos cartas en DOS retiros en guía ⇒ `inventoryItemIds:[A]` reclama solo A
    const b = await placedVault('PS63b');
    const wA = await db.mkWithdrawal(b.u.id, [b.vo.pieces[0].id], 'picking');
    const wB = await db.mkWithdrawal(b.u.id, [b.vo.pieces[1].id], 'picking');
    for (const w_ of [wA, wB]) {
      await db.mark(w_.shipment.id, w_.lines[0].id, { status: 'picked' });
      expect((await db.prepare(w_.shipment.id, 0)).status).toBe(200);
      expect((await db.tracking(w_.shipment.id)).status).toBeLessThan(300);
    }
    expect((await db.chargeRefunded(b.vo.pi, b.vo.order.totalCents)).status).toBe(200);
    const bad1 = await db.reclaimVault(b.vo.order.id, { note: 'ids sin confirmar', inventoryItemIds: [b.vo.pieces[0].id] });
    expect(bad1.status).toBe(400);
    const stranger = await db.mkPiece({ status: 'in_stock' });
    const bad2 = await db.reclaimVault(b.vo.order.id, { note: 'id ajeno', confirmUnpacked: true, inventoryItemIds: [stranger.id] });
    expect(bad2.status).toBe(400);
    expect(bad2.body.error.details).toMatchObject({ field: 'inventoryItemIds' });
    expect(await moves([b.vo.pieces[0].id, b.vo.pieces[1].id])).toHaveLength(0);
    const onlyA = await db.reclaimVault(b.vo.order.id, { note: 'saqué A', confirmUnpacked: true, inventoryItemIds: [b.vo.pieces[0].id] });
    expect(onlyA.status).toBe(200);
    expect(onlyA.body.reclaimed).toEqual([b.vo.pieces[0].id]);
    expect(await db.piece(b.vo.pieces[1].id)).toMatchObject({ status: 'in_custody', ownerType: 'customer' });
    expect(onlyA.body.vaultPieces.find((p: any) => p.inventoryItemId === b.vo.pieces[1].id).state).toBe('in_packed_withdrawal');
    expect(((await db.audits(b.vo.order.id, 'order.vault_reclaimed'))[0].after as any).inventoryItemIds).toEqual([b.vo.pieces[0].id]);
    // Mutación: (a) no-op total del sello ⇒ tras el DELETE la pieza sigue del cliente; (e) reclamar la de `guia` sin `confirmUnpacked`; (f) ignorar `inventoryItemIds` ⇒ B reclamada.
  });

  it('PS-66 💰 — el retiro vacío por reclamo se cierra y devuelve su tarifa: `prepared {0}` ⇒ 409 REFUND_PREVIEW_STALE; `{totalCents}` ⇒ closed_nothing_to_ship + shipment_fee + AV-12; mixto ⇒ `prepared` sin fee; el operador suma en su tope', async () => {
    const a = await placedVault('PS66');
    const w = await db.mkWithdrawal(a.u.id, [a.vo.pieces[0].id], 'picking');
    expect((await m3(a.vo.order.id)).status).toBe(200);
    const q = (await db.queue()).body.data.find((x: any) => x.shipmentId === w.shipment.id);
    expect(q.preparation).toMatchObject({ status: 'in_progress', blocked: 1, picked: 0, pending: 0, refundPreviewCents: 21405 });
    const stale = await db.prepare(w.shipment.id, 0);
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatchObject({ code: 'REFUND_PREVIEW_STALE', details: { refundCents: 21405 } });
    bandeja = [];
    const used0 = (await db.operatorSummary()).body.operators.find((o: any) => o.user.userId === db.operatorId)?.capUsedCents ?? 0;
    const close = await db.prepare(w.shipment.id, 21405);
    expect(close.status).toBe(200);
    expect(close.body.outcome).toBe('closed_nothing_to_ship');
    const fee = await db.refunds({ shipmentRequestId: w.shipment.id });
    expect(fee).toHaveLength(1);
    expect(fee[0]).toMatchObject({ kind: 'shipment_fee', amountCents: 21405, requestedByRole: 'vault_operator' });
    expect(h.stripe.refundCreateCalls[h.stripe.refundCreateCalls.length - 1]).toMatchObject({ paymentIntentId: w.pi, amountCents: 21405 });
    expect((await db.shipment(w.shipment.id)).status).toBe('cancelado');
    expect(av12()).toHaveLength(1);
    const log = (await db.audits(w.shipment.id, 'shipment.prepared'))[0].after as any;
    expect(log.missing).toEqual([]);
    expect(log.blocked).toEqual([a.vo.pieces[0].id]);
    const used1 = (await db.operatorSummary()).body.operators.find((o: any) => o.user.userId === db.operatorId).capUsedCents;
    expect(used1 - used0).toBe(21405);
    // variante `unprepared`: retiro preparado antes de la tx1 → confirmación → deshacer reclama → preparar cierra igual
    const b = await placedVault('PS66b');
    const wb = await db.mkWithdrawal(b.u.id, [b.vo.pieces[0].id], 'picking');
    await db.mark(wb.shipment.id, wb.lines[0].id, { status: 'picked' });
    expect((await db.prepare(wb.shipment.id, 0)).status).toBe(200);
    const row = await h.prisma.paymentRefund.create({
      data: { idempotencyKey: `order-full:${b.vo.order.id}`, kind: 'order_full', orderId: b.vo.order.id, amountCents: b.vo.order.totalCents, merchandiseCents: 80000, merchandiseIvaCents: 80000 - Math.floor(80000 / 1.16), shippingCents: 0, shippingIvaCents: 0, processingFeeCents: 4617, status: 'requested', requestedByUserId: db.adminId, requestedByRole: 'super_admin', reason: 'fixture PS-66' },
    });
    h.stripe.refundOutcome = 'succeeded';
    expect((await db.retry(row.id, db.adminToken)).status).toBe(200);
    h.stripe.refundOutcome = 'ok';
    expect((await db.unprepare(wb.shipment.id)).body.reclaimed).toEqual([{ orderId: b.vo.order.id, inventoryItemIds: [b.vo.pieces[0].id] }]);
    const closeb = await db.prepare(wb.shipment.id, 21405);
    expect(closeb.status).toBe(200);
    expect(closeb.body.outcome).toBe('closed_nothing_to_ship');
    // mixto: otra línea `picked` de una compra liquidada ⇒ `prepared`, cero fee, el retiro sigue vivo
    const c = await placedVault('PS66c');
    const c2 = await db.mkVaultOrder(c.u.id, { prices: [20000], placement: 'placed', locationId: c.drawer.id });
    const wc = await db.mkWithdrawal(c.u.id, [c.vo.pieces[0].id, c2.pieces[0].id], 'picking');
    expect((await m3(c.vo.order.id)).status).toBe(200);
    await db.mark(wc.shipment.id, wc.lines.find((l) => l.inventoryItemId === c2.pieces[0].id)!.id, { status: 'picked' });
    const mixed = await db.prepare(wc.shipment.id, 0);
    expect(mixed.status).toBe(200);
    expect(mixed.body.outcome).toBe('prepared');
    expect(await db.refunds({ shipmentRequestId: wc.shipment.id })).toHaveLength(0);
    expect((await db.shipment(wc.shipment.id)).status).toBe('picking');
    // Mutación: (a) excluir retiros del cierre del paso 5 ⇒ `picking` para siempre; (b) contar la bloqueada como picked; (c) cerrar sin `shipment_fee`.
  });

  // ================================================================ PS-60 / PS-52 — la cadena, la re-compra, el caso abierto

  it('PS-60 💰 / PS-52 — cadena: M3 revierte la REPUESTA, no la original; re-compra en O2 ⇒ `other_purchase`; caso abierto ⇒ intacta, `void` 200, `replace`/`found` 409 {refunded}; ciclo forzado ⇒ needsManual sin escrituras', async () => {
    // cadena X → Y
    const a = await placedVault('PS60');
    const w = await db.mkWithdrawal(a.u.id, [a.vo.pieces[0].id], 'picking');
    await db.mark(w.shipment.id, w.lines[0].id, { status: 'missing', missingReason: 'not_found' });
    expect((await db.prepare(w.shipment.id, 0)).status).toBe(200);
    const c1 = await h.prisma.replacementCase.findFirstOrThrow({ where: { shipmentRequestId: w.shipment.id } });
    const y = await db.mkPiece({ status: 'in_stock' });
    expect((await db.caseReplace(c1.id, { inventoryItemId: y.id })).body.outcome).toBe('replaced');
    // (cerramos el retiro por fixture para que Y no esté en una caja preparada)
    await h.prisma.shipmentRequest.update({ where: { id: w.shipment.id }, data: { status: 'cancelado' } });
    expect((await m3(a.vo.order.id)).status).toBe(200);
    expect(await db.piece(y.id)).toMatchObject({ status: 'picking', ownerType: 'platform' });
    expect(await db.piece(a.vo.pieces[0].id)).toMatchObject({ status: 'lost', ownerType: 'platform' });
    expect(await moves([a.vo.pieces[0].id], 'refund_return')).toHaveLength(0);
    // re-compra: Y re-comprada en O2 ⇒ M3 de O1 no la toca
    const b = await placedVault('PS60b');
    const wb = await db.mkWithdrawal(b.u.id, [b.vo.pieces[0].id], 'picking');
    await db.mark(wb.shipment.id, wb.lines[0].id, { status: 'missing', missingReason: 'not_found' });
    expect((await db.prepare(wb.shipment.id, 0)).status).toBe(200);
    const cb = await h.prisma.replacementCase.findFirstOrThrow({ where: { shipmentRequestId: wb.shipment.id } });
    const yb = await db.mkPiece({ status: 'in_stock' });
    expect((await db.caseReplace(cb.id, { inventoryItemId: yb.id })).body.outcome).toBe('replaced');
    await h.prisma.shipmentRequest.update({ where: { id: wb.shipment.id }, data: { status: 'cancelado' } });
    // O2: el mismo cliente compra YB de nuevo (contracargo de O1 la devolvió a plataforma… aquí lo simulamos con una
    // orden liquidada MÁS RECIENTE que el caso cuya línea apunta a YB)
    const o2 = await h.prisma.order.create({
      data: { userId: b.u.id, orderNumber: `SPO2-${RUN}`, fulfillmentMode: 'vault', status: 'settled', settledAt: new Date(Date.now() + 1000), subtotalCents: 50000, shippingFeeCents: 0, processingFeeCents: 0, ivaCents: 6897, ivaRatePct: 16, totalCents: 50000, priceConvention: 'IVA_INCLUSIVE', stripePaymentIntentId: `pi_o2_${RUN}`, items: { create: [{ inventoryItemId: yb.id, cardSnapshot: {}, unitPriceCents: 50000 }] } },
    });
    db.orders.push(o2.id);
    h.stripe.chargedByIntent.set(`pi_o2_${RUN}`, 50000);
    expect((await m3(b.vo.order.id)).status).toBe(200);
    expect(await db.piece(yb.id)).toMatchObject({ status: 'in_custody', ownerType: 'customer', ownerUserId: b.u.id });
    const db_ = await db.adminOrder(b.vo.order.id);
    expect(db_.body.vaultPieces.find((p: any) => p.orderItemId === b.vo.orderItems[0].id).state).toBe('other_purchase');
    // caso abierto: intacta, void 200, replace/found 409 {refunded}
    const c = await placedVault('PS60c');
    const wc = await db.mkWithdrawal(c.u.id, [c.vo.pieces[0].id], 'picking');
    await db.mark(wc.shipment.id, wc.lines[0].id, { status: 'missing', missingReason: 'not_found' });
    expect((await db.prepare(wc.shipment.id, 0)).status).toBe(200);
    const cc = await h.prisma.replacementCase.findFirstOrThrow({ where: { shipmentRequestId: wc.shipment.id } });
    expect((await m3(c.vo.order.id)).status).toBe(200);
    expect(await db.piece(c.vo.pieces[0].id)).toMatchObject({ status: 'lost', ownerType: 'customer', ownerUserId: c.u.id });
    expect((await db.kase(cc.id)).status).toBe('open');
    expect((await db.adminOrder(c.vo.order.id)).body.vaultPieces.find((p: any) => p.inventoryItemId === c.vo.pieces[0].id).state).toBe('open_case');
    const cand = await db.mkPiece({ status: 'in_stock' });
    const rep = await db.caseReplace(cc.id, { inventoryItemId: cand.id });
    expect(rep.status).toBe(409);
    expect(rep.body.error).toMatchObject({ code: 'CASE_ORIGIN_NOT_SETTLED', details: { originStatus: 'refunded' } });
    expect((await db.piece(cand.id)).status).toBe('in_stock');
    const fnd = await db.caseReplace(cc.id, { inventoryItemId: c.vo.pieces[0].id });
    expect(fnd.status).toBe(409);
    expect((await db.piece(c.vo.pieces[0].id)).status).toBe('lost');
    const v = await db.caseVoid(cc.id, { note: 'reembolso total' });
    expect(v.status).toBe(200);
    expect(await db.piece(c.vo.pieces[0].id)).toMatchObject({ status: 'lost', ownerType: 'platform' });
    // PS-52: ciclo forzado por fixture (A→B→A) ⇒ contracargo ⇒ needsManual, cero escrituras
    const d = await placedVault('PS52');
    const pA = d.vo.pieces[0];
    const pB = await db.mkPiece({ status: 'in_custody', ownerType: 'customer', ownerUserId: d.u.id, ownershipStatus: 'settled' });
    // el CHECK exige un nodo (placementItemId): usamos las líneas de la colocación
    const items = await h.prisma.vaultPlacementItem.findMany({ where: { placementId: d.vo.placement!.id } });
    await h.prisma.replacementCase.create({ data: { source: 'vault_purchase', placementItemId: items[0].id, customerUserId: d.u.id, originalInventoryItemId: pA.id, missingReason: 'not_found', originOrderItemId: d.vo.orderItems[0].id, openedAt: new Date(), openedByUserId: db.operatorId, status: 'replaced', resolvedAt: new Date(), resolvedByUserId: db.operatorId, replacementInventoryItemId: pB.id } });
    await h.prisma.replacementCase.create({ data: { source: 'vault_purchase', placementItemId: items[1].id, customerUserId: d.u.id, originalInventoryItemId: pB.id, missingReason: 'not_found', originOrderItemId: d.vo.orderItems[0].id, openedAt: new Date(), openedByUserId: db.operatorId, status: 'replaced', resolvedAt: new Date(), resolvedByUserId: db.operatorId, replacementInventoryItemId: pA.id } });
    const beforeA = await db.piece(pA.id);
    const wh = await h.sendStripeWebhook({ type: 'charge.dispute.created', data: { object: { object: 'dispute', payment_intent: d.vo.pi } } });
    expect(wh.status).toBe(200);
    expect(await db.order(d.vo.order.id)).toMatchObject({ status: 'chargeback', chargebackNeedsManual: true });
    expect(await db.piece(pA.id)).toEqual(beforeA);
    expect((await db.piece(pB.id)).ownerUserId).toBe(d.u.id);
    // Mutación: (a) `oi.inventoryItemId` en vez de `currentPieceOf` ⇒ Y con el cliente; (b) sin `resolveOrigin` ⇒ Y de O2 revertida; (c) sin FOR UPDATE de la orden en `replace`.
  });

  // ================================================================ PS-61 / PS-64 — chargeback-inventory y «ningún camino publica»

  it('PS-61 — `chargeback-inventory` sobre `vault` `refunded`: recuperada ⇒ picking→listed sin movimientos; no_recuperada ⇒ lost + movimiento firmado y merma UNA vez; reexpedir 409; settled 400; repetir 409; objetivo forzado a in_stock ⇒ 409; pasada nueva solo toca la nueva', async () => {
    const a = await placedVault('PS61');
    const settled = await placedVault('PS61s');
    expect((await db.chargebackInventory(settled.vo.order.id, 'recuperada')).status).toBe(400);
    expect((await m3(a.vo.order.id)).status).toBe(200);
    expect((await db.chargebackInventory(a.vo.order.id, 'reexpedir')).status).toBe(409);
    const mvBefore = (await db.movements(a.vo.pieces.map((p) => p.id))).length;
    const rec = await db.chargebackInventory(a.vo.order.id, 'recuperada');
    expect(rec.status).toBe(200);
    for (const p of a.vo.pieces) expect((await db.piece(p.id)).status).toBe('listed');
    expect((await db.movements(a.vo.pieces.map((p) => p.id))).length).toBe(mvBefore);
    expect((await db.chargebackInventory(a.vo.order.id, 'recuperada')).status).toBe(409);
    // no_recuperada ⇒ lost con actor; la merma la cuenta UNA vez
    const b = await placedVault('PS61b');
    expect((await m3(b.vo.order.id)).status).toBe(200);
    const shrink0 = (await db.shrinkage(`?actorUserId=${db.operatorId}`)).body.totals.pieces;
    expect((await db.chargebackInventory(b.vo.order.id, 'no_recuperada')).status).toBe(200);
    for (const p of b.vo.pieces) {
      expect((await db.piece(p.id)).status).toBe('lost');
      const mv = await moves([p.id], 'lost');
      expect(mv).toHaveLength(1);
      expect(mv[0].actorUserId).toBe(db.operatorId);
    }
    expect((await db.shrinkage(`?actorUserId=${db.operatorId}`)).body.totals.pieces - shrink0).toBe(b.vo.pieces.length);
    const vp = (await db.adminOrder(b.vo.order.id)).body.vaultPieces;
    expect(vp.every((p: any) => p.state === 'returned' && p.pendingConfirmation === false)).toBe(true);
    // objetivo forzado a `in_stock` ⇒ 409 CONFLICT y rollback
    const c = await placedVault('PS61c');
    expect((await m3(c.vo.order.id)).status).toBe(200);
    await h.prisma.inventoryItem.update({ where: { id: c.vo.pieces[0].id }, data: { status: 'in_stock' } });
    const conf = await db.chargebackInventory(c.vo.order.id, 'recuperada');
    expect(conf.status).toBe(409);
    expect(conf.body.error.code).toBe('CONFLICT');
    expect((await db.order(c.vo.order.id)).chargebackNeedsManual).toBe(true);
    expect((await db.piece(c.vo.pieces[1].id)).status).toBe('picking');
    // pasada nueva: tras `recuperada`, se reclama OTRA carta (retiro en guía + reclaim-vault) ⇒ flag true y `recuperada` solo toca la nueva
    const d = await placedVault('PS61d');
    const wd = await db.mkWithdrawal(d.u.id, [d.vo.pieces[1].id], 'picking');
    await db.mark(wd.shipment.id, wd.lines[0].id, { status: 'picked' });
    expect((await db.prepare(wd.shipment.id, 0)).status).toBe(200);
    expect((await db.tracking(wd.shipment.id)).status).toBeLessThan(300);
    expect((await db.chargeRefunded(d.vo.pi, d.vo.order.totalCents)).status).toBe(200);
    expect((await db.chargebackInventory(d.vo.order.id, 'recuperada')).status).toBe(200);
    expect((await db.piece(d.vo.pieces[0].id)).status).toBe('listed');
    const rv = await db.reclaimVault(d.vo.order.id, { note: 'saqué la segunda', confirmUnpacked: true });
    expect(rv.body.reclaimed).toEqual([d.vo.pieces[1].id]);
    expect((await db.order(d.vo.order.id)).chargebackNeedsManual).toBe(true);
    const mv0 = (await db.movements([d.vo.pieces[0].id])).length;
    expect((await db.chargebackInventory(d.vo.order.id, 'recuperada')).status).toBe(200);
    expect((await db.piece(d.vo.pieces[1].id)).status).toBe('listed');
    expect((await db.piece(d.vo.pieces[0].id)).status).toBe('listed');
    expect((await db.movements([d.vo.pieces[0].id])).length).toBe(mv0);
    // Mutación: dejar «solo direct_ship» ⇒ 400 y `picking` para siempre; seleccionar objetivos por `in_stock`; atar `reclaimedBy` a la `note`.
  });

  it('PS-64 💰🔒 / PS-41 / PS-42 — ningún camino publica una congelada; `mark` y `PATCH in_stock` con guarda; carrera mark vs checkout (N≥10)', async () => {
    const a = await placedVault('PS64');
    expect((await m3(a.vo.order.id)).status).toBe(200);
    const ids = a.vo.pieces.map((p) => p.id);
    const pa = await db.publishAll({});
    expect(pa.status).toBeLessThan(300);
    for (const id of ids) expect((await db.piece(id)).status).toBe('picking');
    expect(JSON.stringify(pa.body)).not.toContain(ids[0]);
    const bp = await db.bulkPublish(ids);
    expect(bp.status).toBeLessThan(300);
    const lines = bp.body.results;
    expect(lines).toHaveLength(2);
    expect(lines.every((l: any) => l.ok === false && JSON.stringify(l).includes('ITEM_NOT_PUBLISHABLE'))).toBe(true);
    const patch = await db.invPatch(ids[0], { status: 'listed' });
    expect(patch.status).toBe(422);
    expect(patch.body.error.code).toBe('ITEM_NOT_PUBLISHABLE');
    const mv = await db.invMove(ids[0], db.shopLocationId);
    expect(mv.status).toBeLessThan(300);
    expect(await db.piece(ids[0])).toMatchObject({ status: 'picking', locationId: db.shopLocationId });
    const mk = await db.invMark(ids[0], { mark: 'lost', note: 'no' });
    expect(mk.status).toBe(422);
    expect(mk.body.error).toMatchObject({ code: 'ITEM_NOT_ADJUSTABLE', details: { status: 'picking', ownerType: 'platform' } });
    // v1.80.6 (M6): tras el `move`, el detalle sigue dándolas `returned` con `pendingConfirmation:true`; recuperada ⇒ listed
    const det = await db.adminOrder(a.vo.order.id);
    expect(det.body.vaultPieces.filter((p: any) => p.state === 'returned' && p.pendingConfirmation === true)).toHaveLength(2);
    expect((await db.chargebackInventory(a.vo.order.id, 'recuperada')).status).toBe(200);
    for (const id of ids) expect((await db.piece(id)).status).toBe('listed');
    // PS-41: `mark` sobre plataforma in_stock ⇒ 200 lost + movimiento con actor; el resto ⇒ 422, cero escrituras
    const ok = await db.mkPiece({ status: 'in_stock' });
    const mok = await db.invMark(ok.id, { mark: 'lost', note: 'no la encontré' });
    expect(mok.status).toBeLessThan(300);
    expect((await db.piece(ok.id)).status).toBe('lost');
    expect((await moves([ok.id], 'lost'))[0].actorUserId).toBe(db.operatorId);
    const cust = await db.mkUser('PS41 cliente');
    const forbidden = [
      await db.mkPiece({ status: 'picking' }),
      await db.mkPiece({ status: 'reserved' }),
      await db.mkPiece({ status: 'lost' }),
      await db.mkPiece({ status: 'damaged' }),
      await db.mkPiece({ status: 'in_custody', ownerType: 'customer', ownerUserId: cust.id, ownershipStatus: 'settled' }),
    ];
    for (const p of forbidden) {
      const before = await db.piece(p.id);
      const r = await db.invMark(p.id, { mark: 'lost', note: 'no' });
      expect(r.status).toBe(422);
      expect(r.body.error).toMatchObject({ code: 'ITEM_NOT_ADJUSTABLE', details: { status: p.status, ownerType: p.ownerType } });
      expect(await db.piece(p.id)).toEqual(before);
      expect(await db.movements([p.id])).toHaveLength(0);
    }
    // PS-42: `PATCH {status:'in_stock'}` sobre lost/damaged/picking/reserved/in_custody ⇒ 422 y tampoco los otros campos
    for (const p of forbidden) {
      const before = await db.piece(p.id);
      const r = await db.invPatch(p.id, { status: 'in_stock', listPriceCents: 12345 });
      expect(r.status).toBe(422);
      expect(r.body.error.code).toBe('ITEM_NOT_ADJUSTABLE');
      expect(await db.piece(p.id)).toEqual(before);
    }
    const listed = await db.mkPiece({ status: 'listed' });
    const un = await db.invPatch(listed.id, { status: 'in_stock' });
    expect(un.status).toBeLessThan(300);
    expect((await db.piece(listed.id)).status).toBe('in_stock');
    const log = (await db.audits(listed.id, 'inventory.item_updated'))[0];
    expect(log.before).toMatchObject({ status: 'listed' });
    expect(log.after).toMatchObject({ status: 'in_stock' });
    expect(await db.movements([listed.id])).toHaveLength(0);
    // carrera `mark` vs checkout (la reserva: CAS `listed → reserved`), barrera en la fila
    const outcomes: string[] = [];
    let inter = 0;
    for (let i = 0; i < N; i += 1) {
      const p = await db.mkPiece({ status: 'listed' });
      const buyer = await db.mkUser(`PS41 comprador ${i}`);
      const reserve = async (): Promise<R> => {
        const n = await h.prisma.$transaction(async (tx) => (await tx.inventoryItem.updateMany({ where: { id: p.id, ownerType: 'platform', status: 'listed' }, data: { status: 'reserved', ownerType: 'customer', ownerUserId: buyer.id, ownershipStatus: 'pending' } })).count);
        return { status: n === 1 ? 200 : 409, body: { outcome: n === 1 ? 'reserved' : undefined, error: n === 1 ? undefined : { code: 'NOT_AVAILABLE' } } };
      };
      const res = await db.forced(() => db.holdRow('InventoryItem', p.id), () => db.invMark(p.id, { mark: 'lost', note: 'carrera' }), reserve);
      if (res.interleaved) inter += 1;
      const piece = await db.piece(p.id);
      const bad = piece.status === 'lost' && piece.ownerUserId !== null;
      const both = res.a.status < 300 && res.b.status === 200;
      outcomes.push(`${code(res.a)},${code(res.b)},piece=${piece.status}${bad || both ? ',VIOLATION' : ''}`);
    }
    expect(report('PS-41', outcomes, (o) => !o.includes('VIOLATION'))).toBe(N);
    expect(inter).toBe(N);
    // El OTRO orden (PS-41b): la reserva se encola PRIMERO y `mark` decide con una lectura caduca (`listed`) ⇒ su CAS
    // (`status = lo leído`) tiene que dar `count 0` ⇒ 409 CONFLICT, y la pieza queda `reserved` del comprador.
    // Es el orden que muerde la mutación (c): sin `status` en el WHERE, `mark` pisaría la reserva (`lost` con dueño).
    const outcomesB: string[] = [];
    let interB = 0;
    for (let i = 0; i < N; i += 1) {
      const p = await db.mkPiece({ status: 'listed' });
      const buyer = await db.mkUser(`PS41b comprador ${i}`);
      const reserve = async (): Promise<R> => {
        const n = await h.prisma.$transaction(async (tx) => (await tx.inventoryItem.updateMany({ where: { id: p.id, ownerType: 'platform', status: 'listed' }, data: { status: 'reserved', ownerType: 'customer', ownerUserId: buyer.id, ownershipStatus: 'pending' } })).count);
        return { status: n === 1 ? 200 : 409, body: { outcome: n === 1 ? 'reserved' : undefined, error: n === 1 ? undefined : { code: 'NOT_AVAILABLE' } } };
      };
      const res = await db.forced(() => db.holdRow('InventoryItem', p.id), reserve, () => db.invMark(p.id, { mark: 'lost', note: 'carrera b' }));
      if (res.interleaved) interB += 1;
      const piece = await db.piece(p.id);
      const bad = piece.status === 'lost' && piece.ownerUserId !== null;
      const both = res.a.status === 200 && res.b.status < 300;
      const markWon = res.b.status < 300;
      outcomesB.push(`${code(res.a)},${code(res.b)},piece=${piece.status}${bad || both || markWon ? ',VIOLATION' : ''}`);
    }
    expect(report('PS-41b', outcomesB, (o) => !o.includes('VIOLATION'))).toBe(N);
    expect(interB).toBe(N);
    // Mutación: (a) aceptar `picking` en MARKABLE; (b) rama customer en `mark`; (c) quitar `status` del WHERE del CAS ⇒ PS-41b gana en ≥1 tirada.
  });

  it('PS-42b 🔒 — `PATCH {status}` IGUAL al leído no escribe `status`; carrera PATCH `{status:in_stock, listPriceCents}` vs reserva encolada PRIMERO (N≥10) ⇒ 409 CONFLICT, la pieza sigue `reserved` del comprador y su precio INTACTO', async () => {
    // Techlead R3 sobre `c20451f`: `updateItem` solo guardaba el cambio de `status` DISTINTO al leído; con `status` igual
    // caía en el `update` plano y re-escribía `status` ⇒ una reserva tomada entre la lectura y la escritura se perdía.
    // ⭐ v1.80.7.2 (`#M1-merge-rule`, D-d del techlead) — ESTA PRUEBA SE INVIERTE en su aserto de carrera: antes exigía
    // `res.b < 300` y `listPriceCents === 1000 + i` sobre una pieza ya `reserved` DEL COMPRADOR — certificaba justo lo
    // que INV-SP-8 prohíbe (precio de venta escrito en una pieza que no es de plataforma en venta). En el árbol fusionado
    // el PATCH pasa por `readGuardedItem` → `assertOperable(item,'status')` → `guardedItemUpdate` (CAS sobre
    // `{id, status, ownerType, ownerUserId}` leídos): la reserva gana ⇒ `count 0`/`P2025` ⇒ `409 CONFLICT`, nada escrito.
    // Primera mitad RE-ANCLADA a conducta (el espía sobre `h.prisma.inventoryItem.update` no ve las escrituras del
    // cliente de la tx, NO MEDIDO que las vea): `{status:'in_stock', listPriceCents}` sobre `in_stock` ⇒ 200, precio
    // escrito, `status` sigue `in_stock` y SIN bitácora de cambio de estado. Que `data` no lleve `status` lo fija la
    // unitaria gemela (`inventory.patch-status-guard.spec.ts`, «in_stock → in_stock NO escribe `status`»).
    const same = await db.mkPiece({ status: 'in_stock' });
    const r = await db.invPatch(same.id, { status: 'in_stock', listPriceCents: 4321 });
    expect(r.status).toBeLessThan(300);
    expect(await db.piece(same.id)).toMatchObject({ status: 'in_stock', listPriceCents: 4321 });
    expect(await db.audits(same.id, 'inventory.item_updated')).toHaveLength(0);
    // el cambio real sigue pasando por la guarda y la escritura condicionada (PS-42), con su bitácora
    const listed = await db.mkPiece({ status: 'listed' });
    expect((await db.invPatch(listed.id, { status: 'in_stock' })).status).toBeLessThan(300);
    expect((await db.piece(listed.id)).status).toBe('in_stock');
    // carrera: la reserva (CAS `in_stock → reserved`) se encola PRIMERO en la fila; el PATCH decide con la lectura caduca
    // `in_stock` y NO debe pisarla ni escribirle precio. Mutación (contrato): quitar `status`/`ownerType` del `where` de
    // `guardedItemUpdate` ⇒ precio escrito sobre la reservada en ≥1 tirada ⇒ rojo.
    const outcomes: string[] = [];
    let inter = 0;
    for (let i = 0; i < N; i += 1) {
      const p = await db.mkPiece({ status: 'in_stock' });
      const seeded = (await db.piece(p.id)).listPriceCents;
      const buyer = await db.mkUser(`PS42b comprador ${i}`);
      const reserve = async (): Promise<R> => {
        const n = await h.prisma.$transaction(async (tx) => (await tx.inventoryItem.updateMany({ where: { id: p.id, ownerType: 'platform', status: 'in_stock' }, data: { status: 'reserved', ownerType: 'customer', ownerUserId: buyer.id, ownershipStatus: 'pending' } })).count);
        return { status: n === 1 ? 200 : 409, body: { outcome: n === 1 ? 'reserved' : undefined, error: n === 1 ? undefined : { code: 'NOT_AVAILABLE' } } };
      };
      const res = await db.forced(() => db.holdRow('InventoryItem', p.id), reserve, () => db.invPatch(p.id, { status: 'in_stock', listPriceCents: 1000 + i }));
      if (res.interleaved) inter += 1;
      const piece = await db.piece(p.id);
      const ok =
        res.a.status === 200 &&
        res.b.status === 409 &&
        res.b.body?.error?.code === 'CONFLICT' &&
        piece.status === 'reserved' &&
        piece.ownerType === 'customer' &&
        piece.ownerUserId === buyer.id &&
        piece.listPriceCents === seeded;
      outcomes.push(`${code(res.a)},${code(res.b)},piece=${piece.status}/${piece.ownerType},price=${piece.listPriceCents}${ok ? '' : ',VIOLATION'}`);
    }
    expect(report('PS-42b', outcomes, (o) => !o.includes('VIOLATION'))).toBe(N);
    expect(inter).toBe(N);
  });

  // ================================================================ PS-65 — la carta de una compra en devolución

  it('PS-65 💰🔒 — orden con fila `order_full` viva ⇒ `POST /shipments` 422 ITEM_ORIGIN_REFUNDED, `quote` origin_refunded, `withdrawable:false`; `failed` ⇒ elegible; retiro ya creado ⇒ `prepared` 409 {pendingFullRefund:true}; orden `refunded` sin cierre ⇒ 409 en los cuatro verbos; mixto nombra solo la afectada; carrera prepared vs M3 (N≥10)', async () => {
    const a = await placedVault('PS65');
    const tok = await db.loginCustomer(a.u.email);
    const addr = await db.mkAddress(a.u.id);
    const row = await h.prisma.paymentRefund.create({
      data: { idempotencyKey: `order-full:${a.vo.order.id}`, kind: 'order_full', orderId: a.vo.order.id, amountCents: a.vo.order.totalCents, merchandiseCents: 80000, merchandiseIvaCents: 80000 - Math.floor(80000 / 1.16), shippingCents: 0, shippingIvaCents: 0, processingFeeCents: 4617, status: 'requested', requestedByUserId: db.adminId, requestedByRole: 'super_admin', reason: 'fixture PS-65' },
    });
    const sh = await db.createShipment(tok, { inventoryItemIds: [a.vo.pieces[0].id], addressId: addr.id });
    expect(sh.status).toBe(422);
    expect(sh.body.error.code).toBe('ITEM_ORIGIN_REFUNDED');
    const q = await db.quoteShipment(tok, { inventoryItemIds: [a.vo.pieces[0].id], addressId: addr.id });
    expect(q.body.ineligible).toEqual(expect.arrayContaining([expect.objectContaining({ inventoryItemId: a.vo.pieces[0].id, reason: 'origin_refunded' })]));
    // ⭐ v1.80.7 (punto 13): el MOTIVO viaja con el flag (`withdrawableReason:'origin_refunded'`); con la fila `failed` ⇒ `{true, null}`.
    const holding = async () => (await db.holdings(tok)).body.data.find((x: any) => x.inventoryItemId === a.vo.pieces[0].id);
    expect(await holding()).toMatchObject({ withdrawable: false, withdrawableReason: 'origin_refunded' });
    await h.prisma.paymentRefund.update({ where: { id: row.id }, data: { status: 'failed', failedAt: new Date(), failureCode: 'x' } });
    expect(await holding()).toMatchObject({ withdrawable: true, withdrawableReason: null });
    // el invariante en TODAS las filas de la bóveda: `withdrawable === (withdrawableReason === null)`
    for (const x of (await db.holdings(tok)).body.data) expect(x.withdrawable).toBe(x.withdrawableReason === null);
    const ok = await db.createShipment(tok, { inventoryItemIds: [a.vo.pieces[0].id], addressId: addr.id });
    expect(ok.status).toBe(201);
    // retiro ya creado (picking, picked) ⇒ fila viva ⇒ `prepared` 409 {pendingFullRefund:true}, sin sello
    const b = await placedVault('PS65b');
    const b2 = await db.mkVaultOrder(b.u.id, { prices: [20000], placement: 'placed', locationId: b.drawer.id });
    const wb = await db.mkWithdrawal(b.u.id, [b.vo.pieces[0].id, b2.pieces[0].id], 'picking');
    for (const l of wb.lines) await db.mark(wb.shipment.id, l.id, { status: 'picked' });
    const rowb = await h.prisma.paymentRefund.create({
      data: { idempotencyKey: `order-full:${b.vo.order.id}`, kind: 'order_full', orderId: b.vo.order.id, amountCents: b.vo.order.totalCents, merchandiseCents: 80000, merchandiseIvaCents: 80000 - Math.floor(80000 / 1.16), shippingCents: 0, shippingIvaCents: 0, processingFeeCents: 4617, status: 'requested', requestedByUserId: db.adminId, requestedByRole: 'super_admin', reason: 'fixture PS-65b' },
    });
    const pr = await db.prepare(wb.shipment.id, 0);
    expect(pr.status).toBe(409);
    expect(pr.body.error).toMatchObject({ code: 'WITHDRAWAL_LINE_ORIGIN_REFUNDED', details: { items: [expect.objectContaining({ inventoryItemId: b.vo.pieces[0].id, pendingFullRefund: true })] } });
    expect(pr.body.error.details.items).toHaveLength(1); // mixto: solo la afectada
    expect((await db.shipment(wb.shipment.id)).preparedAt).toBeNull();
    // orden `refunded` por fixture SIN cierre ⇒ los cuatro verbos 409 (pendingFullRefund:false, orderStatus refunded)
    await h.prisma.paymentRefund.update({ where: { id: rowb.id }, data: { status: 'failed', failedAt: new Date(), failureCode: 'x' } });
    await h.prisma.order.update({ where: { id: b.vo.order.id }, data: { status: 'refunded' } });
    const toGuia = () => h.prisma.shipmentRequest.update({ where: { id: wb.shipment.id }, data: { status: 'guia', preparedAt: new Date(), preparedByUserId: db.operatorId, carrier: 'DHL', trackingNumber: 'X' } });
    for (const [, verb] of [['prepare', () => db.prepare(wb.shipment.id, 0)], ['tracking', () => db.tracking(wb.shipment.id)], ['guia', () => db.status(wb.shipment.id, 'guia')], ['enviado', async () => { await toGuia(); return db.status(wb.shipment.id, 'enviado'); }]] as const) {
      const r = await verb();
      expect(r.status).toBe(409);
      expect(r.body.error).toMatchObject({ code: 'WITHDRAWAL_LINE_ORIGIN_REFUNDED', details: { items: [expect.objectContaining({ inventoryItemId: b.vo.pieces[0].id, pendingFullRefund: false, orderStatus: 'refunded' })] } });
    }
    // `entregado` desde `enviado` NO se guarda
    await h.prisma.shipmentRequest.update({ where: { id: wb.shipment.id }, data: { status: 'enviado', shippedAt: new Date() } });
    expect((await db.status(wb.shipment.id, 'entregado')).status).toBe(200);
    // carrera `prepared` vs M3 tx1 (barrera en la fila `Order` de origen)
    const outcomes: string[] = [];
    let inter = 0;
    for (let i = 0; i < N; i += 1) {
      const t = await placedVault(`PS65r ${i}`);
      const wt = await db.mkWithdrawal(t.u.id, [t.vo.pieces[0].id], 'picking');
      await db.mark(wt.shipment.id, wt.lines[0].id, { status: 'picked' });
      const res = await db.forced(() => db.holdRow('Order', t.vo.order.id), () => db.prepare(wt.shipment.id, 0), () => m3(t.vo.order.id));
      if (res.interleaved) inter += 1;
      const s = await db.shipment(wt.shipment.id);
      const live = (await db.refunds({ orderId: t.vo.order.id, kind: 'order_full', status: { not: 'failed' } })).length;
      const bad = s.preparedAt !== null && live > 0 && s.status === 'picking';
      const okRun = (res.a.status === 409 && ['WITHDRAWAL_LINE_ORIGIN_REFUNDED'].includes(res.a.body.error.code)) || (res.b.status === 409 && res.b.body.error.code === 'VAULT_PIECE_IN_PACKED_WITHDRAWAL');
      outcomes.push(`${code(res.a)},${code(res.b)},prepared=${s.preparedAt !== null},live=${live}${bad || !okRun ? ',VIOLATION' : ''}`);
    }
    expect(report('PS-65', outcomes, (o) => !o.includes('VIOLATION'))).toBe(N);
    expect(inter).toBe(N);
    // Mutación: (a) quitar la guarda de setTracking/updateStatus ⇒ guía 200; (b) mirar solo `status ≠ settled`; (c) quitar la condición de `classifyItems`.
  });

  // ================================================================ PS-49 / PS-40 — la vista del operador y M7

  it('PS-49 🔒 — `operator-summary` con sumas y `capUsedCents` = `usedCents` del tope; `/finance/shrinkage?actorUserId` cuenta la original UNA vez; operador ⇒ 403 en los tres; `workQueue.operatorRefunds`', async () => {
    // una fila de operador (directo con una faltante)
    const d = await db.mkDirect();
    await db.mark(d.shipment.id, d.lines.find((l) => l.inventoryItemId === d.pieces[1].id)!.id, { status: 'missing', missingReason: 'not_found' });
    await db.mark(d.shipment.id, d.lines.find((l) => l.inventoryItemId === d.pieces[0].id)!.id, { status: 'picked' });
    expect((await db.prepare(d.shipment.id, 31458)).status).toBe(200);
    const s = await db.operatorSummary();
    expect(s.status).toBe(200);
    const me = s.body.operators.find((o: any) => o.user.userId === db.operatorId);
    expect(me.refunds.last24h.count).toBeGreaterThanOrEqual(1);
    expect(me.refunds.last24h.cents).toBeGreaterThanOrEqual(31458);
    expect(me.capUsedCents).toBe(me.refunds.last24h.cents);
    expect(me.prepared30d.lines).toBeGreaterThanOrEqual(2);
    expect(me.prepared30d.missingRatePct).not.toBeNull();
    // merma: el nacimiento de un caso cuenta una vez; su traspaso `replacement` no vuelve a contar
    const w = await placedVault('PS49');
    const wd = await db.mkWithdrawal(w.u.id, [w.vo.pieces[0].id], 'picking');
    await db.mark(wd.shipment.id, wd.lines[0].id, { status: 'missing', missingReason: 'not_found' });
    const before = (await db.shrinkage(`?actorUserId=${db.operatorId}`)).body.totals.pieces;
    expect((await db.prepare(wd.shipment.id, 0)).status).toBe(200);
    expect((await db.shrinkage(`?actorUserId=${db.operatorId}`)).body.totals.pieces - before).toBe(1);
    const kase = await h.prisma.replacementCase.findFirstOrThrow({ where: { shipmentRequestId: wd.shipment.id } });
    const cand = await db.mkPiece({ status: 'in_stock' });
    expect((await db.caseReplace(kase.id, { inventoryItemId: cand.id })).status).toBe(200);
    expect((await db.shrinkage(`?actorUserId=${db.operatorId}`)).body.totals.pieces - before).toBe(1);
    expect(me.selfReplaced30d).toBeGreaterThanOrEqual(0);
    for (const r of [await db.operatorSummary(db.opToken), await db.shrinkage('', db.opToken), await db.adminRefunds('', db.opToken)]) expect(r.status).toBe(403);
    const dash = await db.dashboard();
    expect(dash.body.workQueue.operatorRefunds.last24hCents).toBeGreaterThanOrEqual(31458);
    expect(dash.body.workQueue.toPrepare).toMatchObject({ ship: expect.any(Number), vault: expect.any(Number), toReplace: expect.any(Number), toReplaceOverdue: expect.any(Number) });
    expect(dash.body.workQueue.manualRefunds).toMatchObject({ pending: expect.any(Number), pendingCents: expect.any(Number) });
    const dop = await db.dashboard(db.opToken);
    expect(dop.body.workQueue.operatorRefunds).toBeNull();
    expect(dop.body.workQueue.manualRefunds).toBeNull();
    // Mutación: contar `toStatus ∈ {lost,damaged}` sin excluir `fromStatus` ⇒ doble conteo.
  });

  it('PS-40 💰 — M7: una SPEI `pending` no resta; `paid` resta en el periodo de `paidAt` y muestra la compensación; `cancelled` nunca; la fila Stripe fallida y su sustituta no restan dos veces', async () => {
    const u = await db.mkUser('PS40');
    await db.mkKyc(u.id, '012345678901234567');
    const vo = await db.mkVaultOrder(u.id, { placement: 'pending' });
    const items = await h.prisma.vaultPlacementItem.findMany({ where: { placementId: vo.placement!.id } });
    await db.vpMark(vo.placement!.id, items.find((i) => i.inventoryItemId === vo.pieces[0].id)!.id, { status: 'missing', missingReason: 'not_found' });
    await db.vpMark(vo.placement!.id, items.find((i) => i.inventoryItemId === vo.pieces[1].id)!.id, { status: 'missing', missingReason: 'not_found' });
    await db.vpPrepare(vo.placement!.id);
    const conf = await db.vpConfirm(vo.placement!.id, {});
    const caseId = conf.body.items.find((i: any) => i.inventoryItemId === vo.pieces[0].id).caseId;
    // remanente 0 ⇒ todo a SPEI (con compensación por encima de Q)
    await h.prisma.paymentRefund.create({
      data: { idempotencyKey: `full:fix40:${vo.order.id}`, kind: 'order_full', orderId: vo.order.id, amountCents: vo.order.totalCents, merchandiseCents: 80000, merchandiseIvaCents: 80000 - Math.floor(80000 / 1.16), shippingCents: 0, shippingIvaCents: 0, processingFeeCents: 4617, status: 'succeeded', stripeRefundId: `re_fix40_${vo.order.id}`, requestedByUserId: db.adminId, requestedByRole: 'super_admin', submittedAt: new Date('2020-01-01'), succeededAt: new Date('2020-01-01') },
    });
    const Q = 50000 + Math.floor((4617 * 50000) / 80000);
    const A = Q + 10000;
    const pv = await db.casePreview(caseId, A);
    expect((await db.caseRefund(caseId, { amountCents: A, reason: 'mercado', expectedStripeCents: pv.body.stripeCents, expectedManualCents: pv.body.manualCents })).status).toBe(200);
    const mr = (await db.manualRows({ replacementCaseId: caseId }))[0];
    const from = '2026-09-01';
    const to = '2026-12-31';
    const p0 = (await db.pnl(`?from=${from}&to=${to}`)).body;
    const tk = (await db.mrReveal(mr.id)).body.revealToken;
    expect((await db.mrPaid(mr.id, { revealToken: tk, speiReference: 'M7' })).status).toBe(200);
    const p1 = (await db.pnl(`?from=${from}&to=${to}`)).body;
    expect(p1.refundsCents - p0.refundsCents).toBe(mr.merchandiseCents - mr.merchandiseIvaCents);
    expect(p1.refundedFeesCents - p0.refundedFeesCents).toBe(mr.processingFeeCents);
    expect(p1.compensationsCents - p0.compensationsCents).toBe(10000);
    expect(p0.profitCents - p1.profitCents).toBe(mr.merchandiseCents - mr.merchandiseIvaCents + mr.processingFeeCents + 10000);
    // fuera del periodo de `paidAt` no resta
    const pOld = (await db.pnl('?from=2020-01-01&to=2020-12-31')).body;
    expect(pOld.compensationsCents).toBe(0);
    // cancelada nunca resta: otra SPEI cancelada
    const other = await db.mkVaultOrder(u.id, { placement: 'pending' });
    const items2 = await h.prisma.vaultPlacementItem.findMany({ where: { placementId: other.placement!.id } });
    for (const it of items2) await db.vpMark(other.placement!.id, it.id, { status: 'missing', missingReason: 'not_found' });
    await db.vpPrepare(other.placement!.id);
    const conf2 = await db.vpConfirm(other.placement!.id, {});
    const case2 = conf2.body.items[0].caseId;
    await h.prisma.paymentRefund.create({
      data: { idempotencyKey: `full:fix40b:${other.order.id}`, kind: 'order_full', orderId: other.order.id, amountCents: other.order.totalCents, merchandiseCents: 80000, merchandiseIvaCents: 80000 - Math.floor(80000 / 1.16), shippingCents: 0, shippingIvaCents: 0, processingFeeCents: 4617, status: 'succeeded', stripeRefundId: `re_fix40b_${other.order.id}`, requestedByUserId: db.adminId, requestedByRole: 'super_admin', submittedAt: new Date('2020-01-01'), succeededAt: new Date('2020-01-01') },
    });
    const pv2 = await db.casePreview(case2, Q);
    expect((await db.caseRefund(case2, { amountCents: Q, reason: 'mercado', expectedStripeCents: pv2.body.stripeCents, expectedManualCents: pv2.body.manualCents })).status).toBe(200);
    const mr2 = (await db.manualRows({ replacementCaseId: case2 }))[0];
    expect((await db.mrCancel(mr2.id, { note: 'cancelada para M7' })).status).toBe(200);
    const p2 = (await db.pnl(`?from=${from}&to=${to}`)).body;
    expect(p2.refundsCents).toBe(p1.refundsCents);
    // Stripe fallida + su sustituta SPEI ⇒ no restan dos veces (la fallida no cuenta; la SPEI solo al pagar)
    const s3 = await placedVault('PS40c');
    const w3 = await db.mkWithdrawal(s3.u.id, [s3.vo.pieces[0].id], 'picking');
    await db.mark(w3.shipment.id, w3.lines[0].id, { status: 'missing', missingReason: 'not_found' });
    await db.prepare(w3.shipment.id, 0);
    const c3 = await h.prisma.replacementCase.findFirstOrThrow({ where: { shipmentRequestId: w3.shipment.id } });
    await db.mkKyc(s3.u.id, '012345678901234567');
    h.stripe.refundOutcome = 'definitive';
    const pv3 = await db.casePreview(c3.id, 10000);
    expect((await db.caseRefund(c3.id, { amountCents: 10000, reason: 'Stripe la rechaza', expectedStripeCents: pv3.body.stripeCents, expectedManualCents: pv3.body.manualCents })).status).toBe(200);
    h.stripe.refundOutcome = 'ok';
    const failed = (await db.refunds({ replacementCaseId: c3.id }))[0];
    await h.prisma.paymentRefund.update({ where: { id: failed.id }, data: { failureCode: 'insufficient_funds' } });
    const p3 = (await db.pnl(`?from=${from}&to=${to}`)).body;
    expect(p3.refundsCents).toBe(p2.refundsCents);
    const tm = await db.toManual(failed.id);
    expect(tm.status).toBe(200);
    const p4 = (await db.pnl(`?from=${from}&to=${to}`)).body;
    expect(p4.refundsCents).toBe(p2.refundsCents);
    const tk3 = (await db.mrReveal(tm.body.id)).body.revealToken;
    expect((await db.mrPaid(tm.body.id, { revealToken: tk3 })).status).toBe(200);
    const p5 = (await db.pnl(`?from=${from}&to=${to}`)).body;
    expect(p5.refundsCents - p4.refundsCents).toBe(failed.merchandiseCents - failed.merchandiseIvaCents);
    // Mutación: contar `pending`; contar por `createdAt`.
  });
});
