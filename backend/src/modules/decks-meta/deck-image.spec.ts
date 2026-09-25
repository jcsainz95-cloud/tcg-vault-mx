import { MetaCardGroup, MetaMatchStatus } from '@prisma/client';
import { DeckImageLine, pickDeckImage } from './deck-image';

/**
 * Arte de la teja de Meta Battle Decks. Pedido del dueño: «En las imágenes hay que poner la EX
 * representativa del deck» / «No cualquier carta en los decks». Los nombres de deck se modelan como
 * los trae Limitless (medido en `test/fixtures/limitless/home-index.html`: «Dragapult», «N's Zoroark»,
 * «Mega Excadrill», «Basic Box» — SIN el sufijo «ex»).
 */
let seq = 0;
function line(
  name: string,
  quantity: number,
  over: { externalId?: string; id?: string; group?: MetaCardGroup; status?: MetaMatchStatus; noImage?: boolean; subtypes?: string[] } = {},
): DeckImageLine {
  const externalId = over.externalId ?? `x-${++seq}`;
  const id = over.id ?? `id-${externalId}`;
  return {
    quantity,
    group: over.group ?? MetaCardGroup.pokemon,
    matchStatus: over.status ?? MetaMatchStatus.matched,
    matchedCard: {
      id,
      externalId,
      name,
      subtypes: over.subtypes ?? null,
      imageLargeUrl: over.noImage ? null : `https://img/${externalId}.png`,
      imageSmallUrl: null,
    },
  };
}
const img = (externalId: string) => `https://img/${externalId}.png`;

