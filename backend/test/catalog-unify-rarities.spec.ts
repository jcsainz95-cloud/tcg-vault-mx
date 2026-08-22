import { CatalogSyncService } from '../src/modules/catalog/catalog-sync.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PokemonTcgIoClient } from '../src/modules/catalog/pokemontcg-io.client';
import { SettingsService } from '../src/modules/settings/settings.service';

/**
 * unify-rarities (fix/variant-composition-regression) — `CatalogSyncService.unifyRarities`: backfill
 * LOCAL de `Card.rarityCanonical = normalizeRarity(rarity)`. Repara la regresión M-31 (sembró
 * `rarityCanonical = rarity` CRUDO) que fragmentaba el editor de reglas.
 *
 * Estos tests fijan:
 *  1. rareza cruda ("rare holo") ⇒ `rarityCanonical` canónico ("Rare Holo"); solo escribe donde difiere;
 *  2. idempotencia: si todo ya está canónico, 0 updates y CERO writes;
 *  3. una rareza sin entrada en el catálogo aparece en `unmapped`;
 *  4. money-safe: NUNCA llama a pokemontcg.io y NO toca PriceReference/precios (solo card.updateMany
 *     de la columna rarityCanonical).
 */

const settings = (): SettingsService =>
  ({ getString: jest.fn(async () => '2024/01/01') } as unknown as SettingsService);
const reconciler = () => ({ reconcile: jest.fn(async () => 0) });

/** Cliente pokemontcg.io espiado: los tests verifican que NO se invoca (backfill 100% local). */
function pokemonClientSpy(): PokemonTcgIoClient {
  return {
    getSets: jest.fn(async () => []),
    getCardsBySet: jest.fn(async () => ({ data: [], page: 1, pageSize: 250, count: 0, totalCount: 0 })),
  } as unknown as PokemonTcgIoClient;
}

/**
 * Prisma mínimo: `card.groupBy` devuelve el estado (rareza cruda, canónico vigente) + conteo, y
 * `card.updateMany` es un espía (jamás debe tocar priceReference — que no existe en este mock).
 */
function prismaMock(groups: Array<{ rarity: string | null; rarityCanonical: string | null; count: number }>) {
  const updateMany = jest.fn(async (_args: { where: unknown; data: Record<string, unknown> }) => ({
    count: 0,
  }));
  const groupBy = jest.fn(async () =>
    groups.map((g) => ({ rarity: g.rarity, rarityCanonical: g.rarityCanonical, _count: { _all: g.count } })),
  );
  const prisma = { card: { groupBy, updateMany } } as unknown as PrismaService;
  return { prisma, updateMany, groupBy };
}

function build(groups: Parameters<typeof prismaMock>[0]) {
  const { prisma, updateMany, groupBy } = prismaMock(groups);
  const client = pokemonClientSpy();
  const svc = new CatalogSyncService(prisma, client, settings(), reconciler() as any);
  return { svc, client, updateMany, groupBy };
}

describe('CatalogSyncService.unifyRarities — backfill LOCAL money-safe', () => {
  it('normaliza rareza cruda a canónica y escribe SOLO donde difiere', async () => {
    const { svc, updateMany } = build([
      { rarity: 'rare holo', rarityCanonical: 'rare holo', count: 3 }, // crudo → "Rare Holo"
      { rarity: 'Common', rarityCanonical: 'Common', count: 5 }, // ya canónico → no toca
    ]);
    const res = await svc.unifyRarities();

    expect(res.ok).toBe(true);
    expect(res.cardsProcessed).toBe(8);
    expect(res.cardsUpdated).toBe(3); // solo las 3 de "rare holo"
    // Un único updateMany, para la rareza cruda divergente, hacia el canónico correcto.
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: { rarity: 'rare holo', NOT: { rarityCanonical: 'Rare Holo' } },
      data: { rarityCanonical: 'Rare Holo' },
    });
  });

  it('idempotente: si todo ya está canónico, 0 updates y CERO writes', async () => {
    const { svc, updateMany } = build([
      { rarity: 'Rare Holo', rarityCanonical: 'Rare Holo', count: 3 },
      { rarity: 'Common', rarityCanonical: 'Common', count: 5 },
    ]);
    const res = await svc.unifyRarities();

    expect(res.cardsUpdated).toBe(0);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('una rareza fuera del catálogo canónico aparece en `unmapped`', async () => {
    const { svc } = build([
      { rarity: 'Galaxy Foil', rarityCanonical: 'Galaxy Foil', count: 2 }, // no está en CANONICAL_RARITIES
      { rarity: 'Common', rarityCanonical: 'Common', count: 5 },
    ]);
    const res = await svc.unifyRarities();

    expect(res.unmapped).toEqual([{ raw: 'Galaxy Foil', canonical: 'Galaxy Foil', count: 2 }]);
    // "Common" SÍ está mapeada → no aparece en unmapped.
    expect(res.unmapped.some((u) => u.raw === 'Common')).toBe(false);
  });

  it('money-safe: NO llama a pokemontcg.io y solo escribe card.rarityCanonical (nunca PriceReference)', async () => {
    const { svc, client, updateMany } = build([
      { rarity: 'rare holo', rarityCanonical: 'rare holo', count: 1 },
    ]);
    await svc.unifyRarities();

    expect((client as any).getSets).not.toHaveBeenCalled();
    expect((client as any).getCardsBySet).not.toHaveBeenCalled();
    // Toda escritura fue sobre card.updateMany con SOLO la columna rarityCanonical en `data`.
    for (const call of updateMany.mock.calls) {
      expect(Object.keys(call[0].data)).toEqual(['rarityCanonical']);
    }
  });

  it('distinctCanonical cuenta las canónicas distintas resultantes', async () => {
    const { svc } = build([
      { rarity: 'rare holo', rarityCanonical: null, count: 1 }, // → Rare Holo
      { rarity: 'RARE HOLO', rarityCanonical: null, count: 1 }, // → Rare Holo (misma canónica)
      { rarity: 'Common', rarityCanonical: null, count: 1 }, // → Common
    ]);
    const res = await svc.unifyRarities();

    expect(res.distinctCanonical).toBe(2); // { Rare Holo, Common }
    expect(res.cardsUpdated).toBe(3); // los tres tenían rarityCanonical=null
  });
});
