import { ConfigService } from '@nestjs/config';
import { BuylistService } from '../src/modules/buylist/buylist.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { UsersService } from '../src/modules/users/users.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import {
  isHoloRarity,
  ruleKeyCandidates,
  quoteAcquisitionForFinish,
  BuylistRule,
} from '../src/common/money';

/**
 * v1.6-finish — cotización POR ACABADO (ARCHITECTURE §4.2.1) + validación SEC-A1 del acabado
 * contra Card.availableFinishes (422 FINISH_NOT_AVAILABLE). El acabado determina qué regla de
 * BUYLIST_PRICE_RULES aplica y qué referencia usa el `pct` (la del acabado cotizado).
 */

const pii = new PiiCryptoService(new ConfigService({}));

const SEED: Record<string, BuylistRule> = {
  Common: { mode: 'fixed', value: 50 },
  Uncommon: { mode: 'fixed', value: 50 },
  'Reverse Holo': { mode: 'fixed', value: 150 },
};

function svcWith(opts: {
  rules?: Record<string, BuylistRule>;
  fallbackPct?: number;
  referenceMxnCents?: number | null;
  cardRarity?: string | null;
  availableFinishes?: string[];
}): BuylistService {
  const prisma: any = {
    card: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'c1',
        rarity: opts.cardRarity ?? 'Common',
        availableFinishes: opts.availableFinishes ?? ['normal', 'reverse_holo', 'holofoil'],
      }),
    },
  };
  const pricing = {
    gradeKeyFor: jest.fn().mockReturnValue('raw:NM'),
    getReference: jest.fn().mockResolvedValue(
      opts.referenceMxnCents == null
        ? { status: 'pending' }
        : { status: 'priced', referenceMxnCents: opts.referenceMxnCents },
    ),
    escalatePending: jest.fn(),
  } as unknown as PricingService;
  const settings = {
    getRaw: jest.fn().mockResolvedValue(opts.rules ?? SEED),
    getNumber: jest.fn().mockResolvedValue(opts.fallbackPct ?? 40),
  } as unknown as SettingsService;
  return new BuylistService(prisma as PrismaService, pricing, settings, {} as UsersService, pii);
}

describe('resolver finish→regla (§4.2.1, funciones puras)', () => {
  it('isHoloRarity: contiene "holo" case-insensitive', () => {
    expect(isHoloRarity('Rare Holo')).toBe(true);
    expect(isHoloRarity('Rare Holo EX')).toBe(true);
    expect(isHoloRarity('Common')).toBe(false);
    expect(isHoloRarity('Ultra Rare')).toBe(false);
    expect(isHoloRarity(null)).toBe(false);
  });

  it('reverse_holo → ["Reverse Holo"] siempre', () => {
    expect(ruleKeyCandidates('Common', 'reverse_holo')).toEqual(['Reverse Holo']);
    expect(ruleKeyCandidates('Rare Holo', 'reverse_holo')).toEqual(['Reverse Holo']);
  });

  it('holofoil: rareza no-holo → ["Holo"]; rareza holo → [rarity, "Holo"]', () => {
    expect(ruleKeyCandidates('Common', 'holofoil')).toEqual(['Holo']);
    expect(ruleKeyCandidates('Rare Holo', 'holofoil')).toEqual(['Rare Holo', 'Holo']);
  });

  it('first_edition_holofoil usa la misma cadena que holofoil', () => {
    expect(ruleKeyCandidates('Common', 'first_edition_holofoil')).toEqual(['Holo']);
    expect(ruleKeyCandidates('Rare Holo', 'first_edition_holofoil')).toEqual(['Rare Holo', 'Holo']);
  });

  it('normal → [rarity]', () => {
    expect(ruleKeyCandidates('Illustration Rare', 'normal')).toEqual(['Illustration Rare']);
    expect(ruleKeyCandidates(null, 'normal')).toEqual([]);
  });

  it('Common en holofoil NO usa la regla Common (salta a Holo→fallback %)', () => {
    const q = quoteAcquisitionForFinish('Common', 'holofoil', 20000, SEED, 40);
    expect(q.appliedRule).toEqual({ mode: 'pct', value: 40 });
    expect(q.ruleSource).toBe('fallback');
    expect(q.quotedPriceCents).toBe(8000); // 40% del market holofoil (20000)
  });
});

