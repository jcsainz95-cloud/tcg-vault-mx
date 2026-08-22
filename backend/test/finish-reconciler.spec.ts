import { FinishReconciler } from '../src/modules/catalog/finish-reconciler.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { composeAvailableFinishes } from '../src/common/card-order';
import {
  normalizeVerifiedFinishAlias,
  VERIFIED_FINISH_ALIASES,
  TCG_KEY_TO_FINISH,
} from '../src/modules/pricing/pricing.types';

/**
 * v1.27.1 (P-13-fix, ARCHITECTURE §4.25e) — la lista blanca `Card.availableFinishes` deriva de la
 * UNIÓN `structuralFinishes ∪ pricedFinishesSnapshot` MENOS `normal` cuando la rareza es premium
 * (la fórmula «solo structural» de §4.25a-1 causó una regresión en prod: los comunes perdían su
 * reverse y las ex conservaban un `normal` fantasma). Fórmula vigente:
 *
 *   availableFinishes := orderFinishes( (structuralFinishes ∪ pricedFinishesSnapshot)
 *                                       − { normal | isPremiumRarity(rarity) } ) || ['normal']
 *
 * La observabilidad del drift proveedor↔estructura se parte por señal: el acabado del snapshot que
 * SÍ compone (camino feliz, reverse recuperado) va a `debug` (`snapshotRecovered`); solo el que la
 * composición DESCARTA (anómalo, `normal` fantasma en premium) va a `warn` (`pricedNotStructural`).
 * Estas pruebas cubren: (1) la FUNCIÓN PURA (los 6 worked examples de §4.25e con los datos REALES de
 * Pitch Black); (2) el ÚNICO escritor `FinishReconciler` (común recupera reverse del snapshot, ex
 * pierde el `normal` stale, secret rare nunca `normal`, fallback vacío ⇒ `['normal']`, lee rareza y
 * snapshot, idempotencia, observabilidad); (3) el candado del ALIAS VERIFICADO (anti-invención/SEC-A1).
 */

describe('composeAvailableFinishes (§4.25e) — unión ∪ snapshot MENOS normal-si-premium', () => {
  // Los 6 worked examples de §4.25e (tabla, datos reales del set Pitch Black).
  it('#1 Tropius Common: struct=[normal], snap=[normal,reverse_holo] ⇒ [normal, reverse_holo] (recupera el reverse del snapshot)', () => {
    expect(composeAvailableFinishes(['normal'], ['normal', 'reverse_holo'], 'Common')).toEqual([
      'normal',
      'reverse_holo',
    ]);
  });

  it('#2 Grubbin/Fomantis Common: idéntico a Tropius ⇒ [normal, reverse_holo]', () => {
    expect(composeAvailableFinishes(['normal'], ['normal', 'reverse_holo'], 'Common')).toEqual([
      'normal',
      'reverse_holo',
    ]);
  });

  it('#3 Lurantis ex (Double Rare): struct=[normal,holofoil] (stale), snap cualquiera ⇒ [holofoil] (filtra el normal fantasma por rareza)', () => {
    expect(
      composeAvailableFinishes(['normal', 'holofoil'], ['holofoil'], 'Double Rare'),
    ).toEqual(['holofoil']);
    // El snapshot envenenado con `normal` tampoco lo re-introduce (el filtro premium gana).
    expect(
      composeAvailableFinishes(['normal', 'holofoil'], ['normal', 'holofoil'], 'Double Rare'),
    ).toEqual(['holofoil']);
  });

  it('#4 Mega Delphox ex (premium): struct=[normal,holofoil] ⇒ [holofoil]', () => {
    expect(
      composeAvailableFinishes(['normal', 'holofoil'], ['normal', 'holofoil'], 'Double Rare'),
    ).toEqual(['holofoil']);
  });

  it('#5 Energía básica común: struct=[] (o [normal]), snap=[normal] ⇒ [normal] (no premium: conserva la unión)', () => {
    expect(composeAvailableFinishes([], ['normal'], 'Common')).toEqual(['normal']);
    expect(composeAvailableFinishes(['normal'], ['normal'], 'Common')).toEqual(['normal']);
  });

  it('#6 Secret rare holo puro: struct=[holofoil], snap envenenado con normal ⇒ [holofoil] (nunca normal)', () => {
    expect(
      composeAvailableFinishes(['holofoil'], ['normal', 'holofoil'], 'Rare Secret'),
    ).toEqual(['holofoil']);
  });

  it('premium con struct/snap vacíos ⇒ fallback ["normal"] (la resta vació el conjunto)', () => {
    expect(composeAvailableFinishes([], [], 'Double Rare')).toEqual(['normal']);
    // Premium cuyo único dato era `normal`: se filtra ⇒ conjunto vacío ⇒ fallback ["normal"].
    expect(composeAvailableFinishes(['normal'], ['normal'], 'Ultra Rare')).toEqual(['normal']);
  });

  it('emite SIEMPRE en orden canónico FINISH_ORDER y deduplica (no importa el orden de entrada)', () => {
    expect(
      composeAvailableFinishes(['reverse_holo'], ['normal', 'reverse_holo'], 'Common'),
    ).toEqual(['normal', 'reverse_holo']);
    expect(
      composeAvailableFinishes(['first_edition_holofoil', 'holofoil'], ['normal'], 'Common'),
    ).toEqual(['normal', 'holofoil', 'first_edition_holofoil']);
  });

  it('rareza null/desconocida NO filtra normal (fail-safe §4.25e-2): conserva la unión completa', () => {
    expect(composeAvailableFinishes(['normal', 'holofoil'], [], null)).toEqual(['normal', 'holofoil']);
    expect(composeAvailableFinishes(['normal'], ['reverse_holo'], 'Rareza Rara Inventada')).toEqual([
      'normal',
      'reverse_holo',
    ]);
  });

  it('es RECOMPUTABLE (no monótona): quitar un acabado de la entrada lo ELIMINA al recomputar', () => {
    expect(composeAvailableFinishes(['normal', 'reverse_holo'], [], 'Common')).toEqual([
      'normal',
      'reverse_holo',
    ]);
    expect(composeAvailableFinishes(['reverse_holo'], [], 'Common')).toEqual(['reverse_holo']);
  });
});

