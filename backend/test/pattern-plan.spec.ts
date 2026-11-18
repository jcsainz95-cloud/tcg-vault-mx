/**
 * pattern-plan.spec.ts — §PRICE-PATTERN v2 (docs/DECISIONES.md 6.1-6.4): la función ÚNICA de «variante efectiva» y el plan puro de la corrida.
 * Fixtures con la forma de los casos reales (Klink 061 Black Bolt, Erika's Oddish 001 Ascended Heroes, Noctowl PRE 78).
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { EffectiveVariantRow, effectiveVariantKey, effectiveVariantKeys } from '../src/common/variant-product';
import { PATTERN_RUN_MAX, PlanRow, ReaderBaseRow, planPatternRun } from '../src/modules/pricing/pattern-plan';

const NOW = new Date('2026-11-18T12:00:00Z');
const FRESH = new Date('2026-11-18T00:00:00Z');

let seq = 1000;
function row(o: Partial<PlanRow> & Pick<PlanRow, 'cardId' | 'finish' | 'kind' | 'cents'>): PlanRow {
  const id = o.cardProductId === undefined ? `p${seq++}` : o.cardProductId;
  return { productType: 'raw', gradeKey: 'raw:NM', cardProductId: id, tcgplayerProductId: id == null ? null : seq++, observedAt: FRESH, ...o } as PlanRow;
}
const key = (r: EffectiveVariantRow) => effectiveVariantKey({ cardProductId: r.cardProductId!, productType: r.productType, gradeKey: r.gradeKey, finish: r.finish });

describe('effectiveVariantKeys (6.1): UNA función de «variante efectiva»', () => {
  it('CA-1 Klink 061: base solo Normal/Reverse y el patrón es el único Holofoil ⇒ el patrón VALE para holofoil', () => {
    const rows = [row({ cardId: 'klink', finish: 'normal', kind: 'set_base', cents: 300 }), row({ cardId: 'klink', finish: 'reverse_holo', kind: 'set_base', cents: 500 }), row({ cardId: 'klink', finish: 'holofoil', kind: 'variant', cents: 2500 })];
    expect([...effectiveVariantKeys(rows)]).toEqual([key(rows[2])]);
  });
  it('CA-2 Erika\'s Oddish: dos reversos únicos «(Poke Ball)» y «(Energy Symbol Pattern)» ⇒ solo el MÁS BARATO', () => {
    const pb = row({ cardId: 'oddish', finish: 'reverse_holo', kind: 'variant', cents: 40 });
    const es = row({ cardId: 'oddish', finish: 'reverse_holo', kind: 'variant', cents: 25 });
    expect([...effectiveVariantKeys([pb, es])]).toEqual([key(es)]);
    expect([...effectiveVariantKeys([es, pb])]).toEqual([key(es)]); // independiente del orden
  });
  it('empate de precio ⇒ gana el `tcgplayerProductId` ascendente', () => {
    const a = row({ cardId: 'c', finish: 'reverse_holo', kind: 'variant', cents: 30, tcgplayerProductId: 900 });
    const b = row({ cardId: 'c', finish: 'reverse_holo', kind: 'variant', cents: 30, tcgplayerProductId: 100 });
    expect([...effectiveVariantKeys([a, b])]).toEqual([key(b)]);
  });
  it('con base con precio en ese acabado el patrón NO vale (Noctowl PRE 78); un precio genérico sin producto (PPT/manual) también es base', () => {
    const base = row({ cardId: 'n', finish: 'holofoil', kind: 'set_base', cents: 305 });
    const pat = row({ cardId: 'n', finish: 'holofoil', kind: 'variant', cents: 15663 });
    expect(effectiveVariantKeys([base, pat]).size).toBe(0);
    const generic = row({ cardId: 'g', finish: 'holofoil', kind: null, cardProductId: null, cents: 500 });
    expect(effectiveVariantKeys([generic, row({ cardId: 'g', finish: 'holofoil', kind: 'variant', cents: 9000 })]).size).toBe(0);
  });
  it('«con precio» = > 0: una base sin precio no impide al patrón valer; el alcance es por carta×acabado×tipo', () => {
    const pat = row({ cardId: 'x', finish: 'holofoil', kind: 'variant', cents: 900 });
    expect(effectiveVariantKeys([row({ cardId: 'x', finish: 'holofoil', kind: 'set_base', cents: 0 }), pat]).size).toBe(1);
    expect(effectiveVariantKeys([row({ cardId: 'x', finish: 'normal', kind: 'set_base', cents: 100 }), pat]).size).toBe(1);
    expect(effectiveVariantKeys([row({ cardId: 'y', finish: 'holofoil', kind: 'set_base', cents: 100 }), pat]).size).toBe(1);
  });
});

describe('planPatternRun (6.2/6.4): solo baja, cuarentena y freno fijo', () => {
  const cand = (rows: PlanRow[]) => new Set(rows.filter((r) => r.kind === 'variant').map((r) => r.cardProductId!));

  it('CA-3 Noctowl PRE 78: base con precio y patrón ≫ 1.5× ⇒ expuesto, se aplica y baja a la base', () => {
    const rows = [row({ cardId: 'noctowl', finish: 'holofoil', kind: 'set_base', cents: 305 }), row({ cardId: 'noctowl', finish: 'holofoil', kind: 'variant', cents: 15663 })];
    const p = planPatternRun(rows, cand(rows), NOW);
    expect(p.applied).toHaveLength(1);
    expect(p.applied[0]).toMatchObject({ cardId: 'noctowl', fromCents: 15663, toCents: 305 });
    expect(p.flipIds).toEqual([rows[1].cardProductId]);
  });
  it('CA-1/CA-2: el patrón único (Klink) y los reversos únicos (Oddish) se reclasifican SIN combos expuestos: el precio se conserva', () => {
    const rows = [
      row({ cardId: 'klink', finish: 'normal', kind: 'set_base', cents: 300 }), row({ cardId: 'klink', finish: 'holofoil', kind: 'variant', cents: 2500 }),
      row({ cardId: 'oddish', finish: 'reverse_holo', kind: 'variant', cents: 40 }), row({ cardId: 'oddish', finish: 'reverse_holo', kind: 'variant', cents: 25 }),
    ];
    const p = planPatternRun(rows, cand(rows), NOW);
    expect([p.applied.length, p.deferred.length, p.held, p.safe]).toEqual([0, 0, 0, 2]);
    expect(p.flipIds).toHaveLength(3);
  });
  it('cuarentena: base con > 7 días, o razón ≤ 1.5, o el patrón es MÁS BARATO que la base ⇒ no se toca (el precio se conserva)', () => {
    const stale = [row({ cardId: 's', finish: 'holofoil', kind: 'set_base', cents: 100, observedAt: new Date('2026-11-01T00:00:00Z') }), row({ cardId: 's', finish: 'holofoil', kind: 'variant', cents: 9000 })];
    const near = [row({ cardId: 'n', finish: 'holofoil', kind: 'set_base', cents: 1000 }), row({ cardId: 'n', finish: 'holofoil', kind: 'variant', cents: 1500 })];
    const cheaper = [row({ cardId: 'c', finish: 'holofoil', kind: 'set_base', cents: 1000 }), row({ cardId: 'c', finish: 'holofoil', kind: 'variant', cents: 400 })];
    for (const rows of [stale, near, cheaper]) {
      const p = planPatternRun(rows, cand(rows), NOW);
      expect([p.applied.length, p.deferred.length, p.flipIds.length, p.held]).toEqual([0, 0, 0, 1]);
    }
  });
  it('acoplamiento: un patrón con un combo expuesto y otro en cuarentena NO se reclasifica (un producto = un kind)', () => {
    const pid = 'shared';
    const rows = [
      row({ cardId: 'k', finish: 'holofoil', kind: 'set_base', cents: 100 }), row({ cardId: 'k', finish: 'holofoil', kind: 'variant', cents: 9000, cardProductId: pid }),
      row({ cardId: 'k', finish: 'reverse_holo', kind: 'set_base', cents: 1000 }), row({ cardId: 'k', finish: 'reverse_holo', kind: 'variant', cents: 1200, cardProductId: pid }),
    ];
    const p = planPatternRun(rows, new Set([pid]), NOW);
    expect([p.flipIds.length, p.applied.length, p.deferred.length]).toEqual([0, 0, 0]);
  });
  it('CA-4 freno: 160 expuestos ⇒ aplica los 150 de MAYOR razón y difiere 10; el día siguiente (ya sin los 150) aplica los 10', () => {
    const rows: PlanRow[] = [];
    for (let i = 0; i < 160; i++) {
      rows.push(row({ cardId: `c${i}`, finish: 'holofoil', kind: 'set_base', cents: 100 }));
      rows.push(row({ cardId: `c${i}`, finish: 'holofoil', kind: 'variant', cents: 1000 + i * 10 })); // razón creciente con i
    }
    const p = planPatternRun(rows, cand(rows), NOW);
    expect([PATTERN_RUN_MAX, p.applied.length, p.deferred.length, p.flipIds.length]).toEqual([150, 150, 10, 150]);
    expect(p.deferred.map((d) => d.cardId).sort()).toEqual(Array.from({ length: 10 }, (_, i) => `c${i}`).sort()); // los de menor razón esperan
    expect(p.applied[0].ratio).toBeGreaterThan(p.applied[149].ratio);
    // 2.ª corrida: los 150 ya son `variant` (no candidatos); quedan los 10 ⇒ se aplican todos
    const done = new Set(p.flipIds);
    const day2 = rows.map((r) => (done.has(r.cardProductId!) ? { ...r, kind: 'variant' } : r)) as PlanRow[];
    const p2 = planPatternRun(day2, new Set(day2.filter((r) => r.kind === 'variant' && !done.has(r.cardProductId!)).map((r) => r.cardProductId!)), NOW);
    expect([p2.applied.length, p2.deferred.length]).toEqual([10, 0]);
  });
  it('44 expuestos tipo (a) ⇒ los 44 se aplican, 0 diferidos (lo medido sobre TCGCSV real)', () => {
    const rows: PlanRow[] = [];
    for (let i = 0; i < 44; i++) rows.push(row({ cardId: `a${i}`, finish: 'holofoil', kind: 'set_base', cents: 100 }), row({ cardId: `a${i}`, finish: 'holofoil', kind: 'variant', cents: 6500 }));
    const p = planPatternRun(rows, cand(rows), NOW);
    expect([p.applied.length, p.deferred.length]).toEqual([44, 0]);
  });
  it('PROPIEDAD CA-5 (k/N): sobre 500 combos aleatorios, TODO combo con precio previo conserva ≥ 1 producto con precio tras la reclasificación y nada sube', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    let ok = 0;
    const N = 500;
    for (let i = 0; i < N; i++) {
      const rows: PlanRow[] = [];
      const nb = Math.floor(rnd() * 3); // 0..2 bases
      const nv = 1 + Math.floor(rnd() * 3); // 1..3 patrones
      for (let b = 0; b < nb; b++) rows.push(row({ cardId: 'z', finish: 'holofoil', kind: 'set_base', cents: 1 + Math.floor(rnd() * 5000), observedAt: rnd() < 0.2 ? new Date('2026-10-01T00:00:00Z') : FRESH }));
      for (let v = 0; v < nv; v++) rows.push(row({ cardId: 'z', finish: 'holofoil', kind: 'variant', cents: 1 + Math.floor(rnd() * 20000) }));
      const before = Math.max(...rows.map((r) => r.cents)); // peor caso: hoy podría estar leyéndose el más caro
      const p = planPatternRun(rows, cand(rows), NOW, PATTERN_RUN_MAX);
      const flip = new Set(p.flipIds);
      const after = rows.map((r) => ({ ...r, kind: flip.has(r.cardProductId!) ? 'variant' : r.kind })) as PlanRow[];
      const effective = effectiveVariantKeys(after);
      const reading = after.filter((r) => r.kind !== 'variant' || effective.has(key(r)));
      if (reading.length > 0 && Math.max(...reading.map((r) => r.cents)) <= before) ok += 1;
    }
    expect(`${ok}/${N}`).toBe(`${N}/${N}`);
  });
});

describe('planPatternRun — la regla de oro se aplica ANTES (PP-7 / qa IMPORTANTE 2): base = lo que la lectura REAL leería', () => {
  const noct = (cents: number, id = '000') => row({ cardId: 'noct', finish: 'holofoil', kind: 'variant', cents, cardProductId: id });
  const rb = (o: Partial<ReaderBaseRow> & Pick<ReaderBaseRow, 'priceMxnCents'>): ReaderBaseRow => ({
    cardId: 'noct', finish: 'holofoil', cardProductId: `b${seq++}`, productExtId: seq++, productName: 'Otro nombre', cardName: 'Noctowl', cardTcgplayerId: '1',
    source: 'tcgcsv_singles', isManual: false, capturedDate: FRESH, evidenceDate: null, ...o,
  });
  /** `candUuid`: el uuid del candidato (desempata el ganador de la lectura ANTES del flip cuando no hay preferencia). */
  const run = (v: PlanRow, base: ReaderBaseRow[], extra?: Set<string>) => {
    const cand = rb({ cardProductId: v.cardProductId, productExtId: v.tcgplayerProductId, productName: 'Noctowl (Master Ball Pattern)', priceMxnCents: v.cents, isCandidate: true });
    return planPatternRun([row({ cardId: 'noct', finish: 'holofoil', kind: 'set_base', cents: 1000 }), v], new Set([v.cardProductId!]), NOW, PATTERN_RUN_MAX, [...base, cand], extra);
  };

  it('AMBIGUA tras el flip (2 productos pref. 2 con > 25 % de diferencia) ⇒ cuarentena: no se reclasifica y el precio se conserva', () => {
    const v = noct(90000);
    const p = run(v, [rb({ priceMxnCents: 1000 }), rb({ priceMxnCents: 5000 })]);
    expect([p.applied.length, p.deferred.length, p.flipIds.length, p.held]).toEqual([0, 0, 0, 1]);
  });
  it('dos bases pref. 2 con ≤ 25 % de diferencia NO son ambiguas ⇒ expuesto; y el ancla (pref. 0) desambigua aunque haya otra muy distinta', () => {
    const v = noct(90000);
    expect(run(v, [rb({ priceMxnCents: 1000 }), rb({ priceMxnCents: 1200 })]).applied).toHaveLength(1);
    const anchor = rb({ priceMxnCents: 1000, productName: 'Noctowl', productExtId: 1 });
    expect(run(v, [anchor, rb({ priceMxnCents: 5000 })]).applied).toHaveLength(1);
  });
  it('maxBase sale de TODAS las filas que la lectura conserva (varias fuentes sin producto el mismo día), no de una sola colapsada', () => {
    const v = noct(2500);
    // PPT 1000 + pokemontcg_io 2000 el mismo día: la lectura podría dejar 2000 ⇒ 2500/2000 = 1.25 ≤ 1.5 ⇒ NO se toca (con maxBase=1000 se habría «corregido» 2500→1000)
    const base = [rb({ priceMxnCents: 1000, cardProductId: null, productExtId: null, productName: null, source: 'pokemonpricetracker' }), rb({ priceMxnCents: 2000, cardProductId: null, productExtId: null, productName: null, source: 'pokemontcg_io' })];
    const p = run(v, base);
    expect([p.applied.length, p.flipIds.length, p.held]).toEqual([0, 0, 1]);
  });
  it('solo cuenta el día MÁS FRESCO de la lectura: una base vieja más cara no esconde el precio real', () => {
    const v = noct(90000);
    const old = rb({ priceMxnCents: 80000, capturedDate: new Date('2026-11-16T00:00:00Z') });
    const p = run(v, [rb({ priceMxnCents: 1000 }), old]);
    expect(p.applied[0]).toMatchObject({ fromCents: 90000, toCents: 1000 });
  });
  it('SOLO BAJA (medido): si hoy la lectura devuelve una base MÁS BARATA que la que quedaría tras el flip (el ancla de 305 vs otra de 300 que hoy gana por uuid), no se toca; si es igual ⇒ seguro', () => {
    const v = noct(90000, 'zzz');
    const cheaperToday = rb({ priceMxnCents: 300, cardProductId: 'aaa' });
    const anchor = rb({ priceMxnCents: 305, cardProductId: 'bbb', productName: 'Noctowl', productExtId: 1 });
    const p = run(v, [cheaperToday, anchor]);
    expect([p.applied.length, p.flipIds.length, p.held]).toEqual([0, 0, 1]);
    const same = run(v, [rb({ priceMxnCents: 305, cardProductId: 'aaa', productName: 'Noctowl', productExtId: 1 })]);
    expect([same.applied.length, same.flipIds.length, same.safe]).toEqual([0, 1, 1]);
  });
  it('override MANUAL en el combo ⇒ seguro: el precio no depende del producto, no se informa como corrección (qa IMPORTANTE 1)', () => {
    const v = noct(15663);
    const p = run(v, [rb({ priceMxnCents: 305 }), rb({ priceMxnCents: 9900, cardProductId: null, productExtId: null, productName: null, source: 'manual', isManual: true })]);
    expect([p.applied.length, p.deferred.length, p.safe, p.flipIds.length]).toEqual([0, 0, 1, 1]);
  });
  it('un candidato con precio FUERA de raw NM (graded) ⇒ cuarentena (la lectura le aplica la misma regla y este plan no lo mide)', () => {
    const v = noct(90000);
    const p = run(v, [rb({ priceMxnCents: 1000 })], new Set([v.cardProductId!]));
    expect([p.applied.length, p.flipIds.length, p.held]).toEqual([0, 0, 1]);
  });
});

