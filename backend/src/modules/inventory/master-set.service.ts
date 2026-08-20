import { Injectable } from '@nestjs/common';
import { Finish, InventoryStatus, Prisma, ProductType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { PricingService } from '../pricing/pricing.service';
import { computeSalePriceForRarity } from '../../common/money';
import { CARD_ORDER_BY_IN_SET, FINISH_ORDER, computeDisplayFinishes } from '../../common/card-order';

/**
 * MasterSetService (v1.16-master-set §4.17a · v1.20-master-set-everywhere §4.20a) — read model
 * ÚNICO de "contenido agrupado por set y por acabado", parametrizado por SCOPE:
 *  - `platform`   → inventario de PLATAFORMA (M1, regla on-hand v1.16 intacta).
 *  - `user_vault` → bóveda de UN usuario (ownerType='customer' AND ownerUserId=:userId, ambas
 *                   titularidades pending|settled, mismo filtro de status en bóveda).
 * Dos superficies, MISMO shape en los tres consumidores (M1 / admin-bóveda-cliente / Mi bóveda):
 *  - `index()`  → índice de sets con completitud/piezas + contadores por VARIANTE.
 *  - `binder()` → cuadrícula por número con countsByFinish + `variants[]`, ORDEN NATURAL.
 *
 * v1.20 — completitud por VARIANTE (carta+acabado): el universo esperado por carta =
 * `Card.availableFinishes` (histórico/vacío → ['normal']); los contadores «X/Y» cuentan variantes.
 * DRIFT: una pieza cuyo finish ya no está en availableFinishes se ve en countsByFinish pero NO
 * cuenta en expected/covered (evita covered > expected). Omisiones por scope (regla dura §4.20a):
 * este shape NUNCA expone ubicaciones/costos/folios; `owner` solo en user_vault (email solo vista
 * admin); `buyable` solo en la vista (iii) del propio cliente.
 *
 * Consultas FIJAS (sin N+1), patrón `set-value.service.ts`: queries en lote + agregación en memoria.
 */

/** "on-hand"/"en bóveda" = status NOT IN estos (ARCHITECTURE §4.17a/§4.20a, API_CONTRACT §DTOs). */
export const NOT_ON_HAND: InventoryStatus[] = [
  'withdrawn',
  'shipped',
  'delivered',
  'lost',
  'damaged',
];

/**
 * v1.22 — el ORDEN CANONICO (de acabados y de numeros) vive en `common/card-order.ts`: UN solo
 * algoritmo compartido por el sync (que ESCRIBE `numberSort`/`numberPrefix`), por el `orderBy` de
 * la BD y por los seeds (ARCHITECTURE 4.22b). Se re-exporta aqui por compatibilidad de imports.
 */
export {
  FINISH_ORDER,
  PROMO_SORT_BASE,
  deriveNumberParts,
  compareByNumber,
} from '../../common/card-order';

/** Alcance de la agregación (ARCHITECTURE §4.20a). Solo cambia el WHERE, nunca el shape. */
export type MasterSetQueryScope = { kind: 'platform' } | { kind: 'user_vault'; userId: string };

/** Opciones de vista (omisiones por scope §4.20a): email solo vista (ii); buyable solo vista (iii). */
export interface MasterSetViewOptions {
  includeOwnerEmail?: boolean;
  includeBuyable?: boolean;
}

export interface VaultOwnerRefDTO {
  userId: string;
  name: string;
  email?: string;
}

/**
 * v1.20 — variante = (carta, acabado) del UNIVERSO `Card.availableFinishes`. `covered` = ≥1 pieza
 * en el scope. `buyable` SOLO scope cliente y SOLO cuando covered=false: la pieza `listed` de
 * plataforma MÁS BARATA de ese (cardId, finish), o null si no hay nada publicado.
 */
export interface MasterSetVariantDTO {
  finish: Finish;
  count: number;
  covered: boolean;
  // v1.22-2 / N-16 (§4.22a-6): espejo de conveniencia para el render PLANO — `= finish ∈
  // cell.displayFinishes`. Las variantes `displayed=false` (acabado espurio suprimido) NO se pintan
  // pero SIGUEN contando para completitud (X/Y) y buyable (universo = availableFinishes, intacto).
  displayed: boolean;
  buyable?: { inventoryItemId: string; salePriceCents: number } | null;
}

export interface MasterSetSummaryDTO {
  setId: string;
  name: string;
  series?: string;
  releaseDate?: string;
  year?: number;
  printedTotal?: number;
  catalogCardCount: number;
  distinctCardsOwned: number;
  completionPct: number | null;
  totalPieces: number;
  // v1.20 — contadores por VARIANTE (los «X/Y» de UI usan ESTOS, no los de carta).
  catalogVariantCount: number;
  distinctVariantsOwned: number;
  variantCompletionPct: number | null;
}

export interface MasterSetIndexResponse {
  data: MasterSetSummaryDTO[];
  page: number;
  pageSize: number;
  total: number;
  // v1.20 — scope de la agregación + dueño (solo user_vault; email solo vista admin).
  scope: MasterSetQueryScope['kind'];
  owner?: VaultOwnerRefDTO;
}

export interface SetRefDTO {
  id: string;
  name: string;
  series?: string;
  releaseDate?: string;
}

export interface MasterSetCardCellDTO {
  cardId: string;
  number: string;
  // v1.22 (M-26): claves PERSISTIDAS del orden natural. `numberSort` SOLO no basta para re-ordenar
  // en el front (`TG12` y `GG12` colisionan en 1000012) -> el contrato anade `numberPrefix`.
  numberSort: number;
  numberPrefix: string;
  name: string;
  rarity?: string;
  imageSmallUrl?: string;
  availableFinishes: Finish[];
  // v1.22-2 / N-15 (§4.22a-6): subconjunto DISPLAY-only de availableFinishes que el front PINTA
  // (oculta el acabado espurio de una premium de 1 impresión). ⊆ availableFinishes, orden
  // FINISH_ORDER, nunca vacío. NO cambia la completitud X/Y (que cuenta sobre availableFinishes).
  displayFinishes: Finish[];
  countsByFinish: { finish: Finish; count: number }[];
  totalCount: number;
  isSecretRare: boolean;
  // v1.20 — completitud por variante de ESTA carta (universo = availableFinishes; drift fuera).
  expectedVariantCount: number;
  coveredVariantCount: number;
  variants: MasterSetVariantDTO[];
  // v1.26 (P-2, §M1 / §4.24d) — precio de MERCADO de la carta = la `PriceReference` CRUDA del
  // acabado BASE (raw:NM, primer acabado del universo), FX-recomputada al MXN vigente (misma lógica
  // `liveMxnCents` que valúa la bóveda). NO es el precio de VENTA derivado (referencia × (1+markup));
  // ese vive en `buyable.salePriceCents` para la vista cliente. `null` cuando la referencia está
  // `pending`/ausente (no se inventa un 0). ADITIVO/opcional; solo lectura/visual (no toca SEC-A1).
  // Batched (getReferencesBatch) — sin N+1.
  marketReferenceMxnCents?: number | null;
}

export interface MasterSetBinderResponse {
  set: SetRefDTO;
  printedTotal: number | null;
  catalogCardCount: number;
  cells: MasterSetCardCellDTO[];
  // v1.20 — scope + dueño (solo user_vault; email solo vista admin).
  scope: MasterSetQueryScope['kind'];
  owner?: VaultOwnerRefDTO;
}

/** Deriva el año del set desde `releaseDate` (`yyyy/MM/dd` de pokemontcg.io). */
export function yearFromReleaseDate(releaseDate?: string | null): number | undefined {
  if (!releaseDate) return undefined;
  const m = /^(\d{4})/.exec(releaseDate);
  return m ? parseInt(m[1], 10) : undefined;
}

/**
 * v1.20 — universo de variantes esperadas de una carta: `Card.availableFinishes` en el orden del
 * enum Finish; filas históricas/sin datos (array vacío o null) → ['normal'] (API_CONTRACT §DTOs).
 */
export function expectedFinishes(available: Finish[] | null | undefined): Finish[] {
  const arr = available ?? [];
  if (arr.length === 0) return ['normal'];
  return FINISH_ORDER.filter((f) => arr.includes(f));
}

@Injectable()
export class MasterSetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
  ) {}

  /**
   * Índice de sets con resumen agregado, por SCOPE. SIN N+1: 4 queries fijas (sets q-filtrados +
   * `Card.groupBy` de catalogCardCount + 1 agregación raw de Σ|availableFinishes| por set + 1
   * agregación raw de piezas/distinct cartas/distinct VARIANTES por set). La agregación cubre TODOS
   * los sets que hacen match con `q` para permitir el `sort` global; sigue O(1) queries.
   * En scope `user_vault` el índice devuelve SOLO sets con ≥1 pieza del usuario (API_CONTRACT §3).
   */
  async index(
    q: { q?: string; page: number; pageSize: number; sort: string },
    scope: MasterSetQueryScope = { kind: 'platform' },
    opts: MasterSetViewOptions = {},
  ): Promise<MasterSetIndexResponse> {
    // 404 temprano si el userId del scope no existe (vista (ii) admin). Vista (iii): siempre yo.
    const owner = await this.resolveOwner(scope, opts);

    const sets = await this.prisma.cardSet.findMany({
      where: q.q ? { name: { contains: q.q, mode: 'insensitive' } } : {},
      select: { id: true, name: true, series: true, releaseDate: true, printedTotal: true },
    });
    const setIds = sets.map((s) => s.id);

    const grouped = setIds.length
      ? await this.prisma.card.groupBy({
          by: ['setId'],
          where: { setId: { in: setIds } },
          _count: { _all: true },
        })
      : [];
    const catalogBySet = new Map<string, number>(grouped.map((g) => [g.setId, g._count._all]));

    const variantsBySet = await this.aggregateCatalogVariantsBySet(setIds);
    const agg = await this.aggregateInventoryBySet(setIds, scope);

    let rows: MasterSetSummaryDTO[] = sets.map((s) => {
      const catalogCardCount = catalogBySet.get(s.id) ?? 0;
      const catalogVariantCount = variantsBySet.get(s.id) ?? 0;
      const a = agg.get(s.id) ?? { pieces: 0, distinctCards: 0, distinctVariants: 0 };
      const completionPct =
        catalogCardCount === 0
          ? null
          : Math.round((a.distinctCards / catalogCardCount) * 10000) / 100;
      const variantCompletionPct =
        catalogVariantCount === 0
          ? null
          : Math.round((a.distinctVariants / catalogVariantCount) * 10000) / 100;
      return {
        setId: s.id,
        name: s.name,
        series: s.series ?? undefined,
        releaseDate: s.releaseDate ?? undefined,
        year: yearFromReleaseDate(s.releaseDate),
        printedTotal: s.printedTotal ?? undefined,
        catalogCardCount,
        distinctCardsOwned: a.distinctCards,
        completionPct,
        totalPieces: a.pieces,
        catalogVariantCount,
        distinctVariantsOwned: a.distinctVariants,
        variantCompletionPct,
      };
    });

    // Vista de bóveda: solo sets con ≥1 pieza del usuario (el catálogo entero como índice es ruido;
    // la completitud contra el catálogo se ve al abrir el binder de un set, §4.20a).
    if (scope.kind === 'user_vault') rows = rows.filter((r) => r.totalPieces > 0);

    rows = this.sortSummaries(rows, q.sort);
    const total = rows.length;
    const start = (q.page - 1) * q.pageSize;
    const data = rows.slice(start, start + q.pageSize);
    return {
      data,
      page: q.page,
      pageSize: q.pageSize,
      total,
      scope: scope.kind,
      ...(owner ? { owner } : {}),
    };
  }

  /** Ordena el índice según `sort` (release_desc default | completion_asc | pieces_desc). */
  private sortSummaries(rows: MasterSetSummaryDTO[], sort: string): MasterSetSummaryDTO[] {
    const byRelease = (a: MasterSetSummaryDTO, b: MasterSetSummaryDTO) =>
      (b.releaseDate ?? '').localeCompare(a.releaseDate ?? '');
    if (sort === 'completion_asc') {
      return [...rows].sort((a, b) => {
        const av = a.completionPct ?? Number.POSITIVE_INFINITY; // null (sin catálogo) al final
        const bv = b.completionPct ?? Number.POSITIVE_INFINITY;
        return av - bv || byRelease(a, b);
      });
    }
    if (sort === 'pieces_desc') {
      return [...rows].sort((a, b) => b.totalPieces - a.totalPieces || byRelease(a, b));
    }
    return [...rows].sort(byRelease); // release_desc (default)
  }

  /**
   * v1.20 — resuelve el `owner` del scope (`user_vault` → { userId, name, email? }; email SOLO en
   * la vista admin (ii)). 404 si el usuario del scope no existe (API_CONTRACT §M1 v1.20).
   */
  private async resolveOwner(
    scope: MasterSetQueryScope,
    opts: MasterSetViewOptions,
  ): Promise<VaultOwnerRefDTO | null> {
    if (scope.kind !== 'user_vault') return null;
    const user = await this.prisma.user.findUnique({
      where: { id: scope.userId },
      select: { id: true, name: true, email: true },
    });
    if (!user) throw BusinessException.notFound('NOT_FOUND', 'User not found');
    return {
      userId: user.id,
      name: user.name,
      ...(opts.includeOwnerEmail ? { email: user.email } : {}),
    };
  }

  /** WHERE Prisma del scope (mismo filtro de status "en bóveda"/on-hand en ambos). */
  private scopeWhere(scope: MasterSetQueryScope): Prisma.InventoryItemWhereInput {
    return scope.kind === 'platform'
      ? { ownerType: 'platform', status: { notIn: NOT_ON_HAND } }
      : { ownerType: 'customer', ownerUserId: scope.userId, status: { notIn: NOT_ON_HAND } };
  }

  /** Fragmento SQL del scope para las agregaciones raw (alias `ii` = InventoryItem). */
  private scopeSql(scope: MasterSetQueryScope): Prisma.Sql {
    return scope.kind === 'platform'
      ? Prisma.sql`ii."ownerType" = 'platform'`
      : Prisma.sql`ii."ownerType" = 'customer' AND ii."ownerUserId" = ${scope.userId}`;
  }

  /**
   * v1.20 — UNA agregación raw sobre `Card`: Σ|availableFinishes| por set (denominador de la
   * completitud por variante). Filas con array vacío cuentan 1 (universo histórico = ['normal']).
   */
  private async aggregateCatalogVariantsBySet(setIds: string[]): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (setIds.length === 0) return map;
    const rows = await this.prisma.$queryRaw<{ setId: string; variantCount: bigint }[]>(Prisma.sql`
      SELECT "setId" AS "setId",
             SUM(COALESCE(array_length("availableFinishes", 1), 1))::bigint AS "variantCount"
      FROM "Card"
      WHERE "setId" IN (${Prisma.join(setIds)})
      GROUP BY "setId"
    `);
    for (const r of rows) map.set(r.setId, Number(r.variantCount));
    return map;
  }

  /**
   * UNA agregación cruzada `InventoryItem ⋈ Card` (raw SQL) por SCOPE → piezas totales + cartas
   * distintas + VARIANTES distintas del universo (v1.20: solo cuentan las (cardId, finish) cuyo
   * finish ∈ availableFinishes; array vacío → universo ['normal']; el drift queda fuera del
   * numerador). 1 query por request (no por set). Vacío → Map vacío.
   */
  private async aggregateInventoryBySet(
    setIds: string[],
    scope: MasterSetQueryScope,
  ): Promise<Map<string, { pieces: number; distinctCards: number; distinctVariants: number }>> {
    const map = new Map<
      string,
      { pieces: number; distinctCards: number; distinctVariants: number }
    >();
    if (setIds.length === 0) return map;
    const rows = await this.prisma.$queryRaw<
      { setId: string; pieces: bigint; distinctCards: bigint; distinctVariants: bigint }[]
    >(Prisma.sql`
      SELECT c."setId" AS "setId",
             COUNT(*)::bigint AS pieces,
             COUNT(DISTINCT ii."cardId")::bigint AS "distinctCards",
             COUNT(DISTINCT CASE
               WHEN ii."finish" = ANY(c."availableFinishes")
                 OR (COALESCE(array_length(c."availableFinishes", 1), 0) = 0
                     AND ii."finish" = 'normal')
               THEN ii."cardId" || '|' || ii."finish"::text
             END)::bigint AS "distinctVariants"
      FROM "InventoryItem" ii
      JOIN "Card" c ON c.id = ii."cardId"
      WHERE ${this.scopeSql(scope)}
        -- [BE-46] Lista on-hand interpolada desde NOT_ON_HAND (fuente única de verdad, misma que
        -- scopeWhere/admin-vaults); el ::text castea el enum para comparar con los parámetros.
        AND ii.status::text NOT IN (${Prisma.join(NOT_ON_HAND)})
        AND c."setId" IN (${Prisma.join(setIds)})
      GROUP BY c."setId"
    `);
    for (const r of rows) {
      map.set(r.setId, {
        pieces: Number(r.pieces),
        distinctCards: Number(r.distinctCards),
        distinctVariants: Number(r.distinctVariants),
      });
    }
    return map;
  }

  /**
   * Binder del set por SCOPE: una celda por Card del catálogo del set, en ORDEN NATURAL por número,
   * con `variants[]` (v1.20, universo = availableFinishes). SIN N+1: (1) Card WHERE setId; (2) UNA
   * agregación `groupBy [cardId, finish]` de piezas del scope → countsByFinish; (3) si la vista es
   * la del cliente (`includeBuyable`), UNA resolución en lote de faltantes comprables. Los filtros
   * locales (rareza/acabado/faltantes/secret) los aplica el frontend. 404 si no existe el set.
   * `:setId` = id LOCAL del CardSet. El binder de `user_vault` funciona para CUALQUIER set del
   * catálogo (las celdas/variantes sin piezas son los faltantes del usuario).
   */
  async binder(
    setId: string,
    scope: MasterSetQueryScope = { kind: 'platform' },
    opts: MasterSetViewOptions = {},
  ): Promise<MasterSetBinderResponse> {
    const set = await this.prisma.cardSet.findUnique({ where: { id: setId } });
    if (!set) throw BusinessException.notFound();

    const owner = await this.resolveOwner(scope, opts);

    const cards = await this.prisma.card.findMany({
      where: { setId },
      select: {
        id: true,
        number: true,
        name: true,
        rarity: true,
        imageSmallUrl: true,
        availableFinishes: true,
        // v1.22 (M-26): se LEEN de la columna; ya no se derivan en memoria (ARCHITECTURE 4.22b).
        numberSort: true,
        numberPrefix: true,
      },
      // v1.22: el ORDEN NATURAL lo aplica la BASE DE DATOS con el mismo `orderBy` normativo de
      // `GET /buylist/cards?setId=` (indice `(setId, numberPrefix, numberSort)`), en vez del
      // `.sort(compareByNumber)` en memoria. UN solo algoritmo, una sola fuente del orden.
      orderBy: CARD_ORDER_BY_IN_SET,
    });
    const cardIds = cards.map((c) => c.id);

    const grouped = cardIds.length
      ? await this.prisma.inventoryItem.groupBy({
          by: ['cardId', 'finish'],
          where: { cardId: { in: cardIds }, ...this.scopeWhere(scope) },
          _count: { _all: true },
        })
      : [];

    const countsByCard = new Map<string, { finish: Finish; count: number }[]>();
    for (const g of grouped) {
      const list = countsByCard.get(g.cardId) ?? [];
      list.push({ finish: g.finish, count: g._count._all });
      countsByCard.set(g.cardId, list);
    }

    // v1.22-2 / N-15 (§4.22a-6): acabados priceados por carta EN LOTE (sin N+1) para displayFinishes.
    const pricedByCard = await this.pricing.getPricedRawFinishesBatch(cardIds);

    // v1.26 (P-2, §4.24d): referencia de MERCADO por carta EN LOTE (sin N+1). La clave es el acabado
    // BASE de la carta (primer acabado del universo availableFinishes → normal en el caso común, o el
    // premium en una carta de una sola impresión). raw:NM (la referencia de MERCADO cruda de la
    // carta). `getReferencesBatch` YA aplica `liveMxnCents` (FX-recompute a MXN vigente). UNA query.
    const baseFinishOf = (c: (typeof cards)[number]): Finish =>
      expectedFinishes(c.availableFinishes as Finish[])[0];
    const marketRefs = await this.pricing.getReferencesBatch(
      cards.map((c) => ({
        cardId: c.id,
        productType: 'raw' as ProductType,
        gradeKey: 'raw:NM',
        finish: baseFinishOf(c),
      })),
    );

    const printedTotal = set.printedTotal ?? null;
    const cells: MasterSetCardCellDTO[] = cards
      .map((c) => {
        const byFinish = (countsByCard.get(c.id) ?? []).sort((a, b) =>
          a.finish < b.finish ? -1 : a.finish > b.finish ? 1 : 0,
        );
        const totalCount = byFinish.reduce((s, x) => s + x.count, 0);
        // v1.20 — universo de variantes esperado (histórico → ['normal']). El drift (piezas con
        // finish FUERA del universo) queda visible en countsByFinish pero no en variants/covered.
        const universe = expectedFinishes(c.availableFinishes as Finish[]);
        // v1.22-2 / N-15 (§4.22a-6): displayFinishes ⊆ availableFinishes (oculta el espurio de una
        // premium de 1 impresión); `displayed` marca por variante si el front la PINTA. La completitud
        // (expected/covered) SIGUE contando sobre el universo `availableFinishes`, sin cambio.
        const displayFinishes = computeDisplayFinishes(
          c.rarity,
          c.availableFinishes as Finish[],
          pricedByCard.get(c.id) ?? [],
        );
        const displaySet = new Set<Finish>(displayFinishes);
        const variants: MasterSetVariantDTO[] = universe.map((finish) => {
          const count = byFinish.find((x) => x.finish === finish)?.count ?? 0;
          return { finish, count, covered: count > 0, displayed: displaySet.has(finish) };
        });
        // v1.26 (P-2): precio de MERCADO (referencia cruda del acabado base, ya FX-recomputada a MXN
        // por getReferencesBatch). null si la referencia está pending/ausente (nunca un 0 inventado).
        const mref = marketRefs.get(`${c.id}|raw|raw:NM|${universe[0]}`);
        const marketReferenceMxnCents =
          mref && mref.status === 'priced' ? (mref.referenceMxnCents ?? null) : null;
        return {
          cardId: c.id,
          number: c.number,
          numberSort: c.numberSort,
          numberPrefix: c.numberPrefix,
          name: c.name,
          rarity: c.rarity ?? undefined,
          imageSmallUrl: c.imageSmallUrl ?? undefined,
          availableFinishes: (c.availableFinishes ?? ['normal']) as Finish[],
          displayFinishes,
          countsByFinish: byFinish,
          totalCount,
          // isSecretRare — heurística de DISPLAY (API_CONTRACT §M1 v1.16.1 / ARCHITECTURE §4.17a,
          // BE-36). Secret rare REAL = numeración PRINCIPAL (número puramente numérico, sin prefijo
          // alfabético) con entero > printedTotal. Los promos/subsets (TG/GG/SV, con prefijo) NO
          // cuentan aunque su `numberSort` (PROMO_SORT_BASE + n) supere printedTotal; printedTotal
          // nulo → false.
          // v1.22: mismas dos claves, leidas de las COLUMNAS (para un numero puro `numberSort` ES
          // el entero, asi que la heuristica no cambia de semantica).
          isSecretRare: printedTotal != null && c.numberPrefix === '' && c.numberSort > printedTotal,
          expectedVariantCount: universe.length,
          coveredVariantCount: variants.filter((v) => v.covered).length,
          variants,
          marketReferenceMxnCents,
        };
      });

    // v1.20 §4.20d — faltantes comprables, SOLO vista (iii) del cliente: para cada variante
    // covered=false, la pieza `listed` de plataforma MÁS BARATA de ese (cardId, finish), o null.
    if (opts.includeBuyable) {
      const missing: { cardId: string; finish: Finish }[] = [];
      for (const cell of cells) {
        for (const v of cell.variants) {
          if (!v.covered) missing.push({ cardId: cell.cardId, finish: v.finish });
        }
      }
      const buyables = await this.resolveBuyables(missing);
      for (const cell of cells) {
        cell.variants = cell.variants.map((v) =>
          v.covered ? v : { ...v, buyable: buyables.get(`${cell.cardId}|${v.finish}`) ?? null },
        );
      }
    }

    return {
      set: {
        id: set.id,
        name: set.name,
        series: set.series ?? undefined,
        releaseDate: set.releaseDate ?? undefined,
      },
      printedTotal,
      catalogCardCount: cards.length,
      cells,
      scope: scope.kind,
      ...(owner ? { owner } : {}),
    };
  }

  /**
   * v1.20 §4.20d — resuelve en LOTE la pieza `listed` de plataforma MÁS BARATA por (cardId, finish)
   * para las variantes faltantes del binder del cliente. Precio con el MISMO criterio de la ficha
   * (§4.9): `listPriceCents` override manual o derivado de las reglas de venta por rareza+acabado
   * (§4.14, SEC-A1). Si el precio no resuelve (pct sin market) esa pieza NO es buyable. SIN N+1:
   * 1 findMany de listadas + reglas izadas UNA vez + 1 lote de referencias (getReferencesBatch).
   * El binder NO crea órdenes ni reservas: el CTA lleva a la ficha/checkout normal.
   */
  private async resolveBuyables(
    pairs: { cardId: string; finish: Finish }[],
  ): Promise<Map<string, { inventoryItemId: string; salePriceCents: number }>> {
    const map = new Map<string, { inventoryItemId: string; salePriceCents: number }>();
    if (pairs.length === 0) return map;
    const wanted = new Set(pairs.map((p) => `${p.cardId}|${p.finish}`));
    const listed = await this.prisma.inventoryItem.findMany({
      where: {
        ownerType: 'platform',
        status: 'listed',
        cardId: { in: [...new Set(pairs.map((p) => p.cardId))] },
      },
      include: { card: true },
    });
    const candidates = listed.filter((i) => wanted.has(`${i.cardId}|${i.finish}`));
    if (candidates.length === 0) return map;

    const { rules, fallbackPct } = await this.pricing.loadSalesRules();
    const refs = await this.pricing.getReferencesBatch(
      candidates
        .filter((i) => i.listPriceCents == null)
        .map((i) => ({
          cardId: i.cardId,
          productType: i.productType,
          gradeKey: this.pricing.gradeKeyFor(i),
          finish: i.finish,
        })),
    );

    for (const item of candidates) {
      let salePriceCents: number | null;
      if (item.listPriceCents != null) {
        salePriceCents = item.listPriceCents; // override manual gana siempre (§4.9)
      } else {
        const gradeKey = this.pricing.gradeKeyFor(item);
        const ref = refs.get(`${item.cardId}|${item.productType}|${gradeKey}|${item.finish}`);
        const refCents = ref && ref.status === 'priced' ? (ref.referenceMxnCents ?? null) : null;
        salePriceCents = computeSalePriceForRarity(
          item.card.rarity,
          item.finish,
          refCents,
          rules,
          fallbackPct,
        ).salePriceCents;
      }
      // Sin precio resoluble (>0) → no comprable (paridad con `sellable` de la ficha §4.9).
      if (salePriceCents == null || salePriceCents <= 0) continue;
      const key = `${item.cardId}|${item.finish}`;
      const prev = map.get(key);
      if (!prev || salePriceCents < prev.salePriceCents) {
        map.set(key, { inventoryItemId: item.id, salePriceCents });
      }
    }
    return map;
  }
}
