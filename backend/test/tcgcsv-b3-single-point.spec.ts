/**
 * §AUTO-ENLACE §12 — invariante ESTÁTICO de la retención B3: nadie crea `PriceReference` de fuente TCGCSV (`source: 'tcgcsv_singles'`) fuera de los
 * puntos controlados. Un archivo nuevo que escriba esa fuente ROMPE este test hasta que se declare aquí (con su motivo) y, si lo que escribe puede venir de
 * un grupo B3, aplique `shouldRetainTcgcsvPrice`.
 * Más: la tabla de verdad de `shouldRetainTcgcsvPrice` (§12.2), y que el resolver de grupo devuelve siempre `{groupId, via}`.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { analyze, buildProgram, RELEASE_CALLERS } from './static/b3-retention-ast';
import { resolveTcgcsvGroupForSet, shouldRetainTcgcsvPrice } from '../src/modules/pricing/providers/tcgcsv-group-match';

const SRC = join(__dirname, '..', 'src');
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : f.endsWith('.ts') && !f.endsWith('.spec.ts') ? [join(d, f)] : []));
const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('§13.4 escritores de PriceReference TCGCSV (estático por AST + type checker, no por el literal)', () => {
  const RET_HEAD = "import { PrismaClient } from '@prisma/client';\nimport { PricingService } from '../pricing/pricing.service';\nimport { releaseTcgcsvRow, type RetainedPriceRow } from '../pricing/providers/tcgcsv-group-match';\n";
  const MUTANT_HEAD = "import { PrismaClient, PriceSource } from '@prisma/client';\nimport { PricingService } from '../pricing/pricing.service';\n";
  const ROW = "cardId: 'c', productType: 'raw' as const, gradeKey: 'raw:NM', finish: 'normal' as const, priceMxnCents: 1, capturedDate: new Date()";
  const mutants: Record<string, string> = {
    'src/modules/__mutants__/m-const.ts': `${MUTANT_HEAD}const SRC = 'tcgcsv_singles' as const;\nexport async function w(db: PrismaClient) { await db.priceReference.create({ data: { ${ROW}, source: SRC } }); }\n`,
    'src/modules/__mutants__/m-param.ts': `${MUTANT_HEAD}export async function w(db: PrismaClient, src: PriceSource) { await db.priceReference.create({ data: { ${ROW}, source: src } }); }\n`,
    'src/modules/__mutants__/m-spread.ts': `${MUTANT_HEAD}const base = { source: 'tcgcsv_singles' as const };\nexport async function w(db: PrismaClient) { await db.priceReference.upsert({ where: { id: 'x' }, create: { ${ROW}, ...base }, update: { ...base } }); }\n`,
    // AE-14 (qa re-gate 4, sonda de 6 evasiones): lavado con `via` literal, alias de tipo, parámetro marcado irrelevante, `$executeRawUnsafe`, delegado desestructurado, referencia suelta.
    'src/modules/__mutants__/m-launder.ts': `${RET_HEAD}export async function w(p: PricingService) { await p.persistMarketReference('c', 'normal', releaseTcgcsvRow({ groupId: null, via: 'confirmed' }, false, { marketCents: 1, currency: 'USD' as const, source: 'tcgcsv_singles' as const })!, { rate: 1, bufferPct: 0 }); }\n`,
    'src/modules/__mutants__/m-launder-alias.ts': `import { PricingService } from '../pricing/pricing.service';\nimport { releaseTcgcsvRow as free } from '../pricing/providers/tcgcsv-group-match';\nexport async function w(p: PricingService) { await p.persistMarketReference('c', 'normal', free({ groupId: null, via: 'confirmed' }, false, { marketCents: 1, currency: 'USD' as const, source: 'tcgcsv_singles' as const })!, { rate: 1, bufferPct: 0 }); }\n`,
    'src/modules/__mutants__/m-launder-ref.ts': `import * as m from '../pricing/providers/tcgcsv-group-match';\nexport const f = m.releaseTcgcsvRow;\n`,
    'src/modules/__mutants__/m-cast-alias.ts': `${RET_HEAD}type R = RetainedPriceRow<{ marketCents: number; currency: 'USD'; source: 'tcgcsv_singles' }>;\nexport async function w(p: PricingService) { await p.persistMarketReference('c', 'normal', ({ marketCents: 1, currency: 'USD', source: 'tcgcsv_singles' } as unknown) as R, { rate: 1, bufferPct: 0 }); }\n`,
    'src/modules/__mutants__/m-irrelevant-param.ts': `${RET_HEAD}export async function w(db: PrismaClient, _x: RetainedPriceRow<{ a: 1 }>, src: 'tcgcsv_singles') { await db.priceReference.create({ data: { ${ROW}, source: src } }); }\n`,
    'src/modules/__mutants__/m-raw-unsafe.ts': `${MUTANT_HEAD}export async function w(db: PrismaClient) { await db.$executeRawUnsafe('INSERT INTO "PriceReference" (source) VALUES ($1)', 'tcgcsv_singles'); }\n`,
    'src/modules/__mutants__/m-raw-tagged.ts': `${MUTANT_HEAD}export async function w(db: PrismaClient) { await db.$executeRaw\`INSERT INTO "PriceReference" (source) VALUES ('tcgcsv_singles')\`; }\n`,
    'src/modules/__mutants__/m-destructured.ts': `${MUTANT_HEAD}export async function w(db: PrismaClient) { const { priceReference: pr } = db; await pr.create({ data: { ${ROW}, source: 'tcgcsv_singles' } }); }\n`,
    'src/modules/__mutants__/m-loose-ref.ts': `${MUTANT_HEAD}export async function w(db: PrismaClient) { const c = db.priceReference.create; await c.call(db.priceReference, { data: { ${ROW}, source: 'tcgcsv_singles' } } as never); }\n`,
    'src/modules/__mutants__/m-persist.ts': `${MUTANT_HEAD}export async function w(p: PricingService) { await p.persistMarketReference('c', 'normal', { marketCents: 1, currency: 'USD', source: 'tcgcsv_singles' as any }, { rate: 1, bufferPct: 0 }); }\n`,
  };
  // Control verde: el mismo escritor, pero que consume `RetainedPriceRow`, NO se señala.
  const control = {
    'src/modules/__mutants__/ok-branded.ts': `import { PrismaClient } from '@prisma/client';\nimport type { RetainedPriceRow } from '../pricing/providers/tcgcsv-group-match';\nexport async function w(db: PrismaClient, row: RetainedPriceRow<{ x: number }>) { await db.priceReference.create({ data: { ${ROW}, priceMxnCents: row.x, source: 'tcgcsv_singles' } }); }\n`,
  };
  const program = buildProgram({ ...mutants, ...control });
  const real = analyze(program, (rel) => !rel.startsWith('modules/__mutants__/'));
  const mutated = analyze(program, (rel) => rel.startsWith('modules/__mutants__/'));

  it('en src/ NINGÚN escritor de PriceReference con fuente que pueda ser TCGCSV deja de consumir RetainedPriceRow (salvo la lista cerrada EXEMPT)', () => {
    expect(real).toEqual([]);
  });

  it.each(Object.keys(mutants))('mutante %s ⇒ el análisis lo señala (rojo)', (file) => {
    expect(mutated.filter((v) => `src/${v.file}` === file).length).toBeGreaterThan(0);
  });

  it('AE-14: la sonda de evasión (6 casos de qa) se detecta ≥ 5/6 (aquí 6/6 mutantes AE-14)', () => {
    const ae14 = Object.keys(mutants).filter((f) => /m-(launder|launder-alias|launder-ref|cast-alias|irrelevant-param|raw-unsafe|raw-tagged|destructured|loose-ref)\.ts$/.test(f));
    const hit = ae14.filter((f) => mutated.some((v) => `src/${v.file}` === f));
    expect({ hit: hit.length, of: ae14.length }).toEqual({ hit: 9, of: 9 });
  });

  it('AE-14 lista cerrada de llamadores: todo llamador real de releaseTcgcsvRow/tcgcsvPersistInput está en RELEASE_CALLERS y cada entrada de la lista existe (sin entradas muertas)', () => {
    const callers = new Set<string>();
    for (const f of walk(SRC)) {
      const rel = relative(SRC, f).replace(/\\/g, '/');
      if (rel === 'modules/pricing/providers/tcgcsv-group-match.ts') continue;
      if (/\b(releaseTcgcsvRow|tcgcsvPersistInput)\(/.test(strip(readFileSync(f, 'utf8')))) callers.add(rel);
    }
    expect([...callers].sort()).toEqual([...new Set(Object.keys(RELEASE_CALLERS).map((k) => k.split('#')[0]))].sort());
  });

  it('el control con RetainedPriceRow NO se señala', () => {
    expect(mutated.filter((v) => v.file === 'modules/__mutants__/ok-branded.ts')).toEqual([]);
  });

  it('shouldRetainTcgcsvPrice y releaseTcgcsvRow son el único origen de la marca (nadie más llama a RELEASED.add / forja el tipo)', () => {
    const offenders = walk(SRC).filter((f) => /\bas\s+RetainedPriceRow\b/.test(strip(readFileSync(f, 'utf8'))) && !f.endsWith('tcgcsv-group-match.ts'));
    expect(offenders.map((f) => relative(SRC, f))).toEqual([]);
  });

  it('los escritores controlados aplican la retención: provider, resolver, confirmación y stamped-ingest', () => {
    const read = (rel: string): string => strip(readFileSync(join(SRC, rel), 'utf8'));
    expect(read('modules/pricing/providers/tcgcsv-singles-bulk.provider.ts')).toMatch(/releaseTcgcsvRow\(\{ groupId, via \}/);
    expect(read('modules/pricing/providers/tcgcsv-singles-bulk.provider.ts')).toMatch(/reason: 'b3_unverified'/);
    expect(read('modules/catalog/card-product-resolver.service.ts')).toMatch(/releaseTcgcsvRow\(resolution,/);
    expect(read('modules/catalog/card-link-confirm.service.ts')).toMatch(/shouldRetainTcgcsvPrice\(/);
    expect(read('modules/pricing/stamped-ingest.service.ts')).toMatch(/b3_unverified/);
  });

  it('set-price-sync y catalog-price-sync no escriben PriceReference TCGCSV', () => {
    for (const rel of ['jobs/set-price-sync.service.ts', 'jobs/catalog-price-sync.service.ts', 'modules/catalog/catalog-sync.service.ts']) {
      expect(strip(readFileSync(join(SRC, rel), 'utf8'))).not.toMatch(/tcgcsv_singles/);
    }
  });
});

describe('§12.2 shouldRetainTcgcsvPrice', () => {
  it.each([
    ['b3', false, true],
    ['b3', true, false],
    ['confirmed', false, false],
    ['promo_table', false, false],
    ['ppt_set_id', false, false],
    ['name', false, false],
    ['auto', false, false],
    ['desconocido', false, true], // §13.3: valor desconocido ⇒ retiene
    ['desconocido', true, true],
    [null, false, true], // sin veredicto ⇒ retiene
  ])('via %s, referencia previa TCGCSV %s ⇒ retiene %s', (via, prior, expected) => {
    expect(shouldRetainTcgcsvPrice({ groupId: 1, via }, prior)).toBe(expected);
  });

  it('§13.3 resolución nula/indefinida ⇒ retiene (falla cerrada), aun con referencia previa', () => {
    expect(shouldRetainTcgcsvPrice(null, true)).toBe(true);
    expect(shouldRetainTcgcsvPrice(undefined, false)).toBe(true);
  });

  it('el resolver de grupo devuelve SIEMPRE {groupId, via} cuando resuelve', async () => {
    const groups = [{ groupId: 7, name: 'EX Zorua', publishedOn: '2020-01-01' }, { groupId: 8, name: 'EX Zorua Frontiers', publishedOn: '2021-06-01' }];
    const r = await resolveTcgcsvGroupForSet({ name: 'Zorua', series: 'EX', pptSetId: null, externalId: 'x-1', releaseDate: '2020/01/01' }, async () => groups);
    expect(r).toEqual({ groupId: 7, via: 'b3' });
    const n = await resolveTcgcsvGroupForSet({ name: 'Zorua', pptSetId: '123', externalId: 'x-2' }, async () => groups);
    expect(n).toEqual({ groupId: 123, via: 'ppt_set_id' });
    const c = await resolveTcgcsvGroupForSet({ name: 'Zorua', pptSetId: null, externalId: 'x-3', cardGroupId: 8, cardGroupVia: 'confirmed' }, async () => groups);
    expect(c).toEqual({ groupId: 8, via: 'confirmed' });
  });
});
