import { CatalogService, publicPtcgoCode, toCardDTO } from '../src/modules/catalog/catalog.service';
import { MasterSetService } from '../src/modules/inventory/master-set.service';
import { BuylistService } from '../src/modules/buylist/buylist.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { UsersService } from '../src/modules/users/users.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { DEFAULT_PRICING_CURVE } from '../src/common/pricing-curve';
import { buildGradeKey, tryBuildGradeKey } from '../src/modules/pricing/pricing.types';
import { ConfigService } from '@nestjs/config';
import { ivaDialsStub } from './helpers/iva-dials';

/**
 * P-71 (API_CONTRACT v1.80, ARCHITECTURE §4.57) — EL CÓDIGO CORTO DEL SET («TWM»).
 *
 * `CardSet.ptcgoCode` ya se guarda; esta rev lo PROYECTA a seis DTOs con UNA normalización
 * (`publicPtcgoCode`: trim, vacío ⇒ `null`, mayúsculas intactas, jamás deducido). Pruebas P71-B1..B4,
 * B6 y B7 del contrato (B5 — búsqueda por código — es integración contra Postgres real:
 * `test/integration/set-ptcgo-code-search.e2e-spec.ts`).
 *
 * Los dobles de Prisma de este fichero RESPETAN `select`/`include`: una columna que no se selecciona
 * no llega (como en el motor). Así la mutación «quitar `ptcgoCode` del `select`» o «llamar a
 * `toCardDTO` sin `include:{set:true}`» se ve aquí, no solo en integración.
 */

/** Proyecta una fila como Prisma: con `select`, SOLO las claves seleccionadas. */
function project<T extends Record<string, unknown>>(row: T, args: any): Partial<T> {
  if (!args?.select) return row;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args.select)) if (v) out[k] = row[k];
  return out as Partial<T>;
}

const hasKey = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

// ─────────────────────────────── P71-B1 · toCardDTO ───────────────────────────────

function card(setOver: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    externalId: 'sv6-130',
    name: 'Dragapult ex',
    number: '130',
    numberSort: 130,
    numberPrefix: '',
    rarity: 'Double Rare',
    supertype: 'Pokémon',
    subtypes: [],
    setId: 's1',
    imageSmallUrl: null,
    imageLargeUrl: null,
    availableFinishes: ['normal'],
    set: { id: 's1', externalId: 'sv6', name: 'Twilight Masquerade', ptcgoCode: 'TWM', ...setOver },
  } as any;
}

describe('P71-B1 — publicPtcgoCode y CardDTO.setPtcgoCode', () => {
  it.each<[string, string | null | undefined, string | null]>([
    ['código normal', 'TWM', 'TWM'],
    ['null', null, null],
    ['undefined', undefined, null],
    ['cadena vacía', '', null],
    ['solo espacios', '   ', null],
    ['tab/salto', '\t\n', null],
    ['espacios al borde', ' TWM ', 'TWM'],
    ['minúsculas (NO se pasan a mayúsculas)', 'twm', 'twm'],
    ['mixto intacto', 'TwM', 'TwM'],
  ])('publicPtcgoCode(%s)', (_l, raw, expected) => {
    expect(publicPtcgoCode(raw)).toBe(expected);
  });

  it.each<[string, string | null, string | null]>([
    ['TWM', 'TWM', 'TWM'],
    ['null', null, null],
    ["''", '', null],
    ["'   '", '   ', null],
    ["' TWM '", ' TWM ', 'TWM'],
    ["'twm' (sin mayúsculas)", 'twm', 'twm'],
  ])('toCardDTO con set.ptcgoCode=%s', (_l, raw, expected) => {
    const dto = toCardDTO(card({ ptcgoCode: raw }));
    expect(dto.setPtcgoCode).toBe(expected);
  });

  it('clave SIEMPRE presente (hasOwn) aunque el valor sea null — y aunque el set no venga cargado', () => {
    const conNull = toCardDTO(card({ ptcgoCode: null }));
    expect(hasKey(conNull, 'setPtcgoCode')).toBe(true);
    expect(conNull.setPtcgoCode).toBeNull();

    // Emisor que no cargó el set: `setName` y `setPtcgoCode` salen `null` a la vez (misma relación).
    for (const sinSet of [{ ...card(), set: null }, { ...card(), set: undefined }]) {
      const dto = toCardDTO(sinSet);
      expect(hasKey(dto, 'setPtcgoCode')).toBe(true);
      expect(dto.setPtcgoCode).toBeNull();
      expect(dto.setName).toBeNull();
    }
  });

  it('jamás se DEDUCE del externalId ni del nombre (sv6 no es un código impreso)', () => {
    const dto = toCardDTO(card({ ptcgoCode: null, externalId: 'sv6', name: 'Twilight Masquerade' }));
    expect(dto.setPtcgoCode).toBeNull();
  });
});

