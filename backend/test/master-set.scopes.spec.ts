import { Role } from '@prisma/client';
import {
  MasterSetService,
  expectedFinishes,
} from '../src/modules/inventory/master-set.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { VaultController } from '../src/modules/vault/vault.controller';
import { AdminVaultsController } from '../src/modules/vault/admin-vaults.controller';
import { InventoryController } from '../src/modules/inventory/inventory.controller';
import { ROLES_KEY } from '../src/common/decorators/roles.decorator';

/**
 * v1.20-master-set-everywhere (§4.20a/b/d) — contrato ÚNICO por scope + completitud por VARIANTE:
 *  - variante = (carta, acabado); normal+reverse_holo = 2 casillas; universo = availableFinishes;
 *    histórico/vacío → ['normal']; DRIFT visible en countsByFinish pero fuera de expected/covered.
 *  - scope user_vault: agrega SOLO piezas del usuario (ownerType=customer, ownerUserId) y el índice
 *    solo lista sets con ≥1 pieza; owner con email SOLO en la vista admin (ii).
 *  - buyable SOLO vista (iii): pieza `listed` más barata por (cardId, finish); null si no hay.
 *  - permisos: /admin/vaults = vault_operator+; /vault/master-sets = usuario autenticado (el
 *    controller NUNCA acepta un userId del request).
 */

function buildPrisma(over: any = {}) {
  return {
    cardSet: { findMany: jest.fn(), findUnique: jest.fn() },
    card: { groupBy: jest.fn(), findMany: jest.fn() },
    inventoryItem: { groupBy: jest.fn(), findMany: jest.fn() },
    user: { findUnique: jest.fn() },
    $queryRaw: jest.fn().mockResolvedValue([]),
    ...over,
  } as unknown as PrismaService;
}

function buildPricing(over: any = {}) {
  return {
    loadSalesRules: jest.fn().mockResolvedValue({ rules: {}, fallbackPct: 15 }),
    getReferencesBatch: jest.fn().mockResolvedValue(new Map()),
    // v1.22-2 / N-15: displayFinishes se deriva de este lote (default vacío = sin supresión).
    getPricedRawFinishesBatch: jest.fn().mockResolvedValue(new Map()),
    gradeKeyFor: jest.fn().mockReturnValue('raw_NM'),
    ...over,
  } as unknown as PricingService;
}

function mockRawQueries(
  prisma: PrismaService,
  data: { variantRows?: any[]; inventoryRows?: any[] },
) {
  (prisma.$queryRaw as unknown as jest.Mock).mockImplementation((query: any) => {
    const s = query && typeof query.sql === 'string' ? query.sql : String(query);
    if (s.includes('FROM "InventoryItem"')) return Promise.resolve(data.inventoryRows ?? []);
    if (s.includes('FROM "Card"')) return Promise.resolve(data.variantRows ?? []);
    return Promise.resolve([]);
  });
}

const SET = {
  id: 's1',
  name: 'Surging Sparks',
  series: 'SV',
  releaseDate: '2024/11/08',
  printedTotal: 191,
};

describe('expectedFinishes — universo de variantes (v1.20 §4.20b)', () => {
  it('normal + reverse_holo = 2 casillas (una por acabado)', () => {
    expect(expectedFinishes(['normal', 'reverse_holo'])).toEqual(['normal', 'reverse_holo']);
  });

  it('availableFinishes vacío o null (histórico) → universo [normal]', () => {
    expect(expectedFinishes([])).toEqual(['normal']);
    expect(expectedFinishes(null)).toEqual(['normal']);
    expect(expectedFinishes(undefined)).toEqual(['normal']);
  });

  it('respeta el orden del enum Finish aunque el catálogo venga desordenado', () => {
    expect(expectedFinishes(['holofoil', 'normal'] as any)).toEqual(['normal', 'holofoil']);
  });
});

