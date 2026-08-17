import { Injectable } from '@nestjs/common';
import { Finish, InventoryStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';

/**
 * MasterSetService (v1.16-master-set, ARCHITECTURE §4.17a) — LECTURA AGREGADA del inventario
 * (binder por set) encima del modelo por-pieza SIN cambiarlo. Dos superficies:
 *  - `index()`   → índice de sets con completitud/piezas (MasterSetSummaryDTO).
 *  - `binder()`  → cuadrícula por número con countsByFinish (MasterSetCardCellDTO), ORDEN NATURAL.
 *
 * Consultas FIJAS (sin N+1), patrón `set-value.service.ts`: 2–3 queries en lote + agregación en
 * memoria. Solo inventario de PLATAFORMA (back-office); "on-hand" excluye piezas ya salidas/perdidas.
 */

/** "on-hand" = ownerType 'platform' AND status NOT IN estos (ARCHITECTURE §4.17a, API_CONTRACT §DTOs). */
export const NOT_ON_HAND: InventoryStatus[] = [
  'withdrawn',
  'shipped',
  'delivered',
  'lost',
  'damaged',
];

/** Base de orden para números NO-puros-numéricos (promos/subsets tipo TG/GG/SV) → van al FINAL. */
const PROMO_SORT_BASE = 1_000_000;

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
}

export interface MasterSetIndexResponse {
  data: MasterSetSummaryDTO[];
  page: number;
  pageSize: number;
  total: number;
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
  numberSort: number;
  name: string;
  rarity?: string;
  imageSmallUrl?: string;
  availableFinishes: Finish[];
  countsByFinish: { finish: Finish; count: number }[];
  totalCount: number;
  isSecretRare: boolean;
}

export interface MasterSetBinderResponse {
  set: SetRefDTO;
  printedTotal: number | null;
  catalogCardCount: number;
  cells: MasterSetCardCellDTO[];
}

/** Deriva el año del set desde `releaseDate` (`yyyy/MM/dd` de pokemontcg.io). */
export function yearFromReleaseDate(releaseDate?: string | null): number | undefined {
  if (!releaseDate) return undefined;
  const m = /^(\d{4})/.exec(releaseDate);
  return m ? parseInt(m[1], 10) : undefined;
}

/**
 * ORDEN NATURAL (ARCHITECTURE §4.17a, obligatorio). `Card.number` es String → el orden lexicográfico
 * rompe ("10" < "2"; "TG12" mal ubicado). Deriva la clave numérica:
 *  - número PURO ("4", "10", "191") → su entero; ordena numéricamente ("10" > "2").
 *  - número con letras ("TG12", "SV107", "GG50") → PROMO_SORT_BASE + parte numérica → va al FINAL,
 *    agrupado por prefijo (desempate por prefijo alfabético y luego por su parte numérica).
 * `numberSort` se expone en el DTO para que el front re-ordene tras filtrar localmente.
 */
export function deriveNumberParts(raw: string): { numberSort: number; prefix: string; num: number } {
  if (/^\d+$/.test(raw)) {
    const n = parseInt(raw, 10);
    return { numberSort: n, prefix: '', num: n };
  }
  const digits = raw.replace(/\D/g, '');
  const num = digits === '' ? 0 : parseInt(digits, 10);
  const prefix = raw.replace(/[0-9]/g, '');
  return { numberSort: PROMO_SORT_BASE + num, prefix, num };
}

/**
 * Comparador de orden natural estable:
 *  1. las cartas PURO-numéricas van primero, ordenadas por su entero ("2" < "10" < "200");
 *  2. las cartas con prefijo (promos/subsets TG/GG/SV) van al FINAL, **agrupadas por prefijo**
 *     alfabético (GG → SV → TG), y dentro del prefijo por su parte numérica ("TG2" < "TG12");
 *  3. desempate final por el `number` crudo.
 */
export function compareByNumber(a: { number: string }, b: { number: string }): number {
  const pa = deriveNumberParts(a.number);
  const pb = deriveNumberParts(b.number);
  const promoA = pa.prefix !== '';
  const promoB = pb.prefix !== '';
  if (promoA !== promoB) return promoA ? 1 : -1; // puro-numérico antes que promo
  if (!promoA) {
    // ambos puro-numéricos → por entero
    if (pa.num !== pb.num) return pa.num - pb.num;
    return a.number < b.number ? -1 : a.number > b.number ? 1 : 0;
  }
  // ambos promos → agrupar por prefijo, luego por número
  if (pa.prefix !== pb.prefix) return pa.prefix < pb.prefix ? -1 : 1;
  if (pa.num !== pb.num) return pa.num - pb.num;
  return a.number < b.number ? -1 : a.number > b.number ? 1 : 0;
}