// ─────────────────────── P71-B2 / B3 · índice y binder de master sets ───────────────────────

function masterSetPrisma(setRows: any[], binderSet?: any): PrismaService {
  return {
    cardSet: {
      findMany: jest.fn(async (args: any) => {
        let rows = setRows;
        const inIds = args?.where?.externalId?.in;
        if (inIds) rows = rows.filter((r) => inIds.includes(r.externalId));
        return rows.map((r) => project(r, args));
      }),
      findUnique: jest.fn(async () => binderSet ?? null),
    },
    card: {
      groupBy: jest.fn(async () => []),
      findMany: jest.fn(async () => [
        { id: 'c1', setId: 'p', number: '1', numberSort: 1, numberPrefix: '', name: 'A',
          rarity: 'Common', rarityCanonical: 'common', imageSmallUrl: null, availableFinishes: ['normal'] },
        { id: 'c2', setId: 'sub', number: '2', numberSort: 2, numberPrefix: '', name: 'B',
          rarity: 'Common', rarityCanonical: 'common', imageSmallUrl: null, availableFinishes: ['normal'] },
      ]),
    },
    inventoryItem: { groupBy: jest.fn(async () => []), findMany: jest.fn(async () => []) },
    user: { findUnique: jest.fn(async () => ({ id: 'u1', name: 'Ana', email: 'a@b.mx' })) },
    $queryRaw: jest.fn().mockResolvedValue([]),
  } as unknown as PrismaService;
}

function masterSetPricing(): PricingService {
  return {
    loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
    decideSalePrice: jest.fn(PricingService.prototype.decideSalePrice),
    getReferencesBatch: jest.fn(async () => new Map()),
    getSeparateProductsByCard: jest.fn(async () => new Map()),
    getPricedRawFinishesBatch: jest.fn(async () => new Map()),
    gradeKeyFor: jest.fn().mockReturnValue('raw_NM'),
    tryGradeKeyFor: jest.fn().mockReturnValue('raw_NM'),
    getVariantOverridesBatch: jest.fn(async () => new Map()),
    getVariantOverride: jest.fn(async () => null),
  } as unknown as PricingService;
}

const baseSetRow = { series: 'SV', releaseDate: '2024/05/24', printedTotal: 167, logoUrl: null, symbolUrl: null };

