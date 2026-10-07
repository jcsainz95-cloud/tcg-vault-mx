/**
 * sealed-restock-armed.e2e-spec.ts — rev v1.87⟨wishlist⟩ (API_CONTRACT §WSH.7, criterio 823; D-WSH-1…4): el «avísame cuando
 * vuelva» de sellados encendido y completo, contra la app REAL y Postgres real. Reloj MANUAL (`'WISHLIST_CLOCK'`, el mismo
 * token en `catalog`), correo que CAPTURA.
 *
 *  WSH-T25 — dos suscripciones del mismo correo ⇒ 1 correo con enlace `sellado/{id}` de una pieza vendible; segunda
 *            reposición ⇒ 0 correos.
 *  WSH-T26 — apuntarse con existencia ⇒ 0 correos hasta que se agota y vuelve (armado).
 *  WSH-T27 — dial `off` ⇒ `404 FEATURE_DISABLED` al apuntarse y job no-op.
 *  WSH-T28 — con sesión se guarda el correo de la cuenta; 6.ª pendiente del mismo correo ⇒ 202 sin fila.
 */
import { createWshWorld, WshWorld } from './helpers/wishlist-db';

let w: WshWorld;
const MIN = 60_000;

beforeAll(async () => {
  w = await createWshWorld();
});
afterAll(async () => {
  await w?.setDial('sealed_restock_alerts', 'off');
  await w?.close();
});
beforeEach(async () => {
  await w.resetDials();
  await w.setDial('sealed_restock_alerts', 'on');
  w.mail.reset();
});

let prodSeq = 0;
async function product() {
  prodSeq += 1;
  const c = await w.card({ finishes: ['normal'] });
  const tcg = 700000000 + Math.floor(Math.random() * 99999999) + prodSeq;
  const mk = (status: 'listed' | 'in_custody' = 'listed', listCents = 200000) =>
    w.piece(c.id, {
      productType: 'sealed',
      rawCondition: null,
      sealedSubtype: 'box',
      sealedCondition: 'mint',
      tcgplayerProductId: tcg,
      sealedProductName: `Caja Avísame ${w.run} ${prodSeq}`,
      status,
      listCents,
    });
  return { cardId: c.id, tcg, mk, name: `Caja Avísame ${w.run} ${prodSeq}` };
}
const subscribe = (json: Record<string, unknown>, token?: string) =>
  w.h.api('POST', '/catalog/sealed/restock-subscriptions', { token, json });
const runJob = async () => {
  const r = await w.h.api('POST', '/admin/jobs/sealed-restock-notify', { token: w.adminToken, json: {} });
  expect(r.status).toBe(202);
  return r.body;
};
const soldOut = (cardId: string) =>
  w.h.prisma.inventoryItem.updateMany({ where: { cardId, status: 'listed' }, data: { status: 'in_custody' } });

describe('WSH-T26 — armado: apuntarse con existencia no avisa hasta que se agota y vuelve', () => {
  it('con existencia ⇒ 0 correos; se agota (arma); vuelve ⇒ espera la ventana ⇒ 1 correo', async () => {
    const p = await product();
    await p.mk();
    const email = `armed-${w.run}@e2e.local`;
    expect((await subscribe({ email, tcgplayerProductId: p.tcg, sealedCondition: 'mint' })).status).toBe(202);
    await runJob();
    w.clock.advance(60 * MIN);
    await runJob();
    expect(w.mailsTo(email)).toHaveLength(0);
    const sub = await w.h.prisma.sealedRestockSubscription.findFirstOrThrow({ where: { email } });
    expect(sub.armedAt).toBeNull();

    await soldOut(p.cardId);
    await runJob();
    expect((await w.h.prisma.sealedRestockSubscription.findUniqueOrThrow({ where: { id: sub.id } })).armedAt).not.toBeNull();
    expect(w.mailsTo(email)).toHaveLength(0);

    const back = await p.mk();
    await runJob();
    const matched = await w.h.prisma.sealedRestockSubscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(matched.matchedAt).not.toBeNull();
    expect(w.mailsTo(email)).toHaveLength(0); // ventana de agrupado
    w.clock.advance(31 * MIN);
    await runJob();
    const m = w.mailsTo(email);
    expect(m).toHaveLength(1);
    expect(m[0].html).toContain(`/es/sellado/${back}`);
  });
});