@Injectable()
export class MasterSetService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Índice de sets con resumen agregado (GET /admin/inventory/master-sets). SIN N+1: 3 queries fijas
   * (sets q-filtrados + `Card.groupBy` de catalogCardCount + 1 agregación raw de piezas/distinct por
   * set). La agregación cubre TODOS los sets que hacen match con `q` para permitir el `sort` global
   * (completitud/piezas), no solo la página; sigue siendo O(1) queries (patrón set-value.service).
   */
  async index(q: {
    q?: string;
    page: number;
    pageSize: number;
    sort: string;
  }): Promise<MasterSetIndexResponse> {
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

    const agg = await this.aggregateInventoryBySet(setIds);

    let rows: MasterSetSummaryDTO[] = sets.map((s) => {
      const catalogCardCount = catalogBySet.get(s.id) ?? 0;
      const a = agg.get(s.id) ?? { pieces: 0, distinctCards: 0 };
      const completionPct =
        catalogCardCount === 0
          ? null
          : Math.round((a.distinctCards / catalogCardCount) * 10000) / 100;
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
      };
    });

    rows = this.sortSummaries(rows, q.sort);
    const total = rows.length;
    const start = (q.page - 1) * q.pageSize;
    const data = rows.slice(start, start + q.pageSize);
    return { data, page: q.page, pageSize: q.pageSize, total };
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
   * UNA agregación cruzada `InventoryItem ⋈ Card` (raw SQL) → piezas totales + cartas distintas
   * on-hand de PLATAFORMA por set. 1 query por página (no por set). Vacío → Map vacío.
   */
  private async aggregateInventoryBySet(
    setIds: string[],
  ): Promise<Map<string, { pieces: number; distinctCards: number }>> {
    const map = new Map<string, { pieces: number; distinctCards: number }>();
    if (setIds.length === 0) return map;
    const rows = await this.prisma.$queryRaw<
      { setId: string; pieces: bigint; distinctCards: bigint }[]
    >(Prisma.sql`
      SELECT c."setId" AS "setId",
             COUNT(*)::bigint AS pieces,
             COUNT(DISTINCT ii."cardId")::bigint AS "distinctCards"
      FROM "InventoryItem" ii
      JOIN "Card" c ON c.id = ii."cardId"
      WHERE ii."ownerType" = 'platform'
        AND ii.status NOT IN ('withdrawn', 'shipped', 'delivered', 'lost', 'damaged')
        AND c."setId" IN (${Prisma.join(setIds)})
      GROUP BY c."setId"
    `);
    for (const r of rows) {
      map.set(r.setId, { pieces: Number(r.pieces), distinctCards: Number(r.distinctCards) });
    }
    return map;
  }

  /**
   * Binder del set (GET /admin/inventory/master-sets/:setId): una celda por Card del catálogo del
   * set, en ORDEN NATURAL por número. SIN N+1: (1) Card WHERE setId; (2) UNA agregación
   * `groupBy [cardId, finish]` de piezas on-hand → countsByFinish. Los filtros locales
   * (rareza/acabado/faltantes/secret) los aplica el frontend sobre la respuesta completa. 404 si no
   * existe el set. `:setId` = id LOCAL del CardSet.
   */
  async binder(setId: string): Promise<MasterSetBinderResponse> {
    const set = await this.prisma.cardSet.findUnique({ where: { id: setId } });
    if (!set) throw BusinessException.notFound();

    const cards = await this.prisma.card.findMany({
      where: { setId },
      select: {
        id: true,
        number: true,
        name: true,
        rarity: true,
        imageSmallUrl: true,
        availableFinishes: true,
      },
    });
    const cardIds = cards.map((c) => c.id);

    const grouped = cardIds.length
      ? await this.prisma.inventoryItem.groupBy({
          by: ['cardId', 'finish'],
          where: { cardId: { in: cardIds }, ownerType: 'platform', status: { notIn: NOT_ON_HAND } },
          _count: { _all: true },
        })
      : [];

    const countsByCard = new Map<string, { finish: Finish; count: number }[]>();
    for (const g of grouped) {
      const list = countsByCard.get(g.cardId) ?? [];
      list.push({ finish: g.finish, count: g._count._all });
      countsByCard.set(g.cardId, list);
    }

    const printedTotal = set.printedTotal ?? null;
    const cells: MasterSetCardCellDTO[] = cards
      .slice()
      .sort(compareByNumber)
      .map((c) => {
        const parts = deriveNumberParts(c.number);
        const byFinish = (countsByCard.get(c.id) ?? []).sort((a, b) =>
          a.finish < b.finish ? -1 : a.finish > b.finish ? 1 : 0,
        );
        const totalCount = byFinish.reduce((s, x) => s + x.count, 0);
        return {
          cardId: c.id,
          number: c.number,
          numberSort: parts.numberSort,
          name: c.name,
          rarity: c.rarity ?? undefined,
          imageSmallUrl: c.imageSmallUrl ?? undefined,
          availableFinishes: (c.availableFinishes ?? ['normal']) as Finish[],
          countsByFinish: byFinish,
          totalCount,
          // isSecretRare — heurística de DISPLAY (API_CONTRACT §M1 v1.16.1 / ARCHITECTURE §4.17a,
          // BE-36). Secret rare REAL = numeración PRINCIPAL (número puramente numérico, sin prefijo
          // alfabético) con entero > printedTotal. Los promos/subsets (TG/GG/SV, con prefijo) NO
          // cuentan aunque su `numberSort` (PROMO_SORT_BASE + n) supere printedTotal; printedTotal
          // nulo → false.
          isSecretRare:
            printedTotal != null && parts.prefix === '' && parts.num > printedTotal,
        };
      });

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
    };
  }
}
