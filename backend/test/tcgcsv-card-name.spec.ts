/**
 * tcgcsv-card-name.spec.ts — P-PROMOS opción C (ARCHITECTURE §5.12): parser puro de nombres de TCGCSV.
 * Nombres tomados de TCGCSV 24451 «ME: Mega Evolution Promo» (medido 2026-11-07).
 *
 *  - PROMO-B1: «Pikachu ex - 107 (30th Celebration)» ⇒ #107 y name CON el paréntesis (mutar: descartar el paréntesis).
 *  - PROMO-B2 (parte pura): «Paradise Resort - 092 (World Championships 2026) [Staff]» ⇒ sello `staff`, label «Staff»,
 *    nombre base sin el sello (mutar: no separar el sello ⇒ carta propia con «[Staff]» en el nombre).
 *  - PROMO-B7: sin `Number` ⇒ `no_number` (mutar: tomar el número del nombre).
 *  - Sello desconocido ⇒ `unknown_stamp` (nunca `other`); número del nombre ≠ Number ⇒ `number_mismatch`.
 */
import {
  exceedsFieldLimits,
  isTcgcsvOrigin,
  parseTcgcsvCardName,
  stampTypeFromLabel,
  tcgcsvCardExternalId,
  tcgcsvSetExternalId,
} from '../src/modules/catalog/tcgcsv-card-name';

