import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MOCK_PAYABILITY_TERM_KEYS } from './fixtures';

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️⚠️ **EL CANDADO QUE FALTABA: «¿CRECIÓ LA FÓRMULA?»** (contrato §M5-V.0, v1.61)
 *
 * ### Por qué existe
 * El servidor falso deriva `isPayable` con una tabla de términos **exhaustiva sobre sus propias
 * claves**: añadir una columna sin su término no compila. Eso cerró el defecto de v1.57… y **la
 * fórmula del backend volvió a crecer en v1.61 y el servidor falso volvió a quedarse corto**,
 * porque el `Record` exhaustivo protege contra olvidar el término de una columna **ya declarada**
 * y no contra un término **NUEVO**: nada en el frontend obliga a declarar la columna.
 *
 * *Un candado que no cubre la clase entera del defecto no es el candado: es la mitad que ya
 * pasó.* Este archivo cierra la otra mitad **leyendo la fuente de verdad** —la fórmula normativa
 * de `docs/API_CONTRACT.md` §M5-V.0— y exigiendo que **los términos del documento sean
 * exactamente las claves de la tabla del servidor falso**.
 *
 * ### Los dos candados de CÓDIGO miden cosas distintas, y por eso van los dos
 * *(El tercero, más abajo, no mide código sino PROSA: la cuenta escrita en los comentarios.)*
 *  1. **NOMBRES** — cada término escalar del documento (`x IS [NOT] NULL`, `x ∈ …`) tiene su
 *     entrada en la tabla, y la tabla no tiene entradas de más. Mata: añadir/renombrar/quitar una
 *     columna de la fórmula.
 *  2. **CUENTA** — el número de conjunciones de la fórmula coincide con el número de términos que
 *     el servidor falso implementa. Mata lo que (1) NO puede ver: un término **nuevo que no sea
 *     una comparación de columna** (una condición en prosa, un `NOT EXISTS`, otro predicado
 *     derivado). *(1) no lo vería nunca, porque no tiene forma de identificador.*
 *
 * ⚠️ **Fallan CERRADO y a propósito.** Un reformateo del bloque puede ponerlos rojos sin que la
 * norma cambie: el coste es leer el diff del contrato y re-bendecir. **El coste del modo de fallo
 * contrario ya se pagó dos veces, y las dos en el botón que saca dinero.**
 *
 * ⚠️ Este archivo NO comprueba la CONDUCTA de los términos (eso es `payability.test.ts`): un
 * término presente pero mal implementado lo mata aquél, no éste. Ninguno tapa al otro.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const CONTRACT_PATH = join(__dirname, '..', '..', '..', '..', 'docs', 'API_CONTRACT.md');

/**
 * El bloque normativo de §M5-V.0 («LA NORMA, EN CUATRO LÍNEAS»), sin los comentarios `//` de sus
 * márgenes: son glosa, no norma, y llevan prosa que ensuciaría las dos medidas.
 *
 * ⚠️ Se ancla en el **id de la sección** y en el rótulo de V.0, no en un número de línea. Si el
 * arquitecto renumera o mueve la sección, esto se pone rojo con un mensaje que dice qué buscar —
 * que es infinitamente mejor que un `slice` que empieza a leer otra cosa y aprueba en silencio.
 */
function normativeFormula(): string {
  const doc = readFileSync(CONTRACT_PATH, 'utf8');
  const section = doc.indexOf('<a id="M5-V"></a>');
  expect(section, `no se encontró §M5-V en ${CONTRACT_PATH}`).toBeGreaterThan(-1);
  const marker = doc.indexOf('**V.0 —', section);
  expect(marker, 'no se encontró el rótulo de §M5-V.0 («LA NORMA…»)').toBeGreaterThan(-1);
  const open = doc.indexOf('```', marker);
  const close = doc.indexOf('```', open + 3);
  expect(open, 'no se encontró el bloque de código de §M5-V.0').toBeGreaterThan(-1);
  expect(close).toBeGreaterThan(open);
  return doc
    .slice(open + 3, close)
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n');
}

