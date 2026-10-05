/**
 * `disputes-discontinued.e2e-spec.ts` — **v1.82 · PNL-1: disputas fuera de la tienda y UN buzón de
 * soporte** — POR HTTP, CONTRA POSTGRES REAL. Propiedad: backend. Norma: `API_CONTRACT §PNL.1`,
 * pruebas `§PNL.8` DSC-1…DSC-7 (DSC-8 es el barrido estático `test/support-contact.single-resolver.spec.ts`).
 *
 * - **DSC-1** cliente con una pieza propia que HOY daría `201` ⇒ `410 DISPUTES_DISCONTINUED`,
 *   `details.supportContact` = `GET /support/contact`; 0 filas `Dispute`.
 * - **DSC-2** id inexistente y cuerpo vacío ⇒ el MISMO `410` (nada se valida ni se lee antes).
 * - **DSC-3** sin sesión ⇒ `401`.
 * - **DSC-4** disputa abierta sembrada por SQL ⇒ `GET /disputes`, `GET /admin/disputes` y `resolve reject`
 *   siguen `200` (transición).
 * - **DSC-5** `GET /support/contact` sin sesión ⇒ `200 { contact }` no vacío, cacheable.
 * - **DSC-6** `SUPPORT_EMAIL='a@x'`, `DISPUTE_EVIDENCE_CONTACT='b@x'` ⇒ `/support/contact`, el seguimiento del
 *   invitado y el correo de buylist dicen `a@x`.
 * - **DSC-7** `SUPPORT_EMAIL=''`, `DISPUTE_EVIDENCE_CONTACT='  b@x '` ⇒ `b@x`.
 *
 * El resolutor lee la env **en cada llamada** (`mail/support-contact.ts`), así que fijarla en la prueba
 * con la app ya levantada mide la cascada de verdad (con las constantes de antes, fijadas al importar,
 * esto habría medido el valor del arranque).
 */
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { ShipPrepDb } from './helpers/ship-prep-db';
import { OrderAccessTokenService } from '../../src/modules/orders/order-access-token.service';
import { MAIL_PORT, MailPort } from '../../src/modules/mail/mail.port';
import { sellItemRejectedTemplate } from '../../src/modules/buylist/buylist-mail.templates';

const RUN = `dsc${Date.now().toString(36)}`;

