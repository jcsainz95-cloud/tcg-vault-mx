import 'reflect-metadata';
import { Role } from '@prisma/client';
import { BusinessException } from '../src/common/business.exception';
import { ROLES_KEY } from '../src/common/decorators/roles.decorator';
import { SealedMappingService } from '../src/modules/pricing/sealed-mapping.service';
import { SealedPricingController } from '../src/modules/pricing/sealed-pricing.controller';
import { TcgcsvSealedBulkProvider } from '../src/modules/pricing/providers/tcgcsv-sealed.provider';
import { AuditService } from '../src/modules/audit/audit.service';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * v1.19-sealed-tcgcsv (§4.19c / API_CONTRACT §M2) — Curación MANUAL del mapeo item sellado ↔
 * producto TCGplayer: cola derivada de NO-mapeados, PUT de mapeo (validaciones, applyToSiblings,
 * auditoría) y explorador proxy (validación de groupId, 502 UPSTREAM_ERROR, roles).
 */

const SEALED_ITEM = {
  id: 'item-1',
  productType: 'sealed',
  cardId: 'card-1',
  sealedSubtype: 'etb',
  tcgplayerProductId: null,
  tcgplayerGroupId: null,
};

function buildService(opts: {
  item?: Record<string, unknown> | null;
  siblingsCount?: number;
}) {
  const prisma = {
    inventoryItem: {
      findUnique: jest.fn().mockResolvedValue(opts.item === undefined ? SEALED_ITEM : opts.item),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: opts.siblingsCount ?? 0 }),
    },
  } as unknown as PrismaService;
  return { svc: new SealedMappingService(prisma), prisma };
}