describe('P71-B2 — índice de master sets: MasterSetSummaryDTO.ptcgoCode', () => {
  it('cada fila trae la CLAVE; valor normalizado; `null` estricto con columna null O vacía', async () => {
    const prisma = masterSetPrisma([
      { ...baseSetRow, id: 's1', externalId: 'sv6', name: 'Twilight Masquerade', ptcgoCode: ' TWM ' },
      { ...baseSetRow, id: 's2', externalId: 'basep', name: 'Promos', ptcgoCode: null },
      { ...baseSetRow, id: 's3', externalId: 'x1', name: 'Vacío', ptcgoCode: '' },
      { ...baseSetRow, id: 's4', externalId: 'x2', name: 'Minúsculas', ptcgoCode: 'twm' },
    ]);
    const svc = new MasterSetService(prisma, masterSetPricing());
    const res = await svc.index({ page: 1, pageSize: 20, sort: 'release_desc' });
    const by = new Map(res.data.map((r) => [r.setId, r]));
    for (const r of res.data) expect(hasKey(r, 'ptcgoCode')).toBe(true);
    expect(by.get('s1')!.ptcgoCode).toBe('TWM');
    expect(by.get('s2')!.ptcgoCode).toBeNull();
    expect(by.get('s3')!.ptcgoCode).toBeNull();
    expect(by.get('s4')!.ptcgoCode).toBe('twm');
  });

  it('la query del índice SELECCIONA ptcgoCode de la MISMA fila (una sola query de sets)', async () => {
    const prisma = masterSetPrisma([{ ...baseSetRow, id: 's1', externalId: 'sv6', name: 'T', ptcgoCode: 'TWM' }]);
    const svc = new MasterSetService(prisma, masterSetPricing());
    await svc.index({ page: 1, pageSize: 20, sort: 'release_desc' });
    const calls = (prisma.cardSet.findMany as unknown as jest.Mock).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0][0].select.ptcgoCode).toBe(true);
  });

  it('combinado: la fila PLEGADA trae el código del PRINCIPAL aunque el subset tenga otro', async () => {
    const prisma = masterSetPrisma([
      { ...baseSetRow, id: 'p', externalId: 'cel25', name: 'Celebrations', ptcgoCode: 'CEL' },
      { ...baseSetRow, id: 'sub', externalId: 'cel25c', name: 'Celebrations: Classic Collection', ptcgoCode: 'CLC' },
    ]);
    const svc = new MasterSetService(prisma, masterSetPricing());
    const res = await svc.index({ page: 1, pageSize: 20, sort: 'release_desc' });
    expect(res.data.map((r) => r.setId)).toEqual(['p']);
    expect(res.data[0].ptcgoCode).toBe('CEL');
  });

  it('combinado con principal SIN código: la fila plegada es `null`, no hereda el del subset', async () => {
    const prisma = masterSetPrisma([
      { ...baseSetRow, id: 'p', externalId: 'cel25', name: 'Celebrations', ptcgoCode: null },
      { ...baseSetRow, id: 'sub', externalId: 'cel25c', name: 'Celebrations: Classic Collection', ptcgoCode: 'CLC' },
    ]);
    const svc = new MasterSetService(prisma, masterSetPricing());
    const res = await svc.index({ page: 1, pageSize: 20, sort: 'release_desc' });
    expect(res.data).toHaveLength(1);
    expect(hasKey(res.data[0], 'ptcgoCode')).toBe(true);
    expect(res.data[0].ptcgoCode).toBeNull();
  });

  it('`?q=` casa por nombre O por ptcgoCode (contains, insensitive) en la query de BD', async () => {
    const prisma = masterSetPrisma([]);
    const svc = new MasterSetService(prisma, masterSetPricing());
    await svc.index({ q: 'twm', page: 1, pageSize: 20, sort: 'release_desc' });
    const where = (prisma.cardSet.findMany as unknown as jest.Mock).mock.calls[0][0].where;
    expect(where).toEqual({
      OR: [
        { name: { contains: 'twm', mode: 'insensitive' } },
        { ptcgoCode: { contains: 'twm', mode: 'insensitive' } },
      ],
    });
  });

  it('sin `?q=` no hay filtro', async () => {
    const prisma = masterSetPrisma([]);
    const svc = new MasterSetService(prisma, masterSetPricing());
    await svc.index({ page: 1, pageSize: 20, sort: 'release_desc' });
    expect((prisma.cardSet.findMany as unknown as jest.Mock).mock.calls[0][0].where).toEqual({});
  });
});

describe('P71-B3 — binder: MasterSetRefDTO.ptcgoCode y SetPartDTO.ptcgoCode por parte', () => {
  it('set normal: `set.ptcgoCode` = el del set (normalizado); clave presente con null', async () => {
    const row = { ...baseSetRow, id: 'p', externalId: 'sv6', name: 'Twilight Masquerade', ptcgoCode: ' TWM ' };
    const svc = new MasterSetService(masterSetPrisma([row], row), masterSetPricing());
    const res = await svc.binder('p');
    expect(res.set.ptcgoCode).toBe('TWM');
    expect(res.parts).toBeUndefined();

    const rowNull = { ...row, ptcgoCode: '' };
    const res2 = await new MasterSetService(masterSetPrisma([rowNull], rowNull), masterSetPricing()).binder('p');
    expect(hasKey(res2.set, 'ptcgoCode')).toBe(true);
    expect(res2.set.ptcgoCode).toBeNull();
  });

  it('combinado CEL/CLC: `set` = el del principal; `parts[i].ptcgoCode` = el DE CADA PARTE', async () => {
    const primary = { ...baseSetRow, id: 'p', externalId: 'cel25', name: 'Celebrations', ptcgoCode: 'CEL' };
    const subset = { ...baseSetRow, id: 'sub', externalId: 'cel25c', name: 'Celebrations: Classic Collection', ptcgoCode: 'CLC' };
    // Pedido por el SUBSET: se normaliza al principal, y aun así cada parte conserva SU código.
    for (const requested of [primary, subset]) {
      const svc = new MasterSetService(masterSetPrisma([primary, subset], requested), masterSetPricing());
      const res = await svc.binder(requested.id);
      expect(res.set.id).toBe('p');
      expect(res.set.ptcgoCode).toBe('CEL');
      expect(res.parts!.map((p) => [p.setId, p.ptcgoCode])).toEqual([
        ['p', 'CEL'],
        ['sub', 'CLC'],
      ]);
    }
  });

  it('combinado con una parte sin código: esa parte es `null` (clave presente), la otra conserva el suyo', async () => {
    const primary = { ...baseSetRow, id: 'p', externalId: 'cel25', name: 'Celebrations', ptcgoCode: 'CEL' };
    const subset = { ...baseSetRow, id: 'sub', externalId: 'cel25c', name: 'Classic', ptcgoCode: '  ' };
    const svc = new MasterSetService(masterSetPrisma([primary, subset], primary), masterSetPricing());
    const res = await svc.binder('p');
    const sub = res.parts!.find((p) => p.setId === 'sub')!;
    expect(hasKey(sub, 'ptcgoCode')).toBe(true);
    expect(sub.ptcgoCode).toBeNull();
    expect(res.parts!.find((p) => p.setId === 'p')!.ptcgoCode).toBe('CEL');
  });
});

