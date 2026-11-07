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

  it('dos paréntesis se conservan: «Nidorina - 101 (30th Celebration) (Pokemon Center Exclusive)»', () => {
    const r = parseTcgcsvCardName('Nidorina - 101 (30th Celebration) (Pokemon Center Exclusive)', '101');
    expect(r).toMatchObject({ ok: true, name: 'Nidorina (30th Celebration) (Pokemon Center Exclusive)', number: '101' });
  });

  it('PROMO-B2: «Paradise Resort - 092 (…) [Staff]» ⇒ sello staff y nombre base sin «[Staff]» (conserva ceros del número)', () => {
    expect(parseTcgcsvCardName('Paradise Resort - 092 (World Championships 2026) [Staff]', '092')).toEqual({
      ok: true,
      name: 'Paradise Resort (World Championships 2026)',
      number: '092',
      stamp: { type: 'staff', label: 'Staff' },
    });
    // La base (sin sello) produce EXACTAMENTE el mismo nombre/número ⇒ así se empata el sello con su base.
    expect(parseTcgcsvCardName('Paradise Resort - 092 (World Championships 2026)', '092')).toMatchObject({
      name: 'Paradise Resort (World Championships 2026)',
      number: '092',
      stamp: null,
    });
  });

  it('número con «/» en Number: «057/191» ⇒ «057»', () => {
    expect(parseTcgcsvCardName('Shelmet - 057/191', '057/191')).toMatchObject({ ok: true, name: 'Shelmet', number: '057' });
  });

  it('PROMO-B7: sin Number ⇒ no_number (sellado u otro producto), aunque el nombre traiga dígitos', () => {
    expect(parseTcgcsvCardName('Mega Evolution Promo Pack - 3', null)).toEqual({ ok: false, reason: 'no_number' });
    expect(parseTcgcsvCardName('Meganium - 001', '  ')).toEqual({ ok: false, reason: 'no_number' });
  });

  it('sello desconocido ⇒ unknown_stamp (jamás se inventa `other`)', () => {
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
