import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BUY_PREMIUM_FLOOR_POLICY,
  DEFAULT_PRICING_CURVE,
  DEFAULT_SALE_PREMIUM_FLOOR_POLICY,
  PremiumFloorPolicy,
  premiumFloorGuard,
  premiumFloorPublishes,
  resolvePendingReason,
  sanitizePremiumFloorSalePublish,
  validatePremiumFloorSalePublish,
} from '../src/common/pricing-curve';
import { isPremiumCanonicalRarity, isRarityMapped } from '../src/common/rarity-catalog';
import { PriceInfo, PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import {
  SETTING_DEFAULTS,
  SETTING_DTO_MAP,
  SETTING_VALIDATORS,
  SettingKey,
} from '../src/modules/settings/settings.constants';
import { PrismaService } from '../src/prisma/prisma.service';
import { FxService } from '../src/modules/pricing/fx.service';
import { composeVariantPricing } from '../src/modules/pricing/variant-pricing';
import { PriceSyncJobService } from '../src/jobs/price-sync.service';
import { BuylistService } from '../src/modules/buylist/buylist.service';
import { UsersService } from '../src/modules/users/users.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { ConfigService } from '@nestjs/config';
import { stripComments } from './helpers/strip-comments';
import { identCensus, walkSources } from './helpers/ident-census';

/**
 * v1.80.8.5 — API_CONTRACT §M2 `M2-PF` (ARCHITECTURE §4.36.5 c-ter). **PREMIUM EN EL PISO, EN VENTA: SE
 * PUBLICA AL PISO SEGÚN EL DIAL `premiumFloorSalePublish`.** Decisión del dueño (HECHOS 2026-10-04,
 * «Precios — decisiones» (a) y «Precios y reembolsos — respuestas…» (a)): solo `Double Rare` y
 * `Rare Holo EX`; el resto de premium sigue retenida. La COMPRA no cambia.
 *
 * Aquí: PF-1, PF-2, PF-3 (cotización), PF-6, PF-8 (puerta + loader), PF-9 y PF-11. PF-4 vive en
 * `inventory.publish-all.spec.ts`, PF-5 en `price-ingest.service.spec.ts`; PF-3 (`createRequest`), PF-7,
 * PF-8 (HTTP) y PF-10 en `test/integration/premium-floor-sale.e2e-spec.ts`.
 */

const SEED = DEFAULT_SALE_PREMIUM_FLOOR_POLICY;
const ALL: PremiumFloorPolicy = { mode: 'all', rarities: [] };
const NONE: PremiumFloorPolicy = { mode: 'none', rarities: [] };
const ONLY_DR: PremiumFloorPolicy = { mode: 'only', rarities: ['Double Rare'] };
const DR = 'Double Rare';
const EX = 'Rare Holo EX';
const SIR = 'Special Illustration Rare';
const UR = 'Ultra Rare';
/** Cruda SIN mapear con el token `ex`: premium SOLO por patrón; su «canónica» es el pass-through. */
const UNMAPPED_EX = 'Holo Ex Promo';

describe('precondiciones del catálogo de rarezas (anti-vacuidad)', () => {
  it('las dos del seed son canónicas premium; la cruda `ex` es premium SOLO por patrón (sin mapear)', () => {
    for (const r of [DR, EX, SIR, UR]) expect({ r, premium: isPremiumCanonicalRarity(r) }).toEqual({ r, premium: true });
    expect(isRarityMapped(UNMAPPED_EX)).toBe(false);
    expect(isPremiumCanonicalRarity(UNMAPPED_EX)).toBe(true);
    expect(isPremiumCanonicalRarity('Common')).toBe(false);
  });
});

// =================================================================================================
// PF-1 — pura
// =================================================================================================
describe('PF-1 — `premiumFloorPublishes` / `premiumFloorGuard` / `resolvePendingReason` (puras)', () => {
  it('`all` ⇒ DR y SIR `ok`; `none` ⇒ las dos `premium_at_floor`; `only:[DR]` ⇒ DR `ok`, SIR retenida', () => {
    const verdict = (p: PremiumFloorPolicy) => [premiumFloorGuard(DR, 'floor', p), premiumFloorGuard(SIR, 'floor', p)];
    expect(verdict(ALL)).toEqual(['ok', 'ok']);
    expect(verdict(NONE)).toEqual(['premium_at_floor', 'premium_at_floor']);
    expect(verdict(ONLY_DR)).toEqual(['ok', 'premium_at_floor']);
  });

  it('`only`: comparación EXACTA por canónica — una premium por patrón (sin canónica en la lista) se RETIENE', () => {
    expect(premiumFloorPublishes(ONLY_DR, null)).toBe(false);
    expect(premiumFloorPublishes(ONLY_DR, 'doublerare')).toBe(false); // alias ≠ canónica
    expect(premiumFloorPublishes(SEED, UNMAPPED_EX)).toBe(false);
    expect(premiumFloorGuard(UNMAPPED_EX, 'floor', SEED)).toBe('premium_at_floor');
    expect(premiumFloorGuard(UNMAPPED_EX, 'floor', ONLY_DR)).toBe('premium_at_floor');
    // `null` no es premium: nada que retener, con cualquier política.
    for (const p of [ALL, NONE, ONLY_DR]) expect(premiumFloorGuard(null, 'floor', p)).toBe('ok');
  });

  it('`pending` ⇒ `no_market` con LAS TRES políticas (el dial no toca `no_market`)', () => {
    for (const p of [ALL, NONE, ONLY_DR, SEED]) {
      expect(resolvePendingReason('pending', DR, p)).toBe('no_market');
      expect(resolvePendingReason('pending', SIR, p)).toBe('no_market');
    }
  });

  it('`resolvePendingReason` en el piso sigue la política; override/bounty/market nunca disparan', () => {
    expect(resolvePendingReason('floor', DR, SEED)).toBeNull();
    expect(resolvePendingReason('floor', EX, SEED)).toBeNull();
    expect(resolvePendingReason('floor', SIR, SEED)).toBe('premium_at_floor');
    expect(resolvePendingReason('floor', DR, NONE)).toBe('premium_at_floor');
    for (const b of ['override', 'bounty', 'market'] as const) {
      for (const p of [NONE, SEED]) expect(resolvePendingReason(b, SIR, p)).toBeNull();
    }
  });

  it('la política de COMPRA es la constante `none` (congelada)', () => {
    expect(BUY_PREMIUM_FLOOR_POLICY).toEqual({ mode: 'none', rarities: [] });
    expect(Object.isFrozen(BUY_PREMIUM_FLOOR_POLICY)).toBe(true);
    expect(SEED).toEqual({ mode: 'only', rarities: [DR, EX] });
  });
});

// =================================================================================================
// Servicio REAL de precios sobre una BD de settings en memoria (fila ausente ⇔ `findUnique` null).
// =================================================================================================
function realPricing(dialRow?: unknown) {
  const rows = new Map<string, unknown>();
  if (dialRow !== undefined) rows.set(SettingKey.PREMIUM_FLOOR_SALE_PUBLISH, dialRow);
  const prisma = {
    configSetting: {
      findUnique: jest.fn(async ({ where }: any) =>
        rows.has(where.key) ? { key: where.key, valueJson: rows.get(where.key) } : null,
      ),
    },
  } as unknown as PrismaService;
  const settings = new SettingsService(prisma);
  const pricing = new PricingService(prisma, settings, {} as FxService, {} as never, {} as never, {} as never);
  const errorLog = jest.spyOn((pricing as any).logger, 'error').mockImplementation(() => undefined);
  return { pricing, settings, errorLog };
}

// =================================================================================================
// PF-2 — `decideSalePrice` (vía el seam single, que carga curva Y política)
// =================================================================================================
describe('PF-2 — el seam de VENTA con el dial', () => {
  const decide = (pricing: PricingService, rarityCanonical: string, extra: Record<string, unknown> = {}) =>
    pricing.computeSalePriceForItem({ referenceMxnCents: 1000, rarityCanonical, ...extra });
  const PUBLISHED = { priceCents: 2500, basis: 'floor', pendingReason: null };
  const RETAINED = { priceCents: null, basis: 'pending', pendingReason: 'premium_at_floor' };

  it('SIN fila (= seed): DR y `Rare Holo EX` ⇒ al piso (2500, criterio 254); SIR, Ultra Rare y la cruda `ex` ⇒ retenidas', async () => {
    const { pricing, errorLog } = realPricing();
    expect(DEFAULT_PRICING_CURVE.sale.floorCents).toBe(2500);
    expect(await decide(pricing, DR)).toMatchObject(PUBLISHED);
    expect(await decide(pricing, EX)).toMatchObject(PUBLISHED);
    for (const r of [SIR, UR, UNMAPPED_EX]) expect({ r, d: await decide(pricing, r) }).toMatchObject({ r, d: RETAINED });
    expect(errorLog).not.toHaveBeenCalled();
  });

  it('fila `none` ⇒ las CINCO retenidas (conducta v1.80.8.4)', async () => {
    const { pricing } = realPricing(NONE);
    for (const r of [DR, EX, SIR, UR, UNMAPPED_EX]) {
      expect({ r, d: await decide(pricing, r) }).toMatchObject({ r, d: RETAINED });
    }
  });

  it('fila `all` ⇒ toda premium al piso (incluida la cruda `ex`)', async () => {
    const { pricing } = realPricing(ALL);
    for (const r of [DR, EX, SIR, UR, UNMAPPED_EX]) {
      expect({ r, d: await decide(pricing, r) }).toMatchObject({ r, d: PUBLISHED });
    }
  });

  it('sin mercado ⇒ `no_market` con CUALQUIER política; con `sellOverrideCents` gana el override con cualquiera', async () => {
    for (const row of [undefined, NONE, ALL, ONLY_DR]) {
      const { pricing } = realPricing(row);
      expect(await decide(pricing, DR, { referenceMxnCents: null })).toMatchObject({
        priceCents: null,
        pendingReason: 'no_market',
      });
      expect(await decide(pricing, SIR, { controls: { sellOverrideCents: 9900 } })).toMatchObject({
        priceCents: 9900,
        basis: 'override',
        pendingReason: null,
      });
    }
  });

  it('el seam USA la política que le pasan (no la lee si viene izada)', async () => {
    const { pricing } = realPricing(NONE); // la BD dice `none`…
    const load = jest.spyOn(pricing, 'loadSalePremiumFloorPolicy');
    const d = await pricing.computeSalePriceForItem({
      referenceMxnCents: 1000,
      rarityCanonical: DR,
      curve: DEFAULT_PRICING_CURVE,
      premiumFloorPolicy: SEED, // …pero el lote izó el seed
    });
    expect(d).toMatchObject(PUBLISHED);
    expect(load).not.toHaveBeenCalled();
  });
});

// =================================================================================================
// PF-8 — puerta (validador) + loader
// =================================================================================================
describe('PF-8 — el dial en las cuatro estructuras, su validador y su loader', () => {
  it('va en las CUATRO estructuras de `settings.constants.ts` y el DTO lo llama `premiumFloorSalePublish`', () => {
    expect(SettingKey.PREMIUM_FLOOR_SALE_PUBLISH).toBe('premium_floor_sale_publish');
    expect(SETTING_DEFAULTS[SettingKey.PREMIUM_FLOOR_SALE_PUBLISH]).toEqual({ mode: 'only', rarities: [DR, EX] });
    expect(SETTING_VALIDATORS[SettingKey.PREMIUM_FLOOR_SALE_PUBLISH]).toBe(validatePremiumFloorSalePublish);
    expect(SETTING_DTO_MAP.premiumFloorSalePublish).toBe(SettingKey.PREMIUM_FLOOR_SALE_PUBLISH);
  });

  it('el seed pasa su propio validador; los tres modos válidos pasan', () => {
    expect(validatePremiumFloorSalePublish(SETTING_DEFAULTS[SettingKey.PREMIUM_FLOOR_SALE_PUBLISH])).toBeNull();
    for (const v of [SEED, ALL, NONE, ONLY_DR, { mode: 'only', rarities: [SIR, 'Hyper Rare'] }]) {
      expect(validatePremiumFloorSalePublish(v)).toBeNull();
    }
  });

  it.each([
    ['mode fuera del enum', { mode: 'some', rarities: [] }],
    ["'only' con lista vacía", { mode: 'only', rarities: [] }],
    ["'all' con lista no vacía", { mode: 'all', rarities: [DR] }],
    ["'none' con lista no vacía", { mode: 'none', rarities: [DR] }],
    ['rareza no canónica', { mode: 'only', rarities: ['Doble Rare'] }],
    ['alias en vez de canónica', { mode: 'only', rarities: ['doublerare'] }],
    ['patrón crudo `ex` sin mapear', { mode: 'only', rarities: [UNMAPPED_EX] }],
    ['canónica NO premium', { mode: 'only', rarities: ['Common'] }],
    ['duplicados', { mode: 'only', rarities: [DR, DR] }],
    ['rarities no es array', { mode: 'all', rarities: 'x' }],
    ['rareza no string', { mode: 'only', rarities: [1] }],
    ['sin rarities', { mode: 'none' }],
    ['clave extra', { mode: 'none', rarities: [], extra: 1 }],
    ['null', null],
    ['string', 'only'],
    ['array', [DR]],
  ])('⇒ rechaza: %s', (_g, v) => {
    expect(validatePremiumFloorSalePublish(v)).toEqual(expect.any(String));
  });

  it('`PUT` por la puerta de `SettingsService.update`: 422 con `details.errors.premiumFloorSalePublish`, y no escribe', async () => {
    const tx = { configSetting: { upsert: jest.fn() } };
    const prisma = { $transaction: jest.fn(async (fn: any) => fn(tx)) } as unknown as PrismaService;
    const svc = new SettingsService(prisma);
    await expect(svc.update({ premiumFloorSalePublish: { mode: 'only', rarities: ['Common'] } })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { errors: { premiumFloorSalePublish: expect.any(String) } },
    });
    expect(tx.configSetting.upsert).not.toHaveBeenCalled();
    await svc.update({ premiumFloorSalePublish: NONE });
    expect(tx.configSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: 'premium_floor_sale_publish' } }),
    );
  });

  it('lectura pura: `undefined` (sin fila) ⇒ el seed; válido ⇒ COPIA; inválido ⇒ `none` + problema', () => {
    expect(sanitizePremiumFloorSalePublish(undefined)).toEqual({ policy: SEED, problem: null });
    const stored = { mode: 'only', rarities: [SIR] };
    const ok = sanitizePremiumFloorSalePublish(stored);
    expect(ok).toEqual({ policy: stored, problem: null });
    expect(ok.policy.rarities).not.toBe(stored.rarities);
    expect(sanitizePremiumFloorSalePublish({ mode: 'all', rarities: [DR] })).toEqual({
      policy: NONE,
      problem: expect.any(String),
    });
  });

  it('loader: fila AUSENTE ⇒ seed (no `all`, no `none`)', async () => {
    const { pricing, errorLog } = realPricing();
    expect(await pricing.loadSalePremiumFloorPolicy()).toEqual(SEED);
    expect(errorLog).not.toHaveBeenCalled();
  });

  it.each([
    ['basura', { foo: 1 }],
    ['no premium', { mode: 'only', rarities: ['Common'] }],
    ['`all` con lista', { mode: 'all', rarities: [DR] }],
    ['null', null],
  ])('loader: valor almacenado inválido (%s) ⇒ `none` + logger.error', async (_g, row) => {
    const { pricing, errorLog } = realPricing(row);
    expect(await pricing.loadSalePremiumFloorPolicy()).toEqual(NONE);
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('premium_floor_sale_publish'));
  });

  it('loader: un valor válido se devuelve tal cual (copia)', async () => {
    const { pricing } = realPricing({ mode: 'only', rarities: [SIR] });
    expect(await pricing.loadSalePremiumFloorPolicy()).toEqual({ mode: 'only', rarities: [SIR] });
  });
});