// ─────────────────────────── P71-B4 · /buylist/sets y /catalog/sets ───────────────────────────

describe('P71-B4 — GET /buylist/sets trae ptcgoCode; GET /catalog/sets NO', () => {
  const pricing = () => ({ getPricedRawFinishesBatch: jest.fn(async () => new Map()) }) as unknown as PricingService;

  it('clave presente en cada elemento; normalizada; `\'\'` ⇒ null', async () => {
    const rows = [
      { id: 'a', name: 'Twilight Masquerade', series: 'SV', releaseDate: '2024/05/24', logoUrl: null, ptcgoCode: 'TWM' },
      { id: 'b', name: 'Vacío', series: 'SV', releaseDate: '2024/01/01', logoUrl: null, ptcgoCode: '' },
      { id: 'c', name: 'Nulo', series: 'SV', releaseDate: '2023/01/01', logoUrl: null, ptcgoCode: null },
      { id: 'd', name: 'Espacios', series: 'SV', releaseDate: '2022/01/01', logoUrl: null, ptcgoCode: ' par ' },
    ];
    const prisma: any = { cardSet: { findMany: jest.fn(async (args: any) => rows.map((r) => project(r, args))) } };
    const svc = new CatalogService(prisma as PrismaService, pricing(), ivaDialsStub() as never);
    const res = await svc.listSetsWithImportedCards();
    for (const r of res.data) expect(hasKey(r, 'ptcgoCode')).toBe(true);
    const by = new Map(res.data.map((r) => [r.id, r.ptcgoCode]));
    expect(by.get('a')).toBe('TWM');
    expect(by.get('b')).toBeNull();
    expect(by.get('c')).toBeNull();
    expect(by.get('d')).toBe('par');
  });

  it('GET /catalog/sets (CardSetDTO) NO trae ptcgoCode aunque la fila del set lo tenga', async () => {
    const setRow = { id: 's1', externalId: 'sv6', name: 'Twilight Masquerade', series: 'SV',
      releaseDate: '2024/05/24', ptcgoCode: 'TWM', logoUrl: null };
    const item = {
      id: 'i1', cardId: 'c1', productType: 'raw', rawCondition: 'NM', sealedSubtype: null,
      gradingCompany: null, gradeValue: null, certNumber: null, status: 'listed', finish: 'normal',
      listPriceCents: 11500, createdAt: new Date('2026-08-01'),
      card: { ...card(), set: setRow },
    };
    const prisma: any = { inventoryItem: { findMany: jest.fn(async () => [item]) } };
    const svc = new CatalogService(prisma as PrismaService, storefrontPricing(), ivaDialsStub() as never);
    const res = await svc.listSets();
    expect(res.data.length).toBeGreaterThan(0);
    for (const s of res.data) expect(Object.keys(s)).not.toContain('ptcgoCode');
  });
});

// ─────────────────────────────── P71-B6 · /buylist/bounties ───────────────────────────────

const pii = new PiiCryptoService(new ConfigService({}));

function buylistSvc(prisma: any) {
  return new BuylistService(
    prisma as PrismaService,
    {
      gradeKeyFor: (i: any) => buildGradeKey(i),
      tryGradeKeyFor: (i: any) => tryBuildGradeKey(i),
      loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
      decideSalePrice: jest.fn(PricingService.prototype.decideSalePrice),
      getReferencesBatch: jest.fn(async () => new Map()),
    } as unknown as PricingService,
    { getNumber: jest.fn(async () => 100_000_000) } as unknown as SettingsService,
    {} as UsersService,
    pii,
  );
}

