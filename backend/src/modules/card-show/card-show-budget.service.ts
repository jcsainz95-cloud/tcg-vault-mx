import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CARD_SHOW_COUNTER_STORE, CardShowCounterStore } from './card-show-counter.store';
import { DEFAULT_BUDGET_DAY, DEFAULT_BUDGET_HOUR, ENV } from './card-show.constants';

/**
 * card-show-budget.service.ts — v1.93⟨cardshow⟩ (API_CONTRACT §CARDSHOW.7, C1; ARCHITECTURE §4.CARDSHOW.g).
 *
 * Presupuesto GLOBAL de envíos en Redis, compartido por `/leads` y `/players`:
 * `CARD_SHOW_CONFIRM_BUDGET_HOUR` (150) y `..._DAY` (600). Reinician 00:00 **America/Mexico_City**
 * (zona, no fecha): la clave lleva el estampado de fecha/hora CDMX, así que el contador se renueva solo.
 *
 *  - Al 50 % ⇒ 1 alerta (dedup por ventana con `claimOnce`).
 *  - Al 100 % se corta el ENVÍO, no el registro: `allowed=false` ⇒ la fila nace PENDING con
 *    `confirmationHeldAt`, 0 envíos; ⛔ no se reenvía sola. 1 alerta al corte.
 *  - **Redis caído ⇒ fail-CLOSED**: `allowed=false, failClosed=true` ⇒ 0 envíos (fila PENDING + alerta).
 *    Opuesto a §4.57 #11: aquí lo que está en juego es el envío (reputación), no el acceso.
 */
export interface BudgetDecision {
  /** ¿Hay presupuesto para ENVIAR el correo de confirmación? */
  allowed: boolean;
  /** `true` si el corte lo causó un fallo de Redis (no un tope alcanzado). */
  failClosed: boolean;
  hour: number;
  day: number;
  /** Cruzó el 50 % en ESTA reserva (emite 1 alerta; ya viene dedupeado). */
  crossed50: boolean;
  /** Llegó al 100 % / corte en ESTA reserva (emite 1 alerta; ya viene dedupeado). */
  cut: boolean;
}

@Injectable()
export class CardShowBudgetService {
  private readonly logger = new Logger(CardShowBudgetService.name);

  constructor(
    @Inject(CARD_SHOW_COUNTER_STORE) private readonly store: CardShowCounterStore,
    private readonly config: ConfigService,
  ) {}

  private hourLimit(): number {
    return this.posInt(this.config.get<string>(ENV.BUDGET_HOUR), DEFAULT_BUDGET_HOUR);
  }
  private dayLimit(): number {
    return this.posInt(this.config.get<string>(ENV.BUDGET_DAY), DEFAULT_BUDGET_DAY);
  }
  private posInt(raw: string | undefined, def: number): number {
    const n = Number((raw ?? '').trim());
    return Number.isInteger(n) && n > 0 ? n : def;
  }

  /**
   * Reserva 1 envío del presupuesto global. ⛔ Llamar SOLO cuando ya se decidió que toca enviar (tras
   * topes por buzón/dominio/corte C6): el presupuesto cuenta ENVÍOS, no altas.
   */
  async tryReserve(now: number = Date.now()): Promise<BudgetDecision> {
    const hourLimit = this.hourLimit();
    const dayLimit = this.dayLimit();
    const { hourKey, dayKey, hourTtlMs, dayTtlMs } = this.windowKeys(now);

    let res: { allowed: boolean; hour: number; day: number };
    try {
      res = await this.store.reserveBudget({ hourKey, hourLimit, hourTtlMs, dayKey, dayLimit, dayTtlMs });
    } catch (e) {
      this.logger.error(
        `Presupuesto: Redis no respondió (${e instanceof Error ? e.message : String(e)}) ⇒ fail-CLOSED ` +
          '(0 envíos, fila PENDING + alerta). §CARDSHOW.7.',
      );
      return { allowed: false, failClosed: true, hour: 0, day: 0, crossed50: false, cut: false };
    }

    if (!res.allowed) {
      const cut = await this.store.claimOnce(`alert:cut:${this.cutStamp(now, res, hourLimit)}`, 60_000).catch(() => false);
      return { allowed: false, failClosed: false, hour: res.hour, day: res.day, crossed50: false, cut };
    }

    // La alerta del 50 % cuelga de la ventana por HORA: es la que muerde en el pico del anuncio (el
    // criterio de §13 la fija en el 5.º envío con HOUR=10). El día no dispara un 50 % propio (sería un
    // segundo aviso en la misma campaña por una ventana menos urgente); el corte diario SÍ alerta.
    const halfHour = Math.floor(hourLimit / 2);
    let crossed50 = false;
    if (res.hour === halfHour && halfHour > 0) {
      crossed50 = await this.store.claimOnce(`alert:50:h:${hourKey}`, 2 * 60 * 60 * 1000).catch(() => false);
    }
    return { allowed: true, failClosed: false, hour: res.hour, day: res.day, crossed50, cut: false };
  }

  /** Lectura (sin efectos) del estado del presupuesto para el panel/health. */
  async snapshot(now: number = Date.now()): Promise<{ hour: number; day: number; hourLimit: number; dayLimit: number }> {
    const { hourKey, dayKey } = this.windowKeys(now);
    const [hour, day] = await Promise.all([
      this.store.count(hourKey).catch(() => 0),
      this.store.count(dayKey).catch(() => 0),
    ]);
    return { hour, day, hourLimit: this.hourLimit(), dayLimit: this.dayLimit() };
  }

  /** Estampado único del corte (para dedupear la alerta): la ventana que llenó. */
  private cutStamp(now: number, res: { hour: number; day: number }, hourLimit: number): string {
    const { hourKey, dayKey } = this.windowKeys(now);
    return res.hour >= hourLimit ? `h:${hourKey}` : `d:${dayKey}`;
  }

  /** Claves de ventana con estampado CDMX + sus TTL (auto-limpieza tras el reinicio 00:00 CDMX). */
  private windowKeys(now: number): { hourKey: string; dayKey: string; hourTtlMs: number; dayTtlMs: number } {
    const p = cdmxParts(now);
    return {
      hourKey: `budget:h:${p.date}-${p.hour}`,
      dayKey: `budget:d:${p.date}`,
      hourTtlMs: 2 * 60 * 60 * 1000, // 2 h: cubre la hora + holgura
      dayTtlMs: 26 * 60 * 60 * 1000, // 26 h: cubre el día CDMX + holgura
    };
  }
}

/** Partes de fecha/hora en America/Mexico_City: `{ date: 'YYYY-MM-DD', hour: 'HH' }`. */
export function cdmxParts(nowMs: number): { date: string; hour: string } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(nowMs));
  const get = (t: string) => parts.find((x) => x.type === t)?.value ?? '00';
  const hour = get('hour') === '24' ? '00' : get('hour');
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour };
}
