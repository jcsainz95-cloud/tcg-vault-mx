import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { buildCardSearchPlan, CardSearchSetKeys, parseCardQuery } from '../src/common/card-search';
import { candidateSetKey } from '../src/modules/catalog/set-search-key.service';

const keys: CardSearchSetKeys = {
  byKey: new Map([['pre', ['s-pre']], ['dup', ['a', 'b']]]),
  totals: new Map([['s-pre', 131]]),
};

describe('card-search (§BUSCADOR-CARTAS) — parseo puro', () => {
  it('pliega acentos/símbolos y parte en palabras', () => {
    expect(parseCardQuery('PRE-078')?.words).toEqual(['pre', '078']);
    expect(parseCardQuery("Farfetch'd")?.words).toEqual(['farfetch']);
    expect(parseCardQuery('Charizard δ')?.words).toEqual(['charizard', 'delta']);
    expect(parseCardQuery('Pokémon  Catcher')?.words).toEqual(['pokemon', 'catcher']);
  });
  it('total impreso: «078/131» ⇒ número 078 y total 131', () => {
    const p = parseCardQuery('078/131');
    expect(p?.words).toEqual(['078']);
    expect(p?.total).toBe(131);
  });
  it('límites: 60 caracteres, 6 palabras, 24 por palabra; sin comodines', () => {
    expect(parseCardQuery('a b c d e f g h i j k l m n o')?.words.length).toBeLessThanOrEqual(6);
    expect(parseCardQuery('x'.repeat(500))?.words[0].length).toBeLessThanOrEqual(24);
    expect(parseCardQuery('%%%')?.noUsableWords).toBe(true);
    expect(parseCardQuery('  ')).toBeNull();
  });
  it('plan: «%», «_», «.*» no generan filtro abierto; «PRE 078» tiene nivel de identidad', () => {
    expect(buildCardSearchPlan('%', keys)?.matchesNothing).toBe(true);
    expect(buildCardSearchPlan('PRE 078', keys)?.identityTiers.length).toBe(1);
    expect(buildCardSearchPlan('078/131', keys)?.identityTiers.length).toBe(2);
    expect(buildCardSearchPlan('charizard', keys)?.identityTiers.length).toBe(0);
    expect(buildCardSearchPlan('78', keys)?.identityTiers.length).toBe(0);
  });
  it('BUSC-1: la rama de folio solo con allowFolio (panel); en los públicos «INV-…» es texto', () => {
    expect(JSON.stringify(buildCardSearchPlan('INV-000123', keys)?.where)).not.toContain('inventoryItems');
    expect(JSON.stringify(buildCardSearchPlan('INV-000123', keys, { allowFolio: true })?.where)).toContain('inventoryItems');
  });
  it('clave candidata de TCGCSV: 2-5 alfanuméricos en mayúsculas', () => {
    expect(candidateSetKey(' 30c ')).toBe('30C');
    expect(candidateSetKey('S')).toBeNull();
    expect(candidateSetKey('TOOLONG')).toBeNull();
    expect(candidateSetKey('a-b')).toBeNull();
    expect(candidateSetKey(undefined)).toBeNull();
  });
});

describe('card-search — nadie más escribe `contains` sobre Card', () => {
  const walk = (d: string): string[] =>
    readdirSync(d).flatMap((f) => {
      const p = join(d, f);
      return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') && !p.endsWith('.spec.ts') ? [p] : [];
    });
  it('ningún servicio filtra Card por `name/number contains` fuera de common/card-search.ts', () => {
    const offenders = walk(join(__dirname, '../src'))
      .filter((p) => !p.endsWith('common/card-search.ts'))
      .filter((p) => {
        const t = readFileSync(p, 'utf8');
        return /card:\s*\{\s*name:\s*\{\s*contains/.test(t) || /cardWhere\.name\s*=\s*\{\s*contains/.test(t) || /number:\s*\{\s*contains:\s*(params|q)\./.test(t);
      });
    expect(offenders).toEqual([]);
  });
});
