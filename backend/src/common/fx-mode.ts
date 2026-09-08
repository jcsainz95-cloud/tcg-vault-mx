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
 * único trabajo es reproducir el pasado sin desviarse ni un caso. El **rango** (`(0, MAX]`) lo
 * imponen las dos puertas de escritura con `validateFxManualOverrideRate`, que es donde toca.
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
 * pasando**. La resolución legacy no es la semántica del modo: es **la condición inicial**, y ocurre
 * como mucho **una vez por entorno** (deja de correr en cuanto un humano toca el interruptor).
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
 * ⚠️ **El caso «manual sin número» cae al fallback y se ETIQUETA `fallback`.** I-FX4 lo prohíbe por
 * las dos puertas, así que solo se alcanza editando la BD a mano; cuando pase, el sistema dirá que
 * está cotizando con un número que nadie tecleó en vez de firmarlo como del dueño (F6).
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

  const automatic: FxAutomaticBlock = {
    rate: autoRate,
    effectiveDate: autoDate == null ? null : fxIsoDate(autoDate),
    // `ageDays: null` ⟺ `rate: null` (§M2-F.3): sin número no hay edad que declarar.
    ageDays: autoRate == null ? null : ageDays,
    status,
    applied: resolved.mode === 'auto' && status !== 'missing',
  };

  // ── Qué RIGE ──
  let rate: number;
  let source: FxSource;
  let effectiveDate: string;
  if (resolved.mode === 'manual' && manualRate != null) {
    rate = manualRate;
    source = 'manual';
    effectiveDate = todayIso;
  } else if (resolved.mode === 'auto' && autoRate != null && automatic.effectiveDate != null) {
    rate = autoRate;
    source = 'banxico';
    effectiveDate = automatic.effectiveDate;
  } else {
    rate = FX_FALLBACK_RATE;
    source = 'fallback';
    effectiveDate = todayIso;
  }

  return {
    rate,
    bufferPct,
    source,
    effectiveDate,
    mode: resolved.mode,
    modeResolvedFrom: resolved.from,
    manual: { rate: manualRate, applied: resolved.mode === 'manual' },
    automatic,
  };
}

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
  return db.fxRate.findFirst({ where: { source: 'banxico' }, orderBy: { effectiveDate: 'desc' } });
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
