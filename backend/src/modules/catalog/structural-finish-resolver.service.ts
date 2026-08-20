import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { FinishReconciler } from './finish-reconciler.service';
import {
  TcgcsvCatalogClient,
  unionStructuralFinishesByCardNumber,
} from '../pricing/providers/tcgcsv-singles.provider';

/**
 * StructuralFinishResolverService (v1.26, ARCHITECTURE §4.24a) — resuelve la COMPOSICIÓN DE
 * VARIANTES ESTRUCTURAL de un set desde TCGCSV (fuente autoritativa) y la persiste en
 * `Card.structuralFinishes`. Se invoca como un PASO de `catalog-sync.importSet`, GATEADO a
 * first-import o `--force` (NUNCA en price-ingest).
 *
 * Algoritmo NORMATIVO (§4.24a, pasos 1-5):
 *  1. Resolver el `groupId` TCGCSV del set: `CardSet.pptSetId` si es entero (TCGplayer group ==
 *     TCGCSV group, S-D3); si no, match ÚNICO por nombre vía `listGroups()` (cacheado en memoria).
 *  2. Fetch de productos (con `extendedData.Number`) y precios (`subTypeName`, `marketPrice`).
 *  3. UNIÓN por CARTA de los `subTypeName` (keyeada por número de carta) — `unionStructuralFinishesByCardNumber`.
 *  4. Mapeo `subTypeName → Finish` (desconocido ⇒ OMITE) — dentro de la unión.
 *  5. Join número→`Card` local (ancla `tcgplayerId == productId`; si no, match ÚNICO por número),
 *     escribir `structuralFinishes` SOLO para cartas joineadas (REEMPLAZO money-safe) y llamar
 *     `FinishReconciler.reconcile(cardIds)`.
 *
 * Money-safe: una carta que NO joinea CONSERVA su valor previo (stale conservador:
 * falta-una-casilla, nunca sobra-una-falsa). Un fallo remoto/parse NO aborta el import (el llamador
 * captura); el `sync-all {force:true}` reprocesa y repara (la unión es recomputable).
 */
