// scripts/ids/ids-lib.test.mjs — prueba del instrumento IDS-D1/IDS-D2 (sin red ni BD).   · devops
//   node --test scripts/ids/ids-lib.test.mjs
// Los casos son nombres REALES de TCGCSV medidos el 2026-11-03 (DEVOPS_NOTES §108).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  baseMatchKey, baseName, normalizeNumber, stampTypeOf, classifyCardProductKind, buildBaseIndex, dryRunGroup,
  percentile, rowsPerBase, finishOf, isCosmos, matchGroupForSet,
} from './ids-lib.mjs';

test('número: ceros y total', () => {
  assert.equal(normalizeNumber('057/191'), '57/191');
  assert.equal(normalizeNumber('017/147'), normalizeNumber('17/147'));
  assert.equal(normalizeNumber('TG01/TG30'), 'TG01/TG30');
  assert.equal(normalizeNumber('005'), '5');
  assert.equal(normalizeNumber(''), null);
  assert.equal(normalizeNumber(null), null);
  // El total distingue: «17» (set antiguo sin total) NO empata con «17/147» (lectura literal del contrato).
  assert.notEqual(normalizeNumber('17'), normalizeNumber('17/147'));
});

test('nombre: quita paréntesis, corchetes y el número, con o sin guion', () => {
  assert.equal(baseName('Pikachu ex - 057/191'), 'pikachuex');
  assert.equal(baseName('Klefki - 66/119 (Pokemon League) [1st Place]'), 'klefki');
  assert.equal(baseName('Shelmet 11/101 (Championship Series) [Staff]'), 'shelmet');
  assert.equal(baseName('Pokémon Catcher - 175/198'), 'pokemoncatcher');
  assert.equal(baseName('Quaquaval - 005 (Prerelease) [Staff]'), 'quaquaval');
  assert.equal(baseName('Pikachu - XY202 (Pokemon League)'), 'pikachu');
  assert.equal(baseName('Porygon2'), 'porygon2'); // un dígito pegado al nombre NO es el número
  assert.equal(baseName("Boss's Orders [Cyrus] - 132/172 (Cosmos Holo)"), 'bosssorders');
  assert.equal(baseMatchKey('Butterfree FB - 17/147 (League Promo)', '017/147'), 'butterfreefb|17/147');
  assert.equal(baseMatchKey('Water Energy (2007-2008 League Promo)', null), null);
});

test('tipo: 22880 siempre prize_pack; 1539 por sufijo, falla cerrado', () => {
  assert.equal(stampTypeOf(22880, 'Pikachu ex - 057/191'), 'prize_pack');
  assert.equal(stampTypeOf(1539, 'Volcanion - 25/114 (Pokemon League)'), 'league');
  assert.equal(stampTypeOf(1539, 'Tsareena - 20/149 (League Challenge) [1st Place]'), 'league');
  assert.equal(stampTypeOf(1539, 'Quick Ball - 179/202 (League Cup)'), 'league');
  assert.equal(stampTypeOf(1539, 'Nest Ball - 123/149 (League Cup) [Staff]'), 'staff');
  assert.equal(stampTypeOf(1539, "Giovanni's Scheme - 138/162 (Regional Championships)"), 'championship');
  assert.equal(stampTypeOf(1539, 'Ultra Ball - 131/132 (North America International Championship)'), 'championship');
  assert.equal(stampTypeOf(22872, 'Quaquaval - 005 (Prerelease)'), 'prerelease');
  assert.equal(stampTypeOf(22872, 'Quaquaval - 005 (Prerelease) [Staff]'), 'staff');
  assert.equal(stampTypeOf(22872, 'Gouging Fire - 151 (Staff)'), 'staff');
  // Sin sufijo reconocible ⇒ null (no se ofrece): campeonato nunca «De liga».
  assert.equal(stampTypeOf(1539, 'Buddy-Buddy Poffin - 144/162'), null);
  assert.equal(stampTypeOf(1539, 'Torracat - 25/149 (Cosmos Holo)'), null);
  assert.equal(stampTypeOf(1539, 'Grass Energy - 105/114 (Play! Pokemon)'), null);
});