describe('P71-B6 — GET /buylist/bounties: PublicBountyDTO.setPtcgoCode', () => {
  const bounty = (cardId: string, ptcgoCode: string | null, price: number) => ({
    cardId,
    productType: 'raw',
    gradeKey: 'raw:NM',
    finish: 'holofoil',
    bountyEnabled: true,
    bountyPriceCents: price,
    bountyTargetQty: null,
    bountyAcquiredQty: 0,
    card: { name: 'X', number: '1', rarity: null, imageSmallUrl: null, set: { name: 'S', ptcgoCode } },
  });

  it('cada elemento trae la clave; `\'\'` ⇒ null; valor recortado sin mayúsculas', async () => {
    const prisma: any = {
      variantPriceOverride: {
        findMany: jest.fn(async () => [
          bounty('a', 'TWM', 400000),
          bounty('b', '', 300000),
          bounty('c', null, 200000),
          bounty('d', ' twm ', 100000),
        ]),
      },
    };
    const res = await buylistSvc(prisma).publicBounties();
    expect(res.data).toHaveLength(4);
    for (const r of res.data) expect(hasKey(r, 'setPtcgoCode')).toBe(true);
    expect(res.data.map((r) => r.setPtcgoCode)).toEqual(['TWM', null, null, 'twm']);
  });
});

// ───────────────────── P71-B7 · las superficies de §37.3 CARGAN el set ─────────────────────

function storefrontPricing(): PricingService {
  return {
    gradeKeyFor: jest.fn().mockReturnValue('raw:NM'),
    tryGradeKeyFor: jest.fn().mockReturnValue('raw:NM'),
    getReference: jest.fn(async () => ({ status: 'priced', referenceMxnCents: 10000 })),
    getPricedRawFinishesBatch: jest.fn(async () => new Map()),
    loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
    decideSalePrice: jest.fn(PricingService.prototype.decideSalePrice),
    computeSalePriceForItem: jest.fn(PricingService.prototype.computeSalePriceForItem),
    getReferencesBatch: jest.fn(async (items: any[]) => {
      const m = new Map<string, any>();
      for (const it of items) {
        m.set(`${it.cardId}|${it.productType}|${it.gradeKey}|${it.finish}`, {
          status: 'priced',
          referenceMxnCents: 10000,
        });
      }
      return m;
    }),
    loadSealedSpreads: jest.fn(async () => ({ spreadPctBySubtype: {}, fallbackPct: 25, sourceOn: false })),
    sealedMarketGradeKeyForItem: jest.fn(() => null),
    getSealedMarketRef: jest.fn(async () => ({ status: 'pending' })),
    gateSealedMarketCents: jest.fn(() => null),
    resolveSealedSalePrice: jest.fn(() => null),
    getVariantOverridesBatch: jest.fn(async () => new Map()),
    getVariantOverride: jest.fn(async () => null),
    loadGradedEstimateConfig: jest.fn(async () => ({
      enabled: false, grades: [], highlightGrades: [], freshnessDays: 30,
      minUpsidePct: 30, gradingCostTiers: [],
    })),
    getGradedEstimatesBatch: jest.fn(async () => new Map()),
  } as unknown as PricingService;
}

/** Fila `Card` como la rinde Prisma: el `set` SOLO viene si el emisor lo pidió con `include`. */
function cardRowFor(args: any) {
  const { set, ...bare } = card({ ptcgoCode: 'TWM' });
  return args?.include?.set ? { ...bare, set } : bare;
}

describe('P71-B7 — /buylist/cards?setId= y la ficha cargan el set ⇒ setPtcgoCode no es null', () => {
  it('GET /buylist/cards?setId= (searchAllCards) ⇒ setPtcgoCode: TWM', async () => {
    const prisma: any = {
      card: {
        findMany: jest.fn(async (args: any) => [cardRowFor(args)]),
        count: jest.fn(async () => 1),
      },
    };
    const svc = new CatalogService(prisma as PrismaService, storefrontPricing(), ivaDialsStub() as never);
    const res = await svc.searchAllCards({ setId: 's1', page: 1, pageSize: 20 });
    expect(res.data[0].setPtcgoCode).toBe('TWM');
  });

  it('ficha (GroupedListingDetailResponse.card) ⇒ setPtcgoCode: TWM', async () => {
    const prisma: any = {
      card: { findUnique: jest.fn(async (args: any) => cardRowFor(args)) },
      inventoryItem: { findMany: jest.fn(async () => []) },
    };
    const settings = { getNumber: jest.fn(async () => 16), ...ivaDialsStub() };
    const svc = new CatalogService(prisma as PrismaService, storefrontPricing(), settings as never);
    const res = await svc.getCard('c1');
    expect(res.card.setPtcgoCode).toBe('TWM');
  });
});
