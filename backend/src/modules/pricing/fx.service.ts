import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { SettingKey } from '../settings/settings.constants';

function today(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * FxService — USD→MXN con colchón (ARCHITECTURE §3.2 FxRate, decisión §10.5).
 * - Automático: Banxico SIE (job diario fx-refresh) + colchón (dial fx_buffer_pct).
 * - Override manual (dial fx_manual_override_rate) tiene PRIORIDAD y es fallback.
 */
@Injectable()
export class FxService {
  private readonly logger = new Logger(FxService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly config: ConfigService,
  ) {}

  /** Tasa vigente (rate ya incluye el efectivo; buffer se aplica al convertir). */
  async getCurrent(): Promise<{
    rate: number;
    bufferPct: number;
    source: 'banxico' | 'manual';
    effectiveDate: string;
  }> {
    const bufferPct = await this.settings.getNumber(SettingKey.FX_BUFFER_PCT);
    const override = await this.settings.getRaw(SettingKey.FX_MANUAL_OVERRIDE_RATE);
    if (override != null && Number(override) > 0) {
      return {
        rate: Number(override),
        bufferPct,
        source: 'manual',
        effectiveDate: today().toISOString().slice(0, 10),
      };
    }
    const latest = await this.prisma.fxRate.findFirst({ orderBy: { effectiveDate: 'desc' } });
    if (latest) {
      return {
        rate: Number(latest.rate),
        bufferPct: Number(latest.bufferPct),
        source: latest.source === 'banxico' ? 'banxico' : 'manual',
        effectiveDate: latest.effectiveDate.toISOString().slice(0, 10),
      };
    }
    // Fallback duro (sin datos aún): tasa conservadora para no romper el pricing.
    return { rate: 18, bufferPct, source: 'manual', effectiveDate: today().toISOString().slice(0, 10) };
  }

  /** Fija override manual (M10). source=manual, prioridad sobre automático del día. */
  async setManual(rate: number, bufferPct: number): Promise<void> {
    await this.settings.update({ fxManualOverrideRate: rate, fxBufferPct: bufferPct });
    await this.prisma.fxRate.upsert({
      where: { id: `manual-${today().toISOString().slice(0, 10)}` },
      create: {
        id: `manual-${today().toISOString().slice(0, 10)}`,
        rate,
        bufferPct,
        effectiveDate: today(),
        source: 'manual',
      },
      update: { rate, bufferPct, source: 'manual' },
    });
  }

  /** Job fx-refresh: obtiene de Banxico SIE, aplica colchón, escribe source=banxico. */
  async refreshFromBanxico(): Promise<{ rate: number; source: 'banxico' | 'manual' }> {
    const bufferPct = await this.settings.getNumber(SettingKey.FX_BUFFER_PCT);
    const token = this.config.get<string>('BANXICO_SIE_TOKEN') || this.config.get<string>('FX_API_KEY');
    if (!token) {
      this.logger.warn('Sin BANXICO_SIE_TOKEN: fx-refresh no puede consultar; usa override/último valor.');
      const cur = await this.getCurrent();
      return { rate: cur.rate, source: cur.source };
    }
    try {
      // Serie SF63528 = USD FIX. API SIE de Banxico.
      const res = await fetch(
        'https://www.banxico.org.mx/SieAPIRest/service/v1/series/SF63528/datos/oportuno',
        { headers: { 'Bmx-Token': token } },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as {
        bmx?: { series?: { datos?: { dato: string }[] }[] };
      };
      const raw = body.bmx?.series?.[0]?.datos?.[0]?.dato;
      const rate = raw ? parseFloat(raw.replace(',', '')) : NaN;
      if (!isFinite(rate) || rate <= 0) throw new Error('Invalid Banxico rate');
      const dateId = today().toISOString().slice(0, 10);
      await this.prisma.fxRate.upsert({
        where: { id: `banxico-${dateId}` },
        create: { id: `banxico-${dateId}`, rate, bufferPct, effectiveDate: today(), source: 'banxico' },
        update: { rate, bufferPct, source: 'banxico' },
      });
      return { rate, source: 'banxico' };
    } catch (e) {
      this.logger.warn(`Banxico fetch failed: ${(e as Error).message}. Fallback a override/último.`);
      const cur = await this.getCurrent();
      return { rate: cur.rate, source: cur.source };
    }
  }
}
