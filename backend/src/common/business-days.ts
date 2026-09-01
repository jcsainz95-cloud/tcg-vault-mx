/**
 * business-days.ts (M-46, ARCHITECTURE §4.39k / criterio 154 — **ZONA COMPARTIDA**) — **UNA sola
 * definición de «día hábil», y FALLA RUIDOSAMENTE.**
 *
 * ### La definición (criterio 154, `PROJECT.md` §P.15)
 * **Lunes a viernes**, excluyendo los **festivos oficiales de México**, en **`America/Mexico_City`**.
 * **El sábado NO cuenta.** La fecha límite del **correo**, la de **la pantalla del cliente**, la del
 * **barrido** y la del **recordatorio** son **EXACTAMENTE la misma** — por eso hay **una**
 * implementación y **cuatro** consumidores, y por eso **el frontend NO recalcula plazos**: recibe el
 * ISO ya resuelto y lo formatea. *Dos implementaciones de «día hábil» en dos lenguajes es la receta
 * para que la pantalla y el correo digan fechas distintas, que es justo lo que el criterio prohíbe.*
 *
 * ### ⚠️ NORMA MONEY-SAFE (y de trato justo): si no sé, LANZO
 * Si el cálculo necesita un año que `MX_HOLIDAYS` **no cubre**, estas funciones **lanzan**.
 * **Prohibido degradar a «no hay festivos»**: eso **adelantaría vencimientos** y **expiraría ofertas
 * de gente que sí cumplió**. El barrido captura, loggea `error` y **NO expira**. *Fallar hacia «no
 * vence» es el único lado seguro.* Lo mismo con una fecha inválida (`Invalid Date`): **lanza**, no
 * devuelve una fecha silenciosamente equivocada.
 *
 * ### Por qué la tabla es DATO y no código suelto
 * Los festivos de México **no son derivables de una fórmula estable** (el Art. 74 LFT los define como
 * «primer lunes de febrero», «tercer lunes de marzo»… y encima hay uno **sexenal** de transmisión del
 * Poder Ejecutivo). Una tabla explícita **por año** es auditable de un vistazo y **obliga a
 * extenderla a propósito**. **REQUIERE EXTENSIÓN ANUAL** — y el `throw` es lo que garantiza que nadie
 * se entere tarde.
 *
 * ### Por qué se calcula en `America/Mexico_City` y no en UTC
 * Un vencimiento a las 18:00 CST cae el **día siguiente** en UTC. Contar días sobre el instante UTC
 * correría el calendario un día para todo lo que pase después de las 18:00 hora local — y ese día es
 * exactamente el que le quitaríamos al vendedor. Se convierte a **fecha civil de la Ciudad de
 * México** (`Intl.DateTimeFormat` con `timeZone`, sin dependencias) y se cuenta ahí.
 */

/** Zona horaria normativa del ciclo (criterio 154). No es configurable: es parte de la definición. */
export const MX_TIMEZONE = 'America/Mexico_City';

/**
 * **Festivos oficiales de México, año por año** (Art. 74 LFT + transmisión del Poder Ejecutivo).
 * Fechas civiles `YYYY-MM-DD` en hora de la Ciudad de México.
 *
 * Criterio de inclusión, para que quien extienda la tabla no tenga que reconstruirlo:
 *  1. `1-ene` · **primer lunes de febrero** (por el 5-feb) · **tercer lunes de marzo** (por el 21-mar)
 *     · `1-may` · `16-sep` · **tercer lunes de noviembre** (por el 20-nov) · `25-dic`.
 *  2. **`1-dic` sexenal**, solo cuando corresponde a la **transmisión del Poder Ejecutivo Federal**
 *     (2024, 2030, …). En 2024 cayó en **domingo**, así que no restó ningún día hábil.
 *  3. **La jornada electoral federal ordinaria** también es descanso obligatorio (reforma 2019), pero
 *     se celebra en **domingo** ⇒ **nunca resta un día hábil** y por eso no ensucia esta tabla.
 *
 * ⚠️ **NO se incluyen** los días que la costumbre trata como festivos pero **la ley no** (jueves y
 * viernes santos, 2 de noviembre, 12 de diciembre): meterlos **alargaría** plazos que le prometimos
 * al vendedor con otra fecha, y la fuente normativa es la ley, no la costumbre.
 */
