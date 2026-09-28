import { MetaCardGroup, MetaMatchStatus } from '@prisma/client';
import { DeckImageCard, DeckImageLine, pickDeckImage } from './deck-image';

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
    expect(pickDeckImage({ deckName: 'Dragapult', imageCardId: null, coverCard: null, cards })).toBe(img('twm-130'));
  });

  it('nombre de deck con «ex» explícito ⇒ misma carta', () => {
    const cards = [line('Dreepy', 4, { externalId: 'twm-128' }), line('Latias ex', 3, { externalId: 'latias' }), line('Dragapult ex', 2, { externalId: 'twm-130' })];
    expect(pickDeckImage({ deckName: 'Dragapult ex', imageCardId: null, coverCard: null, cards })).toBe(img('twm-130'));
  });

  it('deck de dos nombres con «/» ⇒ la ex del PRIMER nombre, aunque la otra tenga más copias y vaya antes', () => {
    const cards = [
      line('Jellicent ex', 3, { externalId: 'jel' }),
      line('Ralts', 4, { externalId: 'ralts' }),
      line('Gardevoir ex', 2, { externalId: 'gar' }),
    ];
    expect(pickDeckImage({ deckName: 'Gardevoir ex / Jellicent ex', imageCardId: null, coverCard: null, cards })).toBe(img('gar'));
  });

  it('deck de dos nombres estilo Limitless (separados por espacio) ⇒ el primero', () => {
    const cards = [
      line('Pidgeot ex', 3, { externalId: 'pid' }),
      line('Charmander', 3, { externalId: 'chm' }),
      line('Charizard ex', 2, { externalId: 'chz' }),
    ];
    expect(pickDeckImage({ deckName: 'Charizard Pidgeot', imageCardId: null, coverCard: null, cards })).toBe(img('chz'));
  });

  it('mayúsculas y «EX» de era vieja ⇒ coincide sin importar caja', () => {
    const cards = [line('Dreepy', 4, { externalId: 'd' }), line('Latias ex', 3, { externalId: 'latias' }), line('Dragapult EX', 2, { externalId: 'dx' })];
    expect(pickDeckImage({ deckName: 'DRAGAPULT', imageCardId: null, coverCard: null, cards })).toBe(img('dx'));
    expect(pickDeckImage({ deckName: 'dragapult ex', imageCardId: null, coverCard: null, cards })).toBe(img('dx'));
  });

  it('«Mega …»: la Mega ex gana a la preevolución y a la ex no-Mega aunque ésta tenga más copias', () => {
    const cards = [
      line('Drilbur', 4, { externalId: 'dri' }),
      line('Excadrill ex', 3, { externalId: 'exc' }),
      line('Mega Excadrill ex', 2, { externalId: 'mexc' }),
    ];
    expect(pickDeckImage({ deckName: 'Mega Excadrill', imageCardId: null, coverCard: null, cards })).toBe(img('mexc'));
  });

  it('forma con prefijo («Teal Mask Ogerpon ex») casa con el deck «Ogerpon» por especie; el nombre completo gana a la especie', () => {
    const cards = [line('Budew', 4, { externalId: 'b' }), line('Latias ex', 3, { externalId: 'latias' }), line('Teal Mask Ogerpon ex', 2, { externalId: 'og' })];
    expect(pickDeckImage({ deckName: 'Ogerpon', imageCardId: null, coverCard: null, cards })).toBe(img('og'));
    const rb = [
      line('Teal Mask Ogerpon ex', 4, { externalId: 'og' }),
      line('Raging Bolt ex', 2, { externalId: 'rb' }),
    ];
    expect(pickDeckImage({ deckName: 'Raging Bolt Ogerpon', imageCardId: null, coverCard: null, cards: rb })).toBe(img('rb'));
  });

  it('a igual posición, el nombre completo gana a la especie: deck «Excadrill» ⇒ «Excadrill ex», no «Mega Excadrill ex»', () => {
    const cards = [
      line('Mega Excadrill ex', 3, { externalId: 'mexc' }),
      line('Excadrill ex', 1, { externalId: 'exc' }),
    ];
    expect(pickDeckImage({ deckName: 'Excadrill', imageCardId: null, coverCard: null, cards })).toBe(img('exc'));
  });

  it('apóstrofo tipográfico y acentos se normalizan («N’s Zoroark» ⇒ «N\'s Zoroark ex»)', () => {
    const cards = [line("N's Zorua", 4, { externalId: 'zorua' }), line('Latias ex', 4, { externalId: 'latias' }), line("N's Zoroark ex", 3, { externalId: 'zor' })];
    expect(pickDeckImage({ deckName: 'N’s Zoroark', imageCardId: null, coverCard: null, cards })).toBe(img('zor'));
    const flab = [line('Budew', 2, { externalId: 'b' }), line('Latias ex', 3, { externalId: 'latias' }), line('Flabébé ex', 1, { externalId: 'f' })];
    expect(pickDeckImage({ deckName: 'Flabebe', imageCardId: null, coverCard: null, cards: flab })).toBe(img('f'));
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
    expect(pickDeckImage({ deckName: 'Basic Box', imageCardId: null, coverCard: null, cards })).toBe(img('tera-a'));
  });

  it('ex detectada por subtypes aunque el nombre no la lleve', () => {
    const cards = [line('Budew', 3, { externalId: 'budew' }), line('Oddball', 1, { externalId: 'odd', subtypes: ['Basic', 'ex'] })];
    expect(pickDeckImage({ deckName: 'Basic Box', imageCardId: null, coverCard: null, cards })).toBe(img('odd'));
  });

  it('deck sin ex ⇒ la Pokémon con MÁS copias, no la primera', () => {
    const cards = [
      line('Budew', 1, { externalId: 'budew' }),
      line('Snorlax', 3, { externalId: 'snor' }),
      line('Squawkabilly', 2, { externalId: 'squ' }),
    ];
    expect(pickDeckImage({ deckName: 'Basic Box', imageCardId: null, coverCard: null, cards })).toBe(img('snor'));
  });

  it('el titular sin ex coincide por nombre ⇒ esa carta (Alakazam), no una ex de apoyo', () => {
    const cards = [
      line('Abra', 4, { externalId: 'abra' }),
      line('Kadabra', 3, { externalId: 'kad' }),
      line('Alakazam', 3, { externalId: 'ala' }),
      line('Fezandipiti ex', 1, { externalId: 'fez' }),
      line('Dudunsparce ex', 2, { externalId: 'dud' }),
    ];
    expect(pickDeckImage({ deckName: 'Alakazam', imageCardId: null, coverCard: null, cards })).toBe(img('ala'));
  });

  it('imageCardId configurado por el admin SIGUE ganando (aunque sea una básica)', () => {
    const cards = [line('Dragapult ex', 3, { externalId: 'twm-130' }), line('Dreepy', 4, { externalId: 'twm-128', id: 'dreepy-id' })];
    expect(pickDeckImage({ deckName: 'Dragapult', imageCardId: 'dreepy-id', coverCard: null, cards })).toBe(img('twm-128'));
  });

  it('imageCardId que ya no está en la lista ⇒ cae a la regla automática', () => {
    const cards = [line('Dreepy', 4, { externalId: 'twm-128' }), line('Dragapult ex', 3, { externalId: 'twm-130' })];
    expect(pickDeckImage({ deckName: 'Dragapult', imageCardId: 'fantasma', coverCard: null, cards })).toBe(img('twm-130'));
  });

  it('varias impresiones de la misma ex ⇒ determinista: más copias en su línea, luego externalId ascendente; no depende del orden', () => {
    const a = line('Dragapult ex', 1, { externalId: 'twm-200' });
    const b = line('Dragapult ex', 2, { externalId: 'twm-130' });
    const c = line('Dragapult ex', 2, { externalId: 'prsv-99' });
    const dreepy = line('Dreepy', 4, { externalId: 'twm-128' });
    const expected = img('prsv-99'); // empate 2–2 ⇒ 'prsv-99' < 'twm-130'
    expect(pickDeckImage({ deckName: 'Dragapult', imageCardId: null, coverCard: null, cards: [dreepy, a, b, c] })).toBe(expected);
    expect(pickDeckImage({ deckName: 'Dragapult', imageCardId: null, coverCard: null, cards: [c, b, a, dreepy] })).toBe(expected);
    expect(pickDeckImage({ deckName: 'Dragapult', imageCardId: null, coverCard: null, cards: [b, dreepy, c, a] })).toBe(expected);
  });

  it('ignora no casadas, no-Pokémon y cartas sin imagen', () => {
    const cards = [
      line('Dragapult ex', 4, { externalId: 'noimg', noImage: true }),
      line('Dragapult ex', 4, { externalId: 'unm', status: MetaMatchStatus.unmatched_set }),
      line('Dragapult ex', 4, { externalId: 'tr', group: MetaCardGroup.trainer }),
      line('Dreepy', 4, { externalId: 'twm-128' }),
      line('Dragapult ex', 1, { externalId: 'ok' }),
    ];
    expect(pickDeckImage({ deckName: 'Dragapult', imageCardId: null, coverCard: null, cards })).toBe(img('ok'));
  });

  it('nada casado con imagen ⇒ null (nunca arte externo)', () => {
    expect(pickDeckImage({ deckName: 'Dragapult', imageCardId: null, coverCard: null, cards: [] })).toBeNull();
    expect(pickDeckImage({ deckName: 'Dragapult', imageCardId: null, coverCard: null, cards: [line('Dreepy', 4, { status: MetaMatchStatus.unmatched_set })] })).toBeNull();
  });

  it('coincidencia por palabra completa: «Dragapult» NO casa con «Dragapultito ex»', () => {
    const cards = [line('Dragapultito ex', 3, { externalId: 'fake' }), line('Dragapult ex', 1, { externalId: 'real' })];
    expect(pickDeckImage({ deckName: 'Dragapult', imageCardId: null, coverCard: null, cards })).toBe(img('real'));
  });
});

