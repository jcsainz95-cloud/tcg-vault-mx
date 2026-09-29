/**
 * shipments-prep.e2e-spec.ts — §M4-SHIP «Pedidos por preparar», cubeta ENVÍO, contra Postgres REAL (app Nest
 * completa por HTTP, doble de Stripe CON ESTADO). Propiedad: backend.
 *
 * Cubre PS-1…PS-7, PS-9 (directo), PS-10…PS-17, PS-43…PS-45, PS-50, PS-51 de API_CONTRACT §M4-SHIP.12/.17.9.
 * Carreras: entrelazado FORZADO por barrera de fila (prueba 40), N ≥ 10, y se reporta la proporción con su N
 * (`[PS-RACE …] k/N`); una tirada sin entrelazado observado NO cuenta. Mutaciones (cada PS nombra la suya) se
 * demuestran sobre COPIA del árbol entero, ⛔ nunca aquí.
 */
import { MAIL_PORT, MailMessage, MailPort } from '../../src/modules/mail/mail.port';
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { OWNER_EXAMPLE, R, ShipPrepDb } from './helpers/ship-prep-db';
import { SettingKey } from '../../src/modules/settings/settings.constants';
import { RefundLedgerService } from '../../src/modules/payments/refunds/refund-ledger.service';
import { E2E_USERS } from '../../prisma/e2e-fixtures';

const RUN = Date.now().toString(36);
const N = 10;

