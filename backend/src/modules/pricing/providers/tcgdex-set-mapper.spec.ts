import * as fs from 'fs';
import * as path from 'path';
import { matchTcgdexSet, normalizeTcgdexSetName, extractTcgdexSets, TcgdexRemoteSet } from './tcgdex-set-mapper';

const FIX = path.join(__dirname, '../../../../test/fixtures/tcgdex');
const sets: TcgdexRemoteSet[] = extractTcgdexSets(JSON.parse(fs.readFileSync(path.join(FIX, 'sets-list-sample.json'), 'utf8')));

describe('tcgdex-set-mapper — CardSet ↔ tcgdexSetId sin puente frágil (M-75 §PRE, criterio 885)', () => {
  it('normaliza nombres (diacríticos, mayúsculas, símbolos)', () => {
    expect(normalizeTcgdexSetName('Prismatic Evolutions')).toBe('prismaticevolutions');
    expect(normalizeTcgdexSetName('Pokémon GO')).toBe('pokemongo');
    expect(normalizeTcgdexSetName('Sword & Shield')).toBe('swordshield');
  });

  it('resuelve Prismatic Evolutions ⇒ sv08.5 (el bug del dueño)', () => {
    expect(matchTcgdexSet({ name: 'Prismatic Evolutions', printedTotal: 131 }, sets)).toBe('sv08.5');
  });

  it('empata aunque nuestro id de pokemontcg.io sea distinto (match por nombre, NO por id)', () => {
    // pokemontcg.io usa "sv8pt5"; TCGdex "sv08.5". El join NO deriva un id del otro.
    expect(matchTcgdexSet({ name: '151', printedTotal: 165 }, sets)).toBe('sv03.5');
    expect(matchTcgdexSet({ name: 'Surging Sparks', printedTotal: 191 }, sets)).toBe('sv08');
    expect(matchTcgdexSet({ name: 'Base Set', printedTotal: 102 }, sets)).toBe('base1');
  });

  it('sin match ⇒ null (set sin fuente TCGdex; sus cartas NO heredan precio)', () => {
    expect(matchTcgdexSet({ name: 'Set Que No Existe En TCGdex', printedTotal: 50 }, sets)).toBeNull();
  });

  it('nombre vacío ⇒ null', () => {
    expect(matchTcgdexSet({ name: '', printedTotal: 10 }, sets)).toBeNull();
  });

  it('empate de nombre ⇒ desempata por nº de cartas oficiales; sin desempate único ⇒ null', () => {
    const dup: TcgdexRemoteSet[] = [
      { id: 'a1', name: 'Twin Set', cardCount: { official: 100 } },
      { id: 'a2', name: 'Twin Set', cardCount: { official: 200 } },
    ];
    expect(matchTcgdexSet({ name: 'Twin Set', printedTotal: 200 }, dup)).toBe('a2');
    expect(matchTcgdexSet({ name: 'Twin Set', printedTotal: 999 }, dup)).toBeNull(); // ninguno casa el count
    // dos con el MISMO count ⇒ ambiguo ⇒ null (no se adivina)
    const amb: TcgdexRemoteSet[] = [
      { id: 'b1', name: 'Twin Set', cardCount: { official: 100 } },
      { id: 'b2', name: 'Twin Set', cardCount: { official: 100 } },
    ];
    expect(matchTcgdexSet({ name: 'Twin Set', printedTotal: 100 }, amb)).toBeNull();
  });

  it('extractTcgdexSets tolera envelope o array pelón', () => {
    expect(extractTcgdexSets([{ id: 'x', name: 'X' }])).toHaveLength(1);
    expect(extractTcgdexSets({ data: [{ id: 'y', name: 'Y' }] })).toHaveLength(1);
    expect(extractTcgdexSets({ nope: true })).toHaveLength(0);
    expect(extractTcgdexSets([{ noId: true }])).toHaveLength(0);
  });
});
