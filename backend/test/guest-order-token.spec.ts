import { createHash } from 'crypto';
import {
  hashOrderAccessToken,
  OrderAccessTokenService,
} from '../src/modules/orders/order-access-token.service';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  GUEST_CHECKOUT_TOKEN_TTL_MIN,
  GUEST_RESEND_MAX_PER_DAY,
  GUEST_TRACKING_TTL_DAYS,
} from '../src/modules/orders/guest-checkout.constants';

/**
 * Enlace tokenizado del invitado (API_CONTRACT §4-G.7, ARCHITECTURE §4.21e — amenazas T1/T5/T7).
 * Lo que esta suite blinda: el claro NUNCA se persiste, el lookup es por SHA-256, el token es
 * MULTI-USO pero revocable, la emisión ROTA los anteriores y el TTL es de 90 días.
 */
describe('OrderAccessTokenService', () => {
  const rows: any[] = [];
  let prisma: any;
  let svc: OrderAccessTokenService;

  beforeEach(() => {
    rows.length = 0;
    prisma = {
      orderAccessToken: {
        create: jest.fn(async ({ data }: any) => {
          const row = { id: `tok-${rows.length + 1}`, createdAt: new Date(), revokedAt: null, useCount: 0, ...data };
          rows.push(row);
          return row;
        }),
        findUnique: jest.fn(async ({ where }: any) => rows.find((r) => r.tokenHash === where.tokenHash) ?? null),
        // (el mock ignora `select`: devolver la fila entera basta para los asserts)
        updateMany: jest.fn(async ({ where, data }: any) => {
          const hits = rows.filter((r) => r.orderId === where.orderId && r.revokedAt === null);
          hits.forEach((r) => Object.assign(r, data));
          return { count: hits.length };
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const row = rows.find((r) => r.id === where.id);
          if (row) Object.assign(row, { lastUsedAt: data.lastUsedAt, useCount: row.useCount + 1 });
          return row;
        }),
        count: jest.fn(async ({ where }: any) =>
          rows.filter(
            (r) =>
              r.orderId === where.orderId &&
              (where.revokedAt === null ? r.revokedAt === null : true) &&
              (where.createdAt?.gte ? r.createdAt >= where.createdAt.gte : true),
          ).length,
        ),
      },
      order: { findUnique: jest.fn(async () => ({ claimedAt: null })) },
    };
    svc = new OrderAccessTokenService(prisma as PrismaService);
  });

  it('emite 32 bytes base64url y persiste SOLO el SHA-256 (el claro jamás toca la BD)', async () => {
    const { clear } = await svc.issue('order-1');
    expect(clear).toHaveLength(43); // 32 bytes en base64url
    expect(clear).toMatch(/^[A-Za-z0-9_-]+$/);
    const stored = JSON.stringify(rows);
    expect(stored).not.toContain(clear);
    expect(rows[0].tokenHash).toBe(createHash('sha256').update(clear).digest('hex'));
    expect(hashOrderAccessToken(clear)).toBe(rows[0].tokenHash);
    // Un dump de BD no produce enlaces válidos: solo hay hashes (T5).
    expect(rows[0]).not.toHaveProperty('token');
  });

  it('por defecto fija expiración a 90 días: es el token de SEGUIMIENTO (el que va por correo)', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const { expiresAt } = await svc.issue('order-1', { now });
    const days = (expiresAt.getTime() - now.getTime()) / 86_400_000;
    expect(days).toBe(GUEST_TRACKING_TTL_DAYS);
  });

  it('v1.21.1 §4-G.7a: con `ttlMs` emite el token de CHECKOUT (120 min) en la MISMA tabla', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const { expiresAt } = await svc.issue('order-1', {
      now,
      ttlMs: GUEST_CHECKOUT_TOKEN_TTL_MIN * 60 * 1000,
    });
    expect(expiresAt.getTime() - now.getTime()).toBe(120 * 60 * 1000);
    // Sin columna de tipo: lo ÚNICO que distingue las dos vidas es `expiresAt`.
    expect(rows[0]).not.toHaveProperty('type');
    expect(rows[0]).not.toHaveProperty('purpose');
    expect(Object.keys(rows[0])).toEqual(
      expect.arrayContaining(['orderId', 'tokenHash', 'expiresAt']),
    );
  });

  it('dos emisiones nunca producen el mismo token (256 bits de entropía, T1)', async () => {
    const a = await svc.issue('order-1', { rotate: false });
    const b = await svc.issue('order-1', { rotate: false });
    expect(a.clear).not.toBe(b.clear);
  });

  it('ROTA por defecto: emitir uno nuevo revoca los vigentes ⇒ solo el último enlace funciona', async () => {
    const first = await svc.issue('order-1');
    const second = await svc.issue('order-1');
    const oldOne = await svc.validate(first.clear);
    const newOne = await svc.validate(second.clear);
    expect(oldOne.ok).toBe(false);
    expect((oldOne as any).code).toBe('TOKEN_REVOKED');
    expect((oldOne as any).reason).toBe('ROTATED');
    expect(newOne.ok).toBe(true);
  });

  it('con rotate:false coexisten (caso del correo de confirmación tras el checkout)', async () => {
    const checkoutToken = await svc.issue('order-1', { rotate: false });
    const mailToken = await svc.issue('order-1', { rotate: false });
    expect((await svc.validate(checkoutToken.clear)).ok).toBe(true);
    expect((await svc.validate(mailToken.clear)).ok).toBe(true);
  });

  it('es MULTI-USO: no hay `usedAt` y el mismo token vale muchas veces', async () => {
    const { clear } = await svc.issue('order-1');
    expect(rows[0]).not.toHaveProperty('usedAt');
    for (let i = 0; i < 5; i++) {
      const v = await svc.validate(clear);
      expect(v.ok).toBe(true);
      if (v.ok) await svc.markUsed(v.token.id);
    }
    expect(rows[0].useCount).toBe(5);
    expect((await svc.validate(clear)).ok).toBe(true);
  });

  it('token inventado/manipulado → INVALID_TOKEN (sin decir nada del pedido)', async () => {
    await svc.issue('order-1');
    const res = await svc.validate('token-que-nunca-existio');
    expect(res).toEqual({ ok: false, code: 'INVALID_TOKEN' });
  });

  it('token expirado → TOKEN_EXPIRED', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const { clear } = await svc.issue('order-1', { now });
    const later = new Date(now.getTime() + (GUEST_TRACKING_TTL_DAYS + 1) * 86_400_000);
    const res = await svc.validate(clear, later);
    expect(res.ok).toBe(false);
    expect((res as any).code).toBe('TOKEN_EXPIRED');
  });

  it('revocado por RECLAMO → TOKEN_REVOKED con reason CLAIMED', async () => {
    const { clear } = await svc.issue('order-1');
    await svc.revokeAll('order-1');
    prisma.order.findUnique.mockResolvedValue({ claimedAt: new Date() });
    const res = await svc.validate(clear);
    expect(res.ok).toBe(false);
    expect((res as any).code).toBe('TOKEN_REVOKED');
    expect((res as any).reason).toBe('CLAIMED');
  });

  it('v1.21.1: `SUPPORT` ya NO existe — sin reclamo, cualquier revocación reporta ROTATED', async () => {
    const { clear } = await svc.issue('order-1');
    await svc.revokeAll('order-1'); // revocación sin sucesor vivo (p. ej. rotación de soporte)
    const res = await svc.validate(clear);
    expect((res as any).reason).toBe('ROTATED');
    expect((res as any).reason).not.toBe('SUPPORT');
  });

  it('la derivación del motivo es LITERAL: claimedAt != null ⇒ CLAIMED; si no ⇒ ROTATED', async () => {
    const a = await svc.issue('order-1', { rotate: false });
    await svc.revokeAll('order-1');
    expect(((await svc.validate(a.clear)) as any).reason).toBe('ROTATED');
    prisma.order.findUnique.mockResolvedValue({ claimedAt: new Date() });
    expect(((await svc.validate(a.clear)) as any).reason).toBe('CLAIMED');
  });

  it('revokeAll es idempotente y solo toca los vigentes', async () => {
    await svc.issue('order-1', { rotate: false });
    await svc.issue('order-1', { rotate: false });
    expect(await svc.revokeAll('order-1')).toBe(2);
    expect(await svc.revokeAll('order-1')).toBe(0);
  });

  it('la cuota de reenvío se agota al llegar a GUEST_RESEND_MAX_PER_DAY en 24h', async () => {
    for (let i = 0; i < GUEST_RESEND_MAX_PER_DAY - 1; i++) await svc.issue('order-1', { rotate: false });
    expect(await svc.resendQuotaExceeded('order-1')).toBe(false);
    await svc.issue('order-1', { rotate: false });
    expect(await svc.resendQuotaExceeded('order-1')).toBe(true);
  });

  it('SELECTOR de reenvío: encuentra el pedido con un token EXPIRADO (§4-G.4, v1.21.1)', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const { clear } = await svc.issue('order-1', { now });
    // Expira el token: la LECTURA falla…
    const later = new Date(now.getTime() + (GUEST_TRACKING_TTL_DAYS + 1) * 86_400_000);
    expect((await svc.validate(clear, later)).ok).toBe(false);
    // …pero el reenvío SÍ lo acepta como selector (es justo la pantalla de "enlace expirado").
    expect(await svc.orderIdForSelector(clear)).toBe('order-1');
  });

  it('SELECTOR de reenvío: encuentra el pedido con un token REVOCADO', async () => {
    const { clear } = await svc.issue('order-1');
    await svc.revokeAll('order-1');
    expect((await svc.validate(clear)).ok).toBe(false);
    expect(await svc.orderIdForSelector(clear)).toBe('order-1');
  });

  it('SELECTOR: la consulta busca SOLO por hash — sin filtrar por expiresAt ni revokedAt', async () => {
    const { clear } = await svc.issue('order-1');
    prisma.orderAccessToken.findUnique.mockClear();
    await svc.orderIdForSelector(clear);
    const where = prisma.orderAccessToken.findUnique.mock.calls[0][0].where;
    expect(Object.keys(where)).toEqual(['tokenHash']);
    expect(where).not.toHaveProperty('expiresAt');
    expect(where).not.toHaveProperty('revokedAt');
  });

  it('SELECTOR: un token inventado no identifica ningún pedido', async () => {
    await svc.issue('order-1');
    expect(await svc.orderIdForSelector('token-que-nunca-existio')).toBeNull();
  });

  it('un token de OTRO pedido solo abre SU pedido (un token ⇒ un pedido)', async () => {
    const a = await svc.issue('order-A');
    const b = await svc.issue('order-B');
    const va = await svc.validate(a.clear);
    const vb = await svc.validate(b.clear);
    expect(va.ok && va.token.orderId).toBe('order-A');
    expect(vb.ok && vb.token.orderId).toBe('order-B');
  });
});