// =================================================================================================
// PF-9 — `composeVariantPricing`
// =================================================================================================
describe('PF-9 — la consola de precios por variante', () => {
  const priced = (cents: number): PriceInfo =>
    ({ status: 'priced', referenceMxnCents: cents, source: 'manual', capturedDate: '2026-10-04' }) as PriceInfo;

  it('seed: DR en el piso ⇒ `sell` 2500/floor/premiumAtFloor false; SIR ⇒ null/pending/true', () => {
    const dr = composeVariantPricing(priced(1000), DEFAULT_PRICING_CURVE, null, DR, SEED);
    expect(dr.sell).toMatchObject({ effectiveCents: 2500, source: 'floor', premiumAtFloor: false });
    const sir = composeVariantPricing(priced(1000), DEFAULT_PRICING_CURVE, null, SIR, SEED);
    expect(sir.sell).toMatchObject({ effectiveCents: null, source: 'pending', premiumAtFloor: true });
  });

  it('`none`: la DR vuelve a ser como la SIR', () => {
    const dr = composeVariantPricing(priced(1000), DEFAULT_PRICING_CURVE, null, DR, NONE);
    expect(dr.sell).toMatchObject({ effectiveCents: null, source: 'pending', premiumAtFloor: true });
  });

  it('`buy` NO cambia con el dial — ni en el bin (retenida con TODA política) ni en mercado', () => {
    for (const r of [DR, SIR]) {
      for (const m of [100, 1000]) {
        const buys = [SEED, ALL, NONE].map((p) => composeVariantPricing(priced(m), DEFAULT_PRICING_CURVE, null, r, p).buy);
        expect(buys[1]).toEqual(buys[0]);
        expect(buys[2]).toEqual(buys[0]);
      }
      // Con mercado MX$1 la compra cae al BIN: una premium sigue sin cotizarse aunque el dial sea `all`.
      expect(composeVariantPricing(priced(100), DEFAULT_PRICING_CURVE, null, r, ALL).buy).toMatchObject({
        effectiveCents: null,
        source: 'pending',
        premiumAtFloor: true,
      });
    }
  });
});

