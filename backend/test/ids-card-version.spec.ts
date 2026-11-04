/**
 * ids-card-version.spec.ts — v1.116⟨ids⟩ (API_CONTRACT §IDS.2/.3/.5). Propiedad: backend.
 *
 *  - **IDS-B19** `finishLabelOf`: la tabla completa de §IDS.5 (incluye «COSMOS  holo» y `stampLabel null`).
 *  - `versionKeyOf` / `optionKeyOf` (§IDS.5, D-IDS-O) y `scaleByPct` (×X half-up, §IDS.2).
 *  - `stampTypeOf` (§IDS.3, D-IDS-F): 22880 ⇒ prize_pack; 1539 por sufijo, fallando cerrado.
 *  - `baseMatchKey` / `catalogMatchKey` (§IDS.3): «Pikachu ex - 057/191» de 22880 ⇒ misma llave que el set_base 590025.
 * Deterministas (N=1).
 */
import { StampType } from '@prisma/client';
import {
  baseMatchKey,
  catalogMatchKey,
  finishLabelOf,
  optionKeyOf,
  pieceVersionOf,
  scaleByPct,
  stampTypeOf,
  validateSpanishMarketPct,
  versionInternalLineOf,
  versionDtoOf,
  versionKeyOf,
  StampRef,
} from '../src/common/card-version';

describe('IDS-B19 — finishLabelOf: la tabla de §IDS.5', () => {
  it.each([
    ['normal', null, 'non_holo'],
    ['holofoil', null, 'holo'],
    ['reverse_holo', null, 'reverse_holo'],
    ['first_edition_holofoil', null, 'first_edition_holo'],
    ['normal', 'Left Stamp', 'non_holo'],
    ['holofoil', 'Prize Pack Series 6', 'holo'],
    ['holofoil', 'Cosmos Holo', 'cosmos_holo'],
    ['holofoil', 'COSMOS  holo', 'cosmos_holo'],
    ['normal', 'cosmosholo', 'cosmos_holo'],
    ['reverse_holo', 'Cosmos Holo', 'cosmos_holo'],
    ['reverse_holo', 'Prize Pack, Cosmos Holo', 'cosmos_holo'],
  ] as const)('(%s, %s) ⇒ %s', (finish, label, expected) => {
    expect(finishLabelOf(finish, label)).toBe(expected);
  });
});

describe('§IDS.5 — claves de versión y de opción', () => {
  it('versionKeyOf', () => {
    expect(versionKeyOf('en', null)).toBe('en');
    expect(versionKeyOf('es', null)).toBe('es');
    expect(versionKeyOf('en', 703819)).toBe('en.703819');
    expect(versionKeyOf('es', 703819)).toBe('es.703819');
  });
  it('optionKeyOf: sin liga = version.key; con liga = version.key.finish', () => {
    expect(optionKeyOf('es', false, 'holofoil')).toBe('es');
    expect(optionKeyOf('es.703819', true, 'holofoil')).toBe('es.703819.holofoil');
  });
  it('pieceVersionOf: un cardProductId que no es stamped no es versión de liga', () => {
    const stamp: StampRef = { productId: 703819, internalId: 'u', type: 'prize_pack', label: 'Cosmos Holo', finishes: ['holofoil'] };
    const stamps = new Map([[703819, stamp]]);
    expect(pieceVersionOf({ language: 'en', cardProductId: 542659 }, stamps)).toEqual({ language: 'en', stamp: null });
    expect(pieceVersionOf({ language: 'es', cardProductId: 703819 }, stamps)).toEqual({ language: 'es', stamp });
    expect(versionDtoOf(pieceVersionOf({ language: 'es', cardProductId: 703819 }, stamps))).toEqual({
      key: 'es.703819',
      language: 'es',
      stamp: { type: 'prize_pack', label: 'Cosmos Holo', productId: 703819 },
    });
  });
});

