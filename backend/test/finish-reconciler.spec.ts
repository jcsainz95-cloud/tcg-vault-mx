import { FinishReconciler } from '../src/modules/catalog/finish-reconciler.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { deriveAvailableFinishesFromProducts } from '../src/common/card-order';
import {
  normalizeVerifiedFinishAlias,
  VERIFIED_FINISH_ALIASES,
  TCG_KEY_TO_FINISH,
} from '../src/modules/pricing/pricing.types';

/**
 * v1.29 (ARCHITECTURE §4.27c) — `Card.availableFinishes` deriva DIRECTO de los `CardProduct` de la
 * carta (sin heurística): la unión de `finishes` de los productos `set_base`/`other`. Los
 * `deck_exclusive`/`promo` NO fusionan sus acabados (son productos vendibles aparte) — así el `normal`
 * fantasma de la energía especial de Pitch Black es imposible por construcción (2 casillas, no 3).
 *
 *   availableFinishes := orderFinishes( ⋃ { p.finishes : p ∈ CardProduct, kind ∈ {set_base, other} } ) || ['normal']
 */

describe('deriveAvailableFinishesFromProducts (§4.27c) — unión de set_base/other, deck_exclusive/promo NO fusionan', () => {
  const P = (kind: string, finishes: string[]) => ({ kind: kind as any, finishes: finishes as any });

  it('el producto de set (holofoil+reverse) + un deck_exclusive (normal) ⇒ [holofoil, reverse_holo] (SIN normal fantasma)', () => {
    // Caso Pitch Black: la energía especial no debe mostrar 3 casillas.
    expect(
      deriveAvailableFinishesFromProducts([
        P('set_base', ['holofoil', 'reverse_holo']),
        P('deck_exclusive', ['normal']),
      ]),
    ).toEqual(['reverse_holo', 'holofoil']);
  });

  it('DOS productos set_base del mismo número SÍ unen sus acabados (normal + reverse_holo legítimos)', () => {
    expect(
      deriveAvailableFinishesFromProducts([P('set_base', ['normal']), P('set_base', ['reverse_holo'])]),
    ).toEqual(['normal', 'reverse_holo']);
  });

  it('un promo NO aporta a la carta de set (queda como producto aparte)', () => {
    expect(
      deriveAvailableFinishesFromProducts([P('set_base', ['holofoil']), P('promo', ['normal'])]),
    ).toEqual(['holofoil']);
  });

  it('`other` SÍ compone (fail-safe: se trata como set_base para el binder)', () => {
    expect(deriveAvailableFinishesFromProducts([P('other', ['normal'])])).toEqual(['normal']);
  });

  it('emite en orden canónico FINISH_ORDER y deduplica; fallback ["normal"] si la unión queda vacía', () => {
    expect(
      deriveAvailableFinishesFromProducts([P('set_base', ['first_edition_holofoil', 'holofoil'])]),
    ).toEqual(['holofoil', 'first_edition_holofoil']);
    // Sin productos de set (solo deck_exclusive) ⇒ unión vacía ⇒ fallback ['normal'].
    expect(deriveAvailableFinishesFromProducts([P('deck_exclusive', ['normal'])])).toEqual(['normal']);
    expect(deriveAvailableFinishesFromProducts([])).toEqual(['normal']);
  });
});