describe('CA-9: una sola función de «variante efectiva»', () => {
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : f.endsWith('.ts') ? [join(d, f)] : []));
  const src = walk(join(__dirname, '..', 'src'));
  const read = (f: string) => readFileSync(f, 'utf8');
  it('solo `common/variant-product.ts` define la decisión; lectura, reconciliador y job la usan', () => {
    const defs = src.filter((f) => /function effectiveVariantKeys\b/.test(read(f)));
    expect(defs.map((f) => f.split('/src/')[1])).toEqual(['common/variant-product.ts']);
    const users = src.filter((f) => /\beffectiveVariantKeys\(/.test(read(f)) && !/function effectiveVariantKeys\b/.test(read(f))).map((f) => f.split('/src/')[1]).sort();
    expect(users).toEqual(['modules/catalog/finish-reconciler.service.ts', 'modules/pricing/pattern-plan.ts', 'modules/pricing/pricing.service.ts']);
        expect(read(join(__dirname, '..', 'src/modules/pricing/pattern-reclassify.service.ts'))).toMatch(/planPatternRun\(/);
  });
  it('ningún segundo regex de «Pattern/Ball» en el código', () => {
    const rx = src.filter((f) => /\(\??:?pattern\|ball\|energy symbol\)/.test(read(f))).map((f) => f.split('/src/')[1]);
    expect(rx).toEqual(['common/variant-product.ts']);
  });
});
