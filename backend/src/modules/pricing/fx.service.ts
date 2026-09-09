import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { SettingKey } from '../settings/settings.constants';
import { BusinessException } from '../../common/business.exception';
import type { AuditEntry } from '../audit/audit.service';
import {
  FX_FALLBACK_RATE,
  FX_RATE_BAND_TEXT,
  FxInputs,
  FxRateMode,
  FxReadHandle,
  FxStateDTO,
  fxIsoDate,
  fxToday,
  isFxRateInBand,
  latestBanxicoFxRate,
  lockFxGate,
  projectFxState,
  toFxAuditState,
} from '../../common/fx-mode';

function today(): Date {
  return fxToday();
}

/** Resultado REAL del fetch a Banxico (§M2-F.5). `FxRefreshOutcome` del contrato. */
export type FxRefreshOutcome = 'updated' | 'unchanged' | 'failed';

/** Por qué falló el fetch. Solo viaja con `outcome: "failed"`. */
export type FxRefreshFailureReason = 'no_token' | 'http_error' | 'invalid_payload' | 'network_error';

/**
 * ⭐⭐ **S-FX-2 — el parser de la SIE, con BANDA DE CORDURA** (hallazgo ALTO del pentester).
 *
 * ### Las dos cosas que estaban mal, y son dos
 * **(1) Asimetría de validación, y al revés de como debe ser.** La tasa **tecleada** por un humano
 * está acotada a la banda `[1, 1000]` desde FX-B1. La que **llega de Banxico** —la que
 * en modo `auto` rige **sin que ningún humano la mire**— solo comprobaba `isFinite && > 0`. *La
 * fuente menos vigilada era la única que nadie ve pasar.* Medido: `"9999"` entraba y multiplicaba el
 * catálogo por ~549 sin desbordar ningún clamp, así que **no daba error: daba precios.**
 *
 * **(2) El parser leía mal un formato plausible.** `parseFloat(raw.replace(',', ''))` quita **solo la
 * primera** coma: `"19,5"` → **`195`** (×10), `"2,000,000"` → `2000`, `"1,2,3"` → `12`. El disparo
 * realista no es un atacante —el host es un literal HTTPS fijo, no hay SSRF—: es que **Banxico cambie
 * de formato** y nos devuelva coma decimal. Un ×10 en todo el catálogo por un separador.
 *
 * ### La decisión: RECHAZAR, no adivinar
 * La SIE emite **punto decimal y coma de millares** (`18.5000`, `1,234.5678`). Cualquier otra cosa
 * **no se interpreta**: se rechaza y el refresco sale `failed/invalid_payload`, que es el resultado
 * honesto —*no sabemos qué número nos dieron*— y deja la tasa anterior en su sitio. ⛔ **Adivinar que
 * `"19,5"` quería decir 19.5 es exactamente cómo se cuela un ×10**: si el formato cambia, lo correcto
 * es enterarse por un `failed`, no por el precio.
 *
 * ⚠️ **`out_of_band` NO es un `reason` nuevo del contrato**: se mapea a `invalid_payload` a propósito
 * (§M2-F.5 fija ese enum y **el contrato no se cambia desde backend**). Se distingue en el log, que
 * es donde hace falta para operar. *Si el arquitecto quiere un `reason` propio, es suyo.*
 *
 * ### ⭐⭐ v1.63.4 (`FX-24`, §M2-F.8) — LA BANDA GANA PISO, Y AQUÍ NO SE ESCRIBE
 * El veredicto de rango lo da **{@link isFxRateInBand}**, el MISMO cuerpo que aplica
 * {@link validateFxManualOverrideRate}. ⛔ **Ya no hay parámetro `maxRate`**: un tope por llamada era
 * una segunda banda con otro nombre, y lo único que sostenía era un test que quería separar «formato»
 * de «rango» — separación que se afirma mejor mirando el `why` (`format` vs `out_of_band`), que es lo
 * que el parser ya devuelve.
 *
 * ⚠️ **El `why` puede diferir del motivo de la puerta tecleada y eso NO es una divergencia**: `"0.05"`
 * sale `out_of_band` aquí y `1e-7` (que en formato SIE ni siquiera es expresable) saldría `format`.
 * **Lo normativo es el VEREDICTO**, y de eso se ocupa `FX-24(b)` asertándolo como identidad.
 */