describe('BuylistService.publicQuote — por acabado (§4.2.1)', () => {
  it('Common en reverse_holo aplica la regla "Reverse Holo" ($1.50), NO la Common ($0.50)', async () => {
    const svc = svcWith({ cardRarity: 'Common', referenceMxnCents: 999999 });
    const q = await svc.publicQuote('c1', 'raw', 'NM', 'reverse_holo');
    expect(q.finish).toBe('reverse_holo');
    expect(q.appliedRule).toEqual({ mode: 'fixed', value: 150, source: 'rule' });
    expect(q.quote.quotedPriceCents).toBe(150);
  });

  it('Common en normal aplica la regla Common ($0.50)', async () => {
    const svc = svcWith({ cardRarity: 'Common', referenceMxnCents: null });
    const q = await svc.publicQuote('c1', 'raw', 'NM', 'normal');
    expect(q.appliedRule).toEqual({ mode: 'fixed', value: 50, source: 'rule' });
    expect(q.quote.quotedPriceCents).toBe(50);
  });

  it('pct usa la referencia del ACABADO cotizado (Common holofoil → 40% del market holofoil)', async () => {
    const svc = svcWith({ cardRarity: 'Common', referenceMxnCents: 12500 });
    const q = await svc.publicQuote('c1', 'raw', 'NM', 'holofoil');
    expect(q.appliedRule).toEqual({ mode: 'pct', value: 40, source: 'fallback' });
    expect(q.quote.status).toBe('cotizada');
    expect(q.quote.quotedPriceCents).toBe(5000); // 40% de 12500
  });

  it('acabado pct sin referencia del acabado → precio_pendiente', async () => {
    const svc = svcWith({ cardRarity: 'Common', referenceMxnCents: null });
    const q = await svc.publicQuote('c1', 'raw', 'NM', 'holofoil');
    expect(q.quote.status).toBe('precio_pendiente');
    expect(q.quote.quotedPriceCents).toBeNull();
  });

  it('acabado NO disponible en la carta → 422 FINISH_NOT_AVAILABLE (SEC-A1)', async () => {
    const svc = svcWith({ availableFinishes: ['normal'], referenceMxnCents: 10000 });
    await expect(svc.publicQuote('c1', 'raw', 'NM', 'reverse_holo')).rejects.toMatchObject({
      code: 'FINISH_NOT_AVAILABLE',
    });
  });

  it('sin finish explícito → default normal', async () => {
    const svc = svcWith({ cardRarity: 'Common', referenceMxnCents: null });
    const q = await svc.publicQuote('c1', 'raw', 'NM');
    expect(q.finish).toBe('normal');
  });
});

