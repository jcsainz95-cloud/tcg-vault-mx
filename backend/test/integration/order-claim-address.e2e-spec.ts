/**
 * 🔒 v1.116 (API_CONTRACT §4-G.9c; ARCHITECTURE §4.47.4) — la dirección del pedido de invitado pasa a la libreta al GANAR el
 * reclamo. Postgres real, por HTTP (`POST /orders/claim`). Debían fallar antes de v1.116 (`addressesSaved` no existía y el
 * reclamo no tocaba `Address`).
 *
 * | Caso | Qué fija | Mutación que lo pone rojo |
 * |---|---|---|
 * | CLM-A1 | libreta vacía ⇒ 1 `Address` con los diez campos, `isDefault:true`, `addressesSaved:1` | no llamar al guardado |
 * | CLM-A2 | libreta con predeterminada ⇒ la nueva `false` y la otra sigue `true` | `isDefault:true` siempre |
 * | CLM-A3 | mismo lugar con mayúsculas/acentos/espacios ⇒ 0 filas, `addressesSaved:0` | comparar crudo |
 * | CLM-A4 | dos `claim` en paralelo, dos pedidos con la misma dirección, N=10 ⇒ 1 fila en 10/10 | sin candado |
 * | CLM-A5 | `403 EMAIL_NOT_VERIFIED`, `CLAIM_EMAIL_MISMATCH`, `ORDER_ALREADY_CLAIMED` ⇒ 0 filas | guardar antes del `updateMany` |
 * | CLM-A6 | envío con dirección corregida ⇒ se guarda la del envío | leer `Order.shippingAddressSnapshot` |
 * | CLM-A7 | guardado que lanza ⇒ `claimed` igual, tokens revocados, 0 filas, log sin domicilio | dejar subir el error |
 *
 * Datos propios de la corrida: usuarios `clm.<RUN>.<n>@example.com` y pedidos sembrados por Prisma (sin piezas: el reclamo no
 * las mira). Ningún dato del fixture compartido se toca.
 */
import { createHash, randomBytes } from 'crypto';
import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { E2EHarness } from './helpers/e2e-app';
import { UsersService } from '../../src/modules/users/users.service';

const RUN = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
const PASSWORD = 'Reclamo123!';

const SNAP = {
  line1: 'Av. Reforma 100',
  line2: 'Depto 3',
  neighborhood: 'Juárez',
  city: 'Ciudad de México',
  state: 'CDMX',
  postalCode: '06600',
  country: 'MX',
  phone: '5512345678',
  recipientName: 'Juan Pérez López',
  references: 'Portón negro',
};

