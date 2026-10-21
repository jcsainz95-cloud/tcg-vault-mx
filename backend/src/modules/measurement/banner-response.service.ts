/**
 * banner-response.service.ts — f1/f2 del Panel (API_CONTRACT §MKT.H.3; ARCHITECTURE §13.4.3, §14.9).
 *
 * Suma 1 a la celda `(weekStart CDMX, response, utmMedium, device)` de `MarketingBannerConsentCounter`.
 * ⛔ Sin fila por visita, sin cookie, sin IP, ⛔ sin guardar el User-Agent (solo se deriva `device`). Con `off` ⇒ nada.
 *
 * La `@@unique` de m82 incluye columnas NULLABLE (`utmMedium`, `device`) y en Postgres dos NULL no chocan: un `upsert`
 * crearía filas repetidas. Por eso el incremento es «candado consultivo por celda → `updateMany` → `create` si no había»,
 * dentro de una transacción: una celda = una fila.
 */
import { Injectable, Logger } from '@nestjs/common';
import type { BannerResponse } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { addDays, isoWeekday, todayMx } from '../sales-analytics/sales-period';
import { MeasurementService } from './measurement.service';

/** Los cuatro de U-1 (§MKT.H.3). Cualquier otro valor ⇒ `null`. */
export const BANNER_UTM_MEDIUMS = ['bio', 'story', 'paid', 'dm'] as const;
export const BANNER_RESPONSES = ['accept', 'necessary_only', 'custom', 'no_response'] as const satisfies readonly BannerResponse[];

/** Valores de ARCHITECTURE §13.4.3 (f2). */
export type BannerDevice = 'móvil' | 'escritorio' | 'tableta';

/** Espacio de claves del candado consultivo de la celda (dos enteros; distinto de los de reservas/bóveda). */
export const BANNER_COUNTER_LOCK_NAMESPACE = 86_120_001;

export function bannerUtmMedium(v: unknown): string | null {
  return typeof v === 'string' && (BANNER_UTM_MEDIUMS as readonly string[]).includes(v) ? v : null;
}

/** Deriva el tipo de dispositivo del UA en el servidor. Sin UA ⇒ `null`. ⛔ El UA no se guarda. */
export function deviceFromUserAgent(ua: unknown): BannerDevice | null {
  if (typeof ua !== 'string' || ua.trim() === '') return null;
  if (/iPad|Tablet|PlayBook|Silk|Kindle/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return 'tableta';
  if (/Mobi|iPhone|iPod|Android|Windows Phone|Opera Mini/i.test(ua)) return 'móvil';
  return 'escritorio';
}

/** Lunes CDMX de la semana de `now`, como `Date` a medianoche UTC (columna `@db.Date`). */
export function weekStartMx(now: Date): Date {
  const today = todayMx(now);
  return new Date(`${addDays(today, 1 - isoWeekday(today))}T00:00:00.000Z`);
}

@Injectable()
export class BannerResponseService {
  private readonly logger = new Logger(BannerResponseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly measurement: MeasurementService,
  ) {}

  /** Devuelve si escribió (para pruebas). Best-effort: un fallo de BD no cambia el 204. */
  async record(response: BannerResponse, utmMediumRaw: unknown, userAgent: unknown, now = new Date()): Promise<boolean> {
    if (this.measurement.mode !== 'on') return false;
    const weekStart = weekStartMx(now);
    const utmMedium = bannerUtmMedium(utmMediumRaw);
    const device = deviceFromUserAgent(userAgent);
    const key = `${weekStart.toISOString().slice(0, 10)}|${response}|${utmMedium ?? ''}|${device ?? ''}`;
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${BANNER_COUNTER_LOCK_NAMESPACE}::int, hashtext(${key}))`;
        const cell = { weekStart, response, utmMedium, device };
        const u = await tx.marketingBannerConsentCounter.updateMany({ where: cell, data: { count: { increment: 1 } } });
        if (u.count === 0) await tx.marketingBannerConsentCounter.create({ data: { ...cell, count: 1 } });
      });
      return true;
    } catch {
      this.logger.warn('banner-response: contador no incrementado');
      return false;
    }
  }
}