describe('SealedMappingService.updateMapping — validaciones del contrato §M2', () => {
  it('item inexistente → 404 NOT_FOUND', async () => {
    const { svc } = buildService({ item: null });
    await expect(
      svc.updateMapping('nope', { tcgplayerProductId: 1, tcgplayerGroupId: 2 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('item NO sealed → 422 VALIDATION_ERROR (el mapeo solo aplica a sellado)', async () => {
    const { svc } = buildService({ item: { ...SEALED_ITEM, productType: 'raw' } });
    await expect(
      svc.updateMapping('item-1', { tcgplayerProductId: 1, tcgplayerGroupId: 2 }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('productId con valor SIN tcgplayerGroupId → 422 (el fetch de precios es por grupo)', async () => {
    const { svc } = buildService({});
    await expect(
      svc.updateMapping('item-1', { tcgplayerProductId: 610894 }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('valores no enteros / negativos → 422', async () => {
    const { svc } = buildService({});
    await expect(
      svc.updateMapping('item-1', { tcgplayerProductId: 1.5, tcgplayerGroupId: 2 }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      svc.updateMapping('item-1', { tcgplayerProductId: -1, tcgplayerGroupId: 2 }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      svc.updateMapping('item-1', { tcgplayerProductId: 1, tcgplayerGroupId: 0 }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('mapea: fija productId y groupId JUNTOS; devuelve before para la auditoría', async () => {
    const { svc, prisma } = buildService({
      item: { ...SEALED_ITEM, tcgplayerProductId: 111, tcgplayerGroupId: 222 },
    });
    const res = await svc.updateMapping('item-1', {
      tcgplayerProductId: 610903,
      tcgplayerGroupId: 23821,
    });
    expect(prisma.inventoryItem.update).toHaveBeenCalledWith({
      where: { id: 'item-1' },
      data: { tcgplayerProductId: 610903, tcgplayerGroupId: 23821 },
    });
    expect(res).toEqual({
      inventoryItemId: 'item-1',
      tcgplayerProductId: 610903,
      tcgplayerGroupId: 23821,
      siblingsUpdated: 0,
      before: { tcgplayerProductId: 111, tcgplayerGroupId: 222 },
    });
  });

  it('tcgplayerProductId:null → DESMAPEA (limpia también groupId) sin exigir groupId', async () => {
    const { svc, prisma } = buildService({
      item: { ...SEALED_ITEM, tcgplayerProductId: 610894, tcgplayerGroupId: 23821 },
    });
    const res = await svc.updateMapping('item-1', { tcgplayerProductId: null });
    expect(prisma.inventoryItem.update).toHaveBeenCalledWith({
      where: { id: 'item-1' },
      data: { tcgplayerProductId: null, tcgplayerGroupId: null },
    });
    expect(res.tcgplayerProductId).toBeNull();
    expect(res.tcgplayerGroupId).toBeNull();
  });

  it('applyToSiblings copia el mapeo SOLO a sealed sin mapeo del mismo (cardId, sealedSubtype)', async () => {
    const { svc, prisma } = buildService({ siblingsCount: 3 });
    const res = await svc.updateMapping('item-1', {
      tcgplayerProductId: 610903,
      tcgplayerGroupId: 23821,
      applyToSiblings: true,
    });
    expect(prisma.inventoryItem.updateMany).toHaveBeenCalledWith({
      where: {
        id: { not: 'item-1' },
        productType: 'sealed',
        cardId: 'card-1',
        sealedSubtype: 'etb',
        tcgplayerProductId: null, // nunca pisa mapeos existentes
      },
      data: { tcgplayerProductId: 610903, tcgplayerGroupId: 23821 },
    });
    expect(res.siblingsUpdated).toBe(3);
  });

  it('applyToSiblings con DESMAPEO (null) no toca a nadie más (siblingsUpdated=0)', async () => {
    const { svc, prisma } = buildService({
      item: { ...SEALED_ITEM, tcgplayerProductId: 610894, tcgplayerGroupId: 23821 },
    });
    const res = await svc.updateMapping('item-1', {
      tcgplayerProductId: null,
      applyToSiblings: true,
    });
    expect(prisma.inventoryItem.updateMany).not.toHaveBeenCalled();
    expect(res.siblingsUpdated).toBe(0);
  });
});

describe('SealedMappingService.listUnmapped — cola DERIVADA (sealed AND productId IS NULL)', () => {
  it('proyecta la fila del contrato (inventoryItemId, folio, card, createdAt), asc por createdAt', async () => {
    const row = {
      id: 'item-1',
      folio: 'INV-000001',
      sealedSubtype: 'etb',
      listPriceCents: 250000,
      createdAt: new Date('2026-08-01T00:00:00Z'),
      card: {
        id: 'card-1',
        externalId: 'sv8-ancla',
        name: 'Pikachu ex',
        number: '057',
        rarity: 'Double Rare',
        supertype: 'Pokémon',
        subtypes: [],
        setId: 'set-1',
        imageSmallUrl: 'https://img/s.png',
        imageLargeUrl: 'https://img/l.png',
        availableFinishes: ['normal'],
        set: { name: 'Surging Sparks' },
      },
    };
    const prisma = {
      inventoryItem: {
        findMany: jest.fn().mockResolvedValue([row]),
        count: jest.fn().mockResolvedValue(1),
      },
    } as unknown as PrismaService;
    const svc = new SealedMappingService(prisma);
    const res = await svc.listUnmapped(1, 20);

    expect(prisma.inventoryItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { productType: 'sealed', tcgplayerProductId: null },
        orderBy: { createdAt: 'asc' },
        skip: 0,
        take: 20,
      }),
    );
    expect(res).toMatchObject({ page: 1, pageSize: 20, total: 1 });
    expect(res.data[0]).toMatchObject({
      inventoryItemId: 'item-1',
      folio: 'INV-000001',
      sealedSubtype: 'etb',
      listPriceCents: 250000,
      card: { id: 'card-1', name: 'Pikachu ex', setName: 'Surging Sparks' },
    });
  });
});

describe('SealedPricingController — proxy TCGCSV + PUT mapping (roles, 400/422/502, auditoría)', () => {
  const user = { id: 'admin-1', role: Role.super_admin };

  function buildController(opts: {
    groups?: unknown[];
    products?: unknown[];
    fail?: boolean;
    mappingResult?: Record<string, unknown>;
  }) {
    const provider = {
      listGroups: opts.fail
        ? jest.fn().mockRejectedValue(new Error('HTTP 503'))
        : jest.fn().mockResolvedValue(opts.groups ?? []),
      listSealedProducts: opts.fail
        ? jest.fn().mockRejectedValue(new Error('HTTP 503'))
        : jest.fn().mockResolvedValue(opts.products ?? []),
    } as unknown as TcgcsvSealedBulkProvider;
    const mapping = {
      listUnmapped: jest.fn().mockResolvedValue({ data: [], page: 1, pageSize: 20, total: 0 }),
      updateMapping: jest.fn().mockResolvedValue(
        opts.mappingResult ?? {
          inventoryItemId: 'item-1',
          tcgplayerProductId: 610903,
          tcgplayerGroupId: 23821,
          siblingsUpdated: 2,
          before: { tcgplayerProductId: null, tcgplayerGroupId: null },
        },
      ),
    } as unknown as SealedMappingService;
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
    return { ctrl: new SealedPricingController(mapping, provider, audit), provider, mapping, audit };
  }

  it('el controller exige super_admin (roles a nivel de clase)', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, SealedPricingController);
    expect(roles).toEqual([Role.super_admin]);
  });

  it('GET tcgcsv/groups filtra por ?q= (case-insensitive) sobre el proxy read-only', async () => {
    const { ctrl } = buildController({
      groups: [
        { groupId: 23821, name: 'SV08: Surging Sparks' },
        { groupId: 23651, name: 'SV07: Stellar Crown' },
      ],
    });
    const res = await ctrl.groups('surging');
    expect(res.data).toEqual([{ groupId: 23821, name: 'SV08: Surging Sparks' }]);
  });

  it('GET tcgcsv/groups con remoto caído → 502 UPSTREAM_ERROR (no afecta nada local)', async () => {
    const { ctrl } = buildController({ fail: true });
    try {
      await ctrl.groups(undefined);
      fail('esperaba BusinessException');
    } catch (e) {
      const be = e as BusinessException;
      expect(be.code).toBe('UPSTREAM_ERROR');
      expect(be.getStatus()).toBe(502);
    }
  });

  it('GET .../:groupId/products valida entero positivo → 400 VALIDATION_ERROR (anti path-injection)', async () => {
    const { ctrl, provider } = buildController({});
    for (const bad of ['abc', '-1', '1.5', '0', '23821; DROP']) {
      try {
        await ctrl.products(bad, undefined);
        fail(`esperaba 400 para "${bad}"`);
      } catch (e) {
        const be = e as BusinessException;
        expect(be.code).toBe('VALIDATION_ERROR');
        expect(be.getStatus()).toBe(400);
      }
    }
    expect(provider.listSealedProducts).not.toHaveBeenCalled();
  });

  it('GET .../:groupId/products pasa el entero validado y filtra por ?q= (name/cleanName)', async () => {
    const { ctrl, provider } = buildController({
      products: [
        { productId: 610894, name: 'Surging Sparks Booster Box', cleanName: 'Surging Sparks Booster Box' },
        { productId: 610903, name: 'Surging Sparks Elite Trainer Box', cleanName: 'Surging Sparks Elite Trainer Box' },
      ],
    });
    const res = await ctrl.products('23821', 'elite');
    expect(provider.listSealedProducts).toHaveBeenCalledWith(23821);
    expect(res.data.map((p) => p.productId)).toEqual([610903]);
  });

  it('PUT mapping sin tcgplayerProductId en el body → 422 (ausente ≠ null)', async () => {
    const { ctrl, mapping } = buildController({});
    await expect(
      ctrl.updateMapping('item-1', { tcgplayerGroupId: 23821 } as never, user),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(mapping.updateMapping).not.toHaveBeenCalled();
  });

  it('PUT mapping audita pricing.sealed_mapping.update con before/after y responde el shape del contrato', async () => {
    const { ctrl, audit } = buildController({});
    const res = await ctrl.updateMapping(
      'item-1',
      { tcgplayerProductId: 610903, tcgplayerGroupId: 23821, applyToSiblings: true },
      user,
    );
    // Response del contrato — SIN `before` (eso va solo al AuditLog).
    expect(res).toEqual({
      inventoryItemId: 'item-1',
      tcgplayerProductId: 610903,
      tcgplayerGroupId: 23821,
      siblingsUpdated: 2,
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'pricing.sealed_mapping.update',
        entityType: 'InventoryItem',
        entityId: 'item-1',
        before: { tcgplayerProductId: null, tcgplayerGroupId: null },
        after: { tcgplayerProductId: 610903, tcgplayerGroupId: 23821, siblingsUpdated: 2 },
      }),
    );
  });

  it('PUT mapping con null (desmapeo explícito) SÍ llega al servicio', async () => {
    const { ctrl, mapping } = buildController({
      mappingResult: {
        inventoryItemId: 'item-1',
        tcgplayerProductId: null,
        tcgplayerGroupId: null,
        siblingsUpdated: 0,
        before: { tcgplayerProductId: 610894, tcgplayerGroupId: 23821 },
      },
    });
    const res = await ctrl.updateMapping('item-1', { tcgplayerProductId: null } as never, user);
    expect(mapping.updateMapping).toHaveBeenCalledWith('item-1', {
      tcgplayerProductId: null,
      tcgplayerGroupId: undefined,
      applyToSiblings: undefined,
    });
    expect(res).toMatchObject({ tcgplayerProductId: null, tcgplayerGroupId: null });
  });
});
