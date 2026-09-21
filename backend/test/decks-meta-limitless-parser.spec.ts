import { readFileSync } from 'fs';
import { join } from 'path';
import {
  parseHomeIndex,
  parseArchetypePage,
  parseDeckListHtml,
} from '../src/modules/decks-meta/limitless-html.parser';

/**
 * DECKS-META Fase 2 — parsers de HTML de Limitless (spec §2). Egress BLOQUEADO en sandbox: TODO
 * corre OFFLINE contra fixtures. `home-index` y `archetype-284` son capturas REALES; `decklist-list`
 * es SINTÉTICO (supuesto A1: no hay fixture real de `/decks/list/`).
 */
const FIXTURES = join(__dirname, 'fixtures', 'limitless');
const homeHtml = readFileSync(join(FIXTURES, 'home-index.html'), 'utf8');
const archetypeHtml = readFileSync(join(FIXTURES, 'archetype-284.html'), 'utf8');
const decklistHtml = readFileSync(join(FIXTURES, 'decklist-list.fixture.html'), 'utf8');

describe('parseHomeIndex — fixture REAL home-index.html (§2.1)', () => {
  const result = parseHomeIndex(homeHtml);

  it('extrae el formatCode del <h2>Top Decks (TEF-PBL)</h2>', () => {
    expect(result.formatCode).toBe('TEF-PBL');
  });

  it('trae 6 bloques .leader (lo medido en el fixture)', () => {
    expect(result.totalBlocks).toBe(6);
    expect(result.leaders).toHaveLength(6);
  });

  it('extrae los archetypeId correctos, en orden', () => {
    expect(result.leaders.map((l) => l.archetypeId)).toEqual(['284', '339', '350', '320', '322', '376']);
  });

  it('extrae los listId representativos correctos, en orden', () => {
    expect(result.leaders.map((l) => l.listId)).toEqual(['28760', '28874', '28757', '28800', '28949', '28895']);
  });

  it('extrae rank + nombre + share del primer bloque', () => {
    const first = result.leaders[0];
    expect(first.rank).toBe(1);
    expect(first.name).toBe('Dragapult');
    expect(first.sharePct).toBeCloseTo(36.11, 2);
  });

  it('extrae la descripción de la lista (sourceTournament) sin la etiqueta "Featured Decklist"', () => {
    expect(result.leaders[0].sourceTournament).toBe('4th Place World Championships 2026 - Michael R.');
  });

  it('markup irreconocible ⇒ 0 bloques (C5 fallaría temprano)', () => {
    const broken = parseHomeIndex('<html><body><h2>otra cosa</h2><div>nada</div></body></html>');
    expect(broken.totalBlocks).toBe(0);
    expect(broken.leaders).toHaveLength(0);
  });
});

describe('parseArchetypePage — fixture REAL archetype-284.html (§2.2)', () => {
  const result = parseArchetypePage(archetypeHtml);

  it('extrae el nombre del arquetipo (h1.name)', () => {
    expect(result.name).toBe('Dragapult');
  });

  it('trae ~18 core-card (VERIFICADO), NUNCA 60', () => {
    expect(result.coreCards.length).toBeGreaterThanOrEqual(10);
    expect(result.coreCards.length).toBeLessThan(30);
    // GUARD (regla dura del dueño): la página de arquetipo NO alcanza para «las 60».
    expect(result.coreCards.length).not.toBe(60);
    expect(result.coreCards.length).toBeLessThan(55);
  });

  it('cada core-card trae setCode + número', () => {
    expect(result.coreCards[0]).toMatchObject({ setCode: expect.any(String), number: expect.any(String) });
  });
});

describe('parseDeckListHtml — fixture SINTÉTICO decklist-list.fixture.html (§2.3, A1)', () => {
  const { lines } = parseDeckListHtml(decklistHtml);

  it('suma de cantidades = 60 (esto es «las 60»)', () => {
    const sum = lines.reduce((s, l) => s + l.quantity, 0);
    expect(sum).toBe(60);
  });

  it('agrupa por columna: 5 líneas Pokémon, 10 Trainer, 2 Energy', () => {
    expect(lines.filter((l) => l.group === 'pokemon')).toHaveLength(5);
    expect(lines.filter((l) => l.group === 'trainer')).toHaveLength(10);
    expect(lines.filter((l) => l.group === 'energy')).toHaveLength(2);
  });

  it('parsea set+número+cantidad de una carta con identidad', () => {
    const drag = lines.find((l) => l.name === 'Dragapult ex');
    expect(drag).toMatchObject({ quantity: 4, setCode: 'TWM', number: '130', isBasicEnergy: false, group: 'pokemon' });
  });

  it('detecta la energía BÁSICA (data-basic-energy) sin set/número y la cuenta para las 60', () => {
    const basic = lines.find((l) => l.isBasicEnergy);
    expect(basic).toMatchObject({ quantity: 11, setCode: null, number: null, group: 'energy' });
  });

  it('la energía ESPECIAL con set+número NO es básica', () => {
    const reversal = lines.find((l) => l.name === 'Reversal Energy');
    expect(reversal).toMatchObject({ setCode: 'PAL', number: '192', isBasicEnergy: false, group: 'energy' });
  });

  it('un Trainer llamado «Energy Search» NO vuelca la sección a energy (defensa del parser)', () => {
    const search = lines.find((l) => l.name === 'Energy Search');
    expect(search).toMatchObject({ group: 'trainer', setCode: 'SVI', number: '190' });
    // Las cartas que le siguen en la columna Trainer siguen en 'trainer'.
    const poffin = lines.find((l) => l.name === 'Buddy-Buddy Poffin');
    expect(poffin?.group).toBe('trainer');
  });

  it('HTML sin .decklist-card ⇒ 0 líneas (el canary lo rechaza por suma ~0)', () => {
    expect(parseDeckListHtml('<html><body><div>nada</div></body></html>').lines).toHaveLength(0);
  });
});