/**
 * rev `decks-portada` (API_CONTRACT §13 «Portada del deck», ARCHITECTURE §12.4.4/§12.4.6) — D1–D7.
 * Orden normativo: 1 admin › 2 portada de Limitless casada (`coverCard`) › 3 por nombre en UN solo
 * conjunto («manda el primero nombrado», sea ex o no) › 4 ex con más copias › 5 Pokémon con más copias.
 */
describe('pickDeckImage — portada de Limitless y «manda el primero nombrado» (§12.4.6 D1–D7)', () => {
  const cover = (externalId: string, over: { noImage?: boolean; name?: string } = {}): DeckImageCard => ({
    id: `cover-${externalId}`,
    externalId,
    name: over.name ?? 'Portada',
    subtypes: null,
    imageLargeUrl: over.noImage ? null : `https://img/${externalId}.png`,
    imageSmallUrl: null,
  });

  it('D1 · el ADMIN gana a la portada: imageCardId en la lista + coverCard distinta ⇒ la del admin', () => {
    const cards = [line('Dragapult ex', 3, { externalId: 'twm-130' }), line('Dreepy', 4, { externalId: 'twm-128', id: 'dreepy-id' })];
    expect(pickDeckImage({ deckName: 'Dragapult', imageCardId: 'dreepy-id', coverCard: cover('twm-130-alt'), cards })).toBe(img('twm-128'));
  });

  it('D2 · la portada gana al nombre y NO exige estar entre las 60 (otra impresión fuera de la lista)', () => {
    const cards = [line('Dreepy', 4, { externalId: 'twm-128' }), line('Dragapult ex', 3, { externalId: 'twm-130' })];
    const c = cover('prsv-99', { name: 'Dragapult ex' });
    expect(cards.some((l) => l.matchedCard?.id === c.id)).toBe(false); // la portada NO está en la lista
    expect(pickDeckImage({ deckName: 'Dragapult', imageCardId: null, coverCard: c, cards })).toBe(img('prsv-99'));
  });

  it('D3 · «Basic Box» ⇒ la PORTADA (TWM-25), no Terapagos ex (que gana sin portada)', () => {
    const cards = [
      line('Budew', 1, { externalId: 'budew' }),
      line('Fezandipiti ex', 1, { externalId: 'fez' }),
      line('Terapagos ex', 1, { externalId: 'tera-a' }),
      line('Hop’s Cramorant', 4, { externalId: 'cram' }),
      line('Terapagos ex', 1, { externalId: 'tera-b' }),
    ];
    // Sin portada, la regla 4 da Terapagos ex (candado de que la portada es lo que cambia el resultado).
    expect(pickDeckImage({ deckName: 'Basic Box', imageCardId: null, coverCard: null, cards })).toBe(img('tera-a'));
    expect(pickDeckImage({ deckName: 'Basic Box', imageCardId: null, coverCard: cover('twm-25'), cards })).toBe(img('twm-25'));
  });

  it('D4 · portada SIN imagen ⇒ cae a la regla por nombre (no devuelve null)', () => {
    const cards = [line('Dreepy', 4, { externalId: 'twm-128' }), line('Dragapult ex', 3, { externalId: 'twm-130' })];
    expect(pickDeckImage({ deckName: 'Dragapult', imageCardId: null, coverCard: cover('noimg', { noImage: true }), cards })).toBe(img('twm-130'));
  });

  it('D5 · «Alakazam Mew»: Alakazam (no-ex, 3) + Mew ex (2) ⇒ Alakazam (manda el primero nombrado, sea ex o no)', () => {
    const cards = [line('Mew ex', 2, { externalId: 'mew' }), line('Alakazam', 3, { externalId: 'ala' })];
    expect(pickDeckImage({ deckName: 'Alakazam Mew', imageCardId: null, coverCard: null, cards })).toBe(img('ala'));
  });

  it('D6 · «Mew Alakazam» con las mismas cartas ⇒ Mew ex (espejo)', () => {
    const cards = [line('Alakazam', 3, { externalId: 'ala' }), line('Mew ex', 2, { externalId: 'mew' })];
    expect(pickDeckImage({ deckName: 'Mew Alakazam', imageCardId: null, coverCard: null, cards })).toBe(img('mew'));
  });

  it('D7 · (ii) completa<especie ANTES que (iii) ex<no-ex: «Excadrill» ⇒ Excadrill; «Pikachu» ⇒ Pikachu ex', () => {
    const exc = [line('Mega Excadrill ex', 3, { externalId: 'mexc' }), line('Excadrill', 2, { externalId: 'exc' })];
    expect(pickDeckImage({ deckName: 'Excadrill', imageCardId: null, coverCard: null, cards: exc })).toBe(img('exc'));
    // Pikachu no-ex con MÁS copias: sólo (iii) hace ganar a la ex (si se quita, ganaría por copias).
    const pika = [line('Pikachu', 4, { externalId: 'pika' }), line('Pikachu ex', 2, { externalId: 'pikaex' })];
    expect(pickDeckImage({ deckName: 'Pikachu', imageCardId: null, coverCard: null, cards: pika })).toBe(img('pikaex'));
  });
});