export function parseBanxicoRate(
  raw: unknown,
): { ok: true; rate: number } | { ok: false; why: 'format' | 'out_of_band' } {
  if (typeof raw !== 'string') return { ok: false, why: 'format' };
  const texto = raw.trim();
  // Punto decimal, coma SOLO como separador de millares y en grupos de tres. Nada más.
  if (!/^\d+(\.\d+)?$|^\d{1,3}(,\d{3})+(\.\d+)?$/.test(texto)) return { ok: false, why: 'format' };
  const n = Number(texto.replace(/,/g, ''));
  if (!Number.isFinite(n)) return { ok: false, why: 'format' };
  // ⭐⭐ La MISMA banda que la tasa tecleada, y por el MISMO predicado (FX-B1/FX-B2 RATIFICADOS en
  // §M2-F.8): la banda afirma algo del VALOR, y `liveMxnCents` no sabe por qué puerta entró. Un FIX
  // USD/MXN fuera de `[1, 1000]` no es una tasa: por arriba es un `9999` (×549 al catálogo), por
  // abajo es la INVERSA del par (≈0.0526 — el vector que produce que la SIE publique el par al
  // revés) y hunde una carta de USD 100 de MX$ 1,957 a MX$ 0.01.
  if (!isFxRateInBand(n)) return { ok: false, why: 'out_of_band' };
  return { ok: true, rate: n };
}

/** Bloque `refresh` que `POST /admin/fx/refresh` añade al `FxStateDTO` (§M2-F.5). */
export interface FxRefreshResult {
  outcome: FxRefreshOutcome;
  reason: FxRefreshFailureReason | null;
  fetchedRate: number | null;
  at: string;
}

/**
 * Hook de bitácora TRANSACCIONAL. Mismo patrón que el `auditWithin` de `SettingsService.update`
 * (`settings.controller.ts`): el servicio no conoce `AuditService`; el controller le pasa un
 * callback que escribe las entradas con el cliente `tx`, de modo que **efecto y bitácora commitean
 * o revierten juntos**.
 */
export type FxAuditHook = (tx: Prisma.TransactionClient, entries: AuditEntry[]) => Promise<void>;

/** Contexto del actor + su bitácora, para las dos escrituras de FX que mueven dinero. */
export interface FxWriteContext {
  actorUserId?: string;
  actorRole?: Role;
  audit?: FxAuditHook;
}

/**
 * FxService — USD→MXN con colchón (ARCHITECTURE §3.2 `FxRate`, §4.43; API_CONTRACT §M2-F).
 *
 * ### ⚠️ v1.63 — EL TIPO DE CAMBIO TIENE **MODO**, Y EL MODO **NO ES EL VALOR**
 * Hasta v1.62.2 el modo se **infería del valor**: si `fx_manual_override_rate` existía y era `> 0`,
 * ganaba el manual. **Esa inferencia era el defecto**: «apagar el manual» significaba **borrar el
 * número**, y desde el panel no había vuelta a automático sin destruir la tasa del dueño. Ahora el
 * modo es un ajuste explícito (`fx_rate_mode`) con **su propio endpoint** (`PUT /admin/fx/mode`), y
 * la prioridad la decide **el modo**, no la presencia del número.
 *
 * ### ⚠️⚠️ Esto es dinero VIVO, no un ajuste de configuración
 * La conversión USD→MXN se recalcula **en cada lectura** (`PricingService.liveMxnCents`, hecho F3):
 * mover el interruptor **reprecia el catálogo entero en la siguiente lectura**, lo que vendemos y lo
 * que compramos. Por eso las dos tasas viajan siempre lado a lado (§M2-F.3), por eso el cambio a
 * `auto` sin tasa de Banxico exige un **acuse** (§M2-F.3 regla 5), y por eso todo queda en la
 * bitácora **con los dos números**, no con los dos rótulos (§M2-F.4).
 */
