import { PricingController } from '../src/modules/pricing/pricing.controller';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { FxService } from '../src/modules/pricing/fx.service';
import { PriceSyncJobService } from '../src/jobs/price-sync.service';

/**
 * E7 (ARCHITECTURE §4.36.8 · API_CONTRACT §M2) — RETIRO DEL EDITOR VIEJO y RE-PROPÓSITO de
 * `GET /admin/pricing/rarities` (criterio 96, «sin residuos»).
 *
 * La rareza SALIÓ del pricing: no hay tabla por rareza, ni mapa rareza→tier, ni reglas por acabado,
 * así que no queda nada que EDITAR por rareza. Lo que sí queda —y es lo que este endpoint sirve
 * ahora— es la SALUD DEL CATÁLOGO DE RAREZAS QUE RESPALDA EL GUARDARRAÍL (§4.36.5): qué rarezas
 * existen, cuáles son `premium` y cuántas cartas hay de cada una.
 */
function build(grouped: unknown[] = []) {
  const settings = {
    getRaw: jest.fn(async () => null),
    getNumber: jest.fn(async () => 0),
  } as unknown as SettingsService;
  const prisma = {
    configSetting: { upsert: jest.fn(async () => ({})) },
    card: { groupBy: jest.fn(async () => grouped) },
  } as unknown as PrismaService;
  const audit = { log: jest.fn(async () => undefined) } as unknown as AuditService;
  const controller = new PricingController(
    {} as PricingService,
    {} as FxService,
    settings,
    audit,
    prisma,
    {} as PriceSyncJobService,
    {} as never,
    {} as never,
  );
  return { controller, prisma };
}

describe('GET /admin/pricing/rarities — salud del catálogo que respalda el guardarraíl', () => {
  it('agrupa por rarityCanonical, marca `premium` y ordena por cardCount desc', async () => {
    const { controller } = build([
      { rarityCanonical: 'Illustration Rare', rarity: 'Illustration Rare', _count: { _all: 87 } },
      { rarityCanonical: 'Common', rarity: 'Common', _count: { _all: 1234 } },
      { rarityCanonical: 'Rare', rarity: 'Rare', _count: { _all: 300 } },
      // Cartas sin rareza canónica no producen fila (no hay nada que reportar).
      { rarityCanonical: null, rarity: null, _count: { _all: 5 } },
    ]);
    const res = await controller.rarities();
    expect(res.rarities).toEqual([
      { canonical: 'Common', raw: 'Common', premium: false, mapped: true, cardCount: 1234 },
      { canonical: 'Rare', raw: 'Rare', premium: false, mapped: true, cardCount: 300 },
      { canonical: 'Illustration Rare', raw: 'Illustration Rare', premium: true, mapped: true, cardCount: 87 },
    ]);
  });

  it('suma los conteos de varias formas CRUDAS que colapsan a la misma canónica', async () => {
    const { controller } = build([
      { rarityCanonical: 'Hyper Rare', rarity: 'Hyper Rare', _count: { _all: 10 } },
      { rarityCanonical: 'Hyper Rare', rarity: 'Rare Rainbow', _count: { _all: 4 } },
    ]);
    const res = await controller.rarities();
    expect(res.rarities).toEqual([
      { canonical: 'Hyper Rare', raw: 'Hyper Rare', premium: true, mapped: true, cardCount: 14 },
    ]);
  });

  it('RETIRA `rule`, `tierId`, `source`, `fallbackPct` y el alias deprecado `rarity`', async () => {
    const { controller } = build([{ rarityCanonical: 'Common', rarity: 'Common', _count: { _all: 3 } }]);
    const res = (await controller.rarities()) as Record<string, unknown> & {
      rarities: Record<string, unknown>[];
    };
    expect(res.fallbackPct).toBeUndefined();
    for (const k of ['rule', 'tierId', 'source', 'rarity']) {
      expect(res.rarities[0]).not.toHaveProperty(k);
    }
  });
});

describe('criterio 96 — los endpoints del editor viejo YA NO EXISTEN', () => {
  it.each([
    'getTiers',
    'putTiers',
    'getTierMap',
    'putTierMap',
    'getBuylistRules',
    'putBuylistRules',
    'getSalesRules',
    'putSalesRules',
    'salesRarities',
  ])('%s se retiró del controller', (method) => {
    const { controller } = build();
    expect((controller as unknown as Record<string, unknown>)[method]).toBeUndefined();
  });

  it('el editor de precios es ahora la TABLA DE PUNTOS (curve + preview)', () => {
    const { controller } = build();
    expect(typeof controller.getCurve).toBe('function');
    expect(typeof controller.putCurve).toBe('function');
    expect(typeof controller.previewCurve).toBe('function');
  });
});
