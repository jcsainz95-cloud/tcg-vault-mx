/**
 * 🔒 v1.116 (API_CONTRACT §4-G.9c; ARCHITECTURE §4.47.4) — la dirección del pedido de invitado pasa a la libreta al GANAR el
 * reclamo. Postgres real, por HTTP (`POST /orders/claim`). Debían fallar antes de v1.116 (`addressesSaved` no existía y el
 * reclamo no tocaba `Address`).
 *
 * | Caso | Qué fija | Mutación que lo pone rojo |
 * |---|---|---|
 * | CLM-A1 | libreta vacía ⇒ 1 `Address` con los diez campos, `isDefault:false` (v1.116.1), `addressesSaved:1` | no llamar al guardado; `isDefault = libreta vacía` |
 * | CLM-A2 | libreta con predeterminada ⇒ la nueva `false` y la otra sigue `true` | `isDefault:true` siempre |
 * | CLM-A3 | mismo lugar con mayúsculas/acentos/espacios ⇒ 0 filas, `addressesSaved:0` | comparar crudo |
 * | CLM-A4 | dos `claim` en paralelo, dos pedidos con la misma dirección, N=10 ⇒ 1 fila en 10/10 | sin candado |
 * | CLM-A5 | `403 EMAIL_NOT_VERIFIED`, `CLAIM_EMAIL_MISMATCH`, `ORDER_ALREADY_CLAIMED` ⇒ 0 filas | guardar antes del `updateMany` |
 * | CLM-A6 | envío con dirección corregida ⇒ se guarda la del envío | leer `Order.shippingAddressSnapshot` |
 * | CLM-A7 | guardado que lanza ⇒ `claimed` igual, tokens revocados, 0 filas, log sin domicilio | dejar subir el error |
 * | CLM-A8 | (PT-CHK-1) pedido `failed` plantado ⇒ reclamado, 0 filas, log `reason=unsettled`; la libreta real de la víctima intacta | quitar el filtro de estado |
 * | CLM-A9 | `pending` (sin `settledAt`) y `refunded` (con `settledAt`) ⇒ 0 filas cada uno | filtrar solo por `settledAt ≠ null` |
 * | CLM-A10 | `GET /orders/claimable` con failed/pending/settled/refunded ⇒ solo settled y refunded, con `settledAt` | sin filtro |
 * | CLM-A11 | (PT-CHK-3) dos `POST /users/me/addresses {isDefault:true}` a la vez, N=10 ⇒ una predeterminada | sin candado |
 * | CLM-A12 | (PT-CHK-2) `PATCH‖POST` y `claim‖POST` con `isDefault:true`, N=10 cada una ⇒ una predeterminada | sin candado |
 *
 * v1.116.1 (PT-CHK-1/2/3): CLM-A1…A7 siembran el pedido `status='settled'` con `settledAt` (solo los cobrados pasan a la
 * libreta). CLM-A11/A12 imprimen `k/N` (autor: backend).
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
    opts: {
      createdAt?: Date;
      shipmentSnap?: Prisma.InputJsonObject;
      correctedByUserId?: string;
      /** v1.116.1: estado del pedido y si se cobró alguna vez (por defecto `settled` cobrado, el caso de CLM-A1…A7). */
      status?: 'pending' | 'settled' | 'failed' | 'refunded';
      settledAt?: Date | null;
    } = {},
  ) {
    seq += 1;
    const o = await h.prisma.order.create({
      data: {
        guestEmail: email,
        orderNumber: `CLM-${RUN}-${seq}`,
        fulfillmentMode: 'direct_ship',
        shippingAddressSnapshot: snap,
        status: opts.status ?? 'settled',
        settledAt: opts.settledAt === undefined ? new Date() : opts.settledAt,
        subtotalCents: 10000,
        processingFeeCents: 0,
        ivaCents: 0,
        totalCents: 10000,
        priceConvention: 'IVA_INCLUSIVE',
        feeConvention: 'FEE_ON_TOP',
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
          feeConvention: 'FEE_ON_TOP',
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

  it('CLM-A1: libreta vacía ⇒ 1 Address con los diez campos del snapshot, isDefault:false (v1.116.1), addressesSaved:1 y bitácora sin domicilio', async () => {
    const me = await account();
    const orderId = await guestOrder(me.email);
    const res = await claim(me.token, [orderId]);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ claimed: [orderId], failed: [], addressesSaved: 1 });
    const rows = await book(me.id);
    expect(rows).toHaveLength(1);
    const { id, userId, createdAt: _c, updatedAt: _u, ...fields } = rows[0];
    expect(userId).toBe(me.id);
    expect(fields).toEqual({ ...SNAP, isDefault: false });
    const audit = await h.prisma.auditLog.findMany({ where: { action: 'address.create_from_claim', entityId: id } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorUserId: me.id, entityType: 'Address', after: { orderId, isDefault: false } });
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

  // ───────────────────────── v1.116.1 (PT-CHK-1/2/3) ─────────────────────────

  /** Líneas `ORDER_CLAIM_ADDRESS_SKIPPED` que emitió el reclamo mientras corre `fn`. */
  async function skippedLines(fn: () => Promise<unknown>): Promise<{ lines: string[]; raw: string }> {
    const warn = jest.spyOn(Logger.prototype, 'warn');
    try {
      await fn();
      const lines = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('ORDER_CLAIM_ADDRESS_SKIPPED'));
      return { lines, raw: JSON.stringify(warn.mock.calls) };
    } finally {
      warn.mockRestore();
    }
  }

  const ATTACKER = { ...SNAP, line1: 'Bodega Atacante 666', neighborhood: 'Centro', postalCode: '64000', city: 'Monterrey', state: 'Nuevo León' };

  it('CLM-A8: pedido `failed` sin cobro plantado con el correo de la víctima ⇒ se reclama, 0 Address, log reason=unsettled sin domicilio', async () => {
    const me = await account();
    const planted = await guestOrder(me.email, ATTACKER, { status: 'failed', settledAt: null });
    let res: Awaited<ReturnType<typeof claim>> | undefined;
    const { lines, raw } = await skippedLines(async () => {
      res = await claim(me.token, [planted]);
    });
    expect(res!.status).toBe(200);
    expect(res!.body).toEqual({ claimed: [planted], failed: [], addressesSaved: 0 });
    expect(await book(me.id)).toHaveLength(0);
    expect(lines).toEqual([`ORDER_CLAIM_ADDRESS_SKIPPED reason=unsettled orderId=${planted}`]);
    for (const v of [ATTACKER.line1, ATTACKER.postalCode, ATTACKER.phone, ATTACKER.recipientName]) expect(raw).not.toContain(v);
    expect(await h.prisma.auditLog.count({ where: { action: 'address.create_from_claim', actorUserId: me.id } })).toBe(0);
  });

  it('CLM-A8 (variante): la víctima con su predeterminada y un pedido real cobrado ⇒ solo entra la del cobrado, su predeterminada intacta', async () => {
    const me = await account();
    const mine = await h.prisma.address.create({
      data: { userId: me.id, recipientName: 'Juan', line1: 'Insurgentes 5', neighborhood: 'Roma', city: 'CDMX', state: 'CDMX', postalCode: '06700', country: 'MX', phone: '5500000000', isDefault: true },
    });
    const real = await guestOrder(me.email, SNAP, { createdAt: new Date(Date.now() - 86_400_000) });
    const planted = await guestOrder(me.email, ATTACKER, { status: 'failed', settledAt: null }); // el más nuevo
    const res = await claim(me.token, [real, planted]);
    expect(res.body).toEqual({ claimed: [real, planted], failed: [], addressesSaved: 1 });
    const rows = await book(me.id);
    expect(rows.map((r) => [r.id === mine.id ? 'mine' : r.line1, r.isDefault])).toEqual([
      ['mine', true],
      [SNAP.line1, false],
    ]);
  });

  it('CLM-A9: `pending` (sin settledAt) y `refunded` (con settledAt) ⇒ 0 filas cada uno, log reason=unsettled', async () => {
    for (const [status, settledAt] of [
      ['pending', null],
      ['refunded', new Date()],
    ] as const) {
      const me = await account();
      const id = await guestOrder(me.email, SNAP, { status, settledAt });
      let res: Awaited<ReturnType<typeof claim>> | undefined;
      const { lines } = await skippedLines(async () => {
        res = await claim(me.token, [id]);
      });
      expect([status, res!.body]).toEqual([status, { claimed: [id], failed: [], addressesSaved: 0 }]);
      expect([status, (await book(me.id)).length]).toEqual([status, 0]);
      expect(lines).toEqual([`ORDER_CLAIM_ADDRESS_SKIPPED reason=unsettled orderId=${id}`]);
    }
  });

  it('CLM-A10: GET /orders/claimable con failed sin cobro, pending, settled y refunded ⇒ solo settled y refunded, ambos con settledAt', async () => {
    const me = await account();
    const failed = await guestOrder(me.email, SNAP, { status: 'failed', settledAt: null });
    const pending = await guestOrder(me.email, SNAP, { status: 'pending', settledAt: null });
    const settled = await guestOrder(me.email, SNAP, { status: 'settled' });
    const refunded = await guestOrder(me.email, SNAP, { status: 'refunded' });
    const res = await h.api('GET', '/orders/claimable', { token: me.token });
    expect(res.status).toBe(200);
    const data = res.body.data as { orderId: string; status: string; settledAt?: string }[];
    expect(data.map((o) => o.orderId).sort()).toEqual([settled, refunded].sort());
    expect(data.every((o) => typeof o.settledAt === 'string')).toBe(true);
    expect(data.map((o) => o.orderId)).not.toContain(failed);
    expect(data.map((o) => o.orderId)).not.toContain(pending);
  });

  const addrBody = (line1: string) => ({
    recipientName: 'Ana Prueba',
    line1,
    neighborhood: 'Centro',
    city: 'Monterrey',
    state: 'Nuevo León',
    postalCode: '64000',
    country: 'MX',
    phone: '5512345678',
    isDefault: true,
  });
  const postAddr = (token: string, line1: string) => h.api('POST', '/users/me/addresses', { token, json: addrBody(line1) });
  const defaults = async (userId: string) => h.prisma.address.count({ where: { userId, isDefault: true } });
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const PATCH_DELAYS_MS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

  /** Corre `round` N veces y devuelve cuántas rondas acabaron con exactamente una predeterminada (imprime `k/N`). */
  async function racing(label: string, N: number, round: (i: number) => Promise<number>): Promise<void> {
    const perRound: number[] = [];
    for (let i = 0; i < N; i += 1) perRound.push(await round(i));
    const ok = perRound.filter((n) => n === 1).length;
    // eslint-disable-next-line no-console
    console.log(`${label}: ${ok}/${N} rondas con 1 predeterminada (predeterminadas por ronda: ${perRound.join(',')})`);
    expect(perRound).toEqual(Array(N).fill(1));
  }

  it('CLM-A11: dos POST /users/me/addresses {isDefault:true} a la vez ⇒ una sola predeterminada (N=10)', async () => {
    await racing('CLM-A11', 10, async (i) => {
      const me = await account();
      const [a, b] = await Promise.all([postAddr(me.token, `Calle A ${i}`), postAddr(me.token, `Calle B ${i}`)]);
      expect([a.status, b.status]).toEqual([201, 201]);
      return defaults(me.id);
    });
  });

  /**
   * PATCH‖POST. El POST resuelve geografía antes de escribir y llega más tarde; la ventana que muerde sin candado es «el
   * `updateMany` del POST antes que el del PATCH», así que el PATCH sale con 0-9 ms de retraso (rotando por ronda). Medido
   * con la mutación «sin candado»: muerde ~4/10 rondas ⇒ N=20 rondas (regla de §4-G.9c: < 5/10 ⇒ se sube N).
   */
  it('CLM-A12 (PATCH‖POST): PATCH {isDefault:true} y POST {isDefault:true} a la vez ⇒ una sola predeterminada (N=20)', async () => {
    await racing('CLM-A12 PATCH‖POST', 20, async (i) => {
      const me = await account();
      const x = await h.prisma.address.create({
        data: { userId: me.id, recipientName: 'Ana Prueba', line1: `Calle X ${i}`, neighborhood: 'Centro', city: 'Monterrey', state: 'Nuevo León', postalCode: '64000', country: 'MX', phone: '5512345678', isDefault: false },
      });
      const [p, c] = await Promise.all([
        sleep(PATCH_DELAYS_MS[i % PATCH_DELAYS_MS.length]).then(() => h.api('PATCH', `/users/me/addresses/${x.id}`, { token: me.token, json: { isDefault: true } })),
        postAddr(me.token, `Calle Y ${i}`),
      ]);
      expect([p.status, c.status]).toEqual([200, 201]);
      return defaults(me.id);
    });
  });

  /**
   * claim‖POST con libreta vacía. El POST sale con 10-28 ms de retraso (rotando por ronda): el pentester midió que la
   * ventana está en 15-20 ms (PT-CHK-2: 0/10 con δ=0 y δ=10, 6/10 con δ=15, 8/10 con δ=20). Dos defensas lo cubren (el
   * reclamo nunca escribe `isDefault:true` y el candado); solo muerde si caen las dos (el código v1.116): cada una por
   * separado la vigilan CLM-A1 (predeterminada) y CLM-A11/A12 PATCH‖POST (candado).
   */
  it('CLM-A12 (claim‖POST): reclamo con libreta vacía y POST {isDefault:true} a la vez ⇒ una sola predeterminada (N=10)', async () => {
    await racing('CLM-A12 claim‖POST', 10, async (i) => {
      const me = await account();
      const orderId = await guestOrder(me.email);
      const [r, c] = await Promise.all([
        claim(me.token, [orderId]),
        sleep(10 + (i % 10) * 2).then(() => postAddr(me.token, `Calle Z ${i}`)),
      ]);
      expect([r.status, c.status]).toEqual([200, 201]);
      expect(r.body.claimed).toEqual([orderId]);
      return defaults(me.id);
    });
  });
});
