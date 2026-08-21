import { FinishReconciler } from '../src/modules/catalog/finish-reconciler.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { composeAvailableFinishes } from '../src/common/card-order';
import {
  normalizeVerifiedFinishAlias,
  VERIFIED_FINISH_ALIASES,
  TCG_KEY_TO_FINISH,
} from '../src/modules/pricing/pricing.types';

/**
 * v1.27 (P-13, ARCHITECTURE §4.25a) — la lista blanca `Card.availableFinishes` deriva SOLO de la
 * columna ESTRUCTURAL (la unión con `pricedFinishesSnapshot` de §4.24a queda DEROGADA — era el
 * vector de las variantes fantasma). Fórmula vigente:
 *
 *   availableFinishes := structuralFinishes ≠ ∅ ? orderFinishes(structuralFinishes) : ['normal']
 *
 * El snapshot de precio queda como OBSERVABILIDAD (log `pricedNotStructural`), jamás compone.
 * Estas pruebas cubren: (1) la FUNCIÓN PURA de la composición; (2) el ÚNICO escritor
 * `FinishReconciler` (el precio confirma/nunca añade, reparabilidad de fantasmas, fallback legacy,
 * idempotencia, observabilidad); (3) el candado del ALIAS VERIFICADO (anti-invención / SEC-A1).
 */

describe('composeAvailableFinishes (§4.25a) — función pura: el precio CONFIRMA, nunca AÑADE', () => {
  it('estructural manda: ["holofoil"] ⇒ ["holofoil"] (el snapshot ya NO participa)', () => {
    expect(composeAvailableFinishes(['holofoil'])).toEqual(['holofoil']);
  });

  it('emite SIEMPRE en orden canónico FINISH_ORDER y deduplica (no importa el orden de entrada)', () => {
    expect(composeAvailableFinishes(['reverse_holo', 'normal', 'reverse_holo'])).toEqual([
      'normal',
      'reverse_holo',
    ]);
    expect(composeAvailableFinishes(['first_edition_holofoil', 'holofoil', 'normal'])).toEqual([
      'normal',
      'holofoil',
      'first_edition_holofoil',
    ]);
  });

  it('FALLBACK LEGACY (§4.25a-3): estructural vacío ⇒ ["normal"] (conservador, nunca vacío, jamás relleno)', () => {
    expect(composeAvailableFinishes([])).toEqual(['normal']);
  });

  it('es RECOMPUTABLE (no monótona): quitar un acabado de structural lo ELIMINA al recomputar', () => {
    expect(composeAvailableFinishes(['normal', 'reverse_holo'])).toEqual(['normal', 'reverse_holo']);
    expect(composeAvailableFinishes(['reverse_holo'])).toEqual(['reverse_holo']);
  });
});

describe('FinishReconciler — ÚNICO escritor de Card.availableFinishes (§4.25a / §4.22g candado 4)', () => {
  function prismaMock(cards: Array<{ id: string; structuralFinishes: string[]; pricedFinishesSnapshot: string[]; availableFinishes: string[] }>) {
    return {
      card: {
        findMany: jest.fn(async () => cards),
        update: jest.fn(async () => ({})),
      },
    } as unknown as PrismaService;
  }

  it('P-13 caso PO: ex holofoil-única CON `normal` priceado en el snapshot ⇒ UNA casilla ["holofoil"] (el fantasma stale se ELIMINA)', async () => {
    // El barrido `printing=Normal` de PPT le pegó un `normal` CON precio a una ex; la unión v1.26 lo
    // había materializado como casilla. La fórmula v1.27 recomputa SOLO desde structural y lo limpia.
    const prisma = prismaMock([
      { id: 'db-ex', structuralFinishes: ['holofoil'], pricedFinishesSnapshot: ['normal', 'holofoil'], availableFinishes: ['normal', 'holofoil'] },
    ]);
    const changed = await new FinishReconciler(prisma).reconcile(['db-ex']);
    expect((prisma as any).card.update).toHaveBeenCalledWith({
      where: { id: 'db-ex' },
      data: { availableFinishes: ['holofoil'] },
    });
    expect(changed).toBe(1);
  });

  it('el precio YA NO rescata: structural=["normal"], snapshot=["reverse_holo"], stale=["normal","reverse_holo"] ⇒ escribe ["normal"] (confirma, no añade)', async () => {
    const prisma = prismaMock([
      { id: 'db-x', structuralFinishes: ['normal'], pricedFinishesSnapshot: ['reverse_holo'], availableFinishes: ['normal', 'reverse_holo'] },
    ]);
    await new FinishReconciler(prisma).reconcile(['db-x']);
    expect((prisma as any).card.update).toHaveBeenCalledWith({
      where: { id: 'db-x' },
      data: { availableFinishes: ['normal'] },
    });
  });

  it('FALLBACK LEGACY (§4.25a-3): structural vacío ⇒ availableFinishes = ["normal"] aunque el snapshot traiga acabados', async () => {
    // Población sin resolver TCGCSV: NO se usa el snapshot como fallback (re-abriría el vector
    // precio→estructura justo donde nacen los fantasmas). Conservador: mejor falta que sobra.
    const prisma = prismaMock([
      { id: 'db-legacy', structuralFinishes: [], pricedFinishesSnapshot: ['normal', 'reverse_holo'], availableFinishes: ['normal', 'reverse_holo'] },
    ]);
    await new FinishReconciler(prisma).reconcile(['db-legacy']);
    expect((prisma as any).card.update).toHaveBeenCalledWith({
      where: { id: 'db-legacy' },
      data: { availableFinishes: ['normal'] },
    });
  });

  it('OBSERVABILIDAD (§4.25a-1): snapshot ∖ structural ≠ ∅ ⇒ log `pricedNotStructural` (sin tocar la whitelist)', async () => {
    const prisma = prismaMock([
      { id: 'db-ex', structuralFinishes: ['holofoil'], pricedFinishesSnapshot: ['normal', 'holofoil'], availableFinishes: ['holofoil'] },
    ]);
    const reconciler = new FinishReconciler(prisma);
    const warnSpy = jest.spyOn((reconciler as any).logger, 'warn').mockImplementation(() => {});

    const changed = await reconciler.reconcile(['db-ex']);

    // Idempotente (la whitelist ya está limpia) pero el drift queda LOGUEADO con el par carta:finish.
    expect(changed).toBe(0);
    expect((prisma as any).card.update).not.toHaveBeenCalled();
    const logged = warnSpy.mock.calls.map(([m]) => String(m)).join('\n');
    expect(logged).toContain('pricedNotStructural');
    expect(logged).toContain('db-ex:normal');
    expect(logged).not.toContain('db-ex:holofoil'); // holofoil SÍ es estructural: no es drift
    warnSpy.mockRestore();
  });

  it('IDEMPOTENTE: si el valor recomputado ya coincide, NO escribe (cero writes)', async () => {
    const prisma = prismaMock([
      { id: 'db-x', structuralFinishes: ['normal', 'reverse_holo'], pricedFinishesSnapshot: ['normal'], availableFinishes: ['normal', 'reverse_holo'] },
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
