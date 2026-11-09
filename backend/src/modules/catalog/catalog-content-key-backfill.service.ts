import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PokemonTcgIoClient } from './pokemontcg-io.client';
import { CatalogAutoStateService, CATALOG_AUTO_KEYS } from './catalog-auto-state.service';
import { contentKeyOf } from './promo-collection-link';
import { PromoCollectionLinkService } from './promo-collection-link.service';

export interface ContentKeyBackfillResult {
  /** sets cerrados en esta corrida (con o sin cartas actualizadas). */
  setsDone: number;
  /** sets que aun faltan tras esta corrida. */
  setsPending: number;
  cardsUpdated: number;
  linksRecomputed: boolean;
  /** AUTO-S4: sets dados por perdidos (superaron `BACKFILL_MAX_ATTEMPTS_PER_SET` fallos); ya no se reintentan. */
  setsAbandoned?: number;
}

/** Presupuesto por corrida (el job corre cada 15 min; reanuda donde quedo). */
export const BACKFILL_MAX_SETS_PER_RUN = 25;
export const BACKFILL_BUDGET_MS = 10 * 60 * 1000;
/** AUTO-S4: fallos de un set antes de darlo por perdido (el job corre cada 15 min: sin tope reintentaria para siempre). */
export const BACKFILL_MAX_ATTEMPTS_PER_SET = 5;
/** AUTO-S4: un set abandonado se reintenta UNA vez cada 24 h (una caida larga del proveedor no lo condena para siempre). */
export const BACKFILL_ABANDONED_RETRY_MS = 24 * 3_600_000;
/** AUTO-S4: paginas de 250 por set (10 000 cartas); un set que lo rebasa es dato corrupto y cuenta como fallo. */
export const BACKFILL_MAX_PAGES_PER_SET = 40;

/**
 * AUTO-B backfill - calcula `Card.contentKey` de las cartas YA importadas (los datos de contenido no se guardan: se traen de
 * pokemontcg.io con el cliente acotado, que ya reintenta 429/5xx), set a set, y recalcula `PromoCollectionLink` al terminar.
 * Idempotente y reanudable: el avance (`doneSetIds`) vive en `ConfigSetting`; un set cerrado no se vuelve a pedir; un set que
 * falla queda pendiente y se reintenta en la siguiente corrida sin bloquear a los demas. Solo escribe `contentKey`, nunca otro campo.
 */
@Injectable()
export class CatalogContentKeyBackfillService {
  private readonly logger = new Logger(CatalogContentKeyBackfillService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: PokemonTcgIoClient,
    private readonly state: CatalogAutoStateService,
    @Optional() private readonly links?: PromoCollectionLinkService,
  ) {}

