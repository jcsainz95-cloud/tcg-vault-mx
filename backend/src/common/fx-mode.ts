/**
 * fx-mode.ts — **EL MODO DEL TIPO DE CAMBIO, Y EL MODO NO ES EL VALOR.**
 * (v1.63.1 · API_CONTRACT §M2-F · ARCHITECTURE §4.43 · **DINERO**)
 *
 * ### Por qué esto vive en `common/` y no dentro de `pricing/`
 * Mismo precedente que `common/pricing-curve.ts` (§4.36.2): la regla la necesitan **dos módulos que
 * no se pueden importar entre sí**. `FxService` (pricing) resuelve el modo para LEER la tasa;
 * `SettingsService` lo resuelve para **pinnearlo** (I-FX2) y para bloquear el borrado del valor
 * (I-FX4) — y `FxService` ya depende de `SettingsService`, así que la dependencia inversa sería un
 * ciclo. Una función pura en zona compartida es la única forma de que **haya UNA sola
 * implementación** de un predicado de dinero (§0-B.1), que es exactamente lo que I-FX1 exige.
 *
 * ### Las tres piezas que exporta, y por qué son tres
 *  1. `resolveFxMode()` — **la** regla de resolución (§M2-F.1). Es la única inferencia del sistema.
 *  2. `projectFxState()` — la proyección del `FxStateDTO` a partir de entradas ya leídas. **Pura**:
 *     las cuatro rutas de FX (`GET`, `PUT /admin/fx`, `PUT /admin/fx/mode`, `POST .../refresh`)
 *     devuelven el MISMO DTO porque lo construye el MISMO código, y porque es pura se puede
 *     proyectar el estado RESULTANTE de una escritura **dentro de la transacción**, sin releer.
 *  3. `latestBanxicoFxRate()` — el LECTOR de `FxRate`, con el filtro `source: 'banxico'` de I-FX5
 *     escrito **en un solo sitio**.
 */

/** Modos que la API conoce (`FxRateMode` del contrato). ⛔ `"legacy"` NO es uno de ellos. */
export type FxRateMode = 'auto' | 'manual';

/** Fuente emitida en `FxStateDTO.source` (`FxSource`). `fallback` es v1.63 y corrige una mentira. */
export type FxSource = 'banxico' | 'manual' | 'fallback';

/** Frescura de la tasa automática (`FxAutomaticStatus`). La deriva el SERVIDOR, no la pantalla. */
export type FxAutomaticStatus = 'fresh' | 'stale' | 'missing';

/** De dónde salió el modo: de la fila explícita, o de la resolución legacy (§M2-F.1). */
export type FxModeResolvedFrom = 'setting' | 'legacy';

/**
 * ⭐ **EL SENTINEL.** Valor SEMBRADO de `fx_rate_mode`: *«ningún humano ha tocado el interruptor
 * todavía en este entorno»*. ⛔ **Nunca sale por la API** — `resolveFxMode()` lo traduce y su única
 * proyección observable es `modeResolvedFrom: "legacy"`.
 *
 * ⚠️ **NO se sustituye por `"auto"` ni por `"manual"`** (ARCHITECTURE §4.43g, candado **FX-6(c)**):
 * el default de código se aplica en la primera lectura **antes** de que corra ningún seed, así que
 * un default `"auto"` sería, literalmente, el mecanismo por el que producción —que hoy tiene un
 * override de 19.0000 vivo— se pasaría sola a Banxico al desplegar. Con `"legacy"` **ningún valor de
 * `SETTING_DEFAULTS` puede cambiar la conducta de producción**, corra el seed o no.
 */
export const FX_RATE_MODE_LEGACY = 'legacy';

/** Los TRES valores ALMACENABLES de `fx_rate_mode` (dos de API + el sentinel). */
export const FX_RATE_MODE_STORED_VALUES = ['auto', 'manual', FX_RATE_MODE_LEGACY] as const;

/**
 * Fallback duro cuando no hay NADA que aplicar (ni fila `banxico`, ni tasa manual aplicable).
 * Ya existía en el código (`fx.service.ts:58`); lo que cambia en v1.63 es que **deja de mentir**:
 * se reporta `source: "fallback"`, no `source: "manual"`.
 */
export const FX_FALLBACK_RATE = 18;

