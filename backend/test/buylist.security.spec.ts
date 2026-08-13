import { Prisma } from '@prisma/client';
import { BuylistService } from '../src/modules/buylist/buylist.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { UsersService } from '../src/modules/users/users.service';

/**
 * Pruebas de seguridad de buylist:
 *  - SEC-A1: la categoría (monto a pagar) se deriva server-side de la rareza real.
 *  - SEC-A2: el tope mensual se valida atómicamente (read+create en transacción).
 *  - SEC-A3: convert-to-inventory no duplica por carrera (unique + P2002 = ya convertido).
 *  - SEC-M5: pay-spei idempotente + guardia de estado atómica.
 */

const VALID_CLABE = '012345678901234567'; // 18 dígitos

function buildPricing(referenceMxnCents: number | null): PricingService {
  return {
    gradeKeyFor: jest.fn().mockReturnValue('raw:NM'),
    getReference: jest.fn().mockResolvedValue(
      referenceMxnCents == null
        ? { status: 'pending' }
        : { status: 'priced', referenceMxnCents },
    ),
    escalatePending: jest.fn().mockResolvedValue(undefined),
  } as unknown as PricingService;
}

function buildSettings(capPerMonth: number): SettingsService {
  return {
    getRaw: jest.fn().mockResolvedValue({ Common: 'comun', 'Rare Holo': 'ex_plus' }),
    getNumber: jest.fn(async (key: string) => {
      if (key === 'buylist_cap_per_month_cents') return capPerMonth;
      if (key === 'buylist_cap_per_request_cents') return 100_000_000;
      if (key === 'ine_threshold_cents') return 100_000_000;
      return 0;
    }),
  } as unknown as SettingsService;
}

describe('BuylistService.createRequest — SEC-A1 categoría derivada del servidor', () => {
  it('ignora la category maliciosa del DTO y la deriva de la rareza real (no infla el pago)', async () => {
    const prisma: any = {
      // Carta COMÚN con referencia ALTA. Un DTO malicioso pide `ex_plus` (40% de la ref).
      card: { findUnique: jest.fn().mockResolvedValue({ id: 'card-common', rarity: 'Common' }) },
      kycProfile: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
      sellRequest: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { quotedTotalCents: 0 } }),
        create: jest.fn(async ({ data }: any) => ({
          id: 'sr-1',
          status: data.status,
          quotedTotalCents: data.quotedTotalCents,
          items: data.items.create.map((it: any, i: number) => ({
            id: `it-${i}`,
            cardId: it.cardId,
            card: { id: it.cardId, name: 'Pidgey', number: '16' },
            productType: it.productType,
            rawCondition: it.rawCondition ?? null,
            category: it.category,
            quotedPriceCents: it.quotedPriceCents,
            approvedPriceCents: null,
            itemStatus: it.itemStatus,
            inventoryItemId: null,
          })),
        })),
      },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    const svc = new BuylistService(
      prisma as PrismaService,
      buildPricing(1_000_000), // referencia alta: ex_plus daría 400,000c
      buildSettings(100_000_000),
      {} as UsersService,
    );

    const res = await svc.createRequest(
      'user-1',
      [{ cardId: 'card-common', productType: 'raw' as any, rawCondition: 'NM' as any, category: 'ex_plus' as any }],
      VALID_CLABE,
    );

    // Se cotiza como COMÚN (MX$0.50 = 50c), NO como ex_plus (400,000c).
    expect(res.quotedTotalCents).toBe(50);
    expect(res.items[0].category).toBe('comun');
    expect(res.items[0].quotedPriceCents).toBe(50);
  });
});

