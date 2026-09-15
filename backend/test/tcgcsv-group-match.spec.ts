import { matchTcgcsvGroupByName } from '../src/modules/pricing/providers/tcgcsv-group-match';
import { TcgcsvGroupRef } from '../src/modules/pricing/pricing.types';
import { setNameCandidates } from '../src/modules/pricing/ppt-set-mapper.service';

/**
 * v1.65 (QA IMPORTANTE-3) — `matchTcgcsvGroupByName`: **el único sitio donde se decide qué set local
 * empata con qué grupo de TCGCSV.** Ver la cabecera del módulo para el bug que lo motivó.
 *
 * Lo que este spec vigila, en este orden de importancia:
 *  1. **Money-safety**: ambigüedad ⇒ `null`. Nunca se adivina un grupo, porque el grupo equivocado
 *     repreciaría un set entero con los precios de otro.
 *  2. **El caso del prefijo** (`"SV08: Pitch Black"` ↔ `"Pitch Black"`), que es el hallazgo.
 *  3. **Monotonía**: la escalera NO puede resolver MENOS que la versión anterior. Es la propiedad que
 *     hace que este cambio sea seguro de mergear en una ruta de dinero, y por eso se prueba como
 *     propiedad —contra una reimplementación literal del algoritmo viejo— y no caso a caso.
 */

const g = (groupId: number, name: string): TcgcsvGroupRef => ({ groupId, name });