/**
 * Los términos ESCALARES del documento: el identificador que está **a la izquierda de un
 * operador de comparación** (`IS NULL`, `IS NOT NULL`, `∈`, `=`, `!=`).
 *
 * ⚠️ Se extrae por el OPERADOR y no por la forma del identificador (camelCase, mayúsculas…): un
 * término se reconoce por lo que se le pregunta a la columna, no por cómo se escribe su nombre.
 * Así `status ∈ …` cuenta igual que `approvedTotalCents IS NOT NULL`, y la prosa del término V-b
 * («ninguna línea COMPRADA sin veredicto») no genera falsos términos.
 */
function scalarTerms(formula: string): string[] {
  const matches = formula.matchAll(/([A-Za-z][A-Za-z0-9_]*)\s*(?:IS\s+(?:NOT\s+)?NULL|∈|!=|==)/g);
  return [...new Set([...matches].map((m) => m[1]))].sort();
}

/**
 * Las CONJUNCIONES de la fórmula. `términos = ∧ + 1`, porque el primer conjunto no lleva
 * operador delante y el `pay-spei` de la segunda línea reusa `isPayable` como su primer conjunto.
 */
function conjunctionCount(formula: string): number {
  return (formula.match(/∧/g) ?? []).length;
}

/* ───────────────────────────── candado hermano: LA CUENTA ESCRITA EN PROSA ─────────────────────
 *
 * Los dos candados de arriba miden el CÓDIGO (la tabla del servidor falso). Lo que no miran es la
 * PROSA: un comentario que dice cuántos términos tiene el predicado del pago. Esa cuenta caducó
 * **dos veces** —en v1.57 y otra vez en v1.61— en comentarios que nadie ejecuta, y las dos veces
 * sobrevivió al pase que corrigió la fórmula de verdad, porque **nada la leía**.
 *
 * Este candado la lee. Regla, en una línea: **si un comentario del frontend escribe una cuenta de
 * términos del predicado de pago, esa cuenta tiene que ser la del contrato.**
 *
 * ### Alcance, y por qué es estrecho a propósito
 *  - **Solo ficheros que hablan del predicado** (`isPayable` / `§M5-V`). El conjunto se DESCUBRE
 *    recorriendo `src/`, no se enumera: un fichero nuevo que hable de pagabilidad entra solo.
 *  - **Solo el numeral escrito en MAYÚSCULAS y PEGADO a la palabra «términos»** (con negritas de
 *    markdown en medio, si acaso). Es la forma en que este código escribe una cuenta NORMATIVA, y
 *    es la forma exacta que tenían las dos afirmaciones caducadas. *(No se ponen ejemplos
 *    literales en esta glosa: este fichero se escanea a sí mismo y un ejemplo sería una cuenta.)*
 *  - **Se saltan las líneas marcadas como histórico** (`SUPERSEDED`, `histórico`): decir *«la forma
 *    vieja tenía N»* es correcto y útil, y prohibirlo sería el candado gritando por prosa buena.
 *
 * ### Lo que este candado NO cubre, dicho por escrito
 *  - **Los ORDINALES** («el PRIMER término», «el TERCER término»). Se puede escribir un ordinal
 *    verdadero sobre una fórmula histórica, y por regex es indistinguible de uno caducado: el
 *    candado sería ruido, y **un candado que se desactiva es peor que ninguno**. La defensa contra
 *    esa mitad es de convención y ya está aplicada: los comentarios vivos del predicado **no usan
 *    ordinales** (`api.ts`, `M5View.tsx`), porque la posición de cada término ya cambió dos veces.
 *  - **La minúscula** («los dos términos») se usa para hablar de un SUBCONJUNTO —p. ej. los dos
 *    que añadió v1.61— y por eso no se mide: medirla daría rojo sobre una frase correcta.
 *
 * ⚠️ Este fichero **se escanea a sí mismo** (habla de `isPayable`): si esta glosa escribe una
 * cuenta, tiene que ser la buena. Es deliberado.
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

const SRC_ROOT = join(__dirname, '..', '..');

/** Cuentas en prosa que este código considera NORMATIVAS (mayúsculas). */
const NUMERAL_ES: Readonly<Record<string, number>> = {
  DOS: 2,
  TRES: 3,
  CUATRO: 4,
  CINCO: 5,
  SEIS: 6,
  SIETE: 7,
  OCHO: 8,
};