describe('BuylistService.createRequest — SEC-A2 tope mensual atómico (TOCTOU)', () => {
  it('lee el acumulado y crea DENTRO de una transacción serializable', async () => {
    let txOpts: any;
    const prisma: any = {
      card: { findUnique: jest.fn().mockResolvedValue({ id: 'c', rarity: 'Common' }) },
      kycProfile: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
      sellRequest: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { quotedTotalCents: 0 } }),
        create: jest.fn(async ({ data }: any) => ({ id: 'sr', status: data.status, quotedTotalCents: data.quotedTotalCents, items: [] })),
      },
      $transaction: jest.fn(async (cb: any, opts: any) => {
        txOpts = opts;
        return cb(prisma);
      }),
    };
    const svc = new BuylistService(prisma as PrismaService, buildPricing(null), buildSettings(100_000_000), {} as UsersService);
    await svc.createRequest('u', [{ cardId: 'c', productType: 'raw' as any, category: 'comun' as any }], VALID_CLABE);

    expect(txOpts?.isolationLevel).toBe(Prisma.TransactionIsolationLevel.Serializable);
    // El aggregate del acumulado se ejecuta con el cliente transaccional (dentro de $transaction).
    expect(prisma.sellRequest.aggregate).toHaveBeenCalled();
  });

  it('dos solicitudes concurrentes cerca del tope: solo una se crea (no excede el tope)', async () => {
    // Estado compartido = "fila única" del acumulado mensual serializado por la BD.
    const shared = { createdTotalCents: 0 };
    function build() {
      const prisma: any = {
        card: { findUnique: jest.fn().mockResolvedValue({ id: 'c', rarity: 'Common' }) },
        kycProfile: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
        sellRequest: {
          aggregate: jest.fn(async () => ({ _sum: { quotedTotalCents: shared.createdTotalCents } })),
          create: jest.fn(async ({ data }: any) => {
            shared.createdTotalCents += data.quotedTotalCents;
            return { id: 'sr', status: data.status, quotedTotalCents: data.quotedTotalCents, items: [] };
          }),
        },
        $transaction: jest.fn(async (cb: any) => cb(prisma)),
      };
      // Tope mensual = 80c; cada solicitud común = 50c → la segunda (50+50=100) excede.
      return new BuylistService(prisma as PrismaService, buildPricing(null), buildSettings(80), {} as UsersService);
    }

    const item = [{ cardId: 'c', productType: 'raw' as any, category: 'comun' as any }];
    // Serializable ⇒ efectivamente secuencial: la primera pasa, la segunda ve el acumulado.
    await build().createRequest('u', item, VALID_CLABE);
    await expect(build().createRequest('u', item, VALID_CLABE)).rejects.toMatchObject({
      code: 'BUYLIST_LIMIT_EXCEEDED',
    });
    expect(shared.createdTotalCents).toBe(50); // solo UNA solicitud creada
  });
});

describe('BuylistService.convertToInventory — SEC-A3 doble conversión', () => {
  it('dos conversiones concurrentes → un solo InventoryItem (P2002 = ya convertido)', async () => {
    const shared: { createdId: string | null } = { createdId: null };
    const prisma: any = {
      sellRequestItem: {
        // Ambas lecturas ven inventoryItemId=null (carrera antes de commit).
        findUnique: jest.fn().mockResolvedValue({
          id: 'sri-1',
          cardId: 'c1',
          productType: 'raw',
          rawCondition: 'NM',
          approvedPriceCents: 5000,
          quotedPriceCents: 5000,
          inventoryItemId: null,
          card: {},
        }),
        update: jest.fn(),
      },
      nextFolio: jest.fn(async () => 'INV-000001'),
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
      inventoryItem: {
        create: jest.fn(async ({ data }: any) => {
          if (shared.createdId) {
            throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
              code: 'P2002',
              clientVersion: '5.22.0',
            } as any);
          }
          shared.createdId = 'inv-1';
          return { id: 'inv-1', folio: data.folio };
        }),
        findFirst: jest.fn(async () => ({ id: shared.createdId })),
      },
      inventoryMovement: { create: jest.fn() },
    };
    const svc = new BuylistService(prisma as PrismaService, {} as PricingService, {} as SettingsService, {} as UsersService);

    const res1 = await svc.convertToInventory('sri-1', 'actor');
    const res2 = await svc.convertToInventory('sri-1', 'actor');

    expect(res1).toEqual({ inventoryItemId: 'inv-1', folio: 'INV-000001' });
    expect(res2).toEqual({ inventoryItemId: 'inv-1', alreadyConverted: true });
    expect(prisma.inventoryItem.create).toHaveBeenCalledTimes(2);
    // Solo se materializó UN InventoryItem.
    expect(shared.createdId).toBe('inv-1');
  });
});

describe('BuylistService.paySpei — SEC-M5 idempotencia + guardia de estado', () => {
  it('si ya está pagada, no hace un segundo asiento (idempotente)', async () => {
    const prisma: any = {
      sellRequest: {
        findUnique: jest.fn().mockResolvedValue({ id: 'sr', status: 'pagada', verifiedAt: new Date() }),
        updateMany: jest.fn(),
        update: jest.fn(),
      },
    };
    const svc = new BuylistService(prisma as PrismaService, {} as PricingService, {} as SettingsService, {} as UsersService);
    const res = await svc.paySpei('sr', 'SPEI-REF', 'admin');
    expect(res).toMatchObject({ status: 'pagada' });
    expect(prisma.sellRequest.updateMany).not.toHaveBeenCalled();
  });

  it('transición aprobada→pagada por updateMany atómico (count===1) con guardia de estado', async () => {
    const prisma: any = {
      sellRequest: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({ id: 'sr', status: 'aprobada', verifiedAt: new Date() })
          .mockResolvedValue({ id: 'sr', status: 'pagada', verifiedAt: new Date() }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const svc = new BuylistService(prisma as PrismaService, {} as PricingService, {} as SettingsService, {} as UsersService);
    const res = await svc.paySpei('sr', 'SPEI-REF', 'admin');
    expect(res).toMatchObject({ status: 'pagada' });
    const call = prisma.sellRequest.updateMany.mock.calls[0][0];
    expect(call.where.status.in).toEqual(expect.arrayContaining(['aprobada', 'verificacion']));
    expect(call.where.verifiedAt).toEqual({ not: null });
  });
});
