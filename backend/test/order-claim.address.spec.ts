/**
 * 🔒 v1.116 (API_CONTRACT §4-G.9c) — la dirección del invitado pasa a su libreta al GANAR el reclamo. Unitarias (sin BD): la
 * conducta de `OrderClaimService.claim` + `UsersService.createAddressFromClaim` con Prisma de dobles. La carrera (CLM-A4) y las
 * filas reales las mide `test/integration/order-claim-address.e2e-spec.ts` (CLM-A1…A7) contra Postgres.
 *
 * | Caso | Qué fija |
 * |---|---|
 * | K1-K3 | `addressPlaceKey`: mayúsculas/acentos/espacios/`null` iguales; interior distinto ⇒ otro lugar; sin colisión de partes |
 * | U1-U6 | alta interna: NUNCA predeterminada (v1.116.1), duplicado ⇒ nada, inválida ⇒ nada, candado ANTES de leer, bitácora sin domicilio |
 * | C1-C9 | reclamo: solo ganados y COBRADOS (v1.116.1), tras revocar y auditar; orden `createdAt` desc; envío corregido gana; fallo ⇒ log sin domicilio y reclamo intacto |
 * | L1-L4 | (v1.116.1, PT-CHK-2/3) alta y edición del cliente: candado de la libreta ANTES de quitar la predeterminada y escribir, todo en la misma tx; validación/dueño fuera |
 */
import { Logger } from '@nestjs/common';
import { Role } from '@prisma/client';
import { addressPlaceKey } from '../src/modules/users/address-place-key';
import { ADDRESS_BOOK_GATE_NAMESPACE, UsersService } from '../src/modules/users/users.service';
import { OrderClaimService } from '../src/modules/orders/order-claim.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { AuditService } from '../src/modules/audit/audit.service';
import type { OrderAccessTokenService } from '../src/modules/orders/order-access-token.service';

const ME = { id: 'user-1', role: Role.customer };

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

describe('K · addressPlaceKey (§4-G.9c «Sin duplicados»)', () => {
  it('K1: mayúsculas, acentos, espacios de más y null/"" dan la misma clave', () => {
    const a = addressPlaceKey({ postalCode: '06600', line1: 'Av. Reforma 100', line2: null, neighborhood: 'Juárez' });
    const b = addressPlaceKey({ postalCode: ' 06600 ', line1: '  AV.   REFÓRMA  100 ', line2: '', neighborhood: 'juarez' });
    expect(b).toBe(a);
  });
  it('K2: otro interior, otra colonia u otro CP ⇒ otro lugar; el destinatario y el teléfono no cuentan', () => {
    const base = { postalCode: '06600', line1: 'Av. Reforma 100', line2: 'Depto 3', neighborhood: 'Juárez' };
    expect(addressPlaceKey({ ...base, line2: 'Depto 4' })).not.toBe(addressPlaceKey(base));
    expect(addressPlaceKey({ ...base, neighborhood: 'Roma' })).not.toBe(addressPlaceKey(base));
    expect(addressPlaceKey({ ...base, postalCode: '06700' })).not.toBe(addressPlaceKey(base));
    expect(addressPlaceKey({ ...base, recipientName: 'Otra', phone: '1' } as never)).toBe(addressPlaceKey(base));
  });
  it('K3: las partes no se mezclan (calle «A B» + interior vacío ≠ calle «A» + interior «B»)', () => {
    expect(addressPlaceKey({ postalCode: '1', line1: 'A B', line2: null })).not.toBe(addressPlaceKey({ postalCode: '1', line1: 'A', line2: 'B' }));
  });
});

type AddrRow = { id: string; userId: string; postalCode: string; line1: string; line2: string | null; neighborhood: string | null; isDefault: boolean } & Record<string, unknown>;

function buildUsers(book: AddrRow[] = []) {
  const calls: string[] = [];
  const tx = {
    $executeRaw: jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push(`lock:${strings.join('?')}|${JSON.stringify(values)}`);
      return 1;
    }),
    address: {
      findMany: jest.fn(async ({ where }: { where: { userId: string } }) => {
        calls.push('findMany');
        return book.filter((a) => a.userId === where.userId);
      }),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        calls.push('create');
        const row = { id: `addr-${book.length + 1}`, ...data } as AddrRow;
        book.push(row);
        return { id: row.id };
      }),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
  };
  const prisma = { $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) };
  const audit = { log: jest.fn(async (_e: unknown, _tx?: unknown) => undefined) };
  const svc = new UsersService(prisma as never, {} as never, {} as never, {} as never, undefined, undefined, audit as unknown as AuditService);
  return { svc, tx, audit, book, calls };
}