@Injectable()
export class FxService {
  private readonly logger = new Logger(FxService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Lee TODO lo que decide qué tasa rige, en un solo sitio. La decisión la toma
   * `projectFxState()` (función PURA de `common/fx-mode`), compartida con `SettingsService`.
   */
  /**
   * ⚠️ **v1.63.2 (S-FX-1): `db` no es un parámetro de comodidad.** Cuando esto corre **dentro** de la
   * transacción que tomó `lockFxGate`, tiene que leer **por el mismo handle**: una lectura por otra
   * conexión es una lectura **de antes del candado**, y validar sobre ella es exactamente el defecto
   * que el candado vino a cerrar. Sin argumento (lecturas puras, `GET`) usa el cliente normal.
   */
  private async loadInputs(db: FxReadHandle = this.prisma): Promise<FxInputs> {
    const [bufferPct, rawMode, rawManualRate, latestBanxico] = await Promise.all([
      this.settings.getNumber(SettingKey.FX_BUFFER_PCT, db),
      this.settings.getRaw(SettingKey.FX_RATE_MODE, db),
      this.settings.getRaw(SettingKey.FX_MANUAL_OVERRIDE_RATE, db),
      // ⭐ I-FX5: la última fila de origen **banxico**, NUNCA «la última fila» a secas. Una fila
      // `FxRate` con `source='manual'` (la que escribe `PUT /admin/fx`) NO RIGE NUNCA.
      latestBanxicoFxRate(db),
    ]);
    return { bufferPct, rawMode, rawManualRate, latestBanxico };
  }

  /**
   * **`FxStateDTO` — el estado vigente completo** (§M2-F.3). Lo devuelven las CUATRO rutas de FX.
   *
   * ⛔ **PROHIBIDO devolver sólo la tasa que rige:** `manual` y `automatic` viajan **siempre y
   * completos**, esté el sistema en el modo que esté. El caso que esa regla existe para cubrir es el
   * del dueño: está en `manual` con 19.0000 y necesita ver **la de Banxico** para decidir si pasa a
   * `auto`. Las dos, en las MISMAS unidades: tasa CRUDA, sin colchón (el colchón se aplica aguas
   * abajo, idéntico en las dos ramas — fix #13).
   *
   * Los consumidores de dinero (ingest, valuación, sellado) siguen leyendo `rate`/`bufferPct` con
   * exactamente el mismo significado: el cambio es **aditivo**.
   */
  async getCurrent(): Promise<FxStateDTO> {
    return projectFxState(await this.loadInputs());
  }

  /**
   * `PUT /api/v1/admin/fx` — guarda la tasa manual y/o el colchón. **Req IGUAL que hoy.**
   *
   * ### ⭐ Lo que cambia en v1.63 (§M2-F.5): guardar una tasa **NO enciende el manual**
   * La escritura del valor **pinnea `fx_rate_mode` con el modo resuelto ANTES de aplicarla**
   * (I-FX2). En `auto`, el número se guarda, `manual.applied` vuelve `false` **y `rate` sigue siendo
   * el de Banxico**. El pin y la validación cruzada viven en `SettingsService.update`, que es la
   * puerta común de las DOS vías que escriben el valor (hecho F5) — aquí no se duplica la regla.
   *
   * Para poner una tasa **y** activarla son **dos llamadas**: ésta y `PUT /admin/fx/mode`. *Ese
   * orden es money-safe por construcción: el paso intermedio no mueve un peso.*
   *
   * ### La fila `FxRate` manual se sigue escribiendo — y ahora es SOLO traza forense
   * ⛔ **El escritor no se toca** (§4.43c-bis): lleva meses en producción y la fila documenta «este
   * día un humano fijó 25». Lo que cambió es el **lector**, que ya no la mira (I-FX5).
   */
  async setManual(rate?: number, bufferPct?: number, ctx?: FxWriteContext): Promise<FxStateDTO> {
    const patch: Record<string, unknown> = {};
    if (bufferPct != null) patch.fxBufferPct = bufferPct;
    if (rate != null) patch.fxManualOverrideRate = rate;

    // ⭐⭐ **v1.63.3 · R2 — el colchón resultante, LEÍDO BAJO LA PUERTA.** Lo publica la proyección
    // que `SettingsService` hace dentro del candado; sirve para la fila forense `FxRate` de abajo y
    // ahorra **la cuarta lectura del mismo dial en una sola petición** (la que hacía `this.prisma`
    // fuera de la transacción, que techlead registró junto a R2).
    let bufferBajoLaPuerta: number | undefined;

    if (Object.keys(patch).length > 0) {
      // ⚠️⚠️ **v1.63.3 · R2 — AQUÍ YA NO SE LEE NADA FUERA DE LA PUERTA.**
      // Hasta aquí, esta rama hacía `loadInputs()` **fuera de toda transacción y sin el candado** y
      // auditaba con esa foto. El comentario de abajo decía que en la rama de solo-colchón *«no hay
      // invariante compartido, no se toma el candado y no hay nada que pueda haber cambiado debajo»*:
      // **la última frase era falsa** — un `PUT /admin/fx/mode` concurrente commitea en esa ventana y
      // la entrada queda afirmando un `mode`/`source`/`effectiveRate` que nunca coexistieron con ese
      // colchón. Ahora **las dos mitades del estado se leen y se proyectan bajo `lockFxGate`**, que es
      // la ceremonia entera de I-FX6: *lock → releer → validar → escribir → auditar con la proyección
      // de dentro*.
      await this.settings.update(patch, ctx?.actorUserId, async (tx, _applied, extra) => {
        bufferBajoLaPuerta = extra?.fxPin?.resultingState.bufferPct;
        if (!ctx?.audit) return;
        // `patch` no está vacío ⇒ trae la tasa manual, el colchón, o las dos ⇒ **las tres
        // combinaciones toman la puerta y proyectan bajo ella** (§4.43c-ter). Que falte la proyección
        // significaría que se abrió una ruta de escritura del FX **por fuera del candado**: se
        // revienta la transacción, que revierte el dial. *En dinero, un cambio sin bitácora
        // reconstruible es peor que un 500.*
        if (!extra?.fxPin) {
          throw new Error(
            'FX write reached the audit hook without a gated projection (I-FX6): a route is writing ' +
              'the FX state outside lockFxGate',
          );
        }
        // Estado RESULTANTE, calculado por `SettingsService` con la MISMA función pura, dentro del
        // candado y por el mismo `tx`. ⛔ No hay segunda cuenta y ⛔ no hay lectura de fuera.
        const afterState = extra.fxPin.resultingState;
        // ⭐⭐ **v1.63.2 (S-FX-1 · cierra FX-D4): el «antes» que se audita es EL DE DENTRO DEL
        // CANDADO.** `beforeState` se leyó **antes** de entrar a la transacción; si la otra puerta
        // commiteó en ese hueco, esta entrada describiría un estado que ya no existía — la misma
        // mentira de bitácora que S-FX-1, por la otra puerta. `fxPin.before` lo calculó
        // `prepareFxModePin` **después** de `lockFxGate` y sobre el mismo `tx`. *Y de paso desaparece
        // la doble cuenta del mismo instante que el techlead registró como FX-D4.*
        // ⭐ v1.63.3 · R2 — y ya **no hay respaldo**: el «antes» es siempre el de dentro del candado.
        // El respaldo era el caso «solo el colchón», que es justo el que resultó no estar cerrado.
        const antes = extra.fxPin.previousState;
        const entries: AuditEntry[] = [
          {
            actorUserId: ctx.actorUserId,
            actorRole: ctx.actorRole,
            action: 'fx.override',
            // §M2-F.4: hoy esta entrada registra SÓLO `after` y sin claves de entidad. Se normaliza.
            entityType: 'ConfigSetting',
            entityId: SettingKey.FX_MANUAL_OVERRIDE_RATE,
            before: { ...toFxAuditState(antes), manualRate: antes.manual.rate },
            after: {
              ...toFxAuditState(afterState),
              manualRate: afterState.manual.rate,
              // ⭐ `applied` — si el número guardado RIGE o no. Desde este pase, guardar una tasa en
              // modo `auto` es un gesto legítimo cuyo efecto es **ninguno todavía**, y la bitácora
              // tiene que poder distinguirlo de uno que movió el catálogo entero.
              applied: afterState.manual.applied,
            },
          },
        ];
        // FX-13 / §M2-F.4: si esta escritura materializó el modo, la entrada `fx.mode.change` va
        // ADEMÁS, en la misma transacción — auditar por `fx.mode.change` tiene que ser COMPLETO.
        if (extra.fxPin.materialized) {
          entries.push({
            actorUserId: ctx.actorUserId,
            actorRole: ctx.actorRole,
            action: 'fx.mode.change',
            entityType: 'ConfigSetting',
            entityId: SettingKey.FX_RATE_MODE,
            before: extra.fxPin.before,
            after: extra.fxPin.after,
          });
        }
        await ctx.audit(tx, entries);
      });
    }

    // #13: sólo con `rate` explícito se escribe la fila `FxRate` manual del día (traza forense).
    if (rate != null) {
      // ⭐ v1.63.3 · R2 — el colchón que se congela es **el que rigió bajo la puerta**, no una cuarta
      // lectura del mismo dial por `this.prisma` ya fuera de la transacción. La cascada final solo
      // sobrevive para el caso en que no hubo escritura de diales (imposible con `rate != null`, pero
      // ⛔ una fila forense **jamás** se escribe con un colchón inventado).
      const effBuffer =
        bufferPct ?? bufferBajoLaPuerta ?? (await this.settings.getNumber(SettingKey.FX_BUFFER_PCT));
      const id = `manual-${fxIsoDate(today())}`;
      await this.prisma.fxRate.upsert({
        where: { id },
        create: { id, rate, bufferPct: effBuffer, effectiveDate: today(), source: 'manual' },
        update: { rate, bufferPct: effBuffer, source: 'manual' },
      });
    }

    return this.getCurrent();
  }

  /**
   * ⭐⭐ `PUT /api/v1/admin/fx/mode` — **EL INTERRUPTOR** (§M2-F.2, `super_admin`).
   *
   * *«Quiero conservar el override manual, que sea un toggle para decidir entre automático o
   * manual.»* — el dueño. Esto es esa frase.
   *
   * ### Las cinco reglas de conducta
   * 1. **Alternable N veces** (`auto → manual → auto …`) **sin volver a teclear el número**: cambiar
   *    el modo ⛔ **NUNCA** escribe `fx_manual_override_rate` (I-FX3), ni para «limpiarlo» ni para
   *    «archivarlo».
   * 2. **Idempotente en el efecto, NO en la bitácora**: pedir el modo que ya rige devuelve `200`, no
   *    cambia nada y **deja entrada igual** (con `before == after`). *Fue un acto humano deliberado
   *    sobre el interruptor del dinero; una bitácora que omite los actos que «no cambiaron nada»
   *    obliga a demostrar una ausencia.*
   * 3. ⛔ **No dispara fetch a Banxico** ni escribe filas `FxRate`: usa lo que ya hay, y si está
   *    viejo el `FxStateDTO` de vuelta lo dice (`automatic.status`).
   * 4. **Dos precondiciones**, las dos con el modo **intacto** si fallan: `FX_MANUAL_RATE_MISSING`
   *    (I-FX4) y `FX_NO_AUTOMATIC_RATE` (el acuse).
   * 5. **Bitácora obligatoria y transaccional**, con los DOS números.
   *
   * ### ⚠️ El acuse, y por qué no es burocracia
   * Sin fila de Banxico, pasar a `auto` lleva de 19.0 a **18** —una constante escondida, ni siquiera
   * una tasa real—: **~5 % instantáneo sobre todo el catálogo, en los dos sentidos**. La regla de
   * «las dos tasas en la mano» **no se puede cumplir** justo ahí, así que se exige
   * `acknowledgeNoAutomaticRate: true`. *Una precondición que se desactiva sola en su único caso
   * grave no es una precondición.* ⛔ **No se pide con `stale`**: ahí hay un número real que el
   * humano puede ver y juzgar, que es justo lo que aquí falta. Y ⛔ **no vuelve a atar modo y
   * valor**: es un ACUSE, no una tasa (I-FX3 intacto).
   */
  async setMode(
    mode: FxRateMode,
    opts: FxWriteContext & { acknowledgeNoAutomaticRate?: boolean } = {},
  ): Promise<FxStateDTO> {
    // ⭐⭐ **v1.63.2 · S-FX-1 — LEER, VALIDAR, ESCRIBIR Y AUDITAR, TODO BAJO EL MISMO CANDADO.**
    //
    // Antes, la lectura del estado y las dos precondiciones vivían **fuera** de esta transacción.
    // Como la otra puerta (`PUT /admin/settings`) escribe **otra fila**, Postgres no las hacía
    // colisionar y las dos commiteaban: bastaban ~20 ms de ventaja para dejar `mode:"manual"` con la
    // tasa borrada ⇒ **fallback duro de 18, −5.26 % sobre todo el catálogo, sin acuse y con 200 en
    // las dos respuestas**. Y la bitácora, proyectada de la lectura vieja, **afirmaba 19/manual
    // mientras el sistema cotizaba 18/fallback**.
    //
    // ⚠️ El candado por sí solo no arregla nada: **lo que arregla es releer dentro**. Una transacción
    // que espera su turno y luego escribe con la lectura de antes commitea el mismo estado
    // imposible, solo que más tarde. Por eso `loadInputs(tx)` va **después** de `lockFxGate(tx)` y
    // **por el mismo handle**.
    //
    // ⛔ Las precondiciones lanzan DENTRO de la transacción: eso revierte y suelta el candado. No hay
    // escritura parcial (es la misma garantía de antes, por otra vía).
    await this.prisma.$transaction(async (tx) => {
      await lockFxGate(tx);

      const inputs = await this.loadInputs(tx);
      const before = projectFxState(inputs);

      // I-FX4, mitad «pedir manual sin número guardado». El modo NO cambia.
      if (mode === 'manual' && before.manual.rate == null) {
        throw BusinessException.validation(
          'FX_MANUAL_RATE_MISSING',
          'There is no saved manual FX rate to switch back to: save one first (PUT /admin/fx { rate }).',
          { savedManualRate: null },
        );
      }

      // El ACUSE. Sólo con `missing` — con `stale` hay un número real que el humano puede juzgar.
      const needsAck = mode === 'auto' && before.automatic.status === 'missing';
      if (needsAck && opts.acknowledgeNoAutomaticRate !== true) {
        throw BusinessException.validation(
          'FX_NO_AUTOMATIC_RATE',
          'No automatic (Banxico) rate has ever been stored: switching to automatic would apply the ' +
            `hard fallback rate of ${FX_FALLBACK_RATE}. Confirm with acknowledgeNoAutomaticRate: true.`,
          { currentRate: before.rate, fallbackRate: FX_FALLBACK_RATE },
        );
      }

      // Estado RESULTANTE, con la MISMA función pura y sobre las MISMAS entradas que se acaban de
      // validar: lo único que cambia es la fila del modo. **Esto es lo que se audita**, y por eso ya
      // no puede afirmar un estado que la otra puerta deshizo hace 20 ms.
      const after = projectFxState({ ...inputs, rawMode: mode });

      await tx.configSetting.upsert({
        where: { key: SettingKey.FX_RATE_MODE },
        create: {
          key: SettingKey.FX_RATE_MODE,
          valueJson: mode as unknown as object,
          updatedBy: opts.actorUserId,
        },
        update: { valueJson: mode as unknown as object, updatedBy: opts.actorUserId },
      });
      if (opts.audit) {
        await opts.audit(tx, [
          {
            actorUserId: opts.actorUserId,
            actorRole: opts.actorRole,
            action: 'fx.mode.change',
            entityType: 'ConfigSetting',
            entityId: SettingKey.FX_RATE_MODE,
            before: toFxAuditState(before),
            after: {
              ...toFxAuditState(after),
              // v1.63.1 (§M2-F.4): sólo cuando se ejerció el acuse. Viaja DENTRO de `after` porque
              // `AuditLog` no tiene columna propia y este pase es CERO DDL; la consulta de auditoría
              // lo lee igual (`after.acknowledgedNoAutomaticRate`). Ver docs/BACKEND_NOTES.md.
              ...(needsAck ? { acknowledgedNoAutomaticRate: true } : {}),
            },
          },
        ]);
      }
    });

    return this.getCurrent();
  }

  /**
   * `POST /api/v1/admin/fx/refresh` (y el job diario `fx-refresh`) — fetch a Banxico SIE.
   *
   * ### ⭐ v1.63 (§M2-F.5): **deja de afirmar un fetch que no ocurrió**
   * **Medido (F7):** sin token o con error, esto devolvía `getCurrent()` —el override— y el
   * controller lo auditaba como `fx.refresh` **con ese valor**: la bitácora afirmaba un refresco que
   * no ocurrió, y el dueño veía «Tipo de cambio actualizado» sin que nadie hubiera hablado con
   * Banxico. Ahora devuelve un **discriminante de resultado** (`updated | unchanged | failed` +
   * `reason`), y la bitácora registra **eso**, no el valor de vuelta.
   *
   * **Sigue siendo `200`, no `502`, y es deliberado:** la llamada completó y el `FxStateDTO` de
   * vuelta es válido y verdadero; lo que falló es la fuente externa. La UI está OBLIGADA a
   * distinguir `failed` visualmente — un `200` silencioso es justo el defecto que se cierra.
   *
   * ⛔ **No cambia el modo** y ⛔ **no toca `fx_manual_override_rate`.** El refresco corre igual en
   * modo `manual`, y ahora eso es ÚTIL: mantiene fresca la tasa **contra la que el dueño compara**
   * antes de mover el interruptor.
   */
  async refreshFromBanxico(): Promise<FxRefreshResult> {
    const at = new Date().toISOString();
    const fail = (reason: FxRefreshFailureReason): FxRefreshResult => ({
      outcome: 'failed',
      reason,
      fetchedRate: null,
      at,
    });

    const bufferPct = await this.settings.getNumber(SettingKey.FX_BUFFER_PCT);
    const token = this.config.get<string>('BANXICO_SIE_TOKEN') || this.config.get<string>('FX_API_KEY');
    if (!token) {
      // D-OPS-1: falta el token en producción. Enseñarlo NO lo arregla (es de devops + el humano),
      // pero deja de contarse como un refresco exitoso.
      this.logger.warn('Sin BANXICO_SIE_TOKEN: fx-refresh NO consultó a Banxico (outcome=failed).');
      return fail('no_token');
    }

    let rate: number;
    try {
      // Serie SF63528 = USD FIX. API SIE de Banxico.
      const res = await fetch(
        'https://www.banxico.org.mx/SieAPIRest/service/v1/series/SF63528/datos/oportuno',
        { headers: { 'Bmx-Token': token } },
      );
      if (!res.ok) {
        this.logger.warn(`Banxico fetch failed: HTTP ${res.status} (outcome=failed/http_error).`);
        return fail('http_error');
      }
      const body = (await res.json()) as {
        bmx?: { series?: { datos?: { dato: string }[] }[] };
      };
      const raw = body.bmx?.series?.[0]?.datos?.[0]?.dato;
      // ⭐⭐ S-FX-2: formato ESTRICTO + banda de cordura simétrica con la tasa tecleada. Un valor que
      // no se entiende **no se aproxima**: se rechaza y la tasa anterior sigue en su sitio.
      const parsed = parseBanxicoRate(raw);
      if (!parsed.ok) {
        this.logger.warn(
          parsed.why === 'out_of_band'
            ? `Banxico devolvió una tasa FUERA DE BANDA (${String(raw)}; banda ${FX_RATE_BAND_TEXT}): ` +
              'no se escribe fila (outcome=failed/invalid_payload).'
            : `Banxico devolvió un payload sin tasa usable en formato SIE (${String(raw)}) ` +
              '(outcome=failed/invalid_payload).',
        );
        return fail('invalid_payload');
      }
      rate = parsed.rate;
    } catch (e) {
      this.logger.warn(`Banxico fetch failed: ${(e as Error).message} (outcome=failed/network_error).`);
      return fail('network_error');
    }

    // `updated` vs `unchanged` se decide contra la ÚLTIMA fila de origen banxico (I-FX5), leída
    // ANTES del upsert. ⚠️ La fila se escribe en los DOS casos, a propósito y sin tocar al escritor:
    // si Banxico confirma hoy el mismo número, la tasa automática está FRESCA y `automatic.ageDays`
    // tiene que decirlo. `outcome` habla del VALOR, no de si hubo escritura.
    const previous = await latestBanxicoFxRate(this.prisma);
    const previousRate = previous == null ? null : Number(previous.rate);
    const dateId = fxIsoDate(today());
    await this.prisma.fxRate.upsert({
      where: { id: `banxico-${dateId}` },
      create: { id: `banxico-${dateId}`, rate, bufferPct, effectiveDate: today(), source: 'banxico' },
      update: { rate, bufferPct, source: 'banxico' },
    });
    return {
      outcome: previousRate != null && previousRate === rate ? 'unchanged' : 'updated',
      reason: null,
      fetchedRate: rate,
      at,
    };
  }
}
