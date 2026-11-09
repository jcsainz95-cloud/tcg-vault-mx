import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { normalizeMatchText } from '../../common/card-version';
import { TcgcsvCatalogClient } from '../pricing/providers/tcgcsv-singles.provider';
import { AuditService } from '../audit/audit.service';
import { normalizeCardNumber } from './card-product-resolver.service';
import { tcgcsvSetExternalId } from './tcgcsv-card-name';
import { TCGCSV_IMPORTABLE_GROUPS } from './tcgcsv-importable-groups';
import { evaluateDiscoveryGroup, MAX_NEW_GROUPS_PER_RUN, PROMO_NAME_PATTERN } from './tcgcsv-group-discovery';

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
  ) {}

  /** `evaluate(groupId)` del contrato: veredicto de UN grupo contra la lista viva. */
  async evaluate(groupId: number, liveSets: { id: string; name: string }[], now = new Date()) {
    const groups = await this.tcgcsv.listGroups();
    const group = groups.find((g) => g.groupId === groupId);
    if (!group) return { verdict: 'ignore' as const, reasons: ['group_unknown'] };
    return this.evaluateGroup(group, liveSets, now);
  }

  private async evaluateGroup(group: { groupId: number; name: string; publishedOn?: string }, liveSets: { id: string; name: string }[], now: Date) {
    const products = await this.tcgcsv.getCardProducts(group.groupId);
    return evaluateDiscoveryGroup({
      group,
      products: products.map((p) => ({ name: p.name, number: p.number })),
      liveSets,
      maxContentMatch: await this.maxContentMatch(products),
      now,
    });
  }

  /** Mayor fraccion de productos que coincide (nombre+numero) con las cartas de UN mismo set local no-TCGCSV. */
  private async maxContentMatch(products: { name: string; number: string | null }[]): Promise<number> {
    const numbered = products.filter((p) => (p.number ?? '').trim() !== '');
    if (numbered.length === 0) return 0;
    const cards = await this.prisma.card.findMany({
      where: { name: { in: [...new Set(numbered.map((p) => p.name))].slice(0, 800) }, NOT: { set: { externalId: { startsWith: 'tcgcsv:' } } } },
      select: { name: true, number: true, setId: true },
    });
    const bySet = new Map<string, Set<string>>();
    for (const c of cards) {
      const k = `${normalizeMatchText(c.name)}|${normalizeCardNumber(c.number)}`;
      const s = bySet.get(c.setId) ?? new Set<string>();
      s.add(k);
      bySet.set(c.setId, s);
    }
    let best = 0;
    for (const keys of bySet.values()) {
      const hit = numbered.filter((p) => keys.has(`${normalizeMatchText(p.name)}|${normalizeCardNumber(p.number ?? '')}`)).length;
      best = Math.max(best, hit / numbered.length);
    }
    return best;
  }

  async discover(liveSets: { id: string; name: string }[], now = new Date()): Promise<DiscoveryRun> {
    const run: DiscoveryRun = { eligible: [], quarantined: [], summary: { scanned: 0, eligible: 0, quarantined: 0, ignored: 0 } };
    if (!Array.isArray(liveSets) || liveSets.length === 0) return run; // fail-closed
    const groups = await this.tcgcsv.listGroups();
    run.summary.scanned = groups.length;
    const seedIds = new Set(TCGCSV_IMPORTABLE_GROUPS.map((g) => g.groupId));
    const candidates = groups.filter((g) => !seedIds.has(g.groupId) && PROMO_NAME_PATTERN.test(g.name));
    run.summary.ignored = groups.length - candidates.length - seedIds.size;
    const eligibleAll: { groupId: number; name: string }[] = [];
    for (const g of candidates) {
      try {
        const r = await this.evaluateGroup(g, liveSets, now);
        if (r.verdict === 'eligible') eligibleAll.push({ groupId: g.groupId, name: g.name });
        else if (r.verdict === 'quarantine') {
          run.quarantined.push({ groupId: g.groupId, name: g.name, reasons: r.reasons });
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