describe('U · UsersService.createAddressFromClaim', () => {
  it('U1: libreta vacía ⇒ una fila con los diez campos tal cual e `isDefault:false` (v1.116.1: nunca predeterminada)', async () => {
    const { svc, tx } = buildUsers();
    const r = await svc.createAddressFromClaim(ME, 'order-A', SNAP);
    expect(r).toEqual({ created: true, addressId: 'addr-1', isDefault: false });
    expect(tx.address.create.mock.calls[0][0].data).toEqual({ userId: ME.id, ...SNAP, isDefault: false });
  });

  it('U2: libreta con predeterminada ⇒ la nueva `isDefault:false` y ⛔ ninguna escritura sobre las existentes', async () => {
    const { svc, tx } = buildUsers([{ id: 'mine', userId: ME.id, postalCode: '01000', line1: 'Otra 1', line2: null, neighborhood: 'Centro', isDefault: true }]);
    const r = await svc.createAddressFromClaim(ME, 'order-A', SNAP);
    expect(r).toMatchObject({ created: true, isDefault: false });
    expect(tx.address.updateMany).not.toHaveBeenCalled();
    expect(tx.address.update).not.toHaveBeenCalled();
  });

  it('U3: mismo lugar escrito distinto ⇒ `duplicate`, sin alta ni bitácora (gana la del cliente)', async () => {
    const { svc, tx, audit } = buildUsers([
      { id: 'mine', userId: ME.id, postalCode: '06600', line1: 'AV. REFORMA  100', line2: 'depto 3', neighborhood: 'JUAREZ', isDefault: true, recipientName: 'Otro' },
    ]);
    expect(await svc.createAddressFromClaim(ME, 'order-A', SNAP)).toEqual({ created: false, reason: 'duplicate' });
    expect(tx.address.create).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it.each([
    ['recipientName vacío', { recipientName: '  ' }],
    ['recipientName > 120', { recipientName: 'x'.repeat(121) }],
    ['país no MX', { country: 'US' }],
    ['sin line1', { line1: '' }],
    ['sin city', { city: undefined }],
    ['sin state', { state: ' ' }],
    ['sin postalCode', { postalCode: null }],
    ['sin phone', { phone: '' }],
  ])('U4: %s ⇒ `invalid` sin abrir transacción', async (_n, patch) => {
    const { svc, tx } = buildUsers();
    expect(await svc.createAddressFromClaim(ME, 'order-A', { ...SNAP, ...patch })).toEqual({ created: false, reason: 'invalid' });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.address.create).not.toHaveBeenCalled();
  });

  it('U5: el candado por usuario va ANTES de leer la libreta, con su espacio propio', async () => {
    const { svc, calls } = buildUsers();
    await svc.createAddressFromClaim(ME, 'order-A', SNAP);
    expect(calls).toHaveLength(3);
    expect(calls[0]).toBe(`lock:SELECT pg_advisory_xact_lock(?::int, hashtext(?))|${JSON.stringify([ADDRESS_BOOK_GATE_NAMESPACE, ME.id])}`);
    expect(calls.slice(1)).toEqual(['findMany', 'create']);
  });

  it('U6: bitácora `address.create_from_claim` en la MISMA tx, ⛔ sin domicilio', async () => {
    const { svc, audit, tx } = buildUsers();
    await svc.createAddressFromClaim(ME, 'order-A', SNAP);
    expect(audit.log).toHaveBeenCalledWith(
      { actorUserId: ME.id, actorRole: ME.role, action: 'address.create_from_claim', entityType: 'Address', entityId: 'addr-1', after: { orderId: 'order-A', isDefault: false } },
      tx,
    );
    const logged = JSON.stringify(audit.log.mock.calls);
    for (const v of [SNAP.line1, SNAP.postalCode, SNAP.phone, SNAP.recipientName]) expect(logged).not.toContain(v);
  });
});

// ───────────────────────────────────────────── OrderClaimService ─────────────────────────────────────────────

type OrderRow = {
  id: string;
  status: string;
  userId: string | null;
  guestEmail: string;
  createdAt: Date;
  shippingAddressSnapshot: unknown;
  shipmentRequests: { status: string; addressSnapshot: unknown; requestedAt: Date }[];
};

function buildClaim(orders: OrderRow[], users: { createAddressFromClaim: jest.Mock }, opts: { email?: string } = {}) {
  const trace: string[] = [];
  const prisma = {
    user: { findUnique: jest.fn(async () => ({ email: opts.email ?? 'juan@example.com', emailVerified: true })) },
    order: {
      updateMany: jest.fn(async ({ where, data }: { where: { id: string; guestEmail: string }; data: { userId: string } }) => {
        trace.push(`update:${where.id}`);
        const o = orders.find((x) => x.id === where.id && x.userId === null && x.guestEmail === where.guestEmail);
        if (!o) return { count: 0 };
        o.userId = data.userId;
        return { count: 1 };
      }),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => orders.find((o) => o.id === where.id) ?? null),
      findMany: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        orders
          .filter((o) => where.id.in.includes(o.id))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .map((o) => ({ id: o.id, status: o.status, shippingAddressSnapshot: o.shippingAddressSnapshot, shipmentRequests: [...o.shipmentRequests].sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime()) })),
      ),
    },
  };
  const audit = { log: jest.fn(async (e: { entityId: string }) => void trace.push(`audit:${e.entityId}`)) };
  const tokens = { revokeAll: jest.fn(async (id: string) => void trace.push(`revoke:${id}`)) };
  users.createAddressFromClaim.mockImplementation(async (_a: unknown, orderId: string) => {
    trace.push(`save:${orderId}`);
    return { created: true, addressId: `a-${orderId}`, isDefault: false };
  });
  const svc = new OrderClaimService(prisma as unknown as PrismaService, audit as unknown as AuditService, tokens as unknown as OrderAccessTokenService, users as unknown as UsersService);
  return { svc, prisma, trace, tokens };
}