describe('binder — variants[] por celda: cobertura, drift y contadores (§4.20b)', () => {
  function setupBinder(groupByRows: any[], cards?: any[]) {
    const prisma = buildPrisma();
    (prisma.cardSet.findUnique as jest.Mock).mockResolvedValue(SET);
    (prisma.card.findMany as jest.Mock).mockResolvedValue(
      cards ?? [
        // c1 existe en normal + reverse_holo → 2 casillas esperadas.
        { id: 'c1', number: '1', name: 'A', rarity: 'Common', imageSmallUrl: null, availableFinishes: ['normal', 'reverse_holo'] },
        // c2 histórica sin availableFinishes → universo ['normal'].
        { id: 'c2', number: '2', name: 'B', rarity: 'Common', imageSmallUrl: null, availableFinishes: [] },
      ],
    );
    (prisma.inventoryItem.groupBy as jest.Mock).mockResolvedValue(groupByRows);
    return { prisma, svc: new MasterSetService(prisma, buildPricing()) };
  }

  it('normal+reverse = 2 casillas; covered por acabado; expected/covered cuentan variantes', async () => {
    const { svc } = await Promise.resolve(
      setupBinder([{ cardId: 'c1', finish: 'normal', _count: { _all: 2 } }]),
    );
    const res = await svc.binder('s1');
    const c1 = res.cells.find((c) => c.cardId === 'c1')!;
    expect(c1.expectedVariantCount).toBe(2);
    expect(c1.coveredVariantCount).toBe(1);
    // v1.22-2 / N-15: Common no es premium → displayFinishes = availableFinishes → todo displayed.
    // v1.27 (P-15): la variante lleva su marketReferenceMxnCents (null honesto sin referencia).
    expect(c1.variants).toEqual([
      { finish: 'normal', count: 2, covered: true, displayed: true, marketReferenceMxnCents: null },
      { finish: 'reverse_holo', count: 0, covered: false, displayed: true, marketReferenceMxnCents: null },
    ]);
  });

  it('availableFinishes vacío → 1 casilla normal (histórico)', async () => {
    const { svc } = setupBinder([{ cardId: 'c2', finish: 'normal', _count: { _all: 1 } }]);
    const res = await svc.binder('s1');
    const c2 = res.cells.find((c) => c.cardId === 'c2')!;
    expect(c2.expectedVariantCount).toBe(1);
    expect(c2.coveredVariantCount).toBe(1);
    expect(c2.variants).toEqual([
      { finish: 'normal', count: 1, covered: true, displayed: true, marketReferenceMxnCents: null },
    ]);
  });

  it('DRIFT: pieza con finish FUERA del universo se ve en countsByFinish pero NO en variants (nunca covered > expected)', async () => {
    // c2 (universo [normal]) tiene una pieza holofoil capturada (drift de catálogo).
    const { svc } = setupBinder([
      { cardId: 'c2', finish: 'holofoil', _count: { _all: 1 } },
    ]);
    const res = await svc.binder('s1');
    const c2 = res.cells.find((c) => c.cardId === 'c2')!;
    // Visible como pieza real…
    expect(c2.countsByFinish).toEqual([{ finish: 'holofoil', count: 1 }]);
    expect(c2.totalCount).toBe(1);
    // …pero fuera del universo: la casilla normal sigue descubierta y holofoil NO es casilla.
    expect(c2.expectedVariantCount).toBe(1);
    expect(c2.coveredVariantCount).toBe(0);
    expect(c2.variants).toEqual([
      { finish: 'normal', count: 0, covered: false, displayed: true, marketReferenceMxnCents: null },
    ]);
    expect(c2.coveredVariantCount).toBeLessThanOrEqual(c2.expectedVariantCount);
  });
});

