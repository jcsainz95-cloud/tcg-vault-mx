import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { normalizeMatchText } from '../../common/card-version';
import { TcgcsvCatalogClient } from '../pricing/providers/tcgcsv-singles.provider';
import { CatalogAutoStateService } from './catalog-auto-state.service';
import { AuditService } from '../audit/audit.service';
import { normalizeCardNumber } from './card-product-resolver.service';
import { tcgcsvSetExternalId } from './tcgcsv-card-name';
import { TCGCSV_IMPORTABLE_GROUPS } from './tcgcsv-importable-groups';
import { PokemonTcgIoClient } from './pokemontcg-io.client';
import { parseTcgcsvCardName } from './tcgcsv-card-name';
import { evaluateDiscoveryGroup, isLivePromoSet, isRenewedPublishedOn, MAX_NEW_GROUPS_PER_RUN, PROMO_NAME_PATTERN } from './tcgcsv-group-discovery';

export interface DiscoveryRun {
  /** grupos elegibles a importar en ESTA corrida (tope de nuevos ya aplicado), sin la semilla. */
  eligible: { groupId: number; name: string }[];
  quarantined: { groupId: number; name: string; reasons: string[] }[];
  summary: { scanned: number; eligible: number; quarantined: number; ignored: number };
}

/**
 * TcgcsvGroupDiscoveryService (AUTO-F, docs/specs/AUTO_CATALOGO.md §F) - descubre grupos de promos de TCGCSV que
 * pokemontcg.io no cubre. SIN estado: se reevalua cada corrida. Fail-closed: sin lista viva de pokemontcg.io => 0 descubrimientos.
 * Nunca escribe cartas; solo decide. La importacion la hace el MISMO `TcgcsvSetImportService` (guardia, lock, todo-o-nada).
 */
@Injectable()
export class TcgcsvGroupDiscoveryService {
  private readonly logger = new Logger(TcgcsvGroupDiscoveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tcgcsv: TcgcsvCatalogClient,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly autoState?: CatalogAutoStateService,
    @Optional() private readonly ptcg?: PokemonTcgIoClient,
  ) {}

  /** Tope por set promo vivo: 6 paginas de 250 (1500 cartas); mas => ilegible (fail-closed). Cache: una corrida (se vacia en `discover`/`evaluate`). */
  private static readonly LIVE_MAX_PAGES = 6;
  private liveCache = new Map<string, Promise<Set<string> | null>>();

  private static numKey(raw: string | null | undefined): string {
    const n = normalizeCardNumber(raw ?? '');
    return n.replace(/^[A-Z]+(?=\d)/, '').replace(/^0+(?=\d)/, '');
  }
  private static cardKey(name: string, number: string | null | undefined): string {
    return `${normalizeMatchText(name)}|${TcgcsvGroupDiscoveryService.numKey(number)}`;
  }

  /** (nombre+numero) de las cartas VIVAS de un set de pokemontcg.io; `null` = ilegible (error, tope, vacio, sin cliente). */
  private liveKeys(setId: string): Promise<Set<string> | null> {
    let p = this.liveCache.get(setId);
    if (!p) {
      p = (async () => {
        if (!this.ptcg) return null;
        try {
          const keys = new Set<string>();
          const first = await this.ptcg.getCardsBySet(setId, 1, 250);
          if (!first.data || first.data.length === 0) return null;
          const size = first.pageSize || 250;
          const pages = Math.max(1, Math.ceil(first.totalCount / size));
          if (pages > TcgcsvGroupDiscoveryService.LIVE_MAX_PAGES) return null;
          const all = [...first.data];
          for (let page = 2; page <= pages; page++) all.push(...((await this.ptcg.getCardsBySet(setId, page, size)).data ?? []));
          for (const c of all) keys.add(TcgcsvGroupDiscoveryService.cardKey(c.name, c.number));
          return keys;
        } catch (e) {
          this.logger.warn(`discovery: cartas vivas de ${setId} ilegibles (${(e as Error).message}).`);
          return null;
        }
      })();
      this.liveCache.set(setId, p);
    }
    return p;
  }

  /** `evaluate(groupId)` del contrato: veredicto de UN grupo contra la lista viva. */
  async evaluate(groupId: number, liveSets: { id: string; name: string; series?: string }[], now = new Date()) {
    this.liveCache = new Map();
    const groups = await this.tcgcsv.listGroups();
    const firstSeen = await this.seen(groups, now);
    const group = groups.find((g) => g.groupId === groupId);
    if (!group) return { verdict: 'ignore' as const, reasons: ['group_unknown'] };
    return this.evaluateGroup(group, liveSets, now, firstSeen);
  }

  private async evaluateGroup(group: { groupId: number; name: string; publishedOn?: string }, liveSets: { id: string; name: string; series?: string }[], now: Date, firstSeen?: Record<string, string>) {
    const products = await this.tcgcsv.getCardProducts(group.groupId);
    const live = await this.maxContentMatch(products, liveSets);
    return evaluateDiscoveryGroup({
      group,
      products: products.map((p) => ({ name: p.name, number: p.number })),
      liveSets,
      maxContentMatch: live.best,
      liveUnverifiable: live.unverifiable,
      now,
      firstSeenAt: firstSeen?.[String(group.groupId)] ?? null,
    });
  }

