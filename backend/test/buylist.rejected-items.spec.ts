import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import { BuylistService } from '../src/modules/buylist/buylist.service';
import { AdminBuylistController } from '../src/modules/buylist/admin-buylist.controller';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { UsersService } from '../src/modules/users/users.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { ROLES_KEY } from '../src/common/decorators/roles.decorator';

const pii = new PiiCryptoService(new ConfigService({}));

const DAY_MS = 24 * 3600 * 1000;

/**
 * v1.18-buylist-rejects (§M5) — `GET /admin/buylist/rejected-items` (pestaña «Rechazadas»):
 * listado transversal paginado de ítems `itemStatus='rechazada'` con seller/carta/motivo/plazos,
 * orden `rejectedAt` desc (legacy null al final), misma protección de roles que el resto de M5.
 * También fija la proyección SellItemDTO de los campos de rechazo en listMine/getMine/adminGet.
 */

function buildService(prisma: any): BuylistService {
  return new BuylistService(
    prisma as unknown as PrismaService,
    // v1.22-2 / N-15: adminRejectedItems deriva displayFinishes de este lote (vacío = sin supresión).
    { getPricedRawFinishesBatch: jest.fn(async () => new Map()) } as unknown as PricingService,
    // v1.51.20 · BL-29: la proyección admin deriva `offerIssueDeadlineAt` y `offerReissueAlert` de
    // dos diales, así que `adminGet` necesita un `SettingsService` aunque este spec mire los rechazos.
    { getNumber: jest.fn(async () => 7) } as unknown as SettingsService,
    {} as UsersService,
    pii,
  );
}

const REJECTED_AT = new Date('2026-08-17T12:00:00Z');

function fakeRejectedRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    sellRequestId: 'sr-1',
    cardId: 'card-1',
    // Fila Prisma Card + include set (T-1: el servicio la proyecta con toCardDTO, no la pasa cruda).
    card: {
      id: 'card-1',
      externalId: 'base1-16',
      name: 'Pidgey',
      number: '16',
      rarity: 'Common',
      supertype: 'Pokémon',
      subtypes: ['Basic'],
      setId: 'set-1',
      imageSmallUrl: null,
      imageLargeUrl: null,
      availableFinishes: ['normal'],
      set: { id: 'set-1', name: 'Base Set' },
    },
    productType: 'raw',
    rawCondition: 'NM',
    finish: 'normal',
    quotedPriceCents: 5000,
    approvedPriceCents: null,
    itemStatus: 'rechazada',
    inventoryItemId: null,
    rejectedAt: REJECTED_AT,
    rejectionReason: 'no es NM: whitening en el reverso',
    sellRequest: {
      id: 'sr-1',
      userId: 'user-1',
      user: { id: 'user-1', name: 'Ash Ketchum', email: 'ash@example.com' },
    },
    ...overrides,
  };
}

