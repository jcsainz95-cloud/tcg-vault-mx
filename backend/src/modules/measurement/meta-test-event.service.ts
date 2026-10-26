/**
 * meta-test-event.service.ts — `POST /admin/measurement/meta-test-event` (API_CONTRACT §MKT.H.12; ARCHITECTURE §14.10
 * D-MKT2-10). La ÚNICA salida a Meta que no pasa por el interruptor: acotada a `super_admin`, 5 envíos por 60 min, bitácora
 * y ningún dato de cliente.
 *
 * - Lee `readMeasurementConfig(env).meta` SIN `destinationEnabled` ni `gateMeasurementConfig`: envía con `off` y con el
 *   bloqueo de encendido abierto (es lo que lo cierra). ⛔ No encola, no toca cola ni contexto, no lee pedidos ni usuarios.
 * - Límite GLOBAL: conteo de filas `measurement.meta_test_event` de `AuditLog` en los últimos 60 min, y alta de la fila
 *   nueva, dentro de UNA transacción con `pg_advisory_xact_lock` ⇒ dos envíos a la vez no pasan los dos la 5.ª. La llamada
 *   a Meta (timeout 5 s) va dentro del candado: el envío y su fila son una unidad. 400/409/422/429 no cuentan ni se auditan.
 * - ⛔ El token no sale en la respuesta, la bitácora ni el log (lo redacta `MeasurementHttp.postMetaDiagnostic`); ⛔ ni URL
 *   ni cuerpo en el log: solo `MEASUREMENT_META_TEST status= http= version=`.
 */
import { HttpStatus, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Role } from '@prisma/client';
import { BusinessException } from '../../common/business.exception';
import { ErrorCode } from '../../common/error-codes';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { META_GRAPH_API_VERSION, metaEventsUrl, readMeasurementConfig, type MeasurementConfig } from './measurement.config';
import { MEASUREMENT_HTTP, type MeasurementHttp } from './measurement-http';
import { measurementEnvFrom, measurementOriginOf } from './measurement.service';
import {
  buildMetaTestEventBody,
  metaTestEventId,
  metaTestEventStatus,
  newMetaTestEventIds,
  parseTestEventCode,
  type MetaTestEventIds,
  type MetaTestEventResult,
} from './meta-test-event';

export const META_TEST_EVENT_ACTION = 'measurement.meta_test_event';
/** 5 envíos por 60 min móviles, global (§MKT.H.12). */
export const META_TEST_EVENT_LIMIT = 5;
export const META_TEST_EVENT_WINDOW_MS = 60 * 60_000;
export const META_TEST_EVENT_TIMEOUT_MS = 5_000;
/** Espacio del candado consultivo (dos enteros; distinto del contador del banner, 86_120_001). */
export const META_TEST_EVENT_LOCK_NAMESPACE = 86_120_002;
export const META_TEST_EVENT_LOCK_KEY = 1;
/** La transacción abarca la llamada a Meta (≤ 5 s) y la espera del candado de un envío simultáneo. */
const TX_OPTIONS = { timeout: 20_000, maxWait: 10_000 } as const;

export interface MetaTestEventActor {
  id: string;
  role?: Role | null;
}

@Injectable()
export class MetaTestEventService {
  private readonly logger = new Logger(MetaTestEventService.name);
  readonly config: MeasurementConfig;
  readonly origin: string;
  /** Inyectable para pruebas (aleatoriedad del cuerpo). */
  newIds: () => MetaTestEventIds = newMetaTestEventIds;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(MEASUREMENT_HTTP) private readonly http: MeasurementHttp,
    @Optional() config?: ConfigService,
  ) {
    const env = measurementEnvFrom(config);
    // ⛔ Sin `gateMeasurementConfig` ni `destinationEnabled`: el modo y los bloqueos no aplican aquí (§MKT.H.12).
    this.config = readMeasurementConfig(env);
    this.origin = measurementOriginOf(env);
  }

  async send(body: Record<string, unknown>, actor: MetaTestEventActor, ip: string | undefined): Promise<MetaTestEventResult> {
    const parsed = parseTestEventCode(body);
    // ⛔ Sin el valor recibido en `details`.
    if (!parsed.ok) throw BusinessException.validation(ErrorCode.VALIDATION_ERROR, 'Invalid testEventCode', { field: 'testEventCode' });
    const meta = this.config.meta;
    // ⛔ Ni valores ni el nombre de la variable que falta: solo el motivo.
    if (!meta.enabled) {
      throw BusinessException.conflict(ErrorCode.MEASUREMENT_META_NOT_CONFIGURED, 'Meta is not configured', { reason: meta.reason });
    }
    const { pixelId, token } = meta;

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${META_TEST_EVENT_LOCK_NAMESPACE}::int, ${META_TEST_EVENT_LOCK_KEY}::int)`;
      const now = new Date();
      const since = new Date(now.getTime() - META_TEST_EVENT_WINDOW_MS);
      const recent = await tx.auditLog.findMany({
        where: { action: META_TEST_EVENT_ACTION, createdAt: { gt: since } },
        orderBy: { createdAt: 'desc' },
        take: META_TEST_EVENT_LIMIT,
        select: { createdAt: true },
      });
      if (recent.length >= META_TEST_EVENT_LIMIT) {
        // Se libera un hueco cuando la 5.ª más reciente sale de la ventana.
        const freesAt = recent[META_TEST_EVENT_LIMIT - 1].createdAt.getTime() + META_TEST_EVENT_WINDOW_MS;
        const retryAfterSeconds = Math.max(1, Math.ceil((freesAt - now.getTime()) / 1000));
        throw new BusinessException(ErrorCode.RATE_LIMITED, HttpStatus.TOO_MANY_REQUESTS, 'Too many Meta test events', { retryAfterSeconds });
      }

      const ids = this.newIds();
      const eventBody = buildMetaTestEventBody({ testEventCode: parsed.code, token, origin: this.origin, now, ids });
      const diag = await this.http.postMetaDiagnostic(metaEventsUrl(pixelId), eventBody, META_TEST_EVENT_TIMEOUT_MS);
      const status = metaTestEventStatus(diag);
      const eventId = metaTestEventId(ids.uuid);

      await this.audit.log(
        {
          actorUserId: actor.id,
          actorRole: actor.role ?? null,
          action: META_TEST_EVENT_ACTION,
          entityType: 'MeasurementTestEvent',
          entityId: eventId,
          after: {
            status,
            httpStatus: diag.httpStatus,
            metaVersion: META_GRAPH_API_VERSION,
            testEventCode: parsed.code,
            eventsReceived: diag.eventsReceived,
            fbtraceId: diag.fbtraceId,
            metaErrorCode: diag.error?.code ?? null,
          },
          ip,
        },
        tx,
      );
      this.logger.log(`MEASUREMENT_META_TEST status=${status} http=${diag.httpStatus ?? 'none'} version=${META_GRAPH_API_VERSION}`);

      return {
        status,
        httpStatus: diag.httpStatus,
        metaVersion: META_GRAPH_API_VERSION,
        pixelId,
        testEventCode: parsed.code,
        eventName: 'PageView',
        eventId,
        sentAt: now.toISOString(),
        eventsReceived: diag.eventsReceived,
        fbtraceId: diag.fbtraceId,
        metaMessages: diag.messages,
        metaError: diag.error,
      };
    }, TX_OPTIONS);
  }
}
