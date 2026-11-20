import {
  allocateBudget, isBasicEnergy, isMarketJump, mergeNeeds, needsFromDecks, netTarget, pickFinish, sortByPriority, suggestedUnitCents, weekStartMx,
} from '../src/modules/supply/supply-suggest.logic';

describe('§PROV-F4 · reglas puras de sugeridas', () => {
  it('necesidad de mazos = MÁXIMO de copias entre mazos (no la suma), acotada a 4', () => {
    const m = needsFromDecks([
      { cardId: 'a', quantity: 2, deckSlug: 'd1' },
      { cardId: 'a', quantity: 3, deckSlug: 'd2' },
      { cardId: 'b', quantity: 4, deckSlug: 'd1' },
      { cardId: 'b', quantity: 4, deckSlug: 'd2' },
      { cardId: 'c', quantity: 9, deckSlug: 'd1' },
      { cardId: 'z', quantity: 0, deckSlug: 'd1' },
    ]);
    expect(m.get('a')).toMatchObject({ need: 3, reasons: [{ kind: 'metadeck', ref: 'd2' }] });
    expect(m.get('b')?.need).toBe(4);
    expect(m.get('c')?.need).toBe(4);
    expect(m.has('z')).toBe(false);
  });

  it('unión de fuentes: max de cantidad y reasons conserva las dos', () => {
    const a = needsFromDecks([{ cardId: 'a', quantity: 2, deckSlug: 'd1' }]);
    const rot = new Map([['a', { cardId: 'a', need: 3, reasons: [{ kind: 'rotation' as const, ref: null }] }]]);
    const u = mergeNeeds(a, rot);
    expect(u.get('a')?.need).toBe(3);
    expect(u.get('a')?.reasons).toEqual([{ kind: 'metadeck', ref: 'd1' }, { kind: 'rotation', ref: null }]);
  });

  it('energía básica se excluye; la especial no', () => {
    expect(isBasicEnergy({ supertype: 'Energy', name: 'Fire Energy', subtypes: ['Basic'] })).toBe(true);
    expect(isBasicEnergy({ supertype: 'Energy', name: 'Basic Water Energy', subtypes: null })).toBe(true);
    expect(isBasicEnergy({ supertype: 'Energy', name: 'Jet Energy', subtypes: ['Special'] })).toBe(false);
    expect(isBasicEnergy({ supertype: 'Pokémon', name: 'Fire Energy', subtypes: [] })).toBe(false);
  });

  it('acabado = el de menor mercado con precio; sin ninguno ⇒ el primero y mercado null', () => {
    const mk = (m: Record<string, number | null>) => (f: string) => m[f] ?? null;
    expect(pickFinish(['normal', 'holofoil'], mk({ normal: 5000, holofoil: 3000 }))).toEqual({ finish: 'holofoil', marketCents: 3000 });
    expect(pickFinish(['normal', 'holofoil'], mk({ normal: 3000, holofoil: 3000 }))).toEqual({ finish: 'normal', marketCents: 3000 });
    expect(pickFinish(['normal', 'holofoil'], mk({ holofoil: 7000 }))).toEqual({ finish: 'holofoil', marketCents: 7000 });
    expect(pickFinish(['normal', 'holofoil'], mk({}))).toEqual({ finish: 'normal', marketCents: null });
  });

  it('precio: 70 % × mercado, peso hacia abajo, nunca > mercado (tope 100 %), sin mercado ⇒ null', () => {
    expect(suggestedUnitCents(5050, 7000)).toBe(3500); // 3535 → 3500
    expect(suggestedUnitCents(10000, 7000)).toBe(7000);
    expect(suggestedUnitCents(null, 7000)).toBeNull();
    expect(suggestedUnitCents(0, 7000)).toBeNull();
    // un pct fuera de rango se acota a 100 %: jamás sobre el mercado
    for (const m of [1000, 1234, 99999, 123457]) {
      for (const pct of [1, 5000, 7000, 10000, 15000, 99999]) {
        const u = suggestedUnitCents(m, pct);
        if (u != null) expect(u).toBeLessThanOrEqual(m);
      }
    }
    expect(suggestedUnitCents(12300, 15000)).toBe(12300);
  });

  it('salto de mercado > 30 % vs la captura anterior ⇒ cuarentena', () => {
    expect(isMarketJump(10000, 13000)).toBe(false); // exactamente 30 %
    expect(isMarketJump(10000, 13001)).toBe(true);
    expect(isMarketJump(10000, 6999)).toBe(true);
    expect(isMarketJump(null, 5000)).toBe(false);
  });

  it('necesidad neta nunca negativa', () => {
    expect(netTarget(4, 1, 1)).toBe(2);
    expect(netTarget(2, 5, 0)).toBe(0);
  });

  describe('presupuesto semanal', () => {
    const c = (key: string, qty: number, unitCents: number, signals = 1) => ({ key, qty, unitCents, signals });

    it('nunca excede lo restante; reduce la cantidad (mín. 1) y no publica partido', () => {
      const r = allocateBudget(sortByPriority([c('a', 4, 3000), c('b', 4, 3000), c('c', 1, 9000)]), 15000);
      const spent = r.publish.reduce((a, p) => a + p.qty * (p.key === 'c' ? 9000 : 3000), 0);
      expect(spent).toBeLessThanOrEqual(15000);
      expect(r.publish.find((p) => p.key === 'a')?.qty).toBe(4); // 12 000
      expect(r.publish.find((p) => p.key === 'b')?.qty).toBe(1); // reducida para caber (3 000)
      expect(r.budget).toEqual(['c']);
      expect(r.remainingCents).toBe(0);
    });

    it('presupuesto 0 o negativo ⇒ no publica nada', () => {
      expect(allocateBudget([c('a', 1, 1000)], 0).publish).toEqual([]);
      expect(allocateBudget([c('a', 1, 1000)], -50).budget).toEqual(['a']);
    });

    it('prioridad: señal de 2 fuentes primero, luego mayor valor', () => {
      const o = sortByPriority([c('x', 1, 1000, 1), c('y', 1, 5000, 1), c('z', 1, 500, 2)]);
      expect(o.map((p) => p.key)).toEqual(['z', 'y', 'x']);
    });

    it('propiedad: con presupuestos y cartas variados la suma publicada ≤ presupuesto', () => {
      for (let seed = 1; seed <= 200; seed++) {
        let s = seed * 7919;
        const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
        const cs = Array.from({ length: 12 }, (_, i) => c(`k${i}`, 1 + Math.floor(rnd() * 4), 1000 + Math.floor(rnd() * 90) * 100, 1 + Math.floor(rnd() * 2)));
        const budget = Math.floor(rnd() * 600000);
        const r = allocateBudget(sortByPriority(cs), budget);
        const spent = r.publish.reduce((a, p) => a + p.qty * cs.find((x) => x.key === p.key)!.unitCents, 0);
        expect(spent).toBeLessThanOrEqual(budget);
        expect(r.remainingCents).toBe(budget - spent);
      }
    });
  });

  it('semana: lunes 00:00 CDMX (UTC-6)', () => {
    // miércoles 2026-11-18 15:00 UTC ⇒ lunes 2026-11-16 00:00 CDMX = 06:00 UTC
    expect(weekStartMx(new Date('2026-11-18T15:00:00Z')).toISOString()).toBe('2026-11-16T06:00:00.000Z');
    // lunes 2026-11-16 03:00 UTC aún es domingo 21:00 en CDMX ⇒ semana del 9
    expect(weekStartMx(new Date('2026-11-16T03:00:00Z')).toISOString()).toBe('2026-11-09T06:00:00.000Z');
    // lunes 2026-11-16 06:00 UTC = lunes 00:00 CDMX ⇒ esa misma semana
    expect(weekStartMx(new Date('2026-11-16T06:00:00Z')).toISOString()).toBe('2026-11-16T06:00:00.000Z');
  });
});
