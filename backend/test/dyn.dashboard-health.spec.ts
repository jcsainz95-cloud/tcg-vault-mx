/**
 * dyn.dashboard-health.spec.ts — v1.113⟨portada⟩ (API_CONTRACT §DYN.2.5, DYN-B8): `GET /admin/dashboard` →
 * `dataHealth.featuredRotation`, aditivo y SIN dinero ⇒ visible también a `vault_operator`. El cálculo del estado
 * (`ok|stale|never`) lo prueba `dyn.featured.service.spec.ts`; aquí, que el tablero lo transporte tal cual a los dos roles.
 */
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import { AdminService } from '../src/modules/admin/admin.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';

function build(featured: unknown) {
  const z = () => jest.fn().mockResolvedValue(0);
  const prisma = {
    order: { findMany: jest.fn().mockResolvedValue([]), count: z(), aggregate: jest.fn().mockResolvedValue({ _sum: { totalCents: 0 } }) },
    shipmentRequest: { findMany: jest.fn().mockResolvedValue([]), count: z() },
    sellRequest: { count: z(), aggregate: jest.fn().mockResolvedValue({ _sum: { approvedTotalCents: 0 } }) },
    dispute: { count: z() },
    pendingPriceEntry: { count: z() },
    priceReference: { findFirst: jest.fn().mockResolvedValue(null) },
    fxRate: { findFirst: jest.fn().mockResolvedValue(null) },
    user: { count: z() },
    inventoryItem: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const svc = new AdminService(
    prisma as unknown as PrismaService,
    {} as PricingService,
    new PiiCryptoService(new ConfigService({})),
    {} as never,
    undefined, undefined, undefined, undefined, undefined, undefined,
    featured as never,
  );
  jest.spyOn(svc, 'pnl').mockResolvedValue({ profitCents: 0 } as never);
  jest.spyOn(svc, 'inventoryValue').mockResolvedValue({ atReferenceCents: 0 } as never);
  jest.spyOn(svc, 'custodyValue').mockResolvedValue({ totalCustodyValueCents: 0 } as never);
  return svc;
}

describe('§DYN.2.5 — `dataHealth.featuredRotation`', () => {
  const health = { status: 'stale', servingBusinessDate: '2026-12-12', expectedBusinessDate: '2026-12-13' };
  it.each([Role.vault_operator, Role.super_admin])('%s lo recibe tal cual', async (role) => {
    const svc = build({ health: jest.fn(async () => health) });
    const res = (await svc.dashboard(role)) as { dataHealth: Record<string, unknown> };
    expect(res.dataHealth.featuredRotation).toEqual(health);
  });
  it('si leer la salud falla, el tablero NO cae: el campo dice `stale` (estado desconocido = algo que mirar)', async () => {
    const svc = build({ health: jest.fn(async () => { throw new Error('bd'); }) });
    const res = (await svc.dashboard(Role.vault_operator)) as { dataHealth: { featuredRotation: { status: string } } };
    expect(res.dataHealth.featuredRotation.status).toBe('stale');
  });
});
