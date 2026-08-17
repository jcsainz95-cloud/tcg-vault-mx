import { ConfigService } from '@nestjs/config';
import { BuylistService } from '../src/modules/buylist/buylist.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { UsersService } from '../src/modules/users/users.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';

const pii = new PiiCryptoService(new ConfigService({}));
const VALID_CLABE = '012345678901234567'; // 18 dígitos

/**
 * Fase 0.3 (compliance) — cierre del bypass del umbral INE / topes AML vía "precio pendiente".
 * Un ítem `precio_pendiente` suma 0 a `quotedTotalCents`; sin control, una carta cara sin referencia
 * evadía la exigencia de INE. DECISIÓN CONSERVADORA: si hay ≥1 línea `precio_pendiente`, se EXIGE INE.
 */

function buildPricing(referenceMxnCents: number | null): PricingService {
  return {
    gradeKeyFor: jest.fn().mockReturnValue('raw:NM'),
    getReference: jest.fn().mockResolvedValue(
      referenceMxnCents == null ? { status: 'pending' } : { status: 'priced', referenceMxnCents },
    ),
    escalatePending: jest.fn().mockResolvedValue(undefined),
  } as unknown as PricingService;
}

// Umbral INE ALTO (100M) para AISLAR el efecto de la línea pendiente: la exigencia de INE en estos
// tests proviene EXCLUSIVAMENTE de la presencia de una línea `precio_pendiente`, no del monto.
function buildSettings(): SettingsService {
  return {
    getRaw: jest.fn(async () => ({})), // sin reglas explícitas → fallback pct
    getNumber: jest.fn(async (key: string) => {
      if (key === 'buylist_cap_per_month_cents') return 100_000_000;
      if (key === 'buylist_cap_per_request_cents') return 100_000_000;
      if (key === 'ine_threshold_cents') return 100_000_000;
      if (key === 'buylist_price_fallback_pct') return 40;
      return 0;
    }),
  } as unknown as SettingsService;
}

function buildPrisma(rarity: string | null) {
  const prisma: any = {
    card: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'c1',
        rarity,
        availableFinishes: ['normal', 'holofoil'],
      }),
    },
    kycProfile: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
    sellRequest: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { quotedTotalCents: 0 } }),
      create: jest.fn(async ({ data }: any) => ({
        id: 'sr-1',
        status: data.status,
        quotedTotalCents: data.quotedTotalCents,
        ineRequired: data.ineRequired,
        items: (data.items.create as any[]).map((it, i) => ({
          id: `it-${i}`,
          cardId: it.cardId,
          card: { id: it.cardId, name: 'X', number: '1' },
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

describe('BuylistService.createRequest — Fase 0.3: INE exigida ante línea pendiente', () => {
  it('línea precio_pendiente SIN INE → 422 INE_REQUIRED (aunque el total cotizado sea $0 y bajo el umbral)', async () => {
    // Illustration Rare (premium) SIN referencia → fallback pct, referencia null → precio_pendiente.
    const prisma = buildPrisma('Illustration Rare');
    const svc = new BuylistService(
      prisma as PrismaService,
      buildPricing(null),
      buildSettings(),
      {} as UsersService,
      pii,
    );

    await expect(
      svc.createRequest(
        'user-1',
        [{ cardId: 'c1', productType: 'raw' as any, rawCondition: 'NM' as any, finish: 'holofoil' as any }],
        VALID_CLABE,
        // sin ineUploadKeys
      ),
    ).rejects.toMatchObject({ code: 'INE_REQUIRED' });
  });

  it('línea precio_pendiente CON INE → pasa y marca ineRequired=true', async () => {
    const prisma = buildPrisma('Illustration Rare');
    const svc = new BuylistService(
      prisma as PrismaService,
      buildPricing(null),
      buildSettings(),
      {} as UsersService,
      pii,
    );

    const res = await svc.createRequest(
      'user-1',
      [{ cardId: 'c1', productType: 'raw' as any, rawCondition: 'NM' as any, finish: 'holofoil' as any }],
      VALID_CLABE,
      { front: 'ine-front-key', back: 'ine-back-key' },
    );
    expect(res.ineRequired).toBe(true);
    expect(res.items[0].itemStatus).toBe('precio_pendiente');
  });

  it('sin líneas pendientes y bajo el umbral → NO exige INE (control sin cambios)', async () => {
    // Common (bulk fijo $0.50) CON o SIN referencia siempre cotiza → nunca pendiente.
    const prisma = buildPrisma('Common');
    const settings = {
      getRaw: jest.fn(async () => ({ Common: { mode: 'fixed', value: 50 } })),
      getNumber: jest.fn(async (key: string) => {
        if (key === 'buylist_cap_per_month_cents') return 100_000_000;
        if (key === 'buylist_cap_per_request_cents') return 100_000_000;
        if (key === 'ine_threshold_cents') return 100_000_000;
        if (key === 'buylist_price_fallback_pct') return 40;
        return 0;
      }),
    } as unknown as SettingsService;
    const svc = new BuylistService(
      prisma as PrismaService,
      buildPricing(null),
      settings,
      {} as UsersService,
      pii,
    );

    const res = await svc.createRequest(
      'user-1',
      [{ cardId: 'c1', productType: 'raw' as any, rawCondition: 'NM' as any }],
      VALID_CLABE,
    );
    expect(res.ineRequired).toBe(false);
    expect(res.items[0].itemStatus).toBe('cotizada');
  });
});