export const MX_HOLIDAYS: Readonly<Record<number, readonly string[]>> = Object.freeze({
  2026: Object.freeze([
    '2026-01-01', // Año Nuevo
    '2026-02-02', // 1er lunes de febrero (5 de febrero)
    '2026-03-16', // 3er lunes de marzo (21 de marzo)
    '2026-05-01', // Día del Trabajo
    '2026-09-16', // Independencia
    '2026-11-16', // 3er lunes de noviembre (20 de noviembre)
    '2026-12-25', // Navidad
  ]),
  2027: Object.freeze([
    '2027-01-01',
    '2027-02-01',
    '2027-03-15',
    '2027-05-01', // sábado
    '2027-09-16',
    '2027-11-15',
    '2027-12-25', // sábado
  ]),
  2028: Object.freeze([
    '2028-01-01', // sábado
    '2028-02-07',
    '2028-03-20',
    '2028-05-01',
    '2028-09-16', // sábado
    '2028-11-20',
    '2028-12-25',
  ]),
  2029: Object.freeze([
    '2029-01-01',
    '2029-02-05',
    '2029-03-19',
    '2029-05-01',
    '2029-09-16', // domingo
    '2029-11-19',
    '2029-12-25',
  ]),
  2030: Object.freeze([
    '2030-01-01',
    '2030-02-04',
    '2030-03-18',
    '2030-05-01',
    '2030-09-16',
    '2030-11-18',
    // ⚠️ **PUNTO ABIERTO, DECLARADO EN VEZ DE ADIVINADO (revisar antes de 2030).** El Art. 74 LFT
    // dice literalmente **«el 1o. de diciembre de cada seis años»**, pero la reforma constitucional
    // movió la **transmisión** al **1 de octubre** a partir de 2024 y la LFT **no se actualizó**. Se
    // siembra la fecha **literal de la ley** (1-dic), que además **cae en DOMINGO en 2030** ⇒ no
    // resta ningún día hábil, así que la ambigüedad **no cambia ningún plazo hoy**. Si antes de 2030
    // se confirma que el descanso obligatorio es el **1-oct-2030 (martes)**, hay que añadirlo aquí:
    // **eso sí movería una fecha**, y por eso queda escrito y no supuesto.
    '2030-12-01',
    '2030-12-25',
  ]),
});

/** Años que la tabla cubre. Fuera de este rango, las funciones **lanzan** (fail-closed). */
export const MX_HOLIDAY_YEARS: readonly number[] = Object.keys(MX_HOLIDAYS)
  .map(Number)
  .sort((a, b) => a - b);

/**
 * Error de cobertura del calendario. **Tipo propio** para que el barrido lo pueda distinguir de
 * cualquier otro fallo y aplicar la única conducta correcta: **loggear `error` y NO expirar**.
 */
export class BusinessDaysCoverageError extends Error {
  constructor(readonly year: number) {
    super(
      `business-days: la tabla de festivos de México NO cubre el año ${year} ` +
        `(cubiertos: ${MX_HOLIDAY_YEARS.join(', ')}). Se LANZA a propósito: degradar a «no hay ` +
        'festivos» adelantaría vencimientos y expiraría ofertas de gente que sí cumplió. ' +
        'Extender `MX_HOLIDAYS` en `src/common/business-days.ts` (Art. 74 LFT).',
    );
    this.name = 'BusinessDaysCoverageError';
  }
}

/** Fecha inválida o ausente donde se esperaba un instante real. También **lanza**, nunca adivina. */
export class BusinessDaysInputError extends Error {
  constructor(message: string) {
    super(`business-days: ${message}`);
    this.name = 'BusinessDaysInputError';
  }
}

/**
 * Partes de la fecha CIVIL en `America/Mexico_City`. `Intl` con `timeZone` es la única vía sin
 * dependencias que respeta el horario de verano histórico (México lo abolió en 2022, pero los plazos
 * se pueden calcular sobre fechas anteriores y el motor ya lo sabe).
 */
const MX_DATE_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: MX_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** `YYYY-MM-DD` de un instante, en hora de la Ciudad de México. */
export function toMexicoCityDateKey(instant: Date): string {
  assertValidDate(instant, 'instant');
  // `en-CA` produce exactamente `YYYY-MM-DD`, que es el formato de la tabla y ordena lexicográfico.
  return MX_DATE_FORMAT.format(instant);
}

function assertValidDate(d: unknown, label: string): asserts d is Date {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) {
    throw new BusinessDaysInputError(
      `${label} no es una fecha válida (recibido: ${String(d)}). Se LANZA en vez de asumir "hoy": ` +
        'una fecha silenciosamente equivocada es un vencimiento silenciosamente equivocado.',
    );
  }
}

/** Conjunto de festivos del año, o **lanza** si la tabla no lo cubre. */
function holidaysOf(year: number): ReadonlySet<string> {
  const list = MX_HOLIDAYS[year];
  if (!list) throw new BusinessDaysCoverageError(year);
  return new Set(list);
}

/**
 * ¿Es día hábil esa **fecha civil** de la Ciudad de México? L-V y **no** festivo oficial.
 * **Lanza** si el año no está cubierto (fail-closed).
 */
export function isBusinessDay(instant: Date): boolean {
  const key = toMexicoCityDateKey(instant);
  const year = Number(key.slice(0, 4));
  const holidays = holidaysOf(year);
  if (holidays.has(key)) return false;
  const dow = dayOfWeekInMexicoCity(key);
  return dow >= 1 && dow <= 5; // 0=domingo … 6=sábado. **El sábado NO cuenta.**
}

/**
 * Día de la semana de una fecha civil `YYYY-MM-DD`. Se calcula sobre el **mediodía UTC** de esa fecha
 * para que ningún desfase de zona la corra un día: el día de la semana de una fecha civil es una
 * propiedad del **calendario**, no del instante.
 */
