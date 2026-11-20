/**
 * demand-match.service.ts — §DEMANDA F1 (API_CONTRACT_DEMANDA §5, job `demand-match`, diario 04:30 UTC, BullMQ attempts 3).
 * Para cada término de búsqueda que ya pasa el umbral (PII + vocabulario + ≥ 5 personas y ≥ 2 días), `searchAllCards` (≤ 5 resultados):
 * `matched` si hay UN resultado, o un único resultado cuyo nombre normalizado (`foldSearchText`) iguala el término; si no, `ambiguous`
 * (varios) o `none`. Upsert por término ⇒ idempotente. Un término ya `matched` se re-evalúa a los 30 d. ⛔ Solo escribe `DemandTermMatch`.
 * Sets nuevos entran solos (el catálogo es la fuente). Un fallo lanza para que la cola reintente; lo ya escrito queda (idempotente).
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { CatalogService } from '../catalog/catalog.service';
import { MarketingSearchMissService } from '../marketing/marketing-search-miss.service';
import { foldSearchText } from '../marketing/marketing-search-vocabulary';
import { toMexicoCityDateKey } from '../../common/business-days';
import { addDays } from '../sales-analytics/sales-period';
import { DEMAND_MATCH_LAST_OK_KEY, DEMAND_MATCH_MAX_RESULTS, DEMAND_MATCH_REEVAL_DAYS, readDemandDials } from './demand.constants';

export type DemandMatchStatus = 'matched' | 'ambiguous' | 'none';

/** PURO: decide el estado y la carta a partir de los resultados de `searchAllCards`. */
export function decideMatch(term: string, results: { id: string; name: string }[]): { status: DemandMatchStatus; cardId: string | null } {
  if (results.length === 0) return { status: 'none', cardId: null };
  if (results.length === 1) return { status: 'matched', cardId: results[0].id };
  const exact = results.filter((r) => foldSearchText(r.name) === term);
  if (exact.length === 1) return { status: 'matched', cardId: exact[0].id };
  return { status: 'ambiguous', cardId: null };
}

@Injectable()
export class DemandMatchService {
  private readonly logger = new Logger(DemandMatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly catalog: CatalogService,
    private readonly searchMiss: MarketingSearchMissService,
  ) {}

  /** Devuelve cuántos términos evaluó. Lanza si la lectura o una búsqueda falla (la cola reintenta). */
  async run(now = new Date()): Promise<number> {
    const dials = await readDemandDials(this.settings);
    const today = toMexicoCityDateKey(now);
    const terms = await this.searchMiss.readQualifying(addDays(today, -(dials.searchWindowDays - 1)), today);
    if (terms === null) throw new Error('demand-match: no se pudo leer las búsquedas');
    const existing = new Map((await this.prisma.demandTermMatch.findMany({ select: { termNormalized: true, status: true, matchedAt: true } })).map((m) => [m.termNormalized, m]));
    const reevalBefore = now.getTime() - DEMAND_MATCH_REEVAL_DAYS * 86_400_000;
    let evaluated = 0;
    let failed = 0;
    let firstError: unknown;
    for (const { term } of terms) {
      const prev = existing.get(term);
      if (prev && prev.status === 'matched' && prev.matchedAt.getTime() > reevalBefore) continue;
      // DM-5: un término que haga lanzar a `searchAllCards` (o a su upsert) NO aborta el lote: se omite, queda sin match y se reintenta mañana.
      try {
        const res = await this.catalog.searchAllCards({ q: term, page: 1, pageSize: DEMAND_MATCH_MAX_RESULTS });
        const { status, cardId } = decideMatch(term, res.data.map((c) => ({ id: c.id, name: c.name })));
        await this.prisma.demandTermMatch.upsert({
          where: { termNormalized: term },
          create: { termNormalized: term, status, cardId, matchedAt: now },
          update: { status, cardId, matchedAt: now },
        });
        evaluated += 1;
      } catch (e) {
        failed += 1;
        firstError ??= e;
        this.logger.warn(`demand-match: un término falló (${e instanceof Error ? e.constructor.name : 'error'}); se omite y sigue el lote`);
      }
    }
    // Si TODOS los intentos fallaron la falla es sistémica (BD/catálogo caídos): se lanza para que la cola reintente y NO se marca «última corrida buena».
    if (failed > 0 && evaluated === 0) throw firstError instanceof Error ? firstError : new Error(`demand-match: fallaron los ${failed} término(s) evaluados`);
    // «Última corrida buena»: se marca si AL MENOS UN término se evaluó (los que fallaron se omiten y se reintentan mañana); solo la falla total la deja sin marcar (el endpoint lo muestra como «dato de hace N días»).
    await this.prisma.configSetting.upsert({
      where: { key: DEMAND_MATCH_LAST_OK_KEY },
      create: { key: DEMAND_MATCH_LAST_OK_KEY, valueJson: now.toISOString() },
      update: { valueJson: now.toISOString() },
    });
    this.logger.log(`demand-match: ${evaluated} término(s) evaluados de ${terms.length}${failed > 0 ? `, ${failed} omitidos por fallo` : ''}`);
    return evaluated;
  }
}