describe('§M4-SHIP — cubeta ENVÍO: palomear, preparar, reembolsar la carta que falta', () => {
  let h: E2EHarness;
  let db: ShipPrepDb;
  let bandeja: MailMessage[] = [];
  let spy: jest.SpyInstance;

  const av12 = () => bandeja.filter((m) => /Reembolso de (?!tu pedido)/.test(m.subject));
  const av3 = () => bandeja.filter((m) => /Reembolso de tu pedido/.test(m.subject));
  const av6 = () => bandeja.filter((m) => /quedó cancelado/.test(m.subject));
  const code = (r: R) => (r.status === 200 ? `200:${r.body.outcome ?? 'ok'}` : `${r.status}:${r.body?.error?.code}`);
  const report = (id: string, outcomes: string[], ok: (o: string) => boolean) => {
    const k = outcomes.filter(ok).length;
    // eslint-disable-next-line no-console
    console.log(`[PS-RACE ${id}] ${k}/${outcomes.length} · N=${outcomes.length} · ${outcomes.join(' | ')}`);
    return k;
  };

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
  });

  afterAll(async () => {
    spy?.mockRestore();
    await setCap(500000); // el seed D-3
    await db.cleanup();
    await h?.close();
  });

  const setCap = (v: number) =>
    h.prisma.configSetting.upsert({
      where: { key: SettingKey.OPERATOR_REFUND_CAP_24H_CENTS },
      create: { key: SettingKey.OPERATOR_REFUND_CAP_24H_CENTS, valueJson: v },
      update: { valueJson: v },
    });
  const HUGE_CAP = 1_000_000_000;

  beforeEach(async () => {
    bandeja = [];
    h.stripe.refundOutcome = 'ok';
    h.stripe.refundDelayMs = 0;
    // El operador de la suite acumula reembolsos a lo largo de las pruebas: el tope solo se mide en PS-4.
    await setCap(HUGE_CAP);
  });

  // ================================================================ PS-2 / PS-3 / PS-14 — el importe exacto y el cierre

  it('PS-2 💰 — falta la de MX$300 ⇒ 31458 exacto, pieza `lost` con el operador como autor, el envío sigue', async () => {
    const d = await db.mkDirect();
    const line300 = d.lines.find((l) => l.inventoryItemId === d.pieces[1].id)!;
    const queue0 = await db.queue();
    const row0 = queue0.body.data.find((r: any) => r.shipmentId === d.shipment.id);
    expect(row0.kind).toBe('guest_direct_ship');
    expect(row0.preparation).toMatchObject({ status: 'in_progress', pending: 2, refundPreviewCents: 0 });
    const it300 = row0.items.find((i: any) => i.shipmentItemId === line300.id);
    expect(it300.refund).toEqual({ kind: 'refundable', amountCents: 31458 });

    // marcar faltante SIN motivo ⇒ 400; con motivo ⇒ 200 y el preview del servidor sube a 31458.
    const bad = await db.mark(d.shipment.id, line300.id, { status: 'missing' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.field).toBe('missingReason');
    const m = await db.mark(d.shipment.id, line300.id, { status: 'missing', missingReason: 'not_found' });
    expect(m.status).toBe(200);
    expect(m.body.changed).toBe(true);
    expect(m.body.preparation.refundPreviewCents).toBe(31458);
    expect(m.body.item.prepStatus).toBe('missing');
    // ⛔ cero dinero y cero inventario al marcar.
    expect(await db.refunds({ shipmentItemId: line300.id })).toHaveLength(0);
    expect((await db.piece(d.pieces[1].id)).status).toBe('picking');
    // palomear la otra
    const p1 = await db.mark(d.shipment.id, d.lines.find((l) => l.inventoryItemId === d.pieces[0].id)!.id, { status: 'picked' });
    expect(p1.status).toBe(200);

    // PS-5: importe distinto ⇒ 409 REFUND_PREVIEW_STALE con el vigente, cero escrituras.
    const stale = await db.prepare(d.shipment.id, 30000);
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('REFUND_PREVIEW_STALE');
    expect(stale.body.error.details.refundCents).toBe(31458);
    expect(await db.refunds({ orderId: d.order.id })).toHaveLength(0);

    const before = h.stripe.refundCreateCalls.length;
    const res = await db.prepare(d.shipment.id, 31458);
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('prepared');
    expect(res.body.refunds).toHaveLength(1);
    expect(res.body.refunds[0]).toMatchObject({ kind: 'item_missing', status: 'submitted', amountCents: 31458, missingReason: 'not_found' });
    expect(res.body.preparation.status).toBe('prepared');
    expect(h.stripe.refundCreateCalls.length - before).toBe(1);
    const call = h.stripe.refundCreateCalls[h.stripe.refundCreateCalls.length - 1];
    expect(call).toMatchObject({ paymentIntentId: d.pi, amountCents: 31458, idempotencyKey: `item:${line300.id}` });
    const rows = await db.refunds({ orderId: d.order.id });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ merchandiseCents: 30000, merchandiseIvaCents: 4138, shippingCents: 0, processingFeeCents: 1458, requestedByUserId: db.operatorId, requestedByRole: 'vault_operator' });
    const piece = await db.piece(d.pieces[1].id);
    expect(piece.status).toBe('lost');
    expect(piece.ownerType).toBe('platform');
    const mov = (await db.movements([d.pieces[1].id])).find((x) => x.toStatus === 'lost')!;
    expect(mov.actorUserId).toBe(db.operatorId);
    expect(mov.reason).toBe('lost');
    // envío sigue picking, preparado; un AV-12, cero AV-6/AV-3
    const sh = await db.shipment(d.shipment.id);
    expect(sh.status).toBe('picking');
    expect(sh.preparedByUserId).toBe(db.operatorId);
    expect(av12()).toHaveLength(1);
    expect(av12()[0].to).toBe(d.order.guestEmail);
    expect(av12()[0].text).toContain('314.58');
    expect(av6()).toHaveLength(0);
    expect(av3()).toHaveLength(0);
    // bitácora
    expect(await db.audits(d.shipment.id, 'shipment.prepared')).toHaveLength(1);
    expect(await db.audits(d.order.id, 'payment_refund.requested')).toHaveLength(1);

    // PS-14: la línea reembolsada queda FIJA; deshacer preparado conserva marcas; re-preparar no reembolsa otra vez.
    const closed = await db.mark(d.shipment.id, line300.id, { status: 'picked' });
    expect(closed.status).toBe(409);
    expect(closed.body.error.code).toBe('PREPARATION_CLOSED');
    const un = await db.unprepare(d.shipment.id);
    expect(un.status).toBe(200);
    expect(un.body.outcome).toBe('unprepared');
    expect(un.body.preparation).toMatchObject({ status: 'in_progress', missing: 1, picked: 1, refundPreviewCents: 0 });
    const again = await db.mark(d.shipment.id, line300.id, { status: 'picked' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('PREP_ITEM_REFUNDED');
    expect(again.body.error.details.refundId).toBe(rows[0].id);
    const re = await db.prepare(d.shipment.id, 0);
    expect(re.status).toBe(200);
    expect(re.body.outcome).toBe('prepared');
    expect(await db.refunds({ orderId: d.order.id })).toHaveLength(1);
    expect(h.stripe.refundCreateCalls.length - before).toBe(1);
    // ya preparado ⇒ 200 idempotente
    const idem = await db.prepare(d.shipment.id, 0);
    expect(idem.status).toBe(200);
    expect(idem.body.outcome).toBe('already_prepared');

    // PS-9 (directo): `enviado` ⇒ la faltante sigue `lost`, la otra `shipped`.
    const tr = await db.tracking(d.shipment.id);
    expect(tr.status).toBe(201);
    const env = await db.status(d.shipment.id, 'enviado');
    expect(env.status).toBe(200);
    expect((await db.piece(d.pieces[1].id)).status).toBe('lost');
    expect((await db.piece(d.pieces[0].id)).status).toBe('shipped');
  });

  it('PS-3 💰 — faltan TODAS: Σ = totalCents ±0, Σ IVA = ivaCents, envío `cancelado` sin AV-6, un AV-12, orden `refunded` tras el webhook sin AV-3', async () => {
    const d = await db.mkDirect();
    for (const [i, l] of d.lines.entries()) {
      const r = await db.mark(d.shipment.id, l.id, { status: 'missing', missingReason: i === 0 ? 'not_found' : 'damaged' });
      expect(r.status).toBe(200);
    }
    const q = await db.queue();
    const row = q.body.data.find((r: any) => r.shipmentId === d.shipment.id);
    expect(row.preparation.refundPreviewCents).toBe(OWNER_EXAMPLE.totalCents);
    const res = await db.prepare(d.shipment.id, OWNER_EXAMPLE.totalCents);
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('closed_nothing_to_ship');
    const rows = await db.refunds({ orderId: d.order.id });
    expect(rows.map((r) => r.kind).sort()).toEqual(['item_missing', 'item_missing', 'order_remaining']);
    expect(rows.reduce((a, r) => a + r.amountCents, 0)).toBe(OWNER_EXAMPLE.totalCents);
    expect(rows.reduce((a, r) => a + r.merchandiseIvaCents + r.shippingIvaCents, 0)).toBe(OWNER_EXAMPLE.ivaCents);
    const closeRow = rows.find((r) => r.kind === 'order_remaining')!;
    expect(closeRow).toMatchObject({ amountCents: 15729, shippingCents: 15000, processingFeeCents: 729, merchandiseCents: 0 });
    expect(rows.find((r) => r.missingReason === 'damaged')!.amountCents).toBe(31458);
    expect((await db.shipment(d.shipment.id)).status).toBe('cancelado');
    expect((await db.piece(d.pieces[1].id)).status).toBe('damaged');
    expect(av6()).toHaveLength(0);
    expect(av12()).toHaveLength(1);
    expect(av12()[0].text).toContain('996.17');
    // el webhook `charge.refunded` total llega ⇒ orden `refunded`, ⛔ sin AV-3 (las filas son de carta faltante).
    const wh = await db.chargeRefunded(d.pi, OWNER_EXAMPLE.totalCents);
    expect(wh.status).toBe(200);
    expect((await db.order(d.order.id)).status).toBe('refunded');
    expect(av3()).toHaveLength(0);
    // `charge.refund.updated` concilia la fila a `succeeded`.
    const up = await db.refundUpdated({ id: closeRow.stripeRefundId as string, status: 'succeeded', metadata: { paymentRefundId: closeRow.id } });
    expect(up.status).toBe(200);
    expect((await h.prisma.paymentRefund.findUniqueOrThrow({ where: { id: closeRow.id } })).status).toBe('succeeded');
  });

  // ================================================================ PS-1 — dos `prepared` concurrentes

  it(`PS-1 💰 — dos \`prepared\` concurrentes con 1 faltante (barrera en la fila del envío, N=${N}): una fila, UNA llamada a Stripe, un AV-12, un sello; el perdedor 200 already_prepared`, async () => {
    const outcomes: string[] = [];
    let interleavedRuns = 0;
    for (let t = 0; t < N; t += 1) {
      const d = await db.mkDirect();
      await db.mark(d.shipment.id, d.lines[0].id, { status: 'picked' });
      await db.mark(d.shipment.id, d.lines[1].id, { status: 'missing', missingReason: 'not_found' });
      bandeja = [];
      const before = h.stripe.refundCreateCalls.length;
      const { a, b, interleaved } = await db.forced(
        () => db.holdRow('ShipmentRequest', d.shipment.id),
        () => db.prepare(d.shipment.id, 31458),
        () => db.prepare(d.shipment.id, 31458),
      );
      if (interleaved) interleavedRuns += 1;
      const rows = await db.refunds({ orderId: d.order.id });
      const sh = await db.shipment(d.shipment.id);
      const ok =
        [a, b].filter((r) => r.status === 200 && r.body.outcome === 'prepared').length === 1 &&
        [a, b].filter((r) => r.status === 200 && r.body.outcome === 'already_prepared').length === 1 &&
        rows.length === 1 &&
        h.stripe.refundCreateCalls.length - before === 1 &&
        av12().length === 1 &&
        sh.preparedAt !== null;
      outcomes.push(`${ok ? 'OK' : 'BAD'}(${code(a)},${code(b)},rows=${rows.length},create=${h.stripe.refundCreateCalls.length - before},av12=${av12().length})`);
    }
    const k = report('PS-1', outcomes, (o) => o.startsWith('OK'));
    // eslint-disable-next-line no-console
    console.log(`[PS-1] entrelazado observado en ${interleavedRuns}/${N}`);
    expect(interleavedRuns).toBeGreaterThanOrEqual(1);
    expect(k).toBe(N);
  });

  // ================================================================ PS-4 — el tope del operador

  it(`PS-4 💰 — tope: operador a 1 centavo del tope ⇒ 403, cero escrituras, bitácora; súper-admin sin tope; carrera del mismo operador (N=${N}) ⇒ nunca los dos`, async () => {
    // El MISMO predicado que `operatorUsedCents` (§M4-SHIP.8), ventana de 24 h incluida: sin ella, una fila vieja del
    // operador (otra corrida sobre la misma BD) haría que `used0` no fuera lo que el tope ve y `usedCents` no cuadrara.
    const usedNow = async () =>
      (await h.prisma.paymentRefund.aggregate({ where: { requestedByUserId: db.operatorId, status: { not: 'failed' }, kind: { not: 'order_full' }, createdAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) } }, _sum: { amountCents: true } }))._sum.amountCents ?? 0;
    try {
      // cap = usado + 31457 deja al operador a 1 centavo (el MISMO predicado que el tope, §M4-SHIP.5 paso 6).
      const used0 = await usedNow();
      await setCap(used0 + 31457);
      const d = await db.mkDirect();
      await db.mark(d.shipment.id, d.lines[0].id, { status: 'picked' });
      await db.mark(d.shipment.id, d.lines[1].id, { status: 'missing', missingReason: 'not_found' });
      const r = await db.prepare(d.shipment.id, 31458);
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe('MONEY_OUT_LIMIT_EXCEEDED');
      expect(r.body.error.details).toEqual({ capCents: used0 + 31457, usedCents: used0, requestedCents: 31458 });
      expect(await db.refunds({ orderId: d.order.id })).toHaveLength(0);
      expect((await db.piece(d.pieces[1].id)).status).toBe('picking');
      expect((await db.shipment(d.shipment.id)).preparedAt).toBeNull();
      expect(await db.audits(d.shipment.id, 'money_out.limit_blocked')).toHaveLength(1);
      // el súper-admin no tiene tope
      const ok = await db.prepare(d.shipment.id, 31458, db.adminToken);
      expect(ok.status).toBe(200);
      expect(ok.body.outcome).toBe('prepared');

      // carrera: cap = 40000 (sin uso previo de este operador, el fixture usa un operador nuevo por tirada no es
      // posible con la sesión fija ⇒ se recalcula usado + 2×31458 > cap con cap = usado + 40000).
      const outcomes: string[] = [];
      for (let t = 0; t < N; t += 1) {
        await setCap((await usedNow()) + 40000);
        const d1 = await db.mkDirect();
        const d2 = await db.mkDirect();
        for (const x of [d1, d2]) {
          await db.mark(x.shipment.id, x.lines[0].id, { status: 'picked' });
          await db.mark(x.shipment.id, x.lines[1].id, { status: 'missing', missingReason: 'not_found' });
        }
        // Barrera: la primera pieza faltante de d1 (el CAS de pieza va después de la puerta del operador) ⇒ ambos
        // actos llegan a la puerta por operador; la puerta serializa. Se usa la fila del envío de d1 para
        // asegurar que A ya está dentro cuando B entra.
        const [a, b] = await Promise.all([db.prepare(d1.shipment.id, 31458), db.prepare(d2.shipment.id, 31458)]);
        const both = a.status === 200 && b.status === 200;
        const one = [a, b].filter((x) => x.status === 200).length === 1 && [a, b].some((x) => x.status === 403 && x.body.error.code === 'MONEY_OUT_LIMIT_EXCEEDED');
        outcomes.push(`${!both && one ? 'OK' : 'BAD'}(${code(a)},${code(b)})`);
      }
      const k = report('PS-4', outcomes, (o) => o.startsWith('OK'));
      expect(k).toBe(N);
    } finally {
      await setCap(HUGE_CAP);
    }
  });

  it('PS-4b 💰 (v1.80.7) — el tope es una SUMA, determinista: filas sembradas del actor `item_missing` requested 10000 + submitted 20000 + succeeded 30000 cuentan; `failed` 40000, `order_full` 50000, > 24 h 60000 y de OTRO operador 70000 no ⇒ `usedCents = 60000` exacto en `operatorUsedCents`, en el 403 y en `operator-summary`; a 1 centavo ⇒ 403, con el centavo ⇒ 200 y el siguiente ⇒ 403 {usedCents: 91458}', async () => {
    // Deuda (a) del techlead / v1.80.7 puntos 12 y 18: el predicado es SQL (`aggregate`) ⇒ integración; PS-4 (carrera) y las
    // unitarias de `prepare` no distinguen «ignorar lo acumulado». Operador NUEVO (usado absoluto = 0), filas por SQL
    // con `createdAt` explícito. Mutaciones: `usedCents = 0` / `if (planCents > cap)` ⇒ el primer 403 no ocurre;
    // sin `requestedByUserId` ⇒ 130000; sin `createdAt` ⇒ 120000; sin `status ≠ failed` ⇒ 100000; sin `kind ≠ order_full`
    // ⇒ 110000; `>` por `≥` ⇒ el «con el centavo ⇒ 200» rojo. Cada una roja por igualdad exacta, sin carrera.
    const seedOp = await h.prisma.user.findUniqueOrThrow({ where: { email: E2E_USERS.operator.email } });
    const op = await h.prisma.user.create({
      data: { email: `sp.op4b.${Date.now().toString(36)}@e2e.local`, passwordHash: seedOp.passwordHash, name: 'Operador PS-4b', nameSource: 'user', role: 'vault_operator', emailVerified: true },
    });
    db.users.push(op.id);
    const opToken = await h.login(op.email, E2E_USERS.operator.password);
    const now = Date.now();
    const H = 60 * 60 * 1000;
    // Cada `item_missing` cuelga de su propia línea (`orderItemId`/`shipmentItemId` son @unique): dos filas por directo.
    const fx = await Promise.all([0, 1, 2].map(() => db.mkDirect()));
    const missing = (i: number, amount: number, extra: Record<string, unknown>) => ({
      idempotencyKey: `ps4b:${op.id}:${i}`,
      kind: 'item_missing' as const,
      orderId: fx[i >> 1].order.id,
      orderItemId: fx[i >> 1].orderItems[i & 1].id,
      shipmentItemId: fx[i >> 1].lines.find((l) => l.inventoryItemId === fx[i >> 1].orderItems[i & 1].inventoryItemId)!.id,
      missingReason: 'not_found' as const,
      amountCents: amount,
      merchandiseCents: amount,
      merchandiseIvaCents: 0,
      shippingCents: 0,
      shippingIvaCents: 0,
      processingFeeCents: 0,
      compensationCents: 0,
      requestedByUserId: op.id,
      requestedByRole: 'vault_operator' as const,
      ...extra,
    });
    const stripe = (k: string, at = now) => ({ stripeRefundId: `re_ps4b_${op.id}_${k}`, submittedAt: new Date(at) });
    const rows: Record<string, unknown>[] = [
      // CUENTAN: 10000 + 20000 + 30000 = 60000
      missing(0, 10000, { status: 'requested' }),
      missing(1, 20000, { status: 'submitted', ...stripe('s') }),
      missing(2, 30000, { status: 'succeeded', ...stripe('ok'), succeededAt: new Date(now) }),
      // NO cuentan
      missing(3, 40000, { status: 'failed', failedAt: new Date(now), failureCode: 'x' }),
      { idempotencyKey: `ps4b:${op.id}:full`, kind: 'order_full', orderId: fx[2].order.id, amountCents: 50000, merchandiseCents: 50000, merchandiseIvaCents: 0, shippingCents: 0, shippingIvaCents: 0, processingFeeCents: 0, compensationCents: 0, status: 'succeeded', ...stripe('full'), succeededAt: new Date(now), requestedByUserId: db.adminId, requestedByRole: 'super_admin' },
      missing(4, 60000, { status: 'succeeded', ...stripe('25h', now - 25 * H), succeededAt: new Date(now - 25 * H), createdAt: new Date(now - 25 * H) }),
      { idempotencyKey: `ps4b:${op.id}:otro`, kind: 'order_remaining', orderId: fx[2].order.id, amountCents: 70000, merchandiseCents: 70000, merchandiseIvaCents: 0, shippingCents: 0, shippingIvaCents: 0, processingFeeCents: 0, compensationCents: 0, status: 'succeeded', ...stripe('otro'), succeededAt: new Date(now), requestedByUserId: db.operatorId, requestedByRole: 'vault_operator' },
    ];
    for (const data of rows) await h.prisma.paymentRefund.create({ data: data as any });
    const ledger = h.app.get(RefundLedgerService);
    const d1 = await db.mkDirect();
    const d2 = await db.mkDirect();
    try {
      expect(await ledger.operatorUsedCents(h.prisma, op.id)).toBe(60000);
      const summary = await db.operatorSummary();
      expect(summary.status).toBe(200);
      expect(summary.body.operators.find((o: any) => o.user.userId === op.id)).toMatchObject({ capUsedCents: 60000 });
      // a 1 centavo: cap = 60000 + 31457; una faltante de 31458 ⇒ 403 con la suma EXACTA, cero escrituras, una bitácora
      await setCap(60000 + 31457);
      await db.mark(d1.shipment.id, d1.lines[0].id, { status: 'picked' }, opToken);
      await db.mark(d1.shipment.id, d1.lines[1].id, { status: 'missing', missingReason: 'not_found' }, opToken);
      const r = await db.prepare(d1.shipment.id, 31458, opToken);
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe('MONEY_OUT_LIMIT_EXCEEDED');
      expect(r.body.error.details).toEqual({ capCents: 91457, usedCents: 60000, requestedCents: 31458 });
      expect(await db.refunds({ orderId: d1.order.id })).toHaveLength(0);
      expect((await db.piece(d1.pieces[1].id)).status).toBe('picking');
      expect((await db.shipment(d1.shipment.id)).preparedAt).toBeNull();
      expect(await db.audits(d1.shipment.id, 'money_out.limit_blocked')).toHaveLength(1);
      // con el centavo: cap = 60000 + 31458 ⇒ 200 (la suma es EXACTA, no una cota)
      await setCap(60000 + 31458);
      const ok = await db.prepare(d1.shipment.id, 31458, opToken);
      expect(ok.status).toBe(200);
      expect(ok.body.outcome).toBe('prepared');
      expect(await ledger.operatorUsedCents(h.prisma, op.id)).toBe(91458);
      // el siguiente acto del mismo operador ⇒ 403 {usedCents: 91458}
      await db.mark(d2.shipment.id, d2.lines[0].id, { status: 'picked' }, opToken);
      await db.mark(d2.shipment.id, d2.lines[1].id, { status: 'missing', missingReason: 'not_found' }, opToken);
      const r2 = await db.prepare(d2.shipment.id, 31458, opToken);
      expect(r2.status).toBe(403);
      expect(r2.body.error.details).toEqual({ capCents: 91458, usedCents: 91458, requestedCents: 31458 });
      expect((await db.operatorSummary()).body.operators.find((o: any) => o.user.userId === op.id)).toMatchObject({ capUsedCents: 91458 });
    } finally {
      await setCap(HUGE_CAP);
      await h.prisma.paymentRefund.deleteMany({ where: { OR: [{ idempotencyKey: { startsWith: `ps4b:${op.id}:` } }, { orderId: { in: [d1.order.id, d2.order.id] } }] } });
    }
  });

  // ================================================================ PS-6 / PS-7 — carreras del taller

  it(`PS-6 — des-palomear durante el preparado (barrera en la fila del envío, N=${N}) ⇒ nunca \`preparedAt\` con una disponible \`pending\``, async () => {
    const outcomes: string[] = [];
    for (let t = 0; t < N; t += 1) {
      const d = await db.mkDirect();
      for (const l of d.lines) await db.mark(d.shipment.id, l.id, { status: 'picked' });
      const { a, b } = await db.forced(
        () => db.holdRow('ShipmentRequest', d.shipment.id),
        () => db.prepare(d.shipment.id, 0),
        () => db.mark(d.shipment.id, d.lines[0].id, { status: 'pending' }),
      );
      const sh = await db.shipment(d.shipment.id);
      const pendingAvailable = sh.items.some((i) => i.prepStatus === 'pending');
      const bad = sh.preparedAt !== null && pendingAvailable;
      outcomes.push(`${bad ? 'BAD' : 'OK'}(${code(a)},${code(b)},prepared=${sh.preparedAt !== null},pending=${pendingAvailable})`);
    }
    expect(report('PS-6', outcomes, (o) => o.startsWith('OK'))).toBe(N);
  });

  it(`PS-7 — guía sin preparar ⇒ 409 SHIPMENT_NOT_PREPARED; carrera DELETE …/prepared vs POST …/tracking (N=${N}) ⇒ nunca \`guia\` con \`preparedAt NULL\``, async () => {
    const d0 = await db.mkDirect();
    const t0 = await db.tracking(d0.shipment.id);
    expect(t0.status).toBe(409);
    expect(t0.body.error.code).toBe('SHIPMENT_NOT_PREPARED');
    expect(t0.body.error.details.preparation.status).toBe('in_progress');
    const s0 = await db.status(d0.shipment.id, 'guia');
    expect(s0.status).toBe(409);
    expect(s0.body.error.code).toBe('SHIPMENT_NOT_PREPARED');
    const outcomes: string[] = [];
    for (let t = 0; t < N; t += 1) {
      const d = await db.mkDirect();
      for (const l of d.lines) await db.mark(d.shipment.id, l.id, { status: 'picked' });
      expect((await db.prepare(d.shipment.id, 0)).status).toBe(200);
      const { a, b } = await db.forced(
        () => db.holdRow('ShipmentRequest', d.shipment.id),
        () => db.unprepare(d.shipment.id),
        () => db.tracking(d.shipment.id),
      );
      const sh = await db.shipment(d.shipment.id);
      const bad = sh.status === 'guia' && sh.preparedAt === null;
      outcomes.push(`${bad ? 'BAD' : 'OK'}(${code(a)},${code(b)},${sh.status},prepared=${sh.preparedAt !== null})`);
    }
    expect(report('PS-7', outcomes, (o) => o.startsWith('OK'))).toBe(N);
  });

  // ================================================================ PS-10 / PS-50 / PS-51 — Stripe transitorio y el reintento

  it('PS-10 💰 — Stripe transitorio ⇒ fila `requested`; `retry` ⇒ `submitted` con LA MISMA llave; ya creado en Stripe (metadata) ⇒ lo ENCUENTRA, no crea otro', async () => {
    const d = await db.mkDirect();
    await db.mark(d.shipment.id, d.lines[0].id, { status: 'picked' });
    await db.mark(d.shipment.id, d.lines[1].id, { status: 'missing', missingReason: 'not_found' });
    h.stripe.refundOutcome = 'transient';
    const res = await db.prepare(d.shipment.id, 31458);
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('prepared');
    expect(res.body.refunds[0].status).toBe('requested');
    expect(av12()).toHaveLength(0);
    const row = (await db.refunds({ orderId: d.order.id }))[0];
    expect(row.attemptCount).toBe(1);
    expect(row.attemptStartedAt).toBeNull(); // el transitorio libera el reclamo
    // retry ⇒ misma llave, submitted, AV-12 ahora sí.
    h.stripe.refundOutcome = 'ok';
    const calls = h.stripe.refundCreateCalls.length;
    const rt = await db.retry(row.id);
    expect(rt.status).toBe(200);
    expect(rt.body.status).toBe('submitted');
    expect(h.stripe.refundCreateCalls[h.stripe.refundCreateCalls.length - 1].idempotencyKey).toBe(row.idempotencyKey);
    expect(h.stripe.refundCreateCalls.length - calls).toBe(1);
    expect(av12()).toHaveLength(1);
    // retry de una `submitted` ⇒ 409 REFUND_NOT_RETRYABLE
    const rt2 = await db.retry(row.id);
    expect(rt2.status).toBe(409);
    expect(rt2.body.error.code).toBe('REFUND_NOT_RETRYABLE');

    // «ya creado en Stripe»: fila requested con attemptCount 1 y un reembolso en Stripe con su metadata ⇒ list, no create.
    const d2 = await db.mkDirect();
    await db.mark(d2.shipment.id, d2.lines[0].id, { status: 'picked' });
    await db.mark(d2.shipment.id, d2.lines[1].id, { status: 'missing', missingReason: 'not_found' });
    h.stripe.refundOutcome = 'transient';
    await db.prepare(d2.shipment.id, 31458);
    const row2 = (await db.refunds({ orderId: d2.order.id }))[0];
    const seeded = h.stripe.seedStripeRefund(d2.pi, { status: 'succeeded', metadata: { paymentRefundId: row2.id }, amountCents: 31458 });
    h.stripe.refundOutcome = 'ok';
    h.stripe.expireIdempotencyMemory();
    const c2 = h.stripe.refundCreateCalls.length;
    const rt3 = await db.retry(row2.id);
    expect(rt3.status).toBe(200);
    expect(rt3.body.status).toBe('succeeded');
    expect(h.stripe.refundCreateCalls.length - c2).toBe(0);
    expect((await h.prisma.paymentRefund.findUniqueOrThrow({ where: { id: row2.id } })).stripeRefundId).toBe(seeded.id);
  });

  it('PS-50 💰 — 25 reembolsos sobre el PI y el de la fila en el lugar 23 ⇒ `retry` lo encuentra (cero `refunds.create`)', async () => {
    const d = await db.mkDirect();
    await db.mark(d.shipment.id, d.lines[0].id, { status: 'picked' });
    await db.mark(d.shipment.id, d.lines[1].id, { status: 'missing', missingReason: 'not_found' });
    h.stripe.refundOutcome = 'transient';
    await db.prepare(d.shipment.id, 31458);
    const row = (await db.refunds({ orderId: d.order.id }))[0];
    for (let i = 0; i < 25; i += 1) {
      h.stripe.seedStripeRefund(d.pi, { status: 'succeeded', metadata: i === 22 ? { paymentRefundId: row.id } : { other: String(i) }, amountCents: 1 });
    }
    h.stripe.refundOutcome = 'ok';
    h.stripe.expireIdempotencyMemory();
    const c = h.stripe.refundCreateCalls.length;
    const rt = await db.retry(row.id);
    expect(rt.status).toBe(200);
    expect(rt.body.status).toBe('succeeded');
    expect(h.stripe.refundCreateCalls.length - c).toBe(0);
  });

  it(`PS-51 💰 — dos \`retry\` simultáneos con la llave expirada (barrera en la fila del libro, N=${N}) ⇒ exactamente UNA llamada a Stripe; el otro 409 REFUND_ATTEMPT_IN_PROGRESS`, async () => {
    const outcomes: string[] = [];
    for (let t = 0; t < N; t += 1) {
      const d = await db.mkDirect();
      await db.mark(d.shipment.id, d.lines[0].id, { status: 'picked' });
      await db.mark(d.shipment.id, d.lines[1].id, { status: 'missing', missingReason: 'not_found' });
      h.stripe.refundOutcome = 'transient';
      await db.prepare(d.shipment.id, 31458);
      const row = (await db.refunds({ orderId: d.order.id }))[0];
      h.stripe.refundOutcome = 'ok';
      h.stripe.expireIdempotencyMemory();
      h.stripe.refundDelayMs = 150;
      const c = h.stripe.refundCreateCalls.length;
      const { a, b } = await db.forced(
        () => db.holdRow('PaymentRefund', row.id),
        () => db.retry(row.id),
        () => db.retry(row.id),
      );
      h.stripe.refundDelayMs = 0;
      const creates = h.stripe.refundCreateCalls.length - c;
      const one200 = [a, b].filter((r) => r.status === 200).length === 1;
      const one409 = [a, b].some((r) => r.status === 409 && r.body.error.code === 'REFUND_ATTEMPT_IN_PROGRESS');
      outcomes.push(`${creates === 1 && one200 && one409 ? 'OK' : 'BAD'}(${code(a)},${code(b)},create=${creates})`);
    }
    expect(report('PS-51', outcomes, (o) => o.startsWith('OK'))).toBe(N);
  });

  // ================================================================ PS-11 / PS-12 / PS-44 / PS-45 — M3 total

  it('PS-11/PS-12 💰 — M3 total tras un reembolso por carta ⇒ Stripe recibe total − 31458; el operador ⇒ 403 MONEY_OUT_FORBIDDEN (también en `retry` de `order_full`)', async () => {
    const d = await db.mkDirect();
    await db.mark(d.shipment.id, d.lines[0].id, { status: 'picked' });
    await db.mark(d.shipment.id, d.lines[1].id, { status: 'missing', missingReason: 'not_found' });
    expect((await db.prepare(d.shipment.id, 31458)).status).toBe(200);
    const op = await db.m3Refund(d.order.id, { reason: 'x' }, db.opToken);
    expect(op.status).toBe(403);
    expect(op.body.error.code).toBe('MONEY_OUT_FORBIDDEN');
    const c = h.stripe.refundCreateCalls.length;
    const m3 = await db.m3Refund(d.order.id, { reason: 'error de cobro' });
    expect(m3.status).toBe(201);
    expect(h.stripe.refundCreateCalls[h.stripe.refundCreateCalls.length - 1]).toMatchObject({ paymentIntentId: d.pi, amountCents: OWNER_EXAMPLE.totalCents - 31458, idempotencyKey: `order-full:${d.order.id}` });
    expect(h.stripe.refundCreateCalls.length - c).toBe(1);
    const rows = await db.refunds({ orderId: d.order.id });
    expect(rows.reduce((a, r) => a + r.amountCents, 0)).toBe(OWNER_EXAMPLE.totalCents);
    expect((await db.order(d.order.id)).status).toBe('refunded');
    // PS-44 (a): el envío vivo se cerró en la tx de M3 (ya estaba preparado): cancelado, pieza picking congelada, needsManual.
    const sh = await db.shipment(d.shipment.id);
    expect(sh.status).toBe('cancelado');
    expect((await db.piece(d.pieces[0].id)).status).toBe('picking');
    expect((await db.order(d.order.id)).chargebackNeedsManual).toBe(true);
    expect(await db.audits(d.shipment.id, 'shipment.closed_by_full_refund')).toHaveLength(1);
    expect((await db.tracking(d.shipment.id)).status).toBe(409);
    // segundo M3 ⇒ 422 (la orden ya no está `settled`: guarda SEC-M3 de siempre)
    const m3b = await db.m3Refund(d.order.id, { reason: 'x' });
    expect(m3b.status).toBe(422);
    // AV-3: una vez (fila order_full no fallida ⇒ permitido); el webhook tardío no la duplica.
    expect(av3()).toHaveLength(1);
    const wh = await db.chargeRefunded(d.pi, OWNER_EXAMPLE.totalCents);
    expect(wh.status).toBe(200);
    expect(av3()).toHaveLength(1);
    // retry de order_full por operador ⇒ 403
    const full = rows.find((r) => r.kind === 'order_full')!;
    const rt = await db.retry(full.id, db.opToken);
    expect(rt.status).toBe(403);
    expect(rt.body.error.code).toBe('MONEY_OUT_FORBIDDEN');
  });

  it(`PS-11 💰 — M3 total concurrente con un preparado (barrera en la fila del envío, N=${N}) ⇒ Σ ≤ total en todas; nunca guía tras un M3 total`, async () => {
    const outcomes: string[] = [];
    for (let t = 0; t < N; t += 1) {
      const d = await db.mkDirect();
      await db.mark(d.shipment.id, d.lines[0].id, { status: 'picked' });
      await db.mark(d.shipment.id, d.lines[1].id, { status: 'missing', missingReason: 'not_found' });
      const { a, b } = await db.forced(
        () => db.holdRow('ShipmentRequest', d.shipment.id),
        () => db.prepare(d.shipment.id, 31458),
        () => db.m3Refund(d.order.id, { reason: 'x' }),
      );
      const rows = await db.refunds({ orderId: d.order.id, status: { not: 'failed' } });
      const sum = rows.reduce((x, r) => x + r.amountCents, 0);
      const sh = await db.shipment(d.shipment.id);
      const stripeSum = (h.stripe.refundsByIntent.get(d.pi) ?? []).reduce((x, r) => x + r.amountCents, 0);
      const ok = sum <= OWNER_EXAMPLE.totalCents && stripeSum <= OWNER_EXAMPLE.totalCents && sh.status === 'cancelado';
      outcomes.push(`${ok ? 'OK' : 'BAD'}(${code(a)},${code(b)},Σ=${sum},stripe=${stripeSum},${sh.status})`);
    }
    expect(report('PS-11', outcomes, (o) => o.startsWith('OK'))).toBe(N);
  });

  it('PS-44 💰 — `charge.refunded` total sobre un directo en `guia` ⇒ cerrado; orden `refunded` por fixture SIN cierre ⇒ tracking/guia/enviado/prepared 409 ORDER_NOT_SETTLED', async () => {
    const d = await db.mkDirect();
    for (const l of d.lines) await db.mark(d.shipment.id, l.id, { status: 'picked' });
    expect((await db.prepare(d.shipment.id, 0)).status).toBe(200);
    expect((await db.tracking(d.shipment.id)).status).toBe(201);
    expect((await db.shipment(d.shipment.id)).status).toBe('guia');
    const wh = await db.chargeRefunded(d.pi, OWNER_EXAMPLE.totalCents);
    expect(wh.status).toBe(200);
    const sh = await db.shipment(d.shipment.id);
    expect(sh.status).toBe('cancelado');
    const o = await db.order(d.order.id);
    expect(o.status).toBe('refunded');
    expect(o.chargebackNeedsManual).toBe(true);
    expect(o.fullRefundClosedAt).not.toBeNull();
    // AV-3 sí: ninguna fila del libro (reembolso hecho fuera del sistema).
    expect(av3()).toHaveLength(1);

    // fixture: orden `refunded` sin cierre
    const e = await db.mkDirect();
    for (const l of e.lines) await db.mark(e.shipment.id, l.id, { status: 'picked' });
    await h.prisma.order.update({ where: { id: e.order.id }, data: { status: 'refunded' } });
    for (const r of [await db.prepare(e.shipment.id, 0), await db.tracking(e.shipment.id), await db.status(e.shipment.id, 'guia')]) {
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('ORDER_NOT_SETTLED');
      expect(r.body.error.details.orderStatus).toBe('refunded');
    }
    await h.prisma.shipmentRequest.update({ where: { id: e.shipment.id }, data: { status: 'guia', preparedAt: new Date(), preparedByUserId: db.operatorId } });
    const env = await db.status(e.shipment.id, 'enviado');
    expect(env.status).toBe(409);
    expect(env.body.error.code).toBe('ORDER_NOT_SETTLED');
  });

  it(`PS-44 💰 — carrera M3 vs \`prepared\` (barrera en la fila del envío, N=${N}) ⇒ nunca un envío preparado NO cancelado con la orden \`refunded\``, async () => {
    const outcomes: string[] = [];
    for (let t = 0; t < N; t += 1) {
      const d = await db.mkDirect();
      for (const l of d.lines) await db.mark(d.shipment.id, l.id, { status: 'picked' });
      const { a, b } = await db.forced(
        () => db.holdRow('ShipmentRequest', d.shipment.id),
        () => db.m3Refund(d.order.id, { reason: 'x' }),
        () => db.prepare(d.shipment.id, 0),
      );
      const sh = await db.shipment(d.shipment.id);
      const o = await db.order(d.order.id);
      const bad = o.status === 'refunded' && sh.preparedAt !== null && sh.status !== 'cancelado';
      outcomes.push(`${bad ? 'BAD' : 'OK'}(${code(a)},${code(b)},${sh.status},${o.status})`);
    }
    expect(report('PS-44', outcomes, (o) => o.startsWith('OK'))).toBe(N);
  });

  it('PS-45 — `chargeback-inventory` sobre un directo `refunded`: `recuperada` ⇒ a la venta; `no_recuperada` ⇒ `lost` firmada; `reexpedir` ⇒ 409', async () => {
    const mk = async () => {
      const d = await db.mkDirect();
      for (const l of d.lines) await db.mark(d.shipment.id, l.id, { status: 'picked' });
      expect((await db.prepare(d.shipment.id, 0)).status).toBe(200);
      expect((await db.m3Refund(d.order.id, { reason: 'x' })).status).toBe(201);
      expect((await db.order(d.order.id)).chargebackNeedsManual).toBe(true);
      return d;
    };
    const a = await mk();
    const re = await db.chargebackInventory(a.order.id, 'reexpedir');
    expect(re.status).toBe(409);
    const rec = await db.chargebackInventory(a.order.id, 'recuperada');
    expect(rec.status).toBe(200);
    for (const p of a.pieces) expect(['listed', 'in_stock']).toContain((await db.piece(p.id)).status);
    expect((await db.order(a.order.id)).chargebackNeedsManual).toBe(false);
    const b = await mk();
    const no = await db.chargebackInventory(b.order.id, 'no_recuperada');
    expect(no.status).toBe(200);
    for (const p of b.pieces) {
      expect((await db.piece(p.id)).status).toBe('lost');
      const mov = (await db.movements([p.id])).find((m) => m.toStatus === 'lost')!;
      expect(mov.reason).toBe('lost');
      expect(mov.actorUserId).toBe(db.operatorId);
    }
    expect((await db.chargebackInventory(b.order.id, 'no_recuperada')).status).toBe(409);
  });

  // ================================================================ PS-13 / PS-15 / PS-43 — guardas

  it('PS-13 — cancelar a mano: picking/guia ⇒ 409 PAID_SHIPMENT_NOT_CANCELLABLE (cero escritura, cero correo); solicitado con PI cobrado ⇒ ídem; cancelable ⇒ 200 + AV-6', async () => {
    const d = await db.mkDirect();
    const r1 = await db.status(d.shipment.id, 'cancelado');
    expect(r1.status).toBe(409);
    expect(r1.body.error.code).toBe('PAID_SHIPMENT_NOT_CANCELLABLE');
    expect(r1.body.error.details.status).toBe('picking');
    expect((await db.shipment(d.shipment.id)).status).toBe('picking');
    expect(av6()).toHaveLength(0);
    const u = await db.mkUser();
    const v = await db.mkVaultOrder(u.id, { placement: 'none' });
    const w = await db.mkWithdrawal(u.id, [v.pieces[0].id], 'solicitado');
    h.stripe.cancelOutcome = 'throws-succeeded';
    const r2 = await db.status(w.shipment.id, 'cancelado');
    expect(r2.status).toBe(409);
    expect(r2.body.error.code).toBe('PAID_SHIPMENT_NOT_CANCELLABLE');
    expect((await db.shipment(w.shipment.id)).status).toBe('solicitado');
    h.stripe.cancelOutcome = 'canceled';
    const r3 = await db.status(w.shipment.id, 'cancelado');
    expect(r3.status).toBe(200);
    expect((await db.shipment(w.shipment.id)).status).toBe('cancelado');
    expect(av6()).toHaveLength(1);
    expect(h.stripe.canceledIntents).toContain(w.pi);
  });

  it('PS-15 — `not_refundable`: orden IVA_EXCLUSIVE ⇒ 409 REFUND_NOT_AVAILABLE (legacy_convention); orden de origen `refunded` ⇒ order_not_settled; cero escrituras', async () => {
    const d = await db.mkDirect({ priceConvention: 'IVA_EXCLUSIVE' });
    await db.mark(d.shipment.id, d.lines[0].id, { status: 'picked' });
    await db.mark(d.shipment.id, d.lines[1].id, { status: 'missing', missingReason: 'not_found' });
    const r = await db.prepare(d.shipment.id, 0);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('REFUND_NOT_AVAILABLE');
    expect(r.body.error.details.lines).toEqual([{ shipmentItemId: d.lines[1].id, reason: 'legacy_convention' }]);
    expect((await db.piece(d.pieces[1].id)).status).toBe('picking');
    expect(await db.refunds({ orderId: d.order.id })).toHaveLength(0);
    const q = await db.queue();
    const row = q.body.data.find((x: any) => x.shipmentId === d.shipment.id);
    expect(row.items.find((i: any) => i.shipmentItemId === d.lines[1].id).refund).toEqual({ kind: 'not_refundable', reason: 'legacy_convention' });
  });

  it('PS-43 💰 — línea `blocked` con orden `settled` ⇒ 409 PREPARATION_HAS_BLOCKED_LINES, cero filas, sigue picking; con la orden en `chargeback` ⇒ sin ese 409', async () => {
    const d = await db.mkDirect();
    await db.mark(d.shipment.id, d.lines[0].id, { status: 'picked' });
    await h.prisma.inventoryItem.update({ where: { id: d.pieces[1].id }, data: { status: 'in_stock' } });
    const r = await db.prepare(d.shipment.id, 0);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('PREPARATION_HAS_BLOCKED_LINES');
    expect(r.body.error.details.lines).toEqual([{ shipmentItemId: d.lines[1].id, pieceStatus: 'in_stock', originOrderId: d.order.id }]);
    expect(await db.refunds({ orderId: d.order.id })).toHaveLength(0);
    expect((await db.shipment(d.shipment.id)).status).toBe('picking');
    // no se puede marcar una bloqueada
    const mk = await db.mark(d.shipment.id, d.lines[1].id, { status: 'picked' });
    expect(mk.status).toBe(409);
    expect(mk.body.error.code).toBe('PREP_ITEM_BLOCKED');
    expect(mk.body.error.details).toEqual({ reason: 'piece_not_available', pieceStatus: 'in_stock' });
    await h.prisma.order.update({ where: { id: d.order.id }, data: { status: 'chargeback' } });
    const r2 = await db.prepare(d.shipment.id, 0);
    // la orden en contracargo ⇒ ORDER_NOT_SETTLED (SEC-SHIP-A2), no PREPARATION_HAS_BLOCKED_LINES.
    expect(r2.status).toBe(409);
    expect(r2.body.error.code).toBe('ORDER_NOT_SETTLED');
  });

  // ================================================================ PS-16 / PS-17 — proyecciones y contador

  it('PS-16 — `customer` de un directo CON CUENTA = el comprador (⛔ no el destinatario); `derived` ⇒ null; `?q=` por destinatario encuentra el envío; el cliente no ve actor', async () => {
    const buyer = await db.mkUser('Ana Compradora');
    const d = await db.mkDirect({ userId: buyer.id });
    const q = await db.queue();
    const row = q.body.data.find((x: any) => x.shipmentId === d.shipment.id);
    expect(row.customer).toEqual({ userId: buyer.id, email: buyer.email, lastName: 'Compradora', fullName: 'Ana Compradora' });
    expect(row.shipTo.recipientName).toBe('Destinatario Directo');
    const derived = await db.mkUser('Derivado Nombre', { nameSource: 'derived' });
    const d2 = await db.mkDirect({ userId: derived.id });
    const q2 = await db.queue();
    expect(q2.body.data.find((x: any) => x.shipmentId === d2.shipment.id).customer).toEqual({ userId: derived.id, email: derived.email, lastName: null, fullName: null });
    // La lista va `requestedAt asc` y TODOS los directos de esta suite comparten destinatario: se recorren las páginas
    // (⛔ no se acota `q`): lo que se mide es que `?q=` por destinatario ENCUENTRA el envío, no en qué página cae.
    const findByRecipient = async (id: string) => {
      for (let page = 1; page <= 20; page += 1) {
        const list = await h.api('GET', `/admin/shipments?q=${encodeURIComponent('Destinatario Directo')}&page=${page}&pageSize=100`, { token: db.opToken });
        expect(list.status).toBe(200);
        const hit = list.body.data.find((s: any) => s.id === id);
        if (hit) return hit;
        if (list.body.data.length < 100) return null;
      }
      return null;
    };
    const hit = await findByRecipient(d.shipment.id);
    expect(hit).not.toBeNull();
    expect(hit.customer).toEqual({ userId: buyer.id, fullName: 'Ana Compradora', email: buyer.email });
    const tooLong = await h.api('GET', `/admin/shipments?q=${'a'.repeat(201)}`, { token: db.opToken });
    expect(tooLong.status).toBe(400);
    // el detalle admin trae refunds e items con marcas
    const det = await h.api('GET', `/admin/shipments/${d.shipment.id}`, { token: db.opToken });
    expect(det.status).toBe(200);
    expect(det.body.refunds).toEqual([]);
    expect(det.body.items[0].prepStatus).toBe('pending');
    expect(det.body.missingCount).toBe(0);
  });

  it('PS-17 — `summary`: una colocación `pending` y un envío `picking` sin preparar ⇒ {ship, vault}; `manualRefundsPending` null al operador', async () => {
    const before = await db.summary();
    const u = await db.mkUser();
    await db.mkVaultOrder(u.id, { placement: 'pending' });
    const d = await db.mkDirect();
    const after = await db.summary();
    expect(after.status).toBe(200);
    expect(after.body.ship - before.body.ship).toBe(1);
    expect(after.body.vault - before.body.vault).toBe(1);
    expect(after.body.manualRefundsPending).toBeNull();
    expect(typeof after.body.stuckRefunds).toBe('number');
    const admin = await db.summary(db.adminToken);
    expect(typeof admin.body.manualRefundsPending).toBe('number');
    for (const l of d.lines) await db.mark(d.shipment.id, l.id, { status: 'picked' });
    await db.prepare(d.shipment.id, 0);
    const prepared = await db.summary();
    expect(prepared.body.ship).toBe(before.body.ship);
  });
});