function dayOfWeekInMexicoCity(dateKey: string): number {
  return new Date(`${dateKey}T12:00:00Z`).getUTCDay();
}

/**
 * **`addBusinessDays(from, n)`** — el instante en que vencen `n` **días hábiles** contados desde
 * `from`, en `America/Mexico_City`.
 *
 * Semántica, escrita porque es la que produce la fecha que se le promete a una persona:
 *  - Se **avanza día civil a día civil** desde el siguiente a `from`, contando solo los hábiles,
 *    hasta acumular `n`. **`from` no se cuenta**: el plazo empieza a correr al día siguiente.
 *  - Se **preserva la hora del día** de `from` (el plazo vence a la misma hora, `n` días hábiles
 *    después). Los plazos se comunican con **fecha y hora explícitas**, nunca «en 2 días».
 *  - `n = 0` devuelve `from` tal cual (no hay plazo que contar).
 *
 * **Lanza** con `n` negativo o no entero, y con cualquier año que la tabla no cubra.
 */
export function addBusinessDays(from: Date, n: number): Date {
  assertValidDate(from, 'from');
  if (!Number.isInteger(n) || n < 0) {
    throw new BusinessDaysInputError(
      `n debe ser un entero >= 0 (recibido: ${String(n)}). Los diales de plazo son enteros >= 1.`,
    );
  }
  if (n === 0) return new Date(from.getTime());

  const DAY_MS = 24 * 3600 * 1000;
  let cursor = new Date(from.getTime());
  let counted = 0;
  // Cota dura: `n` días hábiles nunca necesitan más de `n*2 + 30` días naturales (fines de semana +
  // el puente más largo posible). Si se agota, es un bug de la tabla, no un plazo legítimo: se lanza
  // en vez de girar para siempre.
  const maxIterations = n * 2 + 30;
  for (let i = 0; i < maxIterations && counted < n; i++) {
    cursor = new Date(cursor.getTime() + DAY_MS);
    if (isBusinessDay(cursor)) counted++;
  }
  if (counted < n) {
    throw new BusinessDaysCoverageError(Number(toMexicoCityDateKey(cursor).slice(0, 4)));
  }
  return cursor;
}

/**
 * **`businessDaysUntil(to, from = now)`** — cuántos **días hábiles** faltan para `to`.
 *
 * Es la inversa de `addBusinessDays` y **cuenta los mismos días**: los hábiles **posteriores** a
 * `from` hasta `to` **inclusive**. Devuelve **`0` si `to` ya pasó** (nunca negativo): el consumidor
 * pregunta *«¿cuánto le queda?»*, y a algo vencido no le queda nada.
 *
 * **Lanza** con fechas inválidas o años sin cobertura, igual que su gemela — el barrido y el
 * recordatorio tienen que fallar por el **mismo** lado.
 */
export function businessDaysUntil(to: Date, from: Date = new Date()): number {
  assertValidDate(to, 'to');
  assertValidDate(from, 'from');
  if (to.getTime() <= from.getTime()) return 0;

  const DAY_MS = 24 * 3600 * 1000;
  const toKey = toMexicoCityDateKey(to);
  let cursor = new Date(from.getTime());
  let count = 0;
  // Cota dura: el plazo más largo del ciclo es de 7 días hábiles; 3660 días naturales (~10 años) es
  // holgura absurda y a la vez impide un bucle infinito si alguien pasa una fecha lejanísima.
  for (let i = 0; i < 3660; i++) {
    cursor = new Date(cursor.getTime() + DAY_MS);
    const key = toMexicoCityDateKey(cursor);
    if (isBusinessDay(cursor)) count++;
    if (key >= toKey) return count;
  }
  throw new BusinessDaysInputError(
    `businessDaysUntil: la fecha objetivo (${toKey}) está a más de 10 años de la de partida. ` +
      'Se LANZA en vez de devolver un número gigante que nadie sabría interpretar.',
  );
}

/**
 * **`businessDaysSince(from, to = now)`** — cuántos días hábiles han transcurrido desde `from`.
 *
 * Es lo que necesita la **regla 7 del barrido** (`businessDaysSince(offerIssueClockStartedAt ??
 * createdAt) >= dial 4`), y se expone aquí para que **nadie la reimplemente restando fechas**: el
 * conteo tiene que ser **el mismo** que produjo la fecha límite que se le comunicó a la persona.
 * Devuelve `0` si `to` es anterior o igual a `from`. **Lanza** con la misma disciplina.
 */
export function businessDaysSince(from: Date, to: Date = new Date()): number {
  assertValidDate(from, 'from');
  assertValidDate(to, 'to');
  if (to.getTime() <= from.getTime()) return 0;

  const DAY_MS = 24 * 3600 * 1000;
  const toKey = toMexicoCityDateKey(to);
  let cursor = new Date(from.getTime());
  let count = 0;
  for (let i = 0; i < 3660; i++) {
    cursor = new Date(cursor.getTime() + DAY_MS);
    if (toMexicoCityDateKey(cursor) > toKey) break;
    if (isBusinessDay(cursor)) count++;
    if (toMexicoCityDateKey(cursor) === toKey) break;
  }
  return count;
}
