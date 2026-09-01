import { ConfigService } from '@nestjs/config';
import { BuylistService } from '../src/modules/buylist/buylist.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { UsersService } from '../src/modules/users/users.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';

const pii = new PiiCryptoService(new ConfigService({}));

/**
 * v1.8-ronda-c — deudas de backend cerradas en buylist:
 *  - RB-6/SEC-D3: `approvedTotalCents` se DERIVA server-side (suma de approvedPriceCents) y se persiste.
 *  - RB-3: el cap AML de la aprobación honra `kyc.capPerRequestCentsOverride` por-usuario.
 *  - SEC-D2: `closedAt` se sella en las transiciones TERMINALES (rechazada por respond, pagada por paySpei).
 */
function buildSettings(capPerRequest = 300_000): SettingsService {
  return {
    getNumber: jest.fn(async (key: string) =>
      key === 'buylist_cap_per_request_cents' ? capPerRequest : 0,
    ),
  } as unknown as SettingsService;
}

describe('itemDecision — RB-6 approvedTotalCents + RB-3 cap por-KYC', () => {
  function build(opts: {
    item: any;
    kycOverride?: number | null;
    aggregateSum?: number | null;
    aggregateCount?: number;
    settings?: SettingsService;
    /** v1.51.5 · BL-14: estado de la SOLICITUD dueña del ítem. */
    requestStatus?: string;
    /** v1.51.5 · BL-14: `count` que devuelve la guarda del motor (0 = chocó con un terminal). */
    guardCount?: number;
  }) {
    // v1.51.5 · BL-14: el `include` de `itemDecision` ahora trae el ESTADO de la solicitud (sin él,
    // la guarda de terminal no podría comprobarse) — el fixture lo espeja. `status` por defecto:
    // `verificacion` (viva), que es el escenario de estos tests.
    const current: any = { ...opts.item };
    const withRel = {
      ...current,
      sellRequest: { userId: 'u1', status: opts.requestStatus ?? 'verificacion' },
    };
    const sellRequestUpdates: any[] = [];
    const prisma: any = {
      sellRequestItem: {
        // La PRIMERA lectura trae las relaciones; la RE-lectura post-`updateMany` trae la fila ya
        // escrita (el servicio ya no usa el valor de retorno de un `update`).
        findUnique: jest.fn(async (args: any) =>
          args?.include ? { ...current, ...withRel, ...current } : { ...current },
        ),
        // v1.51.5 · BL-14: la escritura pasa a `updateMany` + `count === 1` con la guarda de terminal
        // en el `where`. El fixture aplica el `data` sobre la fila viva para que la re-lectura vea lo
        // escrito, igual que haría el motor.
        updateMany: jest.fn(async ({ data }: any) => {
          Object.assign(current, data);
          return { count: opts.guardCount ?? 1 };
        }),
        update: jest.fn(async ({ data }: any) => ({ id: opts.item.id, ...data })),
        aggregate: jest.fn().mockResolvedValue({
          _sum: { approvedPriceCents: opts.aggregateSum ?? null },
          _count: { approvedPriceCents: opts.aggregateCount ?? 0 },
        }),
        // v1.24-buylist-request-reject: la auto-transición cuenta ítems no-rechazados restantes;
        // default 1 (≥1 vivo) ⇒ NO auto-rechaza en estos tests item-céntricos.
        count: jest.fn(async () => 1),
      },
      sellRequest: {
        update: jest.fn(async (args: any) => {
          sellRequestUpdates.push(args);
          return {};
        }),
        // v1.24-buylist-request-reject: guarda atómica «no pisar terminal» de la auto-transición.
        updateMany: jest.fn(async () => ({ count: 1 })),
        findMany: jest.fn().mockResolvedValue([]), // AML-1: pagos previos del mes (ninguno).
      },
      kycProfile: {
        findUnique: jest
          .fn()
          .mockResolvedValue(
            opts.kycOverride === undefined ? null : { capPerRequestCentsOverride: opts.kycOverride },
          ),
      },
      // v1.24 (endurecimiento §4.18f): la auto-transición del reject corre count+updateMany en un
      // $transaction Serializable; el mock ejecuta el callback con `prisma` como `tx`.
      $transaction: jest.fn(async (cb: any, _opts?: any) => cb(prisma)),
    };
    const svc = new BuylistService(
      prisma as PrismaService,
      {} as PricingService,
      opts.settings ?? buildSettings(),
      {} as UsersService,
      pii,
    );
    return { svc, prisma, sellRequestUpdates };
  }

  it('RB-6: tras aprobar, persiste approvedTotalCents = suma de approvedPriceCents de los ítems', async () => {
    const { svc, sellRequestUpdates } = build({
      item: { id: 'sri-1', quotedPriceCents: 5000, itemStatus: 'verificacion', sellRequestId: 'sr-1' },
      aggregateSum: 8000, // dos ítems aprobados suman 8000
      aggregateCount: 2,
    });
    await svc.itemDecision('sri-1', 'approve', 5000);
    // El último update de sellRequest escribe el total derivado (no viene del cliente).
    const totalUpdate = sellRequestUpdates.find(
      (u) => u.data && Object.prototype.hasOwnProperty.call(u.data, 'approvedTotalCents'),
    );
    expect(totalUpdate).toBeDefined();
    expect(totalUpdate.data.approvedTotalCents).toBe(8000);
    expect(totalUpdate.where).toEqual({ id: 'sr-1' });
  });

  it('RB-6: sin ítems aprobados, approvedTotalCents = null (distingue "sin aprobar" de "cero")', async () => {
    const { svc, sellRequestUpdates } = build({
      item: { id: 'sri-1', quotedPriceCents: 5000, itemStatus: 'verificacion', sellRequestId: 'sr-1' },
      aggregateSum: null,
      aggregateCount: 0,
    });
    // v1.18-buylist-rejects: reject exige `reason` (3–500 chars).
    await svc.itemDecision('sri-1', 'reject', undefined, 'no es NM: whitening en el reverso');
    const totalUpdate = sellRequestUpdates.find(
      (u) => u.data && Object.prototype.hasOwnProperty.call(u.data, 'approvedTotalCents'),
    );
    expect(totalUpdate.data.approvedTotalCents).toBeNull();
  });

  it('RB-3: aprueba un monto que supera el dial global PERO cabe en el override por-KYC del usuario', async () => {
    // dial global = 300,000; override del usuario = 900,000. Aprobar 500,000 (≤ override, ≤ 2× quoted).
    const { svc, prisma } = build({
      item: { id: 'sri-1', quotedPriceCents: 300_000, itemStatus: 'verificacion', sellRequestId: 'sr-1' },
      kycOverride: 900_000,
      aggregateSum: 500_000,
      aggregateCount: 1,
    });
    const res = await svc.itemDecision('sri-1', 'approve', 500_000);
    expect(res).toMatchObject({ itemStatus: 'aprobada', approvedPriceCents: 500_000 });
    // v1.51.5 · BL-14: la escritura es `updateMany` guardado, no un `update` a pelo.
    expect(prisma.sellRequestItem.updateMany).toHaveBeenCalled();
  });

  it('RB-3: sin override, el mismo monto (500,000 > dial 300,000) se RECHAZA por el cap AML', async () => {
    const { svc } = build({
      item: { id: 'sri-1', quotedPriceCents: 300_000, itemStatus: 'verificacion', sellRequestId: 'sr-1' },
      kycOverride: null,
      aggregateSum: 0,
      aggregateCount: 0,
    });
    await expect(svc.itemDecision('sri-1', 'approve', 500_000)).rejects.toMatchObject({
      code: 'APPROVED_PRICE_CAP_EXCEEDED',
    });
  });
});

