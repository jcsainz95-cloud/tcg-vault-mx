/**
 * measurement.service.ts — Fase 2 de medición, lado servidor (API_CONTRACT §MKT.H.1/.2/.6; ARCHITECTURE §14.1/§14.6).
 *
 * - `prepare`: sanea el objeto `measurement` de la petición. Con `MEASUREMENT_MODE=off` devuelve «nada» sin mirarlo.
 *   Las columnas resultantes las escribe el llamador EN LA MISMA escritura que crea `Order`/`SellRequest`.
 * - `saveContext`: post-commit, best-effort (⛔ nunca lanza).
 * - `enqueuePurchase` / `enqueueLead`: post-commit. Una fila por destino habilitado Y consentido (tabla de §14.6).
 *   Idempotente por `@@unique(destination, eventId)` (`createMany … skipDuplicates`). Pueden lanzar (BD caída): el
 *   llamador los envuelve en `try/catch` que registra y NO relanza (C-B2) — el pago y la solicitud no dependen de esto.
 *
 * ⛔ Nada de esto toca dinero ni corre dentro de una `$transaction` de dinero. ⛔ No sale a la red: eso es del drenador.
 */
import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { MeasurementDestination, MeasurementEventKind } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  destinationEnabled,
  disabledDestinationLines,
  readMeasurementConfig,
  type EnvLike,
  type MeasurementConfig,
} from './measurement.config';
import { sanitizeMeasurementInput, type MeasurementColumns, type MeasurementContextInput } from './measurement-input';
import { leadEventId, purchaseEventId } from './measurement-bodies';

/** Vida de las filas de contexto y de cola (§MKT.H.6/.7; ARCHITECTURE §14.10 (4): 7 días). */
export const MEASUREMENT_TTL_MS = 7 * 24 * 3600 * 1000;

export type MeasurementSubject = { orderId: string } | { sellRequestId: string };

/** Lo que el llamador escribe en la fila nueva (vacío ⇒ columnas NULL) y lo que guarda después del commit. */
export interface PreparedMeasurement {
  columns: Partial<MeasurementColumns>;
  context: MeasurementContextInput | null;
}

const NOTHING: PreparedMeasurement = Object.freeze({ columns: Object.freeze({}), context: null }) as PreparedMeasurement;

/** Lee las variables de `ConfigService` (o de `process.env` si no hay Nest), por nombre. */
function envFrom(config?: Pick<ConfigService, 'get'>): EnvLike {
  const keys = ['MEASUREMENT_MODE', 'GA4_MEASUREMENT_ID', 'GA4_MP_API_SECRET', 'META_PIXEL_ID', 'META_CAPI_TOKEN', 'APP_BASE_URL'];
  const out: EnvLike = {};
  for (const k of keys) out[k] = config ? config.get<string>(k) : process.env[k];
  return out;
}

