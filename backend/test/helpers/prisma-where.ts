/**
 * `test/helpers/prisma-where.ts` — **evaluador de `where` de Prisma para los fakes de tests.**
 * Propiedad: backend. No es un spec (no casa `testRegex`); es la pieza que comparten los harnesses
 * que **filtran la fila por el `where` real** en vez de devolver `{count:1}` a ciegas.
 *
 * ### Por qué existe (v1.61.1 · **B1**)
 * Cada suite tenía su propio `matches` de tres líneas, y **ninguno sabía leer `AND`**. Eso no era un
 * detalle de fake: era la razón por la que la composición del `where` de `pay-spei` no se podía
 * aseverar. El defecto B1 —`{ ...payableWhere(), approvedTotalCents: fresh.… }`, donde **la clave
 * posterior gana sobre el spread** y V-a no llegaba al motor— vivió con el assert 9 en verde
 * **porque el assert miraba `payableWhere()` AISLADA**, donde el término sí está.
 *
 * *Una prueba que mira el ayudante no puede ver lo que la composición tira.* Este evaluador existe
 * para que las pruebas puedan mirar **el objeto que se le pasa a `updateMany`**.
 *
 * ### Es DELIBERADAMENTE ESTRICTO
 * Ante un operador que no entiende, **lanza**. Un evaluador permisivo (que ignore lo que no sabe
 * leer) convierte cualquier término nuevo en un no-op silencioso: exactamente el falso verde que
 * esto viene a impedir. Si añades un operador al `where` de producción, añádelo aquí también — y
 * ese trabajo extra **es la señal**, no la molestia.
 */

export type Row = Record<string, unknown>;

const OPERADORES = ['equals', 'in', 'notIn', 'not', 'gt', 'gte', 'lt', 'lte'] as const;

/** Igualdad de escalares con `Date` por VALOR (dos `Date` iguales no son la misma referencia). */
function igual(value: unknown, expected: unknown): boolean {
  if (value instanceof Date && expected instanceof Date) return value.getTime() === expected.getTime();
  return value === expected;
}

/** Evalúa UNA condición Prisma (escalar, `null`, `Date` o `{operador}`) contra un valor. */
export function matchesCond(value: unknown, cond: unknown): boolean {
  if (cond === null || typeof cond !== 'object' || cond instanceof Date) return igual(value, cond);
  const c = cond as Row;
  const claves = Object.keys(c);
  const desconocida = claves.find((k) => !(OPERADORES as readonly string[]).includes(k));
  if (desconocida) {
    throw new Error(
      `operador no soportado por el evaluador de tests: '${desconocida}' en ${JSON.stringify(cond)}. ` +
        'Añádelo aquí antes de usarlo en un `where` de producción.',
    );
  }
  // Varios operadores en la misma condición se conjugan con AND, igual que en Prisma.
  return claves.every((k) => {
    switch (k) {
      case 'equals':
        return igual(value, c.equals);
      case 'in':
        return (c.in as unknown[]).some((v) => igual(value, v));
      case 'notIn':
        return !(c.notIn as unknown[]).some((v) => igual(value, v));
      case 'not':
        return !matchesCond(value, c.not);
      case 'gt':
        return (value as number) > (c.gt as number);
      case 'gte':
        return (value as number) >= (c.gte as number);
      case 'lt':
        return (value as number) < (c.lt as number);
      default:
        return (value as number) <= (c.lte as number);
    }
  });
}

function comoLista(v: unknown): Row[] {
  return (Array.isArray(v) ? v : [v]) as Row[];
}

/**
 * ¿La fila `row` casa con el `where` **compuesto** tal cual se le pasó al motor?
 *
 * Entiende `AND` / `OR` / `NOT` recursivamente — que es el punto entero: un `where` con fragmentos
 * conjugados no se puede aseverar con `toMatchObject` sobre las claves planas.
 *
 * ⚠️ Si el `where` afirma sobre una columna que la fila no modela, **lanza**: un `undefined` que no
 * casa con nada produciría un `count: 0` correcto por la razón equivocada.
 */
export function matchesWhere(row: Row, where: Row): boolean {
  return Object.entries(where).every(([k, cond]) => {
    if (k === 'AND') return comoLista(cond).every((w) => matchesWhere(row, w));
    if (k === 'OR') return comoLista(cond).some((w) => matchesWhere(row, w));
    if (k === 'NOT') return comoLista(cond).every((w) => !matchesWhere(row, w));
    if (!(k in row)) {
      throw new Error(
        `el \`where\` afirma sobre '${k}', que la fila del fake no modela. ` +
          'Añade la columna al fixture: sin ella el `count: 0` saldría por la razón equivocada.',
      );
    }
    return matchesCond(row[k], cond);
  });
}

/**
 * Las claves que el `where` afirma **en el nivel plano** (sin entrar en `AND`/`OR`/`NOT`).
 * Sirve para la regla estructural de B1: *un fragmento compartido no puede compartir clave con lo
 * plano, porque en un objeto literal lo plano lo pisaría sin avisar.*
 */
export function clavesPlanas(where: Row): string[] {
  return Object.keys(where).filter((k) => k !== 'AND' && k !== 'OR' && k !== 'NOT');
}

/** Las claves que afirma cada fragmento de `AND` (un nivel: es donde vive la composición). */
export function clavesDeFragmentos(where: Row): string[] {
  return comoLista(where.AND ?? []).flatMap((f) => clavesPlanas(f));
}
