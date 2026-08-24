import { ConfigService } from '@nestjs/config';
import { BuylistService } from '../src/modules/buylist/buylist.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { UsersService } from '../src/modules/users/users.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { DEFAULT_PRICING_CURVE } from '../src/common/pricing-curve';

/**
 * v1.6-finish · ⛔ SUPERSEDED por v2.0 (P-48, ARCHITECTURE §4.36) — el acabado **deja de seleccionar
 * regla de precio**: no hay `finishRules`, ni claves sintéticas «Holo»/«Reverse Holo», ni gate premium
 * de pricing. Lo que este spec verifica ahora es lo que el acabado SÍ sigue haciendo (§4.36.10):
 *
 *  1. **elegir DE QUÉ VARIANTE se lee el mercado** (`getReference(..., finish)`),
 *  2. seguir siendo **identidad de variante** (se valida contra `Card.availableFinishes`, SEC-A1, y se
 *     snapshotea en `SellRequestItem.finish`),
 *
 * y lo que ya NO hace: **cambiar el monto**. Con el MISMO mercado, dos acabados cotizan IDÉNTICO
 * (criterio 83), porque el monto sale solo de la curva sobre el valor de mercado (criterio 84).
 */

const pii = new PiiCryptoService(new ConfigService({}));

function svcWith(opts: {
  referenceMxnCents?: number | null;
  cardRarity?: string | null;
  availableFinishes?: string[];
}): { svc: BuylistService; pricing: PricingService } {
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
    // v2.0 (§4.36.2): UN solo lector de configuración de dinero para los dos ejes.
    loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
    getReference: jest.fn().mockResolvedValue(
      opts.referenceMxnCents == null
        ? { status: 'pending' }
        : { status: 'priced', referenceMxnCents: opts.referenceMxnCents },
    ),
    escalatePending: jest.fn(),
    getVariantOverridesBatch: jest.fn(async () => new Map()),
    getVariantOverride: jest.fn(async () => null),
  } as unknown as PricingService;
  const settings = { getRaw: jest.fn(), getNumber: jest.fn().mockResolvedValue(0) } as unknown as SettingsService;
  return {
    svc: new BuylistService(prisma as PrismaService, pricing, settings, {} as UsersService, pii),
    pricing,
  };
}

describe('BuylistService.publicQuote — el acabado elige la VARIANTE, no la regla (v2.0, §4.36.10)', () => {
  it('lee la referencia DEL ACABADO cotizado (es su único papel en el precio)', async () => {
    const { svc, pricing } = svcWith({ referenceMxnCents: 12500 });
    await svc.publicQuote('c1', 'raw', 'NM', 'reverse_holo');
    expect(pricing.getReference).toHaveBeenCalledWith('c1', 'raw', 'raw:NM', 'reverse_holo');
  });

  it('criterio 83: DOS acabados distintos con el MISMO mercado cotizan IDÉNTICO', async () => {
    const a = await svcWith({ referenceMxnCents: 12500 }).svc.publicQuote('c1', 'raw', 'NM', 'normal');
    const b = await svcWith({ referenceMxnCents: 12500 }).svc.publicQuote('c1', 'raw', 'NM', 'reverse_holo');
    const c = await svcWith({ referenceMxnCents: 12500 }).svc.publicQuote('c1', 'raw', 'NM', 'holofoil');
    // $125 ⇒ pct interpolado entre 40 % ($100) y 50 % ($500): 4000 + 1000×2500/40000 = 4062.5 ⇒ 4063 bp.
    // 12500 × 4063 / 10000 = 5078.75 ⇒ $50.79.
    expect(a.quote.quotedPriceCents).toBe(5079);
    expect(b.quote.quotedPriceCents).toBe(a.quote.quotedPriceCents);
    expect(c.quote.quotedPriceCents).toBe(a.quote.quotedPriceCents);
    expect(a.priceBasis).toBe('market');
  });

  it('criterio 84: la RAREZA no cambia el monto (una Common y una Illustration Rare cotizan igual)', async () => {
    const common = await svcWith({ cardRarity: 'Common', referenceMxnCents: 40000 }).svc.publicQuote(
      'c1',
      'raw',
      'NM',
      'normal',
    );
    const chase = await svcWith({ cardRarity: 'Illustration Rare', referenceMxnCents: 40000 }).svc.publicQuote(
      'c1',
      'raw',
      'NM',
      'normal',
    );
    // $400 ⇒ pct interpolado 47.5 % ⇒ $190. La Common de cientos de pesos deja de recibir $0.50 (criterio 80).
    expect(common.quote.quotedPriceCents).toBe(19000);
    expect(chase.quote.quotedPriceCents).toBe(19000);
  });

  it('el BIN gana en bulk: mercado $0.50 ⇒ $1.00 con priceBasis="floor"', async () => {
    const { svc } = svcWith({ referenceMxnCents: 50 });
    const q = await svc.publicQuote('c1', 'raw', 'NM', 'normal');
    expect(q.quote.quotedPriceCents).toBe(100);
    expect(q.priceBasis).toBe('floor');
  });

  it('SIN referencia del acabado ⇒ precio_pendiente (el BIN NO gana; jamás MX$0)', async () => {
    const { svc } = svcWith({ referenceMxnCents: null });
    const q = await svc.publicQuote('c1', 'raw', 'NM', 'holofoil');
    expect(q.quote.status).toBe('precio_pendiente');
    expect(q.quote.quotedPriceCents).toBeNull();
    expect(q.priceBasis).toBe('pending');
  });

  it('`rarity` sigue viajando como dato INFORMATIVO del catálogo', async () => {
    const { svc } = svcWith({ cardRarity: 'Illustration Rare', referenceMxnCents: 12500 });
    const q = await svc.publicQuote('c1', 'raw', 'NM', 'normal');
    expect(q.rarity).toBe('Illustration Rare');
  });

  it('acabado NO disponible en la carta → 422 FINISH_NOT_AVAILABLE (SEC-A1, sin cambio)', async () => {
    const { svc } = svcWith({ availableFinishes: ['normal'], referenceMxnCents: 10000 });
    await expect(svc.publicQuote('c1', 'raw', 'NM', 'reverse_holo')).rejects.toMatchObject({
      code: 'FINISH_NOT_AVAILABLE',
    });
  });

  it('sin finish explícito → default normal (sin cambio)', async () => {
    const { svc } = svcWith({ referenceMxnCents: null });
    const q = await svc.publicQuote('c1', 'raw', 'NM');
    expect(q.finish).toBe('normal');
  });
});

