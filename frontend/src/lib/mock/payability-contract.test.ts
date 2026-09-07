import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
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
 * ### Los DOS candados miden cosas distintas, y por eso van los dos
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