test('kind del universo base (réplica de classifyCardProductKind)', () => {
  assert.equal(classifyCardProductKind('Pikachu ex - 057/191'), 'set_base');
  assert.equal(classifyCardProductKind('Quaquaval - 005 (Prerelease)'), 'promo');
  assert.equal(classifyCardProductKind('Pikachu (Deck Exclusive)'), 'deck_exclusive');
  assert.equal(classifyCardProductKind(''), 'other');
});

test('acabado y Cosmos', () => {
  assert.equal(finishOf('Reverse Holofoil'), 'reverse_holo');
  assert.equal(finishOf('1st Edition Holofoil'), 'first_edition_holofoil');
  assert.equal(finishOf('Unlimited Holofoil'), null);
  assert.ok(isCosmos('Buddy-Buddy Poffin - 144/162 (Cosmos Holo)'));
  assert.ok(isCosmos('X - 1/2 (Cosmos Holofoil)'));
  assert.ok(!isCosmos('Pikachu ex - 057/191'));
});

test('corrida en seco: único, ambiguo, sin pareja, sin tipo, sin número; conPrecio solo > 0', () => {
  const idx = buildBaseIndex([
    { groupId: 1, products: [{ productId: 10, name: 'Pikachu ex - 057/191', number: '057/191' }] },
    { groupId: 2, products: [
      { productId: 20, name: 'Psychic Energy', number: '013' },
      { productId: 21, name: 'Quaquaval - 005 (Prerelease)', number: '005' }, // promo: fuera del universo
    ] },
    { groupId: 3, products: [{ productId: 30, name: 'Psychic Energy', number: '013' }] },
  ]);
  const prices = new Map([
    [100, [{ subTypeName: 'Holofoil', marketPrice: 26.39 }, { subTypeName: 'Normal', marketPrice: 0 }]],
    [101, [{ subTypeName: 'Normal', marketPrice: 1 }]],
  ]);
  const { summary, detail } = dryRunGroup(1539, [
    { productId: 100, name: 'Pikachu ex - 057/191 (League Promo)', number: '057/191' },
    { productId: 101, name: 'Psychic Energy - 013 (Pokemon League)', number: '013' },
    { productId: 102, name: 'Quaquaval - 005 (League Promo)', number: '005' },
    { productId: 103, name: 'Pikachu ex - 057/191', number: '057/191' },
    { productId: 104, name: 'Water Energy (2007-2008 League Promo)', number: null },
  ], prices, idx);
  assert.deepEqual(
    { c: summary.colgados, a: summary.ambiguos, s: summary.sinPareja, t: summary.sinTipo, n: summary.sinNumero, p: summary.conPrecio },
    { c: 1, a: 1, s: 1, t: 1, n: 1, p: 1 },
  );
  assert.equal(detail.find((d) => d.productId === 100).baseProductId, 10);
  assert.deepEqual(detail.find((d) => d.productId === 100).finishes, ['holofoil', 'normal']);
});

test('filas por carta y percentil nearest-rank', () => {
  const m = rowsPerBase([
    { result: 'colgado', baseProductId: 1, finishes: ['normal'] },
    { result: 'colgado', baseProductId: 1, finishes: ['holofoil', 'reverse_holo'] },
    { result: 'ambiguo', baseProductId: 1, finishes: ['normal'] },
    { result: 'colgado', baseProductId: 2, finishes: ['normal'] },
  ]);
  assert.deepEqual([...m.entries()], [[1, 3], [2, 1]]);
  assert.equal(percentile([1, 1, 1, 1, 1, 1, 1, 1, 2, 6], 90), 2);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90), 9);
  assert.equal(percentile([], 90), null);
});

test('escalera set ↔ grupo (réplica): prefijo de un lado, Base Set, ambigüedad ⇒ null', () => {
  const g = [
    { groupId: 1, name: 'SV08: Surging Sparks' },
    { groupId: 2, name: 'SV01: Scarlet & Violet Base Set' },
    { groupId: 3, name: 'SV: Scarlet & Violet Promo Cards' },
    { groupId: 4, name: 'SV: Scarlet & Violet 151' },
  ];
  assert.equal(matchGroupForSet('Surging Sparks', g), 1);
  assert.equal(matchGroupForSet('Scarlet & Violet', g), 2);
  // Medido: el nombre de pokemontcg.io de las promos no empata con ningún grupo por la escalera.
  assert.equal(matchGroupForSet('Scarlet & Violet Black Star Promos', g), null);
});
