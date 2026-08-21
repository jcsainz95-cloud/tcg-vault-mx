import { ConfigService } from '@nestjs/config';
import { BuylistService } from '../src/modules/buylist/buylist.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { UsersService } from '../src/modules/users/users.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';

const pii = new PiiCryptoService(new ConfigService({}));
const VALID_CLABE = '012345678901234567';

/**
 * v1.28 (P-18/P-22, §6 / ARCHITECTURE §4.26b) — el cotizador público de COMPRA (quote, quote/batch
 * y createRequest) consulta el control por variante (M-30) ANTES de la cadena de reglas:
 * bounty > override > regla > precio_pendiente. Verifica:
 *  - override pisa la regla y bounty pisa al override (misma precedencia en los 3 consumidores);
 *  - `appliedRule.source` gana "bounty" | "override" y `createRequest` los SNAPSHOTEA en
 *    `ruleSource` (habilita el conteo del bounty al pagar, fase P-22);
 *  - overrides leídos EN LOTE en batch/createRequest (UNA query por request — sin N+1);
 *  - bounty/override cotizan SIN referencia (siempre `cotizada`, sin escalar pendientes);
 *  - los topes de buylist NO cambian y aplican igual sobre montos bounty;
 *  - REGRESIÓN: sin fila M-30 todo se comporta EXACTAMENTE como antes.
 */

type OverrideRow = {
  sellOverrideCents?: number | null;
  buyOverrideCents?: number | null;
  bountyEnabled?: boolean;
  bountyPriceCents?: number | null;
};

function buildPricing(opts: {
  referenceMxnCents?: number | null;
  overridesByKey?: Record<string, OverrideRow>;
} = {}) {
  const overridesByKey = opts.overridesByKey ?? {};
  const asMap = (keys: { cardId: string; productType: string; gradeKey: string; finish: string }[]) => {
    const m = new Map<string, OverrideRow>();
    for (const k of keys) {
      const key = `${k.cardId}|${k.productType}|${k.gradeKey}|${k.finish}`;
      if (overridesByKey[key]) m.set(key, overridesByKey[key]);
    }
    return m;
  };
  const getVariantOverridesBatch = jest.fn(async (keys: never[]) => asMap(keys));
  const getVariantOverride = jest.fn(
    async (cardId: string, productType: string, gradeKey: string, finish: string) =>
      overridesByKey[`${cardId}|${productType}|${gradeKey}|${finish}`] ?? null,
  );
  const escalatePending = jest.fn().mockResolvedValue(undefined);
  const pricing = {
    gradeKeyFor: jest.fn(({ rawCondition }: { rawCondition?: string }) => `raw:${rawCondition ?? 'NM'}`),
    getReference: jest.fn(async () =>
      opts.referenceMxnCents == null
        ? { status: 'pending' }
        : { status: 'priced', referenceMxnCents: opts.referenceMxnCents },
    ),
    escalatePending,
    getVariantOverridesBatch,
    getVariantOverride,
  } as unknown as PricingService;
  return { pricing, getVariantOverridesBatch, getVariantOverride, escalatePending };
}

function buildSettings(over: { rules?: object; capPerRequest?: number } = {}): SettingsService {
  return {
    getRaw: jest.fn(async () => over.rules ?? { Common: { mode: 'fixed', value: 50 } }),
    getNumber: jest.fn(async (key: string) => {
      if (key === 'buylist_cap_per_request_cents') return over.capPerRequest ?? 100_000_000;
      if (key === 'buylist_cap_per_month_cents') return 100_000_000;
      if (key === 'ine_threshold_cents') return 100_000_000;
      if (key === 'buylist_price_fallback_pct') return 40;
      return 0;
    }),
  } as unknown as SettingsService;
}