describe('BuylistService.createRequest — snapshot del acabado + rechazo', () => {
  const VALID_CLABE = '012345678901234567';

  function prismaForCreate() {
    const prisma: any = {
      card: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'c1',
          rarity: 'Common',
          availableFinishes: ['normal', 'reverse_holo'],
        }),
      },
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
            finish: it.finish,
            rarity: it.rarity,
            ruleMode: it.ruleMode,
            ruleValue: it.ruleValue,
            ruleSource: it.ruleSource,
            quotedPriceCents: it.quotedPriceCents,
            approvedPriceCents: null,
            itemStatus: it.itemStatus,
            inventoryItemId: null,
          })),
        })),
      },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    return prisma;
  }

  it('snapshotea el finish y aplica la regla del acabado (reverse_holo → $1.50)', async () => {
    const prisma = prismaForCreate();
    const pricing = {
      gradeKeyFor: jest.fn().mockReturnValue('raw:NM'),
      getReference: jest.fn().mockResolvedValue({ status: 'pending' }),
      escalatePending: jest.fn(),
    } as unknown as PricingService;
    const settings = {
      getRaw: jest.fn().mockResolvedValue(SEED),
      getNumber: jest.fn(async (key: string) => {
        if (key === 'buylist_cap_per_request_cents') return 100_000_000;
        if (key === 'buylist_cap_per_month_cents') return 100_000_000;
        if (key === 'ine_threshold_cents') return 100_000_000;
        if (key === 'buylist_price_fallback_pct') return 40;
        return 0;
      }),
    } as unknown as SettingsService;
    const svc = new BuylistService(prisma as PrismaService, pricing, settings, {} as UsersService, pii);

    const res = await svc.createRequest(
      'user-1',
      [{ cardId: 'c1', productType: 'raw' as any, rawCondition: 'NM' as any, finish: 'reverse_holo' as any }],
      VALID_CLABE,
    );
    expect(res.items[0].finish).toBe('reverse_holo');
    expect(res.items[0].appliedRule).toEqual({ mode: 'fixed', value: 150, source: 'rule' });
    expect(res.items[0].quotedPriceCents).toBe(150);
    // El create persistió el finish snapshoteado.
    const created = prisma.sellRequest.create.mock.calls[0][0].data.items.create[0];
    expect(created.finish).toBe('reverse_holo');
  });

  it('rechaza un acabado fuera de availableFinishes con FINISH_NOT_AVAILABLE', async () => {
    const prisma = prismaForCreate();
    const pricing = {
      gradeKeyFor: jest.fn().mockReturnValue('raw:NM'),
      getReference: jest.fn().mockResolvedValue({ status: 'pending' }),
      escalatePending: jest.fn(),
    } as unknown as PricingService;
    const settings = {
      getRaw: jest.fn().mockResolvedValue(SEED),
      getNumber: jest.fn().mockResolvedValue(40),
    } as unknown as SettingsService;
    const svc = new BuylistService(prisma as PrismaService, pricing, settings, {} as UsersService, pii);

    await expect(
      svc.createRequest(
        'user-1',
        [{ cardId: 'c1', productType: 'raw' as any, finish: 'holofoil' as any }],
        VALID_CLABE,
      ),
    ).rejects.toMatchObject({ code: 'FINISH_NOT_AVAILABLE' });
    expect(prisma.sellRequest.create).not.toHaveBeenCalled();
  });
});

describe('BuylistService.convertToInventory — propaga el finish al InventoryItem', () => {
  it('la copia física hereda el acabado snapshoteado del SellRequestItem', async () => {
    let createdData: any;
    const prisma: any = {
      sellRequestItem: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'sri-1',
          cardId: 'c1',
          productType: 'raw',
          rawCondition: 'NM',
          finish: 'reverse_holo',
          approvedPriceCents: 5000,
          quotedPriceCents: 5000,
          inventoryItemId: null,
          itemStatus: 'aprobada',
          card: {},
        }),
        update: jest.fn(),
      },
      nextFolio: jest.fn(async () => 'INV-000001'),
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
      inventoryItem: {
        create: jest.fn(async ({ data }: any) => {
          createdData = data;
          return { id: 'inv-1', folio: data.folio };
        }),
      },
      inventoryMovement: { create: jest.fn() },
    };
    const svc = new BuylistService(
      prisma as PrismaService,
      {} as PricingService,
      {} as SettingsService,
      {} as UsersService,
      pii,
    );
    const res = await svc.convertToInventory('sri-1', 'actor');
    expect(res).toEqual({ inventoryItemId: 'inv-1', folio: 'INV-000001' });
    expect(createdData.finish).toBe('reverse_holo');
  });
});