// =================================================================================================
// PF-3 (cotización) — la COMPRA no lee el dial
// =================================================================================================
describe('PF-3 — COMPRA con el dial de VENTA en `all`', () => {
  it('una DR en el BIN ⇒ `precio_pendiente` y el loader del dial NI SE LLAMA', async () => {
    const prisma = {
      card: {
        findUnique: jest.fn(async () => ({ id: 'c1', rarity: DR, rarityCanonical: DR, availableFinishes: ['normal'] })),
      },
    } as unknown as PrismaService;
    const loadSale = jest.fn(async () => ALL);
    const pricing = {
      loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
      loadSalePremiumFloorPolicy: loadSale,
      decideSalePrice: jest.fn(PricingService.prototype.decideSalePrice),
      gradeKeyFor: jest.fn(() => 'raw:NM'),
      tryGradeKeyFor: jest.fn(() => 'raw:NM'),
      getReference: jest.fn(async () => ({ status: 'priced', referenceMxnCents: 100 })),
      getVariantOverride: jest.fn(async () => null),
      getVariantOverridesBatch: jest.fn(async () => new Map()),
      escalatePending: jest.fn(),
      settlePendingForVariant: jest.fn(async () => undefined),
    } as unknown as PricingService;
    const settings = { getRaw: jest.fn(), getNumber: jest.fn(async () => 0) } as unknown as SettingsService;
    const svc = new BuylistService(prisma, pricing, settings, {} as UsersService, new PiiCryptoService(new ConfigService({})));
    const q = await svc.publicQuote('c1', 'raw', 'NM', 'normal');
    expect(q.quote.status).toBe('precio_pendiente');
    expect(q.quote.quotedPriceCents).toBeNull();
    expect(loadSale).not.toHaveBeenCalled();
    expect(settings.getRaw).not.toHaveBeenCalledWith('premium_floor_sale_publish');
  });
});

