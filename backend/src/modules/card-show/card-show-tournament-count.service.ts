import { Injectable, Logger } from '@nestjs/common';
import { CardShowDay, CardShowGame } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CardShowService } from './card-show.service';
import { TOURNAMENT_OCCUPIED_STATUSES } from './tournament.util';

/**
 * card-show-tournament-count.service.ts — ⭐M-90 (API_CONTRACT §CARDSHOW.12-bis). Contador PÚBLICO del torneo
 * Pokémon por día. 0 PII: solo agregados por día (`groupBy`), ⛔ nunca una fila.
 *
 * - «Ocupados» = `TOURNAMENT_OCCUPIED_STATUSES` (confirmed + checked_in), la MISMA lista que la reserva de cupo.
 * - `cap` = `CardShowService.tournamentCap()` (la MISMA función que la reserva); `null` ⇒ `full:false`.
 * - Caché en memoria del proceso de `CACHE_TTL_MS` (30 s). Si la BD falla y hay un valor con edad
 *   < `STALE_MAX_MS` (60 s, tope del contrato) se sirve ése; si no ⇒ `null` (el controlador responde 503).
 *   ⛔ Nunca un número inventado.
 */
export interface TournamentCountDay {
  day: CardShowDay;
  confirmed: number;
  cap: number | null;
  full: boolean;
}
export interface TournamentCount {
  game: 'pokemon';
  days: TournamentCountDay[];
  asOf: string;
}

export const TOURNAMENT_COUNT_CACHE_TTL_MS = 30_000;
export const TOURNAMENT_COUNT_STALE_MAX_MS = 60_000;
/** Orden fijo de la respuesta (§CARDSHOW.12-bis): ambos días, `sat` y luego `sun`. */
const DAYS_ORDER: readonly CardShowDay[] = [CardShowDay.sat, CardShowDay.sun];

@Injectable()
export class CardShowTournamentCountService {
  private readonly logger = new Logger(CardShowTournamentCountService.name);
  private cache: { value: TournamentCount; at: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cardShow: CardShowService,
  ) {}

  /** Devuelve el contador (cacheado ≤ 30 s) o `null` si la BD falla sin valor utilizable en caché. */
  async get(now: number = Date.now()): Promise<TournamentCount | null> {
    if (this.cache && now - this.cache.at < TOURNAMENT_COUNT_CACHE_TTL_MS) return this.cache.value;
    try {
      const value = await this.compute(now);
      this.cache = { value, at: now };
      return value;
    } catch (e) {
      this.logger.warn(`tournament/count: la BD no respondió (${e instanceof Error ? e.message : String(e)})`);
      if (this.cache && now - this.cache.at < TOURNAMENT_COUNT_STALE_MAX_MS) return this.cache.value;
      return null;
    }
  }

  private async compute(now: number): Promise<TournamentCount> {
    const rows = await this.prisma.cardShowPlayerSignup.groupBy({
      by: ['day'],
      where: { game: CardShowGame.pokemon, status: { in: [...TOURNAMENT_OCCUPIED_STATUSES] } },
      _count: { _all: true },
    });
    const byDay = new Map(rows.map((r) => [r.day, r._count._all]));
    const cap = this.cardShow.tournamentCap();
    return {
      game: 'pokemon',
      days: DAYS_ORDER.map((day) => {
        const confirmed = byDay.get(day) ?? 0;
        return { day, confirmed, cap, full: cap !== null && confirmed >= cap };
      }),
      asOf: new Date(now).toISOString(),
    };
  }
}
