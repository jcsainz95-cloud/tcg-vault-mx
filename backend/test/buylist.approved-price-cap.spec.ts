import { ConfigService } from '@nestjs/config';
import { BuylistService } from '../src/modules/buylist/buylist.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { UsersService } from '../src/modules/users/users.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';

const pii = new PiiCryptoService(new ConfigService({}));

/**
 * B-4 / S-B5 (pentest) — Tope de `approvedPriceCents` en la decisión carta-por-carta.
 * Un `vault_operator`/admin NO puede aprobar un monto de SPEI arbitrario: el monto se
 * acota server-side a ≤ quotedPriceCents × 2 y ≤ tope AML por solicitud (300,000c default).
 */
function buildSettings(capPerRequest = 300_000): SettingsService {
  return {
    getNumber: jest.fn(async (key: string) => {
      if (key === 'buylist_cap_per_request_cents') return capPerRequest;
      return 0;
    }),
  } as unknown as SettingsService;
}

function buildService(item: any, settings = buildSettings()) {
  // v1.8-ronda-c: itemDecision ahora incluye sellRequest.userId (RB-3 cap por-KYC) y recalcula
  // approvedTotalCents (RB-6). El mock provee el include, kycProfile (sin override) y el aggregate.
  // v1.51.5 · BL-14: el `include` trae además el ESTADO de la solicitud, y la escritura del ítem es
  // un `updateMany` guardado (`count === 1`) seguido de una relectura.
  const withRel = {
    ...item,
    sellRequest: { userId: item.userId ?? 'u1', status: item.requestStatus ?? 'verificacion' },
  };
  const live: any = { ...item };
  const prisma: any = {
    sellRequestItem: {
      findUnique: jest.fn(async (args: any) => (args?.include ? withRel : { ...live })),
      updateMany: jest.fn(async ({ data }: any) => {
        Object.assign(live, data);
        return { count: 1 };
      }),
      update: jest.fn(async ({ data }: any) => ({ id: item.id, ...data })),
      aggregate: jest.fn().mockResolvedValue({
        _sum: { approvedPriceCents: 0 },
        _count: { approvedPriceCents: 0 },
      }),
    },
    sellRequest: { update: jest.fn(), updateMany: jest.fn(async () => ({ count: 1 })) },
    kycProfile: { findUnique: jest.fn().mockResolvedValue(item.kyc ?? null) },
    $transaction: jest.fn(async (cb: any, _opts?: any) => cb(prisma)),
  };
  const svc = new BuylistService(
    prisma as PrismaService,
    {} as PricingService,
    settings,
    {} as UsersService,
    pii,
  );
  return { svc, prisma };
}

describe('BuylistService.itemDecision — cota de approvedPriceCents (B-4)', () => {
  it('RECHAZA aprobar muy por encima de lo cotizado (PoC: monto arbitrario)', async () => {
    const { svc, prisma } = buildService({
      id: 'sri-1',
      quotedPriceCents: 5000,
      itemStatus: 'verificacion',
      sellRequestId: 'sr-1',
    });
    await expect(svc.itemDecision('sri-1', 'approve', 99_999_999)).rejects.toMatchObject({
      code: 'APPROVED_PRICE_CAP_EXCEEDED',
    });
    expect(prisma.sellRequestItem.updateMany).not.toHaveBeenCalled();
  });

  it('RECHAZA un ajuste al alza por encima del tope AML por solicitud aunque no supere 2x', async () => {
    // quoted alto → cota relativa (2x = 800,000) > cota AML (300,000). Manda la AML.
    const { svc } = buildService({
      id: 'sri-2',
      quotedPriceCents: 400_000,
      itemStatus: 'verificacion',
      sellRequestId: 'sr-2',
    });
    await expect(svc.itemDecision('sri-2', 'adjust', 500_000)).rejects.toMatchObject({
      code: 'APPROVED_PRICE_CAP_EXCEEDED',
    });
  });

  it('ACEPTA un ajuste al alza normal dentro del factor (≤ 2x lo cotizado)', async () => {
    const { svc, prisma } = buildService({
      id: 'sri-3',
      quotedPriceCents: 5000,
      itemStatus: 'verificacion',
      sellRequestId: 'sr-3',
    });
    const res = await svc.itemDecision('sri-3', 'adjust', 8000); // 1.6x
    expect(res).toMatchObject({ itemStatus: 'ajustada', approvedPriceCents: 8000 });
    // v1.51.5 · BL-14: el plazo de 7d también se escribe GUARDADO (`updateMany`), y DESPUÉS de la
    // decisión — antes se ponía primero y suelto, así que sobre una solicitud cerrada quedaba puesto
    // aunque la decisión no prosperara.
    expect(prisma.sellRequest.updateMany).toHaveBeenCalled();
  });

  it('ACEPTA aprobar el precio cotizado tal cual (flujo normal intacto)', async () => {
    const { svc } = buildService({
      id: 'sri-4',
      quotedPriceCents: 5000,
      itemStatus: 'verificacion',
      sellRequestId: 'sr-4',
    });
    const res = await svc.itemDecision('sri-4', 'approve');
    expect(res).toMatchObject({ itemStatus: 'aprobada', approvedPriceCents: 5000 });
  });

  it('sin quotedPriceCents (precio_pendiente) usa solo la cota AML: rechaza por encima del tope', async () => {
    const { svc } = buildService({
      id: 'sri-5',
      quotedPriceCents: null,
      itemStatus: 'verificacion',
      sellRequestId: 'sr-5',
    });
    await expect(svc.itemDecision('sri-5', 'approve', 300_001)).rejects.toMatchObject({
      code: 'APPROVED_PRICE_CAP_EXCEEDED',
    });
  });
});
