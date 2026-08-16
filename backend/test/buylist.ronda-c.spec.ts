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
  }) {
    const withRel = { ...opts.item, sellRequest: { userId: 'u1' } };
    const sellRequestUpdates: any[] = [];
    const prisma: any = {
      sellRequestItem: {
        findUnique: jest.fn().mockResolvedValue(withRel),
        update: jest.fn(async ({ data }: any) => ({ id: opts.item.id, ...data })),
        aggregate: jest.fn().mockResolvedValue({
          _sum: { approvedPriceCents: opts.aggregateSum ?? null },
          _count: { approvedPriceCents: opts.aggregateCount ?? 0 },
        }),
      },
      sellRequest: {
        update: jest.fn(async (args: any) => {
          sellRequestUpdates.push(args);
          return {};
        }),
      },
      kycProfile: {
        findUnique: jest
          .fn()
          .mockResolvedValue(
            opts.kycOverride === undefined ? null : { capPerRequestCentsOverride: opts.kycOverride },
          ),
      },
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
    await svc.itemDecision('sri-1', 'reject');
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
    expect(prisma.sellRequestItem.update).toHaveBeenCalled();
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
    const prisma: any = {
      sellRequest: {
        findUnique: jest.fn().mockResolvedValue({ id: 'sr-1', userId: 'u1', status: 'aprobada' }),
        update: jest.fn(async (args: any) => {
          updates.push(args);
          return { id: 'sr-1', ...args.data };
        }),
      },
    };
    const svc = new BuylistService(
      prisma as PrismaService,
      {} as PricingService,
      {} as SettingsService,
      {} as UsersService,
      pii,
    );
    await svc.respond('u1', 'sr-1', 'decline');
    expect(updates[0].data.status).toBe('rechazada');
    expect(updates[0].data.closedAt).toBeInstanceOf(Date);
  });

  it('paySpei → pagada con closedAt en el updateMany terminal', async () => {
    const prisma: any = {
      sellRequest: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({ id: 'sr', status: 'aprobada', verifiedAt: new Date() })
          .mockResolvedValue({ id: 'sr', status: 'pagada', verifiedAt: new Date() }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const svc = new BuylistService(
      prisma as PrismaService,
      {} as PricingService,
      {} as SettingsService,
      {} as UsersService,
      pii,
    );
    await svc.paySpei('sr', 'SPEI-REF', 'admin');
    const call = prisma.sellRequest.updateMany.mock.calls[0][0];
    expect(call.data.status).toBe('pagada');
    expect(call.data.closedAt).toBeInstanceOf(Date);
  });
});
