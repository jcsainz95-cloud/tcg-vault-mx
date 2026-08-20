import {
  StructuralFinishResolverService,
  normalizeCardNumber,
  normalizeName,
} from '../src/modules/catalog/structural-finish-resolver.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { FinishReconciler } from '../src/modules/catalog/finish-reconciler.service';
import { TcgcsvCatalogClient } from '../src/modules/pricing/providers/tcgcsv-singles.provider';
import {
  TcgcsvSingleProductRef,
  TcgcsvPriceRow,
  TcgcsvGroupRef,
} from '../src/modules/pricing/pricing.types';

/**
 * v1.26 (ARCHITECTURE §4.24a pasos 1-5) — el resolver estructural: resuelve groupId (S-D3 numérico
 * o match por nombre), UNE subTypeName por número de carta, JOINEA a la Card local (ancla
 * tcgplayerId, fallback número ÚNICO), REEMPLAZA `structuralFinishes` SOLO de las joineadas
 * (money-safe) y llama a `FinishReconciler.reconcile`. Sin red: los fetch se mockean.
 */

// Surging Sparks sv8 (subconjunto): Pikachu ex (Holofoil), Alolan Exeggutor ex (Reverse Holofoil).
const PRODUCTS: TcgcsvSingleProductRef[] = [
  { productId: 593245, name: 'Pikachu ex - 057/191', number: '057/191' },
  { productId: 593301, name: 'Alolan Exeggutor ex - 167/191', number: '167/191' },
  { productId: 610894, name: 'Booster Box', number: null }, // sellado: sin Number
];
const PRICES: TcgcsvPriceRow[] = [
  { productId: 593245, subTypeName: 'Holofoil', marketPrice: 2.31 },
  { productId: 593301, subTypeName: 'Reverse Holofoil', marketPrice: 0.17 },
  { productId: 610894, subTypeName: 'Normal', marketPrice: 238.5 }, // sellado: no aporta a carta
];

function clientMock(
  over: Partial<{
    products: TcgcsvSingleProductRef[];
    prices: TcgcsvPriceRow[];
    groups: TcgcsvGroupRef[];
  }> = {},
): TcgcsvCatalogClient {
  return {
    getProducts: jest.fn(async () => over.products ?? PRODUCTS),
    getPrices: jest.fn(async () => over.prices ?? PRICES),
    listGroups: jest.fn(async () => over.groups ?? []),
  } as unknown as TcgcsvCatalogClient;
}

function prismaMock(
  set: { id: string; name: string; pptSetId: string | null },
  localCards: { id: string; number: string; tcgplayerId: string | null }[],
) {
  const updates: any[] = [];
  const prisma = {
    cardSet: { findUnique: jest.fn(async () => set) },
    card: {
      findMany: jest.fn(async () => localCards),
      update: jest.fn(async (args: any) => {
        updates.push(args);
        return {};
      }),
    },
  } as unknown as PrismaService;
  return { prisma, updates };
}