describe('pickDeckImage — la ex representativa del deck', () => {
  it('Dragapult (nombre Limitless, sin «ex») con Dreepy primero ⇒ Dragapult ex, no Dreepy', () => {
    const cards = [
      line('Dreepy', 4, { externalId: 'twm-128' }),
      line('Drakloak', 4, { externalId: 'twm-129' }),
      line('Latias ex', 3, { externalId: 'latias' }), // ex de apoyo con MÁS copias: no debe ganar
      line('Dragapult ex', 2, { externalId: 'twm-130' }),
    ];
    expect(pickDeckImage('Dragapult', null, cards)).toBe(img('twm-130'));
  });

  it('nombre de deck con «ex» explícito ⇒ misma carta', () => {
    const cards = [line('Dreepy', 4, { externalId: 'twm-128' }), line('Latias ex', 3, { externalId: 'latias' }), line('Dragapult ex', 2, { externalId: 'twm-130' })];
    expect(pickDeckImage('Dragapult ex', null, cards)).toBe(img('twm-130'));
  });

  it('deck de dos nombres con «/» ⇒ la ex del PRIMER nombre, aunque la otra tenga más copias y vaya antes', () => {
    const cards = [
      line('Jellicent ex', 3, { externalId: 'jel' }),
      line('Ralts', 4, { externalId: 'ralts' }),
      line('Gardevoir ex', 2, { externalId: 'gar' }),
    ];
    expect(pickDeckImage('Gardevoir ex / Jellicent ex', null, cards)).toBe(img('gar'));
  });

  it('deck de dos nombres estilo Limitless (separados por espacio) ⇒ el primero', () => {
    const cards = [
      line('Pidgeot ex', 3, { externalId: 'pid' }),
      line('Charmander', 3, { externalId: 'chm' }),
      line('Charizard ex', 2, { externalId: 'chz' }),
    ];
    expect(pickDeckImage('Charizard Pidgeot', null, cards)).toBe(img('chz'));
  });

  it('mayúsculas y «EX» de era vieja ⇒ coincide sin importar caja', () => {
    const cards = [line('Dreepy', 4, { externalId: 'd' }), line('Latias ex', 3, { externalId: 'latias' }), line('Dragapult EX', 2, { externalId: 'dx' })];
    expect(pickDeckImage('DRAGAPULT', null, cards)).toBe(img('dx'));
    expect(pickDeckImage('dragapult ex', null, cards)).toBe(img('dx'));
  });

  it('«Mega …»: la Mega ex gana a la preevolución y a la ex no-Mega aunque ésta tenga más copias', () => {
    const cards = [
      line('Drilbur', 4, { externalId: 'dri' }),
      line('Excadrill ex', 3, { externalId: 'exc' }),
      line('Mega Excadrill ex', 2, { externalId: 'mexc' }),
    ];
    expect(pickDeckImage('Mega Excadrill', null, cards)).toBe(img('mexc'));
  });

  it('forma con prefijo («Teal Mask Ogerpon ex») casa con el deck «Ogerpon» por especie; el nombre completo gana a la especie', () => {
    const cards = [line('Budew', 4, { externalId: 'b' }), line('Latias ex', 3, { externalId: 'latias' }), line('Teal Mask Ogerpon ex', 2, { externalId: 'og' })];
    expect(pickDeckImage('Ogerpon', null, cards)).toBe(img('og'));
    const rb = [
      line('Teal Mask Ogerpon ex', 4, { externalId: 'og' }),
      line('Raging Bolt ex', 2, { externalId: 'rb' }),
    ];
    expect(pickDeckImage('Raging Bolt Ogerpon', null, rb)).toBe(img('rb'));
  });

  it('apóstrofo tipográfico y acentos se normalizan («N’s Zoroark» ⇒ «N\'s Zoroark ex»)', () => {
    const cards = [line("N's Zorua", 4, { externalId: 'zorua' }), line('Latias ex', 4, { externalId: 'latias' }), line("N's Zoroark ex", 3, { externalId: 'zor' })];
    expect(pickDeckImage('N’s Zoroark', null, cards)).toBe(img('zor'));
    const flab = [line('Budew', 2, { externalId: 'b' }), line('Latias ex', 3, { externalId: 'latias' }), line('Flabébé ex', 1, { externalId: 'f' })];
    expect(pickDeckImage('Flabebe', null, flab)).toBe(img('f'));
  });

  it('ninguna ex coincide por nombre ⇒ la ex con MÁS copias (sumando impresiones), no la primera', () => {
    const cards = [
      line('Budew', 1, { externalId: 'budew' }),
      line('Fezandipiti ex', 1, { externalId: 'fez' }),
      line('Terapagos ex', 1, { externalId: 'tera-a' }),
      line('Hop’s Cramorant', 4, { externalId: 'cram' }),
      line('Terapagos ex', 1, { externalId: 'tera-b' }),
    ];
    // Terapagos ex suma 2 copias (dos impresiones) > Fezandipiti ex 1; Cramorant (4) no es ex.
    expect(pickDeckImage('Basic Box', null, cards)).toBe(img('tera-a'));
  });

  it('ex detectada por subtypes aunque el nombre no la lleve', () => {
    const cards = [line('Budew', 3, { externalId: 'budew' }), line('Oddball', 1, { externalId: 'odd', subtypes: ['Basic', 'ex'] })];
    expect(pickDeckImage('Basic Box', null, cards)).toBe(img('odd'));
  });

  it('deck sin ex ⇒ la Pokémon con MÁS copias, no la primera', () => {
    const cards = [
      line('Budew', 1, { externalId: 'budew' }),
      line('Snorlax', 3, { externalId: 'snor' }),
      line('Squawkabilly', 2, { externalId: 'squ' }),
    ];
    expect(pickDeckImage('Basic Box', null, cards)).toBe(img('snor'));
  });

  it('el titular sin ex coincide por nombre ⇒ esa carta (Alakazam), no una ex de apoyo', () => {
    const cards = [
      line('Abra', 4, { externalId: 'abra' }),
      line('Kadabra', 3, { externalId: 'kad' }),
      line('Alakazam', 3, { externalId: 'ala' }),
      line('Fezandipiti ex', 1, { externalId: 'fez' }),
      line('Dudunsparce ex', 2, { externalId: 'dud' }),
    ];
    expect(pickDeckImage('Alakazam', null, cards)).toBe(img('ala'));
  });

  it('imageCardId configurado por el admin SIGUE ganando (aunque sea una básica)', () => {
    const cards = [line('Dragapult ex', 3, { externalId: 'twm-130' }), line('Dreepy', 4, { externalId: 'twm-128', id: 'dreepy-id' })];
    expect(pickDeckImage('Dragapult', 'dreepy-id', cards)).toBe(img('twm-128'));
  });

  it('imageCardId que ya no está en la lista ⇒ cae a la regla automática', () => {
    const cards = [line('Dreepy', 4, { externalId: 'twm-128' }), line('Dragapult ex', 3, { externalId: 'twm-130' })];
    expect(pickDeckImage('Dragapult', 'fantasma', cards)).toBe(img('twm-130'));
  });

  it('varias impresiones de la misma ex ⇒ determinista: más copias en su línea, luego externalId ascendente; no depende del orden', () => {
    const a = line('Dragapult ex', 1, { externalId: 'twm-200' });
    const b = line('Dragapult ex', 2, { externalId: 'twm-130' });
    const c = line('Dragapult ex', 2, { externalId: 'prsv-99' });
    const dreepy = line('Dreepy', 4, { externalId: 'twm-128' });
    const expected = img('prsv-99'); // empate 2–2 ⇒ 'prsv-99' < 'twm-130'
    expect(pickDeckImage('Dragapult', null, [dreepy, a, b, c])).toBe(expected);
    expect(pickDeckImage('Dragapult', null, [c, b, a, dreepy])).toBe(expected);
    expect(pickDeckImage('Dragapult', null, [b, dreepy, c, a])).toBe(expected);
  });

  it('ignora no casadas, no-Pokémon y cartas sin imagen', () => {
    const cards = [
      line('Dragapult ex', 4, { externalId: 'noimg', noImage: true }),
      line('Dragapult ex', 4, { externalId: 'unm', status: MetaMatchStatus.unmatched_set }),
      line('Dragapult ex', 4, { externalId: 'tr', group: MetaCardGroup.trainer }),
      line('Dreepy', 4, { externalId: 'twm-128' }),
      line('Dragapult ex', 1, { externalId: 'ok' }),
    ];
    expect(pickDeckImage('Dragapult', null, cards)).toBe(img('ok'));
  });

  it('nada casado con imagen ⇒ null (nunca arte externo)', () => {
    expect(pickDeckImage('Dragapult', null, [])).toBeNull();
    expect(pickDeckImage('Dragapult', null, [line('Dreepy', 4, { status: MetaMatchStatus.unmatched_set })])).toBeNull();
  });

  it('coincidencia por palabra completa: «Dragapult» NO casa con «Dragapultito ex»', () => {
    const cards = [line('Dragapultito ex', 3, { externalId: 'fake' }), line('Dragapult ex', 1, { externalId: 'real' })];
    expect(pickDeckImage('Dragapult', null, cards)).toBe(img('real'));
  });
});
