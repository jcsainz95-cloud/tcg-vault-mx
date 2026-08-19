import { CardSet } from '@prisma/client';
import {
  PptSetMapper,
  extractRemoteSets,
  matchSet,
  normalizeSetName,
  pptSetIdOf,
  setNameCandidates,
} from './ppt-set-mapper.service';
import { PptApiClient, PptDailyLimitError } from './providers/ppt-api.client';

/**
 * WS-A fix-ppt (CAUSA RAÍZ #1) — resuelve `CardSet.pptSetId` empatando el set local con `GET
 * /api/v2/sets` (por nombre normalizado + año). Prefiere el GroupId numérico. Money-safe: ambiguo →
 * null (no adivina); cuota diaria agotada → usa lo ya cacheado.
 */

function localSet(over: Partial<CardSet> = {}): CardSet {
  return { id: 'local-1', externalId: 'sv8', name: 'Surging Sparks', releaseDate: '2024/11/08', pptSetId: null, ...over } as CardSet;
}

describe('pure helpers', () => {
  it('normalizeSetName quita mayúsculas y no-alfanuméricos', () => {
    expect(normalizeSetName('Sword & Shield')).toBe('swordshield');
    expect(normalizeSetName('Prismatic Evolutions')).toBe('prismaticevolutions');
    expect(normalizeSetName(null)).toBe('');
  });

  it('pptSetIdOf prefiere GroupId numérico → slug → mongo id', () => {
    expect(pptSetIdOf({ tcgPlayerNumericId: 1407, tcgPlayerId: 'sv-pe', id: 'abc' })).toBe('1407');
    expect(pptSetIdOf({ tcgPlayerNumericId: '1408', tcgPlayerId: 'sv-pe' })).toBe('1408');
    expect(pptSetIdOf({ tcgPlayerId: 'sv-prismatic-evolutions' })).toBe('sv-prismatic-evolutions');
    expect(pptSetIdOf({ id: 'mongohex' })).toBe('mongohex');
    expect(pptSetIdOf({})).toBeNull();
  });

  it('extractRemoteSets tolera { data: [] } y array pelón', () => {
    expect(extractRemoteSets({ data: [{ name: 'A' }] })).toHaveLength(1);
    expect(extractRemoteSets([{ name: 'B' }])).toHaveLength(1);
    expect(extractRemoteSets({ nope: 1 })).toEqual([]);
  });

  it('setNameCandidates incluye el nombre con y sin el prefijo de código de PPT', () => {
    expect(setNameCandidates('ME05: Pitch Black')).toEqual(['me05pitchblack', 'pitchblack']);
    expect(setNameCandidates('ME: 30th Celebration')).toEqual(['me30thcelebration', '30thcelebration']);
    expect(setNameCandidates('Surging Sparks')).toEqual(['surgingsparks']); // sin prefijo → un solo candidato
  });
});

describe('matchSet — money-safe', () => {
  const remote = [
    { tcgPlayerNumericId: 1407, name: 'Surging Sparks', releaseDate: '2024/11/08' },
    { tcgPlayerNumericId: 999, name: 'Base Set', releaseDate: '1999/01/09' },
    { tcgPlayerNumericId: 1000, name: 'Base Set', releaseDate: '2023/01/09' }, // homónimo moderno
  ];

  it('match único por nombre normalizado → su setId', () => {
    expect(matchSet(localSet(), remote)).toBe('1407');
  });

  it('nombre homónimo → desempata por AÑO de releaseDate', () => {
    expect(matchSet(localSet({ name: 'Base Set', releaseDate: '1999/01/09' }), remote)).toBe('999');
    expect(matchSet(localSet({ name: 'Base Set', releaseDate: '2023/01/09' }), remote)).toBe('1000');
  });

  it('sin match → null; homónimo sin desempate por año → null (no adivina)', () => {
    expect(matchSet(localSet({ name: 'Inexistente' }), remote)).toBeNull();
    expect(matchSet(localSet({ name: 'Base Set', releaseDate: null }), remote)).toBeNull();
  });

  it('empata aunque PPT prefije el nombre con su código de colección (bug prod: 0 precios)', () => {
    const remotePrefixed = [
      { tcgPlayerNumericId: 24688, name: 'ME05: Pitch Black', releaseDate: '2026/07/17' },
      { tcgPlayerNumericId: 24722, name: 'ME: 30th Celebration', releaseDate: '2026/06/16' },
    ];
    // El catálogo local (pokemontcg.io) lo llama "Pitch Black" sin el prefijo "ME05:".
    expect(matchSet(localSet({ name: 'Pitch Black', releaseDate: '2026/07/17' }), remotePrefixed)).toBe(
      '24688',
    );
    expect(
      matchSet(localSet({ name: '30th Celebration', releaseDate: '2026/06/16' }), remotePrefixed),
    ).toBe('24722');
  });
});

