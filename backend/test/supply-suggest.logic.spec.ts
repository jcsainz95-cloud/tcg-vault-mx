import {
  allocateBudget, isBasicEnergy, isMarketJump, multForRank, needsFromDecks, normalizeReasons, netTarget, normalizeSuggestMult, pickFinish, sortByPriority, suggestedUnitCents, weekStartMx,
} from '../src/modules/supply/supply-suggest.logic';

describe('§PROV-F4 · reglas puras de sugeridas', () => {
  it('necesidad = Σ min(copias,4) × mult(rank): carta compartida 4×2 (puesto 2) + 2×1 (puesto 9) = 10', () => {
    const m = needsFromDecks([
      { cardId: 'a', quantity: 4, deckSlug: 'd2', rank: 2 },
      { cardId: 'a', quantity: 2, deckSlug: 'd9', rank: 9 },
    ]);
    expect(m.get('a')?.need).toBe(10);
    expect(m.get('a')?.priorityRank).toBe(2);
    expect(m.get('a')?.reasons).toEqual([
      { kind: 'metadeck', ref: 'd2', rank: 2, copies: 4, mult: 2 },
      { kind: 'metadeck', ref: 'd9', rank: 9, copies: 2, mult: 1 },
    ]);
  });

  it('tope 4 solo POR DECK (líneas repetidas del mismo deck se suman antes); cero y energía no cuentan; puesto 5 ×2, puesto 6 ×1', () => {
    const m = needsFromDecks([
      { cardId: 'c', quantity: 9, deckSlug: 'd1', rank: 5 },
      { cardId: 'b', quantity: 3, deckSlug: 'd1', rank: 6 },
      { cardId: 'b', quantity: 3, deckSlug: 'd1', rank: 6 },
      { cardId: 'z', quantity: 0, deckSlug: 'd1', rank: 1 },
    ]);
    expect(m.get('c')?.need).toBe(8);
    expect(m.get('b')?.need).toBe(4);
    expect(m.has('z')).toBe(false);
  });

  it('cambio de puesto: el mismo deck pasa de ×1 a ×2 al subir al top 5 (sin estado guardado)', () => {
    const l = (rank: number) => [{ cardId: 'a', quantity: 3, deckSlug: 'd', rank }];
    expect(needsFromDecks(l(6)).get('a')?.need).toBe(3);
    expect(needsFromDecks(l(5)).get('a')?.need).toBe(6);
    expect(needsFromDecks(l(7), { topRankMax: 8, topMult: 3, restMult: 1 }).get('a')?.need).toBe(9);
  });

  it('el deck que más pesa fija la prioridad (empate ⇒ mejor puesto)', () => {
    const m = needsFromDecks([
      { cardId: 'a', quantity: 1, deckSlug: 'd1', rank: 1 }, // 2
      { cardId: 'a', quantity: 3, deckSlug: 'd8', rank: 8 }, // 3
    ]);
    expect(m.get('a')?.priorityRank).toBe(8);
    const t = needsFromDecks([
      { cardId: 'a', quantity: 2, deckSlug: 'd9', rank: 9 }, // 2
      { cardId: 'a', quantity: 1, deckSlug: 'd3', rank: 3 }, // 2
    ]);
    expect(t.get('a')?.priorityRank).toBe(3);
  });

  it('multiplicadores de ConfigSetting: inválido o ausente ⇒ defaults del código', () => {
    expect(normalizeSuggestMult([])).toEqual({ topRankMax: 5, topMult: 2, restMult: 1 });
    expect(normalizeSuggestMult([
      { key: 'supply.suggest.topRankMax', valueJson: 8 }, { key: 'supply.suggest.topMult', valueJson: 3 }, { key: 'supply.suggest.restMult', valueJson: 2 },
    ])).toEqual({ topRankMax: 8, topMult: 3, restMult: 2 });
    expect(normalizeSuggestMult([
      { key: 'supply.suggest.topRankMax', valueJson: 21 }, { key: 'supply.suggest.topMult', valueJson: 0 }, { key: 'supply.suggest.restMult', valueJson: '2' },
    ])).toEqual({ topRankMax: 5, topMult: 2, restMult: 1 });
    expect(normalizeSuggestMult([{ key: 'supply.suggest.topRankMax', valueJson: 0 }]).topRankMax).toBe(0);
    expect(multForRank(null, { topRankMax: 5, topMult: 2, restMult: 1 })).toBe(1);
  });

  it('F4-6: multiplicadores acotados (≤10); fuera de rango ⇒ default', () => {
    expect(normalizeSuggestMult([{ key: 'supply.suggest.topMult', valueJson: 10 }, { key: 'supply.suggest.restMult', valueJson: 10 }])).toEqual({ topRankMax: 5, topMult: 10, restMult: 10 });
    expect(normalizeSuggestMult([{ key: 'supply.suggest.topMult', valueJson: 11 }, { key: 'supply.suggest.restMult', valueJson: 1_000_000_000 }])).toEqual({ topRankMax: 5, topMult: 2, restMult: 1 });
    expect(normalizeSuggestMult([{ key: 'supply.suggest.topRankMax', valueJson: Number.MAX_SAFE_INTEGER }]).topRankMax).toBe(5);
  });

  it('deck sin puesto (rank null/ausente) no suma a la necesidad', () => {
    const m = needsFromDecks([
      { cardId: 'a', quantity: 4, deckSlug: 'd1', rank: null },
      { cardId: 'a', quantity: 2, deckSlug: 'd2' },
      { cardId: 'b', quantity: 3, deckSlug: 'd3', rank: 8 },
    ]);
    expect(m.has('a')).toBe(false);
    expect(m.get('b')?.need).toBe(3);
  });

  it('normalizeReasons: campos ausentes ⇒ null estable; basura se descarta', () => {
    expect(normalizeReasons([{ kind: 'metadeck', ref: 'x' }, null, 'z', { ref: 'y', rank: 2, copies: 3, mult: 2 }, { ref: 'w', rank: 1.5 }])).toEqual([
      { kind: 'metadeck', ref: 'x', rank: null, copies: null, mult: null },
      { kind: 'metadeck', ref: 'y', rank: 2, copies: 3, mult: 2 },
      { kind: 'metadeck', ref: 'w', rank: null, copies: null, mult: null },
    ]);
    expect(normalizeReasons(undefined)).toEqual([]);
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
    const c = (key: string, qty: number, unitCents: number, rank = 1) => ({ key, qty, unitCents, rank });

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

    it('prioridad: menor puesto primero, luego mayor valor, luego clave', () => {
      const o = sortByPriority([c('x', 1, 1000, 6), c('y', 1, 5000, 6), c('z', 1, 500, 2), c('w', 1, 500, 6)]);
      expect(o.map((p) => p.key)).toEqual(['z', 'y', 'x', 'w']);
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

  it('F4-8: rank 0 y -5 (legado) no cuentan en la necesidad, igual que null', () => {
    const m = needsFromDecks([
      { cardId: 'a', quantity: 4, deckSlug: 'd0', rank: 0 },
      { cardId: 'a', quantity: 4, deckSlug: 'dn', rank: -5 },
      { cardId: 'a', quantity: 2, deckSlug: 'd9', rank: 9 },
    ], { topRankMax: 5, topMult: 2, restMult: 1 });
    expect(m.get('a')?.reasons).toEqual([{ kind: 'metadeck', ref: 'd9', rank: 9, copies: 2, mult: 1 }]);
  });
});
