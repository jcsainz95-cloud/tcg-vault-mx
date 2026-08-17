import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { SettingsService } from '../settings/settings.service';
import { SettingKey } from '../settings/settings.constants';
import { PokemonTcgIoClient, RemoteCard, RemoteCardSet } from './pokemontcg-io.client';
import { yearFromReleaseDate } from './catalog.service';
import { deriveAvailableFinishes } from '../pricing/pricing.types';

/** Guardarraíl anti-inyección del `setId` antes de interpolarlo en `q=set.id:<setId>`. */
export const SET_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** Formato de fecha de pokemontcg.io (`yyyy/MM/dd`). */
const DATE_PATTERN = /^\d{4}\/\d{2}\/\d{2}$/;

/**
 * CatalogSyncService — Ingesta de METADATA de catálogo desde pokemontcg.io (M2, ARCHITECTURE §4.8).
 * super_admin, auditado (el controller registra en AuditLog). Upsert idempotente por `externalId`.
 * `Card.rarity` se persiste como String libre (taxonomía abierta → captura rarezas modernas).
 *
 * WS-A (v1.14-price-ingest, §4.15g / DEV-5): `catalog-sync` vuelve a ser **SOLO metadata**
 * (nombres/imágenes/sets/números/rareza + import de sets nuevos). Se **quitó** el poblado de
 * `PriceReference` (`persistMarketReferences`) y las deps `PricingService`/`FxService` que v1.12 le
 * inyectó: el PRICING lo hace ahora **solo** `price-ingest` (proveedor de paga, bulk por set, mucho
 * más barato). `deriveAvailableFinishes(tcgplayer.prices)` se **conserva** como BOOTSTRAP (default
 * seguro para un set recién importado); `price-ingest` lo sobre-escribe con las variantes reales del
 * proveedor (§4.15e). El job `catalog-price-sync` queda DEPRECADO en su rol de pricing.
 */
@Injectable()
export class CatalogSyncService {
  private readonly logger = new Logger(CatalogSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: PokemonTcgIoClient,
    private readonly settings: SettingsService,
  ) {}

  /**
   * GET /admin/catalog/remote-sets — lista remota + estado local (imported/cardCount).
   *
   * ROBUSTEZ (bug prod): si pokemontcg.io falla o rate-limitea, NO tiramos 500 crudo. Se
   * **degrada con gracia** usando la lista LOCAL de sets (`CardSet` en BD) como fallback, para
   * que M2 siga operable durante un rate-limit/sync. El shape del contrato se mantiene
   * (`{ data: [...] }`); se añaden banderas opcionales `degraded`/`source` (no rompen el shape).
   */
  async remoteSets() {
    const counts = await this.localCardCountsByExternalSetId();
    let remote: RemoteCardSet[];
    try {
      remote = await this.client.getSets();
    } catch (e) {
      this.logger.warn(
        `remote-sets: pokemontcg.io no disponible (${(e as Error).message}); fallback a sets locales.`,
      );
      const localSets = await this.prisma.cardSet.findMany();
      const data = localSets
        .map((s) => ({
          id: s.externalId,
          name: s.name,
          series: s.series ?? null,
          releaseDate: s.releaseDate ?? null,
          printedTotal: s.printedTotal ?? null,
          imported: true, // si está local, ya fue importado
          cardCount: counts.get(s.externalId) ?? 0,
        }))
        .sort((a, b) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? ''));
      return { data, degraded: true, source: 'local' as const };
    }

    const localSets = await this.prisma.cardSet.findMany({ select: { externalId: true } });
    const localExternalIds = new Set(localSets.map((s) => s.externalId));

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
    return { data, degraded: false, source: 'remote' as const };
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

