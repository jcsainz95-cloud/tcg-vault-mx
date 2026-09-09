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
  FxInputs,
  FxRateMode,
  FxStateDTO,
  fxIsoDate,
  fxToday,
  latestBanxicoFxRate,
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
  private async loadInputs(): Promise<FxInputs> {
    const [bufferPct, rawMode, rawManualRate, latestBanxico] = await Promise.all([
      this.settings.getNumber(SettingKey.FX_BUFFER_PCT),
      this.settings.getRaw(SettingKey.FX_RATE_MODE),
      this.settings.getRaw(SettingKey.FX_MANUAL_OVERRIDE_RATE),
      // ⭐ I-FX5: la última fila de origen **banxico**, NUNCA «la última fila» a secas. Una fila
      // `FxRate` con `source='manual'` (la que escribe `PUT /admin/fx`) NO RIGE NUNCA.
      latestBanxicoFxRate(this.prisma),
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

    if (Object.keys(patch).length > 0) {
      const inputs = await this.loadInputs();
      const beforeState = projectFxState(inputs);
      await this.settings.update(patch, ctx?.actorUserId, async (tx, _applied, extra) => {
        if (!ctx?.audit) return;
        // Estado RESULTANTE: si hubo pin, es el que calculó `SettingsService` con la MISMA función
        // pura; si sólo cambió el colchón, se proyecta con el colchón nuevo (el modo no se toca).
        const afterState =
          extra?.fxPin?.resultingState ??
          projectFxState({ ...inputs, bufferPct: bufferPct ?? inputs.bufferPct });
        const entries: AuditEntry[] = [
          {
            actorUserId: ctx.actorUserId,
            actorRole: ctx.actorRole,
            action: 'fx.override',
            // §M2-F.4: hoy esta entrada registra SÓLO `after` y sin claves de entidad. Se normaliza.
            entityType: 'ConfigSetting',
            entityId: SettingKey.FX_MANUAL_OVERRIDE_RATE,
            before: { ...toFxAuditState(beforeState), manualRate: beforeState.manual.rate },
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
        if (extra?.fxPin?.materialized) {
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
      const effBuffer = bufferPct ?? (await this.settings.getNumber(SettingKey.FX_BUFFER_PCT));
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
    const inputs = await this.loadInputs();
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

    // Estado RESULTANTE, con la MISMA función pura: lo único que cambia es la fila del modo.
    const after = projectFxState({ ...inputs, rawMode: mode });

    await this.prisma.$transaction(async (tx) => {
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
      const parsed = raw ? parseFloat(raw.replace(',', '')) : NaN;
      if (!isFinite(parsed) || parsed <= 0) {
        this.logger.warn('Banxico devolvió un payload sin tasa usable (outcome=failed/invalid_payload).');
        return fail('invalid_payload');
      }
      rate = parsed;
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