// =================================================================================================
// PF-6 — barrido VQ, rama nueva
// =================================================================================================
describe('PF-6 — el barrido VQ cierra las `premium_at_floor` de VENTA cuya rareza el dial publica', () => {
  const RARITY: Record<string, string> = { 'c-dr': DR, 'c-sir': SIR, 'c-nm': DR, 'c-cust': 'Common' };

  function build(policy: PremiumFloorPolicy) {
    const base = { productType: 'raw', gradeKey: 'raw:NM', finish: 'normal', cardProductId: null, sealedProductId: null, status: 'open' };
    const rows: any[] = [
      { id: 'dr-inv', cardId: 'c-dr', context: 'inventory', reason: 'premium_at_floor', ...base },
      { id: 'sir-inv', cardId: 'c-sir', context: 'inventory', reason: 'premium_at_floor', ...base },
      { id: 'dr-buy', cardId: 'c-dr', context: 'buylist', reason: 'premium_at_floor', ...base },
      { id: 'dr-nm', cardId: 'c-nm', context: 'inventory', reason: 'no_market', ...base },
      { id: 'cust-null', cardId: 'c-cust', context: 'inventory', reason: null, ...base },
    ];
    const items = [
      // La DR tiene pieza vendible; la SIR no. La rama nueva NO casa piezas.
      { id: 'i-dr', cardId: 'c-dr', ownerType: 'platform', status: 'in_stock', productType: 'raw', rawCondition: 'NM', finish: 'normal', listPriceCents: null, cardProductId: null, sealedProductId: null, tcgplayerProductId: null, gradingCompany: null, gradeValue: null },
      { id: 'i-cust', cardId: 'c-cust', ownerType: 'customer', status: 'in_custody', productType: 'raw', rawCondition: 'NM', finish: 'normal', listPriceCents: null, cardProductId: null, sealedProductId: null, tcgplayerProductId: null, gradingCompany: null, gradeValue: null },
    ];
    const matches = (r: any, where: any): boolean =>
      Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
        if (v && typeof v === 'object' && !Array.isArray(v) && 'in' in v) return v.in.includes(r[k]);
        return (r[k] ?? null) === (v ?? null);
      });
    const prisma: any = {
      pendingPriceEntry: {
        findMany: jest.fn(async ({ where, select }: any) =>
          rows
            .filter((r) => matches(r, where))
            .map((r) => (select?.card ? { ...r, card: { rarity: RARITY[r.cardId], rarityCanonical: RARITY[r.cardId] } } : { ...r })),
        ),
        updateMany: jest.fn(async ({ where, data }: any) => {
          let count = 0;
          for (const r of rows) if (matches(r, where)) (Object.assign(r, data), count++);
          return { count };
        }),
      },
      inventoryItem: { findMany: jest.fn(async ({ where }: any) => items.filter((i) => matches(i, { ownerType: where.ownerType, status: where.status, cardId: where.cardId }))) },
    };
    const pricing = new PricingService(prisma as PrismaService, {} as SettingsService, {} as FxService, {} as never, {} as never, {} as never);
    jest.spyOn(pricing, 'loadSalePremiumFloorPolicy').mockResolvedValue(policy);
    const job = new PriceSyncJobService(prisma as PrismaService, pricing);
    jest.spyOn((job as any).logger, 'log').mockImplementation(() => undefined);
    const state = () => Object.fromEntries(rows.map((r) => [r.id, r.status]));
    return { job, rows, state };
  }

  it('seed (`only` DR/EX): DR `resolved` (resolvedPriceRefId null), SIR sigue `open`; COMPRA, `no_market` intactas; `null` según VQ-7; 2.ª corrida no-op', async () => {
    const { job, rows, state } = build(SEED);
    expect(await job.sweepUnreasonedSaleQueue()).toEqual({ closed: 1, kept: 0, premiumFloorClosed: 1 });
    expect(state()).toEqual({
      'dr-inv': 'resolved',
      'sir-inv': 'open',
      'dr-buy': 'open',
      'dr-nm': 'open',
      'cust-null': 'resolved',
    });
    const dr = rows.find((r) => r.id === 'dr-inv');
    expect(dr.resolvedPriceRefId).toBeNull();
    expect(dr.resolvedAt).toBeInstanceOf(Date);
    expect(dr.reason).toBe('premium_at_floor');
    expect(await job.sweepUnreasonedSaleQueue()).toEqual({ closed: 0, kept: 0, premiumFloorClosed: 0 });
  });

  it('`all`: las DOS `inventory premium_at_floor` `resolved`; COMPRA y `no_market` intactas', async () => {
    const { job, state } = build(ALL);
    expect((await job.sweepUnreasonedSaleQueue()).premiumFloorClosed).toBe(2);
    expect(state()).toMatchObject({ 'dr-inv': 'resolved', 'sir-inv': 'resolved', 'dr-buy': 'open', 'dr-nm': 'open' });
  });

  it('`none`: la rama nueva es no-op (ni siquiera lee la cola de premium)', async () => {
    const { job, state } = build(NONE);
    expect(await job.sweepUnreasonedSaleQueue()).toEqual({ closed: 1, kept: 0, premiumFloorClosed: 0 });
    expect(state()).toMatchObject({ 'dr-inv': 'open', 'sir-inv': 'open', 'dr-buy': 'open', 'dr-nm': 'open' });
  });

  it('la ESCRITURA repite `status/context/reason` en el `where` (no cierra una fila que cambió entre lectura y escritura)', async () => {
    const { job, rows } = build(SEED);
    const pricing = (job as any).pricing as PricingService;
    // Una fila de COMPRA y una `no_market` pasadas a mano por id NO se cierran.
    expect(await pricing.closeStalePremiumFloorSaleRows(['dr-buy', 'dr-nm', 'cust-null'])).toBe(0);
    expect(rows.filter((r) => r.status === 'resolved')).toEqual([]);
    expect(await pricing.closeStalePremiumFloorSaleRows([])).toBe(0);
  });
});

