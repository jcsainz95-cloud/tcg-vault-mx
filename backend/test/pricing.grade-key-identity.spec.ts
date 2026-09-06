import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RawCondition } from '@prisma/client';
import { ACCEPTED_RAW_CONDITIONS } from '../src/common/business-rules';
import {
  buildGradeKey,
  tryBuildGradeKey,
  IncompleteGradeIdentityError,
  isCanonicalGradeKey,
  sealedMarketGradeKey,
} from '../src/modules/pricing/pricing.types';

/**
 * v1.53-buylist-graded-identity (ARCHITECTURE §4.40.4, **MONEY**) — **la cirugía de `buildGradeKey`.**
 *
 * ### El defecto, en una línea
 * ```ts
 * case 'graded': return `graded:${input.gradingCompany ?? 'PSA'}:${input.gradeValue ?? '10'}`;
 * ```
 * Un default silencioso que **no es neutro: elige el grado MÁS CARO que existe**. Toda carta
 * graduada sin identidad —y ninguna la tenía, porque ningún DTO de buylist la capturaba— se valuaba
 * contra `graded:PSA:10`. Y no acababa en la cotización: `convertToInventory` creaba la pieza sin
 * grado, así que **todos** los lectores (bóveda, catálogo, precio de venta, valor de custodia, P&L,
 * `price-sync`) la resolvían como PSA 10 para siempre.
 *
 * ### Lo que este spec ancla
 * Las **dos** mitades del arreglo, que son las que el techlead va a mirar (§4.40.9):
 *  - `buildGradeKey` **LANZA** ante identidad incompleta — es el camino del DINERO;
 *  - `tryBuildGradeKey` devuelve **`null`** — es el camino de LECTURA, y ese `null` significa
 *    *NO HAY REFERENCIA ⇒ `precio_pendiente`*, jamás un default ni un MX$0.
 *
 * Y, sobre todo: que **el default no vuelva**. El test del `??` mira el código fuente a propósito.
 */

const CO = 'PSA';

describe('§4.40.4 — el DEFAULT SILENCIOSO se retiró (y no puede volver por accidente)', () => {
  /**
   * Ancla textual, hermana del `residuo` de `enum-values-parity.spec.ts`: si alguien vuelve a
   * escribir `?? 'PSA'` o `?? '10'` en el constructor de claves, esto se pone rojo. Es la
   * prohibición (g) del encargo, convertida en máquina.
   */
  it('el fuente de `pricing.types.ts` NO contiene ningún `?? \'PSA\'` ni `?? \'10\'`', () => {
    const src = readFileSync(
      join(__dirname, '..', 'src', 'modules', 'pricing', 'pricing.types.ts'),
      'utf8',
    );
    // Se ignoran los comentarios: el porqué del defecto SÍ está documentado ahí y debe seguir.
    const code = src
      .split('\n')
      .filter((l: string) => !/^\s*(\*|\/\/|\/\*)/.test(l))
      .join('\n');
    expect(code).not.toMatch(/\?\?\s*'PSA'/);
    expect(code).not.toMatch(/\?\?\s*'10'/);
  });
});

