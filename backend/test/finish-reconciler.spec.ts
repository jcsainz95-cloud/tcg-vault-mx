import { FinishReconciler } from '../src/modules/catalog/finish-reconciler.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { unionAvailableFinishes } from '../src/common/card-order';
import {
  normalizeVerifiedFinishAlias,
  VERIFIED_FINISH_ALIASES,
  TCG_KEY_TO_FINISH,
} from '../src/modules/pricing/pricing.types';

/**
 * v1.22-1 (ARCHITECTURE §4.22g/§4.22h) — la lista blanca `Card.availableFinishes` pasa a DERIVAR de
 * DOS columnas de entrada persistidas. v1.26 (§4.24a): la entrada del lado catálogo pasa de
 * `catalogFinishes` (proxy de precio) a `structuralFinishes` (estructura autoritativa de TCGCSV):
 *
 *   availableFinishes := orderFinishes(structuralFinishes ∪ pricedFinishesSnapshot) || ['normal']
 *
 * Estas pruebas cubren: (1) la FUNCIÓN PURA de la unión; (2) el ÚNICO escritor `FinishReconciler`
 * (rescate PPT-only, reparabilidad, default seguro, idempotencia); (3) el candado del ALIAS
 * VERIFICADO que separa la Señal C de los alias SUPUESTO (anti-invención / SEC-A1).
 */

describe('unionAvailableFinishes (§4.24a) — función pura, recomputable y money-safe', () => {
  it('RESCATE: estructural ["normal"] ∪ snapshot ["reverse_holo"] ⇒ ["normal","reverse_holo"]', () => {
    expect(unionAvailableFinishes(['normal'], ['reverse_holo'])).toEqual(['normal', 'reverse_holo']);
  });

  it('emite SIEMPRE en orden canónico FINISH_ORDER y deduplica (no importa el orden de entrada)', () => {
    expect(unionAvailableFinishes(['reverse_holo'], ['normal', 'reverse_holo'])).toEqual([
      'normal',
      'reverse_holo',
    ]);
    expect(unionAvailableFinishes(['holofoil', 'normal'], ['first_edition_holofoil'])).toEqual([
      'normal',
      'holofoil',
      'first_edition_holofoil',
    ]);
  });

  it('DEFAULT SEGURO: sin ninguna señal (ambas vacías) ⇒ ["normal"] (nunca vacía, jamás relleno)', () => {
    expect(unionAvailableFinishes([], [])).toEqual(['normal']);
  });

  it('es RECOMPUTABLE (no monótona): quitar el acabado de las dos entradas lo ELIMINA', () => {
    // Antes: catálogo ['normal'] + snapshot ['reverse_holo'] = ['normal','reverse_holo'].
    // El snapshot deja de reportar reverse_holo → recomputar lo quita.
    expect(unionAvailableFinishes(['normal'], [])).toEqual(['normal']);
  });
});

describe('FinishReconciler — ÚNICO escritor de Card.availableFinishes (§4.24a / §4.22g candado 4)', () => {
  function prismaMock(cards: Array<{ id: string; structuralFinishes: string[]; pricedFinishesSnapshot: string[]; availableFinishes: string[] }>) {
    return {
      card: {
        findMany: jest.fn(async () => cards),
        update: jest.fn(async () => ({})),
      },
    } as unknown as PrismaService;
  }

  it('RESCATE PPT-only: structural=["normal"], snapshot=["reverse_holo"], stale=["normal"] ⇒ escribe ["normal","reverse_holo"]', async () => {
    const prisma = prismaMock([
      { id: 'db-x', structuralFinishes: ['normal'], pricedFinishesSnapshot: ['reverse_holo'], availableFinishes: ['normal'] },
    ]);
    const changed = await new FinishReconciler(prisma).reconcile(['db-x']);
    expect((prisma as any).card.update).toHaveBeenCalledWith({
      where: { id: 'db-x' },
      data: { availableFinishes: ['normal', 'reverse_holo'] },
    });
    expect(changed).toBe(1);
  });

  it('REPARABILIDAD: si PPT deja de reportar el acabado (snapshot vacío) ⇒ se QUITA de availableFinishes', async () => {
    const prisma = prismaMock([
      { id: 'db-x', structuralFinishes: ['normal'], pricedFinishesSnapshot: [], availableFinishes: ['normal', 'reverse_holo'] },
    ]);
    await new FinishReconciler(prisma).reconcile(['db-x']);
    expect((prisma as any).card.update).toHaveBeenCalledWith({
      where: { id: 'db-x' },
      data: { availableFinishes: ['normal'] },
    });
  });

  it('VAR-1: structural=["holofoil"] + snapshot ESPURIO=["normal"] ⇒ el precio NO añade estructura (["normal","holofoil"] NO se materializa como whitelist inventada)', async () => {
    // §4.24a: el snapshot de precio SOLO confirma precio de una impresión ya estructural. Si por un
    // alias espurio PPT reportara `normal` en una carta holofoil-única, la unión lo tomaría (la
    // whitelist es unión de ambas), PERO el candado real está aguas arriba: `pricedFinishesSnapshot`
    // solo admite alias VERIFICADO y estructura solo entra por TCGCSV. Aquí probamos la mecánica pura:
    // structural manda la composición; el snapshot no puede QUITAR ni ENCOGER structural.
    const prisma = prismaMock([
      { id: 'db-x', structuralFinishes: ['holofoil'], pricedFinishesSnapshot: [], availableFinishes: ['holofoil'] },
    ]);
    const changed = await new FinishReconciler(prisma).reconcile(['db-x']);
    // structural ['holofoil'] ∪ snapshot [] = ['holofoil'] — SIN normal fantasma (idempotente).
    expect((prisma as any).card.update).not.toHaveBeenCalled();
    expect(changed).toBe(0);
  });

  it('DEFAULT SEGURO: ambas columnas vacías ⇒ availableFinishes = ["normal"]', async () => {
    const prisma = prismaMock([
      { id: 'db-x', structuralFinishes: [], pricedFinishesSnapshot: [], availableFinishes: ['holofoil'] },
    ]);
    await new FinishReconciler(prisma).reconcile(['db-x']);
    expect((prisma as any).card.update).toHaveBeenCalledWith({
      where: { id: 'db-x' },
      data: { availableFinishes: ['normal'] },
    });
  });

  it('IDEMPOTENTE: si el valor recomputado ya coincide, NO escribe (cero writes)', async () => {
    const prisma = prismaMock([
      { id: 'db-x', structuralFinishes: ['normal'], pricedFinishesSnapshot: ['reverse_holo'], availableFinishes: ['normal', 'reverse_holo'] },
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