describe('BuylistService.adminRejectedItems — shape RejectedSellItemDTO + orden', () => {
  it('filtra itemStatus=rechazada, ordena rejectedAt desc (legacy al final) y pagina', async () => {
    const findMany = jest.fn().mockResolvedValue([fakeRejectedRow('sri-1')]);
    const count = jest.fn().mockResolvedValue(1);
    const svc = buildService({ sellRequestItem: { findMany, count } });

    const res = await svc.adminRejectedItems(2, 50);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { itemStatus: 'rechazada' },
        orderBy: { rejectedAt: { sort: 'desc', nulls: 'last' } },
        skip: 50,
        take: 50,
      }),
    );
    expect(count).toHaveBeenCalledWith({ where: { itemStatus: 'rechazada' } });
    expect(res.page).toBe(2);
    expect(res.pageSize).toBe(50);
    expect(res.total).toBe(1);
  });

  it('cada fila trae seller, card (con set), finish, reason, rejectedAt y plazos DERIVADOS', async () => {
    const findMany = jest.fn().mockResolvedValue([fakeRejectedRow('sri-1')]);
    const count = jest.fn().mockResolvedValue(1);
    const svc = buildService({ sellRequestItem: { findMany, count } });

    const row: any = (await svc.adminRejectedItems(1, 20)).data[0];

    expect(row.id).toBe('sri-1');
    expect(row.sellRequestId).toBe('sr-1'); // deep-link al detalle
    // v1.51 · BL-15 (D12): `AdminSellerRef` gana `phone`. `null` en cuentas de Google / viejas.
    expect(row.seller).toEqual({
      id: 'user-1',
      name: 'Ash Ketchum',
      email: 'ash@example.com',
      phone: null,
    });
    // T-1: card es la proyección canónica CardDTO (§11) — setName PLANO, subtypes y
    // availableFinishes presentes; la relación Prisma cruda `set` NO se propaga.
    expect(row.card.name).toBe('Pidgey');
    expect(row.card.setName).toBe('Base Set');
    expect(row.card.set).toBeUndefined();
    expect(row.card.subtypes).toEqual(['Basic']);
    expect(row.card.availableFinishes).toEqual(['normal']);
    expect(row.productType).toBe('raw');
    expect(row.finish).toBe('normal');
    expect(row.quotedPriceCents).toBe(5000);
    expect(row.reason).toBe('no es NM: whitening en el reverso');
    expect(row.rejectedAt).toEqual(REJECTED_AT);
    // Plazos derivados server-side (7d/30d desde rejectedAt); NO se expone "fase" (la deriva el front).
    expect(row.returnDeadlineAt.getTime()).toBe(REJECTED_AT.getTime() + 7 * DAY_MS);
    expect(row.abandonDeadlineAt.getTime()).toBe(REJECTED_AT.getTime() + 30 * DAY_MS);
    expect(row.phase).toBeUndefined();
  });

  it('fila LEGACY (rechazada pre-M-22, sin rejectedAt) → reason/rejectedAt/plazos en null', async () => {
    const findMany = jest.fn().mockResolvedValue([
      fakeRejectedRow('sri-legacy', { rejectedAt: null, rejectionReason: null }),
    ]);
    const count = jest.fn().mockResolvedValue(1);
    const svc = buildService({ sellRequestItem: { findMany, count } });

    const row: any = (await svc.adminRejectedItems(1, 20)).data[0];
    expect(row.reason).toBeNull();
    expect(row.rejectedAt).toBeNull();
    expect(row.returnDeadlineAt).toBeNull();
    expect(row.abandonDeadlineAt).toBeNull();
  });

  it('userId? filtra por vendedor (simetría F1)', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const svc = buildService({ sellRequestItem: { findMany, count } });

    await svc.adminRejectedItems(1, 20, 'user-9');

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { itemStatus: 'rechazada', sellRequest: { userId: 'user-9' } },
      }),
    );
  });
});

describe('AdminBuylistController — roles y ruteo de rejected-items', () => {
  it('la clase exige vault_operator/super_admin (rejected-items hereda el guard de M5)', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, AdminBuylistController);
    expect(roles).toEqual([Role.vault_operator, Role.super_admin]);
    // El método NO relaja el guard con un @Roles propio (heredaría el de la clase).
    const methodRoles = Reflect.getMetadata(
      ROLES_KEY,
      AdminBuylistController.prototype.rejectedItems,
    );
    expect(methodRoles).toBeUndefined();
  });

  it('la ruta literal rejected-items está declarada ANTES de :id (no la captura el parámetro)', () => {
    const proto = AdminBuylistController.prototype as any;
    const methods = Object.getOwnPropertyNames(proto).filter((m) => m !== 'constructor');
    expect(methods.indexOf('rejectedItems')).toBeGreaterThan(-1);
    expect(methods.indexOf('rejectedItems')).toBeLessThan(methods.indexOf('get'));
    // Y el path del handler es el literal esperado.
    expect(Reflect.getMetadata('path', proto.rejectedItems)).toBe('rejected-items');
  });
});

