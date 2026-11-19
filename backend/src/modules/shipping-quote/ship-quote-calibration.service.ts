/**
 * ship-quote-calibration.service.ts — job diario 03:30 UTC `ship-quote-calibrate` (DECISIONES punto 6).
 *  (a) recalibra la tabla `ShippingZoneRate` con `ShippingQuoteLog` de los últimos 30 días (≥ 5 muestras por grupo; si no, CONSERVA la fila);
 *  (b) sondea con 2 CPs al azar cada prefijo con < 5 muestras (SOLO cotización: ⛔ cero guías; ≤ 100 llamadas por corrida);
 *  (c) borra el log de más de 45 días.
 * Idempotente; nunca lanza hacia el scheduler (cada paso se registra y sigue).
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingKey } from '../settings/settings.constants';
import { SettingsService } from '../settings/settings.service';
import { InsuranceTier } from '../settings/shipping-dials';
import { recalibrate } from './ship-quote-math';
import { ShippingQuoteService } from './shipping-quote.service';

export const CALIBRATION_WINDOW_DAYS = 30;
export const LOG_RETENTION_DAYS = 45;
export const MIN_SAMPLES = 5;
export const MAX_PROBES = 100;
const DAY_MS = 86_400_000;

@Injectable()
export class ShipQuoteCalibrationService {
  private readonly logger = new Logger(ShipQuoteCalibrationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly quotes: ShippingQuoteService,
  ) {}

  async run(now: Date = new Date(), rand: () => number = Math.random): Promise<{ updated: number; probed: number; purged: number }> {
    let updated = 0;
    let probed = 0;
    let purged = 0;
    try {
      updated = await this.recalibrateFromLog(now);
    } catch (e) {
      this.logger.error(`ship-quote-calibrate recalibrate falló: ${e instanceof Error ? e.message : String(e)}`);
    }
    try {
      probed = await this.probeThinPrefixes(now, rand);
    } catch (e) {
      this.logger.error(`ship-quote-calibrate probe falló: ${e instanceof Error ? e.message : String(e)}`);
    }
    try {
      purged = (await this.prisma.shippingQuoteLog.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - LOG_RETENTION_DAYS * DAY_MS) } } })).count;
    } catch (e) {
      this.logger.error(`ship-quote-calibrate purge falló: ${e instanceof Error ? e.message : String(e)}`);
    }
    this.logger.log(`ship-quote-calibrate: updated=${updated} probed=${probed} purged=${purged}`);
    return { updated, probed, purged };
  }

  async recalibrateFromLog(now: Date): Promise<number> {
    const since = new Date(now.getTime() - CALIBRATION_WINDOW_DAYS * DAY_MS);
    const log = await this.prisma.shippingQuoteLog.findMany({
      where: { createdAt: { gte: since } },
      select: { prefix2: true, profileKey: true, serviceCode: true, costCents: true },
    });
    const rows = recalibrate(log, MIN_SAMPLES);
    for (const r of rows) {
      await this.prisma.shippingZoneRate.upsert({
        where: { prefix2_profileKey_serviceCode: { prefix2: r.prefix2, profileKey: r.profileKey, serviceCode: r.serviceCode } },
        create: { ...r, calibratedAt: now },
        update: { costCents: r.costCents, samples: r.samples, calibratedAt: now },
      });
    }
    return rows.length;
  }

  /** (b) Prefijos con < 5 muestras en la ventana: 2 CPs al azar de ese prefijo, UNA cotización por perfil (sobre y caja). */
  async probeThinPrefixes(now: Date, rand: () => number): Promise<number> {
    if (!(await this.quotes.enabled())) return 0;
    const since = new Date(now.getTime() - CALIBRATION_WINDOW_DAYS * DAY_MS);
    const counts = await this.prisma.shippingQuoteLog.groupBy({ by: ['prefix2'], where: { createdAt: { gte: since } }, _count: { _all: true } });
    const have = new Map(counts.map((c) => [c.prefix2, c._count._all]));
    const thin: string[] = [];
    for (let p = 1; p <= 99; p++) {
      const pp = String(p).padStart(2, '0');
      if ((have.get(pp) ?? 0) < MIN_SAMPLES) thin.push(pp);
    }
    const tiers = await this.settings.get<InsuranceTier[]>(SettingKey.SHIPPING_INSURANCE_TIERS);
    const coverage = tiers.length > 0 ? tiers[0].coverageCents : 250000;
    let calls = 0;
    for (const pp of thin) {
      for (let i = 0; i < 2 && calls + 2 <= MAX_PROBES; i++) {
        const cp = `${pp}${String(Math.floor(rand() * 1000)).padStart(3, '0')}`;
        calls += await this.quotes.probe(cp, coverage);
      }
    }
    return calls;
  }
}
