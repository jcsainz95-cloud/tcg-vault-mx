/**
 * §AUTO-ENLACE §12 — invariante ESTÁTICO de la retención B3: nadie crea `PriceReference` de fuente TCGCSV (`source: 'tcgcsv_singles'`) fuera de los
 * puntos controlados. Un archivo nuevo que escriba esa fuente ROMPE este test hasta que se declare aquí (con su motivo) y, si lo que escribe puede venir de
 * un grupo B3, aplique `shouldRetainTcgcsvPrice`.
 * Más: la tabla de verdad de `shouldRetainTcgcsvPrice` (§12.2), y que el resolver de grupo devuelve siempre `{groupId, via}`.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { resolveTcgcsvGroupForSet, shouldRetainTcgcsvPrice } from '../src/modules/pricing/providers/tcgcsv-group-match';

const SRC = join(__dirname, '..', 'src');
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : f.endsWith('.ts') && !f.endsWith('.spec.ts') ? [join(d, f)] : []));
const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Escritores de `PriceReference` con `source:'tcgcsv_singles'` y por qué cada uno es seguro. */
const CONTROLLED: Record<string, { reason: string; mustCall?: boolean }> = {
  'modules/pricing/price-ingest.service.ts': { reason: 'persiste las filas que emite TcgcsvSinglesBulkPriceProvider (el punto de retención §12.2-ii)' },
  'modules/catalog/card-product-resolver.service.ts': { reason: 'job / link-repair / confirmación por carta: marca b3Unverified con shouldRetainTcgcsvPrice', mustCall: true },
  'modules/catalog/tcgcsv-set-import.service.ts': { reason: 'import explícito del dueño de un grupo TCGCSV como set propio (externalId tcgcsv-*): el grupo es la entrada, no se resuelve por B3' },
  'modules/catalog/promo-set-products.service.ts': { reason: 'grupos de la tabla fija PTCG_PROMO_GROUPS (via promo_table, nunca b3)' },
  'modules/pricing/stamped-ingest.service.ts': { reason: 'productos de liga de grupos fijos (§IDS), no del mapeo set→grupo' },
};

describe('§12 punto único de retención B3 (estático)', () => {
  const writers = walk(SRC)
    .map((f) => ({ rel: relative(SRC, f), txt: strip(readFileSync(f, 'utf8')) }))
    .filter((f) => /source:\s*'tcgcsv_singles'/.test(f.txt) && /persistMarketReference\s*\(|priceReference\.(create|createMany|upsert|update|updateMany)\s*\(/.test(f.txt))
    .map((f) => f.rel)
    .sort();

  it('los únicos escritores de PriceReference TCGCSV son los declarados (un escritor nuevo debe declararse y aplicar la regla)', () => {
    expect(writers).toEqual(Object.keys(CONTROLLED).sort());
  });

  it('el provider de price-ingest y el resolver del job aplican shouldRetainTcgcsvPrice antes de emitir/publicar', () => {
    const provider = strip(readFileSync(join(SRC, 'modules/pricing/providers/tcgcsv-singles-bulk.provider.ts'), 'utf8'));
    expect(provider).toMatch(/shouldRetainTcgcsvPrice\(\{ groupId, via \}/);
    expect(provider).toMatch(/reason: 'b3_unverified'/);
    for (const [rel, c] of Object.entries(CONTROLLED)) if (c.mustCall) expect(strip(readFileSync(join(SRC, rel), 'utf8'))).toMatch(/shouldRetainTcgcsvPrice\(/);
    const confirm = strip(readFileSync(join(SRC, 'modules/catalog/card-link-confirm.service.ts'), 'utf8'));
    expect(confirm).toMatch(/shouldRetainTcgcsvPrice\(/);
  });

  it('set-price-sync y catalog-price-sync no escriben PriceReference TCGCSV (no están entre los escritores y no llaman a persistMarketReference con esa fuente)', () => {
    for (const rel of ['jobs/set-price-sync.service.ts', 'jobs/catalog-price-sync.service.ts', 'modules/catalog/catalog-sync.service.ts']) {
      expect(writers).not.toContain(rel);
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
  ])('via %s, referencia previa TCGCSV %s ⇒ retiene %s', (via, prior, expected) => {
    expect(shouldRetainTcgcsvPrice({ groupId: 1, via }, prior)).toBe(expected);
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
