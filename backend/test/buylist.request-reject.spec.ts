import { ConfigService } from '@nestjs/config';
import { BuylistService } from '../src/modules/buylist/buylist.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { UsersService } from '../src/modules/users/users.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { MailPort } from '../src/modules/mail/mail.port';

const pii = new PiiCryptoService(new ConfigService({}));

/**
 * v1.24-buylist-request-reject (API_CONTRACT §M5, ARCHITECTURE §4.18f/g — cierra P-4).
 *
 * Dos mecanismos:
 *  (f) AUTO-TRANSICIÓN de la SOLICITUD como efecto de `itemDecision('reject')`, TRAS el recompute:
 *      si TODO ítem queda `rechazada` (∅ ítems no-rechazados; `convertida_inventario` NO cuenta como
 *      rechazado) ⇒ `SellRequest.status='rechazada'` + `closedAt`. Guard «no pisar terminal».
 *  (g) CIERRE EXPLÍCITO `rejectRequest` (`POST /admin/buylist/:id/reject`): sella la solicitud SÓLO
 *      si todos los ítems ya están `rechazada`; ítem vivo ⇒ 422 REQUEST_HAS_NON_REJECTED_ITEMS;
 *      idempotente si ya `rechazada`; otro terminal (pagada/abandonada) ⇒ 409 CONFLICT; 404 si no hay.
 */

function buildSettings(): SettingsService {
  return {
    getNumber: jest.fn(async (key: string) =>
      key === 'buylist_cap_per_request_cents' ? 300_000 : 0,
    ),
  } as unknown as SettingsService;
}

function buildMail(): MailPort {
  return { send: jest.fn().mockResolvedValue({ id: 'mail-1' }) } as MailPort;
}

// ----------------------------- (f) auto-transición vía itemDecision(reject) -----------------------------

/**
 * Mock item-céntrico (mismo patrón que buylist.reject.spec) con control del `count` de ítems
 * NO-rechazados que restan en la solicitud tras el reject (motor de la regla f).
 */
function buildForItemDecision(nonRejectedRemaining: number) {
  const item = {
    id: 'sri-1',
    sellRequestId: 'sr-1',
    itemStatus: 'verificacion',
    quotedPriceCents: 5000,
    approvedPriceCents: null,
    finish: 'normal',
    rejectedAt: null,
    rejectionReason: null,
    sellRequest: {
      userId: 'u1',
      user: { email: 'seller@example.com', name: 'Ash', locale: 'es' },
    },
    card: { name: 'Pidgey', number: '16', set: { name: 'Base Set' } },
  };
  const prisma: any = {
    sellRequestItem: {
      findUnique: jest.fn().mockResolvedValue(item),
      update: jest.fn(async ({ data }: any) => ({ id: item.id, ...data })),
      aggregate: jest.fn(async () => ({
        _sum: { approvedPriceCents: null },
        _count: { approvedPriceCents: 0 },
      })),
      // Regla f: nº de ítems con itemStatus != 'rechazada' que restan tras el reject.
      count: jest.fn(async () => nonRejectedRemaining),
    },
    sellRequest: {
      update: jest.fn(async () => ({})),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    kycProfile: { findUnique: jest.fn().mockResolvedValue(null) },
    // v1.24 (endurecimiento §4.18f): count + updateMany de la auto-transición van en un
    // $transaction Serializable; el mock ejecuta el callback con el propio `prisma` como `tx`
    // (patrón de buylist.security/createRequest specs: `$transaction:(fn)=>fn(tx)`).
    $transaction: jest.fn(async (cb: any, _opts?: any) => cb(prisma)),
  };
  const svc = new BuylistService(
    prisma as PrismaService,
    {} as PricingService,
    buildSettings(),
    {} as UsersService,
    pii,
    buildMail(),
  );
  return { svc, prisma };
}

describe('itemDecision(reject) — auto-transición de la SOLICITUD (regla f)', () => {
  it('todos los ítems rechazados (último ítem no-rechazado) ⇒ solicitud a `rechazada` + `closedAt`', async () => {
    const { svc, prisma } = buildForItemDecision(0); // ∅ ítems no-rechazados restantes.
    await svc.itemDecision('sri-1', 'reject', undefined, 'no es NM: whitening');
    // Cuenta ítems NO-rechazados en la solicitud (convertida_inventario contaría como vivo).
    expect(prisma.sellRequestItem.count).toHaveBeenCalledWith({
      where: { sellRequestId: 'sr-1', itemStatus: { not: 'rechazada' } },
    });
    // Transición atómica con guarda «no pisar terminal» + closedAt sellado (Date).
    expect(prisma.sellRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 'sr-1', status: { notIn: ['pagada', 'rechazada', 'abandonada'] } },
      data: { status: 'rechazada', closedAt: expect.any(Date) },
    });
  });

  it('queda ≥1 ítem no-rechazado (p. ej. otro `aprobada` o `convertida_inventario`) ⇒ NO auto-rechaza', async () => {
    const { svc, prisma } = buildForItemDecision(1); // 1 ítem vivo restante.
    await svc.itemDecision('sri-1', 'reject', undefined, 'no es NM: edge nicks');
    expect(prisma.sellRequestItem.count).toHaveBeenCalled();
    expect(prisma.sellRequest.updateMany).not.toHaveBeenCalled();
  });

  it('re-reject sobre ítem YA rechazada = no-op: NO cuenta ítems ni transiciona (idempotencia v1.18)', async () => {
    const { svc, prisma } = buildForItemDecision(0);
    (prisma.sellRequestItem.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'sri-1',
      sellRequestId: 'sr-1',
      itemStatus: 'rechazada',
      rejectedAt: new Date('2026-08-10T12:00:00Z'),
      rejectionReason: 'no es NM: original',
      finish: 'normal',
      sellRequest: { userId: 'u1', user: { email: 'x@y.z', name: 'A', locale: 'es' } },
      card: { name: 'Pidgey', number: '16', set: { name: 'Base Set' } },
    });
    await svc.itemDecision('sri-1', 'reject', undefined, 'otro motivo');
    expect(prisma.sellRequestItem.count).not.toHaveBeenCalled();
    expect(prisma.sellRequest.updateMany).not.toHaveBeenCalled();
  });
});