describe('FinishReconciler — ÚNICO escritor de Card.availableFinishes (§4.27c, deriva de CardProduct)', () => {
  function prismaMock(
    cards: Array<{
      id: string;
      availableFinishes: string[];
      cardProducts: Array<{ kind: string; finishes: string[] }>;
    }>,
  ) {
    return {
      card: {
        findMany: jest.fn(async () => cards),
        update: jest.fn(async () => ({})),
      },
    } as unknown as PrismaService;
  }

  it('carta de set con set_base [holofoil, reverse_holo] + deck_exclusive [normal] ⇒ escribe [holofoil, reverse_holo]', async () => {
    const prisma = prismaMock([
      {
        id: 'db-energy',
        availableFinishes: ['normal', 'holofoil', 'reverse_holo'], // valor viejo (con fantasma)
        cardProducts: [
          { kind: 'set_base', finishes: ['holofoil', 'reverse_holo'] },
          { kind: 'deck_exclusive', finishes: ['normal'] },
        ],
      },
    ]);
    const changed = await new FinishReconciler(prisma).reconcile(['db-energy']);
    expect((prisma as any).card.update).toHaveBeenCalledWith({
      where: { id: 'db-energy' },
      data: { availableFinishes: ['reverse_holo', 'holofoil'] },
    });
    expect(changed).toBe(1);
  });

  it('carta SIN CardProduct (legacy no resuelta) ⇒ CONSERVA su availableFinishes previo (no clobbea, money-safe)', async () => {
    const prisma = prismaMock([
      { id: 'db-legacy', availableFinishes: ['normal', 'reverse_holo'], cardProducts: [] },
    ]);
    const changed = await new FinishReconciler(prisma).reconcile(['db-legacy']);
    expect((prisma as any).card.update).not.toHaveBeenCalled();
    expect(changed).toBe(0);
  });

  it('LEE cardProducts: el `select` del findMany incluye cardProducts { kind, finishes }', async () => {
    const findMany = jest.fn(async (_args: any) => [] as any[]);
    const prisma = { card: { findMany, update: jest.fn(async () => ({})) } } as unknown as PrismaService;
    await new FinishReconciler(prisma).reconcile(['db-any']);
    const select = findMany.mock.calls[0][0].select;
    expect(select).toMatchObject({
      id: true,
      availableFinishes: true,
      cardProducts: { select: { kind: true, finishes: true } },
    });
  });

  it('IDEMPOTENTE: si el valor recomputado ya coincide, NO escribe (cero writes)', async () => {
    const prisma = prismaMock([
      {
        id: 'db-x',
        availableFinishes: ['normal', 'reverse_holo'],
        cardProducts: [{ kind: 'set_base', finishes: ['normal', 'reverse_holo'] }],
      },
    ]);
    const changed = await new FinishReconciler(prisma).reconcile(['db-x']);
    expect((prisma as any).card.update).not.toHaveBeenCalled();
    expect(changed).toBe(0);
  });

  it('lista de ids vacía ⇒ no consulta ni escribe (fast-path)', async () => {
    const prisma = prismaMock([]);
    await new FinishReconciler(prisma).reconcile([]);
    expect((prisma as any).card.findMany).not.toHaveBeenCalled();
    expect((prisma as any).card.update).not.toHaveBeenCalled();
  });
});

describe('normalizeVerifiedFinishAlias (§4.22g candado 2) — ESTRICTO, espejo de TCG_KEY_TO_FINISH', () => {
  it('acepta los alias VERIFICADOS (llaves reales de tcgplayer.prices) en cualquier forma', () => {
    expect(normalizeVerifiedFinishAlias('normal')).toBe('normal');
    expect(normalizeVerifiedFinishAlias('holofoil')).toBe('holofoil');
    expect(normalizeVerifiedFinishAlias('reverseHolofoil')).toBe('reverse_holo');
    expect(normalizeVerifiedFinishAlias('Reverse Holofoil')).toBe('reverse_holo');
    expect(normalizeVerifiedFinishAlias('1stEditionHolofoil')).toBe('first_edition_holofoil');
  });

  it('RECHAZA los alias SUPUESTO (foil/holo/reverse/reverseholo) → null (anti-invención)', () => {
    expect(normalizeVerifiedFinishAlias('foil')).toBeNull();
    expect(normalizeVerifiedFinishAlias('holo')).toBeNull();
    expect(normalizeVerifiedFinishAlias('reverse')).toBeNull();
    expect(normalizeVerifiedFinishAlias('Reverse Holo')).toBeNull(); // NO es reverseHolofoil
    expect(normalizeVerifiedFinishAlias('mystery')).toBeNull();
    expect(normalizeVerifiedFinishAlias(undefined)).toBeNull();
    expect(normalizeVerifiedFinishAlias(123)).toBeNull();
  });

  it('es el ESPEJO ESTRICTO de TCG_KEY_TO_FINISH (mismos destinos Finish, llaves normalizadas)', () => {
    const verifiedTargets = new Set(Object.values(VERIFIED_FINISH_ALIASES));
    const tcgTargets = new Set(Object.values(TCG_KEY_TO_FINISH));
    expect([...verifiedTargets].sort()).toEqual([...tcgTargets].sort());
    for (const [rawKey, finish] of Object.entries(TCG_KEY_TO_FINISH)) {
      expect(normalizeVerifiedFinishAlias(rawKey)).toBe(finish);
    }
  });
});