describe('buildGradeKey — la variante que LANZA (camino del DINERO)', () => {
  it('`graded` con identidad COMPLETA produce la clave canónica de siempre', () => {
    expect(buildGradeKey({ productType: 'graded', gradingCompany: CO, gradeValue: '9' })).toBe(
      'graded:PSA:9',
    );
    expect(buildGradeKey({ productType: 'graded', gradingCompany: 'CGC', gradeValue: '9.5' })).toBe(
      'graded:CGC:9.5',
    );
    // Regresión: una graduada BIEN capturada no cambia de valuación (§4.40.9 qa/f).
    expect(isCanonicalGradeKey('graded', 'graded:PSA:9')).toBe(true);
  });

  it('`graded` SIN empresa ⇒ lanza `IncompleteGradeIdentityError` (jamás `graded:PSA:10`)', () => {
    const call = () =>
      buildGradeKey({ productType: 'graded', gradingCompany: null as never, gradeValue: '9' });
    expect(call).toThrow(IncompleteGradeIdentityError);
  });

  it('`graded` SIN grado ⇒ lanza (antes salía `10`, el grado más caro)', () => {
    expect(() =>
      buildGradeKey({ productType: 'graded', gradingCompany: CO, gradeValue: null as never }),
    ).toThrow(IncompleteGradeIdentityError);
  });

  it('cadena VACÍA o en blanco es AUSENCIA de identidad, no una identidad rara', () => {
    for (const bad of ['', '   ']) {
      expect(() =>
        buildGradeKey({ productType: 'graded', gradingCompany: bad, gradeValue: '10' }),
      ).toThrow(IncompleteGradeIdentityError);
      expect(() =>
        buildGradeKey({ productType: 'graded', gradingCompany: CO, gradeValue: bad }),
      ).toThrow(IncompleteGradeIdentityError);
    }
  });

  it('`raw` conserva `?? \'NM\'`: NO es identidad inventada, es el único valor que compramos', () => {
    // PROJECT.md §E: «la condición es fija en Near Mint (NM), único grado que compramos»
    // (`ACCEPTED_RAW_CONDITIONS`). Aquí el default SÍ es neutro, y por eso se queda.
    expect(buildGradeKey({ productType: 'raw' })).toBe('raw:NM');
    expect(buildGradeKey({ productType: 'raw', rawCondition: null })).toBe('raw:NM');
    expect(buildGradeKey({ productType: 'raw', rawCondition: 'NM' })).toBe('raw:NM');
  });

  /**
   * v1.53-b — **EL ANCLA DE LA PREMISA** (petición del techlead sobre el `?? 'NM'`).
   *
   * El argumento «`?? 'NM'` no inventa identidad» es correcto **hoy**, y sólo hoy: se apoya en que
   * `enum RawCondition` tiene **un único valor**, así que el default no puede *elegir* entre
   * condiciones — no hay entre qué elegir. Esa premisa no estaba fijada en ningún sitio.
   *
   * `enum-values-parity.spec.ts` ancla `ACCEPTED_RAW_CONDITIONS === ['NM']` (la lista de NEGOCIO),
   * pero eso **no cubre este caso**: el día que el schema gane `LP`/`MP` —`business-rules.ts` lo
   * llama *«un cambio probable, no hipotético»*, por ejemplo para registrar una devolución no-NM sin
   * publicarla— la lista de negocio puede seguir siendo `['NM']` y ese test seguiría en verde,
   * mientras los dos `?? 'NM'` de aquí pasarían **en silencio** a valuar una carta cuya condición NO
   * se capturó **como si fuera la mejor** — el defecto de `?? 'PSA'`/`?? '10'` que este pase acaba de
   * retirar, con otra sintaxis y en el otro eje.
   *
   * Por eso el ancla mira la **CARDINALIDAD DEL SCHEMA**, no la lista de negocio. Si rompe, la
   * decisión no es actualizar el número: es **volver a mirar los dos `??`** y decidir si `null` debe
   * seguir significando `NM` o pasar a significar «sin condición capturada ⇒ `pending`», igual que
   * el grado.
   */
  it('ANCLA: `RawCondition` tiene UN valor — la premisa que hace neutro al `?? \'NM\'`', () => {
    const schemaValues = Object.values(RawCondition) as string[];
    expect(schemaValues).toEqual(['NM']);
    // Y la lista de negocio coincide con él: hoy «lo que existe» y «lo que aceptamos» son lo mismo,
    // que es exactamente la condición bajo la cual el default no puede elegir el mejor grado.
    expect([...ACCEPTED_RAW_CONDITIONS]).toEqual(schemaValues);
    // Los dos sitios que dependen de esta premisa, nombrados para que el que rompa esto los encuentre:
    // `buildGradeKey` y `tryBuildGradeKey`, rama `case 'raw'` de `pricing.types.ts`.
    const src = readFileSync(
      join(__dirname, '..', 'src', 'modules', 'pricing', 'pricing.types.ts'),
      'utf8',
    );
    expect(src.match(/return `raw:\$\{input\.rawCondition \?\? 'NM'\}`;/g) ?? []).toHaveLength(2);
  });

  it('`sealed` sigue valiendo `\'sealed\'` — es la clave del override MANUAL (§4.40.4d)', () => {
    expect(buildGradeKey({ productType: 'sealed' })).toBe('sealed');
    // Y la clave de MERCADO por producto no cambió: sigue siendo la otra función.
    expect(sealedMarketGradeKey(42)).toBe('sealed:tcg:42');
  });
});

describe('tryBuildGradeKey — la variante TOLERANTE (camino de LECTURA ⇒ `precio_pendiente`)', () => {
  it('devuelve EXACTAMENTE la misma clave que la estricta cuando la identidad está completa', () => {
    const complete = [
      { productType: 'raw' as const, rawCondition: 'NM' },
      { productType: 'graded' as const, gradingCompany: CO, gradeValue: '10' },
      { productType: 'graded' as const, gradingCompany: 'CGC', gradeValue: '8.5' },
      { productType: 'sealed' as const },
    ];
    for (const input of complete) {
      expect(tryBuildGradeKey(input)).toBe(buildGradeKey(input));
    }
  });

  it('`graded` con identidad incompleta ⇒ `null` (NO lanza, NO inventa)', () => {
    expect(tryBuildGradeKey({ productType: 'graded' })).toBeNull();
    expect(tryBuildGradeKey({ productType: 'graded', gradingCompany: null, gradeValue: '9' })).toBeNull();
    expect(tryBuildGradeKey({ productType: 'graded', gradingCompany: CO, gradeValue: null })).toBeNull();
    expect(tryBuildGradeKey({ productType: 'graded', gradingCompany: '', gradeValue: '' })).toBeNull();
  });

  it('la fila EXACTA que crea `convertToInventory` (§9 D-BG-3) sale `null`, no `graded:PSA:10`', () => {
    // Lo que `convertToInventory` copia del `SellRequestItem`: cardId, productType, rawCondition,
    // finish. NUNCA gradingCompany/gradeValue/certNumber — el origen no los tiene.
    const piezaConvertida = {
      productType: 'graded' as const,
      rawCondition: null,
      gradingCompany: null,
      gradeValue: null,
    };
    expect(tryBuildGradeKey(piezaConvertida)).toBeNull();
    expect(tryBuildGradeKey(piezaConvertida)).not.toBe('graded:PSA:10');
  });

  it('`null` NUNCA es una clave canónica: no hay fila de precio que pueda casar por accidente', () => {
    const k = tryBuildGradeKey({ productType: 'graded', gradingCompany: null, gradeValue: null });
    expect(k).toBeNull();
    // Y la clave del grado más caro sí lo es — o sea que el `null` no está «cayendo» en ella.
    expect(isCanonicalGradeKey('graded', 'graded:PSA:10')).toBe(true);
  });

  it('un `productType` desconocido (fila casteada) también sale `null`, no `\'unknown\'`', () => {
    expect(tryBuildGradeKey({ productType: 'nope' as never })).toBeNull();
  });
});
