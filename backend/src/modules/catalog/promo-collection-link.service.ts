import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CATALOG_AUTO_KEYS, CatalogAutoStateService } from './catalog-auto-state.service';
import { backtestBlackStarGate, inferPromoLinks } from './promo-collection-link';
import { PTCG_PROMO_GROUPS } from './promo-set-groups';

/** Candado consultivo del recalculo de la liga (un solo escritor; sin espera). Valor propio en el censo de claves. */
export const PROMO_LINK_LOCK_KEY = 91_130_104;

/** Estado de la compuerta Black Star (backtest ciego) tal como se persiste y se reporta: `promos.gate`. */
export interface PromoGateState {
  open: boolean;
  n: number;
  /** Sellos `high` con su expansion real correcta (abren con k >= 30). */
  k: number;
  /** Falsos `high` (cualquiera > 0 cierra). */
  f: number;
  expansions: number;
}
/** `ConfigSetting` con la ultima compuerta calculada (estado derivado; sin migracion). Un solo escritor: `recompute`. */
export const PROMO_GATE_KEY = CATALOG_AUTO_KEYS.promoGate;

/** Lee la compuerta persistida. Sin fila (nunca se calculo) o ilegible => CERRADA (falla cerrado). */
export async function readPromoGate(prisma: Pick<PrismaService, 'configSetting'>): Promise<PromoGateState> {
  const row = await prisma.configSetting.findUnique({ where: { key: PROMO_GATE_KEY } });
  const v = row?.valueJson as Partial<PromoGateState> | null | undefined;
  if (!v || typeof v !== 'object') return { open: false, n: 0, k: 0, f: 0, expansions: 0 };
  return { open: v.open === true, n: Number(v.n) || 0, k: Number(v.k) || 0, f: Number(v.f) || 0, expansions: Number(v.expansions) || 0 };
}

export interface PromoLinksSummary {
  high: number;
  low: number;
  none: number;
  changed: number;
  /** Compuerta Black Star recalculada en esta corrida (backtest ciego). */
  gate?: PromoGateState;
}

/**
 * PromoCollectionLinkService (AUTO-B) - recalcula la cache `PromoCollectionLink` COMPLETA al final de cada sync. Determinista =>
 * idempotente (2.a corrida: changed=0). Un solo escritor a la vez (`pg_try_advisory_xact_lock`); si otro lo tiene, no hace nada.
 */
@Injectable()
export class PromoCollectionLinkService {
  private readonly logger = new Logger(PromoCollectionLinkService.name);
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  async recompute(): Promise<PromoLinksSummary | null> {
    const promoExternal = PTCG_PROMO_GROUPS.map((g) => g.ptcgSetId);
    const sets = await this.prisma.cardSet.findMany({ select: { id: true, externalId: true } });
    const isPromoSet = (ext: string) => promoExternal.includes(ext) || ext.startsWith('tcgcsv:');
    const promoSetIds = new Set(sets.filter((s) => isPromoSet(s.externalId)).map((s) => s.id));
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
      // Compuerta Black Star AUTOMATICA: backtest ciego con los sellos (verdad por construccion), cada recalculo. Va DENTRO del
      // candado (un solo escritor/auditor) y estado + AuditLog comparten transaccion (AUTO-G2): o quedan los dos o ninguno.
      summary.gate = await this.refreshGate(tx as unknown as PrismaService, expansionCards, minBySet, promoSetIds);
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

  /**
   * Backtest ciego (spec AUTO_CATALOGO §B): sellos colgados de una carta lisa de una EXPANSION (no de un set de promos) se infieren
   * ignorando esa relacion y se comparan. Persiste el estado y deja `AuditLog catalog.promo_gate_changed` SOLO si `open` cambia.
   */
  private async refreshGate(
    db: PrismaService,
    expansionCards: { setId: string; contentKey: string | null }[],
    minBySet: Map<string, number>,
    promoSetIds: Set<string>,
  ): Promise<PromoGateState> {
    const stamped = await db.cardProduct.findMany({
      where: { kind: 'stamped' },
      select: { tcgplayerProductId: true, card: { select: { setId: true, contentKey: true } } },
    });
    const gate = backtestBlackStarGate({
      stamps: stamped
        .filter((p) => !promoSetIds.has(p.card.setId))
        .map((p) => ({ id: String(p.tcgplayerProductId), contentKey: p.card.contentKey, productId: p.tcgplayerProductId, realSetId: p.card.setId })),
      expansionCards,
      minProductIdBySet: minBySet,
    });
    const next: PromoGateState = { open: gate.open, n: gate.n, k: gate.k, f: gate.falseHigh, expansions: gate.expansions };
    const before = await readPromoGate(db);
    await new CatalogAutoStateService(db).set(PROMO_GATE_KEY, next);
    if (before.open !== next.open && this.audit) {
      // Sin `.catch`: si la auditoria falla se revierte tambien el estado y la proxima corrida vuelve a ver el cambio.
      await this.audit.log(
        { action: 'catalog.promo_gate_changed', entityType: 'ConfigSetting', entityId: PROMO_GATE_KEY, before: { open: before.open }, after: next },
        db as never,
      );
    }
    return next;
  }

  /**
   * Ids de las Black Star/ETB ligadas (confianza `high`) a estas expansiones, SOLO con la compuerta ABIERTA. Los sellos no pasan por
   * aqui (se muestran siempre). Compuerta cerrada => [].
   */
  async publishableLinkedCardIds(expansionSetIds: string[]): Promise<string[]> {
    if (!(await readPromoGate(this.prisma)).open) return [];
    const rows = await this.prisma.promoCollectionLink.findMany({
      where: { expansionSetId: { in: expansionSetIds }, confidence: 'high' },
      select: { promoCardId: true },
    });
    return rows.map((r) => r.promoCardId);
  }
}
