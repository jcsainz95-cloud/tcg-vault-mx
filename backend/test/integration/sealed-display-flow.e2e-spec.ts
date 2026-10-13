/**
 * sealed-display-flow.e2e-spec.ts — Integración/E2E contra Postgres REAL (app Nest completa por HTTP,
 * puerto de correo espiado, doble de Stripe OFFLINE). Propiedad: backend.
 *
 * ⭐ v1.94.1⟨sellado-display⟩ / ARCHITECTURE §5.2.6-D — LA SUITE QUE FALTABA. El unitario
 * `test/sealed-display.be.spec.ts` fija el cuerpo PURO y las proyecciones server-side; ESTA suite cruza
 * BD/HTTP de punta a punta sobre el flujo de un SELLADO, que es justo donde se escaparon los 3 accesos
 * aliaseados que el `grep '\.card\.name'` no vio. Para cada superficie: se ve el `SealedProduct.name`/imagen
 * de la caja, ⛔ NUNCA el nombre/arte/numero del single ancla.
 *
 * Cubre (identidad de display; money-safe, ⛔ no toca importes):
 *   A) **Holdings (D-2, cara al cliente)** — `GET /vault/holdings`: el holding sellado trae su
 *      `sealedProductName`, no el ancla.
 *   B) **Pedidos por preparar (operador)** — `GET /admin/shipments/picking-list`: la línea del retiro
 *      pinta el nombre del sellado (regresión de la superficie #1, ya resuelta).
 *   C) **Acta del pedido (`GET /orders/:id`)** — la línea congelada CORRECTA del sellado se lee como tal.
 *   D) **Rastreo del cliente registrado (ESCAPE #1, BLOQUEANTE)** — `GET /shipments/:id`
 *      (`ClientShipmentItemDTO`): name + imagen del sellado, `productType='sealed'`, `number` del ancla
 *      presente (el front lo oculta por `productType`).
 *   E) **Rastreo del invitado (ESCAPE #2)** — `POST /orders/guest/track` (`GuestTrackingItemDTO`): name
 *      Y la IMAGEN salen del resolutor (la caja), no del single ancla.
 *   F) **Correo de reembolso AV-12 (ESCAPE #3)** — `RefundLedgerService.notifyCustomer` sobre un caso de
 *      retiro cuyo acta de origen quedó en blanco: la tarjeta del correo cae al resolutor del
 *      `originalInventoryItem` (sellado), ⛔ nunca al `card.name` del ancla. Ejercita el `include`
 *      ensanchado de `:522` + el resolutor + el render real de la plantilla.
 *   G) **Grid público de sellado (D-2)** — `GET /catalog/sealed`: la teja pinta el `productName`, no la
 *      carta ancla.
 *
 * ⚠️ AUTORÍA: escrita por backend y revisada por lectura; su EJECUCIÓN exige el arnés de integración
 * (`npm run test:integration`, Postgres arriba) que este entorno no tiene — la ejecuta QA en el gate.
 * Construida sobre `ShipPrepDb` + `E2EHarness`, mirando los patrones ya probados de
 * `vault-shipments` / `replacement-cases` / `guest-checkout`.
 */
import { MAIL_PORT, MailMessage, MailPort } from '../../src/modules/mail/mail.port';
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { ShipPrepDb } from './helpers/ship-prep-db';
import { E2E_CARDS, E2E_SEALED_LISTED } from '../../prisma/e2e-fixtures';
import { OrderAccessTokenService } from '../../src/modules/orders/order-access-token.service';
import { RefundLedgerService } from '../../src/modules/payments/refunds/refund-ledger.service';
import { UNIDENTIFIED_SEALED_NAME } from '../../src/common/piece-display-identity';

const RUN = Date.now().toString(36);
const SEALED_NAME = `E2E Caja Sellada ${RUN}`;
const SEALED_IMG = `http://e2e.local/etb-${RUN}.jpg`;

/** Convierte una pieza (raw por construcción de `ShipPrepDb`) en un SELLADO bien capturado, conservando el ancla. */
async function makeSealed(h: E2EHarness, pieceId: string) {
  return h.prisma.inventoryItem.update({
    where: { id: pieceId },
    data: {
      productType: 'sealed',
      rawCondition: null,
      sealedSubtype: 'box',
      sealedCondition: 'mint',
      sealedProductName: SEALED_NAME,
      sealedImageUrl: SEALED_IMG,
    },
    include: { card: { include: { set: true } } },
  });
}