// =================================================================================================
// PF-11 — candado de fuente
// =================================================================================================
describe('PF-11 — candado de fuente: quién pasa QUÉ política', () => {
  const SRC = join(__dirname, '..', 'src');
  const rel = (f: string) => f.slice(SRC.length + 1).split('\\').join('/');

  /** El N-ésimo argumento (0-based) de CADA llamada `fn(` en `code`, recortado. */
  function nthArgs(code: string, fn: string, n: number): string[] {
    const out: string[] = [];
    const re = new RegExp(`\\b${fn}\\s*\\(`, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(code)) !== null) {
      // Las DECLARACIONES (`function fn(…)`) no son llamadas.
      if (/function\s+$/.test(code.slice(Math.max(0, m.index - 12), m.index))) continue;
      let depth = 1;
      let i = m.index + m[0].length;
      const args: string[] = [''];
      for (; i < code.length && depth > 0; i++) {
        const c = code[i];
        if ('([{'.includes(c)) depth++;
        else if (')]}'.includes(c)) depth--;
        if (depth === 0) break;
        if (depth === 1 && c === ',') args.push('');
        else args[args.length - 1] += c;
      }
      const clean = args.map((a) => a.replace(/\s+/g, ' ').trim()).filter((a) => a !== '');
      out.push(clean[n] ?? '<ausente>');
    }
    return out;
  }

  function policyArgsCensus(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const f of walkSources(SRC)) {
      const r = rel(f);
      if (r === 'common/pricing-curve.ts') continue; // las definiciones (y `resolvePendingReason → premiumFloorGuard`)
      const code = stripComments(readFileSync(f, 'utf8'));
      const args = [...nthArgs(code, 'premiumFloorGuard', 2), ...nthArgs(code, 'resolvePendingReason', 2)];
      if (args.length > 0) out[r] = args;
    }
    return out;
  }

  it('lista CERRADA de llamadores y su política: compra ⇒ solo `BUY_PREMIUM_FLOOR_POLICY`; venta ⇒ la del loader', () => {
    expect(policyArgsCensus()).toEqual({
      'modules/buylist/buylist.service.ts': ['BUY_PREMIUM_FLOOR_POLICY', 'BUY_PREMIUM_FLOOR_POLICY'],
      'modules/pricing/variant-pricing.ts': ['BUY_PREMIUM_FLOOR_POLICY', 'salePremiumFloorPolicy'],
      'modules/pricing/pricing.service.ts': ['input.premiumFloorPolicy'],
    });
  });

  it('dentro de `pricing-curve.ts`, `resolvePendingReason` delega en el guardarraíl con SU `policy`', () => {
    const code = stripComments(readFileSync(join(SRC, 'common/pricing-curve.ts'), 'utf8'));
    expect(nthArgs(code, 'premiumFloorGuard', 2)).toEqual(['policy']);
  });

  it('⛔ ningún fichero de VENTA construye una política literal `{ mode: … }`', () => {
    const SALE = [
      'modules/pricing/pricing.service.ts',
      'modules/pricing/variant-pricing.ts',
      'modules/pricing/variant-controls.service.ts',
      'modules/pricing/admin-bounties.service.ts',
      'modules/pricing/price-ingest.service.ts',
      'modules/catalog/catalog.service.ts',
      'modules/orders/orders.service.ts',
      'modules/orders/guest-checkout.service.ts',
      'modules/inventory/inventory.service.ts',
      'modules/inventory/master-set.service.ts',
      'jobs/price-sync.service.ts',
    ];
    for (const f of SALE) {
      const code = stripComments(readFileSync(join(SRC, f), 'utf8'));
      expect({ f, literal: /\{\s*mode\s*:/.test(code) }).toEqual({ f, literal: false });
    }
  });

  it('⛔ ningún fichero de COMPRA lee el dial; el loader lo llaman SOLO los lectores de VENTA', () => {
    for (const f of walkSources(join(SRC, 'modules/buylist'))) {
      const code = stripComments(readFileSync(f, 'utf8'));
      expect({ f: rel(f), lee: /loadSalePremiumFloorPolicy|PREMIUM_FLOOR_SALE_PUBLISH|premium_floor_sale_publish/.test(code) }).toEqual({
        f: rel(f),
        lee: false,
      });
    }
    expect(identCensus(SRC, /\bloadSalePremiumFloorPolicy\b/g)).toEqual({
      'jobs/price-sync.service.ts': 1,
      'modules/catalog/catalog.service.ts': 2,
      'modules/inventory/inventory.service.ts': 4,
      'modules/inventory/master-set.service.ts': 2,
      'modules/pricing/admin-bounties.service.ts': 1,
      'modules/pricing/price-ingest.service.ts': 1,
      'modules/pricing/pricing.service.ts': 2,
      'modules/pricing/variant-controls.service.ts': 1,
      // rev v1.87⟨wishlist⟩ (§WSH.3 `normalDisplay`): el precio NORMAL de la lista de compra sale de `decideSalePrice` —
      // un lector de VENTA (mismo veredicto que publicaría la pieza), no de compra.
      'modules/wishlist/wishlist-market.service.ts': 1,
    });
  });

  it('🐤 canario: el extractor VE un literal y un llamador nuevo', () => {
    const canary = `resolvePendingReason(price.basis, input.rarityCanonical, { mode: 'all', rarities: [] });`;
    expect(nthArgs(canary, 'resolvePendingReason', 2)).toEqual(["{ mode: 'all', rarities: [] }"]);
    expect(/\{\s*mode\s*:/.test(canary)).toBe(true);
    expect(nthArgs('premiumFloorGuard(r, b);', 'premiumFloorGuard', 2)).toEqual(['<ausente>']);
  });
});
