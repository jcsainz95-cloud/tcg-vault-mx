import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { inferPromoLinks } from './promo-collection-link';
import { PTCG_PROMO_GROUPS } from './promo-set-groups';

/** Candado consultivo del recalculo de la liga (un solo escritor; sin espera). Valor propio en el censo de claves. */
export const PROMO_LINK_LOCK_KEY = 91_130_104;

export interface PromoLinksSummary {
  high: number;
  low: number;
  none: number;
  changed: number;
}

/**
 * PromoCollectionLinkService (AUTO-B) - recalcula la cache `PromoCollectionLink` COMPLETA al final de cada sync. Determinista =>
 * idempotente (2.a corrida: changed=0). Un solo escritor a la vez (`pg_try_advisory_xact_lock`); si otro lo tiene, no hace nada.
 */
@Injectable()
export class PromoCollectionLinkService {
  private readonly logger = new Logger(PromoCollectionLinkService.name);
  constructor(private readonly prisma: PrismaService) {}

  async recompute(): Promise<PromoLinksSummary | null> {
    const promoExternal = PTCG_PROMO_GROUPS.map((g) => g.ptcgSetId);
    const sets = await this.prisma.cardSet.findMany({ select: { id: true, externalId: true } });
    const isPromoSet = (ext: string) => promoExternal.includes(ext) || ext.startsWith('tcgcsv:');
    const promoSetIds = new Set(sets.filter((s) => isPromoSet(s.externalId)).map((s) => s.id));
    if (promoSetIds.size === 0) return { high: 0, low: 0, none: 0, changed: 0 };
    const cards = await this.prisma.card.findMany({
      where: { OR: [{ setId: { in: [...promoSetIds] } }, { contentKey: { not: null } }] },
      select: { id: true, setId: true, contentKey: true },
    });
    const products = await this.prisma.cardProduct.findMany({
      where: { kind: 'set_base' },
      select: { cardId: true, tcgplayerProductId: true },
    });
    const minByCard = new Map<string, number>();
    for (const p of products) {
      const cur = minByCard.get(p.cardId);
      if (cur == null || p.tcgplayerProductId < cur) minByCard.set(p.cardId, p.tcgplayerProductId);
    }
    const minBySet = new Map<string, number>();
    const expansionCards: { setId: string; contentKey: string | null }[] = [];
    const promos: { cardId: string; contentKey: string | null; productId: number | null }[] = [];
    for (const c of cards) {
      if (promoSetIds.has(c.setId)) {
        promos.push({ cardId: c.id, contentKey: c.contentKey, productId: minByCard.get(c.id) ?? null });
      } else {
        expansionCards.push({ setId: c.setId, contentKey: c.contentKey });
        const pid = minByCard.get(c.id);
        if (pid != null) minBySet.set(c.setId, Math.min(minBySet.get(c.setId) ?? pid, pid));
      }
    }
    const links = inferPromoLinks({ promos, expansionCards, minProductIdBySet: minBySet });
    const summary: PromoLinksSummary = { high: 0, low: 0, none: promos.length - links.length, changed: 0 };
    for (const l of links) summary[l.confidence] += 1;
    return this.prisma.$transaction(async (tx) => {
      const got = await tx.$queryRaw<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock(${PROMO_LINK_LOCK_KEY}) AS ok`;
      if (got[0]?.ok !== true) return null;
      const existing = await tx.promoCollectionLink.findMany();
      const byPromo = new Map(existing.map((e) => [e.promoCardId, e]));
      const keep = new Set(links.map((l) => l.promoCardId));
      const gone = existing.filter((e) => !keep.has(e.promoCardId)).map((e) => e.promoCardId);
      if (gone.length > 0) {
        await tx.promoCollectionLink.deleteMany({ where: { promoCardId: { in: gone } } });
        summary.changed += gone.length;
      }
      for (const l of links) {
        const cur = byPromo.get(l.promoCardId);
        if (cur && cur.expansionSetId === l.expansionSetId && cur.confidence === l.confidence) continue;
        await tx.promoCollectionLink.upsert({
          where: { promoCardId: l.promoCardId },
          create: { promoCardId: l.promoCardId, expansionSetId: l.expansionSetId, confidence: l.confidence, evidence: l.evidence },
          update: { expansionSetId: l.expansionSetId, confidence: l.confidence, evidence: l.evidence, computedAt: new Date() },
        });
        summary.changed += 1;
      }
      return summary;
    });
  }

  /** Apartado «Promos de la colección»: SOLO confianza `high`. `owned` solo si se pasan los ids que el visitante tiene. */
  async collectionPromos(
    expansionSetIds: string[],
    ownedCardIds?: ReadonlySet<string>,
  ): Promise<{ items: { cardId: string; number: string; name: string; rarity?: string; imageSmallUrl?: string }[]; total: number; owned?: number } | null> {
    const rows = await this.prisma.promoCollectionLink.findMany({
      where: { expansionSetId: { in: expansionSetIds }, confidence: 'high' },
      select: { promoCard: { select: { id: true, number: true, name: true, rarity: true, imageSmallUrl: true, numberSort: true } } },
    });
    if (rows.length === 0) return null; // sin promos ligadas => sin apartado
    const items = rows
      .map((r) => r.promoCard)
      .sort((a, b) => a.numberSort - b.numberSort || a.number.localeCompare(b.number))
      .map((c) => ({ cardId: c.id, number: c.number, name: c.name, ...(c.rarity ? { rarity: c.rarity } : {}), ...(c.imageSmallUrl ? { imageSmallUrl: c.imageSmallUrl } : {}) }));
    return {
      items,
      total: items.length,
      ...(ownedCardIds ? { owned: items.filter((i) => ownedCardIds.has(i.cardId)).length } : {}),
    };
  }
}