function buildPrisma(rarity: string | null = 'Common') {
  const prisma: any = {
    card: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'c1',
        rarity,
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

function buildSvc(opts: Parameters<typeof buildPricing>[0] & { rarity?: string | null; settings?: SettingsService } = {}) {
  const prisma = buildPrisma(opts.rarity ?? 'Common');
  const p = buildPricing(opts);
  const svc = new BuylistService(
    prisma as PrismaService,
    p.pricing,
    opts.settings ?? buildSettings(),
    {} as UsersService,
    pii,
  );
  return { svc, prisma, ...p };
}

const K = 'c1|raw|raw:NM|normal';

describe('publicQuote — override/bounty pisan la regla (§4.26b)', () => {
  it('buyOverride pisa la regla: quoted=override, appliedRule {mode:fixed, source:override}', async () => {
    const { svc } = buildSvc({
      referenceMxnCents: 10000,
      overridesByKey: { [K]: { buyOverrideCents: 300 } },
    });
    const res = await svc.publicQuote('c1', 'raw' as never, 'NM' as never, 'normal' as never);
    expect(res.quote).toEqual({ status: 'cotizada', quotedPriceCents: 300, currency: 'MXN' });
    expect(res.appliedRule).toEqual({ mode: 'fixed', value: 300, source: 'override' });
  });

  it('bounty activo pisa al override (precedencia bounty > override)', async () => {
    const { svc } = buildSvc({
      referenceMxnCents: 10000,
      overridesByKey: { [K]: { buyOverrideCents: 300, bountyEnabled: true, bountyPriceCents: 7500 } },
    });
    const res = await svc.publicQuote('c1', 'raw' as never, 'NM' as never, 'normal' as never);
    expect(res.quote.quotedPriceCents).toBe(7500);
    expect(res.appliedRule.source).toBe('bounty');
  });

  it('lee el control con la clave EXACTA de la variante (cardId|productType|gradeKey|finish)', async () => {
    const { svc, getVariantOverride } = buildSvc({ referenceMxnCents: 10000 });
    await svc.publicQuote('c1', 'raw' as never, 'NM' as never, 'reverse_holo' as never);
    expect(getVariantOverride).toHaveBeenCalledWith('c1', 'raw', 'raw:NM', 'reverse_holo');
  });

  it('REGRESIÓN: sin fila M-30 la cotización es idéntica a la previa (regla fixed Common=50)', async () => {
    const { svc } = buildSvc({ referenceMxnCents: 10000 });
    const res = await svc.publicQuote('c1', 'raw' as never, 'NM' as never, 'normal' as never);
    expect(res.quote.quotedPriceCents).toBe(50);
    expect(res.appliedRule.source).toBe('rule');
  });

  it('override cotiza SIN referencia (fixed ⇒ siempre cotizada, jamás precio_pendiente)', async () => {
    // Premium sin regla ni referencia: sin override sería precio_pendiente; con override cotiza.
    const { svc } = buildSvc({
      rarity: 'Illustration Rare',
      referenceMxnCents: null,
      settings: buildSettings({ rules: {} }),
      overridesByKey: { [K]: { buyOverrideCents: 120000 } },
    });
    const res = await svc.publicQuote('c1', 'raw' as never, 'NM' as never, 'normal' as never);
    expect(res.quote).toEqual({ status: 'cotizada', quotedPriceCents: 120000, currency: 'MXN' });
    expect(res.referencePrice).toEqual({ status: 'pending' }); // la referencia sigue honesta
  });
});

describe('batchQuote — lote con overrides EN LOTE (sin N+1)', () => {
  it('UNA sola llamada a getVariantOverridesBatch; cada ítem resuelve su propio control', async () => {
    const { svc, getVariantOverridesBatch } = buildSvc({
      referenceMxnCents: 10000,
      overridesByKey: { [K]: { buyOverrideCents: 300 } },
    });
    const res = await svc.batchQuote([
      { cardId: 'c1', productType: 'raw' as never, rawCondition: 'NM' as never, finish: 'normal' as never },
      { cardId: 'c1', productType: 'raw' as never, rawCondition: 'NM' as never, finish: 'reverse_holo' as never },
    ]);
    expect(getVariantOverridesBatch).toHaveBeenCalledTimes(1);
    expect((getVariantOverridesBatch.mock.calls[0][0] as unknown[]).length).toBe(2);
    const [normal, reverse] = res.results as any[];
    expect(normal.ok).toBe(true);
    expect(normal.quote.quotedPriceCents).toBe(300); // override SOLO en la variante normal
    expect(normal.appliedRule.source).toBe('override');
    expect(reverse.ok).toBe(true);
    expect(reverse.appliedRule.source).toBe('fallback'); // reverse sin fila → cadena de siempre
  });
});

describe('createRequest — snapshot de la regla aplicada + topes intactos', () => {
  const item = { cardId: 'c1', productType: 'raw' as never, rawCondition: 'NM' as never, finish: 'normal' as never };

  it('snapshotea ruleSource="override" con ruleMode=fixed y ruleValue=el override', async () => {
    const { svc, prisma, getVariantOverridesBatch, escalatePending } = buildSvc({
      referenceMxnCents: 10000,
      overridesByKey: { [K]: { buyOverrideCents: 300 } },
    });
    const res = await svc.createRequest('user-1', [item], VALID_CLABE);
    expect(getVariantOverridesBatch).toHaveBeenCalledTimes(1); // lote también en createRequest
    expect(res.quotedTotalCents).toBe(300);
    // Snapshot PERSISTIDO en SellRequestItem (lo que habilita el conteo P-22 al pagar).
    const created = (prisma.sellRequest.create as jest.Mock).mock.calls[0][0].data.items.create[0];
    expect(created).toMatchObject({ ruleSource: 'override', ruleMode: 'fixed', ruleValue: 300 });
    // DTO de respuesta: appliedRule refleja el snapshot.
    expect(res.items[0]).toMatchObject({
      appliedRule: { mode: 'fixed', value: 300, source: 'override' },
      quotedPriceCents: 300,
      itemStatus: 'cotizada',
    });
    expect(escalatePending).not.toHaveBeenCalled();
  });

  it('snapshotea ruleSource="bounty" (habilita el conteo al pagar, P-22) incluso SIN referencia', async () => {
    const { svc, escalatePending } = buildSvc({
      rarity: 'Illustration Rare',
      referenceMxnCents: null,
      settings: buildSettings({ rules: {} }),
      overridesByKey: { [K]: { bountyEnabled: true, bountyPriceCents: 250000 } },
    });
    const res = await svc.createRequest('user-1', [item], VALID_CLABE);
    expect(res.items[0]).toMatchObject({
      appliedRule: { mode: 'fixed', value: 250000, source: 'bounty' },
      quotedPriceCents: 250000,
      itemStatus: 'cotizada',
    });
    // fixed ⇒ cotizada ⇒ NO escala pendiente aunque no haya referencia.
    expect(escalatePending).not.toHaveBeenCalled();
  });

  it('los topes NO cambian: un monto bounty por encima del cap → 422 BUYLIST_LIMIT_EXCEEDED', async () => {
    const { svc } = buildSvc({
      referenceMxnCents: 10000,
      settings: buildSettings({ capPerRequest: 100_000 }),
      overridesByKey: { [K]: { bountyEnabled: true, bountyPriceCents: 250_000 } },
    });
    await expect(svc.createRequest('user-1', [item], VALID_CLABE)).rejects.toMatchObject({
      code: 'BUYLIST_LIMIT_EXCEEDED',
    });
  });

  it('REGRESIÓN: sin fila M-30 el snapshot es el previo (rule/fallback)', async () => {
    const { svc } = buildSvc({ referenceMxnCents: 10000 });
    const res = await svc.createRequest('user-1', [item], VALID_CLABE);
    expect(res.items[0]).toMatchObject({ appliedRule: { mode: 'fixed', value: 50, source: 'rule' } });
  });
});