const order = (id: string, day: number, snap: unknown = SNAP, extra: Partial<OrderRow> = {}): OrderRow => ({
  id,
  status: 'settled',
  userId: null,
  guestEmail: 'juan@example.com',
  createdAt: new Date(Date.UTC(2026, 9, day)),
  shippingAddressSnapshot: snap,
  shipmentRequests: [],
  ...extra,
});

describe('C · OrderClaimService.claim → libreta', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => warn.mockRestore());

  it('C1: guarda la dirección del ganado DESPUÉS de revocar y auditar, y cuenta `addressesSaved`', async () => {
    const users = { createAddressFromClaim: jest.fn() };
    const { svc, trace } = buildClaim([order('o1', 1)], users);
    const res = await svc.claim(ME, ['o1']);
    expect(res).toEqual({ claimed: ['o1'], failed: [], addressesSaved: 1 });
    expect(trace).toEqual(['update:o1', 'revoke:o1', 'audit:o1', 'save:o1']);
    expect(users.createAddressFromClaim).toHaveBeenCalledWith(ME, 'o1', SNAP);
  });

  it('C2: ⛔ nada para un pedido que NO se ganó (correo distinto, ya reclamado)', async () => {
    const users = { createAddressFromClaim: jest.fn() };
    const { svc } = buildClaim([order('o1', 1, SNAP, { userId: 'otro' }), order('o2', 2, SNAP, { guestEmail: 'otro@example.com' })], users);
    const res = await svc.claim(ME, ['o1', 'o2']);
    expect(res.addressesSaved).toBe(0);
    expect(res.failed.map((f) => f.code)).toEqual(['ORDER_ALREADY_CLAIMED', 'CLAIM_EMAIL_MISMATCH']);
    expect(users.createAddressFromClaim).not.toHaveBeenCalled();
  });

  it('C3: varios ganados ⇒ se guardan por `createdAt` desc (decide cuál se crea si dos comparten lugar)', async () => {
    const users = { createAddressFromClaim: jest.fn() };
    const { svc, trace } = buildClaim([order('viejo', 1), order('nuevo', 20), order('medio', 10)], users);
    await svc.claim(ME, ['viejo', 'nuevo', 'medio']);
    expect(trace.filter((t) => t.startsWith('save:'))).toEqual(['save:nuevo', 'save:medio', 'save:viejo']);
  });

  it('C4: con envío vigente se guarda la dirección DEL ENVÍO (la corregida); con envíos cancelados, la del más reciente', async () => {
    const corrected = { ...SNAP, line1: 'Calle Corregida 5' };
    const users = { createAddressFromClaim: jest.fn() };
    const { svc } = buildClaim(
      [
        order('o1', 1, SNAP, {
          shipmentRequests: [
            { status: 'cancelado', addressSnapshot: { ...SNAP, line1: 'Vieja' }, requestedAt: new Date(Date.UTC(2026, 9, 2)) },
            { status: 'enviado', addressSnapshot: corrected, requestedAt: new Date(Date.UTC(2026, 9, 1)) },
          ],
        }),
      ],
      users,
    );
    await svc.claim(ME, ['o1']);
    expect(users.createAddressFromClaim).toHaveBeenCalledWith(ME, 'o1', corrected);
  });

  it('C5: pedido sin dirección ⇒ nada (ni alta ni log)', async () => {
    const users = { createAddressFromClaim: jest.fn() };
    const { svc } = buildClaim([order('o1', 1, null)], users);
    expect((await svc.claim(ME, ['o1'])).addressesSaved).toBe(0);
    expect(users.createAddressFromClaim).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('C6: el alta lanza (con el domicilio en el mensaje) ⇒ `claimed` igual, tokens revocados, log `reason=error` ⛔ sin domicilio', async () => {
    const users = { createAddressFromClaim: jest.fn() };
    const { svc, tokens } = buildClaim([order('o1', 1)], users);
    users.createAddressFromClaim.mockImplementation(async () => {
      throw Object.assign(new Error(`fallo con ${SNAP.line1} ${SNAP.postalCode}`), { code: 'P2002' });
    });
    const res = await svc.claim(ME, ['o1']);
    expect(res).toEqual({ claimed: ['o1'], failed: [], addressesSaved: 0 });
    expect(tokens.revokeAll).toHaveBeenCalledWith('o1', expect.any(Date));
    expect(warn).toHaveBeenCalledWith('ORDER_CLAIM_ADDRESS_SKIPPED reason=error orderId=o1 error=P2002');
    const logged = JSON.stringify(warn.mock.calls);
    for (const v of [SNAP.line1, SNAP.postalCode, SNAP.phone, SNAP.recipientName]) expect(logged).not.toContain(v);
  });

  it('C7: dirección inválida ⇒ log `reason=invalid`, `addressesSaved:0`, reclamo intacto', async () => {
    const users = { createAddressFromClaim: jest.fn() };
    const { svc } = buildClaim([order('o1', 1)], users);
    users.createAddressFromClaim.mockResolvedValue({ created: false, reason: 'invalid' });
    const res = await svc.claim(ME, ['o1']);
    expect(res).toEqual({ claimed: ['o1'], failed: [], addressesSaved: 0 });
    expect(warn).toHaveBeenCalledWith('ORDER_CLAIM_ADDRESS_SKIPPED reason=invalid orderId=o1');
  });

  it('C8: la lectura de los pedidos ganados falla ⇒ log por pedido, reclamo intacto', async () => {
    const users = { createAddressFromClaim: jest.fn() };
    const { svc, prisma } = buildClaim([order('o1', 1)], users);
    prisma.order.findMany.mockRejectedValueOnce(new Error('db down'));
    const res = await svc.claim(ME, ['o1']);
    expect(res).toEqual({ claimed: ['o1'], failed: [], addressesSaved: 0 });
    expect(warn).toHaveBeenCalledWith('ORDER_CLAIM_ADDRESS_SKIPPED reason=error orderId=o1 error=Error');
  });

  it.each([['pending'], ['failed'], ['refunded'], ['chargeback']])(
    'C9: ganado `%s` (sin `status=settled`) ⇒ reclamado igual, ⛔ sin alta, log `reason=unsettled` sin domicilio (v1.116.1, PT-CHK-1)',
    async (status) => {
      const users = { createAddressFromClaim: jest.fn() };
      const { svc, tokens } = buildClaim([order('o1', 1, SNAP, { status })], users);
      const res = await svc.claim(ME, ['o1']);
      expect(res).toEqual({ claimed: ['o1'], failed: [], addressesSaved: 0 });
      expect(tokens.revokeAll).toHaveBeenCalledWith('o1', expect.any(Date));
      expect(users.createAddressFromClaim).not.toHaveBeenCalled();
      expect(warn.mock.calls).toEqual([['ORDER_CLAIM_ADDRESS_SKIPPED reason=unsettled orderId=o1']]);
    },
  );

  it('C9b: cobrado viejo + plantado sin cobro más nuevo ⇒ solo el cobrado pasa a la libreta', async () => {
    const users = { createAddressFromClaim: jest.fn() };
    const { svc } = buildClaim([order('real', 1), order('plantado', 20, { ...SNAP, line1: 'Bodega' }, { status: 'failed' })], users);
    const res = await svc.claim(ME, ['real', 'plantado']);
    expect(res).toEqual({ claimed: ['real', 'plantado'], failed: [], addressesSaved: 1 });
    expect(users.createAddressFromClaim.mock.calls.map((c) => c[1])).toEqual(['real']);
  });
});