/** Normalización del algoritmo VIEJO (copiada tal cual para poder compararse con ella). */
function normalizeName(raw: string): string {
  return (raw ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * ⚠️ **Reimplementación LITERAL del `resolveGroupId` anterior** (el que vivía duplicado en el provider
 * de precio y en `CardProductResolverService`). No se usa en producción: existe sólo como ORÁCULO de
 * la propiedad de monotonía. Si alguien la borra por «código muerto», la garantía se va con ella.
 */
function legacyMatch(setName: string, groups: TcgcsvGroupRef[]): number | null {
  const target = normalizeName(setName);
  const exact = groups.filter((x) => normalizeName(x.name) === target);
  const matches =
    exact.length > 0
      ? exact
      : groups.filter((x) => {
          const gn = normalizeName(x.name);
          return gn.includes(target) || target.includes(gn);
        });
  return matches.length === 1 ? matches[0].groupId : null;
}

describe('matchTcgcsvGroupByName — escalera de match S-D3 (fuente única)', () => {
  it('nombre idéntico y ÚNICO ⇒ resuelve por el peldaño `exact` (sin cambios respecto al anterior)', () => {
    const res = matchTcgcsvGroupByName('Pitch Black', [g(24688, 'Pitch Black'), g(999, 'Surging Sparks')]);
    expect(res).toEqual({ groupId: 24688, tier: 'exact', candidates: 1 });
  });

  /** ⭐ EL HALLAZGO: el `includes()` no bastaba en cuanto había un segundo candidato. */
  it('PREFIJO de TCGCSV + un segundo candidato por contención ⇒ gana el exacto SIN prefijo', () => {
    const groups = [g(24688, 'SV08: Pitch Black'), g(999, 'Pitch Black Promos')];
    // El algoritmo anterior devolvía null aquí ⇒ set congelado, sólo un warn.
    expect(legacyMatch('Pitch Black', groups)).toBeNull();
    expect(matchTcgcsvGroupByName('Pitch Black', groups)).toEqual({
      groupId: 24688,
      tier: 'exact_unprefixed',
      candidates: 1,
    });
  });

  it('el prefijo puede estar en CUALQUIER lado (local prefijado, grupo pelado)', () => {
    const res = matchTcgcsvGroupByName('SV08: Pitch Black', [g(24688, 'Pitch Black'), g(999, 'Pitch Black Promos')]);
    expect(res).toMatchObject({ groupId: 24688 });
  });

  it('MONEY-SAFE: dos grupos con el MISMO nombre módulo prefijo ⇒ null (no se adivina) + candidatos', () => {
    const res = matchTcgcsvGroupByName('Pitch Black', [g(1, 'SV08: Pitch Black'), g(2, 'ME05: Pitch Black')]);
    expect(res).toEqual({
      groupId: null,
      failure: 'ambiguous',
      candidates: 2,
      candidateNames: ['SV08: Pitch Black', 'ME05: Pitch Black'],
    });
  });

  it('MONEY-SAFE: el peldaño ambiguo NO cae al siguiente (relajar el criterio en la duda sería lo contrario de lo que se quiere)', () => {
    // Dos coincidencias EXACTAS estrictas: hay ambigüedad ya en el peldaño 1 y ahí se para, aunque
    // el peldaño 3 (`contains`) pudiera tener un ganador distinto.
    const res = matchTcgcsvGroupByName('Pitch Black', [g(1, 'Pitch Black'), g(2, 'pitch black'), g(3, 'Pitch Black Promos')]);
    expect(res).toMatchObject({ groupId: null, failure: 'ambiguous', candidates: 2 });
  });

  /**
   * ⭐ Caso que la PROPIEDAD de monotonía cazó en la primera versión de este módulo (y que motivó la
   * regla «prefijo de UN solo lado»): con el nombre LOCAL prefijado, pelar también el del grupo hacía
   * indistinguibles dos colecciones distintas (`SV08:` vs `ME05:`) y se PERDÍA un set que el algoritmo
   * viejo sí resolvía. Se deja explícito para que nadie «simplifique» la regla de vuelta.
   */
  it('REGRESIÓN: local prefijado + un grupo pelado + otro con OTRO prefijo ⇒ gana el pelado (no ambiguo)', () => {
    const groups = [g(1, 'Pitch Black'), g(3, 'ME05: Pitch Black')];
    expect(legacyMatch('SV08: Pitch Black', groups)).toBe(1); // lo que el algoritmo viejo daba
    expect(matchTcgcsvGroupByName('SV08: Pitch Black', groups)).toMatchObject({ groupId: 1 });
  });

  it('ningún candidato ⇒ `no_match` con 0 candidatos', () => {
    expect(matchTcgcsvGroupByName('Pitch Black', [g(7, 'Surging Sparks')])).toEqual({
      groupId: null,
      failure: 'no_match',
      candidates: 0,
      candidateNames: [],
    });
  });

  it('nombre local vacío / sin alfanuméricos ⇒ `empty_name` (no empata con «todo»)', () => {
    expect(matchTcgcsvGroupByName('   ---   ', [g(1, 'Pitch Black')])).toMatchObject({
      groupId: null,
      failure: 'empty_name',
    });
  });

  it('contención pura (difieren por más que el prefijo) sigue resolviendo si es ÚNICA (peldaño 3 intacto)', () => {
    const res = matchTcgcsvGroupByName('Pitch Black', [g(5, 'Pitch Black Elite Trainer Box')]);
    expect(res).toEqual({ groupId: 5, tier: 'contains', candidates: 1 });
  });

  it('sólo se reportan hasta 5 nombres candidatos (la señal no debe hincharse)', () => {
    const groups = Array.from({ length: 9 }, (_, i) => g(i + 1, `SV0${i}: Pitch Black`));
    const res = matchTcgcsvGroupByName('Pitch Black', groups);
    expect(res.groupId).toBeNull();
    expect(res).toMatchObject({ candidates: 9 });
    expect((res as { candidateNames: string[] }).candidateNames).toHaveLength(5);
  });

  /**
   * ⭐⭐ **PROPIEDAD — la escalera nueva NUNCA resuelve MENOS ni DISTINTO que la anterior.**
   *
   * Es la garantía que hace este cambio seguro en una ruta de dinero: lo único que puede pasar es
   * `null → groupId` (un set que estaba congelado vuelve a repreciarse). ⛔ Lo que NO puede pasar es
   * `groupId → null` (perder un set que funcionaba) ni `groupId → OTRO groupId` (repreciar un set con
   * los precios de otro, que sería el fallo grave). Se comprueba por fuerza bruta sobre todos los
   * subconjuntos de un universo de nombres realistas.
   */
  it('PROPIEDAD money-safe: para TODO subconjunto, legacy≠null ⇒ nuevo === legacy', () => {
    const universe = [
      g(1, 'Pitch Black'),
      g(2, 'SV08: Pitch Black'),
      g(3, 'ME05: Pitch Black'),
      g(4, 'Pitch Black Promos'),
      g(5, 'Pitch Black Elite Trainer Box'),
      g(6, 'Surging Sparks'),
      g(7, 'SV08: Surging Sparks'),
      // P-46-bis: grupos con sufijo `Base Set` (el peldaño nuevo) — ejercitan la monotonía del
      // `exact_debased`, incluida la trampa `local prefijado + grupo pelado+baseset`.
      g(8, 'SV01: Pitch Black Base Set'),
      g(9, 'Pitch Black Base Set'),
      g(10, 'ME05: Pitch Black Base Set'),
    ];
    const localNames = ['Pitch Black', 'SV08: Pitch Black', 'Surging Sparks', 'Black', 'Pitch Black Base Set'];

    let upgrades = 0;
    for (let mask = 0; mask < 1 << universe.length; mask += 1) {
      const subset = universe.filter((_, i) => (mask >> i) & 1);
      for (const local of localNames) {
        const before = legacyMatch(local, subset);
        const after = matchTcgcsvGroupByName(local, subset).groupId;
        if (before != null) {
          expect({ local, mask, after }).toEqual({ local, mask, after: before });
        } else if (after != null) {
          upgrades += 1;
        }
      }
    }
    // Y la mejora existe de verdad (si no, el cambio no habría arreglado nada).
    expect(upgrades).toBeGreaterThan(0);
  });

  it('reusa `setNameCandidates` (P-46) en vez de reimplementar el pelado de prefijo', () => {
    // Ancla explícita contra la regresión de la que nace todo esto: la regla del prefijo vive en UN
    // sitio. Si `setNameCandidates` deja de pelar prefijos, el caso del hallazgo vuelve a romperse.
    expect(setNameCandidates('SV08: Pitch Black')).toEqual(['sv08pitchblack', 'pitchblack']);
  });
});

/**
 * ⭐⭐⭐ P-46-bis — LA CLASE ENTERA DE SETS SIN PRECIO (datos de producción del dueño, 2026-09-14).
 *
 * El matcher de P-47 sólo pelaba el **prefijo** de código (`"SV08:"`). Los nombres "base" de una era
 * en TCGplayer llevan ADEMÁS un **sufijo descriptivo** (`"… Base Set"`) que el matcher nunca quitaba,
 * así que:
 *  - `exact` no empata (`scarletviolet` ≠ `sv01scarletvioletbaseset`),
 *  - `exact_unprefixed` tampoco (pelar el prefijo deja `scarletvioletbaseset`, no `scarletviolet`),
 *  - y cae al peldaño `contains`, donde el nombre corto de la era (`scarletviolet`) es **subcadena de
 *    VARIOS grupos** de esa era (la base + los "Black Star Promos") ⇒ **≥2 candidatos ⇒ null** ⇒ el set
 *    entero jamás resuelve groupId ⇒ 0 `CardProduct` ⇒ todo `PRICE_PENDING`.
 *
 * Es EXACTAMENTE el mismo patrón que P-47 (contención ambigua), un peldaño más abajo: allí lo abría el
 * prefijo, aquí lo abre el sufijo `Base Set`.
 *
 * ⚠️ Nombres de grupo TCGCSV **derivados de la CONVENCIÓN** confirmada por el fixture
 * (`test/fixtures/tcgcsv/groups.json`: `"SV08: Surging Sparks"`, `"SV: Prismatic Evolutions"`,
 * `"SWSH12: Silver Tempest"`) + el sufijo `Base Set` estándar de TCGplayer para las bases de era. NO
 * son un fetch en vivo: el egress a `tcgcsv.com` está BLOQUEADO por el proxy de este entorno (403). La
 * cadena EXACTA de cada base queda por confirmar contra `GET /tcgplayer/3/groups` — ver el informe.
 */
describe('P-46-bis — bases de era que HOY no cruzan (contención ambigua por sufijo `Base Set`)', () => {
  // Cada bloque = universo realista de UNA era: la base (prefijo + sufijo `Base Set`) + su grupo de
  // promos + algún hermano, para forzar la ambigüedad de `contains` que hoy devuelve null.
  const svEra = [
    g(22873, 'SV01: Scarlet & Violet Base Set'),
    g(23001, 'Scarlet & Violet Black Star Promos'),
    g(23874, 'SV: Prismatic Evolutions'),
  ];
  const swshEra = [
    g(2991, 'SWSH01: Sword & Shield Base Set'),
    g(2992, 'Sword & Shield Black Star Promos'),
    g(17688, 'SWSH12: Silver Tempest'),
  ];
  const xyEra = [
    g(9008, 'XY Base Set'),
    g(9100, 'XY - Evolutions'),
    g(9200, 'XY Black Star Promos'),
  ];

  it('«Scarlet & Violet» — legacy y matcher ACTUAL devuelven null (congelado); tras el fix cruza a SU base', () => {
    expect(legacyMatch('Scarlet & Violet', svEra)).toBeNull();
    expect(matchTcgcsvGroupByName('Scarlet & Violet', svEra)).toMatchObject({ groupId: 22873 });
  });

  it('«Sword & Shield» — mismo patrón ⇒ cruza a SWSH01 base, NO a los promos', () => {
    expect(legacyMatch('Sword & Shield', swshEra)).toBeNull();
    expect(matchTcgcsvGroupByName('Sword & Shield', swshEra)).toMatchObject({ groupId: 2991 });
  });

  it('«XY» (nombre cortísimo, subcadena de MEDIA era) ⇒ cruza SOLO a «XY Base Set»', () => {
    expect(legacyMatch('XY', xyEra)).toBeNull();
    expect(matchTcgcsvGroupByName('XY', xyEra)).toMatchObject({ groupId: 9008 });
  });

  // NOTA (medido 2026-09-14): un universo `["Diamond & Pearl Base Set", "DP Black Star Promos"]` NO
  // reproduce el fallo — «DP Black Star Promos» no contiene «diamondpearl», así que legacy YA resuelve
  // la base por `contains` único. `Diamond & Pearl`, `Sun & Moon`, `Team Rocket Returns`, `Pokémon GO`,
  // los `Black Star Promos` y las colecciones especiales dependen de la CADENA REMOTA EXACTA, que no
  // se pudo medir (egress bloqueado). No se afirman aquí: ver el informe (sección «Alcance / NO MEDIDO»).

  it('⛔ MONEY-SAFE: ninguna base cruza a su grupo de PROMOS (falso positivo = precios de otra carta)', () => {
    expect(matchTcgcsvGroupByName('Scarlet & Violet', svEra).groupId).not.toBe(23001);
    expect(matchTcgcsvGroupByName('Sword & Shield', swshEra).groupId).not.toBe(2992);
    expect(matchTcgcsvGroupByName('XY', xyEra).groupId).not.toBe(9200);
  });
});

/**
 * `Evolutions` es un caso DISTINTO y NO se "arregla" con el sufijo: es una ambigüedad REAL. El nombre
 * corto `evolutions` es subcadena de DOS colecciones legítimamente distintas (`XY - Evolutions` y
 * `SV: Prismatic Evolutions`, esta última CONFIRMADA en el fixture). Adivinar cuál sería money-unsafe;
 * lo correcto es que quede null (PRICE_PENDING) y se resuelva por `pptSetId` numérico (groupId directo)
 * o por un alias explícito con desempate de año — NUNCA por contención difusa.
 */
describe('P-46-bis — `Evolutions` DEBE seguir en null (ambigüedad real, money-safe)', () => {
  const groups = [g(9100, 'XY - Evolutions'), g(23874, 'SV: Prismatic Evolutions')];
  it('no se adivina entre XY-Evolutions y Prismatic Evolutions', () => {
    expect(matchTcgcsvGroupByName('Evolutions', groups).groupId).toBeNull();
  });
});

/**
 * P-46-ter — el ACENTO de «Pokémon». `normalizeSetName`/`normalizeGroupName` quitaban TODO no-`[a-z0-9]`,
 * así que la `é` desaparecía: `"Pokémon GO"` → `"pokmongo"`, que JAMÁS empata con el `"pokemongo"` de
 * TCGplayer (ASCII). Es un fallo de normalización MEDIBLE en aislamiento (ver spec de ppt-set-mapper).
 * El fix pliega diacríticos (é→e) antes de filtrar. Money-safe: sólo AÑADE la letra caída; no colapsa
 * dos sets distintos (ninguno difiere sólo por un acento en este catálogo).
 */
describe('P-46-ter — acento de «Pokémon» (é) rompía la normalización', () => {
  it('«Pokémon GO» cruza a «Pokemon GO» tras plegar el acento', () => {
    expect(matchTcgcsvGroupByName('Pokémon GO', [g(2999, 'Pokemon GO')])).toMatchObject({ groupId: 2999 });
  });
});

/**
 * ⛔⛔ TRAMPAS DE FAMILIA (money-safety pura, material de prueba del dueño). Familias donde varios sets
 * comparten casi todo el nombre y difieren por AÑO (McDonald's) o por LEGENDARIO (EX Trainer Kit). El
 * fix NO debe cruzar un hermano con otro: cada uno a SU grupo o a ninguno, jamás al del hermano. El
 * peldaño `exact_debased` sólo dispara con sufijo `Base Set` (estas familias no lo tienen) y el plegado
 * de acento no colapsa años ⇒ los hermanos nunca se funden.
 */
describe('P-46-bis — trampas de familia: NUNCA cruzar a un hermano', () => {
  const mcd = [
    g(3011, "McDonald's Collection 2011"),
    g(3012, "McDonald's Collection 2012"),
    g(3021, "McDonald's Collection 2021"),
  ];
  it("McDonald's por AÑO: cada año a SU grupo, jamás al de otro año", () => {
    expect(matchTcgcsvGroupByName("McDonald's Collection 2011", mcd)).toMatchObject({ groupId: 3011 });
    expect(matchTcgcsvGroupByName("McDonald's Collection 2012", mcd)).toMatchObject({ groupId: 3012 });
    expect(matchTcgcsvGroupByName("McDonald's Collection 2011", mcd).groupId).not.toBe(3012);
    expect(matchTcgcsvGroupByName("McDonald's Collection 2011", mcd).groupId).not.toBe(3021);
  });

  const kits = [
    g(4001, 'EX Trainer Kit Latias'),
    g(4002, 'EX Trainer Kit Latios'),
    g(4003, 'EX Trainer Kit 2 Minun'),
  ];
  it('EX Trainer Kit: Latias no cruza a Latios (difieren en UNA letra)', () => {
    expect(matchTcgcsvGroupByName('EX Trainer Kit Latias', kits)).toMatchObject({ groupId: 4001 });
    expect(matchTcgcsvGroupByName('EX Trainer Kit Latios', kits)).toMatchObject({ groupId: 4002 });
    expect(matchTcgcsvGroupByName('EX Trainer Kit Latias', kits).groupId).not.toBe(4002);
  });
});