describe('resolveForSets — persiste, loguea no-mapeados, money-safe ante daily', () => {
  function prismaMock() {
    return { cardSet: { update: jest.fn(async () => ({})) } } as any;
  }
  function clientMock(impl: () => Promise<any>) {
    return { getJson: jest.fn(impl) } as unknown as PptApiClient;
  }

  it('usa el pptSetId YA cacheado sin pedir /sets', async () => {
    const client = clientMock(async () => {
      throw new Error('no debió pedirse');
    });
    const mapper = new PptSetMapper(prismaMock(), client);
    const out = await mapper.resolveForSets([localSet({ pptSetId: '1407' })]);
    expect(out.get('local-1')).toBe('1407');
    expect((client.getJson as jest.Mock)).not.toHaveBeenCalled();
  });

  it('resuelve, PERSISTE el pptSetId y devuelve el mapa', async () => {
    const prisma = prismaMock();
    const client = clientMock(async () => ({
      body: { data: [{ tcgPlayerNumericId: 1407, name: 'Surging Sparks', releaseDate: '2024/11/08' }] },
      dailyRemaining: 19000,
    }));
    const mapper = new PptSetMapper(prisma, client);
    const out = await mapper.resolveForSets([localSet()]);
    expect(out.get('local-1')).toBe('1407');
    expect(prisma.cardSet.update).toHaveBeenCalledWith({ where: { id: 'local-1' }, data: { pptSetId: '1407' } });
  });

  it('set sin match → null, NO persiste (queda para loguear)', async () => {
    const prisma = prismaMock();
    const client = clientMock(async () => ({ body: { data: [] }, dailyRemaining: 1 }));
    const mapper = new PptSetMapper(prisma, client);
    const out = await mapper.resolveForSets([localSet()]);
    expect(out.get('local-1')).toBeNull();
    expect(prisma.cardSet.update).not.toHaveBeenCalled();
  });

  it('cuota DIARIA agotada al pedir /sets → money-safe: mapa con lo cacheado, sin reventar', async () => {
    const prisma = prismaMock();
    const client = clientMock(async () => {
      throw new PptDailyLimitError('u', null, 0);
    });
    const mapper = new PptSetMapper(prisma, client);
    const out = await mapper.resolveForSets([localSet(), localSet({ id: 'local-2', pptSetId: '55' })]);
    expect(out.get('local-1')).toBeNull(); // no se pudo mapear esta corrida
    expect(out.get('local-2')).toBe('55'); // ya cacheado se conserva
    expect(prisma.cardSet.update).not.toHaveBeenCalled();
  });

  it('la lista /sets se pide UNA sola vez (caché en memoria)', async () => {
    const client = clientMock(async () => ({
      body: { data: [{ tcgPlayerNumericId: 1, name: 'Surging Sparks', releaseDate: '2024/11/08' }] },
      dailyRemaining: 1,
    }));
    const mapper = new PptSetMapper(prismaMock(), client);
    await mapper.resolveForSets([localSet()]);
    await mapper.resolveForSets([localSet({ id: 'local-3', name: 'Surging Sparks' })]);
    expect((client.getJson as jest.Mock)).toHaveBeenCalledTimes(1);
  });
});