/**
 * Umbral de frescura de la tasa de Banxico. **CONSTANTE DE CÓDIGO, NO dial** (ARCHITECTURE §4.43e):
 * el FIX se publica en días hábiles, así que un lunes leyendo el dato del viernes tiene 3 días de
 * edad con toda normalidad y un puente lo lleva a 4. Con 5, la alerta señala **una caída real**.
 * *Una alerta que grita cada lunes es una alerta que se aprende a ignorar.* (Promoverlo a dial es
 * Q-F2 y no cambia ninguna otra pieza.)
 */
export const FX_AUTO_STALE_AFTER_DAYS = 5;

// =================================================================================================
// ⭐⭐ LA BANDA DE CORDURA DE LA TASA — `[1, 1000]`, UNA SOLA, PARA LAS DOS PUERTAS
// (v1.63.4 · API_CONTRACT §M2-F.8 · ARCHITECTURE §4.43c-quinquies · candado `FX-24` · **DINERO**)
// =================================================================================================

/**
 * ⭐ **Extremo INFERIOR de la banda, CERRADO.** *(v1.63.4 — decisión del ARQUITECTO, §M2-F.8.)*
 *
 * Hasta v1.63.3 la banda era `(0, 1000]`: **tenía techo y no tenía piso.** Medido con el parser real,
 * `"0.0001"` y `"0.0000001"` **entraban por las dos puertas**, y con `0.0001` una carta de USD 100
 * pasa de **MX$ 1,957.00 a MX$ 0.0103** en la siguiente lectura de precio. *Es el espejo exacto del
 * `"9999"` que motivó `S-FX-2`: la banda se puso para atrapar esta clase de valor y sólo la atrapaba
 * por arriba.*
 *
 * **Por qué `1`, y por qué de negocio:** **el peso nunca ha valido más que el dólar.** El par se
 * cotiza en **pesos por dólar** y ha vivido siempre entre ~3 y ~25. Por debajo de `1` el número **no
 * es el par**: es su **inversa** (dólares por peso, ≈`0.0526` — el vector más plausible, y el que se
 * produce si cambia la serie SIE o si la fuente publica el par al revés), un **error de escala**
 * (÷100, ÷1000) o **basura truncada**. *El `1` no es un umbral de mercado: es la frontera entre
 * «pesos por dólar» y «no es eso».*
 *
 * ⚠️ **Y no se aprieta más** (a 5, a 10): lo que empuja al peso fuera de rango es una crisis, que lo
 * hace **más débil** —número **más alto**—, así que un piso apretado nunca serviría para lo que se le
 * pediría. Lo único que llevaría la cotización por debajo de `1` es una **redenominación**, que
 * **debe** parar el sistema y que alguien mire, no repreciar sola.
 */
export const FX_RATE_MIN = 1;

/**
 * **Extremo SUPERIOR de la banda, CERRADO** (`FX-B1`, S-FX-2). El tipo de cambio real MXN/USD ronda
 * 15-25; 1000 deja ~40-65× de holgura y a la vez **ACOTA la valuación**: sin techo, un override
 * absurdo (p. ej. `1e9`) desborda la columna `Int priceMxnCents` (~2.1e9) en el job `price-ingest`
 * (excepción de Prisma = DoS). Medido: `"9999"` multiplicaba el catálogo por ~549 **sin desbordar
 * ningún clamp**, así que no daba error: **daba precios**.
 */
export const FX_RATE_MAX = 1000;

/**
 * ⭐⭐ **EL PREDICADO ÚNICO DE LA BANDA. Las dos puertas de ESCRITURA llaman AQUÍ.**
 *
 * `validateFxManualOverrideRate` (la tecleada: `PUT /admin/fx` y `PUT /admin/settings`) y
 * `parseBanxicoRate` (la de la SIE) comparten **este** cuerpo, y no dos copias del mismo `>= 1`.
 *
 * ### Por qué UNA banda y no dos *(la simetría de `FX-B1`/`FX-B2` se **RATIFICA**, ⛔ no se deroga)*
 * 1. **La banda afirma algo del VALOR, no de la puerta.** El conversor (`liveMxnCents`) **no sabe**
 *    por dónde entró el número. Dos bandas significarían que hay valores que **son una tasa cuando
 *    los teclea un humano y no lo son cuando los publica Banxico**: eso no es una política, es una
 *    contradicción.
 * 2. **La única asimetría defendible iría al revés de lo que nadie quiere.** Endurecer *sólo*
 *    Banxico ⇒ rechazaríamos del **banco central** números que aceptamos del teclado; relajar *sólo*
 *    la manual ⇒ el typo es precisamente lo que la banda vino a atrapar (`FX-B1` nació de un `1e9`
 *    **tecleado**).
 * 3. **La diferencia real entre las puertas ya está cobrada en la CONSECUENCIA** (§M2-F.8): la
 *    tecleada devuelve `422` sin escritura parcial; la de Banxico no escribe fila, deja la tasa
 *    anterior en su sitio y sale `failed/invalid_payload`.
 *
 * ⛔ **Dos literales `1` en dos ficheros son dos bandas esperando a divergir**, y esa es justo la
 * mutación realista que `FX-24(b)` pone en rojo — porque el arreglo se hace en dos ficheros.
 *
 * ⚠️ **Esto es una puerta de ESCRITURA, ⛔ NO de LECTURA** — ver {@link parseManualRate}.
 */
