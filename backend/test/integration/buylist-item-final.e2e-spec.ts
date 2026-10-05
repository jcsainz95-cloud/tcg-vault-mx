/**
 * `buylist-item-final.e2e-spec.ts` — **v1.82.1 · §PNL.10 (E-2, E-3) 💰: una carta que ya es inventario (o ya se pagó) no
 * se decide otra vez, y la conversión a inventario no escribe a ciegas.** POR HTTP, CONTRA POSTGRES REAL. Propiedad:
 * backend. Norma: `API_CONTRACT §PNL.10.2`, `§PNL.10.3`; pruebas `§PNL.10.6` BRJ-10…BRJ-14.
 *
 * La solicitud nace por la PUERTA (`POST /buylist/requests`); el ESTADO de partida se siembra por `h.prisma` y la
 * CONDUCTA (aprobar, convertir, rechazar) va por HTTP. La carta `convertida_inventario` se fabrica por los verbos reales
 * (`approve` → `convert-to-inventory`), así que su pieza `in_stock` existe de verdad.
 *
 * BRJ-13 va en dos formas: (a) el entrelazado del defecto E-3 FORZADO con el candado de fila de Postgres (la conversión
 * se detiene en el `INSERT "InventoryItem"` —su FK a `"Card"` pide `FOR KEY SHARE`— mientras el rechazo confirma
 * entero: `helpers/row-lock-barrier.ts`), y (b) N ≥ 10 rondas simultáneas con la proporción en el log (O-3).
 */
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { E2E_CARDS, E2E_USERS } from '../../prisma/e2e-fixtures';
import { MAIL_PORT, MailMessage, MailPort } from '../../src/modules/mail/mail.port';
import { BuylistService } from '../../src/modules/buylist/buylist.service';
import { diferida, esperarBloqueoDeFila } from './helpers/row-lock-barrier';

const CLABE_A = '012345678901234567';
const OFFERED = [12000, 8000, 5000] as const;
const N = Number(process.env.BRJ13_N ?? 12);
/** Cada ronda de BRJ-13 aprueba 12000 del mismo vendedor: el tope MENSUAL de intake se sube durante la suite. */
const CAP_KEY = 'buylist_cap_per_month_cents';

