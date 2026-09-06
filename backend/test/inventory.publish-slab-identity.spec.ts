import { InventoryService } from '../src/modules/inventory/inventory.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { FxService } from '../src/modules/pricing/fx.service';
import { PokemonTcgIoProvider } from '../src/modules/pricing/providers/pokemontcg-io.provider';
import {
  PokeTraceProvider,
  PokemonPriceTrackerProvider,
} from '../src/modules/pricing/providers/graded-sealed.providers';
import { BulkPublishRequest } from '../src/modules/inventory/dto/inventory.dto';
import { DEFAULT_PRICING_CURVE } from '../src/common/pricing-curve';

/**
 * v1.53-b (M-1, enrutado por el gate) — **publicar un slab exige saber QUÉ GRADO ES.**
 *
 * ### La raíz, y por qué el precio manual la hacía alcanzable
 * `assertPublishableGuards` exigía `certNumber` para publicar una graduada, pero **no**
 * `gradingCompany`/`gradeValue`. La identidad sí se comprobaba... en `resolvePublishSalePrice`,
 * **después** de su primera línea:
 * ```ts
 * const manual = firstPresentAmount(lineListPriceCents, item.listPriceCents);
 * if (manual != null) return { ok: true, salePriceCents: manual, priceSource: 'manual' };
 * ```
 * Con un `listPriceCents` manual (de la línea o de la pieza) el flujo **retornaba antes** de llegar a
 * la comprobación de identidad, así que una graduada con `gradingCompany`/`gradeValue` nulos —las que
 * crea `convertToInventory`, §9 D-BG-3— **se publicaba**: quedaba `listed`, `sellable`, comprable por
 * `inventoryItemId`, y sin `gradeKey` que emitir. Esa es la raíz del hallazgo I-2 en
 * `catalog.buildGroups`.
 *
 * ### Lo que NO era
 * **No era una fuga de dinero.** El monto publicado es el override EXPLÍCITO del admin, no una
 * referencia de `graded:PSA:10` inventada — el defecto de v1.52 que §4.40.4 ya cerró. Lo que se
 * publicaba era una pieza **cuya identidad el sistema no conoce**, en un marketplace donde el grado
 * *es* el producto.
 *
 * ### La forma del arreglo
 * La misma que el `certNumber` que ya vivía al lado: `422 VALIDATION_ERROR`, **por línea**, sin
 * tumbar las demás del lote. `createItem` ya exigía los tres campos para `graded`
 * (`validateProductShape`, API_CONTRACT §M1 alta); esto cierra la misma invariante en la otra puerta.
 */

function buildHarness() {
  const items: any[] = [];

  const prisma: any = {
    inventoryItem: {
      findMany: jest.fn(async ({ where }: any) =>
        where?.id?.in ? items.filter((i) => where.id.in.includes(i.id)) : items,
      ),
      count: jest.fn(async () => items.length),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const it = items.find((i) => i.id === where.id);
        if (it && where.status.in.includes(it.status)) {
          Object.assign(it, data);
          return { count: 1 };
        }
        return { count: 0 };
      }),
    },
    inventoryBatch: { findUnique: jest.fn(async () => null), create: jest.fn() },
    variantPriceOverride: { findMany: jest.fn(async () => []) },
    priceReference: {
      findFirst: jest.fn(async () => null),
      create: jest.fn(async () => ({ id: 'ref-1' })),
      update: jest.fn(async () => ({ id: 'ref-1' })),
      upsert: jest.fn(async () => ({ id: 'ref-1' })),
    },
    pendingPriceEntry: {
      findFirst: jest.fn(async () => null),
      create: jest.fn(async ({ data }: any) => ({ id: 'pend-1', ...data })),
      updateMany: jest.fn(async () => ({ count: 0 })),
      findMany: jest.fn(async () => []),
    },
  };

  const settings = { getNumber: jest.fn(async () => 70) } as unknown as SettingsService;

  const pricing = new PricingService(
    prisma as PrismaService,
    settings,
    {} as FxService,
    {} as PokemonTcgIoProvider,
    {} as PokemonPriceTrackerProvider,
    {} as PokeTraceProvider,
  );
  jest.spyOn(pricing, 'loadPricingCurve').mockResolvedValue(DEFAULT_PRICING_CURVE);
  jest.spyOn(pricing, 'loadSealedSpreads').mockResolvedValue({
    spreadPctBySubtype: {},
    fallbackPct: 25,
    sourceOn: false,
  } as any);
  jest.spyOn(pricing, 'getReferencesBatch').mockResolvedValue(new Map());
  jest.spyOn(pricing, 'getVariantOverridesBatch').mockResolvedValue(new Map());

  const svc = new InventoryService(prisma as PrismaService, pricing, settings);
  return { svc, prisma, items };
}

/** Graduada LEGACY: cert sí (el único requisito de antes), identidad de slab NO. */
const gradedSinIdentidad = (over: any = {}) => ({
  id: 'g-legacy',
  folio: 'INV-000001',
  cardId: 'c1',
  productType: 'graded',
  finish: 'normal',
  gradingCompany: null,
  gradeValue: null,
  certNumber: '12345678',
  ownerType: 'platform',
  status: 'in_stock',
  listPriceCents: null,
  tcgplayerProductId: null,
  card: { rarity: 'Illustration Rare', rarityCanonical: 'illustration_rare' },
  ...over,
});