// ─────────────────────── v1.116.1: candado de la libreta en alta y edición del cliente (PT-CHK-2/3) ───────────────────────

function buildBook(book: AddrRow[] = []) {
  const calls: string[] = [];
  let inTx = false;
  const rec = (name: string) => calls.push(inTx ? `tx:${name}` : name);
  const address = {
    findUnique: jest.fn(async ({ where }: { where: { id: string } }) => (rec('findUnique'), book.find((a) => a.id === where.id) ?? null)),
    updateMany: jest.fn(async () => (rec('updateMany'), { count: 0 })),
    create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => (rec('create'), { id: 'addr-new', line2: null, neighborhood: null, references: null, ...data })),
    update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => (rec('update'), { ...book.find((a) => a.id === where.id), ...data })),
  };
  const tx = {
    $executeRaw: jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => (rec(`lock:${strings.join('?')}|${JSON.stringify(values)}`), 1)),
    address,
  };
  const prisma = {
    address,
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => {
      inTx = true;
      try {
        return await fn(tx);
      } finally {
        inTx = false;
      }
    }),
  };
  const postalCodes = {
    resolveAddressGeo: jest.fn(async (postalCode: string, neighborhood: string, city: string, state: string) => (rec('geo'), { postalCode, neighborhood, city, state })),
  };
  const svc = new UsersService(prisma as never, {} as never, {} as never, {} as never, undefined, postalCodes as never);
  return { svc, prisma, calls };
}