// ----------------------------- (g) cierre explícito rejectRequest -----------------------------

/**
 * Mock solicitud-céntrico para `rejectRequest`. `sellRequest.findUnique` sirve dos lecturas: la
 * precondición (status crudo) y el `adminGet` final (shape completo). `liveItems` = ítems
 * no-rechazados que ve el guard de precondición.
 */
function buildForRejectRequest(opts: {
  status: string | null; // null ⇒ 404 (no existe)
  liveItems?: { itemStatus: string }[];
  // v1.24 (endurecimiento §4.18g): count del updateMany con guarda de estado. 0 ⇒ una transición
  // concurrente ganó la carrera; el servicio re-lee (select:{status}) y decide con `rereadStatus`.
  updateManyCount?: number;
  rereadStatus?: string;
}) {
  const found =
    opts.status == null
      ? null
      : {
          id: 'sr-1',
          userId: 'u1',
          status: opts.status,
          quotedTotalCents: 5000,
          approvedTotalCents: null,
          closedAt: null,
          clabeSnapshotEnc: null,
          items: [],
          user: { id: 'u1', name: 'Ash', email: 'seller@example.com' },
        };
  const prisma: any = {
    sellRequest: {
      // findUnique sirve TRES lecturas distintas según sus args:
      //  - `select:{status}` ⇒ re-lectura DENTRO de la tx (post updateMany count:0) → rereadStatus.
      //  - `include:{…}`      ⇒ adminGet final (shape 200) → `found` completo.
      //  - resto             ⇒ precondición inicial (status crudo) → `found`.
      findUnique: jest.fn(async (args: any) => {
        if (args?.select?.status) return { status: opts.rereadStatus };
        return found;
      }),
      updateMany: jest.fn(async () => ({ count: opts.updateManyCount ?? 1 })),
    },
    sellRequestItem: {
      findMany: jest.fn(async () => opts.liveItems ?? []),
    },
    kycProfile: { findUnique: jest.fn().mockResolvedValue(null) },
    // v1.24 (endurecimiento §4.18g): precondición + updateMany en un $transaction Serializable;
    // el mock corre el callback con `prisma` como `tx` (patrón `$transaction:(fn)=>fn(tx)`).
    $transaction: jest.fn(async (cb: any, _opts?: any) => cb(prisma)),
  };
  const svc = new BuylistService(
    prisma as PrismaService,
    {} as PricingService,
    buildSettings(),
    {} as UsersService,
    pii,
    buildMail(),
  );
  return { svc, prisma };
}