@Injectable()
export class StructuralFinishResolverService {
  private readonly logger = new Logger(StructuralFinishResolverService.name);
  /** Caché en memoria del mapeo `CardSet.id → groupId` TCGCSV (evita re-resolver por nombre). */
  private readonly groupIdCache = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly tcgcsv: TcgcsvCatalogClient,
    private readonly finishReconciler: FinishReconciler,
  ) {}

  /**
   * Resuelve y persiste `structuralFinishes` de las cartas del set local dado. Devuelve un resumen
   * de observabilidad (o `null` si no se pudo resolver el groupId). NO lanza por fallo remoto/parse
   * del propio fetch — el resolver es best-effort y money-safe; el llamador (`importSet`) además lo
   * envuelve en try/catch para que TCGCSV nunca tumbe una importación de catálogo.
   */
  async resolveStructuralFinishesForSet(
    localSetId: string,
  ): Promise<{ groupId: number; joined: number; updated: number; unjoined: number } | null> {
    const set = await this.prisma.cardSet.findUnique({
      where: { id: localSetId },
      select: { id: true, name: true, pptSetId: true },
    });
    if (!set) return null;

    const groupId = await this.resolveGroupId(set);
    if (groupId == null) return null;

    const [products, prices] = await Promise.all([
      this.tcgcsv.getProducts(groupId),
      this.tcgcsv.getPrices(groupId),
    ]);
    const byNumber = unionStructuralFinishesByCardNumber(products, prices);
    if (byNumber.size === 0) {
      this.logger.warn(
        `structural: grupo ${groupId} (set ${set.name}) no produjo ninguna carta con acabado ` +
          `estructural mapeable (¿S-D1/S-D2?). No se toca structuralFinishes de ninguna carta.`,
      );
      return { groupId, joined: 0, updated: 0, unjoined: 0 };
    }

    const localCards = await this.prisma.card.findMany({
      where: { setId: localSetId },
      select: { id: true, number: true, tcgplayerId: true },
    });
    // Índices para el join: por tcgplayerId (ancla) y por número normalizado (fallback ÚNICO).
    const byTcgId = new Map<string, { id: string }>();
    const byNorm = new Map<string, { id: string }[]>();
    for (const c of localCards) {
      if (c.tcgplayerId) byTcgId.set(c.tcgplayerId, c);
      const norm = normalizeCardNumber(c.number);
      const list = byNorm.get(norm);
      if (list) list.push(c);
      else byNorm.set(norm, [c]);
    }

    const touched: string[] = [];
    let joined = 0;
    let unjoined = 0;
    for (const [number, { finishes, productIds }] of byNumber) {
      // Ancla preferente: alguna de las productIds contribuyentes == Card.tcgplayerId.
      let match: { id: string } | undefined;
      for (const pid of productIds) {
        const m = byTcgId.get(String(pid));
        if (m) {
          match = m;
          break;
        }
      }
      // Fallback money-safe: match por número normalizado, SOLO si es ÚNICO (ambiguo ⇒ se omite).
      if (!match) {
        const cands = byNorm.get(normalizeCardNumber(number));
        if (cands && cands.length === 1) match = cands[0];
      }
      if (!match) {
        unjoined += 1;
        continue;
      }
      joined += 1;
      // REEMPLAZO por carta joineada (§4.24a paso 5). El reconciliador recomputa availableFinishes.
      await this.prisma.card.update({
        where: { id: match.id },
        data: { structuralFinishes: finishes },
      });
      touched.push(match.id);
    }

    await this.finishReconciler.reconcile(touched);
    this.logger.log(
      `structural: set ${set.name} (grupo ${groupId}) — joined=${joined}, updated=${touched.length}, ` +
        `unjoined=${unjoined} (conservan su valor previo, money-safe).`,
    );
    return { groupId, joined, updated: touched.length, unjoined };
  }

  /**
   * §4.24a paso 1 — Resuelve el `groupId` TCGCSV del set. `pptSetId` entero ⇒ ES el groupId (S-D3,
   * TCGplayer group == TCGCSV group). Si no es numérico ⇒ match ÚNICO por nombre normalizado contra
   * `listGroups()`. Se cachea en memoria. Devuelve `null` (con log) si no hay match ÚNICO — el
   * resolver entonces no toca ninguna carta (money-safe).
   */
  private async resolveGroupId(set: {
    id: string;
    name: string;
    pptSetId: string | null;
  }): Promise<number | null> {
    const cached = this.groupIdCache.get(set.id);
    if (cached != null) return cached;

    // S-D3: pptSetId numérico == GroupId de TCGplayer == groupId de TCGCSV.
    if (set.pptSetId && /^\d+$/.test(set.pptSetId)) {
      const groupId = parseInt(set.pptSetId, 10);
      this.groupIdCache.set(set.id, groupId);
      return groupId;
    }

    // Fallback: match por nombre normalizado. listGroups puede lanzar → el llamador captura.
    const groups = await this.tcgcsv.listGroups();
    const target = normalizeName(set.name);
    // TECHLEAD #2 — PREFERIR igualdad EXACTA de nombre normalizado: evita que un substring "único"
    // pero equivocado gane (p. ej. "Base" ⊂ "Base Set 2"). Solo si NO hay match exacto se cae al
    // comportamiento previo de substring bidireccional ÚNICO (el guard `length === 1` sigue: ambiguo ⇒
    // null ⇒ no se toca ninguna carta, money-safe).
    const exact = groups.filter((g) => normalizeName(g.name) === target);
    if (exact.length === 1) {
      this.groupIdCache.set(set.id, exact[0].groupId);
      return exact[0].groupId;
    }
    const matches =
      exact.length === 0
        ? groups.filter((g) => {
            const gn = normalizeName(g.name);
            return gn.includes(target) || target.includes(gn);
          })
        : exact; // exact.length > 1 ⇒ ambiguo por nombre exacto ⇒ cae al guard de abajo (null).
    if (matches.length === 1) {
      this.groupIdCache.set(set.id, matches[0].groupId);
      return matches[0].groupId;
    }
    this.logger.warn(
      `structural: no se resolvió un groupId ÚNICO para "${set.name}" (${matches.length} candidatos ` +
        `por nombre; pptSetId="${set.pptSetId ?? ''}"). No se toca structuralFinishes (money-safe).`,
    );
    return null;
  }
}

/**
 * Normaliza un número de carta para el join TCGCSV↔local: toma la parte antes de `/` (TCGCSV lo da
 * como `"057/191"`), y si es puro-numérico colapsa los ceros a la izquierda (`"057"→"57"`). Los
 * números con prefijo (`"TG12"`, `"SV107"`) se conservan en mayúsculas. Robusto a que pokemontcg.io
 * guarde `"57"` y TCGCSV `"057/191"` para la misma carta.
 */
export function normalizeCardNumber(raw: string): string {
  const beforeSlash = (raw ?? '').split('/')[0].trim();
  if (/^\d+$/.test(beforeSlash)) return String(parseInt(beforeSlash, 10));
  return beforeSlash.toUpperCase();
}

/** Normaliza un nombre de set/grupo para el match: minúsculas, solo alfanuméricos. */
export function normalizeName(raw: string): string {
  return (raw ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