describe('closedAt — SEC-D2 sella el cierre en transiciones terminales', () => {
  it('respond(decline) → rechazada con closedAt', async () => {
    const updates: any[] = [];
    // v1.51 · BL-2: la transición de `respond` ya NO es un `update` a pelo — va en el `updateMany`
    // CONDICIONAL que hace de guarda atómica (`count===1`), dentro de una transacción. `closedAt` se
    // sella ahí, en el mismo `data`.
    const row = {
      id: 'sr-1',
      userId: 'u1',
      status: 'verificacion',
      adjustmentSentAt: new Date('2026-08-02T00:00:00Z'),
      closedAt: null,
    };
    const prisma: any = {
      // v2.1.6 (AML-1, §4.36.6a): `paySpei` re-verifica el tope MENSUAL contra el dinero que SALE.
      // Sin KYC override y sin pagos previos del mes, el control es no-op y el pago procede.
      kycProfile: { findUnique: jest.fn().mockResolvedValue(null) },
      sellRequest: {
        findUnique: jest.fn(async () => ({ ...row })),
        updateMany: jest.fn(async (args: any) => {
          updates.push(args);
          return { count: 1 };
        }),
      },
      sellRequestItem: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      $transaction: jest.fn(async (cb: any, _opts?: any) => cb(prisma)),
    };
    const svc = new BuylistService(
      prisma as PrismaService,
      {} as PricingService,
      { getNumber: jest.fn(async () => 100_000_000) } as unknown as SettingsService,
      {} as UsersService,
      pii,
    );
    await svc.respond('u1', 'sr-1', 'decline');
    expect(updates[0].data.status).toBe('rechazada');
    expect(updates[0].data.closedAt).toBeInstanceOf(Date);
  });

  it('paySpei → pagada con closedAt en el updateMany terminal', async () => {
    const prisma: any = {
      // v2.1.6 (AML-1, §4.36.6a): `paySpei` re-verifica el tope MENSUAL contra el dinero que SALE.
      // Sin KYC override y sin pagos previos del mes, el control es no-op y el pago procede.
      kycProfile: { findUnique: jest.fn().mockResolvedValue(null) },
      sellRequest: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({ id: 'sr', status: 'aprobada', verifiedAt: new Date() })
          .mockResolvedValue({ id: 'sr', status: 'pagada', verifiedAt: new Date() }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([]), // AML-1: pagos previos del mes (ninguno).
      },
      // v1.28 (P-22): el pago corre en $transaction (conteo de bounty en la misma tx); sin ítems
      // bounty el conteo es no-op.
      sellRequestItem: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    const svc = new BuylistService(
      prisma as PrismaService,
      {} as PricingService,
      { getNumber: jest.fn(async () => 100_000_000) } as unknown as SettingsService,
      {} as UsersService,
      pii,
    );
    await svc.paySpei('sr', 'SPEI-REF', 'admin');
    const call = prisma.sellRequest.updateMany.mock.calls[0][0];
    expect(call.data.status).toBe('pagada');
    expect(call.data.closedAt).toBeInstanceOf(Date);
  });
});