describe('StructuralFinishResolverService.resolveStructuralFinishesForSet (§4.24a)', () => {
  it('pptSetId numérico == groupId (S-D3); JOIN por ancla tcgplayerId y por número; escribe solo joineadas + reconcile', async () => {
    const { prisma, updates } = prismaMock(
      { id: 'local-sv8', name: 'Surging Sparks', pptSetId: '23821' },
      [
        { id: 'c-pika', number: '57', tcgplayerId: '593245' }, // ancla por tcgplayerId
        { id: 'c-alolan', number: '167', tcgplayerId: null }, // fallback por número ("167/191"→"167")
        { id: 'c-orphan', number: '999', tcgplayerId: null }, // no está en TCGCSV ⇒ NO se toca
      ],
    );
    const client = clientMock();
    const reconcile = jest.fn(async () => 0);
    const reconciler = { reconcile } as unknown as FinishReconciler;
    const svc = new StructuralFinishResolverService(prisma, client, reconciler);

    const res = await svc.resolveStructuralFinishesForSet('local-sv8');

    expect((client.getProducts as jest.Mock)).toHaveBeenCalledWith(23821);
    // Pikachu ex ⇒ [holofoil] (sin normal fantasma); Alolan ⇒ [reverse_holo].
    const byId = new Map(updates.map((u) => [u.where.id, u.data.structuralFinishes]));
    expect(byId.get('c-pika')).toEqual(['holofoil']);
    expect(byId.get('c-alolan')).toEqual(['reverse_holo']);
    // La carta huérfana NO se tocó (money-safe: conserva su valor previo).
    expect(byId.has('c-orphan')).toBe(false);
    // Reconcile SOLO de las joineadas.
    expect(reconcile).toHaveBeenCalledWith(['c-pika', 'c-alolan']);
    expect(res).toMatchObject({ groupId: 23821, joined: 2, updated: 2, unjoined: 0 });
  });

  it('pptSetId NO numérico ⇒ resuelve groupId por match ÚNICO de nombre vía listGroups()', async () => {
    const { prisma, updates } = prismaMock(
      { id: 'local-sv8', name: 'Surging Sparks', pptSetId: 'sv-surging-sparks' },
      [{ id: 'c-pika', number: '57', tcgplayerId: '593245' }],
    );
    const client = clientMock({
      groups: [
        { groupId: 23821, name: 'SV08: Surging Sparks' },
        { groupId: 23651, name: 'SV07: Stellar Crown' },
      ],
    });
    const reconciler = { reconcile: jest.fn(async () => 0) } as unknown as FinishReconciler;
    const svc = new StructuralFinishResolverService(prisma, client, reconciler);

    const res = await svc.resolveStructuralFinishesForSet('local-sv8');

    expect((client.listGroups as jest.Mock)).toHaveBeenCalled();
    expect((client.getProducts as jest.Mock)).toHaveBeenCalledWith(23821);
    expect(res?.groupId).toBe(23821);
    expect(updates.find((u) => u.where.id === 'c-pika')?.data.structuralFinishes).toEqual(['holofoil']);
  });

  it('TECHLEAD #2: match EXACTO de nombre gana sobre un superset por substring ("Base" vs "Base Set 2")', async () => {
    const { prisma, updates } = prismaMock(
      { id: 'local-base', name: 'Base', pptSetId: 'base' },
      [{ id: 'c-pika', number: '57', tcgplayerId: '593245' }],
    );
    // "Base" es substring de "Base Set 2"; el loose bidireccional habría dado 2 candidatos ⇒ null.
    // Con igualdad exacta preferida, gana el groupId 10 ("Base") y NO es ambiguo.
    const client = clientMock({
      groups: [
        { groupId: 10, name: 'Base' },
        { groupId: 11, name: 'Base Set 2' },
      ],
    });
    const reconciler = { reconcile: jest.fn(async () => 0) } as unknown as FinishReconciler;
    const svc = new StructuralFinishResolverService(prisma, client, reconciler);

    const res = await svc.resolveStructuralFinishesForSet('local-base');

    expect((client.getProducts as jest.Mock)).toHaveBeenCalledWith(10);
    expect(res?.groupId).toBe(10);
    expect(updates.find((u) => u.where.id === 'c-pika')?.data.structuralFinishes).toEqual(['holofoil']);
  });

  it('TECHLEAD #2: substring ambiguo (sin match exacto) sigue ⇒ null, NO escribe (money-safe)', async () => {
    const { prisma, updates } = prismaMock(
      { id: 'local-base', name: 'Base', pptSetId: 'base' },
      [{ id: 'c-pika', number: '57', tcgplayerId: '593245' }],
    );
    // Ningún nombre es exactamente "base"; dos supersets contienen "base" ⇒ ambiguo ⇒ null.
    const client = clientMock({
      groups: [
        { groupId: 10, name: 'Base Set' },
        { groupId: 11, name: 'Base Set 2' },
      ],
    });
    const reconcile = jest.fn(async () => 0);
    const reconciler = { reconcile } as unknown as FinishReconciler;
    const svc = new StructuralFinishResolverService(prisma, client, reconciler);

    const res = await svc.resolveStructuralFinishesForSet('local-base');

    expect(res).toBeNull();
    expect((prisma as any).card.update).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
    expect(reconcile).not.toHaveBeenCalled();
  });

  it('money-safe: sin match ÚNICO de groupId ⇒ devuelve null, NO toca ninguna carta ni reconcilia', async () => {
    const { prisma, updates } = prismaMock(
      { id: 'local-x', name: 'Ambiguous Set', pptSetId: null },
      [{ id: 'c-1', number: '1', tcgplayerId: null }],
    );
    // Dos grupos empatan por nombre ⇒ ambiguo ⇒ no se resuelve (conservador).
    const client = clientMock({
      groups: [
        { groupId: 1, name: 'Ambiguous Set A' },
        { groupId: 2, name: 'Ambiguous Set B' },
      ],
    });
    const reconcile = jest.fn(async () => 0);
    const reconciler = { reconcile } as unknown as FinishReconciler;
    const svc = new StructuralFinishResolverService(prisma, client, reconciler);

    const res = await svc.resolveStructuralFinishesForSet('local-x');

    expect(res).toBeNull();
    expect((prisma as any).card.update).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
    expect(reconcile).not.toHaveBeenCalled();
  });
});

describe('normalizeCardNumber / normalizeName (helpers del join)', () => {
  it('normalizeCardNumber colapsa "057/191"→"57" y conserva prefijos ("TG12")', () => {
    expect(normalizeCardNumber('057/191')).toBe('57');
    expect(normalizeCardNumber('57')).toBe('57');
    expect(normalizeCardNumber('057')).toBe('57');
    expect(normalizeCardNumber('TG12')).toBe('TG12');
  });
  it('normalizeName deja solo alfanuméricos en minúsculas', () => {
    expect(normalizeName('SV08: Surging Sparks')).toBe('sv08surgingsparks');
    expect(normalizeName('Surging Sparks')).toBe('surgingsparks');
  });
});
