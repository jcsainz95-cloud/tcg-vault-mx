import { ConfigService } from '@nestjs/config';
import { BuylistService } from '../src/modules/buylist/buylist.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { UsersService } from '../src/modules/users/users.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { DEFAULT_PRICING_CURVE } from '../src/common/pricing-curve';

const pii = new PiiCryptoService(new ConfigService({}));
const VALID_CLABE = '012345678901234567';

/**
 * v1.28 (P-18/P-22, §6 / ARCHITECTURE §4.26b) — el cotizador público de COMPRA (quote, quote/batch
 * y createRequest) consulta el control por variante (M-30) ANTES de la cadena de reglas:
 * bounty > override > regla > precio_pendiente. Verifica:
 *  - override pisa la regla y bounty pisa al override (misma precedencia en los 3 consumidores);
 *  - v2.0 (P-48): `priceBasis` reemplaza a `appliedRule.source` y `createRequest` lo SNAPSHOTEA
 *    (habilita el conteo del bounty al pagar, fase P-22); el peldaño «regla» pasa a ser «CURVA»;
 *  - overrides leídos EN LOTE en batch/createRequest (UNA query por request — sin N+1);
 *  - bounty/override cotizan SIN referencia (siempre `cotizada`, sin escalar pendientes);
 *  - los topes de buylist NO cambian y aplican igual sobre montos bounty;
 *  - v2.0: el override de compra es ABSOLUTO — por DEBAJO de la curva se paga verbatim (criterio 89);
 *  - v2.0: el bounty se revalida contra la curva AL COTIZAR (§4.36.6), no solo al crearlo.
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
  // v2.0 (§4.36.5c): el MISMO seam escala Y cierra la cola. Delega en el mock de escalada cuando hay
  // razón, para que los asserts de «no escala» sigan siendo válidos.
  const settlePendingForVariant = jest.fn(async (reason: string | null) =>
    reason == null ? undefined : escalatePending(),
  );
  const pricing = {
    loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
    // v2.1.1 (§4.36.5b): el seam de VENTA devuelve una DECISIÓN (monto + veredicto). El mock usa
    // el CUERPO REAL (`PricingService.prototype`): es puro y no toca `this`, así que el test no
    // puede divergir de producción ni reimplementar la matemática.
    decideSalePrice: jest.fn(PricingService.prototype.decideSalePrice),
    gradeKeyFor: jest.fn(({ rawCondition }: { rawCondition?: string }) => `raw:${rawCondition ?? 'NM'}`),
    getReference: jest.fn(async () =>
      opts.referenceMxnCents == null
        ? { status: 'pending' }
        : { status: 'priced', referenceMxnCents: opts.referenceMxnCents },
    ),
    escalatePending,
    settlePendingForVariant,
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
      // v2.1.1: `createRequest` carga las cartas EN LOTE (mata el N+1 que hacía un
      // `findUnique` por ítem). El mock delega en el MISMO `findUnique` del fixture
      // (`this` = este objeto `card`), para no duplicar datos ni criterios.
      findMany: jest.fn(async function (this: any, args: any) {
        const ids: string[] = args?.where?.id?.in ?? [];
        const rows = await Promise.all(ids.map((id) => this.findUnique({ where: { id } })));
        return rows.filter(Boolean);
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
  it('buyOverride pisa la CURVA y es ABSOLUTO: $3 se paga aunque la curva daría $40 (criterio 89)', async () => {
    const { svc } = buildSvc({
      referenceMxnCents: 10000,
      overridesByKey: { [K]: { buyOverrideCents: 300 } },
    });
    const res = await svc.publicQuote('c1', 'raw' as never, 'NM' as never, 'normal' as never);
    expect(res.quote).toEqual({ status: 'cotizada', quotedPriceCents: 300, currency: 'MXN' });
    expect(res.priceBasis).toBe('override');
  });

  it('bounty activo pisa al override (precedencia bounty > override)', async () => {
    const { svc } = buildSvc({
      referenceMxnCents: 10000,
      overridesByKey: { [K]: { buyOverrideCents: 300, bountyEnabled: true, bountyPriceCents: 7500 } },
    });
    const res = await svc.publicQuote('c1', 'raw' as never, 'NM' as never, 'normal' as never);
    expect(res.quote.quotedPriceCents).toBe(7500); // 7500 > curva 4000 ⇒ bounty EFECTIVO
    expect(res.priceBasis).toBe('bounty');
  });

  it('lee el control con la clave EXACTA de la variante (cardId|productType|gradeKey|finish)', async () => {
    const { svc, getVariantOverride } = buildSvc({ referenceMxnCents: 10000 });
    await svc.publicQuote('c1', 'raw' as never, 'NM' as never, 'reverse_holo' as never);
    expect(getVariantOverride).toHaveBeenCalledWith('c1', 'raw', 'raw:NM', 'reverse_holo');
  });

  it('sin fila M-30 la cotización sale de la CURVA (mercado $100 ⇒ 40 % = $40)', async () => {
    const { svc } = buildSvc({ referenceMxnCents: 10000 });
    const res = await svc.publicQuote('c1', 'raw' as never, 'NM' as never, 'normal' as never);
    expect(res.quote.quotedPriceCents).toBe(4000);
    expect(res.priceBasis).toBe('market');
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
    expect(res.priceBasis).toBe('override');
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
    expect(normal.priceBasis).toBe('override');
    expect(reverse.ok).toBe(true);
    expect(reverse.priceBasis).toBe('market'); // reverse sin fila → la CURVA
    expect(reverse.quote.quotedPriceCents).toBe(4000);
  });
});

describe('createRequest — snapshot de la regla aplicada + topes intactos', () => {
  const item = { cardId: 'c1', productType: 'raw' as never, rawCondition: 'NM' as never, finish: 'normal' as never };

  it('snapshotea priceBasis="override" (y NADA en las columnas legacy ruleMode/ruleValue/ruleSource)', async () => {
    const { svc, prisma, getVariantOverridesBatch, escalatePending } = buildSvc({
      referenceMxnCents: 10000,
      overridesByKey: { [K]: { buyOverrideCents: 300 } },
    });
    const res = await svc.createRequest('user-1', [item], VALID_CLABE);
    expect(getVariantOverridesBatch).toHaveBeenCalledTimes(1); // lote también en createRequest
    expect(res.quotedTotalCents).toBe(300);
    // Snapshot PERSISTIDO en SellRequestItem (lo que habilita el conteo P-22 al pagar).
    const created = (prisma.sellRequest.create as jest.Mock).mock.calls[0][0].data.items.create[0];
    expect(created).toMatchObject({ priceBasis: 'override' });
    expect(created.ruleMode).toBeUndefined();
    expect(created.ruleValue).toBeUndefined();
    expect(created.ruleSource).toBeUndefined();
    // DTO de respuesta: `priceBasis` refleja el snapshot (`appliedRule` está RETIRADO).
    expect(res.items[0]).toMatchObject({
      priceBasis: 'override',
      quotedPriceCents: 300,
      itemStatus: 'cotizada',
    });
    expect(escalatePending).not.toHaveBeenCalled();
  });

  it('snapshotea priceBasis="bounty" (habilita el conteo al pagar, P-22) incluso SIN referencia', async () => {
    const { svc, escalatePending } = buildSvc({
      rarity: 'Illustration Rare',
      referenceMxnCents: null,
      settings: buildSettings({ rules: {} }),
      overridesByKey: { [K]: { bountyEnabled: true, bountyPriceCents: 250000 } },
    });
    const res = await svc.createRequest('user-1', [item], VALID_CLABE);
    expect(res.items[0]).toMatchObject({
      priceBasis: 'bounty',
      quotedPriceCents: 250000,
      itemStatus: 'cotizada',
    });
    // El bounty es precio explícito ⇒ cotizada ⇒ NO escala pendiente aunque la curva no resuelva.
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

  it('sin fila M-30 el snapshot es el de la CURVA (priceBasis="market")', async () => {
    const { svc } = buildSvc({ referenceMxnCents: 10000 });
    const res = await svc.createRequest('user-1', [item], VALID_CLABE);
    expect(res.items[0]).toMatchObject({ priceBasis: 'market', quotedPriceCents: 4000 });
  });
});
