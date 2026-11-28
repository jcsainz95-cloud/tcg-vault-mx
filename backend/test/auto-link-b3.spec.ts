import groups from './fixtures/tcgcsv/groups-2026-11-27.json';
import sets from './fixtures/pokemontcg/sets-2026-11-27.json';
import {
  B3_RESIDUE_GROUPS,
  matchTcgcsvGroupByName,
  resolveGroupB3,
  resolveTcgcsvGroupForSet,
  scoreGroupCandidates,
} from '../src/modules/pricing/providers/tcgcsv-group-match';

/**
 * §AUTO-ENLACE fase 3 — B3 (mapeo set → grupo) medido sobre DATOS REALES del 2026-11-27: 222 grupos de TCGCSV (categoría Pokémon) y los 177 sets de
 * pokemontcg.io. Antes (escalera sola): 150 resueltos / 5 ambiguos / 22 sin grupo. Con B3: 175 / 1 ambiguo (Base) / 1 sin grupo (Futsal, no está en TCGCSV).
 */
type S = { id: string; name: string; series: string; releaseDate: string; printedTotal: number | null };
const G = groups as { groupId: number; name: string; publishedOn: string }[];
const SETS = sets as S[];
const byId = (id: string): S => SETS.find((s) => s.id === id)!;
const resolve = (id: string) => {
  const s = byId(id);
  return resolveTcgcsvGroupForSet({ name: s.name, pptSetId: null, externalId: s.id, series: s.series, releaseDate: s.releaseDate }, async () => G);
};
const nameOf = (gid: number | null) => G.find((g) => g.groupId === gid)?.name;

describe('B3 sobre los 177 sets y 222 grupos reales (AE-7)', () => {
  it('MONOTONÍA: todo set que la escalera ya resolvía queda en el MISMO grupo (0 cambios de dueño) y B3 no resuelve nada por la vía vieja', async () => {
    let same = 0;
    let changed = 0;
    for (const s of SETS) {
      const old = matchTcgcsvGroupByName(s.name, G);
      if (old.groupId == null) continue;
      const r = await resolve(s.id);
      if (r.groupId === old.groupId) same += 1;
      else changed += 1;
    }
    expect(changed).toBe(0);
    expect(same).toBeGreaterThanOrEqual(144);
  });

  it('AE-7: ≥ 165 de 177 resueltos por regla (175 medidos); solo Base (empate real) y Futsal (no está en TCGCSV) quedan sin grupo', async () => {
    const unresolved: string[] = [];
    let ok = 0;
    for (const s of SETS) {
      const r = await resolve(s.id);
      if (r.groupId != null) ok += 1;
      else unresolved.push(s.id);
    }
    expect(SETS).toHaveLength(177);
    expect(ok).toBeGreaterThanOrEqual(165);
    expect(ok).toBe(175);
    expect(unresolved.sort()).toEqual(['base1', 'fut20']);
  });

  it.each([
    ['ex1', 'EX Ruby and Sapphire', '«&»≡«and» + prefijo de serie EX'],
    ['dp1', 'Diamond and Pearl', '«&»≡«and» (no el de Promos)'],
    ['bw1', 'Black and White', '«&»≡«and» (no el de Promos)'],
    ['ex3', 'EX Dragon', 'prefijo de serie EX (no Dragon Vault/Majesty)'],
    ['ex7', 'EX Team Rocket Returns', 'empate por fecha ≤ 45 días'],
    ['ecard1', 'Expedition', 'empate por fecha'],
    ['xy12', 'XY - Evolutions', 'prefijo «XY -» de un solo lado + fecha'],
    ['sm1', 'SM Base Set', 'base de era: iniciales de la serie'],
    ['mcd11', "McDonald's Promos 2011", 'marca + año'],
    ['mcd16', "McDonald's Promos 2016", 'marca + año'],
    ['mcd19', "McDonald's Promos 2019", 'marca + año'],
    ['mcd22', "McDonald's Promos 2022", 'marca + año'],
    ['mcd21', "McDonald's 25th Anniversary Promos", 'marca + año de publicación (el grupo no trae año en el nombre)'],
  ])('%s ⇒ %s (%s)', async (id, expected) => {
    const r = await resolve(id);
    expect(nameOf(r.groupId)).toBe(expected);
  });

  it('el empate real «Base» (Base Set vs Base Set (Shadowless), misma fecha) NO se adivina: queda con candidatos, mejor primero', async () => {
    const r = await resolve('base1');
    expect(r.groupId).toBeNull();
    const c = scoreGroupCandidates({ name: 'Base', series: 'Base', releaseDate: '1999/01/09' }, G);
    expect(c.slice(0, 2).map((x) => x.name)).toEqual(['Base Set', 'Base Set (Shadowless)']);
    expect(c.length).toBeLessThanOrEqual(5);
    expect(c.every((x, i) => i === 0 || c[i - 1].score >= x.score)).toBe(true);
  });

  it('Futsal no existe en TCGCSV ⇒ sin grupo y sin candidatos (se muestra como not_in_provider)', async () => {
    expect((await resolve('fut20')).groupId).toBeNull();
    expect(scoreGroupCandidates({ name: 'Pokémon Futsal Collection', releaseDate: '2020/09/11' }, G)).toEqual([]);
  });

  it('tabla curada de residuo: cada fila apunta a un grupo que EXISTE hoy en TCGCSV y resuelve por su set', async () => {
    for (const row of B3_RESIDUE_GROUPS) {
      expect(G.some((g) => g.groupId === row.groupId)).toBe(true);
      const s = SETS.find((x) => x.id === row.ptcgSetId);
      if (!s) continue; // tk2a ya no figura en pokemontcg.io; la fila no daña
      const r = await resolve(s.id);
      expect(r.groupId).toBe(row.groupId);
    }
    expect(B3_RESIDUE_GROUPS.length).toBeLessThanOrEqual(10); // «solo residuo»
  });

  it('la tabla curada no actúa si el grupo desapareció de TCGCSV (dinero ante la duda)', () => {
    const without = G.filter((g) => g.groupId !== 1418);
    expect(resolveGroupB3({ name: 'Wizards Black Star Promos', externalId: 'basep', releaseDate: '1999/07/01' }, without)).toBeNull();
  });
});

