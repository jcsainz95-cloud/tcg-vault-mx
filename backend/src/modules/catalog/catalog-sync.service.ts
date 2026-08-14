import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { SettingsService } from '../settings/settings.service';
import { SettingKey } from '../settings/settings.constants';
import { PokemonTcgIoClient, RemoteCard, RemoteCardSet } from './pokemontcg-io.client';
import { yearFromReleaseDate } from './catalog.service';

/** Guardarraíl anti-inyección del `setId` antes de interpolarlo en `q=set.id:<setId>`. */
export const SET_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** Formato de fecha de pokemontcg.io (`yyyy/MM/dd`). */
const DATE_PATTERN = /^\d{4}\/\d{2}\/\d{2}$/;

/**
 * CatalogSyncService — Ingesta de datos de catálogo desde pokemontcg.io (M2, ARCHITECTURE §4.8).
 * super_admin, auditado (el controller registra en AuditLog). Upsert idempotente por `externalId`.
 * `Card.rarity` se persiste como String libre (taxonomía abierta → captura rarezas modernas).
 */
@Injectable()
export class CatalogSyncService {
  private readonly logger = new Logger(CatalogSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: PokemonTcgIoClient,
    private readonly settings: SettingsService,
  ) {}

  /** GET /admin/catalog/remote-sets — lista remota + estado local (imported/cardCount). */
  async remoteSets() {
    const remote = await this.client.getSets();
    const localSets = await this.prisma.cardSet.findMany({ select: { externalId: true } });
    const localExternalIds = new Set(localSets.map((s) => s.externalId));
    const counts = await this.localCardCountsByExternalSetId();

    const data = remote
      .map((s) => ({
        id: s.id,
        name: s.name,
        series: s.series ?? null,
        releaseDate: s.releaseDate ?? null,
        printedTotal: s.printedTotal ?? null,
        imported: localExternalIds.has(s.id),
        cardCount: counts.get(s.id) ?? 0,
      }))
      .sort((a, b) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? ''));
    return { data };
  }

  /** POST /admin/catalog/sync — importa/actualiza cartas (set puntual o desde fecha). */
  async sync(setId?: string, fromReleaseDate?: string) {
    if (setId != null) {
      if (!SET_ID_PATTERN.test(setId)) {
        throw BusinessException.validation('VALIDATION_ERROR', 'Invalid setId format');
      }
      const res = await this.importSetByExternalId(setId);
      return {
        jobId: `catalog-sync-${Date.now()}`,
        setsQueued: res.imported ? 1 : 0,
        mode: 'single' as const,
      };
    }

    const from =
      fromReleaseDate ?? (await this.settings.getString(SettingKey.CATALOG_SYNC_FROM_DATE));
    if (!DATE_PATTERN.test(from)) {
      throw BusinessException.validation('VALIDATION_ERROR', 'fromReleaseDate must be yyyy/MM/dd');
    }
    const remote = await this.client.getSets();
    const toImport = remote.filter((s) => (s.releaseDate ?? '') >= from);
    let setsQueued = 0;
    for (const s of toImport) {
      const res = await this.importSet(s);
      if (res.imported) setsQueued += 1;
    }
    return { jobId: `catalog-sync-${Date.now()}`, setsQueued, mode: 'from_date' as const };
  }

  /** POST /admin/catalog/backfill — importa el siguiente lote de sets más antiguos no importados. */
  async backfill(batchSize = 10, untilYear?: number) {
    const size = batchSize > 0 ? batchSize : 10;
    const remote = await this.client.getSets();
    const localSets = await this.prisma.cardSet.findMany({ select: { externalId: true } });
    const importedIds = new Set(localSets.map((s) => s.externalId));

    // Candidatos = sets remotos NO importados, opcionalmente acotados por untilYear
    // (no más antiguos que ese año), ordenados de más ANTIGUO a más nuevo.
    const candidates = remote
      .filter((s) => !importedIds.has(s.id))
      .filter((s) => (untilYear == null ? true : (yearFromReleaseDate(s.releaseDate) ?? 0) >= untilYear))
      .sort((a, b) => (a.releaseDate ?? '').localeCompare(b.releaseDate ?? ''));

    const batch = candidates.slice(0, size);
    const imported: { id: string; name: string; releaseDate: string | null; cardCount: number }[] = [];
    for (const s of batch) {
      const res = await this.importSet(s);
      if (res.imported) {
        imported.push({ id: s.id, name: s.name, releaseDate: s.releaseDate ?? null, cardCount: res.cardCount });
      }
    }

    // newBoundary = releaseDate del set más ANTIGUO ya importado tras el lote.
    const allImported = await this.prisma.cardSet.findMany({
      where: { releaseDate: { not: null } },
      select: { releaseDate: true },
      orderBy: { releaseDate: 'asc' },
      take: 1,
    });
    const newBoundary = allImported[0]?.releaseDate ?? null;
    const remaining = candidates.length - imported.length;
    return { imported, newBoundary, remaining };
  }

  // ---------------- helpers ----------------

  /** Importa un set del que ya tenemos metadata remota (from_date/backfill). */
  private async importSet(rs: RemoteCardSet): Promise<{ imported: boolean; cardCount: number }> {
    const localSet = await this.upsertSet(rs);
    const cardCount = await this.importCardsForSet(rs.id, localSet.id);
    return { imported: true, cardCount };
  }

  /** Importa un set puntual por externalId (sync single); deriva la metadata de las cartas. */
  private async importSetByExternalId(setId: string): Promise<{ imported: boolean; cardCount: number }> {
    const first = await this.client.getCardsBySet(setId, 1);
    if (!first.data || first.data.length === 0) {
      return { imported: false, cardCount: 0 };
    }
    const localSet = await this.upsertSet(first.data[0].set);
    let cardCount = await this.upsertCards(first.data, localSet.id);
    cardCount += await this.importRemainingPages(setId, localSet.id, first);
    return { imported: true, cardCount };
  }

  private async importCardsForSet(setExternalId: string, localSetId: string): Promise<number> {
    const first = await this.client.getCardsBySet(setExternalId, 1);
    if (!first.data || first.data.length === 0) return 0;
    let count = await this.upsertCards(first.data, localSetId);
    count += await this.importRemainingPages(setExternalId, localSetId, first);
    return count;
  }

  private async importRemainingPages(
    setExternalId: string,
    localSetId: string,
    first: { page: number; pageSize: number; totalCount: number },
  ): Promise<number> {
    const totalPages = Math.max(1, Math.ceil(first.totalCount / (first.pageSize || 250)));
    let count = 0;
    for (let page = 2; page <= totalPages; page++) {
      const next = await this.client.getCardsBySet(setExternalId, page, first.pageSize || 250);
      count += await this.upsertCards(next.data ?? [], localSetId);
    }
    return count;
  }

  /** Upsert idempotente del set por externalId. */
  private async upsertSet(rs: RemoteCardSet) {
    return this.prisma.cardSet.upsert({
      where: { externalId: rs.id },
      create: {
        externalId: rs.id,
        name: rs.name,
        series: rs.series,
        releaseDate: rs.releaseDate,
        printedTotal: rs.printedTotal,
        ptcgoCode: rs.ptcgoCode,
      },
      update: {
        name: rs.name,
        series: rs.series,
        releaseDate: rs.releaseDate,
        printedTotal: rs.printedTotal,
        ptcgoCode: rs.ptcgoCode,
      },
    });
  }

  /** Upsert idempotente de cartas por externalId. `rarity` = String libre (rarezas modernas). */
  private async upsertCards(cards: RemoteCard[], localSetId: string): Promise<number> {
    let count = 0;
    for (const c of cards) {
      await this.prisma.card.upsert({
        where: { externalId: c.id },
        create: {
          externalId: c.id,
          setId: localSetId,
          name: c.name,
          number: c.number,
          rarity: c.rarity ?? null,
          supertype: c.supertype ?? null,
          subtypes: c.subtypes ?? undefined,
          imageSmallUrl: c.images?.small ?? null,
          imageLargeUrl: c.images?.large ?? null,
        },
        update: {
          setId: localSetId,
          name: c.name,
          number: c.number,
          rarity: c.rarity ?? null,
          supertype: c.supertype ?? null,
          subtypes: c.subtypes ?? undefined,
          imageSmallUrl: c.images?.small ?? null,
          imageLargeUrl: c.images?.large ?? null,
        },
      });
      count += 1;
    }
    return count;
  }

  /** Conteo de cartas locales agrupado por externalId del set (para remote-sets). */
  private async localCardCountsByExternalSetId(): Promise<Map<string, number>> {
    const sets = await this.prisma.cardSet.findMany({
      select: { externalId: true, _count: { select: { cards: true } } },
    });
    const map = new Map<string, number>();
    for (const s of sets) map.set(s.externalId, s._count.cards);
    return map;
  }
}