describe('CLM-A · dirección del invitado a su libreta al reclamar (§4-G.9c)', () => {
  let h: E2EHarness;
  let seq = 0;

  beforeAll(async () => {
    h = await E2EHarness.create();
  });
  afterAll(async () => {
    await h?.close();
  });

  /** Cuenta propia con correo (verificado o no) y su token. */
  async function account(verified = true): Promise<{ id: string; email: string; token: string }> {
    seq += 1;
    const email = `clm.${RUN}.${seq}@example.com`;
    const reg = await h.api('POST', '/auth/register', { json: { email, password: PASSWORD, name: 'Juan Pérez' } });
    expect(reg.status).toBe(201);
    const user = await h.prisma.user.update({ where: { email }, data: { emailVerified: verified } });
    return { id: user.id, email, token: await h.login(email, PASSWORD) };
  }

  /** Pedido de invitado pagado, `direct_ship`, con su snapshot (y opcionalmente un envío con otro snapshot). */
  async function guestOrder(
    email: string,
    snap: Prisma.InputJsonObject = SNAP,
    opts: { createdAt?: Date; shipmentSnap?: Prisma.InputJsonObject; correctedByUserId?: string } = {},
  ) {
    seq += 1;
    const o = await h.prisma.order.create({
      data: {
        guestEmail: email,
        orderNumber: `CLM-${RUN}-${seq}`,
        fulfillmentMode: 'direct_ship',
        shippingAddressSnapshot: snap,
        status: 'settled',
        settledAt: new Date(),
        subtotalCents: 10000,
        processingFeeCents: 0,
        ivaCents: 0,
        totalCents: 10000,
        priceConvention: 'IVA_INCLUSIVE',
        ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
      },
    });
    if (opts.shipmentSnap) {
      await h.prisma.shipmentRequest.create({
        data: {
          orderId: o.id,
          addressSnapshot: opts.shipmentSnap,
          status: 'picking',
          shippingFeeCents: 0,
          priceConvention: 'IVA_INCLUSIVE',
          // Los tres campos de la corrección van juntos o ninguno (CHECK `shipment_address_corrected_paired` y
          // `shipment_address_version_iff_corrected`, migración 20261006120000_m64_sdx_c_address).
          ...(opts.correctedByUserId
            ? { addressVersion: 1, addressCorrectedAt: new Date(), addressCorrectedByUserId: opts.correctedByUserId }
            : { addressVersion: 0 }),
        },
      });
    }
    return o.id;
  }

  const claim = (token: string, orderIds: string[]) => h.api('POST', '/orders/claim', { token, json: { orderIds } });
  const book = (userId: string) => h.prisma.address.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });

  it('CLM-A1: libreta vacía ⇒ 1 Address con los diez campos del snapshot, isDefault:true, addressesSaved:1 y bitácora sin domicilio', async () => {
    const me = await account();
    const orderId = await guestOrder(me.email);
    const res = await claim(me.token, [orderId]);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ claimed: [orderId], failed: [], addressesSaved: 1 });
    const rows = await book(me.id);
    expect(rows).toHaveLength(1);
    const { id, userId, createdAt: _c, updatedAt: _u, ...fields } = rows[0];
    expect(userId).toBe(me.id);
    expect(fields).toEqual({ ...SNAP, isDefault: true });
    const audit = await h.prisma.auditLog.findMany({ where: { action: 'address.create_from_claim', entityId: id } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorUserId: me.id, entityType: 'Address', after: { orderId, isDefault: true } });
    expect(JSON.stringify(audit[0])).not.toContain(SNAP.line1);
  });

  it('CLM-A2: libreta con predeterminada ⇒ la nueva isDefault:false y la del cliente sigue true', async () => {
    const me = await account();
    const mine = await h.prisma.address.create({
      data: { userId: me.id, recipientName: 'Juan', line1: 'Insurgentes 5', neighborhood: 'Roma', city: 'CDMX', state: 'CDMX', postalCode: '06700', country: 'MX', phone: '5500000000', isDefault: true },
    });
    const orderId = await guestOrder(me.email);
    const res = await claim(me.token, [orderId]);
    expect(res.body.addressesSaved).toBe(1);
    const rows = await book(me.id);
    expect(rows.map((r) => [r.id === mine.id ? 'mine' : 'new', r.isDefault])).toEqual([
      ['mine', true],
      ['new', false],
    ]);
  });

  it('CLM-A3: la misma dirección escrita con mayúsculas/acentos/espacios ⇒ 0 filas nuevas, addressesSaved:0 (gana la del cliente)', async () => {
    const me = await account();
    await h.prisma.address.create({
      data: { userId: me.id, recipientName: 'Otro Nombre', line1: '  AV.  REFORMA 100 ', line2: 'depto   3', neighborhood: 'JUAREZ', city: 'CDMX', state: 'CDMX', postalCode: '06600', country: 'MX', phone: '5599999999', isDefault: true },
    });
    const orderId = await guestOrder(me.email);
    const res = await claim(me.token, [orderId]);
    expect(res.body).toEqual({ claimed: [orderId], failed: [], addressesSaved: 0 });
    const rows = await book(me.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ recipientName: 'Otro Nombre', phone: '5599999999', isDefault: true });
  });

  /**
   * CLM-A4 — dos reclamos simultáneos del MISMO usuario (dos pedidos, misma dirección). N=10 rondas, cada una con usuario
   * nuevo. La proporción se imprime para el informe (autor: backend).
   */
  it('CLM-A4: dos claim en paralelo de dos pedidos con la misma dirección ⇒ 1 fila (N=10)', async () => {
    const N = 10;
    const results: number[] = [];
    for (let i = 0; i < N; i += 1) {
      const me = await account();
      const a = await guestOrder(me.email);
      const b = await guestOrder(me.email, { ...SNAP, recipientName: 'Juana Pérez' });
      const [ra, rb] = await Promise.all([claim(me.token, [a]), claim(me.token, [b])]);
      expect([ra.status, rb.status]).toEqual([200, 200]);
      expect(ra.body.addressesSaved + rb.body.addressesSaved).toBe((await book(me.id)).length);
      results.push((await book(me.id)).length);
    }
    const ok = results.filter((n) => n === 1).length;
    // eslint-disable-next-line no-console
    console.log(`CLM-A4: ${ok}/${N} rondas con 1 fila (filas por ronda: ${results.join(',')})`);
    expect(results).toEqual(Array(N).fill(1));
  });

  it('CLM-A5: 403 EMAIL_NOT_VERIFIED, CLAIM_EMAIL_MISMATCH y ORDER_ALREADY_CLAIMED ⇒ 0 filas', async () => {
    // (a) correo sin verificar: el guard corta antes del servicio.
    const unverified = await account(false);
    const o1 = await guestOrder(unverified.email);
    const r1 = await claim(unverified.token, [o1]);
    expect(r1.status).toBe(403);
    expect(r1.body.error.code).toBe('EMAIL_NOT_VERIFIED');
    expect(await book(unverified.id)).toHaveLength(0);

    // (b) pedido de otro correo.
    const me = await account();
    const other = `clm.${RUN}.ajeno@example.com`;
    const o2 = await guestOrder(other);
    const r2 = await claim(me.token, [o2]);
    expect(r2.body).toEqual({ claimed: [], failed: [{ orderId: o2, code: 'CLAIM_EMAIL_MISMATCH' }], addressesSaved: 0 });

    // (c) ya reclamado por su dueño: el segundo intento (otra cuenta con el MISMO correo no puede existir ⇒ el mismo usuario
    // tras vaciar su libreta) no guarda nada.
    const o3 = await guestOrder(me.email);
    expect((await claim(me.token, [o3])).body.addressesSaved).toBe(1);
    await h.prisma.address.deleteMany({ where: { userId: me.id } });
    const r3 = await claim(me.token, [o3]);
    expect(r3.body).toEqual({ claimed: [], failed: [{ orderId: o3, code: 'ORDER_ALREADY_CLAIMED' }], addressesSaved: 0 });
    expect(await book(me.id)).toHaveLength(0);
  });

  it('CLM-A6: envío con dirección corregida ⇒ se guarda la del ENVÍO, no la capturada al pagar', async () => {
    const me = await account();
    const operator = await account(); // quien corrige: usuario real sembrado (la columna no tiene FK dura, pero el dato es real)
    const corrected = { ...SNAP, line1: 'Calle Corregida 7', neighborhood: 'Cuauhtémoc', postalCode: '06500' };
    const orderId = await guestOrder(me.email, SNAP, { shipmentSnap: corrected, correctedByUserId: operator.id });
    const ship = await h.prisma.shipmentRequest.findFirstOrThrow({ where: { orderId } });
    expect(ship).toMatchObject({ addressVersion: 1, addressCorrectedByUserId: operator.id }); // de verdad corregida
    expect((await claim(me.token, [orderId])).body.addressesSaved).toBe(1);
    const rows = await book(me.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ line1: 'Calle Corregida 7', neighborhood: 'Cuauhtémoc', postalCode: '06500' });
  });

  it('CLM-A7: el guardado lanza ⇒ claimed igual, tokens revocados, 0 filas y log ORDER_CLAIM_ADDRESS_SKIPPED sin domicilio', async () => {
    const me = await account();
    const orderId = await guestOrder(me.email);
    await h.prisma.orderAccessToken.create({
      data: { orderId, tokenHash: createHash('sha256').update(`clm-${RUN}`).digest('hex'), expiresAt: new Date(Date.now() + 86_400_000) },
    });
    const users = h.app.get(UsersService);
    const boom = jest.spyOn(users, 'createAddressFromClaim').mockRejectedValue(new Error(`fallo con ${SNAP.line1} ${SNAP.postalCode}`));
    const warn = jest.spyOn(Logger.prototype, 'warn');
    try {
      const res = await claim(me.token, [orderId]);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ claimed: [orderId], failed: [], addressesSaved: 0 });
      const order = await h.prisma.order.findUnique({ where: { id: orderId } });
      expect(order).toMatchObject({ userId: me.id });
      const tokens = await h.prisma.orderAccessToken.findMany({ where: { orderId } });
      expect(tokens.every((t) => t.revokedAt !== null)).toBe(true);
      expect(await book(me.id)).toHaveLength(0);
      const lines = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('ORDER_CLAIM_ADDRESS_SKIPPED'));
      expect(lines).toEqual([`ORDER_CLAIM_ADDRESS_SKIPPED reason=error orderId=${orderId} error=Error`]);
      for (const v of [SNAP.line1, SNAP.postalCode, SNAP.phone, SNAP.recipientName]) expect(JSON.stringify(warn.mock.calls)).not.toContain(v);
    } finally {
      boom.mockRestore();
      warn.mockRestore();
    }
  });
});