@Injectable()
export class MeasurementService implements OnModuleInit {
  private readonly logger = new Logger(MeasurementService.name);
  readonly config: MeasurementConfig;
  /** Primer origen de `APP_BASE_URL` (base de `event_source_url`). */
  readonly origin: string;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() config?: ConfigService,
  ) {
    const env = envFrom(config);
    this.config = readMeasurementConfig(env);
    this.origin = (env.APP_BASE_URL ?? '').split(',')[0].trim() || 'https://tcghunt.mx';
  }

  /** C-B7: una línea por destino deshabilitado, sin valores. El arranque sigue. */
  onModuleInit(): void {
    this.logger.log(`MEASUREMENT_MODE=${this.config.mode}`);
    for (const line of disabledDestinationLines(this.config)) this.logger.warn(line);
  }

  get mode(): 'off' | 'on' {
    return this.config.mode;
  }

  enabled(d: MeasurementDestination): boolean {
    return destinationEnabled(this.config, d);
  }

  /** §MKT.H.2. Con `off` ⇒ nada (se ignora entero). Nunca lanza. */
  prepare(raw: unknown, now = new Date()): PreparedMeasurement {
    if (this.config.mode !== 'on' || raw === undefined || raw === null) return NOTHING;
    const s = sanitizeMeasurementInput(raw, now);
    if (!s) return NOTHING;
    return { columns: s.columns, context: s.context };
  }

  /** Post-commit, best-effort: una fila de contexto si hay algún identificador. ⛔ Nunca lanza. */
  async saveContext(subject: MeasurementSubject, ctx: MeasurementContextInput | null, now = new Date()): Promise<void> {
    if (this.config.mode !== 'on' || !ctx) return;
    try {
      await this.prisma.measurementContext.createMany({
        data: [
          {
            ...subject,
            gaClientId: ctx.gaClientId ?? null,
            fbp: ctx.fbp ?? null,
            fbc: ctx.fbc ?? null,
            expiresAt: new Date(now.getTime() + MEASUREMENT_TTL_MS),
          },
        ],
        skipDuplicates: true,
      });
    } catch {
      // ⛔ Sin el mensaje: podría citar valores. Solo el tipo de sujeto.
      this.logger.warn(`measurement: contexto no guardado (${'orderId' in subject ? 'order' : 'sell_request'})`);
    }
  }

  /** §MKT.H.6 compra. Devuelve cuántas filas se intentaron (para pruebas). */
  async enqueuePurchase(orderId: string, now = new Date()): Promise<number> {
    if (this.config.mode !== 'on') return 0;
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { measurementConsentAnalytics: true, measurementConsentAds: true },
    });
    if (!order) return 0;
    const ctx = await this.prisma.measurementContext.findUnique({ where: { orderId }, select: { fbp: true, fbc: true } });
    return this.enqueue('purchase', orderId, purchaseEventId(orderId), order, ctx, now);
  }

  /** §MKT.H.6 solicitud (`generate_lead` solo de servidor). */
  async enqueueLead(sellRequestId: string, now = new Date()): Promise<number> {
    if (this.config.mode !== 'on') return 0;
    const sr = await this.prisma.sellRequest.findUnique({
      where: { id: sellRequestId },
      select: { measurementConsentAnalytics: true, measurementConsentAds: true },
    });
    if (!sr) return 0;
    const ctx = await this.prisma.measurementContext.findUnique({ where: { sellRequestId }, select: { fbp: true, fbc: true } });
    return this.enqueue('generate_lead', sellRequestId, leadEventId(sellRequestId), sr, ctx, now);
  }

  /**
   * Tabla de ARCHITECTURE §14.6: consentimiento `NULL` (modo off al crear) ⇒ nada; GA4 siempre que haya consentimiento
   * registrado (sin analítica va con `client_id` aleatorio); Meta solo con publicidad Y `fbp`/`fbc`.
   */
  private async enqueue(
    kind: MeasurementEventKind,
    subjectId: string,
    eventId: string,
    consent: { measurementConsentAnalytics: boolean | null; measurementConsentAds: boolean | null },
    ctx: { fbp: string | null; fbc: string | null } | null,
    now: Date,
  ): Promise<number> {
    if (consent.measurementConsentAnalytics === null || consent.measurementConsentAds === null) return 0;
    const dests: MeasurementDestination[] = [];
    if (this.enabled('ga4_mp')) dests.push('ga4_mp');
    if (this.enabled('meta_capi') && consent.measurementConsentAds === true && (ctx?.fbp || ctx?.fbc)) dests.push('meta_capi');
    if (dests.length === 0) return 0;
    const expiresAt = new Date(now.getTime() + MEASUREMENT_TTL_MS);
    await this.prisma.measurementOutbox.createMany({
      data: dests.map((destination) => ({ kind, destination, subjectId, eventId, nextAttemptAt: now, expiresAt })),
      // `@@unique(destination, eventId)` ⇒ `ON CONFLICT DO NOTHING`: una reentrega del webhook es un no-op (C-B5).
      skipDuplicates: true,
    });
    return dests.length;
  }
}