describe('BuylistService.createRequest — snapshot del acabado + del priceBasis (§4.36.7c)', () => {
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
            priceBasis: it.priceBasis,
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

  function pricingFor(referenceMxnCents: number | null): PricingService {
    return {
      gradeKeyFor: jest.fn().mockReturnValue('raw:NM'),
      loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
      getReference: jest.fn().mockResolvedValue(
        referenceMxnCents == null
          ? { status: 'pending' }
          : { status: 'priced', referenceMxnCents },
      ),
      escalatePending: jest.fn(),
      getVariantOverridesBatch: jest.fn(async () => new Map()),
      getVariantOverride: jest.fn(async () => null),
    } as unknown as PricingService;
  }

  function settingsFor(): SettingsService {
    return {
      getRaw: jest.fn(),
      getNumber: jest.fn(async (key: string) => {
        if (key === 'buylist_cap_per_request_cents') return 100_000_000;
        if (key === 'buylist_cap_per_month_cents') return 100_000_000;
        if (key === 'ine_threshold_cents') return 100_000_000;
        return 0;
      }),
    } as unknown as SettingsService;
  }

  it('snapshotea el finish y el priceBasis; el monto sale de la CURVA (no de una regla por acabado)', async () => {
    const prisma = prismaForCreate();
    const svc = new BuylistService(
      prisma as PrismaService,
      pricingFor(12500),
      settingsFor(),
      {} as UsersService,
      pii,
    );

    const res = await svc.createRequest(
      'user-1',
      [{ cardId: 'c1', productType: 'raw' as any, rawCondition: 'NM' as any, finish: 'reverse_holo' as any }],
      VALID_CLABE,
    );
    expect(res.items[0].finish).toBe('reverse_holo');
    expect(res.items[0].quotedPriceCents).toBe(5079); // $125 × 40.63 % (pct interpolado)
    expect(res.items[0].priceBasis).toBe('market');
    // El create persistió el finish y el basis; `ruleMode`/`ruleValue`/`ruleSource` quedan LEGACY.
    const created = prisma.sellRequest.create.mock.calls[0][0].data.items.create[0];
    expect(created.finish).toBe('reverse_holo');
    expect(created.priceBasis).toBe('market');
    expect(created.ruleMode).toBeUndefined();
    expect(created.ruleValue).toBeUndefined();
    expect(created.ruleSource).toBeUndefined();
  });

  it('rechaza un acabado fuera de availableFinishes con FINISH_NOT_AVAILABLE', async () => {
    const prisma = prismaForCreate();
    const svc = new BuylistService(
      prisma as PrismaService,
      pricingFor(null),
      settingsFor(),
      {} as UsersService,
      pii,
    );

    await expect(
      svc.createRequest(
        'user-1',
        [{ cardId: 'c1', productType: 'raw' as any, rawCondition: 'NM' as any, finish: 'holofoil' as any }],
        VALID_CLABE,
      ),
    ).rejects.toMatchObject({ code: 'FINISH_NOT_AVAILABLE' });
  });
});