describe('FinishReconciler — ÚNICO escritor de Card.availableFinishes (§4.25e / §4.22g candado 4)', () => {
  function prismaMock(cards: Array<{ id: string; rarity: string | null; structuralFinishes: string[]; pricedFinishesSnapshot: string[]; availableFinishes: string[] }>) {
    return {
      card: {
        findMany: jest.fn(async () => cards),
        update: jest.fn(async () => ({})),
      },
    } as unknown as PrismaService;
  }

  it('COMÚN recupera su reverse del snapshot: struct=[normal], snap=[normal,reverse_holo], stale=[normal] ⇒ escribe [normal, reverse_holo]', async () => {
    // Regresión de prod (Tropius): el reverse legítimo SOLO vive en el snapshot; la unión lo recupera.
    const prisma = prismaMock([
      { id: 'db-tropius', rarity: 'Common', structuralFinishes: ['normal'], pricedFinishesSnapshot: ['normal', 'reverse_holo'], availableFinishes: ['normal'] },
    ]);
    const changed = await new FinishReconciler(prisma).reconcile(['db-tropius']);
    expect((prisma as any).card.update).toHaveBeenCalledWith({
      where: { id: 'db-tropius' },
      data: { availableFinishes: ['normal', 'reverse_holo'] },
    });
    expect(changed).toBe(1);
  });

  it('EX pierde el `normal` stale: struct=[normal,holofoil] (M-29), snap=[normal,holofoil], stale=[normal,holofoil] ⇒ escribe [holofoil]', async () => {
    // Regresión de prod (Lurantis ex): el `normal` fantasma (structural stale + snapshot envenenado)
    // se filtra por rareza premium, venga de donde venga.
    const prisma = prismaMock([
      { id: 'db-ex', rarity: 'Double Rare', structuralFinishes: ['normal', 'holofoil'], pricedFinishesSnapshot: ['normal', 'holofoil'], availableFinishes: ['normal', 'holofoil'] },
    ]);
    const changed = await new FinishReconciler(prisma).reconcile(['db-ex']);
    expect((prisma as any).card.update).toHaveBeenCalledWith({
      where: { id: 'db-ex' },
      data: { availableFinishes: ['holofoil'] },
    });
    expect(changed).toBe(1);
  });

  it('SECRET RARE holo puro: struct=[holofoil], snap envenenado [normal,holofoil] ⇒ [holofoil] (premium nunca normal)', async () => {
    const prisma = prismaMock([
      { id: 'db-secret', rarity: 'Rare Secret', structuralFinishes: ['holofoil'], pricedFinishesSnapshot: ['normal', 'holofoil'], availableFinishes: ['normal', 'holofoil'] },
    ]);
    await new FinishReconciler(prisma).reconcile(['db-secret']);
    expect((prisma as any).card.update).toHaveBeenCalledWith({
      where: { id: 'db-secret' },
      data: { availableFinishes: ['holofoil'] },
    });
  });

  it('FALLBACK (§4.25e-3): premium con struct/snap solo `normal` ⇒ availableFinishes = ["normal"] (la resta vació el conjunto)', async () => {
    const prisma = prismaMock([
      { id: 'db-legacy', rarity: 'Ultra Rare', structuralFinishes: ['normal'], pricedFinishesSnapshot: ['normal'], availableFinishes: ['normal'] },
    ]);
    const changed = await new FinishReconciler(prisma).reconcile(['db-legacy']);
    // El recomputado (['normal'] por fallback) coincide con el actual ⇒ idempotente.
    expect((prisma as any).card.update).not.toHaveBeenCalled();
    expect(changed).toBe(0);
  });

  it('LEE rareza y snapshot: el `select` del findMany incluye rarity y pricedFinishesSnapshot', async () => {
    const findMany = jest.fn(async (_args: any) => [] as any[]);
    const prisma = { card: { findMany, update: jest.fn(async () => ({})) } } as unknown as PrismaService;
    await new FinishReconciler(prisma).reconcile(['db-any']);
    const select = findMany.mock.calls[0][0].select;
    expect(select).toMatchObject({
      id: true,
      rarity: true,
      structuralFinishes: true,
      pricedFinishesSnapshot: true,
      availableFinishes: true,
    });
  });

  it('OBSERVABILIDAD (§4.25e) camino feliz: snapshot ∖ structural que SÍ compone ⇒ `debug` (snapshotRecovered), NO `warn`', async () => {
    // struct=[holofoil], snap=[holofoil,reverse_holo] en un común ⇒ availableFinishes recomputado =
    // [reverse_holo, holofoil] (orden canónico). Ya está en su valor ⇒ idempotente; el reverse (no
    // estructural) SÍ compone ⇒ es el reverse recuperado (§4.25e): se traza a `debug`, no ensucia `warn`.
    const prisma = prismaMock([
      { id: 'db-drift', rarity: 'Common', structuralFinishes: ['holofoil'], pricedFinishesSnapshot: ['holofoil', 'reverse_holo'], availableFinishes: ['reverse_holo', 'holofoil'] },
    ]);
    const reconciler = new FinishReconciler(prisma);
    const warnSpy = jest.spyOn((reconciler as any).logger, 'warn').mockImplementation(() => {});
    const debugSpy = jest.spyOn((reconciler as any).logger, 'debug').mockImplementation(() => {});

    const changed = await reconciler.reconcile(['db-drift']);

    // availableFinishes ya está en su valor recomputado ⇒ idempotente; el reverse recuperado va a debug.
    expect(changed).toBe(0);
    expect((prisma as any).card.update).not.toHaveBeenCalled();
    const debugged = debugSpy.mock.calls.map(([m]) => String(m)).join('\n');
    expect(debugged).toContain('snapshotRecovered');
    expect(debugged).toContain('db-drift:reverse_holo');
    expect(debugged).not.toContain('db-drift:holofoil'); // holofoil SÍ es estructural: no es drift
    // El camino feliz NO debe emitir warn (no hay acabado descartado por la composición).
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
    debugSpy.mockRestore();
  });

  it('OBSERVABILIDAD (§4.25e) anomalía: snapshot trae `normal` fantasma en premium ⇒ la composición lo DESCARTA ⇒ `warn` (pricedNotStructural)', async () => {
    // struct=[holofoil], snap=[holofoil,normal] en una premium ⇒ el `normal` (no estructural) NO
    // compone (filtro §4.25e-1) ⇒ drift genuino proveedor↔estructura: se emite a `warn`.
    const prisma = prismaMock([
      { id: 'db-ghost', rarity: 'Double Rare', structuralFinishes: ['holofoil'], pricedFinishesSnapshot: ['holofoil', 'normal'], availableFinishes: ['holofoil'] },
    ]);
    const reconciler = new FinishReconciler(prisma);
    const warnSpy = jest.spyOn((reconciler as any).logger, 'warn').mockImplementation(() => {});
    const debugSpy = jest.spyOn((reconciler as any).logger, 'debug').mockImplementation(() => {});

    const changed = await reconciler.reconcile(['db-ghost']);

    // availableFinishes=[holofoil] ya es el valor recomputado (el normal se filtra) ⇒ idempotente.
    expect(changed).toBe(0);
    const warned = warnSpy.mock.calls.map(([m]) => String(m)).join('\n');
    expect(warned).toContain('pricedNotStructural');
    expect(warned).toContain('db-ghost:normal'); // descartado por la composición ⇒ anómalo ⇒ warn
    expect(warned).not.toContain('db-ghost:holofoil'); // holofoil SÍ es estructural: no es drift
    // El `normal` fantasma NO es camino feliz: no debe aparecer en debug.
    const debugged = debugSpy.mock.calls.map(([m]) => String(m)).join('\n');
    expect(debugged).not.toContain('db-ghost:normal');
    warnSpy.mockRestore();
    debugSpy.mockRestore();
  });

  it('IDEMPOTENTE: si el valor recomputado ya coincide, NO escribe (cero writes)', async () => {
    const prisma = prismaMock([
      { id: 'db-x', rarity: 'Common', structuralFinishes: ['normal', 'reverse_holo'], pricedFinishesSnapshot: ['normal'], availableFinishes: ['normal', 'reverse_holo'] },
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
    // Cada entrada verificada corresponde a una llave real de TCG_KEY_TO_FINISH.
    const verifiedTargets = new Set(Object.values(VERIFIED_FINISH_ALIASES));
    const tcgTargets = new Set(Object.values(TCG_KEY_TO_FINISH));
    expect([...verifiedTargets].sort()).toEqual([...tcgTargets].sort());
    // Y toda llave real de tcgplayer.prices, normalizada, resuelve a su Finish por la vía verificada.
    for (const [rawKey, finish] of Object.entries(TCG_KEY_TO_FINISH)) {
      expect(normalizeVerifiedFinishAlias(rawKey)).toBe(finish);
    }
  });
});