describe('B3 — lo que NO debe ligar (dinero ante la duda)', () => {
  const g = (groupId: number, name: string, publishedOn = '2000-01-01') => ({ groupId, name, publishedOn });
  it('dos prefijos de código DISTINTOS son dos colecciones (SV08 ≠ ME05)', () => {
    expect(resolveGroupB3({ name: 'ME05: Pitch Black' }, [g(1, 'SV08: Pitch Black')])).toBeNull();
  });
  it('McDonald\'s de un año sin grupo NO cae al de otro año', () => {
    expect(resolveGroupB3({ name: "McDonald's Collection 2020", releaseDate: '2020/01/01' }, [g(1, "McDonald's Promos 2019"), g(2, "McDonald's Promos 2022")])).toBeNull();
  });
  it('McDonald\'s con dos grupos del mismo año ⇒ no se adivina', () => {
    expect(resolveGroupB3({ name: "McDonald's Collection 2019", releaseDate: '2019/10/15' }, [g(1, "McDonald's Promos 2019"), g(2, "McDonald's Deck 2019")])).toBeNull();
  });
  it('el prefijo de serie solo aplica con serie declarada y nombre IGUAL tras quitarlo («Dragon» con serie Sun & Moon no toma «EX Dragon»)', () => {
    expect(resolveGroupB3({ name: 'Dragon', series: 'Sun & Moon', releaseDate: '2017/01/01' }, [g(1, 'EX Dragon', '2003-11-24')])).toBeNull();
    expect(resolveGroupB3({ name: 'Dragon', series: 'EX', releaseDate: '2003/11/24' }, [g(1, 'EX Dragon', '2003-11-24'), g(2, 'EX Dragon Frontiers')])?.groupId).toBe(1);
  });
  it('la base de era solo si el set se llama como su serie', () => {
    expect(resolveGroupB3({ name: 'Guardians Rising', series: 'Sun & Moon' }, [g(1, 'SM Base Set')])).toBeNull();
    expect(resolveGroupB3({ name: 'Sun & Moon', series: 'Sun & Moon' }, [g(1, 'SM Base Set')])?.groupId).toBe(1);
  });
  it('fecha: un empate con fechas fuera de 45 días no se desempata', () => {
    expect(resolveGroupB3({ name: 'Evolutions', releaseDate: '2016/11/02' }, [g(1, 'XY - Evolutions', '2017-06-02'), g(2, 'SV - Evolutions', '2023-01-01'), g(3, 'Evolutions Deck', '2016-12-01')])).toBeNull();
    // y con UNA dentro de la ventana (2016-11-02 vs 2016/11/02) sí se acepta, descartando la del otro año
    expect(resolveGroupB3({ name: 'Evolutions', releaseDate: '2016/11/02' }, [g(1, 'XY - Evolutions', '2016-11-02'), g(2, 'SV - Evolutions', '2023-01-01')])?.groupId).toBe(1);
  });
  it('un grupo CONFIRMADO gana a todo y, si ya no existe en listGroups, NO cae a otra fuente (group_none)', async () => {
    const set = { name: 'Dragon', pptSetId: '1376', externalId: 'ex3', cardGroupId: 999, cardGroupVia: 'confirmed' };
    expect(await resolveTcgcsvGroupForSet({ ...set, cardGroupId: 1428 }, async () => G)).toEqual({ groupId: 1428, via: 'confirmed' });
    const gone = await resolveTcgcsvGroupForSet(set, async () => G);
    expect(gone.groupId).toBeNull();
    // `auto` es informativo: no manda sobre pptSetId.
    expect(await resolveTcgcsvGroupForSet({ ...set, cardGroupId: 1428, cardGroupVia: 'auto' }, async () => G)).toMatchObject({ groupId: 1376, via: 'ppt_set_id' });
  });
  it('la tabla de promos manda sobre un confirmado', async () => {
    expect(await resolveTcgcsvGroupForSet({ name: 'DP Black Star Promos', pptSetId: null, externalId: 'dpp', cardGroupId: 5, cardGroupVia: 'confirmed' }, async () => G)).toEqual({ groupId: 1421, via: 'promo_table' });
  });
});