/** La misma pieza, bien capturada: el control de que la guarda no rompe lo legítimo. */
const gradedCompleta = (over: any = {}) =>
  gradedSinIdentidad({
    id: 'g-ok',
    folio: 'INV-000002',
    gradingCompany: 'PSA',
    gradeValue: '9',
    certNumber: '87654321',
    ...over,
  });

const publish = (id: string, listPriceCents?: number): BulkPublishRequest => ({
  items: [{ inventoryItemId: id, ...(listPriceCents != null ? { listPriceCents } : {}) }],
});

describe('M-1 — `bulkPublish` rechaza la graduada sin identidad de slab', () => {
  it('EL CASO QUE ANTES PUBLICABA: precio manual en la PIEZA ⇒ 422 y NO se lista', async () => {
    const h = buildHarness();
    h.items.push(gradedSinIdentidad({ listPriceCents: 500_000 }));

    const res = await h.svc.bulkPublish(publish('g-legacy'), 'admin');

    expect(res.results[0]).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect((res.results[0] as any).error.message).toMatch(/gradingCompany and gradeValue/);
    expect(res.summary.published).toBe(0);
    // Money/estado: el status de ORIGEN queda intacto — la pieza NO llegó a `listed`.
    expect(h.items[0].status).toBe('in_stock');
  });

  it('mismo rechazo con el precio manual en la LÍNEA (el otro peldaño de la precedencia)', async () => {
    const h = buildHarness();
    h.items.push(gradedSinIdentidad());

    const res = await h.svc.bulkPublish(publish('g-legacy', 500_000), 'admin');

    expect(res.results[0]).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(h.items[0].status).toBe('in_stock');
  });

  it('sin precio manual también: la guarda corre ANTES del resolver de precio', async () => {
    const h = buildHarness();
    h.items.push(gradedSinIdentidad());

    const res = await h.svc.bulkPublish(publish('g-legacy'), 'admin');

    // Antes esta ruta ya rechazaba, pero como `PRICE_PENDING` desde el resolver. Ahora el rechazo es
    // el de IDENTIDAD, que nombra lo que de verdad falta: no es que no haya precio, es que no se
    // sabe qué slab es. Y no escala a la cola (la cola es por VARIANTE y aquí no hay variante).
    expect(res.results[0]).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect((res.results[0] as any).pendingPriceEntryId).toBeUndefined();
    expect(h.items[0].status).toBe('in_stock');
  });

  it('empresa presente pero grado vacío (`\'\'` / `\'   \'`) es AUSENCIA, no una identidad rara', async () => {
    for (const bad of ['', '   ']) {
      const h = buildHarness();
      h.items.push(
        gradedSinIdentidad({ gradingCompany: 'PSA', gradeValue: bad, listPriceCents: 500_000 }),
      );
      const res = await h.svc.bulkPublish(publish('g-legacy'), 'admin');
      expect(res.results[0]).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
      expect(h.items[0].status).toBe('in_stock');
    }
  });

  it('NO REGRESIÓN: la graduada con identidad COMPLETA y precio manual se publica igual que antes', async () => {
    const h = buildHarness();
    h.items.push(gradedCompleta({ listPriceCents: 300_000 }));

    const res = await h.svc.bulkPublish(publish('g-ok'), 'admin');

    expect(res.results[0]).toMatchObject({
      ok: true,
      status: 'listed',
      salePriceCents: 300_000,
      priceSource: 'manual',
    });
    expect(res.summary.published).toBe(1);
    expect(h.items[0].status).toBe('listed');
  });

  it('degradación POR LÍNEA: la pieza mala no se lleva por delante a la buena del mismo lote', async () => {
    const h = buildHarness();
    h.items.push(gradedSinIdentidad({ listPriceCents: 500_000 }), gradedCompleta({ listPriceCents: 300_000 }));

    const res = await h.svc.bulkPublish(
      { items: [{ inventoryItemId: 'g-legacy' }, { inventoryItemId: 'g-ok' }] },
      'admin',
    );

    expect(res.summary).toMatchObject({ requested: 2, published: 1, failedLines: 1 });
    expect(res.results[0]).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(res.results[1]).toMatchObject({ ok: true, status: 'listed' });
  });
});

describe('M-1 — `publishAll` comparte la MISMA guarda (pipeline idéntico, §4.26c)', () => {
  it('la graduada sin identidad tampoco entra por la puerta de «publicar todo»', async () => {
    const h = buildHarness();
    h.items.push(gradedSinIdentidad({ listPriceCents: 500_000 }), gradedCompleta({ listPriceCents: 300_000 }));

    const res = await h.svc.publishAll({}, 'admin');

    expect(res.summary.published).toBe(1);
    expect(h.items.find((i) => i.id === 'g-legacy').status).toBe('in_stock');
    expect(h.items.find((i) => i.id === 'g-ok').status).toBe('listed');
  });
});