describe('scope user_vault — filtro de agregación + owner por vista (§4.20a)', () => {
  const USER = { id: 'u1', name: 'Ana', email: 'ana@example.com' };

  it('binder user_vault agrega con ownerType=customer + ownerUserId (nunca plataforma)', async () => {
    const prisma = buildPrisma();
    (prisma.cardSet.findUnique as jest.Mock).mockResolvedValue(SET);
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(USER);
    (prisma.card.findMany as jest.Mock).mockResolvedValue([
      { id: 'c1', number: '1', name: 'A', rarity: 'Common', imageSmallUrl: null, availableFinishes: ['normal'] },
    ]);
    (prisma.inventoryItem.groupBy as jest.Mock).mockResolvedValue([]);
    const svc = new MasterSetService(prisma, buildPricing());
    await svc.binder('s1', { kind: 'user_vault', userId: 'u1' });

    const where = (prisma.inventoryItem.groupBy as jest.Mock).mock.calls[0][0].where;
    expect(where.ownerType).toBe('customer');
    expect(where.ownerUserId).toBe('u1');
    // mismo filtro de status "en bóveda" (ambas titularidades pending|settled: no filtra ownership).
    expect(where.status).toEqual({
      notIn: ['withdrawn', 'shipped', 'delivered', 'lost', 'damaged'],
    });
    expect(where.ownershipStatus).toBeUndefined();
  });

  it('owner: vista admin (ii) CON email; vista cliente (iii) SIN email; platform sin owner', async () => {
    const prisma = buildPrisma();
    (prisma.cardSet.findUnique as jest.Mock).mockResolvedValue(SET);
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(USER);
    (prisma.card.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.inventoryItem.groupBy as jest.Mock).mockResolvedValue([]);
    const svc = new MasterSetService(prisma, buildPricing());

    const admin = await svc.binder('s1', { kind: 'user_vault', userId: 'u1' }, { includeOwnerEmail: true });
    expect(admin.scope).toBe('user_vault');
    expect(admin.owner).toEqual({ userId: 'u1', name: 'Ana', email: 'ana@example.com' });

    const mine = await svc.binder('s1', { kind: 'user_vault', userId: 'u1' });
    expect(mine.owner).toEqual({ userId: 'u1', name: 'Ana' });
    expect(mine.owner!.email).toBeUndefined();

    const platform = await svc.binder('s1');
    expect(platform.scope).toBe('platform');
    expect(platform.owner).toBeUndefined();
  });

  it('404 NOT_FOUND si el usuario del scope no existe (vista admin)', async () => {
    const prisma = buildPrisma();
    (prisma.cardSet.findUnique as jest.Mock).mockResolvedValue(SET);
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
    const svc = new MasterSetService(prisma, buildPricing());
    await expect(
      svc.binder('s1', { kind: 'user_vault', userId: 'nope' }, { includeOwnerEmail: true }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('índice user_vault: SOLO sets con ≥1 pieza del usuario (los vacíos no se listan)', async () => {
    const prisma = buildPrisma();
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(USER);
    (prisma.cardSet.findMany as jest.Mock).mockResolvedValue([
      { id: 's1', name: 'Surging Sparks', releaseDate: '2024/11/08', printedTotal: 191 },
      { id: 's2', name: 'Base', releaseDate: '1999/01/09', printedTotal: 102 },
    ]);
    (prisma.card.groupBy as jest.Mock).mockResolvedValue([
      { setId: 's1', _count: { _all: 200 } },
      { setId: 's2', _count: { _all: 102 } },
    ]);
    mockRawQueries(prisma, {
      variantRows: [
        { setId: 's1', variantCount: 250n },
        { setId: 's2', variantCount: 102n },
      ],
      // El usuario solo tiene piezas en s1.
      inventoryRows: [{ setId: 's1', pieces: 2n, distinctCards: 2n, distinctVariants: 2n }],
    });
    const svc = new MasterSetService(prisma, buildPricing());
    const res = await svc.index(
      { page: 1, pageSize: 20, sort: 'release_desc' },
      { kind: 'user_vault', userId: 'u1' },
    );
    expect(res.scope).toBe('user_vault');
    expect(res.owner).toEqual({ userId: 'u1', name: 'Ana' });
    expect(res.data.map((r) => r.setId)).toEqual(['s1']); // s2 (vacío) fuera
    expect(res.total).toBe(1);
    // La agregación raw usa el filtro del scope (ownerUserId parametrizado).
    const invCall = ((prisma as any).$queryRaw as jest.Mock).mock.calls.find((c) =>
      String(c[0]?.sql ?? '').includes('FROM "InventoryItem"'),
    );
    expect(String(invCall[0].sql)).toContain('"ownerUserId"');
    expect(invCall[0].values).toContain('u1');
  });
});

describe('buyable — SOLO vista (iii); pieza listed más barata o null (§4.20d)', () => {
  function setupCustomerBinder(listedItems: any[], pricingOver: any = {}) {
    const prisma = buildPrisma();
    (prisma.cardSet.findUnique as jest.Mock).mockResolvedValue(SET);
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u1', name: 'Ana', email: 'a@x.mx' });
    (prisma.card.findMany as jest.Mock).mockResolvedValue([
      { id: 'c1', number: '1', name: 'A', rarity: 'Common', imageSmallUrl: null, availableFinishes: ['normal', 'reverse_holo'] },
    ]);
    // El usuario cubre normal; le falta reverse_holo.
    (prisma.inventoryItem.groupBy as jest.Mock).mockResolvedValue([
      { cardId: 'c1', finish: 'normal', _count: { _all: 1 } },
    ]);
    (prisma.inventoryItem.findMany as jest.Mock).mockResolvedValue(listedItems);
    const pricing = buildPricing(pricingOver);
    return { prisma, pricing, svc: new MasterSetService(prisma, pricing) };
  }

  it('elige la pieza listed MÁS BARATA del (cardId, finish) faltante; cubiertas sin buyable', async () => {
    const { prisma, svc } = setupCustomerBinder([
      { id: 'i-cara', cardId: 'c1', finish: 'reverse_holo', productType: 'raw', listPriceCents: 9000, card: { rarity: 'Common' } },
      { id: 'i-barata', cardId: 'c1', finish: 'reverse_holo', productType: 'raw', listPriceCents: 5000, card: { rarity: 'Common' } },
    ]);
    const res = await svc.binder('s1', { kind: 'user_vault', userId: 'u1' }, { includeBuyable: true });
    const c1 = res.cells[0];
    const missing = c1.variants.find((v) => v.finish === 'reverse_holo')!;
    expect(missing.buyable).toEqual({ inventoryItemId: 'i-barata', salePriceCents: 5000 });
    // La variante CUBIERTA no lleva buyable (solo faltantes, §DTOs).
    const covered = c1.variants.find((v) => v.finish === 'normal')!;
    expect('buyable' in covered).toBe(false);
    // La búsqueda de comprables es SOLO inventario de plataforma publicado.
    const where = (prisma.inventoryItem.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where.ownerType).toBe('platform');
    expect(where.status).toBe('listed');
  });

  it('buyable: null si no hay nada publicado de esa variante', async () => {
    const { svc } = setupCustomerBinder([]);
    const res = await svc.binder('s1', { kind: 'user_vault', userId: 'u1' }, { includeBuyable: true });
    const missing = res.cells[0].variants.find((v) => v.finish === 'reverse_holo')!;
    expect(missing.buyable).toBeNull();
  });

  it('precio derivado (sin override) usa reglas de venta + referencia del acabado; sin precio resoluble → null', async () => {
    const refs = new Map([
      ['c1|raw|raw_NM|reverse_holo', { status: 'priced', referenceMxnCents: 10000 }],
    ]);
    const { svc } = setupCustomerBinder(
      [
        // Derivada: Common pct 15% arriba de mercado → 11500.
        { id: 'i-derivada', cardId: 'c1', finish: 'reverse_holo', productType: 'raw', listPriceCents: null, card: { rarity: 'Common' } },
      ],
      { getReferencesBatch: jest.fn().mockResolvedValue(refs) },
    );
    const res = await svc.binder('s1', { kind: 'user_vault', userId: 'u1' }, { includeBuyable: true });
    const missing = res.cells[0].variants.find((v) => v.finish === 'reverse_holo')!;
    expect(missing.buyable).toEqual({ inventoryItemId: 'i-derivada', salePriceCents: 11500 });
  });

  it('vista admin (ii) y platform (i): buyable OMITIDO aunque haya faltantes', async () => {
    const { svc } = setupCustomerBinder([
      { id: 'i1', cardId: 'c1', finish: 'reverse_holo', productType: 'raw', listPriceCents: 5000, card: { rarity: 'Common' } },
    ]);
    const admin = await svc.binder('s1', { kind: 'user_vault', userId: 'u1' }, { includeOwnerEmail: true });
    for (const v of admin.cells[0].variants) expect('buyable' in v).toBe(false);
    const platform = await svc.binder('s1');
    for (const v of platform.cells[0].variants) expect('buyable' in v).toBe(false);
  });
});

describe('permisos de los endpoints nuevos (metadata @Roles, §4.20a)', () => {
  it('/admin/vaults (índice + binder de cliente) exige vault_operator+ (un customer recibe 403 del RolesGuard)', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, AdminVaultsController);
    expect(roles).toEqual([Role.vault_operator, Role.super_admin]);
    expect(roles).not.toContain(Role.customer);
  });

  it('/admin/inventory/adjustments hereda vault_operator+ del InventoryController', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, InventoryController);
    expect(roles).toEqual([Role.vault_operator, Role.super_admin]);
  });

  it('/vault/master-sets: el controller SIEMPRE agrega sobre el userId AUTENTICADO (no acepta userId del request)', async () => {
    const masterSets = { index: jest.fn().mockResolvedValue({}), binder: jest.fn().mockResolvedValue({}) };
    const ctrl = new VaultController({} as any, masterSets as any);

    await ctrl.myMasterSets('yo-autenticado');
    expect(masterSets.index).toHaveBeenCalledWith(
      expect.any(Object),
      { kind: 'user_vault', userId: 'yo-autenticado' },
      {}, // vista (iii): SIN email de owner
    );

    await ctrl.myMasterSetBinder('yo-autenticado', 's1');
    expect(masterSets.binder).toHaveBeenCalledWith(
      's1',
      { kind: 'user_vault', userId: 'yo-autenticado' },
      { includeBuyable: true }, // buyable SOLO aquí
    );
    // Un customer NO puede ver bóvedas ajenas por estas rutas: no existe parámetro de userId.
    expect(ctrl.myMasterSetBinder.length).toBe(2); // (userIdDeSesión, setId) — nada más
  });

  it('vista admin (ii): index/binder con includeOwnerEmail y SIN buyable', async () => {
    const masterSets = { index: jest.fn().mockResolvedValue({}), binder: jest.fn().mockResolvedValue({}) };
    const ctrl = new AdminVaultsController({} as any, masterSets as any);

    await ctrl.masterSetIndex('u9');
    expect(masterSets.index).toHaveBeenCalledWith(
      expect.any(Object),
      { kind: 'user_vault', userId: 'u9' },
      { includeOwnerEmail: true },
    );

    await ctrl.masterSetBinder('u9', 's1');
    expect(masterSets.binder).toHaveBeenCalledWith(
      's1',
      { kind: 'user_vault', userId: 'u9' },
      { includeOwnerEmail: true },
    );
    const opts = (masterSets.binder as jest.Mock).mock.calls[0][2];
    expect(opts.includeBuyable).toBeUndefined();
  });
});
