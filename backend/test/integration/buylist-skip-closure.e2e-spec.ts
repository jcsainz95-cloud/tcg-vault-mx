/**
 * `buylist-skip-closure.e2e-spec.ts` — **v1.82.3 · §PNL.12 «Regla C»: las líneas `skip` NO cuentan para cerrar
 * la solicitud** — POR HTTP, CONTRA POSTGRES REAL. Propiedad: backend. Norma: `API_CONTRACT §PNL.12`
 * (ARCHITECTURE §4.61.9); pruebas SKP-1…6 de §PNL.12.2.
 *
 * ```
 * Línea que CUENTA  :=  offerDecision IS NULL  OR  offerDecision <> 'skip'     (OR explícito: columna NULLABLE)
 * Regla C           :=  ∃ ≥1 línea que cuenta  ∧  toda línea que cuenta está `rechazada`
 * ```
 * Cuatro sitios, UNA regla: (a) auto-cierre, (b) guard de `POST …/reject`, (c) `rejectedReason`, (d) `isRejectable`.
 * La `skip` **nunca se escribe** (ni `itemStatus`, ni `rejectedAt`, ni `rejectionReason`, ni correo).
 *
 * Patrón de `buylist-reject-items.e2e-spec.ts`: la solicitud nace por la PUERTA, el ESTADO se siembra por
 * `h.prisma`, la CONDUCTA va por HTTP.
 */
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { E2E_CARDS, E2E_USERS } from '../../prisma/e2e-fixtures';
import { MAIL_PORT, MailMessage, MailPort } from '../../src/modules/mail/mail.port';

const CLABE_A = '012345678901234567';
const OFFERED = [12000, 8000, 5000] as const;

/** Las dos formas de la Regla C que el contrato permite (§PNL.12.1: «una vez como `where`, una vez pura»). */
type ReglaC = {
  closesAsRejected: (items: readonly { itemStatus: string; offerDecision?: string | null }[]) => boolean;
  readClosureRule: (
    db: unknown,
    sellRequestId: string,
  ) => Promise<{ countingItems: number; nonRejectedItemStatuses: string[] }>;
  closesAsRejectedByWhere: (r: { countingItems: number; nonRejectedItemStatuses: string[] }) => boolean;
};