export function isFxRateInBand(n: number): boolean {
  return Number.isFinite(n) && n >= FX_RATE_MIN && n <= FX_RATE_MAX;
}

/**
 * La banda, en texto, **para el `message` del `422` y para el log**. `FX-24(d)` exige que el error de
 * la puerta tecleada **NOMBRE LOS DOS EXTREMOS** (hasta v1.63.3 sólo nombraba el techo, y quien
 * tecleaba `0.05` recibía un mensaje que no explicaba nada de lo que acababa de pasar).
 */
export const FX_RATE_BAND_TEXT = `[${FX_RATE_MIN}, ${FX_RATE_MAX}]`;

/** El bloque `automatic` de `FxStateDTO` (§M2-F.3). Viaja SIEMPRE, rija o no. */
export interface FxAutomaticBlock {
  rate: number | null;
  effectiveDate: string | null;
  ageDays: number | null;
  status: FxAutomaticStatus;
  applied: boolean;
}

/** El bloque `manual` de `FxStateDTO` (§M2-F.3). Viaja SIEMPRE, rija o no. */
export interface FxManualBlock {
  rate: number | null;
  applied: boolean;
}

/**
 * `FxStateDTO` — forma CANÓNICA y ÚNICA (§M2-F.3, `CANON: estado-del-tipo-de-cambio`).
 * Las CUATRO claves de v1.62.2 (`rate`, `bufferPct`, `source`, `effectiveDate`) conservan
 * EXACTAMENTE su significado: el cambio es **aditivo**, con la única excepción declarada de que
 * `source` gana el valor `"fallback"`.
 */
export interface FxStateDTO {
  rate: number;
  bufferPct: number;
  source: FxSource;
  effectiveDate: string;
  /**
   * ⭐⭐ **v1.63.4 · `D-FX-5` (§M2-F.3 regla 6) — EL RESPALDO SE PUBLICA, Y VIAJA SIEMPRE.**
   *
   * `FX_FALLBACK_RATE`: lo que regiría **si ninguna de las dos ramas puede regir**. Obligatorio, al
   * **nivel superior**, en las CUATRO rutas y en TODAS las respuestas, con el MISMO valor siempre.
   *
   * - ⛔ **NO va dentro de `automatic`**: desde v1.63.3 `source:"fallback"` es alcanzable **también
   *   con `mode:"manual"`** (4.ª fila de §M2-F.1), así que el respaldo no es de la rama automática:
   *   es del **estado entero**. Anidarlo ahí invitaría justo al error que la **regla 5** prohíbe —
   *   presentar el 18 *«como si fuera la de Banxico»*.
   * - **Por qué SIEMPRE y no sólo con `status:"missing"`:** el diálogo del acuse
   *   (`DESIGN_SYSTEM §30.8`) tiene que **nombrar este número ANTES de que el humano toque nada**;
   *   hasta v1.63.3 sólo existía dentro del `422`, así que la pantalla mandaba un `PUT` sin acuse
   *   **sólo para leer el error**. *Un dato que la norma exige enseñar antes de actuar no puede
   *   vivir sólo en la respuesta a un acto.*
   * - **No choca con la regla 4** (⛔ *el salto en % no es un campo*): aquélla prohíbe **derivar** en
   *   el servidor lo que el humano resta en pantalla. Esto **no se deriva de nada**: es un literal
   *   del servidor que el cliente no puede conocer. Misma familia que `automatic.status`.
   * - ⭐ **Invariante (i):** `source === "fallback"` ⟹ `rate === fallbackRate`.
   * - ⭐ **Invariante (ii):** `details.fallbackRate` del `422 FX_NO_AUTOMATIC_RATE` **es este mismo
   *   número**. ⛔ El campo **NO sustituye al `details`**: ese error es la carrera real y *un error
   *   de dinero tiene que poder explicarse solo*.
   * - ⛔ **No es un dial:** publicar un número y permitir editarlo son dos decisiones distintas
   *   (candado `FX-25(d)`; mismo género que `FX_AUTO_STALE_AFTER_DAYS`).
   */
  fallbackRate: number;
  mode: FxRateMode;
  modeResolvedFrom: FxModeResolvedFrom;
  manual: FxManualBlock;
  automatic: FxAutomaticBlock;
}