describe('WSH-T25 — un correo por correo y producto; una sola vez', () => {
  it('dos suscripciones del mismo correo ⇒ 1 correo con enlace a una pieza vendible; segunda reposición ⇒ 0', async () => {
    const p = await product();
    await p.mk();
    const email = `twice-${w.run}@e2e.local`;
    await subscribe({ email, tcgplayerProductId: p.tcg, sealedCondition: 'mint' });
    await subscribe({ email: email.toUpperCase(), tcgplayerProductId: p.tcg, sealedCondition: 'mint' });
    expect(await w.h.prisma.sealedRestockSubscription.count({ where: { email } })).toBe(1); // capa 1
    // capa 2: una fila duplicada que ganó la carrera de la capa 1
    await w.h.prisma.sealedRestockSubscription.create({ data: { email, cardId: p.cardId, tcgplayerProductId: p.tcg, sealedCondition: 'mint', sealedSubtype: 'box' } });
    await soldOut(p.cardId);
    await runJob();
    const cheap = await p.mk('listed', 150000);
    await p.mk('listed', 250000);
    await runJob();
    w.clock.advance(31 * MIN);
    await runJob();
    const m = w.mailsTo(email);
    expect(m).toHaveLength(1);
    expect(m[0].html).toContain(`/es/sellado/${cheap}`);
    expect(m[0].html.split(p.name).length - 1).toBeGreaterThanOrEqual(1);
    const rows = await w.h.prisma.sealedRestockSubscription.findMany({ where: { email } });
    expect(rows.every((r) => r.notifiedAt !== null)).toBe(true);

    await soldOut(p.cardId);
    await runJob();
    await p.mk();
    await runJob();
    w.clock.advance(31 * MIN);
    await runJob();
    expect(w.mailsTo(email)).toHaveLength(1);
  });
});

describe('WSH-T27 — dial `off`', () => {
  it('apuntarse ⇒ 404 FEATURE_DISABLED; job no-op', async () => {
    const p = await product();
    await w.setDial('sealed_restock_alerts', 'off');
    const r = await subscribe({ email: `off-${w.run}@e2e.local`, tcgplayerProductId: p.tcg, sealedCondition: 'mint' });
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('FEATURE_DISABLED');
    const j = await runJob();
    expect(j).toEqual({ job: 'sealed-restock-notify', enqueued: false, reason: 'SEALED_RESTOCK_ALERTS_OFF' });
  });
});

describe('WSH-T28 — anti-abuso de correo ajeno (WSH.7 (b))', () => {
  it('con sesión se guarda el correo de la CUENTA (se ignora dto.email); la 6.ª pendiente del mismo correo ⇒ 202 sin fila', async () => {
    const a = await w.customer();
    const p = await product();
    const r = await subscribe({ email: `victima-${w.run}@e2e.local`, cardId: p.cardId, sealedSubtype: 'box', tcgplayerProductId: p.tcg, sealedCondition: 'mint' }, a.token);
    expect(r.status).toBe(202);
    expect(await w.h.prisma.sealedRestockSubscription.count({ where: { email: `victima-${w.run}@e2e.local` } })).toBe(0);
    const mine = await w.h.prisma.sealedRestockSubscription.findFirstOrThrow({ where: { email: a.email } });
    expect(mine.userId).toBe(a.id);

    const victim = `cap-${w.run}@e2e.local`;
    for (let i = 0; i < 5; i += 1) {
      const q = await product();
      expect((await subscribe({ email: victim, cardId: q.cardId, sealedSubtype: 'box', tcgplayerProductId: q.tcg, sealedCondition: 'mint' })).status).toBe(202);
    }
    expect(await w.h.prisma.sealedRestockSubscription.count({ where: { email: victim } })).toBe(5);
    const sixth = await product();
    const r6 = await subscribe({ email: victim, cardId: sixth.cardId, sealedSubtype: 'box', tcgplayerProductId: sixth.tcg, sealedCondition: 'mint' });
    expect(r6.status).toBe(202);
    expect(r6.body).toEqual({ subscribed: true });
    expect(await w.h.prisma.sealedRestockSubscription.count({ where: { email: victim } })).toBe(5);
  });
});