describe('E2E — v1.82.1 §PNL.10 · ITEM_FINAL en la decisión por carta y CAS en la conversión (💰)', () => {
  let h: E2EHarness;
  let customerToken: string;
  let operatorToken: string;
  let charizardId: string;
  let addressId: string;
  let enviados: MailMessage[];
  let spy: jest.SpyInstance;
  let capPrevio: { valueJson: unknown } | null = null;

  async function solicitudDeTres(): Promise<{ srId: string; items: string[] }> {
    const created = await h.api('POST', '/buylist/requests', {
      token: customerToken,
      json: {
        items: [{ cardId: charizardId, productType: 'raw', rawCondition: 'NM' }],
        clabe: CLABE_A,
        addressId,
      },
    });
    expect({ status: created.status, error: created.body?.error }).toEqual({ status: 201, error: undefined });
    const srId = created.body.sellRequestId as string;
    const first = await h.prisma.sellRequestItem.findFirstOrThrow({ where: { sellRequestId: srId } });
    const { id: _id, ...clon } = first;
    const extra = [];
    for (let i = 0; i < 2; i++) extra.push((await h.prisma.sellRequestItem.create({ data: { ...clon } })).id);
    return { srId, items: [first.id, ...extra] };
  }

  /** `verificacion`, recibida; `legado` ⇒ sin `offerSentAt` y líneas sin decisión de oferta (cohorte pre-M-46). */
  async function siembra(srId: string, items: string[], legado = false) {
    await h.prisma.sellRequest.update({
      where: { id: srId },
      data: {
        status: 'verificacion',
        closedAt: null,
        receivedAt: new Date(),
        verifiedAt: new Date(),
        offerSentAt: legado ? null : new Date(),
        approvedTotalCents: null,
      },
    });
    for (const [i, id] of items.entries()) {
      await h.prisma.sellRequestItem.update({
        where: { id },
        data: {
          itemStatus: 'verificacion',
          offerDecision: legado ? null : 'buy',
          offeredPriceCents: legado ? null : OFFERED[i],
          approvedPriceCents: null,
          rejectedAt: null,
          rejectionReason: null,
          inventoryItemId: null,
        },
      });
    }
  }

  const decide = (itemId: string, json: Record<string, unknown>) =>
    h.api('PATCH', `/admin/buylist/items/${itemId}/decision`, { token: operatorToken, json });
  const convert = (itemId: string) =>
    h.api('POST', `/admin/buylist/items/${itemId}/convert-to-inventory`, { token: operatorToken, json: {} });
  const rejectItems = (srId: string, json: unknown) =>
    h.api('POST', `/admin/buylist/${srId}/reject-items`, { token: operatorToken, json });

  /** Carta `convertida_inventario` por los verbos REALES: aprobar (8000) y convertir. */
  async function cartaConvertida(legado = false) {
    const { srId, items } = await solicitudDeTres();
    await siembra(srId, items, legado);
    const itemId = items[1];
    const apr = await decide(itemId, legado ? { decision: 'approve', approvedPriceCents: 8000 } : { decision: 'approve' });
    expect(apr.status).toBe(200);
    const conv = await convert(itemId);
    expect(conv.status).toBe(200);
    expect(conv.body.alreadyConverted).toBe(false);
    return { srId, items, itemId, inventoryItemId: conv.body.inventoryItemId as string };
  }

  /** Foto de TODO lo que el `409 ITEM_FINAL` no puede tocar. */
  async function foto(srId: string, itemId: string) {
    const it = await h.prisma.sellRequestItem.findUniqueOrThrow({ where: { id: itemId } });
    const sr = await h.prisma.sellRequest.findUniqueOrThrow({ where: { id: srId } });
    const piezas = await h.prisma.inventoryItem.findMany({
      where: { sourceSellRequestItemId: itemId },
      select: { id: true, status: true, acquisitionCostCents: true },
    });
    const bitacora = await h.prisma.auditLog.count({ where: { entityId: itemId } });
    return {
      item: {
        itemStatus: it.itemStatus,
        approvedPriceCents: it.approvedPriceCents,
        rejectedAt: it.rejectedAt,
        rejectionReason: it.rejectionReason,
        inventoryItemId: it.inventoryItemId,
      },
      request: { status: sr.status, approvedTotalCents: sr.approvedTotalCents, closedAt: sr.closedAt },
      piezas,
      bitacora,
    };
  }

  function esItemFinal(res: { status: number; body: any }, itemId: string, itemStatus: string) {
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(res.body.error.details).toEqual({ itemId, itemStatus, reason: 'ITEM_FINAL' });
  }

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    customerToken = await h.login(E2E_USERS.customer.email, E2E_USERS.customer.password);
    operatorToken = await h.login(E2E_USERS.operator.email, E2E_USERS.operator.password);
    const card = await h.prisma.card.findUnique({ where: { externalId: E2E_CARDS.charizard.externalId } });
    charizardId = card!.id;
    const u = await h.prisma.user.findUnique({ where: { email: E2E_USERS.customer.email } });
    const addr = await h.prisma.address.findFirst({
      where: { userId: u!.id },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    addressId = addr!.id;
    capPrevio = await h.prisma.configSetting.findUnique({ where: { key: CAP_KEY }, select: { valueJson: true } });
    await h.prisma.configSetting.upsert({
      where: { key: CAP_KEY },
      update: { valueJson: 1_000_000_000 },
      create: { key: CAP_KEY, valueJson: 1_000_000_000 },
    });
    spy = jest.spyOn(h.app.get<MailPort>(MAIL_PORT), 'send').mockImplementation(async (msg: MailMessage) => {
      enviados.push(msg);
      return { id: 'e2e-mail' };
    });
  });

  beforeEach(() => {
    enviados = [];
  });

  afterAll(async () => {
    spy?.mockRestore();
    if (h) {
      if (capPrevio) {
        await h.prisma.configSetting.update({ where: { key: CAP_KEY }, data: { valueJson: capPrevio.valueJson as never } });
      } else {
        await h.prisma.configSetting.delete({ where: { key: CAP_KEY } }).catch(() => undefined);
      }
    }
    await h?.close();
  });

  it('BRJ-10 💰 `PATCH …/decision {reject}` sobre una carta `convertida_inventario` (8000) ⇒ 409 CONFLICT ITEM_FINAL; fila, total, pieza y bitácora idénticos; cero correos', async () => {
    const { srId, itemId, inventoryItemId } = await cartaConvertida();
    const antes = await foto(srId, itemId);
    expect(antes.item).toMatchObject({ itemStatus: 'convertida_inventario', approvedPriceCents: 8000, inventoryItemId });
    expect(antes.request.approvedTotalCents).toBe(8000);
    expect(antes.piezas).toEqual([{ id: inventoryItemId, status: 'in_stock', acquisitionCostCents: 8000 }]);
    enviados = [];
    const res = await decide(itemId, { decision: 'reject', reason: 'llegó doblada' });
    esItemFinal(res, itemId, 'convertida_inventario');
    expect(await foto(srId, itemId)).toEqual(antes);
    expect(enviados).toHaveLength(0);
  });

  it('BRJ-10b el mismo peldaño con la carta `pagada` (el otro estado del predicado), en los tres verbos', async () => {
    const { srId, items } = await solicitudDeTres();
    await siembra(srId, items);
    const itemId = items[0];
    await h.prisma.sellRequestItem.update({ where: { id: itemId }, data: { itemStatus: 'pagada', approvedPriceCents: 12000 } });
    const antes = await foto(srId, itemId);
    esItemFinal(await decide(itemId, { decision: 'reject', reason: 'llegó doblada' }), itemId, 'pagada');
    esItemFinal(await decide(itemId, { decision: 'approve' }), itemId, 'pagada');
    // `adjust` dentro del ciclo: ITEM_FINAL va ANTES de `ADJUST_NOT_ALLOWED_IN_OFFER_CYCLE` (escalera §PNL.10.2).
    esItemFinal(await decide(itemId, { decision: 'adjust', approvedPriceCents: 1 }), itemId, 'pagada');
    expect(await foto(srId, itemId)).toEqual(antes);
    expect(enviados).toHaveLength(0);
  });

  it('BRJ-10c la solicitud cerrada sigue ganando: `pagada` + carta convertida ⇒ 409 NO_LIVE_ADJUSTMENT (no ITEM_FINAL)', async () => {
    const { srId, itemId } = await cartaConvertida();
    await h.prisma.sellRequest.update({ where: { id: srId }, data: { status: 'pagada', closedAt: new Date() } });
    const res = await decide(itemId, { decision: 'reject', reason: 'llegó doblada' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NO_LIVE_ADJUSTMENT');
  });

  it('BRJ-11 💰 `approve` sobre la convertida (ciclo) y `adjust {1}` sobre una convertida LEGADO ⇒ 409 ITEM_FINAL; precio 8000 y estado intactos', async () => {
    const ciclo = await cartaConvertida();
    const antesC = await foto(ciclo.srId, ciclo.itemId);
    esItemFinal(await decide(ciclo.itemId, { decision: 'approve' }), ciclo.itemId, 'convertida_inventario');
    expect(await foto(ciclo.srId, ciclo.itemId)).toEqual(antesC);

    const legado = await cartaConvertida(true);
    const antesL = await foto(legado.srId, legado.itemId);
    expect(antesL.item).toMatchObject({ itemStatus: 'convertida_inventario', approvedPriceCents: 8000 });
    esItemFinal(await decide(legado.itemId, { decision: 'adjust', approvedPriceCents: 1 }), legado.itemId, 'convertida_inventario');
    esItemFinal(
      await decide(legado.itemId, { decision: 'approve', approvedPriceCents: 1 }),
      legado.itemId,
      'convertida_inventario',
    );
    const despues = await foto(legado.srId, legado.itemId);
    expect(despues).toEqual(antesL);
    expect(despues.item.approvedPriceCents).toBe(8000);
    const sr = await h.prisma.sellRequest.findUniqueOrThrow({ where: { id: legado.srId } });
    expect(sr.adjustmentSentAt).toBeNull();
    expect(enviados).toHaveLength(0);
  });

  it('BRJ-12 💰 la guarda del MOTOR sin el `if`: pre-check apagado por inyección ⇒ el `where` no casa y responde 409 ITEM_FINAL (no NO_LIVE_ADJUSTMENT); nada escrito', async () => {
    const { srId, itemId } = await cartaConvertida();
    const antes = await foto(srId, itemId);
    const svc = h.app.get(BuylistService);
    const apagado = jest
      .spyOn(svc as unknown as { assertItemNotFinal: (i: unknown) => void }, 'assertItemNotFinal')
      .mockImplementation(() => undefined);
    try {
      const res = await decide(itemId, { decision: 'reject', reason: 'llegó doblada' });
      expect(apagado).toHaveBeenCalled();
      esItemFinal(res, itemId, 'convertida_inventario');
    } finally {
      apagado.mockRestore();
    }
    expect(await foto(srId, itemId)).toEqual(antes);
    expect(enviados).toHaveLength(0);
  });

  it('BRJ-14 (candado) `reject-items` con una carta ya `rechazada` ⇒ 409 CONFLICT {itemIds:[esa]}; su `rejectedAt` y motivo idénticos; cero correos', async () => {
    const { srId, items } = await solicitudDeTres();
    await siembra(srId, items);
    expect((await decide(items[0], { decision: 'reject', reason: 'primera vez' })).status).toBe(200);
    const antes = await h.prisma.sellRequestItem.findUniqueOrThrow({ where: { id: items[0] } });
    enviados = [];
    const res = await rejectItems(srId, { itemIds: [items[0], items[2]], reason: 'segunda vez' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(res.body.error.details).toEqual({ itemIds: [items[0]] });
    const tras = await h.prisma.sellRequestItem.findUniqueOrThrow({ where: { id: items[0] } });
    expect({ r: tras.rejectedAt, m: tras.rejectionReason }).toEqual({ r: antes.rejectedAt, m: 'primera vez' });
    expect((await h.prisma.sellRequestItem.findUniqueOrThrow({ where: { id: items[2] } })).itemStatus).toBe('verificacion');
    expect(enviados).toHaveLength(0);
  });

  // ==========================================================================================
  // BRJ-13 — conversión y rechazo sobre la MISMA carta `aprobada`
  // ==========================================================================================
  describe('BRJ-13 🔁 💰 conversión contra rechazo: nunca convertida y rechazada a la vez', () => {
    /** Una ronda: solicitud nueva, carta 0 `aprobada` (12000) por HTTP. */
    async function aprobada() {
      const { srId, items } = await solicitudDeTres();
      await siembra(srId, items);
      expect((await decide(items[0], { decision: 'approve' })).status).toBe(200);
      return { srId, itemId: items[0] };
    }

    /**
     * El invariante de la ronda. Devuelve la etiqueta del desenlace; **lanza** si la carta quedó mixta.
     * `rej` es la respuesta del rechazo (PATCH o lote), `conv` la de la conversión.
     */
    async function desenlace(srId: string, itemId: string, conv: { status: number; body: any }, rej: { status: number; body: any }, lote: boolean) {
      const it = await h.prisma.sellRequestItem.findUniqueOrThrow({ where: { id: itemId } });
      const piezas = await h.prisma.inventoryItem.count({ where: { sourceSellRequestItemId: itemId } });
      const movimientos = await h.prisma.inventoryMovement.count({ where: { note: `from sellRequestItem ${itemId}` } });
      const sr = await h.prisma.sellRequest.findUniqueOrThrow({ where: { id: srId } });
      const tag = `conv ${conv.status}${conv.body?.error?.details?.reason ? `/${conv.body.error.details.reason}` : conv.body?.error?.code ? `/${conv.body.error.code}` : ''} · rej ${rej.status}${rej.body?.error?.details?.reason ? `/${rej.body.error.details.reason}` : ''} ⇒ ${it.itemStatus}${it.rejectedAt ? '+rejectedAt' : ''}${it.inventoryItemId ? '+inv' : ''} piezas=${piezas}`;
      const mixta =
        (it.itemStatus === 'convertida_inventario' && (it.rejectedAt != null || it.approvedPriceCents == null)) ||
        (it.itemStatus === 'rechazada' && (it.inventoryItemId != null || piezas > 0));
      if (mixta) return { tag, mixta: true };
      if (conv.status === 200) {
        expect(it).toMatchObject({ itemStatus: 'convertida_inventario', approvedPriceCents: 12000, rejectedAt: null });
        expect(piezas).toBe(1);
        expect(movimientos).toBe(1);
        expect(rej.status).toBe(409);
        if (lote) expect(rej.body.error.details).toEqual({ itemIds: [itemId] });
        else expect(rej.body.error.details).toEqual({ itemId, itemStatus: 'convertida_inventario', reason: 'ITEM_FINAL' });
        expect(sr.approvedTotalCents).toBe(12000);
      } else {
        expect(rej.status).toBe(200);
        expect(it).toMatchObject({ itemStatus: 'rechazada', approvedPriceCents: null, inventoryItemId: null });
        expect(piezas).toBe(0);
        // La tx de la conversión se deshizo ENTERA: tampoco queda su `InventoryMovement` (§PNL.10.3).
        expect(movimientos).toBe(0);
        expect([422, 409]).toContain(conv.status);
        if (conv.status === 422) expect(conv.body.error.code).toBe('ITEM_NOT_APPROVED');
        else expect(conv.body.error.details).toEqual({ itemId, itemStatus: 'rechazada', reason: 'CONCURRENT_UPDATE' });
        expect(sr.approvedTotalCents ?? 0).toBe(0);
      }
      return { tag, mixta: false };
    }

    /** Sostiene la fila de la CARTA DEL CATÁLOGO `FOR UPDATE`: la conversión se detiene en su `INSERT "InventoryItem"`. */
    function sostenerCartaCatalogo() {
      const puesto = diferida();
      const soltar = diferida();
      const tx = h.prisma.$transaction(
        async (t) => {
          await t.$executeRawUnsafe(`SELECT id FROM "Card" WHERE id = $1 FOR UPDATE`, charizardId);
          puesto.abrir();
          await soltar.promesa;
        },
        { timeout: 30000, maxWait: 30000 },
      );
      return { puesto: puesto.promesa, soltar: soltar.abrir, tx };
    }

    it.each([
      ['PATCH {reject}', false],
      ['reject-items', true],
    ])(
      '(a) ⭐⭐ FORZADO — la conversión LEE `aprobada`, el rechazo (%s) CONFIRMA entero, y la conversión escribe después ⇒ 409 CONCURRENT_UPDATE, cero piezas, carta rechazada limpia',
      async (_nombre, lote) => {
        const { srId, itemId } = await aprobada();
        const lock = sostenerCartaCatalogo();
        await lock.puesto;
        const pConv = convert(itemId);
        await esperarBloqueoDeFila(h.prisma, 'InventoryItem', 1);
        // La conversión ya leyó `aprobada` y está detenida ANTES de escribir la carta: el rechazo pasa entero.
        const rej = lote
          ? await rejectItems(srId, { itemIds: [itemId], reason: 'carrera' })
          : await decide(itemId, { decision: 'reject', reason: 'carrera' });
        expect(rej.status).toBe(200);
        lock.soltar();
        await lock.tx;
        const conv = await pConv;
        const d = await desenlace(srId, itemId, conv, rej, lote);
        expect(d.mixta ? `MIXTA: ${d.tag}` : d.tag).not.toMatch(/^MIXTA/);
        expect(conv.status).toBe(409);
        expect(conv.body.error.details).toEqual({ itemId, itemStatus: 'rechazada', reason: 'CONCURRENT_UPDATE' });
      },
    );

    it.each([
      ['PATCH {reject}', false],
      ['reject-items', true],
    ])(`(b) 🔁 N = ${N} rondas simultáneas (%s), sin forzar el orden: ninguna mixta; proporción al log`, async (nombre, lote) => {
      const tally: Record<string, number> = {};
      let mixtas = 0;
      for (let r = 0; r < N; r++) {
        const { srId, itemId } = await aprobada();
        const [conv, rej] = await Promise.all([
          convert(itemId),
          lote ? rejectItems(srId, { itemIds: [itemId], reason: 'carrera' }) : decide(itemId, { decision: 'reject', reason: 'carrera' }),
        ]);
        const d = await desenlace(srId, itemId, conv, rej, lote);
        if (d.mixta) mixtas++;
        tally[d.tag] = (tally[d.tag] ?? 0) + 1;
      }
      // eslint-disable-next-line no-console
      console.log(`[BRJ-13 (b) ${nombre}] mixtas ${mixtas}/${N} · N=${N} · ${JSON.stringify(tally)}`);
      expect(mixtas).toBe(0);
    }, 300_000);
  });
});
