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
}

/** Presupuesto por corrida (el job corre cada 15 min; reanuda donde quedo). */
export const BACKFILL_MAX_SETS_PER_RUN = 25;
export const BACKFILL_BUDGET_MS = 10 * 60 * 1000;

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
      const st = (await this.state.get<{ doneSetIds?: string[] }>(CATALOG_AUTO_KEYS.contentKeyBackfill)) ?? {};
      const done = new Set(st.doneSetIds ?? []);
      const sets = await this.prisma.cardSet.findMany({
        where: { NOT: { externalId: { startsWith: 'tcgcsv:' } } },
        select: { id: true, externalId: true },
        orderBy: { externalId: 'asc' },
      });
      const todo = sets.filter((s) => !done.has(s.id));
      let processed = 0;
      for (const s of todo) {
        if (processed >= maxSets || now() - started > budget) break;
        if (opts.isSyncRunning?.()) break; // un barrido en curso ya escribe contentKey por su cuenta; no competir
        const missing = await this.prisma.card.count({ where: { setId: s.id, contentKey: null } });
        if (missing > 0) {
          try {
            out.cardsUpdated += await this.backfillSet(s.id, s.externalId);
          } catch (e) {
            this.logger.warn(`contentKey backfill: set ${s.externalId} fallo (${(e as Error).message}); se reintenta luego.`);
            continue; // queda pendiente, sigue con el siguiente
          }
          processed += 1;
        }
        done.add(s.id);
        out.setsDone += 1;
        await this.state.set(CATALOG_AUTO_KEYS.contentKeyBackfill, { doneSetIds: [...done] });
      }
      out.setsPending = sets.filter((s) => !done.has(s.id)).length;
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