describe('rejectRequest — cierre explícito (regla g)', () => {
  it('éxito: todos los ítems ya rechazados ⇒ sella `rechazada`+`closedAt`, transitioned=true', async () => {
    const { svc, prisma } = buildForRejectRequest({ status: 'verificacion', liveItems: [] });
    // El `reason` del body es material de auditoría del controller — el servicio ya no lo recibe.
    const res = await svc.rejectRequest('sr-1');
    expect(res.transitioned).toBe(true);
    expect(prisma.sellRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 'sr-1', status: { notIn: ['pagada', 'rechazada', 'abandonada'] } },
      data: { status: 'rechazada', closedAt: expect.any(Date) },
    });
  });

  it('queda ítem vivo ⇒ 422 REQUEST_HAS_NON_REJECTED_ITEMS con nonRejectedItemStatuses', async () => {
    const { svc, prisma } = buildForRejectRequest({
      status: 'verificacion',
      liveItems: [{ itemStatus: 'aprobada' }, { itemStatus: 'convertida_inventario' }],
    });
    await expect(svc.rejectRequest('sr-1')).rejects.toMatchObject({
      code: 'REQUEST_HAS_NON_REJECTED_ITEMS',
      details: {
        nonRejectedItemStatuses: expect.arrayContaining(['aprobada', 'convertida_inventario']),
      },
    });
    expect(prisma.sellRequest.updateMany).not.toHaveBeenCalled();
  });

  it('idempotente: solicitud ya `rechazada` ⇒ 200 con estado actual, transitioned=false, sin re-sellar', async () => {
    const { svc, prisma } = buildForRejectRequest({ status: 'rechazada' });
    const res = await svc.rejectRequest('sr-1');
    expect(res.transitioned).toBe(false);
    expect(prisma.sellRequestItem.findMany).not.toHaveBeenCalled();
    expect(prisma.sellRequest.updateMany).not.toHaveBeenCalled();
  });

  it('otro estado terminal `pagada` ⇒ 409 CONFLICT con details.status', async () => {
    const { svc, prisma } = buildForRejectRequest({ status: 'pagada' });
    await expect(svc.rejectRequest('sr-1')).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { status: 'pagada' },
    });
    expect(prisma.sellRequest.updateMany).not.toHaveBeenCalled();
  });

  it('estado terminal `abandonada` ⇒ 409 CONFLICT', async () => {
    const { svc } = buildForRejectRequest({ status: 'abandonada' });
    await expect(svc.rejectRequest('sr-1')).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('solicitud inexistente ⇒ 404 NOT_FOUND', async () => {
    const { svc } = buildForRejectRequest({ status: null });
    await expect(svc.rejectRequest('nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  // -------- count-guard atómico: updateMany devuelve count:0 (carrera concurrente ganó) --------

  it('count-guard: updateMany count:0 y re-lectura `pagada` ⇒ 409 CONFLICT (sin transitioned ni auditoría fantasma)', async () => {
    // La precondición pasó (todos rechazados), pero entre la lectura y el update una transición
    // concurrente selló la solicitud como `pagada`. El updateMany con guarda no matchea → count:0.
    const { svc, prisma } = buildForRejectRequest({
      status: 'verificacion',
      liveItems: [],
      updateManyCount: 0,
      rereadStatus: 'pagada',
    });
    await expect(svc.rejectRequest('sr-1')).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { status: 'pagada' },
    });
    // El updateMany SÍ se intentó (guarda atómica), pero no cambió nada → no se reporta transición.
    expect(prisma.sellRequest.updateMany).toHaveBeenCalled();
  });

  it('count-guard: updateMany count:0 y re-lectura `rechazada` ⇒ idempotente transitioned=false', async () => {
    // Otra transición la dejó `rechazada` en la ventana: es el desenlace deseado → idempotente,
    // 200 con estado actual, SIN reportar `transitioned:true` (no hay cambio real que auditar).
    const { svc, prisma } = buildForRejectRequest({
      status: 'verificacion',
      liveItems: [],
      updateManyCount: 0,
      rereadStatus: 'rechazada',
    });
    const res = await svc.rejectRequest('sr-1');
    expect(res.transitioned).toBe(false);
    expect(prisma.sellRequest.updateMany).toHaveBeenCalled();
  });
});