/**
 * Numeral + «términos», permitiendo entre medias solo adornos de markdown/espacio (`**CINCO**
 * términos`). La adyacencia es lo que evita cazar `«DOS (v1.51.8) y TRES (v1.57) términos»`, que
 * es prosa histórica legítima — y que además lleva su marca de histórico.
 */
function proseCountPattern(): RegExp {
  return new RegExp(`\\b(${Object.keys(NUMERAL_ES).join('|')})\\b[\\s*_\`]{0,6}(?:términos|TÉRMINOS)`, 'g');
}

const HISTORICAL_MARKERS = ['SUPERSEDED', 'histórico', 'HISTÓRICO', 'supersede'];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

type ProseClaim = { file: string; lineNo: number; line: string; claimed: number };

/**
 * El extractor, **separado de la lectura de disco a propósito**: así se le puede dar un texto
 * fabricado y comprobar que MUERDE (anti-vacuidad real, ver el primer test) sin depender de que
 * hoy haya una cuenta escrita en algún fichero.
 */
function claimsIn(file: string, content: string): ProseClaim[] {
  const claims: ProseClaim[] = [];
  content.split('\n').forEach((line, i) => {
    if (HISTORICAL_MARKERS.some((m) => line.includes(m))) return;
    for (const m of line.matchAll(proseCountPattern())) {
      claims.push({ file, lineNo: i + 1, line: line.trim(), claimed: NUMERAL_ES[m[1]] });
    }
  });
  return claims;
}

/** Los ficheros de `src/` que hablan del predicado de pago; el resto no puede tener una cuenta suya. */
function payabilityFiles(): { file: string; content: string }[] {
  return sourceFiles(SRC_ROOT)
    .map((file) => ({ file, content: readFileSync(file, 'utf8') }))
    // El fichero tiene que hablar del predicado; si no, «términos» es otra cosa (búsqueda, etc.).
    .filter(({ content }) => content.includes('isPayable') || content.includes('M5-V'));
}

describe('§M5-V.0 · ninguna cuenta de términos escrita en prosa está caducada', () => {
  // ⚠️ Las muestras se ENSAMBLAN en vez de escribirse literales: este fichero está dentro del
  // barrido y una muestra literal sería una cuenta en prosa más — que además sería falsa.
  const sample = (numeral: string, deco = '') => `la precondición son ${deco}${numeral}${deco} términos`;

  it('ANTI-VACUIDAD: sobre un texto fabricado, el extractor MUERDE (y no muerde de más)', () => {
    // Sin esto, un extractor roto devolvería `[]` sobre todo el árbol y el test de abajo aprobaría
    // en silencio: el modo de fallo que este archivo entero persigue. Se mide con texto propio y
    // **no** con «hay al menos N cuentas escritas en `src/`»: esa segunda forma ataría el candado a
    // que la prosa siga escribiendo la cuenta, justo lo que el contrato pide dejar de hacer
    // (§M5-V.0 es el único sitio donde vive). Un candado no puede depender de lo que quiere borrar.
    const detected = claimsIn('fabricado.ts', [sample('CINCO'), sample('CUATRO', '**'), `${'DOS'} TÉRMINOS.`].join('\n'));
    expect(detected.map((c) => c.claimed)).toEqual([5, 4, 2]);
    expect(detected.map((c) => c.lineNo)).toEqual([1, 2, 3]);

    // Y lo que NO es una cuenta normativa viva no se caza: prosa histórica no adyacente, la
    // minúscula del subconjunto, y la línea marcada como superada.
    const quiet = claimsIn('fabricado.ts', [
      'DOS (v1.51.8) y TRES (v1.57) términos',
      'los dos términos que añadió v1.61',
      `${sample('TRES')} — SUPERSEDED por §M5-V`,
    ].join('\n'));
    expect(quiet).toEqual([]);
  });

  it('las cuentas en prosa del frontend coinciden con la fórmula del contrato', () => {
    const expected = conjunctionCount(normativeFormula()) + 1;
    const files = payabilityFiles();

    // Anti-vacuidad del BARRIDO (la otra mitad): si el descubrimiento se rompiera —ruta mal, filtro
    // de más—, no habría nada que medir y esto pasaría vacío. Los ficheros que hablan del predicado
    // no van a desaparecer: son el DTO, el servidor falso y el cliente de la API.
    expect(
      files.map((f) => f.file.slice(SRC_ROOT.length + 1)),
      `no se descubrieron los ficheros de pagabilidad bajo ${SRC_ROOT}`,
    ).toEqual(expect.arrayContaining(['types/contract.ts', 'lib/api.ts', 'lib/mock/fixtures.ts']));

    const stale = files
      .flatMap(({ file, content }) => claimsIn(file, content))
      .filter((c) => c.claimed !== expected);
    expect(
      stale.map((c) => `${c.file.slice(SRC_ROOT.length + 1)}:${c.lineNo} dice ${c.claimed} — «${c.line}»`),
      `CUENTAS CADUCADAS: §M5-V.0 declara ${expected} términos. Corrige la prosa —o mejor, quita la ` +
        'cuenta y enlaza §M5-V.0—; y si la frase habla de una forma VIEJA de la fórmula, márcala ' +
        'como histórica (`SUPERSEDED`).',
    ).toEqual([]);
  });
});

