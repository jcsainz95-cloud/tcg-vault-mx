/**
 * marketing-quote-counter.service.ts — d4 del Panel (Brief 2 §2 d4; ARCHITECTURE §13.4.3;
 * API_CONTRACT §MKT.D). Conteo anónimo de cálculos del cotizador por `(día CDMX × cardId)`.
 *
 * ⛔ SIN usuario, SIN IP, SIN nada más: solo `(day, cardId)`. 💰 `buylist` es zona de dinero — este
 * servicio NO participa en la cotización: solo suma 1 al contador DESPUÉS de que el cálculo terminó,
 * y en best-effort (un fallo del contador JAMÁS tumba la cotización).
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { toMexicoCityDateKey } from '../../common/business-days';

@Injectable()
export class MarketingQuoteCounterService {
  private readonly logger = new Logger(MarketingQuoteCounterService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Día civil de México como `Date` a medianoche UTC (columna `@db.Date` guarda solo la fecha). */
  private dayOf(now: Date): Date {
    return new Date(`${toMexicoCityDateKey(now)}T00:00:00.000Z`);
  }

  /**
   * Suma 1 al contador `(día, cardId)`. Best-effort: devuelve sin lanzar aunque falle. Se llama tras
   * un `POST /buylist/quote` exitoso, por el controller de buylist (fuera de la lógica de dinero).
   */
  async increment(cardId: string, now = new Date()): Promise<void> {
    const day = this.dayOf(now);
    try {
      await this.prisma.buylistQuoteDailyCount.upsert({
        where: { day_cardId: { day, cardId } },
        create: { day, cardId, count: 1 },
        update: { count: { increment: 1 } },
      });
    } catch (e) {
      this.logger.warn(`d4 contador del cotizador no incrementado (${(e as Error).message})`);
    }
  }
}