describe('E2E — identidad de SELLADO de punta a punta (§5.2.6-D, errata v1.94.1)', () => {
  let h: E2EHarness;
  let db: ShipPrepDb;
  let bandeja: MailMessage[] = [];
  let spy: jest.SpyInstance;

  // Flujo A/B/C/D — un cliente con una pieza sellada en bóveda y su retiro.
  let custToken: string;
  let orderId: string;
  let sealedItemId: string;
  let withdrawalId: string;
  let anchorName: string;
  let anchorNumber: string;
  let anchorImg: string | null;

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

    // Cliente + bóveda con dos piezas; la primera se vuelve SELLADA (ancla = la carta del template).
    const u = await db.mkUser(`Dueño Sellado ${RUN}`);
    custToken = await db.loginCustomer(u.email!);
    const drawer = await db.mkDrawer();
    const vo = await db.mkVaultOrder(u.id, { placement: 'placed', locationId: drawer.id });
    orderId = vo.order.id;
    const sealed = await makeSealed(h, vo.pieces[0].id);
    sealedItemId = sealed.id;
    anchorName = sealed.card.name;
    anchorNumber = sealed.card.number;
    anchorImg = sealed.card.imageSmallUrl;
    // Precondición del escenario «Exeggcute»: el nombre de la caja NO es el de la carta ancla.
    expect(SEALED_NAME).not.toBe(anchorName);

    // Acta (C): congelada CORRECTA (como la deja `cardSnapshot()` tras el arreglo) en la línea del sellado.
    await h.prisma.orderItem.update({
      where: { id: vo.orderItems[0].id },
      data: { cardSnapshot: { name: SEALED_NAME, setName: sealed.card.set?.name ?? null, number: anchorNumber, productType: 'sealed', sealedProductId: sealed.sealedProductId, sealedProductName: SEALED_NAME } },
    });

    // Retiro del cliente con las dos piezas (una sellada) para rastreo cliente (D) y preparación (B).
    const w = await db.mkWithdrawal(u.id, [vo.pieces[0].id, vo.pieces[1].id], 'picking');
    withdrawalId = w.shipment.id;
  });

  afterAll(async () => {
    spy?.mockRestore();
    await db.cleanup();
    await h?.close();
  });

  it('A · Holdings (D-2) — el holding sellado trae `sealedProductName`, ⛔ nunca el ancla', async () => {
    const res = await h.api('GET', '/vault/holdings', { token: custToken });
    expect(res.status).toBe(200);
    const sealed = (res.body.data as any[]).find((hd) => hd.inventoryItemId === sealedItemId);
    expect(sealed).toBeTruthy();
    expect(sealed.productType).toBe('sealed');
    expect(sealed.sealedProductName).toBe(SEALED_NAME);
    expect(sealed.sealedProductName).not.toBe(anchorName);
    expect(sealed.sealedProductName).not.toBe(UNIDENTIFIED_SEALED_NAME);
    // El `card` ancla se conserva (pertenencia al set + cola de la imagen); ⛔ no es la identidad del sellado.
    expect(sealed.card.name).toBe(anchorName);
  });

  it('B · Pedidos por preparar (operador) — la línea del retiro pinta el nombre del SELLADO', async () => {
    const q = await db.queue();
    expect(q.status).toBe(200);
    const row = (q.body.data as any[]).find((r) => r.shipmentId === withdrawalId);
    expect(row).toBeTruthy();
    const names = (row.items as any[]).map((i) => i.card.name);
    expect(names).toContain(SEALED_NAME);
    expect(names).not.toContain(anchorName);
  });

  it('C · Acta `GET /orders/:id` — la línea congelada del sellado se lee como el SealedProduct, no el ancla', async () => {
    const res = await h.api('GET', `/orders/${orderId}`, { token: custToken });
    expect(res.status).toBe(200);
    const names = (res.body.items as any[]).map((i) => i.card?.name);
    expect(names).toContain(SEALED_NAME);
    expect(names).not.toContain(anchorName);
  });

  it('D · Rastreo del cliente registrado (ESCAPE #1) — `GET /shipments/:id` resuelve name+imagen y lleva `productType`', async () => {
    const res = await h.api('GET', `/shipments/${withdrawalId}`, { token: custToken });
    expect(res.status).toBe(200);
    const item = (res.body.items as any[]).find((i) => i.inventoryItemId === sealedItemId);
    expect(item).toBeTruthy();
    // ⭐ el escape BLOQUEANTE: el DTO leía el ancla aliaseado; ahora resuelve en el servidor.
    expect(item.productType).toBe('sealed');
    expect(item.card.name).toBe(SEALED_NAME);
    expect(item.card.name).not.toBe(anchorName);
    expect(item.card.imageSmallUrl).toBe(SEALED_IMG);
    if (anchorImg) expect(item.card.imageSmallUrl).not.toBe(anchorImg);
    // `number` del ancla VIAJA (el front lo oculta por `productType='sealed'`, espejo de GuestTrackingItemDTO).
    expect(item.card.number).toBe(anchorNumber);
  });

  it('E · Rastreo del invitado (ESCAPE #2) — name Y la IMAGEN salen del resolutor (la caja), no del single', async () => {
    // Pedido de INVITADO con una pieza sellada + token de seguimiento emitido por el servicio real.
    const direct = await db.mkDirect({ guestEmail: `inv.sellado.${RUN}@e2e.local` });
    await makeSealed(h, direct.pieces[0].id);
    const tokens = h.app.get(OrderAccessTokenService);
    const { clear } = await tokens.issue(direct.order.id);

    const res = await h.api('POST', '/orders/guest/track', { json: { token: clear } });
    expect(res.status).toBe(200);
    const item = (res.body.items as any[]).find((i) => i.productType === 'sealed');
    expect(item).toBeTruthy();
    expect(item.name).toBe(SEALED_NAME);
    expect(item.name).not.toBe(anchorName);
    // ⭐ el escape de la IMAGEN: caía al arte del single; ahora es la de la caja.
    expect(item.imageSmallUrl).toBe(SEALED_IMG);
    if (anchorImg) expect(item.imageSmallUrl).not.toBe(anchorImg);
  });

  it('F · Correo AV-12 (ESCAPE #3) — la tarjeta del reembolso del caso nombra el SELLADO, ⛔ nunca el ancla', async () => {
    // Caso de RETIRO sobre una pieza sellada: marcar faltante → preparar → abre el caso.
    const u = await db.mkUser(`AV12 Sellado ${RUN}`);
    const drawer = await db.mkDrawer();
    const vo = await db.mkVaultOrder(u.id, { placement: 'placed', locationId: drawer.id });
    await makeSealed(h, vo.pieces[0].id);
    const w = await db.mkWithdrawal(u.id, [vo.pieces[0].id, vo.pieces[1].id], 'picking');
    const line0 = w.lines.find((l) => l.inventoryItemId === vo.pieces[0].id)!;
    const line1 = w.lines.find((l) => l.inventoryItemId === vo.pieces[1].id)!;
    expect((await db.mark(w.shipment.id, line0.id, { status: 'missing', missingReason: 'not_found' })).status).toBe(200);
    expect((await db.mark(w.shipment.id, line1.id, { status: 'picked' })).status).toBe(200);
    expect((await db.prepare(w.shipment.id, 0)).status).toBe(200);
    const kase = await h.prisma.replacementCase.findFirstOrThrow({ where: { originalInventoryItemId: vo.pieces[0].id } });

    // El acta de ORIGEN queda en BLANCO ⇒ `facts` nulo ⇒ AV-12 cae al resolutor del `originalInventoryItem`
    // (la pieza SELLADA). Antes del arreglo ese peldaño pintaba el `card.name` del ancla.
    await h.prisma.orderItem.update({ where: { id: kase.originOrderItemId as string }, data: { cardSnapshot: {} } });

    // Fila `case_refund` succeeded, sin avisar aún (satisface los CHECK: replacementCaseId + orderItemId + orderId).
    const refund = await h.prisma.paymentRefund.create({
      data: {
        idempotencyKey: `case:av12-sellado:${kase.id}`,
        kind: 'case_refund',
        status: 'succeeded',
        orderId: vo.order.id,
        orderItemId: kase.originOrderItemId as string,
        replacementCaseId: kase.id,
        amountCents: 10000,
        merchandiseCents: 10000,
        merchandiseIvaCents: 1379,
        shippingCents: 0,
        shippingIvaCents: 0,
        processingFeeCents: 0,
        compensationCents: 0,
        missingReason: 'not_found',
        requestedByUserId: db.adminId,
        requestedByRole: 'super_admin',
        reason: 'prueba AV-12 sellado',
        stripeRefundId: `re_av12_${RUN}_${kase.id.slice(0, 8)}`,
        submittedAt: new Date(),
        succeededAt: new Date(),
      },
    });

    bandeja = [];
    const ledger = h.app.get(RefundLedgerService);
    await ledger.notifyCustomer([refund.id]);

    const mine = bandeja.filter((m) => m.to === u.email);
    expect(mine.length).toBeGreaterThanOrEqual(1);
    const blob = JSON.stringify(mine);
    expect(blob).toContain(SEALED_NAME);
    expect(blob).not.toContain(anchorName);
  });

  it('G · Grid público de sellado (D-2) — la teja pinta el `productName`, no la carta ancla', async () => {
    const res = await h.api('GET', `/catalog/sealed?q=${encodeURIComponent(E2E_CARDS.thirdraw.name)}&pageSize=100`);
    expect(res.status).toBe(200);
    const tile = (res.body.data as any[]).find((t) => t.productName === E2E_SEALED_LISTED.productName);
    expect(tile).toBeTruthy();
    // El `q` buscó por la carta ancla, pero la teja NO se rotula con ella.
    expect(tile.productName).not.toBe(E2E_CARDS.thirdraw.name);
    expect(tile.productName).not.toBe(UNIDENTIFIED_SEALED_NAME);
  });
});