describe('§IDS.2 — ×X entero half-up', () => {
  it.each([
    [10_000, 75, 7_500],
    [1, 75, 1], // 0.75 ⇒ 1
    [2, 75, 2], // 1.5 ⇒ 2 (half-up)
    [3, 50, 2], // 1.5 ⇒ 2
    [5, 10, 1], // 0.5 ⇒ 1
    [4, 10, 0], // 0.4 ⇒ 0
    [12_345, 100, 12_345],
    [12_345, 200, 24_690],
  ])('%i × %i %% = %i', (r, x, out) => {
    expect(scaleByPct(r, x)).toBe(out);
  });
  it('validateSpanishMarketPct: entero en [1, 200]', () => {
    for (const ok of [1, 75, 200]) expect(validateSpanishMarketPct(ok)).toBeNull();
    for (const bad of ['', 0, -1, 201, 7.5, 'a', null, '75']) expect(validateSpanishMarketPct(bad)).not.toBeNull();
  });
});

describe('§IDS.3 — stampTypeOf (por grupo y sufijo, falla cerrado)', () => {
  it('22880 ⇒ prize_pack siempre; el paréntesis es el stampLabel', () => {
    expect(stampTypeOf(22880, 'Pikachu ex - 057/191')).toEqual({ type: 'prize_pack', label: null });
    expect(stampTypeOf(22880, 'Buddy-Buddy Poffin - 144/162 (Cosmos Holo)')).toEqual({ type: 'prize_pack', label: 'Cosmos Holo' });
    expect(stampTypeOf(22880, 'Kirlia - 068/195 (Left Stamp)')).toEqual({ type: 'prize_pack', label: 'Left Stamp' });
  });
  it.each([
    ['Volcanion - 25/114 (Pokemon League)', 'league', null],
    ['Pikachu - 1/1 (League Promo)', 'league', null],
    ['Machamp - 1/1 (League Challenge) [1st Place]', 'league', '1st Place'],
    ['Lugia - 1/1 (League Cup)', 'league', null],
    ['Buddy-Buddy Poffin - 144/162 (North America International Championship)', 'championship', null],
    ['Paradise Resort - 045 (World Championships 2023)', 'championship', null],
    ['Ultra Ball - 1/1 (Regional Championships)', 'championship', null],
    ['Buddy-Buddy Poffin - 144/162 (North America International Championship) [Staff]', 'staff', 'North America International Championship'],
    ['Quaquaval - 005 (Prerelease)', 'prerelease', null],
    ['Quaquaval - 005 (Prerelease) [Staff]', 'staff', 'Prerelease'],
  ] as const)('1539 %s ⇒ %s', (name, type, label) => {
    expect(stampTypeOf(1539, name)).toEqual({ type, label });
  });
  it('1539 sin sufijo reconocible ⇒ null (no se ofrece; campeonato nunca «De liga»)', () => {
    expect(stampTypeOf(1539, 'Professor Elm - 1/1')).toBeNull();
    expect(stampTypeOf(1539, 'Pikachu - 1/1 (Winner)')).toBeNull();
  });
  it('otro grupo ⇒ null', () => {
    expect(stampTypeOf(23651, 'Pikachu ex - 057/191')).toBeNull();
  });
});

