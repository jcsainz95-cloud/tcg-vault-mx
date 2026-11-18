/**
 * pattern-trial.spec.ts — §PRICE-PATTERN 6.6: la regla «solo baja, nunca sin precio» de la prueba (función pura `assessTrial`), la racha de auto-pausa
 * (`pauseSeries`, con lotes fallidos: PP-12) y la poda de la cuarentena (`pruneQuarantine`). Propiedad: backend.
 */
import { assessTrial, RefSnap } from '../src/modules/pricing/pattern-trial';
import { pauseSeries, pendingOfRun } from '../src/modules/pricing/pattern-streak';
import { pruneQuarantine } from '../src/modules/pricing/pattern-quarantine';

const snap = (cents: number | null, over: Partial<RefSnap> = {}): RefSnap => ({ cardId: 'c1', productType: 'raw', gradeKey: 'raw:NM', finish: 'holofoil', cents, ...over });
const one = (b: RefSnap, a: RefSnap | null) => assessTrial(new Map([['k', b]]), new Map(a ? [['k', a]] : []));

describe('assessTrial — solo baja, nunca sin precio', () => {
  it('raw NM: bajar o quedar igual es válido; SUBIR es violación', () => {
    expect(one(snap(30000), snap(1000)).size).toBe(0);
    expect(one(snap(30000), snap(30000)).size).toBe(0);
    expect([...one(snap(1000), snap(1001)).keys()]).toEqual(['c1']);
  });
  it('raw NM: quedar sin precio (NULL, 0, negativo o combo desaparecido) es violación', () => {
    for (const a of [snap(null), snap(0), snap(-5), null]) expect([...one(snap(1000), a).keys()]).toEqual(['c1']);
    expect(one(snap(1000), snap(null)).get('c1')![0]).toContain('sin precio');
  });
  it('qa MENOR-1: FUERA de raw NM cualquier cambio es violación, también la BAJA (la lectura aplica la variante efectiva a graded/sealed/otros grados)', () => {
    for (const over of [{ productType: 'graded' as const, gradeKey: 'graded:PSA:10' }, { productType: 'raw' as const, gradeKey: 'raw:LP' }, { productType: 'sealed' as const, gradeKey: 'sealed' }]) {
      expect([...one(snap(5000, over), snap(4000, over)).keys()]).toEqual(['c1']); // baja
      expect([...one(snap(5000, over), snap(6000, over)).keys()]).toEqual(['c1']); // sube
      expect(one(snap(5000, over), snap(5000, over)).size).toBe(0); // igual: nada que reportar
    }
  });
  it('un combo sin precio ANTES no se juzga; los motivos se acumulan por carta', () => {
    expect(one(snap(null), snap(5)).size).toBe(0);
    const bad = assessTrial(
      new Map([['a', snap(1000)], ['b', snap(900, { gradeKey: 'raw:LP' })]]),
      new Map([['a', snap(2000)], ['b', snap(800, { gradeKey: 'raw:LP' })]]),
    );
    expect(bad.get('c1')).toHaveLength(2);
  });
});

describe('pauseSeries — lotes fallidos cuentan para la auto-pausa (PP-12)', () => {
  const t = (h: number) => new Date(Date.UTC(2026, 10, 1) + h * 3_600_000);
  const run = (h: number, after: Record<string, number>) => ({ createdAt: t(h), after });
  it('pendiente de una corrida = diferidos + cuarentena + lotes fallidos (las viejas sin campos cuentan 0)', () => {
    expect(pendingOfRun({ deferred: 1, quarantined: 2, failedBatches: 3 })).toBe(6);
    expect(pendingOfRun({ deferred: 1 })).toBe(1);
    expect(pendingOfRun(null)).toBe(0);
  });
  it('3 corridas con SOLO lotes fallidos 1, 2, 3 ⇒ pausa; sin ellos (0,0,0) no', () => {
    expect(pauseSeries([run(48, { failedBatches: 3 }), run(24, { failedBatches: 2 }), run(0, { failedBatches: 1 })], 3)).toEqual([1, 2, 3]);
    expect(pauseSeries([run(48, {}), run(24, {}), run(0, {})], 3)).toBeNull();
  });
  it('constantes, decrecientes, separadas > 48 h o con menos de 3 corridas ⇒ sin pausa', () => {
    expect(pauseSeries([run(48, { failedBatches: 1 }), run(24, { failedBatches: 1 }), run(0, { failedBatches: 1 })], 3)).toBeNull();
    expect(pauseSeries([run(100, { failedBatches: 3 }), run(50, { failedBatches: 2 }), run(0, { failedBatches: 1 })], 3)).toBeNull();
    expect(pauseSeries([run(24, { failedBatches: 2 }), run(0, { failedBatches: 1 })], 3)).toBeNull();
  });
});

describe('pruneQuarantine', () => {
  const now = new Date('2026-11-18T12:00:00Z');
  const e = (at: string) => ({ sig: 's', at, reasons: ['x'] });
  it('conserva solo candidatas NO confirmadas y vigentes (< 7 días)', () => {
    const q = { keep: e('2026-11-17T12:00:00Z'), done: e('2026-11-17T12:00:00Z'), old: e('2026-11-10T12:00:00Z'), gone: e('2026-11-17T12:00:00Z') };
    expect(Object.keys(pruneQuarantine(q, new Set(['keep', 'done', 'old']), new Set(['done']), now))).toEqual(['keep']);
  });
});