  /**
   * POST /admin/catalog/backfill — importa el siguiente lote de sets más antiguos no importados.
   *
   * `force:true` (v1.6-finish) NO filtra los sets ya importados: los reprocesa (re-upsert por
   * `externalId`) para refrescar `availableFinishes`. `force:false` (default) mantiene el
   * comportamiento de hoy (solo sets no importados).
   */
  async backfill(batchSize = 10, untilYear?: number, force = false) {
    const size = batchSize > 0 ? batchSize : 10;
    const remote = await this.client.getSets();
    const localSets = await this.prisma.cardSet.findMany({ select: { externalId: true } });
    const importedIds = new Set(localSets.map((s) => s.externalId));

    // Candidatos = sets remotos (con force NO se filtran los importados; sin force, solo los NO
    // importados), opcionalmente acotados por untilYear (no más antiguos que ese año), ordenados
    // de más ANTIGUO a más nuevo.
    const candidates = remote
      .filter((s) => (force ? true : !importedIds.has(s.id)))
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

  /**
   * Estado observable del barrido `sync-all` (para `GET /admin/catalog/sync-status`).
   *
   * Vive en memoria del proceso (no persistido; ver límite conocido en `syncAll`). Da un
   * progreso HONESTO `done/total` en SETS y un momento claro de "terminó" (`running=false` +
   * `finishedAt`), SIN llamar a pokemontcg.io en cada poll (no consume rate-limit). `running`
   * también sirve de single-flight: mientras es `true` no se lanza un segundo barrido.
   */
  private syncAllStatus: {
    running: boolean;
    jobId: string | null;
    total: number;
    done: number;
    startedAt: string | null;
    finishedAt: string | null;
  } = { running: false, jobId: null, total: 0, done: 0, startedAt: null, finishedAt: null };

  /** GET /admin/catalog/sync-status — progreso del barrido en curso (o del último). */
  getSyncStatus() {
    return { ...this.syncAllStatus };
  }

  /**
   * POST /admin/catalog/sync-all (v1.3, NUEVO) — importa TODO el catálogo (todos los sets
   * remotos, sin frontera de fecha) para la Opción 1 del cotizador. API_CONTRACT §M2.
   *
   * **NO bloqueante (resuelve DEV-1):** calcula los sets pendientes con UNA llamada rápida a
   * `/sets`, lanza el barrido en **segundo plano** (fire-and-forget) y retorna `202` de
   * inmediato — a diferencia del `sync` from-date, que importa síncrono en el request y da
   * timeout con catálogos grandes.
   *
   * **Resumible + idempotente:** los sets ya importados (con cartas) se saltan; los que se
   * (re)importan usan upsert por `externalId` (no duplican). Re-llamar `sync-all` reanuda los
   * pendientes que quedaran de un barrido interrumpido.
   *
   * **Modo `force` (v1.6-finish, bug availableFinishes):** con `force:true` NO se saltan los
   * sets ya poblados: se reprocesan TODOS los sets remotos y se re-upsertan sus cartas vía
   * `upsertCards` (idempotente por `externalId`). Esto **refresca `Card.availableFinishes`**
   * (bootstrap) que en sets viejos se quedó en `['normal']`. Con `force:false` (default) el
   * comportamiento es el de siempre: salta importados.
   *
   * **WS-A (§4.15g):** este barrido ya NO puebla precios (eso lo hace `price-ingest`). Refresca
   * SOLO metadata + `availableFinishes` (bootstrap). El job `catalog-price-sync` (force:true)
   * queda deprecado en su rol de pricing; se conserva para importar metadata de sets nuevos.
   *
   * **Límite conocido (sin BullMQ cableado para catálogo, ver BACKEND_NOTES / DEV-1):** el
   * barrido corre en memoria del proceso; si el proceso se reinicia a mitad, los sets no
   * importados quedan pendientes y se reanudan re-llamando `sync-all`.
   */
  async syncAll(
    options: { force?: boolean } = {},
  ): Promise<{ jobId: string; setsQueued: number; remaining: number }> {
    const force = options.force ?? false;
    const remote = await this.client.getSets();
    const local = await this.prisma.cardSet.findMany({
      select: { externalId: true, _count: { select: { cards: true } } },
    });
    // "Importado" = set local con al menos una carta (evita reprocesar sets ya poblados).
    const importedWithCards = new Set(
      local.filter((s) => s._count.cards > 0).map((s) => s.externalId),
    );
    // force=true → reprocesa TODOS los sets remotos (no filtra los ya poblados) para refrescar
    // availableFinishes; force=false (default) → solo los pendientes (comportamiento hoy).
    const pending = force ? [...remote] : remote.filter((s) => !importedWithCards.has(s.id));
    const jobId = `catalog-sync-all-${Date.now()}`;

    if (this.syncAllStatus.running) {
      // Ya hay un barrido en curso → no lanzamos otro; reportamos lo que falta.
      return { jobId, setsQueued: 0, remaining: pending.length };
    }

    const batch = [...pending];
    // Publica el estado observable del barrido ANTES de lanzarlo: jobId/total/startedAt se
    // fijan aquí; `done` avanza por set en runSyncAll; `running`/`finishedAt` se cierran en el
    // finally. Así el front puede pintar una barra honesta done/total y saber cuándo terminó.
    this.syncAllStatus = {
      running: true,
      jobId,
      total: batch.length,
      done: 0,
      startedAt: new Date().toISOString(),
      finishedAt: null,
    };
    // Fire-and-forget: el request NO espera a que se importen todos los sets.
    void this.runSyncAll(batch).finally(() => {
      this.syncAllStatus.running = false;
      this.syncAllStatus.finishedAt = new Date().toISOString();
    });
    // `setsQueued` = sets encolados en esta llamada; `remaining` = sets aún sin importar que
    // NO se encolaron (0: encolamos todos los pendientes).
    return { jobId, setsQueued: batch.length, remaining: 0 };
  }

  /** Barrido en segundo plano de `sync-all`: importa cada set secuencialmente (rate-limit). */
  async runSyncAll(sets: RemoteCardSet[]): Promise<void> {
    for (const s of sets) {
      try {
        await this.importSet(s);
      } catch (e) {
        this.logger.warn(`sync-all: set ${s.id} falló: ${(e as Error).message}`);
      } finally {
        // Avanza el progreso por set intentado (éxito o fallo) → barra honesta done/total.
        this.syncAllStatus.done += 1;
      }
    }
    this.logger.log(`sync-all: barrido de ${sets.length} sets completado.`);
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

  /**
   * Upsert idempotente de cartas por externalId. `rarity` = String libre (rarezas modernas).
   *
   * ROBUSTEZ (bug prod: "el sync importaba solo 1 carta por set"): cada carta se aísla en su
   * propio try/catch. Si UNA carta truena (dato inválido del API, colisión inesperada, etc.) se
   * REGISTRA y se CONTINÚA con las demás — nunca aborta la importación del set entero. Los campos
   * requeridos ausentes se manejan con gracia (`number` → ''), y una carta sin `id`/`name` (no
   * persistible) se omite con log en vez de reventar el barrido.
   *
   * WS-A (§4.15g): SOLO metadata. `deriveAvailableFinishes(tcgplayer.prices)` se conserva como
   * BOOTSTRAP (default seguro para un set nuevo, antes de su primer `price-ingest`, que después lo
   * sobre-escribe con las variantes reales del proveedor, §4.15e). Ya NO se puebla `PriceReference`.
   */
  private async upsertCards(cards: RemoteCard[], localSetId: string): Promise<number> {
    let count = 0;
    for (const c of cards) {
      if (!c?.id || !c?.name) {
        this.logger.warn(
          `sync: carta inválida omitida (id=${c?.id ?? '?'}, name=${c?.name ?? '?'}) — no aborta el set.`,
        );
        continue;
      }
      // v1.6-finish: deriva los acabados de las llaves presentes en tcgplayer.prices (mapeo
      // ARCHITECTURE §3.7) como BOOTSTRAP. Ausente/vacío o sin llaves mapeadas → [normal].
      const availableFinishes = deriveAvailableFinishes(c.tcgplayer?.prices);
      const data = {
        setId: localSetId,
        name: c.name,
        number: c.number ?? '',
        rarity: c.rarity ?? null,
        supertype: c.supertype ?? null,
        subtypes: c.subtypes ?? undefined,
        imageSmallUrl: c.images?.small ?? null,
        imageLargeUrl: c.images?.large ?? null,
        availableFinishes,
      };
      try {
        await this.prisma.card.upsert({
          where: { externalId: c.id },
          create: { externalId: c.id, ...data },
          update: data,
        });
        count += 1;
      } catch (e) {
        // Una carta mala NO tira el set: se omite y se sigue (importación parcial > 1 carta).
        this.logger.warn(
          `sync: carta ${c.id} falló y se omite (no aborta el set): ${(e as Error).message}`,
        );
      }
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