/** Fila `FxRate` tal como la necesita la proyección (Prisma devuelve `rate` como `Decimal`). */
export interface FxRateRowLike {
  rate: unknown;
  effectiveDate: Date;
}

/** Entradas de la proyección: TODO lo que hace falta para decidir qué tasa rige. */
export interface FxInputs {
  /** Valor CRUDO de la fila `fx_rate_mode` (o su default de código si la fila no existe). */
  rawMode: unknown;
  /** Valor CRUDO de `fx_manual_override_rate` (o su default, `null`). */
  rawManualRate: unknown;
  /** Colchón vigente (`fx_buffer_pct`), del DIAL — nunca el congelado en la fila `FxRate` (#13). */
  bufferPct: number;
  /** ⚠️ La última fila `FxRate` **de origen `banxico`**, NUNCA «la última fila» a secas (I-FX5). */
  latestBanxico: FxRateRowLike | null;
}

/** Fecha de hoy a medianoche UTC (misma normalización que usaba `fx.service.ts`). */
export function fxToday(now: Date = new Date()): Date {
  const d = new Date(now.getTime());
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** `yyyy-MM-dd` en UTC. */
export function fxIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Interpreta el valor guardado de `fx_manual_override_rate` como TASA APLICABLE, o `null`.
 *
 * ⚠️ **Paridad LITERAL con la conducta de v1.62.2** (`fx.service.ts:37`, hecho F2): *«existe y
 * `Number(v) > 0`»*. No se endurece aquí: este predicado alimenta la **resolución legacy**, cuyo
 * único trabajo es reproducir el pasado sin desviarse ni un caso. La **banda** (`[1, 1000]`,
 * {@link isFxRateInBand}) la imponen las dos puertas de ESCRITURA, que es donde toca.
 *
 * ### ⛔⛔ **v1.63.4 — ESTE `> 0` NO SE SUBE AL PISO DE LA BANDA. Es normativo (§M2-F.8).**
 * Dos razones, y las dos son de conducta, no de estilo:
 * 1. **El modo saltaría solo.** En un entorno con un valor **sub-piso ya guardado**, un `>= 1` aquí
 *    haría que la resolución legacy dejara de ver número ⇒ **el modo pasaría de `manual` a `auto` en
 *    el primer `GET` después del deploy** — *el sistema cambiando de conducta por su cuenta*, que es
 *    exactamente lo que **`FX-6`** existe para poner en rojo.
 * 2. **La lectura tampoco se defiende, a diferencia de la 4.ª fila de §M2-F.1.** Allí **no había
 *    número** que obedecer y el estado era inalcanzable por API; **aquí hay un número y lo puso un
 *    humano**. Ignorarlo sería un **repreciado sin autor**. *La lectura OBEDECE; la banda guarda la
 *    ESCRITURA.* Un valor sub-piso ya guardado se corrige por **un acto humano por la puerta normal**
 *    (`PUT /admin/fx { rate }`), ⛔ **no por una migración que reescriba dinero** — y es ruidoso por
 *    construcción: la tarjeta lo pinta en la columna MANUAL, con `RIGE`, y la cifra es absurda a
 *    simple vista.
 */
export function parseManualRate(raw: unknown): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * ⭐ **`resolveFxMode()` — LA regla de resolución del modo (§M2-F.1, I-FX1).**
 *
 * | Fila `fx_rate_mode` | Modo | `modeResolvedFrom` |
 * |---|---|---|
 * | exactamente `"auto"` | auto (el número manual se conserva y **no se mira**) | `setting` |
 * | exactamente `"manual"` | manual | `setting` |
 * | `"legacy"` (el seed), ausente, `null` o **basura** | **RESOLUCIÓN LEGACY** = v1.62.2 literal | `legacy` |
 *
 * ⚠️ **Basura ⇒ legacy, y NO ⇒ auto** (ARCHITECTURE §4.43c): aquí no existe una dirección «apagada»
 * —las dos posiciones convierten dinero—, así que la dirección segura es **no cambiar lo que está
 * pasando**.
 *
 * ### ⚠️⚠️ **D-FX-2 (v1.63.3) — lo que esta nota decía era FALSO, y estaba en el peor sitio posible**
 * Decía: *«la resolución legacy … ocurre como mucho **una vez por entorno** (deja de correr en cuanto
 * un humano toca el interruptor)»*. **§4.43(c) I-FX1 lo declaró falso en v1.63.2** y el código
 * siempre se comportó bien; **el que mentía era el comentario** — justo donde el siguiente va a venir
 * a razonar sobre esto.
 *
 * **Lo correcto, y la distinción es la que se confundía:**
 * - **La INFERENCIA corre en CADA LECTURA** mientras la fila valga `"legacy"` (o falte, o sea basura).
 *   Es **pura y no escribe nada**, así que un entorno que nunca toca la FX resuelve `legacy`
 *   **para siempre, y legítimamente**.
 * - **Lo que ocurre una vez es la MATERIALIZACIÓN**, y por **DOS** vías: el interruptor
 *   (`PUT /admin/fx/mode`) **o** el pin de **I-FX2** (toda escritura del valor).
 *
 * *«La inferencia corre una vez» y «la transición pasa una vez» no son la misma frase*, y la primera
 * invita a razonar que este camino está muerto en producción — que es exactamente el razonamiento por
 * el que alguien dejaría de mirar la rama que hoy decide el modo en cada `GET /admin/fx`.
 */
export function resolveFxMode(
  rawMode: unknown,
  rawManualRate: unknown,
): { mode: FxRateMode; from: FxModeResolvedFrom } {
  if (rawMode === 'auto') return { mode: 'auto', from: 'setting' };
  if (rawMode === 'manual') return { mode: 'manual', from: 'setting' };
  // `"legacy"`, ausente, null, `true`, `"AUTO"`, basura → la conducta de v1.62.2, literal.
  return { mode: parseManualRate(rawManualRate) != null ? 'manual' : 'auto', from: 'legacy' };
}

/**
 * ⭐ **`projectFxState()` — proyecta el `FxStateDTO` a partir de entradas ya leídas. PURA.**
 *
 * La precedencia es la de **I-FX5** (§M2-F.1, tabla), y no admite una cuarta rama:
 *
 * | Modo | Qué rige | `source` |
 * |---|---|---|
 * | `manual` | `fx_manual_override_rate` (el AJUSTE). ⛔ **No** la fila `FxRate` | `manual` |
 * | `auto` | la última fila `FxRate` con `source='banxico'` | `banxico` |
 * | `auto` sin fila `banxico` | el fallback duro (18) | `fallback` |
 *
 * ⇒ **En modo `auto`, `rate === automatic.rate` SIEMPRE** (identidad normativa; candado FX-11).
 *
 * ### ⭐⭐ **La CUARTA fila (v1.63.3 · `D-FX-1`, candado `FX-23`): «manual SIN número»**
 *
 * | Modo | Qué rige | `source` |
 * |---|---|---|
 * | ⚠️ `manual` **sin número** — ILEGAL por I-FX4 | **la última fila `banxico`**; si tampoco la hay, el fallback | `banxico` / `fallback` |
 *
 * Hasta v1.63.2 el contrato **razonaba** que ese estado era inalcanzable, así que la lectura no se
 * defendía: caía al **fallback duro de 18**. **La carrera `S-FX-1` lo alcanzaba por HTTP con dos
 * `200`**; I-FX6 cerró esa vía, pero **una migración o un `psql` lo siguen creando**. Decisión del
 * **arquitecto** (contrato v1.63.3, `§M2-F.1`; `ARCHITECTURE §4.43c-quater`), no de backend:
 *
 * 1. **El 18 no es una tasa: es un literal escondido** — misma doctrina que I-FX5.
 * 2. **No es fail-closed:** ocultar dinero que sí tenemos **no es money-safe**. Entre *«un número real
 *    que Banxico publicó»* y *«un literal del código que nadie tecleó»*, **rige el primero**.
 * 3. **Hoy el DTO miente ahí:** emitía `source:"fallback"` **junto con** `manual.applied: true` —
 *    *«el número del dueño está aplicado»* **sobre un número que no existe**.
 *
 * ⛔ **La lectura ELIGE MEJOR, NO REPARA:** el `mode` **no se corrige ni se reescribe**. Y ⛔ esto **no
 * relaja I-FX4** —las dos puertas siguen devolviendo `422`—: **hace la corrupción más visible**, porque
 * la combinación resultante `mode:"manual"` + `manual.rate:null` + `manual.applied:false` +
 * `source:"banxico"` **no la produce ninguna secuencia legal por API**.
 *
 * ### ⭐ `applied` se deriva de `source` (v1.63.3 · `D-FX-3`)
 * `applied` significa **«esta rama RIGE AHORA MISMO»**. Las dos definiciones anteriores
 * —`manual.applied ⟺ mode === "manual"` y `automatic.applied ⟺ mode === "auto" ∧ status !== "missing"`—
 * son **equivalentes a ésta en todo estado alcanzable por la API**, así que ⛔ ningún cliente ve un
 * cambio; se reescriben porque **dejaban de ser ciertas justo en el estado ilegal**.
 * ⇒ **Regla mecánica: exactamente una de las dos `applied` es `true` ⟺ `source` la nombra; con
 * `source:"fallback"` las DOS son `false`.**
 */
export function projectFxState(inputs: FxInputs, now: Date = new Date()): FxStateDTO {
  const { rawMode, rawManualRate, bufferPct, latestBanxico } = inputs;
  const resolved = resolveFxMode(rawMode, rawManualRate);
  const manualRate = parseManualRate(rawManualRate);
  const today = fxToday(now);
  const todayIso = fxIsoDate(today);

  // ── Bloque `automatic`: la de Banxico VIGENTE, RIJA O NO (§M2-F.3 regla 1) ──
  const autoRateRaw = latestBanxico == null ? null : Number(latestBanxico.rate);
  const autoRate = autoRateRaw != null && Number.isFinite(autoRateRaw) ? autoRateRaw : null;
  const autoDate = latestBanxico == null ? null : fxToday(latestBanxico.effectiveDate);
  const ageDays =
    autoDate == null ? null : Math.floor((today.getTime() - autoDate.getTime()) / 86_400_000);
  const status: FxAutomaticStatus =
    autoRate == null || ageDays == null
      ? 'missing'
      : ageDays > FX_AUTO_STALE_AFTER_DAYS
        ? 'stale'
        : 'fresh';

  const autoEffectiveDate = autoDate == null ? null : fxIsoDate(autoDate);

  // ── Qué RIGE ──
  // ⚠️ v1.63.3 · D-FX-1 — **el orden cambió**: primero se decide `source`, y `applied` se deriva de
  // él (D-FX-3). Antes `automatic.applied` se calculaba arriba a partir del `mode`, que es
  // precisamente lo que mentía en el estado ilegal.
  let rate: number;
  let source: FxSource;
  let effectiveDate: string;
  if (resolved.mode === 'manual' && manualRate != null) {
    rate = manualRate;
    source = 'manual';
    effectiveDate = todayIso;
  } else if (autoRate != null && autoEffectiveDate != null) {
    // ⭐ v1.63.3 · D-FX-1 — aquí ya **NO** se exige `mode === 'auto'`, y esa condición retirada **es**
    // la cuarta fila de §M2-F.1: en el estado ilegal «manual sin número», rige la última fila
    // `banxico` en vez del literal 18. ⛔ El `mode` sigue diciendo `manual`: no se repara nada.
    rate = autoRate;
    source = 'banxico';
    effectiveDate = autoEffectiveDate;
  } else {
    // Ni tasa manual aplicable ni fila `banxico`: el fallback duro, **etiquetado como lo que es**.
    rate = FX_FALLBACK_RATE;
    source = 'fallback';
    effectiveDate = todayIso;
  }

  const automatic: FxAutomaticBlock = {
    rate: autoRate,
    effectiveDate: autoEffectiveDate,
    // `ageDays: null` ⟺ `rate: null` (§M2-F.3): sin número no hay edad que declarar.
    ageDays: autoRate == null ? null : ageDays,
    status,
    // ⭐ D-FX-3 — `applied` ⟺ «esta rama rige AHORA MISMO». Equivalente a la definición vieja en todo
    // estado alcanzable por API; deja de mentir en el ilegal.
    applied: source === 'banxico',
  };

  return {
    rate,
    bufferPct,
    source,
    effectiveDate,
    // ⭐ D-FX-5 — la CONSTANTE de respaldo, no estado. Se emite en las cuatro rutas porque las
    // cuatro salen de aquí: **no hay una segunda forma de construir este DTO** (candado FX-25(a)).
    // El invariante (i) —`source === 'fallback' ⇒ rate === fallbackRate`— se cumple por
    // construcción: la rama `else` de arriba asigna `rate = FX_FALLBACK_RATE`, la MISMA constante.
    fallbackRate: FX_FALLBACK_RATE,
    mode: resolved.mode,
    modeResolvedFrom: resolved.from,
    manual: { rate: manualRate, applied: source === 'manual' },
    automatic,
  };
}

/**
 * Cliente mínimo para leer una fila `ConfigSetting`. Existe para que **la lectura del estado del FX
 * pueda ir por el `tx` que tiene el candado** (S-FX-1) sin que `SettingsService` dependa de Prisma.
 */
export interface SettingRowReader {
  configSetting: {
    findUnique(args: { where: { key: string } }): Promise<{ valueJson: unknown } | null>;
  };
}

/** Todo lo que hace falta para proyectar el estado del FX desde un solo handle (cliente o `tx`). */
export type FxReadHandle = FxRateReader & SettingRowReader;

/** Cliente mínimo que necesita el lector de `FxRate` (vale `PrismaService` y `TransactionClient`). */
export interface FxRateReader {
  fxRate: {
    findFirst(args: {
      where: { source: string };
      orderBy: { effectiveDate: 'desc' };
    }): Promise<FxRateRowLike | null>;
  };
}

/**
 * ⭐ **I-FX5 — el LECTOR, con el filtro por fuente en UN SOLO SITIO.**
 *
 * **Medido (F8):** `PUT /admin/fx { rate }` escribe una fila `FxRate { id:'manual-<hoy>',
 * source:'manual' }` y el lector caía a `findFirst({ orderBy:{ effectiveDate:'desc' } })` **sin
 * filtrar por fuente** ⇒ en modo `auto` esa fila **empataba o ganaba** a la de Banxico y el número
 * guardado regía igual, por una vía que I-FX2 no cubre.
 *
 * **El arreglo es del LECTOR, no del escritor** (decisión, §4.43c-bis): el bug es del lector; el
 * escritor lleva meses en producción y retirarlo para arreglar una lectura es el riesgo mayor; y la
 * fila queda como **traza forense** («este día un humano fijó 25»), que es para lo que sirve.
 *
 * ⇒ **Una fila `FxRate` con `source='manual'` NO RIGE NUNCA, en ningún modo.**
 */
export function latestBanxicoFxRate(db: FxRateReader): Promise<FxRateRowLike | null> {
  // PROJECTION-EXEMPT (S49-R4): helper INTERNO de lectura. La fila NO se devuelve por ninguna ruta:
  // sus dos campos (`rate`, `effectiveDate`) los consume `projectFxState()`, que emite el
  // `FxStateDTO` declarado en §M2-F.3. Ningún endpoint entrega esta entidad.
  return db.fxRate.findFirst({ where: BANXICO_FX_WHERE, orderBy: BANXICO_FX_ORDER });
}

/**
 * ⭐ **I-FX5, como PREDICADO REUTILIZABLE — el mismo patrón que `MONEY_REF_WHERE`.**
 *
 * *«Una fila `FxRate` con `source='manual'` no rige nunca»* dejó de ser una regla del lector de
 * `projectFxState` en el momento en que **otra superficie** —el `dataHealth` del tablero— también
 * afirma algo sobre la frescura de la FX. Con la regla escrita **dos veces**, la siguiente lectura
 * que alguien añada la escribirá **tres**, y una de las tres se olvidará del filtro: que es
 * exactamente el defecto que I-FX5 vino a cerrar.
 *
 * ⛔ **Ningún lector de `FxRate` fuera de tests puede hacer `findFirst` sin este predicado.**
 */
export const BANXICO_FX_WHERE = { source: 'banxico' } as const;

/**
 * Y el ORDEN va con el predicado, porque **también es parte de la regla**: la fila que rige es la de
 * **`effectiveDate` más reciente**, no la escrita más tarde. Separarlos deja abierta la mitad del
 * defecto — dos superficies que filtran igual y ordenan distinto **pueden nombrar filas distintas**.
 */
export const BANXICO_FX_ORDER = { effectiveDate: 'desc' } as const;

// =================================================================================================
// ⭐⭐ S-FX-1 — LA PUERTA ÚNICA DEL FX (v1.63.2, hallazgo CRÍTICO del pentester)
// =================================================================================================

/**
 * ⭐⭐ **La clave del `pg_advisory_xact_lock` que SERIALIZA las dos puertas del tipo de cambio.**
 *
 * ### El defecto que esto cierra, medido en vivo (S-FX-1, `PENTEST_NOTES`)
 * El estado del dinero **no vive en una fila: vive en DOS** —`fx_rate_mode` y
 * `fx_manual_override_rate`— y el invariante que las ata (**I-FX4: «manual sin número» no existe**)
 * lo comprobaban **dos rutas distintas, cada una sobre su propia lectura previa**:
 *
 * | | Puerta A · `PUT /admin/settings` | Puerta B · `PUT /admin/fx/mode` |
 * |---|---|---|
 * | Comprueba | «no borres el número si el modo es manual» | «no pases a manual si no hay número» |
 * | Escribía | `fx_manual_override_rate` | `fx_rate_mode` |
 *
 * **Filas distintas ⇒ Postgres nunca las hace colisionar: las dos commitean siempre.** Con ~20 ms de
 * ventaja —jitter de red normal, un doble-submit del panel, un reintento— quedaba
 * `mode:"manual"` con la tasa en `null`, que cae al **fallback duro de 18**: **−5.26 % instantáneo
 * sobre todo lo que compramos y vendemos**, sin acuse y con las dos peticiones devolviendo `200`.
 * Y la bitácora de `fx.mode.change` afirmaba `19 / manual` mientras el sistema cotizaba
 * `18 / fallback` — **el registro oficial mentía**, así que ni reconstruir qué rigió era posible.
 *
 * ### Por qué un advisory lock y no un `SELECT … FOR UPDATE`
 * Porque **lo que hay que serializar no es una fila: es la REGLA**. Bloquear las dos filas exigiría
 * que las dos puertas supieran de antemano cuáles tocan (y la puerta A ni siquiera escribe
 * `fx_rate_mode` salvo que el pin materialice). El advisory lock es **por transacción**
 * (`_xact_`: se suelta solo al commit o al rollback, no hay forma de olvidarse) y no depende de qué
 * filas acabe tocando cada rama.
 *
 * ### ⚠️ La mitad que NO es el lock, y sin ella el lock no sirve de nada
 * **Serializar no basta: el perdedor tiene que VOLVER A LEER.** Una transacción que se bloquea, entra
 * y escribe basándose en la lectura que hizo **antes** de bloquearse commitea el mismo estado
 * imposible, solo que más tarde. ⇒ **Dentro del lock: leer, validar y proyectar lo que se audita.**
 * *Es la regla entera: `lockFxGate` → releer → precondiciones → escribir → auditar con la
 * proyección de dentro.*
 */
export const FX_GATE_LOCK_KEY = 63_120_863;

/** Lo mínimo que necesita {@link lockFxGate}: el handle de una transacción de Prisma. */
export interface FxGateLocker {
  $executeRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
}

/**
 * ⭐⭐ Toma la puerta única del FX **dentro de la transacción `tx`**. Se libera sola al commit o al
 * rollback (`pg_advisory_xact_lock`).
 *
 * ⛔ **Toda ruta que escriba `fx_rate_mode` o `fx_manual_override_rate` empieza por aquí**, y lo hace
 * **antes** de leer el estado que va a validar. Una ruta nueva que se salte esta llamada reabre
 * S-FX-1 exacto, no una variante.
 */
export async function lockFxGate(tx: FxGateLocker): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${FX_GATE_LOCK_KEY})`;
}

/**
 * Instantánea AUDITABLE del estado de la FX: **los dos números, no los dos rótulos** (§M2-F.4).
 * *«Cambié a automático» no es dinero auditable; «pasé de 19.0000 (manual) a 18.2431 (banxico, del
 * 2026-09-05)» sí lo es.* Y lleva `bufferPct` porque el precio convertido es `tasa × (1 + colchón)`:
 * **sin el colchón la entrada no permite reconstruir el precio de aquel día**, que es la única
 * pregunta que se le va a hacer a este registro.
 */
export interface FxAuditState {
  mode: FxRateMode;
  effectiveRate: number;
  source: FxSource;
  effectiveDate: string;
  bufferPct: number;
}

/** Proyecta la instantánea auditable desde un `FxStateDTO` (misma fuente, sin segunda cuenta). */
export function toFxAuditState(state: FxStateDTO): FxAuditState {
  return {
    mode: state.mode,
    effectiveRate: state.rate,
    source: state.source,
    effectiveDate: state.effectiveDate,
    bufferPct: state.bufferPct,
  };
}
