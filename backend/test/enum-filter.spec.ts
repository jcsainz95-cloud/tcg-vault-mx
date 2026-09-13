import { readFileSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import { assertEnumFilter, parseEnumFilter, ENUM_FILTER_ECHO_MAX } from '../src/common/enum-filter';
// `H3-d`: un candado de código mira CÓDIGO. Ver el docstring del helper.
import { stripComments } from './helpers/strip-comments';
import { BusinessException } from '../src/common/business.exception';

/**
 * enum-filter.spec.ts — **el helper único de §0-Q, en sus tres conductas y en la frontera que las
 * separa.** `P-84` · API_CONTRACT §0-Q · ARCHITECTURE §4.37.1.
 *
 * ### Qué mide esto que la suite de integración no puede
 * La de integración (`test/integration/admin-enum-filters-500.e2e-spec.ts`) prueba los **seis ejes
 * por HTTP**: es la que demuestra que el `500` murió. Ésta prueba el **helper**, que es donde vive la
 * decisión — y sobre todo prueba la **frontera** que el `500` escondía y que ningún eje concreto
 * exhibe entero: *vacío ≡ ausente* vs *token mal formado ⇒ `400`*, que son dos conductas OPUESTAS
 * para dos entradas que se parecen mucho (`' '` y `' pending'`).
 */

const ALLOWED = ['pending', 'settled', 'failed'] as const;

/** El error tal como lo verá el cliente: status, código y `details`. */
function capture(fn: () => unknown): BusinessException {
  try {
    fn();
  } catch (e) {
    return e as BusinessException;
  }
  throw new Error('se esperaba un BusinessException y no hubo ninguno');
}

describe('§0-Q · `assertEnumFilter` — la forma del error, que es UNA sola', () => {
  it('un token del dominio pasa y se devuelve tal cual', () => {
    for (const v of ALLOWED) expect(assertEnumFilter('status', v, ALLOWED)).toBe(v);
  });

  it('fuera del dominio ⇒ 400 VALIDATION_ERROR', () => {
    const err = capture(() => assertEnumFilter('status', 'banana', ALLOWED));
    expect(err.getStatus()).toBe(400);
    expect(err.details).toMatchObject({ field: 'status', allowed: [...ALLOWED] });
  });

  it('⭐ `details.field` es el NOMBRE DEL QUERY PARAM, ⛔ nunca la ruta de Prisma', () => {
    // §0-Q punto 2: `zone` viaja en el `where` como `location.zone`, y el cliente NUNCA escribió eso.
    const err = capture(() => assertEnumFilter('zone', 'banana', ['platform_stock'] as const));
    expect(err.details).toMatchObject({ field: 'zone' });
    expect(JSON.stringify(err.details)).not.toContain('location.zone');
  });

  /**
   * `P-89` — `echoValue` existe para **no retirar** `details.value` del catálogo público, no para
   * dar a elegir. Las dos mitades se afirman: que por defecto **no** aparece (§0-Q punto 2 no la
   * exige, y un call-site nuevo no debe emitirla) y que con la bandera **sí** (la llave publicada).
   */
  it('⭐ `details.value` NO se emite por defecto — §0-Q no la exige', () => {
    const err = capture(() => assertEnumFilter('status', 'banana', ALLOWED));
    expect(err.details).not.toHaveProperty('value');
  });

  it('⭐ `echoValue: true` ⇒ `details.value` con el token ofensor, SIN mover `field`/`allowed`', () => {
    const err = capture(() => assertEnumFilter('status', 'banana', ALLOWED, { echoValue: true }));
    expect(err.details).toMatchObject({ field: 'status', value: 'banana', allowed: [...ALLOWED] });
  });

  it('⭐ `echoValue` NO relaja la validación: un token válido sigue pasando y uno inválido cayendo', () => {
    expect(assertEnumFilter('status', 'pending', ALLOWED, { echoValue: true })).toBe('pending');
    expect(capture(() => assertEnumFilter('status', 'banana', ALLOWED, { echoValue: true })).getStatus()).toBe(400);
  });

  it('`details.allowed` es una COPIA: mutarla no envenena la lista derivada del schema', () => {
    const err = capture(() => assertEnumFilter('status', 'x', ALLOWED));
    (err.details as { allowed: string[] }).allowed.push('inyectado');
    expect(ALLOWED).toEqual(['pending', 'settled', 'failed']);
  });
});

describe('§0-Q · `parseEnumFilter` — ausente / vacío / token / basura', () => {
  it('ausente (`undefined`/`null`) ⇒ `undefined`: NO filtra, y ⛔ nunca lanza', () => {
    expect(parseEnumFilter('status', undefined, ALLOWED)).toBeUndefined();
    expect(parseEnumFilter('status', null, ALLOWED)).toBeUndefined();
  });

  it('⭐ vacío o SOLO espacios (tras `trim()`) ≡ ausente ⇒ `undefined`, ⛔ nunca `400`', () => {
    // `''` es lo que manda un `<Select>` en «Todas»; `' '`/`'\t'` es el caso que el `if (status)` de
    // los seis sitios NO cubría, porque en JS `' '` es **truthy** y viajaba crudo hasta Prisma.
    for (const v of ['', ' ', '   ', '\t', '\n', ' \t\n ']) {
      expect(parseEnumFilter('status', v, ALLOWED)).toBeUndefined();
    }
  });

  it('un token del dominio filtra', () => {
    expect(parseEnumFilter('status', 'settled', ALLOWED)).toBe('settled');
  });

  it('fuera del dominio ⇒ 400 con `field` y `allowed`', () => {
    const err = capture(() => parseEnumFilter('status', 'banana', ALLOWED));
    expect(err.getStatus()).toBe(400);
    expect(err.details).toMatchObject({ field: 'status', allowed: [...ALLOWED] });
  });

  /**
   * `P-89` — `parseEnumFilter` **propaga** `echoValue` a `assertEnumFilter`. Sin esta propagación el
   * catálogo público perdería `details.value` y nadie se enteraría: los dos endpoints son
   * `@Public()` y ningún cliente tipado nuestro lee esa llave (`frontend/src/lib/api.ts`, 0 hits
   * medidos 2026-09-13).
   */
  it('⭐ `echoValue` se PROPAGA a través de `parseEnumFilter`, y el vacío sigue sin lanzar', () => {
    const err = capture(() => parseEnumFilter('status', 'banana', ALLOWED, { echoValue: true }));
    expect(err.details).toMatchObject({ field: 'status', value: 'banana' });
    expect(parseEnumFilter('status', ' ', ALLOWED, { echoValue: true })).toBeUndefined();
  });

  /**
   * ⭐⭐ **La frontera, y el test que impide que alguien «mejore» el helper hasta romper `A5`.**
   *
   * `' '` ⇒ `200` sin filtrar, pero `' pending'` ⇒ `400`. Parece inconsistente y no lo es: el
   * `trim()` de §0-Q punto 1 decide si la entrada está **vacía** (una intención: *«no me filtres»*),
   * **no** normaliza un token (eso sería *arreglar* entrada mal formada en silencio).
   *
   * `A5` ya lo había fijado con prueba viva — `test/admin.users-kyc-filter.spec.ts:218-223`,
   * «mayúsculas/espacios NO se arreglan», con `' pending'` entre los casos. Este test existe porque
   * **la primera implementación de `P-84` recortaba el token y puso esa prueba en rojo** (1 roja de
   * 4771, medida 2026-09-13): la señal llegó, y llegó de una prueba que un cambio de helper podría
   * haber «arreglado» debilitándola. Aquí queda la frontera declarada en positivo.
   */
  it('⭐ `\' pending\'` ⇒ 400 aunque `\'pending\'` sea válido: el `trim()` detecta VACÍO, no «arregla» tokens', () => {
    expect(parseEnumFilter('status', ' ', ALLOWED)).toBeUndefined();
    for (const v of [' pending', 'pending ', 'Pending', 'PENDING']) {
      expect(capture(() => parseEnumFilter('status', v, ALLOWED)).getStatus()).toBe(400);
    }
  });

  /**
   * Cinturón del valor NO ESCALAR. ⚠️ **Hoy inalcanzable por HTTP** y el docstring del helper lo dice:
   * el `ValidationPipe` global (`transform: true`, `src/main.ts:56`) coacciona el array al metatipo
   * `String` antes del handler, así que `?x=a&x=b` llega como `'a,b'` — **medido** el 2026-09-13, y
   * NO es lo que §0-Q punto 4 supone. Se prueba igualmente porque el cinturón solo sirve si funciona
   * el día que la coacción deje de estar.
   */
  it('valor no escalar (array) ⇒ 400 con `field` (cinturón: hoy no llega, mañana quizá)', () => {
    const err = capture(() => parseEnumFilter('status', ['pending', 'settled'], ALLOWED));
    expect(err.getStatus()).toBe(400);
    expect(err.details).toMatchObject({ field: 'status' });
  });

  it('`\'a,b\'` (lo que SÍ llega hoy al repetir el parámetro) ⇒ 400: no es del dominio', () => {
    expect(capture(() => parseEnumFilter('status', 'pending,settled', ALLOWED)).getStatus()).toBe(400);
  });
});

/**
 * ### `P-89.C1` — el ECO del valor del cliente está ACOTADO (QA, condición de veredicto)
 *
 * QA midió sobre `3c1bd1e`: `GET /catalog/cards?condition=<5000 chars>` ⇒ **10 137 bytes de respuesta
 * por ~5 KB de petición, sin sesión** (el catálogo es `@Public()`). El valor salía **dos veces**
 * —`message` y `details.value`— íntegro y sin tope. No es XSS (QA lo midió: `application/json`,
 * `nosniff`, `<script>` escapado como dato): es **amplificación**.
 *
 * ⛔ **El tope se prueba en las DOS puntas.** Acotar solo `details.value` habría dejado la mitad del
 * eco intacta — y es justo la mitad que `P-89` AÑADIÓ (el helper del catálogo emitía `Invalid
 * ${field} filter`, sin valor; ver la tabla de `enum-filter.ts`).
 */
describe('§0-Q · el eco del valor ofensor está ACOTADO (`ENUM_FILTER_ECHO_MAX`)', () => {
  const ALLOWED_E = ['pending', 'settled'] as const;
  const LONG = 'A'.repeat(5000);

  it('⭐ el `message` NO crece con la entrada del cliente', () => {
    const err = capture(() => assertEnumFilter('status', LONG, ALLOWED_E));
    expect(err.message.includes(LONG)).toBe(false);
    expect(err.message.length).toBeLessThan(200);
  });

  it('⭐ `details.value` (con `echoValue`) tampoco: es la OTRA punta del mismo eco', () => {
    const err = capture(() => assertEnumFilter('status', LONG, ALLOWED_E, { echoValue: true }));
    const value = (err.details as { value: string }).value;
    expect(value.includes(LONG)).toBe(false);
    expect(value.length).toBeLessThanOrEqual(ENUM_FILTER_ECHO_MAX + 16);
  });

  it('el truncado se DECLARA (`…(+N)`): no miente sobre lo que el cliente mandó', () => {
    const err = capture(() => assertEnumFilter('status', LONG, ALLOWED_E, { echoValue: true }));
    expect((err.details as { value: string }).value).toContain(`…(+${5000 - ENUM_FILTER_ECHO_MAX})`);
  });

  it('⛔ un token CORTO viaja ÍNTEGRO: el tope no rompe el caso normal (que es el 99 %)', () => {
    const err = capture(() => assertEnumFilter('status', 'pendng', ALLOWED_E, { echoValue: true }));
    expect(err.message).toContain("'pendng'");
    expect((err.details as { value: string }).value).toBe('pendng');
  });

  it('el borde exacto: `ENUM_FILTER_ECHO_MAX` chars pasan enteros, uno más se trunca', () => {
    const exact = 'B'.repeat(ENUM_FILTER_ECHO_MAX);
    const plusOne = 'B'.repeat(ENUM_FILTER_ECHO_MAX + 1);
    expect((capture(() => assertEnumFilter('s', exact, ALLOWED_E, { echoValue: true })).details as { value: string }).value).toBe(exact);
    expect((capture(() => assertEnumFilter('s', plusOne, ALLOWED_E, { echoValue: true })).details as { value: string }).value).toContain('…(+1)');
  });

  /**
   * ⭐ **La holgura del tope no se AFIRMA, se VIGILA.** 64 se eligió porque el valor de enum más largo
   * de todo `schema.prisma` mide **22** (`first_edition_holofoil`), sobre 157 valores. Si mañana
   * alguien mete un valor de enum más largo que el tope, el eco truncaría un token LEGÍTIMO y el
   * cliente no podría reconocer lo que mandó. Esto se rompe antes de que eso pase.
   */
  it('⭐ el tope conserva holgura sobre el valor de enum MÁS LARGO del schema (derivado, no afirmado)', () => {
    const schema = readFileSync(join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');
    const values = [...schema.matchAll(/^enum \w+ \{([\s\S]*?)^\}/gm)].flatMap((m) =>
      m[1]
        .split('\n')
        .map((l) => l.replace(/\/\/.*$/, '').trim())
        .filter((l) => l.length > 0 && /^\w+$/.test(l)),
    );
    expect(values.length).toBeGreaterThan(100); // el parser encontró el schema de verdad
    const longest = values.reduce((a, b) => (b.length > a.length ? b : a));
    expect(longest.length).toBeLessThan(ENUM_FILTER_ECHO_MAX);
  });
});

/**
 * ### `P-89.C3` — «`echoValue` no es un punto de extensión» deja de ser PROSA y pasa a ser CANDADO
 *
 * QA/techlead lo midieron: `grep -rn echoValue backend/test/` solo daba pruebas de **conducta**,
 * ninguna que **congelara los call-sites**. Hoy son 6/6 correctos —los seis ejes del catálogo
 * público, que ya emitían `details.value` **antes** del helper— y **nada** impedía que el séptimo eje
 * la encendiera y §0-Q volviera a tener dos formas de `details`. Es decir: el docstring prohibía algo
 * que ningún test comprobaba, que es la definición de la deuda que abrió `P-84` → `P-89` → `P-90`.
 *
 * ⚠️ **Este censo mira CÓDIGO, no texto** (`stripComments`). Es la lección de `H3-d` aplicada al
 * candado nuevo: el fichero que más menciona `echoValue` es el docstring de `enum-filter.ts`, y un
 * censo ingenuo lo contaría como call-site y pediría lista blanca — el defecto exacto que este mismo
 * pase acaba de quitarle a `enum-values-parity.spec.ts`. **No se copia el defecto.**
 */
describe('§0-Q · `echoValue` NO es un punto de extensión — censo CONGELADO de call-sites', () => {
  const SRC = join(__dirname, '..', 'src');

  /**
   * Los ÚNICOS seis call-sites legítimos, con su razón: son los ejes cuyo `400` ya emitía
   * `details.value` **antes** de que existiera el helper (`git show
   * 8d29988:…/catalog.service.ts:783-789` ⇒ `{ field, value, allowed }`). La bandera existe para **no
   * retirar una llave ya publicada** de un endpoint `@Public()` —cuyos clientes no se pueden medir—,
   * no para dar a elegir.
   */
  const EXPECTED_CALL_SITES: Record<string, number> = {
    'src/modules/catalog/catalog.service.ts': 4, // productType, condition, finish, sealedSubtype
    'src/modules/catalog/sealed-catalog.service.ts': 2, // sealedSubtype, condition
  };

  function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = join(dir, e.name);
      if (e.isDirectory()) return walk(full);
      return e.isFile() && e.name.endsWith('.ts') ? [full] : [];
    });
  }

  it('⭐ CERO call-sites nuevos: encender `echoValue` en un eje NUEVO rompe aquí, a propósito', () => {
    const census: Record<string, number> = {};
    for (const f of walk(SRC)) {
      if (f === join(SRC, 'common', 'enum-filter.ts')) continue; // ahí se DECLARA la bandera
      const code = stripComments(readFileSync(f, 'utf8'));
      const hits = code.match(/echoValue\s*:\s*true/g);
      if (hits) census[f.replace(SRC, 'src').split(sep).join('/')] = hits.length;
    }
    // Si esto se pone rojo, la pregunta NO es «cómo lo apago»: es **por qué** un eje nuevo necesita
    // emitir `details.value`. §0-Q punto 2 declara `field` + `allowed` como el dominio, y `value` como
    // OPCIONAL heredado. Un eje nuevo no hereda nada — nace conforme. Si de verdad hace falta, eso es
    // un cambio de §0-Q y va por el ARQUITECTO (regla 9), no por esta línea.
    expect(census).toEqual(EXPECTED_CALL_SITES);
  });

  it('el censo mira CÓDIGO: el docstring de `enum-filter.ts` menciona `echoValue` y NO cuenta', () => {
    const declSrc = readFileSync(join(SRC, 'common', 'enum-filter.ts'), 'utf8');
    // En el fichero crudo hay menciones en prosa...
    expect(declSrc.match(/echoValue/g)!.length).toBeGreaterThan(3);
    // ...y en el CÓDIGO, cero `echoValue: true` (solo la firma `echoValue?: boolean` y el uso).
    expect(stripComments(declSrc).match(/echoValue\s*:\s*true/g)).toBeNull();
  });
});