  async run(opts: { maxSets?: number; budgetMs?: number; now?: () => number; isSyncRunning?: () => boolean } = {}): Promise<ContentKeyBackfillResult> {
    const out: ContentKeyBackfillResult = { setsDone: 0, setsPending: 0, cardsUpdated: 0, linksRecomputed: false };
    if (this.running) return out;
    this.running = true;
    try {
      const now = opts.now ?? Date.now;
      const started = now();
      const maxSets = opts.maxSets ?? BACKFILL_MAX_SETS_PER_RUN;
      const budget = opts.budgetMs ?? BACKFILL_BUDGET_MS;
      const st = (await this.state.get<{ doneSetIds?: string[]; failures?: Record<string, number>; abandonedSetIds?: string[]; abandonedAt?: Record<string, number> }>(CATALOG_AUTO_KEYS.contentKeyBackfill)) ?? {};
      const done = new Set(st.doneSetIds ?? []);
      const failures: Record<string, number> = { ...(st.failures ?? {}) };
      // setId -> epoch ms del ultimo intento fallido (estado antiguo: lista de ids sin fecha => se reintenta ya, una vez).
      const abandoned = new Map<string, number>(
        st.abandonedAt ? Object.entries(st.abandonedAt) : (st.abandonedSetIds ?? []).map((id): [string, number] => [id, 0]),
      );
      const persist = () =>
        this.state.set(CATALOG_AUTO_KEYS.contentKeyBackfill, { doneSetIds: [...done], failures, abandonedAt: Object.fromEntries(abandoned) });
      const sets = await this.prisma.cardSet.findMany({
        where: { NOT: { externalId: { startsWith: 'tcgcsv:' } } },
        select: { id: true, externalId: true },
        orderBy: { externalId: 'asc' },
      });
      const todo = sets.filter((s) => !done.has(s.id) && (!abandoned.has(s.id) || started - (abandoned.get(s.id) ?? 0) >= BACKFILL_ABANDONED_RETRY_MS));
      let processed = 0;
      for (const s of todo) {
        if (processed >= maxSets || now() - started > budget) break;
        if (opts.isSyncRunning?.()) break; // un barrido en curso ya escribe contentKey por su cuenta; no competir
        const missing = await this.prisma.card.count({ where: { setId: s.id, contentKey: null } });
        if (missing > 0) {
          try {
            out.cardsUpdated += await this.backfillSet(s.id, s.externalId);
          } catch (e) {
            failures[s.id] = (failures[s.id] ?? 0) + 1;
            if (failures[s.id] >= BACKFILL_MAX_ATTEMPTS_PER_SET) {
              abandoned.set(s.id, now());
              this.logger.warn(`contentKey backfill: set ${s.externalId} fallo ${failures[s.id]} veces (${(e as Error).message}); se da por perdido y NO se reintenta.`);
            } else {
              this.logger.warn(`contentKey backfill: set ${s.externalId} fallo (${(e as Error).message}); intento ${failures[s.id]}/${BACKFILL_MAX_ATTEMPTS_PER_SET}, se reintenta luego.`);
            }
            await persist();
            continue; // queda pendiente (o abandonado), sigue con el siguiente
          }
          processed += 1;
        }
        done.add(s.id);
        out.setsDone += 1;
        delete failures[s.id];
        abandoned.delete(s.id);
        await persist();
      }
      out.setsPending = sets.filter((s) => !done.has(s.id) && !abandoned.has(s.id)).length;
      out.setsAbandoned = abandoned.size;
      if (processed > 0 && this.links) {
        try {
          await this.links.recompute();
          out.linksRecomputed = true;
        } catch (e) {
          this.logger.warn(`contentKey backfill: no se pudo recalcular la liga (${(e as Error).message}).`);
        }
      }
      if (out.setsDone > 0) this.logger.log(`contentKey backfill: ${out.setsDone} sets cerrados, ${out.cardsUpdated} cartas, ${out.setsPending} pendientes.`);
      return out;
    } finally {
      this.running = false;
    }
  }

  private async backfillSet(setId: string, externalId: string): Promise<number> {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/i.test(externalId)) throw new Error('externalId invalido');
    let updated = 0;
    let page = 1;
    for (;;) {
      if (page > BACKFILL_MAX_PAGES_PER_SET) throw new Error(`mas de ${BACKFILL_MAX_PAGES_PER_SET} paginas`);
      const res = await this.client.getCardsBySet(externalId, page);
      const data = Array.isArray(res.data) ? res.data : [];
      for (const c of data) {
        const key = contentKeyOf({ name: c.name, supertype: c.supertype, hp: c.hp, attacks: c.attacks, abilities: c.abilities, rules: c.rules });
        if (key === null) continue;
        const r = await this.prisma.card.updateMany({ where: { externalId: c.id, setId, OR: [{ contentKey: null }, { NOT: { contentKey: key } }] }, data: { contentKey: key } });
        updated += r.count;
      }
      const pageSize = res.pageSize || 250;
      if (data.length === 0 || page * pageSize >= (res.totalCount ?? 0)) break;
      page += 1;
    }
    return updated;
  }
}