describe('P-PROMOS — parseTcgcsvCardName', () => {
  it('PROMO-B1: «Pikachu ex - 107 (30th Celebration)» ⇒ carta 107, nombre con el paréntesis', () => {
    expect(parseTcgcsvCardName('Pikachu ex - 107 (30th Celebration)', '107')).toEqual({
      ok: true,
      name: 'Pikachu ex (30th Celebration)',
      number: '107',
      stamp: null,
    });
  });

  it('PROMO-B1: forma sin guion «Pikachu ex 107 (30th Celebration)» ⇒ mismo resultado', () => {
    expect(parseTcgcsvCardName('Pikachu ex 107 (30th Celebration)', '107')).toEqual({
      ok: true,
      name: 'Pikachu ex (30th Celebration)',
      number: '107',
      stamp: null,
    });
  });

  it('otro paréntesis junto a (30th Celebration) ⇒ unknown_stamp (solo (30th Celebration) se conserva)', () => {
    expect(parseTcgcsvCardName('Nidorina - 101 (30th Celebration) (Pokemon Center Exclusive)', '101')).toEqual({ ok: false, reason: 'unknown_stamp' });
  });

  it('PROMO-B2: «Paradise Resort - 092 [Staff]» ⇒ sello staff y nombre base sin «[Staff]» (conserva ceros del número)', () => {
    expect(parseTcgcsvCardName('Paradise Resort - 092 [Staff]', '092')).toEqual({
      ok: true,
      name: 'Paradise Resort',
      number: '092',
      stamp: { type: 'staff', label: 'Staff' },
    });
    // La base (sin sello) produce EXACTAMENTE el mismo nombre/número ⇒ así se empata el sello con su base.
    expect(parseTcgcsvCardName('Paradise Resort - 092', '092')).toMatchObject({ name: 'Paradise Resort', number: '092', stamp: null });
  });

  it('(Prerelease) y (Winner) ⇒ sello aparte (no se quedan en el nombre); también sin guion', () => {
    expect(parseTcgcsvCardName('Toxtricity (Prerelease)', '017')).toEqual({
      ok: true,
      name: 'Toxtricity',
      number: '017',
      stamp: { type: 'prerelease', label: 'Prerelease' },
    });
    expect(parseTcgcsvCardName('Pikachu - 093 (Winner)', '093')).toEqual({
      ok: true,
      name: 'Pikachu',
      number: '093',
      stamp: { type: 'championship', label: 'Winner' },
    });
  });

  it('paréntesis/corchete desconocido ⇒ unknown_stamp (Pitch Black Stamped, Pokemon Center Exclusive, World Championships 2026, Cosmos Holo, Asia Championship Series)', () => {
    for (const [n, num] of [
      ['Slowbro - 083 (Pitch Black Stamped)', '083'],
      ['Alakazam - 009 (Pokemon Center Exclusive)', '009'],
      ['Paradise Resort - 092 (World Championships 2026)', '092'],
      ['Paradise Resort - 092 (World Championships 2026) [Staff]', '092'],
      ['Drifloon - 005 (Cosmos Holo)', '005'],
      ['Celebratory Fanfare (Asia Championship Series 24-25)', '028'],
      ['Foo - 200 [Mystery Stamp]', '200'],
    ] as const) {
      expect(parseTcgcsvCardName(n, num)).toEqual({ ok: false, reason: 'unknown_stamp' });
    }
  });

  it('dos sellos distintos en un mismo nombre ⇒ unknown_stamp', () => {
    expect(parseTcgcsvCardName('Foo - 001 (Prerelease) [Staff]', '001')).toEqual({ ok: false, reason: 'unknown_stamp' });
  });

  it('topes de campo (PRM-3): name ≤ 200, number ≤ 16, rarity/stampLabel ≤ 64', () => {
    const ok = { name: 'a'.repeat(200), number: '1'.repeat(16), rarity: 'r'.repeat(64), stampLabel: 's'.repeat(64) };
    expect(exceedsFieldLimits(ok)).toBe(false);
    expect(exceedsFieldLimits({ ...ok, name: 'a'.repeat(201) })).toBe(true);
    expect(exceedsFieldLimits({ ...ok, number: '1'.repeat(17) })).toBe(true);
    expect(exceedsFieldLimits({ ...ok, rarity: 'r'.repeat(65) })).toBe(true);
    expect(exceedsFieldLimits({ ...ok, stampLabel: 's'.repeat(65) })).toBe(true);
  });

  it('número con «/» en Number: «057/191» ⇒ «057»', () => {
    expect(parseTcgcsvCardName('Shelmet - 057/191', '057/191')).toMatchObject({ ok: true, name: 'Shelmet', number: '057' });
  });

  it('PROMO-B7: sin Number ⇒ no_number (sellado u otro producto), aunque el nombre traiga dígitos', () => {
    expect(parseTcgcsvCardName('Mega Evolution Promo Pack - 3', null)).toEqual({ ok: false, reason: 'no_number' });
    expect(parseTcgcsvCardName('Meganium - 001', '  ')).toEqual({ ok: false, reason: 'no_number' });
  });

  it('corchete desconocido ⇒ unknown_stamp (jamás se inventa `other`)', () => {
    expect(parseTcgcsvCardName('Foo - 200 [Mystery Stamp]', '200')).toEqual({ ok: false, reason: 'unknown_stamp' });
  });

  it('número del nombre distinto de Number ⇒ number_mismatch', () => {
    expect(parseTcgcsvCardName('Pikachu ex - 107 (30th Celebration)', '108')).toEqual({ ok: false, reason: 'number_mismatch' });
    expect(parseTcgcsvCardName('Pikachu ex 107 (30th Celebration)', '108')).toEqual({ ok: false, reason: 'number_mismatch' });
  });

  it('nombre que queda vacío ⇒ empty_name', () => {
    expect(parseTcgcsvCardName(' - 001', '001')).toEqual({ ok: false, reason: 'empty_name' });
  });

  it('sellos reconocidos: Staff, Prerelease, Championship/Campeonato', () => {
    expect(stampTypeFromLabel('Staff')).toBe('staff');
    expect(stampTypeFromLabel('Prerelease')).toBe('prerelease');
    expect(stampTypeFromLabel('Pre-Release')).toBe('prerelease');
    expect(stampTypeFromLabel('Championship')).toBe('championship');
    expect(stampTypeFromLabel('Campeonato')).toBe('championship');
    expect(stampTypeFromLabel('League')).toBeNull();
  });
});

describe('P-PROMOS — marca de origen', () => {
  it('isTcgcsvOrigin solo reconoce el prefijo «tcgcsv:» (pokemontcg.io nunca usa «:»)', () => {
    expect(isTcgcsvOrigin(tcgcsvSetExternalId(24451))).toBe(true);
    expect(isTcgcsvOrigin(tcgcsvCardExternalId(713257))).toBe(true);
    expect(isTcgcsvOrigin('sv8')).toBe(false);
    expect(isTcgcsvOrigin('svp-1')).toBe(false);
    expect(isTcgcsvOrigin(null)).toBe(false);
    expect(isTcgcsvOrigin(undefined)).toBe(false);
  });
});
