import { assertEnumFilter, parseEnumFilter } from '../src/common/enum-filter';
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