describe('§IDS.3 — baseMatchKey: el empate con la carta base', () => {
  it('«Pikachu ex - 057/191» de 22880 empata con el set_base 590025 (nombre del producto con número)', () => {
    const theirs = baseMatchKey('Pikachu ex - 057/191', '057/191');
    const ours = catalogMatchKey({ name: 'Pikachu ex - 057/191', cardNumber: '57', printedTotal: 191 });
    expect(theirs).toBe('pikachu ex|57/191');
    expect(ours).toBe(theirs);
  });
  it('el paréntesis no cuenta: «(Cosmos Holo)» empata con la base', () => {
    expect(baseMatchKey('Buddy-Buddy Poffin - 144/162 (Cosmos Holo)', '144/162')).toBe(
      catalogMatchKey({ name: 'Buddy-Buddy Poffin - 144/162', cardNumber: '144', printedTotal: 162 }),
    );
  });
  it('sin número en el nombre de nuestro producto ⇒ Card.number/printedTotal', () => {
    expect(catalogMatchKey({ name: 'Volcanion', cardNumber: '25', printedTotal: 114 })).toBe(baseMatchKey('Volcanion - 25/114 (Pokemon League)', '25/114'));
  });
  it('número dentro del nombre SIN guion y sin ceros (IDS-D1, DEVOPS_NOTES §108.4)', () => {
    expect(baseMatchKey('Shelmet 11/101 (Championship Series)', '11/101')).toBe('shelmet|11/101');
    expect(baseMatchKey('Butterfree FB - 17/147 (League Promo)', '017/147')).toBe(catalogMatchKey({ name: 'Butterfree FB', cardNumber: '17', printedTotal: 147 }));
    expect(baseMatchKey('Quaquaval - 005 (Prerelease)', '005')).toBe('quaquaval|5');
    // v1.116.2 (§IDS.3): sin total en el nombre ⇒ Card.number/printedTotal; nunca empata con un Number sin total.
    expect(catalogMatchKey({ name: 'Basic Fire Energy - 010', cardNumber: '10', printedTotal: 16 })).toBe('basic fire energy|10/16');
    expect(catalogMatchKey({ name: 'Basic Fire Energy - 010', cardNumber: '10', printedTotal: 16 })).not.toBe(baseMatchKey('Basic Fire Energy - 010', '010'));
  });
  it('sin Number ⇒ null (sobres, Code Cards)', () => {
    expect(baseMatchKey('Play! Pokemon Prize Pack Series One', null)).toBeNull();
    expect(catalogMatchKey({ name: 'Volcanion', cardNumber: null, printedTotal: 114 })).toBeNull();
  });
  it('nombre distinto o total distinto ⇒ llaves distintas', () => {
    expect(baseMatchKey('Pikachu ex - 057/191', '057/191')).not.toBe(baseMatchKey('Pikachu ex - 057/189', '057/189'));
    expect(baseMatchKey('Pikachu ex - 057/191', '057/191')).not.toBe(baseMatchKey('Pikachu V - 057/191', '057/191'));
  });
});

describe('§IDS.5 — versionInternalLine (hoja de preparación, texto de backend)', () => {
  it('ejemplo del contrato, 1539, español sin liga e inglés sin liga', () => {
    expect(versionInternalLineOf({ language: 'es', stampType: 'prize_pack', stampLabel: 'Cosmos Holo' })).toBe('ES · LIGA · Prize Pack — sello Play! Pokémon, Cosmos Holo');
    expect(versionInternalLineOf({ language: 'es', stampType: 'league', stampLabel: null })).toBe('ES · LIGA · Promo de Liga — sello de la Liga');
    expect(versionInternalLineOf({ language: 'es', stampType: null, stampLabel: null })).toBe('ES');
    expect(versionInternalLineOf({ language: 'en', stampType: null, stampLabel: null })).toBeNull();
  });

  /**
   * DESIGN_SYSTEM IDS-UX.3 «Cajón» (petición 7, TL-IDS-2): formato único `IDIOMA · GRUPO · Nombre — sello X[, detalle]` para los
   * CINCO tipos. La tabla es la del documento, literal; un tipo sin fila aquí no pasa el `satisfies`.
   */
  const IDS_UX3: Record<StampType, string> = {
    prize_pack: 'LIGA · Prize Pack — sello Play! Pokémon',
    league: 'LIGA · Promo de Liga — sello de la Liga',
    championship: 'TORNEO · Campeonato — sello de Campeonato',
    prerelease: 'EVENTO · Promo de Prerelease — sello Prerelease',
    staff: 'EVENTO · Promo Staff — sello Staff',
  };
  it.each(Object.keys(IDS_UX3) as StampType[])('IDS-UX.3 · %s: ES/EN, con y sin detalle', (t) => {
    expect(versionInternalLineOf({ language: 'es', stampType: t, stampLabel: null })).toBe(`ES · ${IDS_UX3[t]}`);
    expect(versionInternalLineOf({ language: 'en', stampType: t, stampLabel: null })).toBe(`EN · ${IDS_UX3[t]}`);
    expect(versionInternalLineOf({ language: 'es', stampType: t, stampLabel: 'Cosmos Holo' })).toBe(`ES · ${IDS_UX3[t]}, Cosmos Holo`);
  });
  it('los ejemplos de IDS-UX.3, literales', () => {
    expect(versionInternalLineOf({ language: 'en', stampType: 'staff', stampLabel: null })).toBe('EN · EVENTO · Promo Staff — sello Staff');
    expect(versionInternalLineOf({ language: 'es', stampType: 'championship', stampLabel: null })).toBe('ES · TORNEO · Campeonato — sello de Campeonato');
  });
});