const LOCK = `lock:SELECT pg_advisory_xact_lock(?::int, hashtext(?))|${JSON.stringify([ADDRESS_BOOK_GATE_NAMESPACE, ME.id])}`;
const BODY = { recipientName: 'Ana Pérez', line1: 'Av. Siempre Viva 742', neighborhood: 'San Ángel', city: 'CDMX', state: 'CDMX', postalCode: '01000', country: 'MX', phone: '5555555555' };
const MINE: AddrRow = { id: 'a1', userId: ME.id, postalCode: '01000', line1: 'Calle 1', line2: null, neighborhood: 'Centro', isDefault: false };

describe('L · candado de la libreta en POST/PATCH /users/me/addresses (v1.116.1)', () => {
  it('L1: POST {isDefault:true} ⇒ geo fuera; en la tx: candado → quitar predeterminada → alta', async () => {
    const { svc, calls } = buildBook();
    await svc.createAddress(ME.id, { ...BODY, isDefault: true } as never);
    expect(calls).toEqual(['geo', `tx:${LOCK}`, 'tx:updateMany', 'tx:create']);
  });

  it('L2: POST sin isDefault ⇒ candado → alta (sin tocar la predeterminada)', async () => {
    const { svc, calls } = buildBook();
    await svc.createAddress(ME.id, { ...BODY, isDefault: false } as never);
    expect(calls).toEqual(['geo', `tx:${LOCK}`, 'tx:create']);
  });

  it('L3: PATCH {isDefault:true} ⇒ dueño fuera; en la tx: candado → quitar predeterminada → edición', async () => {
    const { svc, calls } = buildBook([{ ...MINE }]);
    await svc.updateAddress(ME.id, 'a1', { isDefault: true });
    expect(calls).toEqual(['findUnique', `tx:${LOCK}`, 'tx:updateMany', 'tx:update']);
  });

  it('L4: ⛔ nada se escribe ni se abre tx antes de validar: POST inválido, PATCH de dirección ajena', async () => {
    const a = buildBook();
    await expect(a.svc.createAddress(ME.id, { ...BODY, recipientName: ' ', isDefault: true } as never)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(a.svc.createAddress(ME.id, { ...BODY, country: 'US', isDefault: true } as never)).rejects.toMatchObject({ code: 'ADDRESS_NOT_MX' });
    expect(a.prisma.$transaction).not.toHaveBeenCalled();
    const b = buildBook([{ ...MINE, userId: 'otro' }]);
    await expect(b.svc.updateAddress(ME.id, 'a1', { isDefault: true })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(b.prisma.$transaction).not.toHaveBeenCalled();
    expect(b.calls).toEqual(['findUnique']);
  });
});