  /** Persiste (best-effort) la primera vez que vimos cada grupo con `publishedOn` renovado; sin estado inyectado => sin senal. */
  private async seen(groups: { groupId: number; publishedOn?: string }[], now: Date): Promise<Record<string, string> | undefined> {
    if (!this.autoState) return undefined;
    try {
      return await this.autoState.recordFirstSeen(groups.filter((g) => isRenewedPublishedOn(g.publishedOn)).map((g) => g.groupId), now);
    } catch (e) {
      this.logger.warn(`discovery: no se pudo persistir firstSeen (${(e as Error).message}).`);
      return undefined;
    }
  }

  /**
   * Mayor fraccion de productos con numero cuyo (nombre+numero) coincide con las cartas VIVAS de UN set promo de pokemontcg.io
   * (NO con lo importado en local). Algun set promo ilegible => `unverifiable` (fail-closed, nunca se infiere «sin equivalente»).
   */
  private async maxContentMatch(products: { name: string; number: string | null }[], liveSets: { id: string; name: string; series?: string }[]): Promise<{ best: number; unverifiable: boolean }> {
    const numbered = products.filter((p) => (p.number ?? '').trim() !== '');
    if (numbered.length === 0) return { best: 0, unverifiable: false };
    const keys = numbered.map((p) => {
      const parsed = parseTcgcsvCardName(p.name, p.number);
      return TcgcsvGroupDiscoveryService.cardKey(parsed.ok ? parsed.name : p.name, p.number);
    });
    let best = 0;
    let unverifiable = false;
    for (const set of liveSets.filter(isLivePromoSet)) {
      const live = await this.liveKeys(set.id);
      if (!live) {
        unverifiable = true;
        continue;
      }
      best = Math.max(best, keys.filter((k) => live.has(k)).length / numbered.length);
    }
    return { best, unverifiable };
  }

  async discover(liveSets: { id: string; name: string; series?: string }[], now = new Date()): Promise<DiscoveryRun> {
    const run: DiscoveryRun = { eligible: [], quarantined: [], summary: { scanned: 0, eligible: 0, quarantined: 0, ignored: 0 } };
    if (!Array.isArray(liveSets) || liveSets.length === 0) return run; // fail-closed
    this.liveCache = new Map();
    const groups = await this.tcgcsv.listGroups();
    run.summary.scanned = groups.length;
    const firstSeen = await this.seen(groups, now);
    const seedIds = new Set(TCGCSV_IMPORTABLE_GROUPS.map((g) => g.groupId));
    const candidates = groups.filter((g) => !seedIds.has(g.groupId) && PROMO_NAME_PATTERN.test(g.name));
    run.summary.ignored = groups.length - candidates.length - seedIds.size;
    const eligibleAll: { groupId: number; name: string }[] = [];
    for (const g of candidates) {
      try {
        const r = await this.evaluateGroup(g, liveSets, now, firstSeen);
        if (r.verdict === 'eligible') eligibleAll.push({ groupId: g.groupId, name: g.name });
        else if (r.verdict === 'quarantine') {
          run.quarantined.push({ groupId: g.groupId, name: g.name, reasons: r.reasons });
          if (r.reasons.length === 1 && r.reasons[0] === 'live_unverifiable') continue; // transitorio: se reporta, no se audita
          await this.auditQuarantine(g.groupId, g.name, r.reasons);
        } else run.summary.ignored += 1;
      } catch (e) {
        run.summary.ignored += 1; // grupo ilegible o demasiado grande: no se importa, no aborta
        this.logger.warn(`discovery: grupo ${g.groupId} no evaluable (${(e as Error).message}); se ignora.`);
      }
    }
    // Tope de seguridad: maximo N grupos NUEVOS por corrida (los ya importados se siguen actualizando).
    const existing = await this.prisma.cardSet.findMany({
      where: { externalId: { in: eligibleAll.map((g) => tcgcsvSetExternalId(g.groupId)) } },
      select: { externalId: true },
    });
    const have = new Set(existing.map((e) => e.externalId));
    let fresh = 0;
    for (const g of eligibleAll) {
      const isNew = !have.has(tcgcsvSetExternalId(g.groupId));
      if (isNew) {
        if (fresh >= MAX_NEW_GROUPS_PER_RUN) continue;
        fresh += 1;
      }
      run.eligible.push(g);
    }
    run.summary.eligible = eligibleAll.length;
    run.summary.quarantined = run.quarantined.length;
    return run;
  }

  /** `AuditLog catalog.tcgcsv_group_quarantined`: UNA vez por (grupo, motivos) nuevo, no por corrida. */
  private async auditQuarantine(groupId: number, name: string, reasons: string[]): Promise<void> {
    if (!this.audit) return;
    const key = `${groupId}:${[...reasons].sort().join(',')}`;
    try {
      const seen = await this.prisma.auditLog.findFirst({ where: { action: 'catalog.tcgcsv_group_quarantined', entityId: key }, select: { id: true } });
      if (seen) return;
      await this.audit.log({
        action: 'catalog.tcgcsv_group_quarantined',
        entityType: 'TcgcsvGroup',
        entityId: key,
        after: { metadata: { groupId, name, reasons } },
      });
    } catch (e) {
      this.logger.warn(`discovery: no se pudo auditar la cuarentena de ${groupId}: ${(e as Error).message}`);
    }
  }
}

