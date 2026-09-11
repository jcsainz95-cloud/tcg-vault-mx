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
    ];
    const localNames = ['Pitch Black', 'SV08: Pitch Black', 'Surging Sparks', 'Black'];

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
