/**
 * replacement-cases.e2e-spec.ts — §M4-SHIP.15 «Por reponer», la cubeta SPEI (§M4-SHIP.15.13) y los cierres de
 * seguridad de la CLABE (§M4-SHIP.17.3/.17.4/.17.8), contra Postgres REAL (app Nest completa por HTTP, doble de
 * Stripe CON ESTADO). Propiedad: backend.
 *
 * Cubre PS-18, PS-19, PS-21…PS-28, PS-29, PS-30…PS-36, PS-38, PS-39, PS-46 (integración), PS-47, PS-48, PS-53, PS-54
 * de API_CONTRACT §M4-SHIP.12 / .17.9 (PS-20 vive en `vault-placement-verbs.e2e-spec.ts`; PS-37 en
 * `test/refunds.candados.spec.ts`; PS-40 en la suite de M7). Carreras: entrelazado FORZADO por barrera de fila
 * (prueba 40), N ≥ 10, proporción con su N (`[PS-RACE …] k/N`); una tirada sin entrelazado observado NO cuenta.
 * Mutaciones (cada PS nombra la suya) se demuestran sobre COPIA del árbol entero, ⛔ nunca aquí.
 */
import { MAIL_PORT, MailMessage, MailPort } from '../../src/modules/mail/mail.port';
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { R, ShipPrepDb } from './helpers/ship-prep-db';
import { SettingKey } from '../../src/modules/settings/settings.constants';
import { ReplacementCaseService } from '../../src/modules/vault/replacement-case.service';
import { ShipmentPrepService } from '../../src/modules/shipments/shipment-prep.service';
import { ManualRefundService } from '../../src/modules/payments/refunds/manual-refund.service';
import { REPLACEMENT_CASE_DUE_MS } from '../../src/modules/vault/replacement-case.rules';
import { caseRefundComponents, caseRefundContextOf, itemMissingRefundComponents } from '../../src/common/money';
import { PiiCryptoService } from '../../src/common/crypto/pii-crypto.service';

const RUN = Date.now().toString(36);
const N = 10;
const CLABE_A = '012345678901234567';
const CLABE_B = '646180110400000007';