describe('§M5-V.0 · el servidor falso implementa EXACTAMENTE los términos del contrato', () => {
  // ⚠️ Se lee DENTRO de cada test, no en el `describe`: si el ancla se rompe, se quiere un test
  // ROJO con su mensaje —«no se encontró §M5-V»— y no una suite que ni siquiera colecciona.
  it('el bloque normativo se localiza y contiene la fórmula (anti-vacuidad del parser)', () => {
    const formula = normativeFormula();
    // Si el ancla dejara de encontrar el bloque, todo lo de abajo mediría una cadena vacía y
    // aprobaría en silencio: **el modo de fallo exacto que esta sesión persigue**.
    expect(formula).toContain('isPayable');
    expect(formula).toContain('pay-spei');
    expect(formula.length).toBeGreaterThan(200);
  });

  it('NOMBRES: cada término escalar del contrato tiene su entrada en la tabla del mock, y ninguna sobra', () => {
    const formula = normativeFormula();
    const contractTerms = scalarTerms(formula);
    // Anti-vacuidad del extractor: si el patrón dejara de reconocer comparaciones, devolvería `[]`
    // y un `toEqual([])` contra una tabla vacía pasaría. La fórmula tiene términos, y son varios.
    expect(contractTerms.length, `el extractor no encontró términos en:\n${formula}`).toBeGreaterThanOrEqual(4);

    const mockTerms = [...MOCK_PAYABILITY_TERM_KEYS].sort();
    const missing = contractTerms.filter((t) => !mockTerms.includes(t as never));
    const extra = mockTerms.filter((t) => !contractTerms.includes(t));
    expect(
      missing,
      `TÉRMINOS DEL CONTRATO SIN REFLEJO EN EL SERVIDOR FALSO: ${missing.join(', ')}. ` +
        'Añádelos a `MockPayabilityColumns` + `MOCK_PAYABILITY_TERMS` en `fixtures.ts` ' +
        '(y decide si la columna viaja en el DTO).',
    ).toEqual([]);
    expect(
      extra,
      `TÉRMINOS QUE EL SERVIDOR FALSO EXIGE Y EL CONTRATO YA NO: ${extra.join(', ')}. ` +
        'Un término de más bloquea pagos que el servidor real acepta.',
    ).toEqual([]);
  });

  it('CUENTA: la fórmula tiene tantos conjuntos como términos implementa el mock', () => {
    const formula = normativeFormula();
    // Mata la clase que los NOMBRES no ven: un término nuevo escrito en prosa o como predicado
    // derivado —p. ej. «∧ ninguna línea …»— no tiene identificador que extraer, pero **sí suma
    // una conjunción**.
    const conjunctions = conjunctionCount(formula);
    expect(conjunctions, 'la fórmula no tiene conjunciones: ¿se movió el bloque?').toBeGreaterThan(0);
    expect(
      conjunctions + 1,
      `§M5-V.0 declara ${conjunctions + 1} términos y el servidor falso implementa ` +
        `${MOCK_PAYABILITY_TERM_KEYS.length} (${MOCK_PAYABILITY_TERM_KEYS.join(', ')}). ` +
        'Si el contrato ganó un término, refléjalo; si solo se reformateó el bloque, re-bendice esta cuenta.',
    ).toBe(MOCK_PAYABILITY_TERM_KEYS.length);
  });
});
