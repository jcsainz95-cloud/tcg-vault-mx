import { PricingService } from '../src/modules/pricing/pricing.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { FxService } from '../src/modules/pricing/fx.service';
import { PokemonTcgIoProvider } from '../src/modules/pricing/providers/pokemontcg-io.provider';
import {
  PokeTraceProvider,
  PokemonPriceTrackerProvider,
} from '../src/modules/pricing/providers/graded-sealed.providers';

/**
 * v1.28 (P-18/M-30, §4.26b) — `getVariantOverridesBatch`: los controles por variante se leen EN
 * LOTE (UNA query por request, patrón getReferencesBatch) y el mapa se keyea EXACTAMENTE por la
 * clave única de la tabla (`cardId|productType|gradeKey|finish`). Clave ausente = sin fila =
 * comportamiento previo. `getVariantOverride` (single) delega en el batch.
 */

function rowOf(over: Record<string, unknown>) {
  return {
    id: 'vpo-x',
    cardId: 'c1',
    productType: 'raw',
    gradeKey: 'raw:NM',
    finish: 'normal',
    sellOverrideCents: null,
    buyOverrideCents: null,
    bountyEnabled: false,
    bountyPriceCents: null,
    bountyTargetQty: null,
    bountyAcquiredQty: 0,
    bountyCompletedAt: null,
    ...over,
  };
}

function build(rows: ReturnType<typeof rowOf>[]) {
  const findMany: jest.Mock = jest.fn(async (_args: { where: Record<string, { in: string[] }> }) => rows);
  const prisma = { variantPriceOverride: { findMany } } as unknown as PrismaService;
  const pricing = new PricingService(
    prisma,
    {} as SettingsService,
    {} as FxService,
    {} as PokemonTcgIoProvider,
    {} as PokemonPriceTrackerProvider,
    {} as PokeTraceProvider,
  );
  return { pricing, findMany };
}

describe('PricingService.getVariantOverridesBatch (M-30)', () => {
  it('UNA query con filtros IN deduplicados; mapa keyeado por la clave única', async () => {
    const rows = [
      rowOf({ id: 'a', finish: 'normal', buyOverrideCents: 300 }),
      rowOf({ id: 'b', finish: 'reverse_holo', sellOverrideCents: 9900 }),
    ];
    const { pricing, findMany } = build(rows);
    const map = await pricing.getVariantOverridesBatch([
      { cardId: 'c1', productType: 'raw', gradeKey: 'raw:NM', finish: 'normal' },
      { cardId: 'c1', productType: 'raw', gradeKey: 'raw:NM', finish: 'reverse_holo' },
      { cardId: 'c1', productType: 'raw', gradeKey: 'raw:NM', finish: 'normal' }, // duplicada
    ]);
    expect(findMany).toHaveBeenCalledTimes(1);
    const where = findMany.mock.calls[0][0].where;
    expect(where.cardId.in).toEqual(['c1']);
    expect(where.finish.in).toEqual(['normal', 'reverse_holo']);
    expect(map.get('c1|raw|raw:NM|normal')).toMatchObject({ id: 'a', buyOverrideCents: 300 });
    expect(map.get('c1|raw|raw:NM|reverse_holo')).toMatchObject({ id: 'b', sellOverrideCents: 9900 });
  });

  it('el producto cartesiano de los IN NO cuela filas no pedidas (filtro por wanted-set)', async () => {
    // Se piden (c1, normal) y (c2, reverse): el IN traería también (c1, reverse) si existiera.
    const rows = [rowOf({ id: 'spurious', cardId: 'c1', finish: 'reverse_holo' })];
    const { pricing } = build(rows);
    const map = await pricing.getVariantOverridesBatch([
      { cardId: 'c1', productType: 'raw', gradeKey: 'raw:NM', finish: 'normal' },
      { cardId: 'c2', productType: 'raw', gradeKey: 'raw:NM', finish: 'reverse_holo' },
    ]);
    expect(map.size).toBe(0);
  });

  it('lista vacía → Map vacío SIN tocar la BD', async () => {
    const { pricing, findMany } = build([]);
    const map = await pricing.getVariantOverridesBatch([]);
    expect(map.size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('getVariantOverride (single) delega en el batch: fila o null', async () => {
    const { pricing } = build([rowOf({ id: 'a', buyOverrideCents: 300 })]);
    await expect(pricing.getVariantOverride('c1', 'raw', 'raw:NM', 'normal')).resolves.toMatchObject({
      id: 'a',
    });
    await expect(pricing.getVariantOverride('c1', 'raw', 'raw:NM', 'holofoil')).resolves.toBeNull();
  });
});