describe('E2E — v1.82.3 §PNL.12 · las líneas `skip` no cuentan para cerrar la solicitud (SKP-1…6)', () => {
  let h: E2EHarness;
  let customerToken: string;
  let operatorToken: string;
  let charizardId: string;
  let addressId: string;
  let enviados: MailMessage[];
  let spy: jest.SpyInstance;

  async function solicitudDeTres(): Promise<{ srId: string; items: string[] }> {
    const created = await h.api('POST', '/buylist/requests', {
      token: customerToken,
      json: {
        items: [{ cardId: charizardId, productType: 'raw', rawCondition: 'NM' }],
        clabe: CLABE_A,
        addressId,
      },
    });
    expect(created.status).toBe(201);
    const srId = created.body.sellRequestId as string;
    const first = await h.prisma.sellRequestItem.findFirstOrThrow({ where: { sellRequestId: srId } });
    const { id: _id, ...clon } = first;
    const extra = [];
    for (let i = 0; i < 2; i++) extra.push((await h.prisma.sellRequestItem.create({ data: { ...clon } })).id);
    return { srId, items: [first.id, ...extra] };
  }

  /**
   * `verificacion` DEL CICLO (oferta enviada y aceptada): las dos primeras líneas `buy` en revisión y la 3.ª
   * `skip` (no la compramos; llegó en el paquete). La `skip` conserva el `itemStatus` con el que nació.
   */
  async function cicloConSkip(srId: string, items: string[]) {
    await h.prisma.sellRequest.update({
      where: { id: srId },
      data: {
        status: 'verificacion',
        closedAt: null,
        receivedAt: new Date(),
        verifiedAt: new Date(),
        offerSentAt: new Date(),
        acceptedAt: new Date(),
        approvedTotalCents: null,
      },
    });
    for (const [i, id] of items.entries()) {
      const skip = i === 2;
      await h.prisma.sellRequestItem.update({
        where: { id },
        data: {
          itemStatus: 'verificacion',
          offerDecision: skip ? 'skip' : 'buy',
          offeredPriceCents: skip ? null : OFFERED[i],
          approvedPriceCents: null,
          rejectedAt: null,
          rejectionReason: null,
          inventoryItemId: null,
        },
      });
    }
  }

  /** Pre-ciclo (`offerSentAt IS NULL`): toda línea con `offerDecision = null`. Solo las dos primeras. */
  async function preCiclo(srId: string, items: string[]) {
    await h.prisma.sellRequestItem.delete({ where: { id: items[2] } });
    await h.prisma.sellRequest.update({
      where: { id: srId },
      data: {
        status: 'verificacion',
        closedAt: null,
        receivedAt: new Date(),
        verifiedAt: new Date(),
        offerSentAt: null,
        acceptedAt: null,
        approvedTotalCents: null,
      },
    });
    for (const id of items.slice(0, 2)) {
      await h.prisma.sellRequestItem.update({
        where: { id },
        data: { itemStatus: 'verificacion', offerDecision: null, approvedPriceCents: null, rejectedAt: null, rejectionReason: null },
      });
    }
  }

  const rejectItems = (srId: string, json: unknown) =>
    h.api('POST', `/admin/buylist/${srId}/reject-items`, { token: operatorToken, json });
  const decide = (itemId: string, json: Record<string, unknown>) =>
    h.api('PATCH', `/admin/buylist/items/${itemId}/decision`, { token: operatorToken, json });
  const rejectRequest = (srId: string) =>
    h.api('POST', `/admin/buylist/${srId}/reject`, { token: operatorToken, json: { reason: 'cartas compradas rechazadas' } });
  const adminGet = (srId: string) => h.api('GET', `/admin/buylist/${srId}`, { token: operatorToken });
  const sellerGet = (srId: string) => h.api('GET', `/buylist/requests/${srId}`, { token: customerToken });

  /**
   * Correos de ESTE flujo. Se excluye el aviso «Se actualizó tu CLABE», que dispara la creación de la
   * solicitud (best-effort, sin `await`) y puede caer dentro de la ventana de la prueba.
   */
  const correos = () => enviados.filter((m) => !/CLABE/.test(m.subject));

  async function skipIntacta(skipId: string, itemStatusAntes: string) {
    const s = await h.prisma.sellRequestItem.findUniqueOrThrow({ where: { id: skipId } });
    expect(s.offerDecision).toBe('skip');
    expect(s.itemStatus).toBe(itemStatusAntes);
    expect(s.rejectedAt).toBeNull();
    expect(s.rejectionReason).toBeNull();
  }

  async function reglaC(): Promise<ReglaC> {
    return (await import('../../src/modules/buylist/buylist-reject.constants')) as unknown as ReglaC;
  }

  /** SKP-6: la MISMA fila por el `where` (Postgres) y por la función pura (sus líneas) dice lo mismo. */
  async function mismaRespuesta(srId: string): Promise<boolean> {
    const rc = await reglaC();
    const rows = await h.prisma.sellRequestItem.findMany({
      where: { sellRequestId: srId },
      select: { itemStatus: true, offerDecision: true },
    });
    const pura = rc.closesAsRejected(rows);
    const porWhere = rc.closesAsRejectedByWhere(await rc.readClosureRule(h.prisma, srId));
    expect(porWhere).toBe(pura);
    return pura;
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
    await h?.close();
  });

  it('SKP-1 ⭐ ciclo, 2 `buy` + 1 `skip`; `reject-items` de las 2 `buy` ⇒ 200, requestClosed, `rechazada`+closedAt; la `skip` intacta; UN correo (29)', async () => {
    const { srId, items } = await solicitudDeTres();
    await cicloConSkip(srId, items);
    const res = await rejectItems(srId, { itemIds: [items[0], items[1]], reason: 'llegaron dañadas' });
    expect(res.status).toBe(200);
    expect(res.body.requestClosed).toBe(true);
    const sr = await h.prisma.sellRequest.findUniqueOrThrow({ where: { id: srId } });
    expect(sr.status).toBe('rechazada');
    expect(sr.closedAt).toBeInstanceOf(Date);
    expect(sr.approvedTotalCents).toBeNull();
    await skipIntacta(items[2], 'verificacion');
    expect(correos().map((m) => m.subject)).toEqual(['2 cartas de tu solicitud de venta no fueron aceptadas']);
    expect(correos()[0].text).toContain('tu solicitud queda cerrada y no hay pago');
  });

  it('SKP-2 igual, pero la última `buy` se rechaza con `PATCH …/decision {reject}` ⇒ se cierra; la `skip` intacta; solo el correo por carta', async () => {
    const { srId, items } = await solicitudDeTres();
    await cicloConSkip(srId, items);
    expect((await decide(items[0], { decision: 'reject', reason: 'dañada' })).status).toBe(200);
    expect((await h.prisma.sellRequest.findUniqueOrThrow({ where: { id: srId } })).status).toBe('verificacion');
    enviados = [];
    expect((await decide(items[1], { decision: 'reject', reason: 'dañada' })).status).toBe(200);
    const sr = await h.prisma.sellRequest.findUniqueOrThrow({ where: { id: srId } });
    expect(sr.status).toBe('rechazada');
    expect(sr.closedAt).toBeInstanceOf(Date);
    await skipIntacta(items[2], 'verificacion');
    expect(correos()).toHaveLength(1);
  });

  it('SKP-3 + SKP-6 ⭐ fila YA atorada (`buy` todas `rechazada`, `skip` viva, `verificacion`): `POST …/reject` ⇒ 200 `rechazada`+closedAt; skip intacta; CERO correos; auditado; proyección antes/después', async () => {
    const { srId, items } = await solicitudDeTres();
    await cicloConSkip(srId, items);
    // Escritas ANTES (como las dejó el defecto): el auto-cierre de entonces no cerró.
    await h.prisma.sellRequestItem.updateMany({
      where: { id: { in: [items[0], items[1]] } },
      data: { itemStatus: 'rechazada', rejectedAt: new Date(), rejectionReason: 'dañada' },
    });
    // SKP-6 (antes): rechazable, y las dos formas de la regla coinciden.
    expect(await mismaRespuesta(srId)).toBe(true);
    const antes = await adminGet(srId);
    expect(antes.status).toBe(200);
    expect(antes.body.isTerminal).toBe(false);
    expect(antes.body.isRejectable).toBe(true);

    const res = await rejectRequest(srId);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('rechazada');
    expect(res.body.isRejectable).toBe(false);
    const sr = await h.prisma.sellRequest.findUniqueOrThrow({ where: { id: srId } });
    expect(sr.status).toBe('rechazada');
    expect(sr.closedAt).toBeInstanceOf(Date);
    await skipIntacta(items[2], 'verificacion');
    expect(correos()).toHaveLength(0);
    const log = await h.prisma.auditLog.findFirst({ where: { entityId: srId, action: 'buylist.reject' } });
    expect(log).not.toBeNull();

    // SKP-6 (después): terminal, ya no rechazable, y la causa honesta para el vendedor.
    const despues = await adminGet(srId);
    expect(despues.body.isTerminal).toBe(true);
    expect(despues.body.isRejectable).toBe(false);
    const vendedor = await sellerGet(srId);
    expect(vendedor.status).toBe(200);
    expect(vendedor.body.rejectedReason).toBe('all_items_rejected');
    // ⛔ admin-only.
    expect(vendedor.body).not.toHaveProperty('isRejectable');
  });

  it('SKP-4 💰 1 `buy` `aprobada` + 1 `buy` `rechazada` + 1 `skip` ⇒ NO cierra; `POST …/reject` ⇒ 422 {nonRejectedItemStatuses:[aprobada]}; isRejectable false', async () => {
    const { srId, items } = await solicitudDeTres();
    await cicloConSkip(srId, items);
    expect((await decide(items[0], { decision: 'approve' })).status).toBe(200);
    const r = await rejectItems(srId, { itemIds: [items[1]], reason: 'dañada' });
    expect(r.status).toBe(200);
    expect(r.body.requestClosed).toBe(false);
    let sr = await h.prisma.sellRequest.findUniqueOrThrow({ where: { id: srId } });
    expect(sr.status).toBe('verificacion');
    expect(sr.closedAt).toBeNull();
    expect(sr.approvedTotalCents).toBe(OFFERED[0]);
    enviados = [];
    const res = await rejectRequest(srId);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('REQUEST_HAS_NON_REJECTED_ITEMS');
    expect(res.body.error.details).toEqual({ nonRejectedItemStatuses: ['aprobada'] });
    sr = await h.prisma.sellRequest.findUniqueOrThrow({ where: { id: srId } });
    expect(sr.status).toBe('verificacion');
    expect(sr.closedAt).toBeNull();
    expect(sr.approvedTotalCents).toBe(OFFERED[0]);
    expect(correos()).toHaveLength(0);
    const g = await adminGet(srId);
    expect(g.body.isRejectable).toBe(false);
    // SKP-6: las dos formas coinciden también aquí.
    expect(await mismaRespuesta(srId)).toBe(false);
  });

  it('SKP-5 pre-ciclo (`offerDecision` null en todas), 2 líneas, se rechaza 1 ⇒ NO cierra (como hoy); isRejectable false', async () => {
    const { srId, items } = await solicitudDeTres();
    await preCiclo(srId, items);
    expect((await decide(items[0], { decision: 'reject', reason: 'dañada' })).status).toBe(200);
    const sr = await h.prisma.sellRequest.findUniqueOrThrow({ where: { id: srId } });
    expect(sr.status).toBe('verificacion');
    expect(sr.closedAt).toBeNull();
    expect((await adminGet(srId)).body.isRejectable).toBe(false);
    expect(await mismaRespuesta(srId)).toBe(false);
  });

  it('SKP-5b pre-ciclo, se rechazan las 2 ⇒ SÍ cierra (como hoy): las líneas `null` CUENTAN (la trampa del NULL, del otro lado)', async () => {
    const { srId, items } = await solicitudDeTres();
    await preCiclo(srId, items);
    expect((await decide(items[0], { decision: 'reject', reason: 'dañada' })).status).toBe(200);
    expect(await mismaRespuesta(srId)).toBe(false);
    expect((await decide(items[1], { decision: 'reject', reason: 'dañada' })).status).toBe(200);
    const sr = await h.prisma.sellRequest.findUniqueOrThrow({ where: { id: srId } });
    expect(sr.status).toBe('rechazada');
    expect(sr.closedAt).toBeInstanceOf(Date);
    expect(await mismaRespuesta(srId)).toBe(true);
  });

  it('SKP-6b solo `skip` vivas (0 líneas que cuentan) ⇒ `POST …/reject` 422 fail-closed con los estados de todas; isRejectable false; nada se escribe', async () => {
    const { srId, items } = await solicitudDeTres();
    await cicloConSkip(srId, items);
    await h.prisma.sellRequestItem.updateMany({
      where: { id: { in: items } },
      data: { offerDecision: 'skip', offeredPriceCents: null },
    });
    expect(await mismaRespuesta(srId)).toBe(false);
    expect((await adminGet(srId)).body.isRejectable).toBe(false);
    const res = await rejectRequest(srId);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('REQUEST_HAS_NON_REJECTED_ITEMS');
    expect(res.body.error.details).toEqual({ nonRejectedItemStatuses: ['verificacion'] });
    const sr = await h.prisma.sellRequest.findUniqueOrThrow({ where: { id: srId } });
    expect(sr.status).toBe('verificacion');
    for (const id of items) await skipIntacta(id, 'verificacion');
  });
});