describe('§M4-SHIP.15 — «Por reponer», la cubeta SPEI y la CLABE (Postgres real)', () => {
  let h: E2EHarness;
  let db: ShipPrepDb;
  let bandeja: MailMessage[] = [];
  let spy: jest.SpyInstance;
  const av12 = () => bandeja.filter((m) => /Reembolso de (?!tu pedido)/.test(m.subject));
  const av13 = () => bandeja.filter((m) => /estamos reponiendo una carta/.test(m.subject));
  const av14 = () => bandeja.filter((m) => /Te vamos a depositar/.test(m.subject));
  const av15 = () => bandeja.filter((m) => /ya fue depositado/.test(m.subject));
  const av16 = () => bandeja.filter((m) => /Se actualizó tu CLABE/.test(m.subject));
  const code = (r: R) => (r.status === 200 ? `200:${r.body.outcome ?? 'ok'}` : `${r.status}:${r.body?.error?.code}`);
  const report = (id: string, outcomes: string[], ok: (o: string) => boolean) => {
    const k = outcomes.filter(ok).length;
    // eslint-disable-next-line no-console
    console.log(`[PS-RACE ${id}] ${k}/${outcomes.length} · N=${outcomes.length} · ${outcomes.join(' | ')}`);
    return k;
  };
  const setK = (v: number) =>
    h.prisma.configSetting.upsert({
      where: { key: SettingKey.CASE_REFUND_HARD_MULTIPLIER },
      create: { key: SettingKey.CASE_REFUND_HARD_MULTIPLIER, valueJson: v },
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
  });

  afterAll(async () => {
    spy?.mockRestore();
    await setK(5);
    await db.cleanup();
    await h?.close();
  });

  beforeEach(async () => {
    bandeja = [];
    h.stripe.refundOutcome = 'ok';
    h.stripe.refundDelayMs = 0;
    await setK(5);
  });

  // ================================================================ fixtures

  /** Retiro en `picking` de dos cartas de la bóveda (compradas en una orden `vault` ya colocada). */
  async function mkWithdrawalCase(opts: { cardIds?: string[]; name?: string } = {}) {
    const u = await db.mkUser(opts.name ?? 'Retiro Caso');
    const drawer = await db.mkDrawer();
    const vo = await db.mkVaultOrder(u.id, { prices: [50000, 30000], placement: 'placed', locationId: drawer.id, cardIds: opts.cardIds });
    const w = await db.mkWithdrawal(u.id, vo.pieces.map((p) => p.id), 'picking');
    return { u, drawer, vo, w, line: (i: number) => w.lines.find((l) => l.inventoryItemId === vo.pieces[i].id)! };
  }

  /** Q de la carta de MX$500 de una orden vault de [50000, 30000] con F=4617 (§M4-SHIP.4). */
  const Q = 50000 + Math.floor((4617 * 50000) / 80000); // 52885

  /**
   * F-SPEI (§M4-SHIP.12): orden `vault` IVA_INCLUSIVE con dos cartas P₁=50000 (la del caso) y P₂=30000, sin envío,
   * mercado `priced` de la pieza = `M` (carta propia con referencia manual); el caso nace al COLOCAR.
   */
  async function mkSpei(market: number | null = 60000, opts: { name?: string; prices?: readonly number[] } = {}) {
    const u = await db.mkUser(opts.name ?? 'SPEI Caso');
    const drawer = await db.mkDrawer();
    const card = await db.mkCard(market);
    const vo = await db.mkVaultOrder(u.id, { prices: opts.prices ?? [50000, 30000], placement: 'pending', locationId: drawer.id, cardIds: [card.id] });
    const placement = vo.placement!;
    const items = await h.prisma.vaultPlacementItem.findMany({ where: { placementId: placement.id } });
    const it0 = items.find((i) => i.inventoryItemId === vo.pieces[0].id)!;
    for (const it of items) {
      if (it.id === it0.id) continue;
      expect((await db.vpMark(placement.id, it.id, { status: 'picked' })).status).toBe(200);
    }
    expect((await db.vpMark(placement.id, it0.id, { status: 'missing', missingReason: 'not_found' })).status).toBe(200);
    expect((await db.vpPrepare(placement.id)).status).toBe(200);
    const conf = await db.vpConfirm(placement.id, { locationId: drawer.id });
    expect(conf.status).toBe(200);
    const caseId: string = conf.body.items.find((i: any) => i.result === 'missing').caseId;
    bandeja = [];
    return { u, drawer, card, vo, placement, caseId, orderItem: vo.orderItems[0], piece: vo.pieces[0] };
  }

  const refundBody = (preview: R, amountCents: number, extra: Record<string, unknown> = {}) => ({
    amountCents,
    reason: 'TCGplayer NM 2026-09-29',
    expectedStripeCents: preview.body.stripeCents,
    expectedManualCents: preview.body.manualCents,
    ...extra,
  });

  // ================================================================ PS-18 / PS-19 — el nacimiento

  it('PS-18 💰 — RETIRO con una `not_found` y una `damaged`: cero filas, cero Stripe, DOS casos `open`, piezas `lost`/`damaged` A NOMBRE del cliente, un AV-13, cero AV-12; `HoldingDTO.replacement`', async () => {
    const f = await mkWithdrawalCase();
    expect((await db.mark(f.w.shipment.id, f.line(0).id, { status: 'missing', missingReason: 'not_found' })).status).toBe(200);
    expect((await db.mark(f.w.shipment.id, f.line(1).id, { status: 'missing', missingReason: 'damaged' })).status).toBe(200);
    const q = (await db.queue()).body.data.find((r: any) => r.shipmentId === f.w.shipment.id);
    expect(q.preparation).toMatchObject({ status: 'in_progress', refundPreviewCents: 0, missing: 2 });
    expect(q.items.map((i: any) => i.refund.kind)).toEqual(['to_replacement', 'to_replacement']);
    const calls = h.stripe.refundCreateCalls.length;
    const res = await db.prepare(f.w.shipment.id, 0);
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('prepared');
    expect(res.body.preparation).toMatchObject({ status: 'prepared', openReplacements: 2 });
    expect(h.stripe.refundCreateCalls.length).toBe(calls);
    expect(await db.refunds({ shipmentRequestId: f.w.shipment.id })).toHaveLength(0);
    const cases = await h.prisma.replacementCase.findMany({ where: { shipmentRequestId: f.w.shipment.id }, orderBy: { openedAt: 'asc' } });
    expect(cases).toHaveLength(2);
    const byPiece = new Map(cases.map((c) => [c.originalInventoryItemId, c]));
    expect(byPiece.get(f.vo.pieces[0].id)).toMatchObject({ source: 'withdrawal', status: 'open', missingReason: 'not_found', customerUserId: f.u.id, openedByUserId: db.operatorId, originOrderItemId: f.vo.orderItems[0].id });
    expect(byPiece.get(f.vo.pieces[1].id)).toMatchObject({ source: 'withdrawal', status: 'open', missingReason: 'damaged', originOrderItemId: f.vo.orderItems[1].id });
    const p0 = await db.piece(f.vo.pieces[0].id);
    const p1 = await db.piece(f.vo.pieces[1].id);
    expect(p0).toMatchObject({ status: 'lost', ownerType: 'customer', ownerUserId: f.u.id, ownershipStatus: 'settled', locationId: f.drawer.id });
    expect(p1).toMatchObject({ status: 'damaged', ownerType: 'customer', ownerUserId: f.u.id, ownershipStatus: 'settled' });
    expect(av13()).toHaveLength(1);
    expect(av12()).toHaveLength(0);
    // La cola: la línea ya trae su caso.
    const q2 = (await db.queue()).body.data.find((r: any) => r.shipmentId === f.w.shipment.id);
    expect(q2.items.map((i: any) => i.refund.kind)).toEqual(['replacement', 'replacement']);
    // «Mi bóveda»: la sigue enseñando, «la estamos reponiendo», NO retirable; y su retiro dice lo mismo.
    const tok = await db.loginCustomer(f.u.email!);
    const hold = (await db.holdings(tok)).body.data.find((x: any) => x.inventoryItemId === f.vo.pieces[0].id);
    expect(hold).toMatchObject({ status: 'lost', withdrawable: false, replacement: { status: 'open', reason: 'not_found', since: expect.any(String), refund: null } });
    const cs = await db.clientShipment(f.w.shipment.id, tok);
    expect(cs.status).toBe(200);
    expect(cs.body.items.map((i: any) => i.replacement)).toEqual([
      { status: 'open', reason: 'not_found', refund: null },
      { status: 'open', reason: 'damaged', refund: null },
    ]);
    expect(JSON.stringify(cs.body)).not.toMatch(/openedBy|candidate|marketRef|actor/);
    // Mutación: dejar el retiro por la rama `item_missing` de v1.80 ⇒ una fila del libro (rojo aquí).
  });

  it('PS-19 💰 — DIRECTO intacto: la carta `damaged` ⇒ 31458, pieza `damaged` de PLATAFORMA, CERO casos', async () => {
    const d = await db.mkDirect();
    const line300 = d.lines.find((l) => l.inventoryItemId === d.pieces[1].id)!;
    expect((await db.mark(d.shipment.id, line300.id, { status: 'missing', missingReason: 'damaged' })).status).toBe(200);
    expect((await db.mark(d.shipment.id, d.lines.find((l) => l.inventoryItemId === d.pieces[0].id)!.id, { status: 'picked' })).status).toBe(200);
    const res = await db.prepare(d.shipment.id, 31458);
    expect(res.status).toBe(200);
    const rows = await db.refunds({ shipmentRequestId: null, orderId: d.order.id });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'item_missing', amountCents: 31458, missingReason: 'damaged' });
    expect(await db.piece(d.pieces[1].id)).toMatchObject({ status: 'damaged', ownerType: 'platform' });
    expect(await h.prisma.replacementCase.count({ where: { originalInventoryItemId: d.pieces[1].id } })).toBe(0);
    // Mutación: tratar `damaged` distinto de `not_found` (mandar el directo al apartado) ⇒ un caso aquí.
  });

  // ================================================================ PS-21 — la guía espera

  it('PS-21 — retiro preparado con un caso `open` ⇒ tracking y →guia 409 SHIPMENT_HAS_OPEN_REPLACEMENTS; carrera replace vs tracking (N≥10): nunca `guia` con caso abierto y la repuesta va en el paquete', async () => {
    const outcomes: string[] = [];
    let interleavedRuns = 0;
    for (let i = 0; i < N; i += 1) {
      const f = await mkWithdrawalCase({ name: `PS21 ${i}` });
      await db.mark(f.w.shipment.id, f.line(0).id, { status: 'missing', missingReason: 'not_found' });
      await db.mark(f.w.shipment.id, f.line(1).id, { status: 'picked' });
      expect((await db.prepare(f.w.shipment.id, 0)).status).toBe(200);
      const kase = (await h.prisma.replacementCase.findFirstOrThrow({ where: { shipmentRequestId: f.w.shipment.id } })).id;
      if (i === 0) {
        const t = await db.tracking(f.w.shipment.id);
        expect(t.status).toBe(409);
        expect(t.body.error).toMatchObject({ code: 'SHIPMENT_HAS_OPEN_REPLACEMENTS', details: { caseIds: [kase] } });
        const g = await db.status(f.w.shipment.id, 'guia');
        expect(g.status).toBe(409);
        expect(g.body.error.code).toBe('SHIPMENT_HAS_OPEN_REPLACEMENTS');
        expect((await db.shipment(f.w.shipment.id)).status).toBe('picking');
      }
      const cand = await db.mkPiece({ status: 'in_stock' });
      const r = await db.forced(
        () => db.holdRow('ShipmentRequest', f.w.shipment.id),
        () => db.caseReplace(kase, { inventoryItemId: cand.id }),
        () => db.tracking(f.w.shipment.id),
      );
      if (r.interleaved) interleavedRuns += 1;
      const s = await db.shipment(f.w.shipment.id);
      const open = await h.prisma.replacementCase.count({ where: { shipmentRequestId: f.w.shipment.id, status: 'open' } });
      const invariant = !(s.status === 'guia' && open > 0);
      outcomes.push(`${code(r.a)},${code(r.b)},ship=${s.status},open=${open}${invariant ? '' : ',VIOLATION'}`);
      // Si la guía no entró, entra ahora (el caso ya está resuelto); la repuesta VA en el paquete.
      if (s.status !== 'guia') expect((await db.tracking(f.w.shipment.id)).status).toBe(200);
      expect((await db.status(f.w.shipment.id, 'enviado')).status).toBe(200);
      expect((await db.status(f.w.shipment.id, 'entregado')).status).toBe(200);
      expect((await db.piece(cand.id)).status).toBe('withdrawn');
      expect(await db.piece(f.vo.pieces[0].id)).toMatchObject({ status: 'lost', ownerType: 'platform' });
    }
    const k = report('PS-21', outcomes, (o) => !o.includes('VIOLATION') && o.startsWith('200:replaced'));
    expect(k).toBe(N);
    expect(interleavedRuns).toBe(N);
    // Mutación: quitar la condición de casos del `WHERE` de `setTracking` ⇒ guía con caso abierto en ≥1 tirada.
  });

  // ================================================================ PS-22 / PS-23 / PS-24 / PS-25 — reponer

  it('PS-22 💰 — identidad: otro acabado / condición / carta ⇒ 422 identity_mismatch con `mismatch` exacto; candidata reserved/picking/in_custody ⇒ 422 not_platform_available; cero escrituras', async () => {
    const f = await mkWithdrawalCase();
    await db.mark(f.w.shipment.id, f.line(0).id, { status: 'missing', missingReason: 'not_found' });
    await db.mark(f.w.shipment.id, f.line(1).id, { status: 'picked' });
    await db.prepare(f.w.shipment.id, 0);
    const kase = (await h.prisma.replacementCase.findFirstOrThrow({ where: { shipmentRequestId: f.w.shipment.id } })).id;
    const otherCard = await db.mkCard(null);
    // (`RawCondition` solo tiene `NM` en este schema: la condición no puede diferir; se miden acabado, carta y ambos.)
    const bad: [Record<string, unknown>, string[]][] = [
      [{ finish: 'holofoil' }, ['finish']],
      [{ cardId: otherCard.id }, ['cardId']],
      [{ cardId: otherCard.id, finish: 'holofoil' }, ['cardId', 'finish']],
    ];
    for (const [over, mismatch] of bad) {
      const cand = await db.mkPiece({ status: 'in_stock', ...(over as any) });
      const r = await db.caseReplace(kase, { inventoryItemId: cand.id });
      expect(r.status).toBe(422);
      expect(r.body.error).toMatchObject({ code: 'REPLACEMENT_NOT_ELIGIBLE', details: { reason: 'identity_mismatch', mismatch } });
      expect((await db.piece(cand.id)).status).toBe('in_stock');
    }
    for (const status of ['reserved', 'picking'] as const) {
      const cand = await db.mkPiece({ status });
      const r = await db.caseReplace(kase, { inventoryItemId: cand.id });
      expect(r.status).toBe(422);
      expect(r.body.error.details).toEqual({ reason: 'not_platform_available' });
      expect((await db.piece(cand.id)).status).toBe(status);
    }
    const foreign = await db.mkPiece({ status: 'in_custody', ownerType: 'customer', ownerUserId: (await db.mkUser('Otro')).id, ownershipStatus: 'settled' });
    const r2 = await db.caseReplace(kase, { inventoryItemId: foreign.id });
    expect(r2.status).toBe(422);
    expect(r2.body.error.details.reason).toBe('not_platform_available');
    expect((await db.piece(foreign.id)).ownerType).toBe('customer');
    expect((await db.kase(kase)).status).toBe('open');
    expect((await db.caseReplace(kase, { inventoryItemId: 'no-existe' })).body.error.details.reason).toBe('not_found');
    expect((await db.caseReplace(kase, {})).status).toBe(400);
    // Mutación: comparar solo `cardId` ⇒ la de otro acabado se acepta.
  });

  it('PS-23 💰 — una pieza, un caso: dos casos reponen la MISMA candidata a la vez (N≥10) ⇒ exactamente uno 200; y reponer vs una COMPRA de la misma `listed` (N≥10) ⇒ nunca los dos', async () => {
    const outcomes: string[] = [];
    let inter = 0;
    for (let i = 0; i < N; i += 1) {
      const a = await mkWithdrawalCase({ name: `PS23a ${i}` });
      const b = await mkWithdrawalCase({ name: `PS23b ${i}` });
      for (const f of [a, b]) {
        await db.mark(f.w.shipment.id, f.line(0).id, { status: 'missing', missingReason: 'not_found' });
        await db.mark(f.w.shipment.id, f.line(1).id, { status: 'picked' });
        await db.prepare(f.w.shipment.id, 0);
      }
      const ca = (await h.prisma.replacementCase.findFirstOrThrow({ where: { shipmentRequestId: a.w.shipment.id } })).id;
      const cb = (await h.prisma.replacementCase.findFirstOrThrow({ where: { shipmentRequestId: b.w.shipment.id } })).id;
      const cand = await db.mkPiece({ status: 'in_stock' });
      const r = await db.forced(
        () => db.holdRow('InventoryItem', cand.id),
        () => db.caseReplace(ca, { inventoryItemId: cand.id }),
        () => db.caseReplace(cb, { inventoryItemId: cand.id }),
      );
      if (r.interleaved) inter += 1;
      const piece = await db.piece(cand.id);
      const wins = [r.a, r.b].filter((x) => x.status === 200).length;
      const lose = [r.a, r.b].filter((x) => x.status === 422 && x.body.error.details.reason === 'not_platform_available').length;
      outcomes.push(`${code(r.a)},${code(r.b)},owner=${piece.ownerUserId === a.u.id ? 'a' : piece.ownerUserId === b.u.id ? 'b' : 'none'}${wins === 1 && lose === 1 ? '' : ',VIOLATION'}`);
    }
    expect(report('PS-23-cases', outcomes, (o) => !o.includes('VIOLATION'))).toBe(N);
    expect(inter).toBe(N);
    // reponer vs compra (la reserva del checkout: CAS `listed → reserved` con el estado en el WHERE, REL-B)
    const outcomes2: string[] = [];
    let inter2 = 0;
    for (let i = 0; i < N; i += 1) {
      const f = await mkWithdrawalCase({ name: `PS23c ${i}` });
      await db.mark(f.w.shipment.id, f.line(0).id, { status: 'missing', missingReason: 'not_found' });
      await db.mark(f.w.shipment.id, f.line(1).id, { status: 'picked' });
      await db.prepare(f.w.shipment.id, 0);
      const kase = (await h.prisma.replacementCase.findFirstOrThrow({ where: { shipmentRequestId: f.w.shipment.id } })).id;
      const cand = await db.mkPiece({ status: 'listed' });
      const buyer = await db.mkUser(`Comprador ${i}`);
      const buy = async (): Promise<R> => {
        const n = await h.prisma.$transaction(async (tx) => {
          const res = await tx.inventoryItem.updateMany({
            where: { id: cand.id, ownerType: 'platform', status: 'listed' },
            data: { status: 'reserved', ownerType: 'customer', ownerUserId: buyer.id, ownershipStatus: 'pending' },
          });
          return res.count;
        });
        return { status: n === 1 ? 200 : 409, body: { outcome: n === 1 ? 'reserved' : undefined, error: n === 1 ? undefined : { code: 'NOT_AVAILABLE' } } };
      };
      const r = await db.forced(() => db.holdRow('InventoryItem', cand.id), () => db.caseReplace(kase, { inventoryItemId: cand.id }), buy);
      if (r.interleaved) inter2 += 1;
      const piece = await db.piece(cand.id);
      const both = r.a.status === 200 && r.b.status === 200;
      outcomes2.push(`${code(r.a)},${code(r.b)},piece=${piece.status}/${piece.ownerUserId === f.u.id ? 'case' : piece.ownerUserId === buyer.id ? 'buyer' : 'none'}${both ? ',VIOLATION' : ''}`);
    }
    expect(report('PS-23-buy', outcomes2, (o) => !o.includes('VIOLATION'))).toBe(N);
    expect(inter2).toBe(N);
    // Mutación: quitar `status IN (in_stock, listed)` del WHERE del CAS de la candidata ⇒ los dos en ≥1 tirada.
  });

  it('PS-24 💰 — efectos: retiro `picking` ⇒ línea nueva `picked`, original a PLATAFORMA (`lost`, movimiento con actor), repuesta `in_custody` del cliente, caso `replaced`; colocación ⇒ al cajón del cliente (o el que elija sin cajón)', async () => {
    const card24 = await db.mkCard(null, 'PS24');
    const f = await mkWithdrawalCase({ cardIds: [card24.id, card24.id] });
    await db.mark(f.w.shipment.id, f.line(0).id, { status: 'missing', missingReason: 'not_found' });
    await db.mark(f.w.shipment.id, f.line(1).id, { status: 'picked' });
    await db.prepare(f.w.shipment.id, 0);
    const kase = (await h.prisma.replacementCase.findFirstOrThrow({ where: { shipmentRequestId: f.w.shipment.id } })).id;
    const before = await db.caseGet(kase);
    expect(before.body).toMatchObject({ destination: 'package', candidateCount: 0, status: 'open', overdue: false, refundContext: null, manualRefunds: null });
    const cand = await db.mkPiece({ status: 'listed', cardId: card24.id });
    expect((await db.caseGet(kase)).body.candidateCount).toBe(1);
    const r = await db.caseReplace(kase, { inventoryItemId: cand.id, locationId: 'ignorado' });
    expect(r.status).toBe(200);
    expect(r.body.outcome).toBe('replaced');
    expect(r.body.case).toMatchObject({ status: 'replaced', replacement: { inventoryItemId: cand.id, folio: cand.folio }, resolvedBy: { userId: db.operatorId } });
    expect(r.body.preparation).toMatchObject({ status: 'prepared', openReplacements: 0, picked: 2 });
    const lines = await h.prisma.shipmentItem.findMany({ where: { shipmentRequestId: f.w.shipment.id } });
    expect(lines).toHaveLength(3);
    const newLine = lines.find((l) => l.inventoryItemId === cand.id)!;
    expect(newLine).toMatchObject({ prepStatus: 'picked', prepMarkedByUserId: db.operatorId });
    expect((await db.kase(kase)).replacementShipmentItemId).toBe(newLine.id);
    expect(await db.piece(f.vo.pieces[0].id)).toMatchObject({ status: 'lost', ownerType: 'platform', ownerUserId: null, ownershipStatus: null });
    expect(await db.piece(cand.id)).toMatchObject({ status: 'in_custody', ownerType: 'customer', ownerUserId: f.u.id, ownershipStatus: 'settled', locationId: db.shopLocationId });
    const mv = await db.movements([f.vo.pieces[0].id, cand.id]);
    expect(mv.filter((m) => m.reason === 'replacement')).toHaveLength(2);
    expect(mv.filter((m) => m.reason === 'replacement').every((m) => m.actorUserId === db.operatorId)).toBe(true);
    expect((await db.audits(kase, 'replacement_case.replaced'))).toHaveLength(1);
    // doble clic ⇒ 200 already_resolved; otra pieza ⇒ 409 CASE_NOT_OPEN
    expect((await db.caseReplace(kase, { inventoryItemId: cand.id })).body.outcome).toBe('already_resolved');
    const other = await db.mkPiece({ status: 'in_stock', cardId: card24.id });
    const again = await db.caseReplace(kase, { inventoryItemId: other.id });
    expect(again.status).toBe(409);
    expect(again.body.error).toMatchObject({ code: 'CASE_NOT_OPEN', details: { status: 'replaced' } });
    // ⛔ cero dinero
    expect(await db.refunds({ OR: [{ shipmentRequestId: f.w.shipment.id }, { orderId: f.vo.order.id }] })).toHaveLength(0);

    // Colocación ⇒ destino `drawer`: sin cajón ⇒ 422 location_required; cajón del cliente ⇒ la repuesta va ahí.
    const s = await mkSpei(null);
    const c2 = await db.mkPiece({ status: 'in_stock', cardId: s.card.id });
    expect((await db.caseGet(s.caseId)).body.destination).toBe('drawer');
    const noLoc = await db.caseReplace(s.caseId, { inventoryItemId: c2.id });
    expect(noLoc.status).toBe(422);
    expect(noLoc.body.error).toMatchObject({ code: 'LOCATION_NOT_AVAILABLE', details: { reason: 'location_required' } });
    const otherDrawer = await db.mkDrawer();
    const wrong = await db.caseReplace(s.caseId, { inventoryItemId: c2.id, locationId: otherDrawer.id });
    expect(wrong.status).toBe(422);
    expect(wrong.body.error.details.reason).toBe('not_customer_drawer');
    const ok = await db.caseReplace(s.caseId, { inventoryItemId: c2.id, locationId: s.drawer.id });
    expect(ok.status).toBe(200);
    expect(ok.body.outcome).toBe('replaced');
    expect(ok.body.preparation).toBeUndefined();
    expect(await db.piece(c2.id)).toMatchObject({ status: 'in_custody', ownerType: 'customer', ownerUserId: s.u.id, locationId: s.drawer.id });
    expect((await db.piece(s.piece.id)).ownerType).toBe('platform');
    // Mutación: dejar la original a nombre del cliente ⇒ `ownerType` sigue `customer`.
  });

  it('PS-25 — «apareció»: caso `not_found` + la MISMA pieza ⇒ `found`, `lost → in_custody` del cliente, la línea vuelve a `picked`; caso `damaged` + la misma pieza ⇒ 422 same_piece_damaged', async () => {
    const f = await mkWithdrawalCase();
    await db.mark(f.w.shipment.id, f.line(0).id, { status: 'missing', missingReason: 'not_found' });
    await db.mark(f.w.shipment.id, f.line(1).id, { status: 'missing', missingReason: 'damaged' });
    await db.prepare(f.w.shipment.id, 0);
    const cases = await h.prisma.replacementCase.findMany({ where: { shipmentRequestId: f.w.shipment.id } });
    const cNF = cases.find((c) => c.missingReason === 'not_found')!;
    const cDM = cases.find((c) => c.missingReason === 'damaged')!;
    const r = await db.caseReplace(cNF.id, { inventoryItemId: f.vo.pieces[0].id });
    expect(r.status).toBe(200);
    expect(r.body.outcome).toBe('found');
    expect(await db.piece(f.vo.pieces[0].id)).toMatchObject({ status: 'in_custody', ownerType: 'customer', ownerUserId: f.u.id });
    expect(await h.prisma.shipmentItem.findUniqueOrThrow({ where: { id: f.line(0).id } })).toMatchObject({ prepStatus: 'picked', missingReason: null });
    // `replacementShipmentItemId` solo con `replaced` (CHECK M-61 `replacement_line_chk`): la línea que vuelve es la MISMA.
    expect((await db.kase(cNF.id))).toMatchObject({ status: 'found', replacementInventoryItemId: f.vo.pieces[0].id, replacementShipmentItemId: null });
    const bad = await db.caseReplace(cDM.id, { inventoryItemId: f.vo.pieces[1].id });
    expect(bad.status).toBe(422);
    expect(bad.body.error.details).toEqual({ reason: 'same_piece_damaged' });
    expect((await db.piece(f.vo.pieces[1].id)).status).toBe('damaged');
    // Mutación: permitir `found` con `damaged` ⇒ 200 aquí.
  });

  // ================================================================ PS-26 / PS-27 / PS-30 / PS-31 / PS-32 — el monto capturado

  it('PS-26 💰 — monto capturado todo por Stripe: A = Q+10000 ⇒ UNA fila `case_refund` con los componentes de `item_missing` + compensación 10000; cero SPEI; el caso congela sus referencias; operador 403; cuerpos malos 400', async () => {
    const s = await mkSpei(60000);
    const ctx = await db.caseGet(s.caseId, db.adminToken);
    expect(ctx.body.refundContext).toMatchObject({ available: true, paidReferenceCents: Q, market: { cents: 60000, capturedDate: expect.any(String) }, referenceCents: 60000, confirmAboveCents: 120000, limitCents: 300000, stripeAvailableCents: 84617, closesShipment: false, customerHasClabe: false });
    expect((await db.caseGet(s.caseId, db.opToken)).body.refundContext).toBeNull();
    const A = Q + 10000;
    const pv = await db.casePreview(s.caseId, A);
    expect(pv.body).toMatchObject({ amountCents: A, confirmation: 'none', caseStripeCents: A, shipmentFeeCents: 0, stripeCents: A, manualCents: 0 });
    // operador ⇒ 403 MONEY_OUT_FORBIDDEN (auditado)
    const op = await db.caseRefund(s.caseId, refundBody(pv, A), db.opToken);
    expect(op.status).toBe(403);
    expect(op.body.error.code).toBe('MONEY_OUT_FORBIDDEN');
    // cuerpos malos ⇒ 400, cero escrituras
    for (const body of [
      { ...refundBody(pv, A), reason: undefined },
      { ...refundBody(pv, A), reason: 'ab' },
      { ...refundBody(pv, A), amountCents: 0 },
      { ...refundBody(pv, A), amountCents: -1 },
      { ...refundBody(pv, A), amountCents: 1.5 },
      { ...refundBody(pv, A), amountCents: '100' },
      { ...refundBody(pv, A), expectedStripeCents: -1 },
    ]) {
      expect((await db.caseRefund(s.caseId, body)).status).toBe(400);
    }
    expect((await db.kase(s.caseId)).status).toBe('open');
    expect(await db.refunds({ orderId: s.vo.order.id })).toHaveLength(0);
    const calls = h.stripe.refundCreateCalls.length;
    const r = await db.caseRefund(s.caseId, refundBody(pv, A));
    expect(r.status).toBe(200);
    expect(r.body.outcome).toBe('refunded');
    expect(r.body.manualRefunds).toEqual([]);
    expect(r.body.refunds).toHaveLength(1);
    const rows = await db.refunds({ orderId: s.vo.order.id });
    expect(rows).toHaveLength(1);
    const comp = itemMissingRefundComponents(s.vo.order, 50000);
    expect(rows[0]).toMatchObject({
      kind: 'case_refund',
      amountCents: A,
      merchandiseCents: comp.merchandiseCents,
      merchandiseIvaCents: comp.merchandiseIvaCents,
      processingFeeCents: comp.processingFeeCents,
      compensationCents: 10000,
      replacementCaseId: s.caseId,
      orderItemId: s.orderItem.id,
      reason: 'TCGplayer NM 2026-09-29',
      status: 'submitted',
    });
    expect(h.stripe.refundCreateCalls.length - calls).toBe(1);
    expect(h.stripe.refundCreateCalls[h.stripe.refundCreateCalls.length - 1]).toMatchObject({ paymentIntentId: s.vo.pi, amountCents: A, idempotencyKey: `case:${s.caseId}` });
    const k = await db.kase(s.caseId);
    expect(k).toMatchObject({ status: 'refunded', refundAmountCents: A, refundReason: 'TCGplayer NM 2026-09-29', refundPaidRefCents: Q, refundMarketRefCents: 60000, refundAboveRefConfirmed: false });
    expect(k.refundMarketRefDate).not.toBeNull();
    expect(await h.prisma.manualRefund.count({ where: { replacementCaseId: s.caseId } })).toBe(0);
    expect((await db.piece(s.piece.id)).ownerType).toBe('platform');
    expect(av12()).toHaveLength(1);
    expect(av14()).toHaveLength(0);
    // doble clic ⇒ 200 already_resolved con sus filas (sin comparar el cuerpo)
    const again = await db.caseRefund(s.caseId, refundBody(pv, 1));
    expect(again.status).toBe(200);
    expect(again.body.outcome).toBe('already_resolved');
    expect(again.body.refunds).toHaveLength(1);
    // El cliente lo ve en su pedido: «reembolsada» con el total capturado; ⛔ sin motivo ni referencias.
    const tok = await db.loginCustomer(s.u.email!);
    const od = await db.clientOrder(s.vo.order.id, tok);
    expect(od.status).toBe(200);
    expect(JSON.stringify(od.body)).not.toMatch(/TCGplayer|refundMarketRef|marketRef/);
    // Mutación: tomar el monto de `M` o de `Q` en vez del cuerpo ⇒ la fila no vale A.
  });

  it('PS-27 💰 — excedente ⇒ SPEI: remanente `max < A` ⇒ fila Stripe = max, ManualRefund = A − max, ±0 y componente a componente; carrera con un M3 total sobre la misma orden (N≥10): Σ Stripe ≤ total y Stripe + SPEI = A', async () => {
    const s = await mkSpei(60000);
    // Un reembolso previo por la otra carta (fixture: fila `item_missing` aceptada) deja `max = total − X`.
    const X = 20000;
    await h.prisma.paymentRefund.create({
      data: { idempotencyKey: `rest:fixture:${s.caseId}`, kind: 'order_remaining', orderId: s.vo.order.id, amountCents: X, merchandiseCents: X, merchandiseIvaCents: X - Math.floor(X / 1.16), shippingCents: 0, shippingIvaCents: 0, processingFeeCents: 0, status: 'succeeded', stripeRefundId: `re_fix_${s.caseId}`, requestedByUserId: db.adminId, requestedByRole: 'super_admin', submittedAt: new Date(), succeededAt: new Date() },
    });
    const max = s.vo.order.totalCents - X;
    const A = Q + 40000; // 92885 > max = 64617
    expect(A).toBeGreaterThan(max);
    const pv = await db.casePreview(s.caseId, A);
    expect(pv.body).toMatchObject({ stripeAvailableCents: max, caseStripeCents: max, manualCents: A - max, stripeCents: max, confirmation: 'none' });
    await db.mkKyc(s.u.id, CLABE_A);
    const r = await db.caseRefund(s.caseId, refundBody(pv, A));
    expect(r.status).toBe(200);
    const stripeRow = (await db.refunds({ replacementCaseId: s.caseId }))[0];
    const manual = await db.manualRows({ replacementCaseId: s.caseId });
    expect(stripeRow.amountCents).toBe(max);
    expect(manual).toHaveLength(1);
    expect(manual[0]).toMatchObject({ source: 'case_excess', status: 'pending', amountCents: A - max, orderId: s.vo.order.id, customerUserId: s.u.id, idempotencyKey: `case-spei:${s.caseId}` });
    expect(stripeRow.amountCents + manual[0].amountCents).toBe(A);
    const ctx = caseRefundContextOf(s.vo.order, 50000);
    const compA = caseRefundComponents(A, ctx);
    for (const c of ['merchandiseCents', 'merchandiseIvaCents', 'processingFeeCents', 'compensationCents'] as const) {
      expect(stripeRow[c] + manual[0][c]).toBe(compA[c]);
      expect(manual[0][c]).toBeGreaterThanOrEqual(0);
    }
    expect(h.stripe.refundCreateCalls[h.stripe.refundCreateCalls.length - 1].amountCents).toBe(max);
    expect(av12()).toHaveLength(1);
    expect(av14()).toHaveLength(1);
    expect(av14()[0].text + av14()[0].html).not.toContain(CLABE_A);
    expect(av14()[0].text).toContain('4567');
    expect(r.body.manualRefunds[0]).toMatchObject({ status: 'pending', clabeOnFile: true, clabeMasked: '**************4567' });

    // Carrera: reembolso del caso vs M3 total sobre la MISMA orden (barrera en la fila `Order`).
    const outcomes: string[] = [];
    let inter = 0;
    for (let i = 0; i < N; i += 1) {
      const t = await mkSpei(60000, { name: `PS27 ${i}` });
      const a = Q + 10000;
      const pvi = await db.casePreview(t.caseId, a);
      const res = await db.forced(
        () => db.holdRow('Order', t.vo.order.id),
        () => db.caseRefund(t.caseId, refundBody(pvi, a)),
        () => db.m3Refund(t.vo.order.id, { reason: 'carrera', confirmPiecesWithCustomer: true }),
      );
      if (res.interleaved) inter += 1;
      const rows = await db.refunds({ orderId: t.vo.order.id, status: { not: 'failed' } });
      const sum = rows.reduce((acc, x) => acc + x.amountCents, 0);
      const k = await db.kase(t.caseId);
      const caseStripe = rows.filter((x) => x.replacementCaseId === t.caseId).reduce((acc, x) => acc + x.amountCents, 0);
      const caseSpei = (await db.manualRows({ replacementCaseId: t.caseId })).reduce((acc, x) => acc + x.amountCents, 0);
      const ok = sum <= t.vo.order.totalCents && (k.status !== 'refunded' || caseStripe + caseSpei === a);
      outcomes.push(`${code(res.a)},${code(res.b)},Σ=${sum}/${t.vo.order.totalCents},case=${k.status}${ok ? '' : ',VIOLATION'}`);
    }
    expect(report('PS-27', outcomes, (o) => !o.includes('VIOLATION'))).toBe(N);
    expect(inter).toBe(N);
    // El OTRO orden (PS-27b): el M3 total se encola PRIMERO; el reembolso del caso tiene que LEER el estado de la orden
    // DESPUÉS del candado (ya `refunded`/cerrada ⇒ 409 CASE_ORIGIN_NOT_SETTLED o CONFLICT), nunca con la lectura caduca
    // `settled` de antes de la barrera. Σ Stripe ≤ total y el caso NO queda `refunded`.
    const outcomesB: string[] = [];
    let interB = 0;
    for (let i = 0; i < N; i += 1) {
      const t = await mkSpei(60000, { name: `PS27b ${i}` });
      const a = Q + 10000;
      const pvi = await db.casePreview(t.caseId, a);
      const res = await db.forced(
        () => db.holdRow('Order', t.vo.order.id),
        () => db.m3Refund(t.vo.order.id, { reason: 'carrera b', confirmPiecesWithCustomer: true }),
        () => db.caseRefund(t.caseId, refundBody(pvi, a)),
      );
      if (res.interleaved) interB += 1;
      const rows = await db.refunds({ orderId: t.vo.order.id, status: { not: 'failed' } });
      const sum = rows.reduce((acc, x) => acc + x.amountCents, 0);
      const k = await db.kase(t.caseId);
      const caseRows = rows.filter((x) => x.replacementCaseId === t.caseId).length + (await db.manualRows({ replacementCaseId: t.caseId })).length;
      const ok = res.a.status < 300 && res.b.status >= 400 && sum <= t.vo.order.totalCents && k.status !== 'refunded' && caseRows === 0;
      outcomesB.push(`${code(res.a)},${code(res.b)},Σ=${sum}/${t.vo.order.totalCents},case=${k.status}${ok ? '' : ',VIOLATION'}`);
      if (k.status === 'open') await db.caseVoid(t.caseId, { note: 'carrera b: orden devuelta entera' });
    }
    expect(report('PS-27b', outcomesB, (o) => !o.includes('VIOLATION'))).toBe(N);
    expect(interB).toBe(N);
    // DOS casos de la MISMA orden (PS-27c): cada reembolso calcula su plan (`stripeAvailable = total − devuelto`) BAJO
    // el candado de la orden; el segundo ve las filas del primero ⇒ su vista previa caduca (409 REFUND_PREVIEW_STALE) y
    // Σ Stripe ≤ total. Es el orden que muerde quitar el `FOR UPDATE` de la orden: los dos verían «nada devuelto».
    const outcomesC: string[] = [];
    let interC = 0;
    for (let i = 0; i < N; i += 1) {
      const u = await db.mkUser(`PS27c ${i}`);
      const drawer = await db.mkDrawer();
      const card = await db.mkCard(60000);
      const vo = await db.mkVaultOrder(u.id, { prices: [50000, 30000, 10000], placement: 'pending', locationId: drawer.id, cardIds: [card.id, card.id, card.id] });
      const placement = vo.placement!;
      const items = await h.prisma.vaultPlacementItem.findMany({ where: { placementId: placement.id } });
      const missing = items.filter((it) => it.inventoryItemId !== vo.pieces[2].id);
      const picked = items.find((it) => it.inventoryItemId === vo.pieces[2].id)!;
      for (const it of missing) expect((await db.vpMark(placement.id, it.id, { status: 'missing', missingReason: 'not_found' })).status).toBe(200);
      expect((await db.vpMark(placement.id, picked.id, { status: 'picked' })).status).toBe(200);
      expect((await db.vpPrepare(placement.id)).status).toBe(200);
      const conf = await db.vpConfirm(placement.id, { locationId: drawer.id });
      expect(conf.status).toBe(200);
      const caseIds: string[] = conf.body.items.filter((x: any) => x.result === 'missing').map((x: any) => x.caseId);
      expect(caseIds).toHaveLength(2);
      const a = 60000; // = referencia (max(pagado, mercado)); a + a > total ⇒ el segundo NO cabe entero en Stripe
      const p1 = await db.casePreview(caseIds[0], a);
      const p2 = await db.casePreview(caseIds[1], a);
      expect(p1.body.stripeCents).toBe(a);
      expect(p2.body.stripeCents).toBe(a);
      const res = await db.forced(
        () => db.holdRow('Order', vo.order.id),
        () => db.caseRefund(caseIds[0], refundBody(p1, a)),
        () => db.caseRefund(caseIds[1], refundBody(p2, a)),
      );
      if (res.interleaved) interC += 1;
      const rows = await db.refunds({ orderId: vo.order.id, status: { not: 'failed' } });
      const sum = rows.reduce((acc, x) => acc + x.amountCents, 0);
      const wins = [res.a, res.b].filter((x) => x.status === 200).length;
      const ok = sum <= vo.order.totalCents && wins === 1;
      outcomesC.push(`${code(res.a)},${code(res.b)},Σ=${sum}/${vo.order.totalCents}${ok ? '' : ',VIOLATION'}`);
      for (const id of caseIds) if ((await db.kase(id)).status === 'open') await db.caseVoid(id, { note: 'carrera c: no cupo' });
    }
    expect(report('PS-27c', outcomesC, (o) => !o.includes('VIOLATION'))).toBe(N);
    expect(interC).toBe(N);
    // Mutación: quitar el candado de fila `Order` del verbo ⇒ PS-27c: Σ Stripe > total (los dos 200) en ≥1 tirada.
  });

  it('PS-27d 💰 — contracargo (`charge.dispute.created`) de la orden de origen encolado PRIMERO reteniendo `Order` (sin fila del libro ni tocar la pieza del caso); el reembolso del caso decide DESPUÉS del candado (N≥10) ⇒ 409 CASE_ORIGIN_NOT_SETTLED, cero `case_refund`, cero SPEI, cero Stripe', async () => {
    // Techlead R1 sobre `c20451f`: `lockCase` lee la orden ANTES de esperar nada; el webhook de disputa de bóveda cambia
    // `Order.status` SIN fila `PaymentRefund` (la vista previa no caduca) y SIN tocar la pieza `lost` del caso (no entra
    // en su `updateMany`), así que ni la puerta del cliente ni las piezas serializan: SOLO la relectura bajo el
    // `FOR UPDATE` de `Order` (`lockOriginOrder`) evita `case_refund`/SPEI sobre un cargo disputado. Mutación M12
    // (quitar esa relectura en `refund`) ⇒ el caso queda `refunded` con fila y la orden `chargeback`: 0/10.
    const outcomes: string[] = [];
    let inter = 0;
    for (let i = 0; i < N; i += 1) {
      const t = await mkSpei(60000, { name: `PS27d ${i}` });
      const a = Q + 10000;
      const pvi = await db.casePreview(t.caseId, a);
      expect(pvi.body.stripeCents).toBe(a);
      const calls = h.stripe.refundCreateCalls.length;
      const dispute = () => h.sendStripeWebhook({ type: 'charge.dispute.created', data: { object: { object: 'dispute', payment_intent: t.vo.pi } } });
      const res = await db.forced(
        () => db.holdRow('Order', t.vo.order.id),
        dispute,
        () => db.caseRefund(t.caseId, refundBody(pvi, a)),
      );
      if (res.interleaved) inter += 1;
      const order = await db.order(t.vo.order.id);
      const rows = await db.refunds({ orderId: t.vo.order.id, status: { not: 'failed' } });
      const manual = await db.manualRows({ replacementCaseId: t.caseId });
      const k = await db.kase(t.caseId);
      const stripeCalls = h.stripe.refundCreateCalls.length - calls;
      const ok =
        res.a.status === 200 &&
        order.status === 'chargeback' &&
        res.b.status === 409 &&
        res.b.body?.error?.code === 'CASE_ORIGIN_NOT_SETTLED' &&
        rows.length === 0 &&
        manual.length === 0 &&
        stripeCalls === 0 &&
        k.status === 'open';
      outcomes.push(`${code(res.a)},${code(res.b)},order=${order.status},case=${k.status},rows=${rows.length},spei=${manual.length},stripe=${stripeCalls}${ok ? '' : ',VIOLATION'}`);
      if (k.status === 'open') await db.caseVoid(t.caseId, { note: 'carrera d: contracargo' });
    }
    expect(report('PS-27d', outcomes, (o) => !o.includes('VIOLATION'))).toBe(N);
    expect(inter).toBe(N);
  });

  it('PS-36b — `void` vs `reclaim-vault` sobre la misma orden `vault` ya `refunded` (sellada por el webhook), barrera en la PIEZA del caso (N≥10): `void` toma piezas → orden como todos ⇒ cero interbloqueos (`pg_stat_database.deadlocks` no sube), nunca 5xx; los dos 200 y el caso `voided`', async () => {
    // Techlead R2 sobre `c20451f`: `void` tomaba `Order` (paso 3: «viable», la orden ya no está `settled`) y DESPUÉS la
    // pieza; `reclaim-vault`/`unprepare`/M3 toman las piezas y DESPUÉS `Order`. Con el reclamo encolado primero en la
    // pieza y `void` ya dueño de `Order` ⇒ `40P01` ⇒ uno de los dos `503 BUSY_TRY_AGAIN`. Con el orden normativo
    // (piezas → orden), el reclamo pasa y `void` anula. (M3 no sirve de rival: sobre una orden no `settled` contesta
    // 422 antes de tomar candado alguno, y sobre una `settled` es `void` quien contesta 409 antes de tomar la pieza.)
    // Mutación: devolver `void` a `Order → piezas` ⇒ `deadlocks` sube y aparece un 503 en ≥1 tirada.
    const deadlocks = async () => Number((await h.prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT deadlocks AS n FROM pg_stat_database WHERE datname = current_database()`))[0].n);
    const before = await deadlocks();
    const outcomes: string[] = [];
    let inter = 0;
    for (let i = 0; i < N; i += 1) {
      const t = await mkSpei(60000, { name: `PS36b ${i}` });
      // `charge.refunded` total desde el panel de Stripe: la orden queda `refunded` y sellada; la pieza del caso (`open_case`) no se toca.
      expect((await db.chargeRefunded(t.vo.pi, t.vo.order.totalCents)).status).toBe(200);
      const o0 = await db.order(t.vo.order.id);
      expect(o0.status).toBe('refunded');
      expect(o0.fullRefundClosedAt).not.toBeNull();
      const res = await db.forced(
        () => db.holdRow('InventoryItem', t.piece.id),
        () => db.reclaimVault(t.vo.order.id, { note: 'carrera void' }), // A: piezas → Order, PRIMERO en la cola
        () => db.caseVoid(t.caseId, { note: 'carrera void' }), // B: con el orden viejo llega sosteniendo `Order`
      );
      if (res.interleaved) inter += 1;
      const k = await db.kase(t.caseId);
      const piece = await db.piece(t.piece.id);
      const no5xx = res.a.status < 500 && res.b.status < 500;
      const ok = no5xx && res.a.status === 200 && res.b.status === 200 && k.status === 'voided' && piece.ownerType === 'platform' && piece.status === 'lost';
      outcomes.push(`${code(res.a)},${code(res.b)},case=${k.status},piece=${piece.status}/${piece.ownerType}${ok ? '' : ',VIOLATION'}`);
      if (k.status === 'open') await db.caseVoid(t.caseId, { note: 'carrera void: limpieza' });
    }
    // Las estadísticas se vuelcan con retraso (≤ 1 s en PG ≥ 15): se espera antes de leer el contador.
    await new Promise((r) => setTimeout(r, 1500));
    const delta = (await deadlocks()) - before;
    // eslint-disable-next-line no-console
    console.log(`[PS-RACE PS-36b] deadlocks Δ=${delta}`);
    expect(report('PS-36b', outcomes, (o) => !o.includes('VIOLATION'))).toBe(N);
    expect(inter).toBe(N);
    expect(delta).toBe(0);
  });

  it('PS-30 💰 — remanente 0 ⇒ todo a SPEI: cero filas del libro, cero Stripe, un ManualRefund = A con comp(A); el caso queda `refunded`', async () => {
    const s = await mkSpei(60000);
    await h.prisma.paymentRefund.create({
      data: { idempotencyKey: `full:fixture:${s.caseId}`, kind: 'order_full', orderId: s.vo.order.id, amountCents: s.vo.order.totalCents, merchandiseCents: 80000, merchandiseIvaCents: 80000 - Math.floor(80000 / 1.16), shippingCents: 0, shippingIvaCents: 0, processingFeeCents: 4617, status: 'succeeded', stripeRefundId: `re_full_${s.vo.order.id}`, requestedByUserId: db.adminId, requestedByRole: 'super_admin', submittedAt: new Date(), succeededAt: new Date() },
    });
    const A = Q;
    const pv = await db.casePreview(s.caseId, A);
    expect(pv.body).toMatchObject({ stripeAvailableCents: 0, caseStripeCents: 0, stripeCents: 0, manualCents: A });
    const calls = h.stripe.refundCreateCalls.length;
    const r = await db.caseRefund(s.caseId, refundBody(pv, A));
    expect(r.status).toBe(200);
    expect(h.stripe.refundCreateCalls.length).toBe(calls);
    expect(await db.refunds({ replacementCaseId: s.caseId })).toHaveLength(0);
    const manual = await db.manualRows({ replacementCaseId: s.caseId });
    const comp = caseRefundComponents(A, caseRefundContextOf(s.vo.order, 50000));
    expect(manual).toHaveLength(1);
    expect(manual[0]).toMatchObject({ amountCents: A, merchandiseCents: comp.merchandiseCents, merchandiseIvaCents: comp.merchandiseIvaCents, processingFeeCents: comp.processingFeeCents, compensationCents: 0 });
    expect((await db.kase(s.caseId)).status).toBe('refunded');
    expect(av12()).toHaveLength(0);
    expect(av14()).toHaveLength(1);
    // sin CLABE: el aviso pide registrarla
    expect(av14()[0].text).toMatch(/regístrala|CLABE/i);
    // Mutación: tope de Stripe = Q en vez de `max` ⇒ crea una fila que Stripe rechaza.
  });

  it('PS-31 💰 — topes de captura: 2R sin confirmar; 2R+1 ⇒ 422 CONFIRMATION_REQUIRED; con `true` ⇒ 200 y `refundAboveRefConfirmed`; kR+1 ⇒ 422 ABOVE_LIMIT; dial a 6 ⇒ 200; M=3Q y A=4Q ⇒ 200 sin confirmar; sin mercado ⇒ R=Q', async () => {
    // R = max(Q, M) con M = 60000 > Q
    const a = await mkSpei(60000);
    const R = 60000;
    let pv = await db.casePreview(a.caseId, 2 * R);
    expect(pv.body.confirmation).toBe('none');
    expect((await db.caseRefund(a.caseId, refundBody(pv, 2 * R))).status).toBe(200);
    const b = await mkSpei(60000);
    pv = await db.casePreview(b.caseId, 2 * R + 1);
    expect(pv.body.confirmation).toBe('reinforced');
    const need = await db.caseRefund(b.caseId, refundBody(pv, 2 * R + 1));
    expect(need.status).toBe(422);
    expect(need.body.error).toMatchObject({ code: 'CASE_REFUND_CONFIRMATION_REQUIRED', details: { referenceCents: R, confirmAboveCents: 2 * R, limitCents: 5 * R } });
    expect((await db.kase(b.caseId)).status).toBe('open');
    expect(await db.refunds({ orderId: b.vo.order.id })).toHaveLength(0);
    const okb = await db.caseRefund(b.caseId, refundBody(pv, 2 * R + 1, { confirmAboveReference: true }));
    expect(okb.status).toBe(200);
    expect((await db.kase(b.caseId)).refundAboveRefConfirmed).toBe(true);
    const c = await mkSpei(60000);
    pv = await db.casePreview(c.caseId, 5 * R + 1);
    expect(pv.body.confirmation).toBe('blocked');
    const over = await db.caseRefund(c.caseId, refundBody(pv, 5 * R + 1, { confirmAboveReference: true }));
    expect(over.status).toBe(422);
    expect(over.body.error).toMatchObject({ code: 'CASE_REFUND_ABOVE_LIMIT', details: { referenceCents: R, limitCents: 5 * R } });
    await setK(6);
    pv = await db.casePreview(c.caseId, 5 * R + 1);
    expect(pv.body).toMatchObject({ confirmation: 'reinforced', limitCents: 6 * R });
    expect((await db.caseRefund(c.caseId, refundBody(pv, 5 * R + 1, { confirmAboveReference: true }))).status).toBe(200);
    await setK(5);
    // M = 3Q ⇒ 4Q ≤ 2R
    const d = await mkSpei(3 * Q);
    pv = await db.casePreview(d.caseId, 4 * Q);
    expect(pv.body).toMatchObject({ referenceCents: 3 * Q, confirmation: 'none' });
    expect((await db.caseRefund(d.caseId, refundBody(pv, 4 * Q))).status).toBe(200);
    // sin mercado ⇒ R = Q
    const e = await mkSpei(null);
    pv = await db.casePreview(e.caseId);
    expect(pv.body).toMatchObject({ amountCents: null, market: null, referenceCents: Q, confirmAboveCents: 2 * Q, limitCents: 5 * Q, confirmation: null, stripeCents: null, manualCents: null });
    pv = await db.casePreview(e.caseId, 2 * Q + 1);
    expect(pv.body.confirmation).toBe('reinforced');
    // Mutación: `R = Q` (ignorar el mercado) ⇒ 4Q pide confirmación; `k` fijo en código ⇒ el dial no surte.
  });

  it('PS-32 💰 — paridad preview ↔ verbo para 20 montos; `expected*` distinto ⇒ 409 REFUND_PREVIEW_STALE con las cifras del servidor; un reembolso parcial entre preview y POST ⇒ 409 con las nuevas', async () => {
    const s = await mkSpei(60000);
    const X = 30000;
    await h.prisma.paymentRefund.create({
      data: { idempotencyKey: `rest:fixture32:${s.caseId}`, kind: 'order_remaining', orderId: s.vo.order.id, amountCents: X, merchandiseCents: X, merchandiseIvaCents: X - Math.floor(X / 1.16), shippingCents: 0, shippingIvaCents: 0, processingFeeCents: 0, status: 'succeeded', stripeRefundId: `re_fix32_${s.caseId}`, requestedByUserId: db.adminId, requestedByRole: 'super_admin', submittedAt: new Date(), succeededAt: new Date() },
    });
    const max = s.vo.order.totalCents - X;
    const R = 60000;
    const amounts = [1, 100, Q - 1, Q, Q + 1, max - 1, max, max + 1, 2 * R - 1, 2 * R, 2 * R + 1, 3 * R, 5 * R, 5 * R + 1, 70000, 80000, 90000, 99999, 123456, 2147483647];
    for (const A of amounts) {
      const pv = await db.casePreview(s.caseId, A);
      expect(pv.status).toBe(200);
      const stripe = Math.min(A, max);
      expect(pv.body).toMatchObject({ amountCents: A, stripeCents: stripe, manualCents: A - stripe, confirmation: A <= 2 * R ? 'none' : A <= 5 * R ? 'reinforced' : 'blocked' });
      // el verbo con cifras STALE ⇒ 409 con las del servidor (cero escrituras). Los topes (paso 7) van ANTES del
      // paso 9: por encima de 2R hay que confirmar; por encima de kR es 422 y nunca llega al 409.
      const stale = await db.caseRefund(s.caseId, { amountCents: A, reason: 'paridad', expectedStripeCents: stripe + 1, expectedManualCents: Math.max(0, A - stripe - 1), confirmAboveReference: A > 2 * R });
      if (A <= 5 * R) {
        expect(stale.status).toBe(409);
        expect(stale.body.error).toMatchObject({ code: 'REFUND_PREVIEW_STALE', details: { stripeCents: stripe, manualCents: A - stripe } });
      } else {
        expect(stale.status).toBe(422);
        expect(stale.body.error.code).toBe('CASE_REFUND_ABOVE_LIMIT');
      }
      expect((await db.kase(s.caseId)).status).toBe('open');
    }
    expect(await db.refunds({ replacementCaseId: s.caseId })).toHaveLength(0);
    // entre preview y POST cambia `max`
    const A = Q;
    const pv = await db.casePreview(s.caseId, A);
    await h.prisma.paymentRefund.update({ where: { idempotencyKey: `rest:fixture32:${s.caseId}` }, data: { amountCents: X + 10000, merchandiseCents: X + 10000 } });
    const r = await db.caseRefund(s.caseId, refundBody(pv, A));
    expect(r.status).toBe(409);
    expect(r.body.error).toMatchObject({ code: 'REFUND_PREVIEW_STALE', details: { stripeCents: Math.min(A, max - 10000), manualCents: A - Math.min(A, max - 10000) } });
    // Mutación: ignorar `expectedManualCents` ⇒ el 409 no sale.
  });

  // ================================================================ PS-28 — el cierre del retiro por el apartado

  it('PS-28 💰 — retiro con TODAS faltantes: reembolsar el último caso ⇒ en el mismo acto `shipment_fee` + `cancelado` + AV-12 de las dos filas; reponer una ⇒ ni cierre ni fee; todo por SPEI cierra igual', async () => {
    const f = await mkWithdrawalCase();
    await db.mark(f.w.shipment.id, f.line(0).id, { status: 'missing', missingReason: 'not_found' });
    await db.mark(f.w.shipment.id, f.line(1).id, { status: 'missing', missingReason: 'damaged' });
    await db.prepare(f.w.shipment.id, 0);
    const cases = await h.prisma.replacementCase.findMany({ where: { shipmentRequestId: f.w.shipment.id }, orderBy: { openedAt: 'asc' } });
    const c0 = cases.find((c) => c.originalInventoryItemId === f.vo.pieces[0].id)!;
    const c1 = cases.find((c) => c.originalInventoryItemId === f.vo.pieces[1].id)!;
    // primer caso: NO cierra (queda otro abierto)
    const pv0 = await db.casePreview(c0.id, 10000);
    expect(pv0.body).toMatchObject({ closesShipment: false, shipmentFeeCents: 0, stripeCents: 10000 });
    bandeja = [];
    const r0 = await db.caseRefund(c0.id, refundBody(pv0, 10000));
    expect(r0.status).toBe(200);
    expect(r0.body.shipment).toEqual({ status: 'picking', closed: false });
    expect((await db.shipment(f.w.shipment.id)).status).toBe('picking');
    expect(await db.refunds({ shipmentRequestId: f.w.shipment.id })).toHaveLength(0);
    expect(av12()).toHaveLength(1);
    // último caso: cierra ⇒ `shipment_fee` (21405, el cobro del retiro) + `cancelado`
    const pv1 = await db.casePreview(c1.id, 5000);
    expect(pv1.body).toMatchObject({ closesShipment: true, shipmentFeeCents: 21405, caseStripeCents: 5000, stripeCents: 26405 });
    bandeja = [];
    const r1 = await db.caseRefund(c1.id, refundBody(pv1, 5000));
    expect(r1.status).toBe(200);
    expect(r1.body.shipment).toEqual({ status: 'cancelado', closed: true });
    expect(r1.body.refunds.map((x: any) => x.kind).sort()).toEqual(['case_refund', 'shipment_fee']);
    const fee = await db.refunds({ shipmentRequestId: f.w.shipment.id });
    expect(fee).toHaveLength(1);
    expect(fee[0]).toMatchObject({ kind: 'shipment_fee', amountCents: 21405, status: 'submitted' });
    expect((await db.shipment(f.w.shipment.id)).status).toBe('cancelado');
    expect(av12()).toHaveLength(1);
    expect(av12()[0].text).toMatch(/no sale|no saldrá|envío/i);
    // reponer una en otro retiro ⇒ ni fee ni cierre
    const g = await mkWithdrawalCase({ name: 'PS28 repone' });
    await db.mark(g.w.shipment.id, g.line(0).id, { status: 'missing', missingReason: 'not_found' });
    await db.mark(g.w.shipment.id, g.line(1).id, { status: 'missing', missingReason: 'not_found' });
    await db.prepare(g.w.shipment.id, 0);
    const gc = await h.prisma.replacementCase.findMany({ where: { shipmentRequestId: g.w.shipment.id } });
    const cand = await db.mkPiece({ status: 'in_stock' });
    expect((await db.caseReplace(gc[0].id, { inventoryItemId: cand.id })).status).toBe(200);
    const pvg = await db.casePreview(gc[1].id, 5000);
    expect(pvg.body.closesShipment).toBe(false);
    expect((await db.caseRefund(gc[1].id, refundBody(pvg, 5000))).body.shipment).toEqual({ status: 'picking', closed: false });
    expect(await db.refunds({ shipmentRequestId: g.w.shipment.id })).toHaveLength(0);
    // todo por SPEI (remanente 0 en la orden de origen) cierra igual: `expectedStripeCents` = la `shipment_fee`
    const k = await mkWithdrawalCase({ name: 'PS28 spei' });
    await h.prisma.paymentRefund.create({
      data: { idempotencyKey: `full:fixture28:${k.w.shipment.id}`, kind: 'order_full', orderId: k.vo.order.id, amountCents: k.vo.order.totalCents, merchandiseCents: 80000, merchandiseIvaCents: 80000 - Math.floor(80000 / 1.16), shippingCents: 0, shippingIvaCents: 0, processingFeeCents: 4617, status: 'succeeded', stripeRefundId: `re_full_${k.vo.order.id}`, requestedByUserId: db.adminId, requestedByRole: 'super_admin', submittedAt: new Date(), succeededAt: new Date() },
    });
    await db.mark(k.w.shipment.id, k.line(0).id, { status: 'missing', missingReason: 'not_found' });
    await db.mark(k.w.shipment.id, k.line(1).id, { status: 'picked' });
    // la línea `picked` se retira del paquete: la marcamos faltante también para que quede vacío
    await db.mark(k.w.shipment.id, k.line(1).id, { status: 'missing', missingReason: 'damaged' });
    await db.prepare(k.w.shipment.id, 0);
    const kc = await h.prisma.replacementCase.findMany({ where: { shipmentRequestId: k.w.shipment.id } });
    const pvk0 = await db.casePreview(kc[0].id, 5000);
    expect((await db.caseRefund(kc[0].id, refundBody(pvk0, 5000))).status).toBe(200);
    const pvk1 = await db.casePreview(kc[1].id, 5000);
    expect(pvk1.body).toMatchObject({ stripeAvailableCents: 0, caseStripeCents: 0, shipmentFeeCents: 21405, stripeCents: 21405, manualCents: 5000, closesShipment: true });
    const rk = await db.caseRefund(kc[1].id, refundBody(pvk1, 5000));
    expect(rk.status).toBe(200);
    expect(rk.body.shipment).toEqual({ status: 'cancelado', closed: true });
    expect((await db.refunds({ shipmentRequestId: k.w.shipment.id }))[0]).toMatchObject({ kind: 'shipment_fee', amountCents: 21405 });
    expect(await db.manualRows({ replacementCaseId: kc[1].id })).toHaveLength(1);
    // Mutación: condicionar el cierre a que exista fila `case_refund` ⇒ el retiro SPEI no cierra.
  });

  // ================================================================ PS-29 — la cadena

  it('PS-29 💰 — cadena: la repuesta que vuelve a faltar en otro retiro hereda el `originOrderItemId` del caso que la repuso; un contracargo de esa orden alcanza a la REPUESTA (a plataforma) y no deja carta y dinero', async () => {
    const f = await mkWithdrawalCase();
    await db.mark(f.w.shipment.id, f.line(0).id, { status: 'missing', missingReason: 'not_found' });
    await db.mark(f.w.shipment.id, f.line(1).id, { status: 'picked' });
    await db.prepare(f.w.shipment.id, 0);
    const c1 = await h.prisma.replacementCase.findFirstOrThrow({ where: { shipmentRequestId: f.w.shipment.id } });
    // Se repone en la BÓVEDA: el retiro se cierra por fixture ⇒ destino `drawer`.
    await h.prisma.shipmentRequest.update({ where: { id: f.w.shipment.id }, data: { status: 'cancelado' } });
    const y = await db.mkPiece({ status: 'in_stock' });
    const rep = await db.caseReplace(c1.id, { inventoryItemId: y.id, locationId: f.drawer.id });
    expect(rep.status).toBe(200);
    expect(rep.body.outcome).toBe('replaced');
    expect(await db.piece(y.id)).toMatchObject({ ownerUserId: f.u.id, status: 'in_custody', locationId: f.drawer.id });
    // Y vuelve a faltar en OTRO retiro ⇒ su caso apunta al origen del caso que la repuso (la OrderItem de la compra)
    const w2 = await db.mkWithdrawal(f.u.id, [y.id], 'picking');
    await db.mark(w2.shipment.id, w2.lines[0].id, { status: 'missing', missingReason: 'not_found' });
    expect((await db.prepare(w2.shipment.id, 0)).status).toBe(200);
    const c2 = await h.prisma.replacementCase.findFirstOrThrow({ where: { shipmentRequestId: w2.shipment.id } });
    expect(c2.originOrderItemId).toBe(f.vo.orderItems[0].id);
    expect((await db.caseGet(c2.id)).body.origin.orderId).toBe(f.vo.order.id);
    // Se repone otra vez (la cadena X→Y→Z) y luego llega el contracargo de la compra: alcanza a Z.
    await h.prisma.shipmentRequest.update({ where: { id: w2.shipment.id }, data: { status: 'cancelado' } });
    const z = await db.mkPiece({ status: 'listed' });
    expect((await db.caseReplace(c2.id, { inventoryItemId: z.id, locationId: f.drawer.id })).status).toBe(200);
    const wh = await h.sendStripeWebhook({ type: 'charge.dispute.created', data: { object: { object: 'dispute', payment_intent: f.vo.pi } } });
    expect(wh.status).toBe(200);
    expect(await db.piece(z.id)).toMatchObject({ ownerType: 'platform', ownerUserId: null, status: 'listed' });
    expect(await db.piece(y.id)).toMatchObject({ ownerType: 'platform', status: 'lost' });
    const o = await db.order(f.vo.order.id);
    expect(o.status).toBe('chargeback');
    // la otra carta de la compra (sin cadena) también vuelve
    expect(await db.piece(f.vo.pieces[1].id)).toMatchObject({ ownerType: 'platform', status: 'listed' });
    // Mutación: `resolveOrigin` sin la cadena ⇒ `no_origin_order`; el contracargo no toca a Z.
  });

  it('PS-8 / H9 — contracargo de la orden de origen con el caso `open` ⇒ la original `lost` del cliente NO vuelve a `listed`; queda `needsManual` y el súper-admin ANULA (void) el caso', async () => {
    const s = await mkSpei(60000);
    const wh = await h.sendStripeWebhook({ type: 'charge.dispute.created', data: { object: { object: 'dispute', payment_intent: s.vo.pi } } });
    expect(wh.status).toBe(200);
    expect(await db.piece(s.piece.id)).toMatchObject({ status: 'lost', ownerType: 'customer', ownerUserId: s.u.id });
    const o = await db.order(s.vo.order.id);
    expect(o).toMatchObject({ status: 'chargeback', chargebackNeedsManual: true });
    // los verbos del apartado ven la orden no liquidada
    const cand = await db.mkPiece({ status: 'in_stock', cardId: s.card.id });
    const rep = await db.caseReplace(s.caseId, { inventoryItemId: cand.id, locationId: s.drawer.id });
    expect(rep.status).toBe(409);
    expect(rep.body.error).toMatchObject({ code: 'CASE_ORIGIN_NOT_SETTLED', details: { originStatus: 'chargeback' } });
    expect((await db.piece(cand.id)).status).toBe('in_stock'); // rollback de todo
    const pv = await db.casePreview(s.caseId, Q);
    expect(pv.status).toBe(409);
    expect(pv.body.error.code).toBe('CASE_ORIGIN_NOT_SETTLED');
    expect((await db.caseGet(s.caseId, db.adminToken)).body.refundContext).toEqual({ available: false, reason: 'origin_not_settled' });
    // anular: solo súper-admin, solo con la orden no liquidada
    expect((await db.caseVoid(s.caseId, { note: 'contracargo' }, db.opToken)).status).toBe(403);
    expect((await db.caseVoid(s.caseId, {})).status).toBe(400);
    const v = await db.caseVoid(s.caseId, { note: 'contracargo perdido' });
    expect(v.status).toBe(200);
    expect(v.body.outcome).toBe('voided');
    expect(v.body.case).toMatchObject({ status: 'voided', voidNote: 'contracargo perdido' });
    expect(await db.piece(s.piece.id)).toMatchObject({ status: 'lost', ownerType: 'platform' });
    expect((await db.caseVoid(s.caseId, { note: 'otra vez' })).body.outcome).toBe('already_resolved');
    // un caso con la orden liquidada NO se anula
    const t = await mkSpei(60000);
    const nv = await db.caseVoid(t.caseId, { note: 'no debería' });
    expect(nv.status).toBe(409);
    expect(nv.body.error).toMatchObject({ code: 'CASE_NOT_VOIDABLE', details: { originStatus: 'settled' } });
    // Mutación: quitar la guarda nueva del contracargo (H9) ⇒ la pieza `lost` del cliente sale `listed`.
  });

  // ================================================================ PS-33 / PS-34 / PS-38 / PS-39 / PS-54 — la cubeta

  /** Un caso reembolsado TODO por SPEI (remanente 0) para el cliente dado; devuelve la fila `pending`. */
  async function mkPending(opts: { clabe?: string | null; legalName?: string; name?: string } = {}) {
    const s = await mkSpei(60000, { name: opts.name });
    await db.mkKyc(s.u.id, opts.clabe === undefined ? CLABE_A : opts.clabe, { legalName: opts.legalName });
    await h.prisma.paymentRefund.create({
      data: { idempotencyKey: `full:fixmp:${s.caseId}`, kind: 'order_full', orderId: s.vo.order.id, amountCents: s.vo.order.totalCents, merchandiseCents: 80000, merchandiseIvaCents: 80000 - Math.floor(80000 / 1.16), shippingCents: 0, shippingIvaCents: 0, processingFeeCents: 4617, status: 'succeeded', stripeRefundId: `re_full_${s.vo.order.id}`, requestedByUserId: db.adminId, requestedByRole: 'super_admin', submittedAt: new Date(), succeededAt: new Date() },
    });
    const pv = await db.casePreview(s.caseId, Q);
    const r = await db.caseRefund(s.caseId, refundBody(pv, Q));
    expect(r.status).toBe(200);
    const mr = (await db.manualRows({ replacementCaseId: s.caseId }))[0];
    bandeja = [];
    return { ...s, mr };
  }

  it('PS-33 💰 / PS-54 — marcar pagada: `paid` con `paidClabeHmac` = el vigente, un AV-15; repetir con la MISMA referencia ⇒ 200 already_paid sin escribir ni avisar; otra ⇒ 409; sin referencia (D-11) ⇒ 200 y AV-15 sin clave; formatos malos ⇒ 400; operador ⇒ 403; paid vs cancel (N≥10) ⇒ uno gana', async () => {
    const p = await mkPending();
    const rv = await db.mrReveal(p.mr.id);
    expect(rv.status).toBe(200);
    expect(rv.body).toMatchObject({ clabe: CLABE_A, beneficiaryName: 'SPEI Caso', clabeUpdatedAt: null, clabeChangedRecently: false, revealToken: expect.any(String) });
    const token = rv.body.revealToken;
    for (const bad of ['con espacio', 'x'.repeat(31), 'ABC-123', '']) {
      expect((await db.mrPaid(p.mr.id, { revealToken: token, speiReference: bad })).status).toBe(400);
    }
    expect((await db.mrPaid(p.mr.id, { revealToken: token, speiReference: 'ABC123' }, db.opToken)).status).toBe(403);
    expect((await db.mrPaid(p.mr.id, { speiReference: 'ABC123' })).status).toBe(400); // sin token
    const r = await db.mrPaid(p.mr.id, { revealToken: token, speiReference: 'ABC123', note: 'pagado hoy' });
    expect(r.status).toBe(200);
    expect(r.body.outcome).toBe('paid');
    // QA BLOQ-1: la respuesta ES el `ManualRefundDTO` (con `customer.fullName`, lo que pinta la pantalla del súper-admin); `outcome` es aditivo.
    expect(r.body).toMatchObject({ id: p.mr.id, status: 'paid', speiReference: 'ABC123', paidNote: 'pagado hoy', paidBy: { userId: db.adminId }, paidToCurrentClabe: true, customer: { userId: p.u.id, fullName: expect.any(String), email: p.u.email } });
    expect(r.body).not.toHaveProperty('manualRefund');
    const row = await h.prisma.manualRefund.findUniqueOrThrow({ where: { id: p.mr.id } });
    const kyc = await h.prisma.kycProfile.findUniqueOrThrow({ where: { userId: p.u.id } });
    expect(row.paidClabeHmac).toBe(kyc.clabeHmac);
    expect(row.paidByUserId).toBe(db.adminId);
    expect(av15()).toHaveLength(1);
    expect(av15()[0].text).toContain('ABC123');
    const again = await db.mrPaid(p.mr.id, { revealToken: token, speiReference: 'ABC123' });
    expect(again.status).toBe(200);
    expect(again.body.outcome).toBe('already_paid');
    expect(again.body).toMatchObject({ id: p.mr.id, status: 'paid', customer: { fullName: expect.any(String) } });
    expect(av15()).toHaveLength(1);
    expect((await h.prisma.manualRefund.findUniqueOrThrow({ where: { id: p.mr.id } })).paidAt).toEqual(row.paidAt);
    const other = await db.mrPaid(p.mr.id, { revealToken: token, speiReference: 'OTRA1' });
    expect(other.status).toBe(409);
    expect(other.body.error).toMatchObject({ code: 'MANUAL_REFUND_NOT_PENDING', details: { status: 'paid' } });
    expect(await db.audits(p.mr.id, 'manual_refund.paid')).toHaveLength(1);
    // D-11: sin clave de rastreo
    const q = await mkPending({ name: 'PS54' });
    const tq = (await db.mrReveal(q.mr.id)).body.revealToken;
    const rq = await db.mrPaid(q.mr.id, { revealToken: tq });
    expect(rq.status).toBe(200);
    expect(rq.body.speiReference).toBeNull();
    expect(av15()).toHaveLength(1); // (mkPending limpia la bandeja)
    expect(av15()[0].text).not.toMatch(/rastreo/i);
    // carrera paid vs cancel
    const outcomes: string[] = [];
    let inter = 0;
    for (let i = 0; i < N; i += 1) {
      const m = await mkPending({ name: `PS33 ${i}` });
      const tk = (await db.mrReveal(m.mr.id)).body.revealToken;
      const res = await db.forced(
        () => db.holdRow('ManualRefund', m.mr.id),
        () => db.mrPaid(m.mr.id, { revealToken: tk, speiReference: `R${i}` }),
        () => db.mrCancel(m.mr.id, { note: 'cancelada en carrera' }),
      );
      if (res.interleaved) inter += 1;
      const st = (await h.prisma.manualRefund.findUniqueOrThrow({ where: { id: m.mr.id } })).status;
      const wins = [res.a, res.b].filter((x) => x.status === 200 && ['paid', 'cancelled'].includes(x.body.outcome)).length;
      outcomes.push(`${code(res.a)},${code(res.b)},status=${st}${wins === 1 ? '' : ',VIOLATION'}`);
    }
    expect(report('PS-33', outcomes, (o) => !o.includes('VIOLATION'))).toBe(N);
    expect(inter).toBe(N);
    // El OTRO orden (PS-33b): `cancel` se encola PRIMERO y `paid` decide con una lectura caduca (`pending`) ⇒ el
    // FOR UPDATE + relectura (y, detrás, el CAS `status:'pending'`) dan 409 MANUAL_REFUND_NOT_PENDING; queda `cancelled`.
    // Es el orden que muerde quitar el candado y el `status` del CAS: `paid` pisaría una cancelada (y saldría AV-15).
    const outcomesB: string[] = [];
    let interB = 0;
    for (let i = 0; i < N; i += 1) {
      const m = await mkPending({ name: `PS33b ${i}` });
      const tk = (await db.mrReveal(m.mr.id)).body.revealToken;
      const res = await db.forced(
        () => db.holdRow('ManualRefund', m.mr.id),
        () => db.mrCancel(m.mr.id, { note: 'cancelada en carrera b' }),
        () => db.mrPaid(m.mr.id, { revealToken: tk, speiReference: `RB${i}` }),
      );
      if (res.interleaved) interB += 1;
      const st = (await h.prisma.manualRefund.findUniqueOrThrow({ where: { id: m.mr.id } })).status;
      const wins = [res.a, res.b].filter((x) => x.status === 200 && ['paid', 'cancelled'].includes(x.body.outcome)).length;
      const ok = wins === 1 && st === 'cancelled' && res.b.status === 409;
      outcomesB.push(`${code(res.a)},${code(res.b)},status=${st}${ok ? '' : ',VIOLATION'}`);
    }
    expect(report('PS-33b', outcomesB, (o) => !o.includes('VIOLATION'))).toBe(N);
    expect(interB).toBe(N);
    // Mutación: quitar `status:'pending'` del WHERE del CAS (y el candado) ⇒ PS-33b: `paid` sobre `cancelled` en ≥1 tirada.
  });

  it('PS-34 🔒 — la lista y el detalle NUNCA llevan 18 dígitos seguidos; `reveal-clabe` solo súper-admin, solo `pending`, UNA bitácora por llamada; sin CLABE ⇒ 422; la tabla no tiene columna de CLABE', async () => {
    const p = await mkPending({ legalName: 'Beneficiario Legal' });
    const list = await db.mrList('?status=pending');
    expect(list.status).toBe(200);
    expect(list.body.total).toBeGreaterThanOrEqual(1);
    expect(list.body.pendingCents).toBeGreaterThanOrEqual(Q);
    expect(JSON.stringify(list.body)).not.toMatch(/\d{18}/);
    const row = list.body.data.find((x: any) => x.id === p.mr.id);
    expect(row).toMatchObject({ clabeMasked: '**************4567', clabeOnFile: true, beneficiaryName: 'Beneficiario Legal', customer: { userId: p.u.id }, case: { id: p.caseId, folio: p.piece.folio, reason: 'TCGplayer NM 2026-09-29' }, origin: { orderId: p.vo.order.id, orderStatus: 'settled' } });
    const det = await db.mrGet(p.mr.id);
    expect(JSON.stringify(det.body)).not.toMatch(/\d{18}/);
    expect((await db.mrList('', db.opToken)).status).toBe(403);
    expect((await db.mrGet(p.mr.id, db.opToken)).status).toBe(403);
    expect((await db.mrReveal(p.mr.id, db.opToken)).status).toBe(403);
    const r1 = await db.mrReveal(p.mr.id);
    const r2 = await db.mrReveal(p.mr.id);
    expect(r1.body.clabe).toBe(CLABE_A);
    expect(r1.body.revealToken).toBe(r2.body.revealToken); // determinista
    expect(await db.audits(p.mr.id, 'manual_refund.reveal_clabe')).toHaveLength(2);
    const logs = await db.audits(p.mr.id, 'manual_refund.reveal_clabe');
    expect(JSON.stringify(logs)).not.toMatch(/\d{18}/);
    expect(JSON.stringify(logs)).not.toContain(r1.body.revealToken);
    // `q` por nombre / folio / clave
    expect((await db.mrList(`?q=${encodeURIComponent(p.piece.folio)}`)).body.data.map((x: any) => x.id)).toContain(p.mr.id);
    // sin CLABE ⇒ 422
    const n = await mkPending({ clabe: null, name: 'Sin Clabe' });
    const nr = await db.mrReveal(n.mr.id);
    expect(nr.status).toBe(422);
    expect(nr.body.error.code).toBe('CLABE_NOT_ON_FILE');
    expect((await db.mrGet(n.mr.id)).body).toMatchObject({ clabeOnFile: false, clabeMasked: null });
    // pagada/cancelada ⇒ 409
    await db.mrCancel(n.mr.id, { note: 'sin CLABE, se resolvió en efectivo' });
    const nc = await db.mrReveal(n.mr.id);
    expect(nc.status).toBe(409);
    expect(nc.body.error).toMatchObject({ code: 'MANUAL_REFUND_NOT_PENDING', details: { status: 'cancelled' } });
    // esquema: ninguna columna guarda la CLABE (solo su índice ciego al pagar)
    const cols = await h.prisma.$queryRawUnsafe<{ column_name: string }[]>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'ManualRefund' AND column_name ILIKE '%clabe%'`);
    expect(cols.map((c) => c.column_name)).toEqual(['paidClabeHmac']);
    // Mutación: devolver `clabe` en claro en el DTO de lista; no auditar el reveal.
  });

  it('PS-38 💰 — cancelar: `pending` + nota ⇒ `cancelled` con actor; sin nota ⇒ 400; ya `paid` ⇒ 409; el caso sigue `refunded` y muestra la fila cancelada; `manualRefundsPending` baja en 1', async () => {
    const p = await mkPending();
    const before = (await db.summary(db.adminToken)).body.manualRefundsPending;
    expect((await db.summary(db.opToken)).body.manualRefundsPending).toBeNull();
    expect((await db.mrCancel(p.mr.id, {})).status).toBe(400);
    const r = await db.mrCancel(p.mr.id, { note: 'se pagó en efectivo en tienda' });
    expect(r.status).toBe(200);
    expect(r.body.outcome).toBe('cancelled');
    // QA BLOQ-1: la respuesta ES el `ManualRefundDTO` (+ `outcome`), no `{outcome, manualRefund}`.
    expect(r.body).toMatchObject({ id: p.mr.id, status: 'cancelled', cancelNote: 'se pagó en efectivo en tienda', cancelledBy: { userId: db.adminId }, customer: { userId: p.u.id, fullName: expect.any(String) } });
    expect(r.body).not.toHaveProperty('manualRefund');
    expect((await db.summary(db.adminToken)).body.manualRefundsPending).toBe(before - 1);
    expect((await db.mrCancel(p.mr.id, { note: 'otra' })).body.outcome).toBe('already_cancelled');
    const kase = await db.caseGet(p.caseId, db.adminToken);
    expect(kase.body.status).toBe('refunded');
    expect(kase.body.manualRefunds[0].status).toBe('cancelled');
    expect(av14().length + av15().length).toBe(0);
    // el cliente lo ve como `cancelled`
    const tok = await db.loginCustomer(p.u.email!);
    const od = await db.clientOrder(p.vo.order.id, tok);
    expect(od.status).toBe(200);
    // pagada ⇒ 409
    const q = await mkPending({ name: 'PS38b' });
    const tk = (await db.mrReveal(q.mr.id)).body.revealToken;
    expect((await db.mrPaid(q.mr.id, { revealToken: tk, speiReference: 'K1' })).status).toBe(200);
    const c = await db.mrCancel(q.mr.id, { note: 'tarde' });
    expect(c.status).toBe(409);
    expect(c.body.error.details).toEqual({ status: 'paid' });
    // Mutación: reabrir el caso al cancelar; dejar cancelar una `paid`.
  });

  it('PS-39 — avisos: SPEI con CLABE ⇒ un AV-14 sin CLABE (y AV-12 si hubo Stripe); sin CLABE ⇒ enlace a registrarla; `paid` ⇒ un AV-15; `cancel` ⇒ ninguno; los sellos impiden duplicados (N≥10 simultáneas)', async () => {
    const manual = h.app.get(ManualRefundService);
    const p = await mkPending();
    // AV-14 ya salió al crear (mkPending limpia la bandeja): 10 llamadas simultáneas más ⇒ cero correos nuevos
    await Promise.all(Array.from({ length: N }, () => manual.notifyAnnounced([p.mr.id])));
    expect(av14()).toHaveLength(0);
    const tk = (await db.mrReveal(p.mr.id)).body.revealToken;
    expect((await db.mrPaid(p.mr.id, { revealToken: tk, speiReference: 'ZZ9' })).status).toBe(200);
    await Promise.all(Array.from({ length: N }, () => manual.notifyPaid(p.mr.id)));
    expect(av15()).toHaveLength(1);
    // sin CLABE ⇒ AV-14 con el enlace a registrarla
    const s = await mkSpei(60000, { name: 'PS39 sin clabe' });
    await h.prisma.paymentRefund.create({
      data: { idempotencyKey: `full:fix39:${s.caseId}`, kind: 'order_full', orderId: s.vo.order.id, amountCents: s.vo.order.totalCents, merchandiseCents: 80000, merchandiseIvaCents: 80000 - Math.floor(80000 / 1.16), shippingCents: 0, shippingIvaCents: 0, processingFeeCents: 4617, status: 'succeeded', stripeRefundId: `re_full_${s.vo.order.id}`, requestedByUserId: db.adminId, requestedByRole: 'super_admin', submittedAt: new Date(), succeededAt: new Date() },
    });
    const pv = await db.casePreview(s.caseId, Q);
    expect(pv.body.customerHasClabe).toBe(false);
    bandeja = [];
    expect((await db.caseRefund(s.caseId, refundBody(pv, Q))).status).toBe(200);
    expect(av14()).toHaveLength(1);
    // El contrato (PS-39, §M4-SHIP.15.7, errata v1.80.8.2) dice `/account#kyc`: la pantalla `KycSection` vive en
    // `/account` (`AccountView.tsx`, `SectionShell id="kyc"`) y `/cuenta` es un 404 (candado
    // `mail-links.frontend-routes.spec.ts`).
    expect(av14()[0].html).toMatch(/\/account#kyc/);
    expect(av12()).toHaveLength(0);
    // Mutación: mandar AV-15 al crear; no reclamar el sello ⇒ 10 correos.
  });

  // ================================================================ PS-35 / PS-48 / PS-53 — Stripe falló ⇒ SPEI, disputa, re-emisión

  it('PS-35 💰 — `case_refund` fallida ⇒ `to-manual` crea ManualRefund(stripe_failed) con el mismo importe; repetir ⇒ la misma; `requested|submitted|succeeded` ⇒ 409 {status}; otros kinds ⇒ 409 {kind}; operador ⇒ 403; INV-MR-1', async () => {
    const s = await mkSpei(60000);
    await db.mkKyc(s.u.id, CLABE_A);
    h.stripe.refundOutcome = 'definitive';
    const pv = await db.casePreview(s.caseId, Q);
    const r = await db.caseRefund(s.caseId, refundBody(pv, Q));
    expect(r.status).toBe(200);
    const failed = (await db.refunds({ replacementCaseId: s.caseId }))[0];
    expect(failed).toMatchObject({ kind: 'case_refund', status: 'failed', failureCode: 'charge_disputed' });
    h.stripe.refundOutcome = 'ok';
    expect(av12()).toHaveLength(0);
    expect((await db.summary(db.adminToken)).body.stuckRefunds).toBeGreaterThanOrEqual(1);
    // `failureCode='charge_disputed'` con la orden `settled` ⇒ 409 CASE_ORIGIN_NOT_SETTLED (PS-48 (b))
    const disputed = await db.toManual(failed.id);
    expect(disputed.status).toBe(409);
    expect(disputed.body.error).toMatchObject({ code: 'CASE_ORIGIN_NOT_SETTLED', details: { originStatus: 'settled', reason: 'charge_disputed' } });
    expect(await db.manualRows({ paymentRefundId: failed.id })).toHaveLength(0);
    // un fallo definitivo NO de disputa ⇒ convertible
    await h.prisma.paymentRefund.update({ where: { id: failed.id }, data: { failureCode: 'insufficient_funds' } });
    expect((await db.toManual(failed.id, db.opToken)).status).toBe(403);
    bandeja = [];
    const tm = await db.toManual(failed.id);
    expect(tm.status).toBe(200);
    expect(tm.body).toMatchObject({ source: 'stripe_failed', status: 'pending', amountCents: Q, paymentRefundId: failed.id, components: { merchandiseCents: failed.merchandiseCents, merchandiseIvaCents: failed.merchandiseIvaCents, processingFeeCents: failed.processingFeeCents, compensationCents: 0 } });
    expect(av14()).toHaveLength(1);
    const tm2 = await db.toManual(failed.id);
    expect(tm2.status).toBe(200);
    expect(tm2.body.id).toBe(tm.body.id);
    expect(await db.manualRows({ paymentRefundId: failed.id })).toHaveLength(1);
    expect((await db.refunds({ id: failed.id }))[0].status).toBe('failed'); // se queda `failed`
    // INV-MR-1: refundAmountCents = Σ case_refund no fallida + Σ ManualRefund no cancelada
    const k = await db.kase(s.caseId);
    expect(k.refundAmountCents).toBe(0 + Q);
    // kinds y estados no convertibles
    const t = await mkSpei(60000, { name: 'PS35b' });
    const pvt = await db.casePreview(t.caseId, Q);
    h.stripe.refundOutcome = 'transient';
    expect((await db.caseRefund(t.caseId, refundBody(pvt, Q))).status).toBe(200);
    h.stripe.refundOutcome = 'ok';
    const requested = (await db.refunds({ replacementCaseId: t.caseId }))[0];
    expect(requested.status).toBe('requested');
    const nc = await db.toManual(requested.id);
    expect(nc.status).toBe(409);
    expect(nc.body.error).toMatchObject({ code: 'REFUND_NOT_CONVERTIBLE', details: { status: 'requested' } });
    const d = await db.mkDirect();
    await db.mark(d.shipment.id, d.lines.find((l) => l.inventoryItemId === d.pieces[1].id)!.id, { status: 'missing', missingReason: 'not_found' });
    await db.mark(d.shipment.id, d.lines.find((l) => l.inventoryItemId === d.pieces[0].id)!.id, { status: 'picked' });
    expect((await db.prepare(d.shipment.id, 31458)).status).toBe(200);
    const im = (await db.refunds({ orderId: d.order.id }))[0];
    const nk = await db.toManual(im.id);
    expect(nk.status).toBe(409);
    expect(nk.body.error.details).toEqual({ kind: 'item_missing' });
    // Mutación: permitir `requested` ⇒ el mismo dinero por Stripe (reintento) Y por SPEI.
  });

  it('PS-48 💰 — `case_refund` fallida + orden `chargeback` ⇒ `to-manual` 409 CASE_ORIGIN_NOT_SETTLED, cero ManualRefund; `paid` de una pendiente cuya orden pasó a `chargeback` ⇒ 422 {required:[origin_not_settled]}; con `true` ⇒ 200 y la bitácora lo registra', async () => {
    const s = await mkSpei(60000);
    h.stripe.refundOutcome = 'definitive';
    const pv = await db.casePreview(s.caseId, Q);
    expect((await db.caseRefund(s.caseId, refundBody(pv, Q))).status).toBe(200);
    h.stripe.refundOutcome = 'ok';
    const failed = (await db.refunds({ replacementCaseId: s.caseId }))[0];
    await h.prisma.paymentRefund.update({ where: { id: failed.id }, data: { failureCode: 'expired_or_canceled_card' } });
    await h.prisma.order.update({ where: { id: s.vo.order.id }, data: { status: 'chargeback' } });
    const tm = await db.toManual(failed.id);
    expect(tm.status).toBe(409);
    expect(tm.body.error).toMatchObject({ code: 'CASE_ORIGIN_NOT_SETTLED', details: { originStatus: 'chargeback' } });
    expect(await db.manualRows({ paymentRefundId: failed.id })).toHaveLength(0);
    // paid con origen en disputa
    const p = await mkPending({ name: 'PS48b' });
    const tk = (await db.mrReveal(p.mr.id)).body.revealToken;
    await h.prisma.order.update({ where: { id: p.vo.order.id }, data: { status: 'chargeback' } });
    expect((await db.mrGet(p.mr.id)).body.origin.orderStatus).toBe('chargeback');
    const need = await db.mrPaid(p.mr.id, { revealToken: tk, speiReference: 'D1' });
    expect(need.status).toBe(422);
    expect(need.body.error).toMatchObject({ code: 'MANUAL_REFUND_CONFIRMATION_REQUIRED', details: { required: ['origin_not_settled'], originStatus: 'chargeback' } });
    expect((await h.prisma.manualRefund.findUniqueOrThrow({ where: { id: p.mr.id } })).status).toBe('pending');
    const ok = await db.mrPaid(p.mr.id, { revealToken: tk, speiReference: 'D1', confirmOriginNotSettled: true });
    expect(ok.status).toBe(200);
    const log = (await db.audits(p.mr.id, 'manual_refund.paid'))[0];
    expect(log.after).toMatchObject({ originOrderStatus: 'chargeback', confirmedOriginNotSettled: true, confirmedRecentClabeChange: false, speiReference: 'D1' });
    // Mutación: quitar el `FOR UPDATE`+chequeo de la orden en `to-manual` ⇒ ManualRefund creada.
  });

  it('PS-53 💰 — `reissue` de una `cancelled` ⇒ fila nueva `pending` con el mismo importe y componentes, `reissuedFromId`, CERO AV-14; repetir ⇒ 200 la misma; sobre `pending`/`paid` ⇒ 409; INV-MR-1; el cliente ve `cancelled` antes y `pending` después', async () => {
    const p = await mkPending();
    const tok = await db.loginCustomer(p.u.email!);
    const view = async () => (await db.clientOrder(p.vo.order.id, tok)).body.items.find((i: any) => i.inventoryItemId === p.piece.id)?.replacement;
    expect(await view()).toMatchObject({ status: 'refunded', reason: 'not_found', refund: { amountCents: Q, byTransferCents: Q, transferStatus: 'pending' } });
    const np = await db.mrReissue(p.mr.id, { note: 'aún pendiente' });
    expect(np.status).toBe(409);
    expect(np.body.error).toMatchObject({ code: 'MANUAL_REFUND_NOT_CANCELLED', details: { status: 'pending' } });
    expect((await db.mrCancel(p.mr.id, { note: 'CLABE equivocada' })).status).toBe(200);
    expect(await view()).toMatchObject({ refund: { transferStatus: 'cancelled' } });
    bandeja = [];
    expect((await db.mrReissue(p.mr.id, {})).status).toBe(400);
    const r = await db.mrReissue(p.mr.id, { note: 'el cliente corrigió su CLABE' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'pending', amountCents: p.mr.amountCents, reissuedFromId: p.mr.id, source: 'case_excess', components: { merchandiseCents: p.mr.merchandiseCents, merchandiseIvaCents: p.mr.merchandiseIvaCents, processingFeeCents: p.mr.processingFeeCents, compensationCents: p.mr.compensationCents } });
    expect(r.body.id).not.toBe(p.mr.id);
    expect(av14()).toHaveLength(0);
    expect((await db.mrGet(p.mr.id)).body.reissuedAsId).toBe(r.body.id);
    const again = await db.mrReissue(p.mr.id, { note: 'otra vez' });
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(r.body.id);
    expect(await db.manualRows({ replacementCaseId: p.caseId })).toHaveLength(2);
    expect(await view()).toMatchObject({ refund: { transferStatus: 'pending', byTransferCents: Q } });
    // INV-MR-1: Σ no canceladas = refundAmountCents
    const alive = (await db.manualRows({ replacementCaseId: p.caseId, status: { not: 'cancelled' } })).reduce((a, x) => a + x.amountCents, 0);
    expect(alive).toBe((await db.kase(p.caseId)).refundAmountCents);
    // pagar la re-emitida exige las mismas guardas (token)
    const tk = (await db.mrReveal(r.body.id)).body.revealToken;
    expect((await db.mrPaid(r.body.id, { revealToken: tk, speiReference: 'RE1' })).status).toBe(200);
    expect((await db.mrReissue(r.body.id, { note: 'no aplica' })).body.error.details).toEqual({ status: 'paid' });
    expect(await view()).toMatchObject({ refund: { transferStatus: 'paid' } });
    // Mutación: índice parcial sin `status <> 'cancelled'` ⇒ la re-emisión choca.
  });

  // ================================================================ PS-46 / PS-47 — la CLABE

  it('PS-46 🔒 — `PUT /users/me/kyc` con CLABE nueva ⇒ `clabeUpdatedAt`, UNA bitácora sin 18 dígitos, UN AV-16 con las dos máscaras; misma CLABE ⇒ cero escrituras y cero avisos', async () => {
    const u = await db.mkUser('Clabe Cuarenta y Seis');
    const tok = await db.loginCustomer(u.email!);
    const r = await db.putKyc(tok, { clabe: CLABE_A });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ clabeMasked: '**************4567', clabeOnFile: true, clabeUpdatedAt: expect.any(String) });
    const kyc = await h.prisma.kycProfile.findUniqueOrThrow({ where: { userId: u.id } });
    expect(kyc.clabeUpdatedAt).not.toBeNull();
    const logs = await db.audits(u.id, 'kyc.clabe_changed');
    expect(logs).toHaveLength(1);
    expect(JSON.stringify(logs[0])).not.toMatch(/\d{18}/);
    expect(logs[0].after).toEqual({ previousMasked: null, newMasked: '**************4567' });
    expect(av16()).toHaveLength(1);
    expect(av16()[0].to).toBe(u.email);
    expect(av16()[0].text).toContain('4567');
    expect(av16()[0].text + av16()[0].html).not.toMatch(/\d{18}/);
    bandeja = [];
    const same = await db.putKyc(tok, { clabe: CLABE_A });
    expect(same.status).toBe(200);
    expect((await h.prisma.kycProfile.findUniqueOrThrow({ where: { userId: u.id } })).clabeUpdatedAt).toEqual(kyc.clabeUpdatedAt);
    expect(await db.audits(u.id, 'kyc.clabe_changed')).toHaveLength(1);
    expect(av16()).toHaveLength(0);
    const chg = await db.putKyc(tok, { clabe: CLABE_B });
    expect(chg.status).toBe(200);
    expect((await db.audits(u.id, 'kyc.clabe_changed'))[1].after).toEqual({ previousMasked: '**************4567', newMasked: '**************0007' });
    expect(av16()).toHaveLength(1);
    // Mutación: escribir `clabeEnc` desde buylist sin `setClabe` ⇒ `C-CLABE-1` rojo y sin `clabeUpdatedAt`.
  });

  it('PS-47 💰🔒 — reveal ⇒ token; cambiar la CLABE ⇒ `paid` con el token viejo 409 CLABE_CHANGED_SINCE_REVEAL (cero escrituras); re-reveal ⇒ 422 {required:[recent_clabe_change]}; con `true` ⇒ 200 y `paidClabeHmac` = la revelada; carrera paid vs PUT kyc (N≥10)', async () => {
    const pii = h.app.get(PiiCryptoService);
    const p = await mkPending();
    const tok = await db.loginCustomer(p.u.email!);
    const old = (await db.mrReveal(p.mr.id)).body.revealToken;
    expect((await db.putKyc(tok, { clabe: CLABE_B })).status).toBe(200);
    const stale = await db.mrPaid(p.mr.id, { revealToken: old, speiReference: 'S1' });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatchObject({ code: 'CLABE_CHANGED_SINCE_REVEAL', details: { clabeUpdatedAt: expect.any(String) } });
    expect((await h.prisma.manualRefund.findUniqueOrThrow({ where: { id: p.mr.id } })).status).toBe('pending');
    const rv = await db.mrReveal(p.mr.id);
    expect(rv.body).toMatchObject({ clabe: CLABE_B, clabeChangedRecently: true });
    expect(rv.body.revealToken).not.toBe(old);
    expect((await db.mrGet(p.mr.id)).body.clabeChangedRecently).toBe(true);
    const need = await db.mrPaid(p.mr.id, { revealToken: rv.body.revealToken, speiReference: 'S1' });
    expect(need.status).toBe(422);
    expect(need.body.error).toMatchObject({ code: 'MANUAL_REFUND_CONFIRMATION_REQUIRED', details: { required: ['recent_clabe_change'], clabeUpdatedAt: expect.any(String) } });
    const ok = await db.mrPaid(p.mr.id, { revealToken: rv.body.revealToken, speiReference: 'S1', confirmRecentClabeChange: true });
    expect(ok.status).toBe(200);
    const row = await h.prisma.manualRefund.findUniqueOrThrow({ where: { id: p.mr.id } });
    expect(row.paidClabeHmac).toBe(pii.clabeBlindIndex(CLABE_B));
    expect((await db.audits(p.mr.id, 'manual_refund.paid'))[0].after).toMatchObject({ confirmedRecentClabeChange: true });
    // carrera: paid (token de la CLABE A) vs PUT kyc (CLABE B), barrera en la fila KycProfile
    const outcomes: string[] = [];
    let inter = 0;
    for (let i = 0; i < N; i += 1) {
      const m = await mkPending({ name: `PS47 ${i}` });
      const ctok = await db.loginCustomer(m.u.email!);
      const tk = (await db.mrReveal(m.mr.id)).body.revealToken;
      const kycRow = await h.prisma.kycProfile.findUniqueOrThrow({ where: { userId: m.u.id } });
      const res = await db.forced(
        () => db.holdRow('KycProfile', kycRow.id),
        () => db.mrPaid(m.mr.id, { revealToken: tk, speiReference: `C${i}` }),
        () => db.putKyc(ctok, { clabe: CLABE_B }),
      );
      if (res.interleaved) inter += 1;
      const r = await h.prisma.manualRefund.findUniqueOrThrow({ where: { id: m.mr.id } });
      const okRun = res.a.status === 409 ? r.status === 'pending' : res.a.status === 200 && r.paidClabeHmac === pii.clabeBlindIndex(CLABE_A);
      outcomes.push(`${code(res.a)},${code(res.b)},status=${r.status},hmac=${r.paidClabeHmac === pii.clabeBlindIndex(CLABE_A) ? 'A' : r.paidClabeHmac === null ? '-' : 'B'}${okRun ? '' : ',VIOLATION'}`);
    }
    expect(report('PS-47', outcomes, (o) => !o.includes('VIOLATION'))).toBe(N);
    expect(inter).toBe(N);
    // Mutación: (a) no comparar el token ⇒ `paid` con CLABE distinta; (b) leer `clabeHmac` antes del candado ⇒ hmac ≠ revelada en ≥1 tirada.
  });

  // ================================================================ PS-36 — el plazo derivado

  it('PS-36 — plazo derivado: reloj en +7d−1ms ⇒ `overdue:false`; en +7d ⇒ `true`; `dueAt` = openedAt + 604800000; el conteo solo cuenta `open` vencidos; pasar el reloj NO escribe nada', async () => {
    const cases = h.app.get(ReplacementCaseService);
    const prep = h.app.get(ShipmentPrepService);
    const s = await mkSpei(60000);
    const k = await db.kase(s.caseId);
    const before = await h.prisma.replacementCase.findUniqueOrThrow({ where: { id: s.caseId } });
    const t0 = k.openedAt.getTime();
    expect(REPLACEMENT_CASE_DUE_MS).toBe(604800000);
    const d1 = await cases.dto(h.prisma, s.caseId, 'super_admin', new Date(t0 + REPLACEMENT_CASE_DUE_MS - 1));
    expect(d1).toMatchObject({ overdue: false, dueAt: new Date(t0 + 604800000).toISOString() });
    const d2 = await cases.dto(h.prisma, s.caseId, 'vault_operator', new Date(t0 + REPLACEMENT_CASE_DUE_MS));
    expect(d2.overdue).toBe(true);
    const sumBefore = await prep.summary('super_admin', new Date(t0 + REPLACEMENT_CASE_DUE_MS - 1));
    const sumAfter = await prep.summary('super_admin', new Date(t0 + REPLACEMENT_CASE_DUE_MS));
    expect(sumAfter.toReplaceOverdue - sumBefore.toReplaceOverdue).toBe(1);
    // (`q` = id exacto: la BD se comparte y otras pruebas dejan casos `open`; la primera página no basta.)
    const list = await cases.list({ overdue: 'true', q: s.caseId }, 'super_admin', new Date(t0 + REPLACEMENT_CASE_DUE_MS));
    expect(list.data.map((c) => c.id)).toContain(s.caseId);
    expect(list.data.every((c) => c.overdue)).toBe(true);
    const page = await cases.list({ overdue: 'true', pageSize: '100' }, 'super_admin', new Date(t0 + REPLACEMENT_CASE_DUE_MS));
    expect(page.data.every((c) => c.overdue)).toBe(true);
    // un `replaced` de hace 30 días no cuenta
    const old = await mkSpei(60000, { name: 'PS36 viejo' });
    const cand = await db.mkPiece({ status: 'in_stock', cardId: old.card.id });
    expect((await db.caseReplace(old.caseId, { inventoryItemId: cand.id, locationId: old.drawer.id })).status).toBe(200);
    await h.prisma.replacementCase.update({ where: { id: old.caseId }, data: { openedAt: new Date(Date.now() - 30 * 24 * 3600 * 1000) } });
    const far = await cases.list({ overdue: 'true' }, 'super_admin', new Date(t0 + 60 * 24 * 3600 * 1000));
    expect(far.data.map((c) => c.id)).not.toContain(old.caseId);
    expect((await cases.dto(h.prisma, old.caseId, 'super_admin', new Date(t0 + 60 * 24 * 3600 * 1000))).overdue).toBe(false);
    // nada se escribe
    const after = await h.prisma.replacementCase.findUniqueOrThrow({ where: { id: s.caseId } });
    expect(after).toEqual(before);
    expect(await db.refunds({ replacementCaseId: s.caseId })).toHaveLength(0);
    expect(await db.manualRows({ replacementCaseId: s.caseId })).toHaveLength(0);
    // Mutación: `>` en vez de `>=` (el borde); contar casos cerrados; 8 días.
  });

  // ================================================================ lecturas del apartado

  it('lista y detalle: `?state`, `?source`, `?q`, orden `open` por `openedAt` asc; el operador no ve dinero; candidatas hasta 50', async () => {
    const s = await mkSpei(60000, { name: 'Lista Uno' });
    for (let i = 0; i < 3; i += 1) await db.mkPiece({ status: i === 0 ? 'listed' : 'in_stock', cardId: s.card.id });
    const open = await db.caseList('?state=open&source=vault_purchase');
    expect(open.status).toBe(200);
    const mine = open.body.data.find((c: any) => c.id === s.caseId);
    expect(mine).toMatchObject({ source: 'vault_purchase', candidateCount: 3, refundContext: null, manualRefunds: null, refundCapture: null, customer: { fullName: 'Lista Uno' } });
    const dates = open.body.data.map((c: any) => c.openedAt);
    expect([...dates].sort()).toEqual(dates);
    expect((await db.caseList(`?q=${encodeURIComponent('Lista Uno')}`)).body.data.map((c: any) => c.id)).toEqual([s.caseId]);
    expect((await db.caseList(`?q=${encodeURIComponent(s.piece.folio)}`)).body.data.map((c: any) => c.id)).toEqual([s.caseId]);
    expect((await db.caseList('?state=banana')).status).toBe(400);
    const det = await db.caseGet(s.caseId, db.adminToken);
    expect(det.body.candidates).toHaveLength(3);
    expect(det.body.candidates.map((c: any) => c.status).sort()).toEqual(['in_stock', 'in_stock', 'listed']);
    expect(det.body.refundContext.available).toBe(true);
    expect(JSON.stringify((await db.caseGet(s.caseId, db.opToken)).body)).not.toMatch(/referenceCents|stripeAvailableCents/);
  });
});