describe('E2E — v1.82 PNL-1 · `POST /disputes` ⇒ 410 y `GET /support/contact`', () => {
  let h: E2EHarness;
  let db: ShipPrepDb;
  let spy: jest.SpyInstance;
  const disputeIds: string[] = [];
  const ENV_KEYS = ['SUPPORT_EMAIL', 'DISPUTE_EVIDENCE_CONTACT'] as const;
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    db = new ShipPrepDb(h, RUN);
    await db.init();
    spy = jest.spyOn(h.app.get<MailPort>(MAIL_PORT), 'send').mockImplementation(async () => ({}));
    for (const k of ENV_KEYS) saved[k] = process.env[k];
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  afterAll(async () => {
    spy?.mockRestore();
    await h.prisma.auditLog.deleteMany({ where: { entityId: { in: disputeIds } } });
    await h.prisma.dispute.deleteMany({ where: { id: { in: disputeIds } } });
    await db.cleanup();
    await h?.close();
  });

  /** Una pieza `raw` del cliente, en custodia y con envío entregado hace 1 día: HOY (v1.81) daba `201`. */
  async function piezaDisputable(userId: string) {
    const piece = await db.mkPiece({ status: 'in_custody', ownerType: 'customer', ownerUserId: userId, ownershipStatus: 'settled' });
    return piece;
  }

  it('DSC-1 ⭐ cliente con pieza disputable ⇒ 410 DISPUTES_DISCONTINUED { supportContact = GET /support/contact }; 0 filas `Dispute`', async () => {
    const u = await db.mkUser('DSC-1');
    const tok = await db.loginCustomer(u.email!);
    const piece = await piezaDisputable(u.id);
    const antes = await h.prisma.dispute.count();
    const res = await h.api('POST', '/disputes', {
      token: tok,
      json: { inventoryItemId: piece.id, description: 'llegó dañada' },
    });
    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe('DISPUTES_DISCONTINUED');
    const contact = await h.api('GET', '/support/contact');
    expect(res.body.error.details).toEqual({ supportContact: contact.body.contact });
    expect(await h.prisma.dispute.count()).toBe(antes);
    expect(await h.prisma.dispute.count({ where: { inventoryItemId: piece.id } })).toBe(0);
    // Cero bitácora con esa pieza.
    expect(await h.prisma.auditLog.count({ where: { entityId: piece.id } })).toBe(0);
  });

  it('DSC-2 id inexistente + cuerpo vacío / cuerpo basura / pieza AJENA ⇒ el MISMO 410 (ni 400, ni 403, ni 422)', async () => {
    const u = await db.mkUser('DSC-2');
    const tok = await db.loginCustomer(u.email!);
    const otro = await db.mkUser('DSC-2-otro');
    const ajena = await piezaDisputable(otro.id);
    const graded = await db.mkPiece({ status: 'in_custody', ownerType: 'customer', ownerUserId: u.id, ownershipStatus: 'settled' });
    await h.prisma.inventoryItem.update({ where: { id: graded.id }, data: { productType: 'graded' } });
    const cuerpos: unknown[] = [
      undefined,
      {},
      { inventoryItemId: '00000000-0000-4000-8000-000000000000', description: 'x' },
      { inventoryItemId: 42 },
      { inventoryItemId: ajena.id, description: 'no es mía' },
      { inventoryItemId: graded.id, description: 'slab' },
    ];
    const respuestas = [];
    for (const json of cuerpos) {
      respuestas.push(await h.api('POST', '/disputes', { token: tok, ...(json === undefined ? {} : { json }) }));
    }
    for (const r of respuestas) {
      expect(r.status).toBe(410);
      expect(r.body).toEqual(respuestas[0].body);
    }
    expect(await h.prisma.dispute.count({ where: { userId: u.id } })).toBe(0);
  });

  it('DSC-3 sin sesión ⇒ 401', async () => {
    const res = await h.api('POST', '/disputes', { json: { inventoryItemId: 'x', description: 'y' } });
    expect(res.status).toBe(401);
  });

  it('DSC-4 disputa abierta sembrada por SQL ⇒ `GET /disputes`, `GET /disputes/:id`, `GET /admin/disputes` y `resolve reject` siguen 200', async () => {
    const u = await db.mkUser('DSC-4');
    const tok = await db.loginCustomer(u.email!);
    const piece = await piezaDisputable(u.id);
    const d = await h.prisma.dispute.create({
      data: {
        userId: u.id,
        inventoryItemId: piece.id,
        type: 'condition_raw',
        status: 'abierta',
        description: 'E2E · DSC-4',
        deadlineAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      },
    });
    disputeIds.push(d.id);
    const mine = await h.api('GET', '/disputes', { token: tok });
    expect(mine.status).toBe(200);
    expect(mine.body.data.map((x: { id: string }) => x.id)).toEqual([d.id]);
    expect(mine.body.data[0].evidenceContact).toEqual(expect.any(String));
    const one = await h.api('GET', `/disputes/${d.id}`, { token: tok });
    expect(one.status).toBe(200);
    const admin = await h.api('GET', `/admin/disputes?userId=${u.id}`, { token: db.opToken });
    expect(admin.status).toBe(200);
    expect(admin.body.data.map((x: { id: string }) => x.id)).toEqual([d.id]);
    const resolved = await h.api('POST', `/admin/disputes/${d.id}/resolve`, {
      token: db.opToken,
      json: { resolution: 'reject', note: 'E2E · DSC-4' },
    });
    expect(resolved.status).toBe(200);
    expect((await h.prisma.dispute.findUnique({ where: { id: d.id } }))!.status).toBe('rechazada');
  });

  it('DSC-5 ⭐ `GET /support/contact` sin sesión ⇒ 200 { contact } no vacío, `Cache-Control: public, max-age=300`', async () => {
    const res = await h.api('GET', '/support/contact');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(['contact']);
    expect(typeof res.body.contact).toBe('string');
    expect(res.body.contact.trim().length).toBeGreaterThan(0);
    expect(res.headers['cache-control']).toBe('public, max-age=300');
  });

  it('DSC-6 ⭐ `SUPPORT_EMAIL=a@x` y `DISPUTE_EVIDENCE_CONTACT=b@x` ⇒ /support/contact, el seguimiento del invitado, el 410 y el correo de buylist dicen `a@x`', async () => {
    process.env.SUPPORT_EMAIL = 'a@x';
    process.env.DISPUTE_EVIDENCE_CONTACT = 'b@x';
    const contact = await h.api('GET', '/support/contact');
    expect(contact.body).toEqual({ contact: 'a@x' });

    const d = await db.mkDirect({ userId: null, guestEmail: `dsc6.${RUN}@e2e.local` });
    const { clear } = await h.app.get(OrderAccessTokenService).issue(d.order.id);
    const track = await h.api('POST', '/orders/guest/track', { json: { token: clear } });
    expect(track.status).toBe(200);
    expect(track.body.support.evidenceContact).toBe('a@x');

    const u = await db.mkUser('DSC-6');
    const gone = await h.api('POST', '/disputes', { token: await db.loginCustomer(u.email!), json: {} });
    expect(gone.body.error.details.supportContact).toBe('a@x');

    const mail = sellItemRejectedTemplate(
      { cardName: 'Pikachu', setName: 'Base', cardNumber: '58', finish: 'normal', reason: 'dañada', returnDeadlineAt: null, abandonDeadlineAt: null },
      'Vendedor',
      'es',
    );
    expect(mail.text).toContain('a@x');
    expect(mail.text).not.toContain('b@x');
    expect(mail.html).not.toContain('b@x'); // el pie del shell también sale del mismo resolutor
  });

  it('DSC-7 `SUPPORT_EMAIL=\'\'` y `DISPUTE_EVIDENCE_CONTACT=\'  b@x \'` ⇒ `b@x` (saneado)', async () => {
    process.env.SUPPORT_EMAIL = '';
    process.env.DISPUTE_EVIDENCE_CONTACT = '  b@x ';
    const contact = await h.api('GET', '/support/contact');
    expect(contact.body).toEqual({ contact: 'b@x' });
  });
});