describe('SellItemDTO — campos de rechazo en las proyecciones (listMine/getMine/adminGet)', () => {
  function fakeRequestRow(items: any[]) {
    return {
      id: 'sr-1',
      userId: 'user-1',
      user: { id: 'user-1', name: 'Ash Ketchum', email: 'ash@example.com' },
      status: 'verificacion',
      quotedTotalCents: 5000,
      approvedTotalCents: null,
      clabeSnapshotEnc: null,
      ineRequired: false,
      createdAt: new Date('2026-08-16T00:00:00Z'),
      items,
    };
  }

  const rejectedItem = {
    id: 'it-rej',
    cardId: 'card-1',
    card: { id: 'card-1', name: 'Pidgey', number: '16' },
    productType: 'raw',
    rawCondition: 'NM',
    finish: 'normal',
    rarity: 'Common',
    ruleMode: 'fixed',
    ruleValue: 50,
    ruleSource: 'rule',
    quotedPriceCents: 5000,
    approvedPriceCents: null,
    itemStatus: 'rechazada',
    inventoryItemId: null,
    rejectedAt: REJECTED_AT,
    rejectionReason: 'no es NM: whitening',
  };

  it('getMine (cliente): el ítem rechazado expone motivo y plazos; sin CLABE cifrada', async () => {
    const prisma: any = {
      sellRequest: {
        findUnique: jest.fn().mockResolvedValue(fakeRequestRow([rejectedItem])),
      },
    };
    const svc = buildService(prisma);
    const res: any = await svc.getMine('user-1', 'sr-1');
    const it = res.items[0];
    expect(it.rejectionReason).toBe('no es NM: whitening');
    expect(it.rejectedAt).toEqual(REJECTED_AT);
    expect(it.returnDeadlineAt.getTime()).toBe(REJECTED_AT.getTime() + 7 * DAY_MS);
    expect(it.abandonDeadlineAt.getTime()).toBe(REJECTED_AT.getTime() + 30 * DAY_MS);
    expect(res.clabeSnapshotEnc).toBeUndefined();
    expect(res.sellRequestId).toBe('sr-1');
  });

  it('ítem NO rechazado: los 4 campos se OMITEN', async () => {
    const prisma: any = {
      sellRequest: {
        findUnique: jest.fn().mockResolvedValue(
          fakeRequestRow([{ ...rejectedItem, itemStatus: 'aprobada', approvedPriceCents: 5000 }]),
        ),
      },
    };
    const svc = buildService(prisma);
    const it: any = (await svc.getMine('user-1', 'sr-1')).items[0];
    expect(it).not.toHaveProperty('rejectedAt');
    expect(it).not.toHaveProperty('rejectionReason');
    expect(it).not.toHaveProperty('returnDeadlineAt');
    expect(it).not.toHaveProperty('abandonDeadlineAt');
  });

  it('ítem rechazado LEGACY (sin rejectedAt): los 4 campos en null', async () => {
    const prisma: any = {
      sellRequest: {
        findUnique: jest.fn().mockResolvedValue(
          fakeRequestRow([{ ...rejectedItem, rejectedAt: null, rejectionReason: null }]),
        ),
      },
    };
    const svc = buildService(prisma);
    const it: any = (await svc.getMine('user-1', 'sr-1')).items[0];
    expect(it.rejectedAt).toBeNull();
    expect(it.rejectionReason).toBeNull();
    expect(it.returnDeadlineAt).toBeNull();
    expect(it.abandonDeadlineAt).toBeNull();
  });

  it('adminGet: expone seller (AdminSellerRef) y los items como SellItemDTO con rechazo', async () => {
    const prisma: any = {
      sellRequest: {
        findUnique: jest.fn().mockResolvedValue(fakeRequestRow([rejectedItem])),
      },
    };
    const svc = buildService(prisma);
    const res: any = await svc.adminGet('sr-1');
    expect(res.seller).toEqual({
      id: 'user-1',
      name: 'Ash Ketchum',
      email: 'ash@example.com',
      phone: null,
    });
    // El join crudo de User NO se propaga (solo el ref proyectado).
    expect(res.user).toBeUndefined();
    expect(res.items[0].rejectionReason).toBe('no es NM: whitening');
    expect(res.items[0].returnDeadlineAt).toEqual(new Date(REJECTED_AT.getTime() + 7 * DAY_MS));
  });
});
