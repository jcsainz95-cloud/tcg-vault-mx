import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CardSet } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { PricingService } from '../pricing/pricing.service';

/**
 * TD-1 (v1.9-set-chart): REGLA DE VALUACIÓN del set público, fuente única compartida. Fija el
 * tipo/grado/acabado que define "el valor de mercado de una carta del set" (ARCHITECTURE §4.12a):
 * raw, gradeKey `raw:NM`, acabado `normal`. La usan `computeSetValue` (lectura/agregación) y el job
 * `set-price-sync` (escritura de la PriceReference del día), para que ESCRITURA y LECTURA no diverjan.
 * La regla "referencia vigente = más reciente por capturedDate" es la MISMA de
 * `PricingService.getReference`; ver el cruce en BACKEND_NOTES §29 (unificar el batch = RB-8/BE-4).
 */
export const SET_VALUE_RULE = {
  productType: 'raw',
  gradeKey: 'raw:NM',
  finish: 'normal',
} as const;

/** Rangos de la gráfica (mismo conjunto que la de portafolio). API_CONTRACT §DTOs base (SetValueRange). */
export type SetValueRange = '5d' | '15d' | '1m' | '3m' | '6m' | '1y' | 'ytd' | 'all';
const RANGES: SetValueRange[] = ['5d', '15d', '1m', '3m', '6m', '1y', 'ytd', 'all'];

/** API_CONTRACT §DTOs base — SetValuePointDTO. */
export interface SetValuePointDTO {
  date: string;
  valueMxnCents: number;
  pricedCardCount: number;
  estimated?: boolean;
}

/** API_CONTRACT §DTOs base — SetRefDTO (id = id LOCAL del CardSet, no el externalId). */
export interface SetRefDTO {
  id: string;
  name: string;
  series?: string;
  releaseDate?: string;
}

export interface SetValueChange {
  absMxnCents: number;
  pct: number | null;
  direction: 'up' | 'down' | 'flat';
}

/** API_CONTRACT §DTOs base — SetValueHistoryResponse. */
export interface SetValueHistoryResponse {
  set: SetRefDTO | null;
  range: SetValueRange;
  points: SetValuePointDTO[];
  change: SetValueChange;
}

export interface SetValueAggregate {
  totalValueMxnCents: number;
  pricedCardCount: number;
  totalCardCount: number;
}

/** Fecha de hoy a 00:00 UTC (un punto por día natural). */
function today(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * SetValueService (v1.9-set-chart, ARCHITECTURE §4.12) — Lógica de la gráfica PÚBLICA del valor
 * de mercado agregado de un set (hero de la home). Tres piezas:
 *  - `resolveFeaturedSet()`: cascada del set destacado (§4.12b).
 *  - `computeSetValue()`: SUM server-side desde PriceReference real (§4.12a, SEC-A1). Lectura batch
 *    (2 queries, sin N+1). NO genera PendingPriceEntry (agregación de mercado, no de bóveda).
 *  - `valueHistory()`: lee SetValueSnapshot y arma points + change (misma lógica que portafolio).
 * El fetch externo (preciar el set) lo hace el job `set-price-sync`; aquí solo se LEE la BD.
 */
@Injectable()
export class SetValueService {
  private readonly logger = new Logger(SetValueService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly pricing: PricingService,
  ) {}

  /**
   * Cascada del "set destacado" (ARCHITECTURE §4.12b), determinista:
   *  1. env HOME_FEATURED_SET_ID (id NATIVO pokemontcg.io) → CardSet local por externalId.
   *  2. fallback: set con mayor totalValueMxnCents en su ÚLTIMO SetValueSnapshot.
   *  3. fallback: CardSet más reciente por releaseDate (desc); si ninguno tiene fecha, el más nuevo.
   *  4. null (no hay ningún CardSet → el hero degrada sin error).
   * La usan TANTO el endpoint público COMO el job set-price-sync (env y gráfica no divergen).
   */
  async resolveFeaturedSet(): Promise<CardSet | null> {
    // 1. Override por env (id nativo pokemontcg.io → externalId local).
    const envId = this.config.get<string>('HOME_FEATURED_SET_ID');
    if (envId) {
      const set = await this.prisma.cardSet.findUnique({ where: { externalId: envId } });
      if (set) return set;
      this.logger.warn(
        `HOME_FEATURED_SET_ID='${envId}' no resuelve a un CardSet local; se usa el fallback determinista.`,
      );
    }

    // 2. Fallback: el set más valioso según su último snapshot capturado.
    const snaps = await this.prisma.setValueSnapshot.findMany({
      orderBy: [{ setId: 'asc' }, { asOfDate: 'desc' }],
      select: { setId: true, totalValueMxnCents: true },
    });
    const latestBySet = new Map<string, number>();
    for (const s of snaps) {
      if (!latestBySet.has(s.setId)) latestBySet.set(s.setId, s.totalValueMxnCents);
    }
    let bestSetId: string | undefined;
    let bestVal = -1;
    for (const [setId, val] of latestBySet) {
      if (val > bestVal) {
        bestVal = val;
        bestSetId = setId;
      }
    }
    if (bestSetId) {
      const set = await this.prisma.cardSet.findUnique({ where: { id: bestSetId } });
      if (set) return set;
    }

    // 3. Fallback: el CardSet más reciente por releaseDate (String yyyy/MM/dd → orden lexicográfico).
    const byRelease = await this.prisma.cardSet.findFirst({
      where: { releaseDate: { not: null } },
      orderBy: { releaseDate: 'desc' },
    });
    if (byRelease) return byRelease;

    // 3b. Ninguno con releaseDate → el más nuevo por createdAt.
    const anySet = await this.prisma.cardSet.findFirst({ orderBy: { createdAt: 'desc' } });
    return anySet ?? null;
  }

  /**
   * Valor agregado del set en una fecha (ARCHITECTURE §4.12a, SEC-A1). 100% server-side desde
   * PriceReference real. Para cada Card del set toma la referencia vigente MÁS RECIENTE con
   * productType='raw', gradeKey='raw:NM', finish='normal' y capturedDate <= `asOf` (si se pasa).
   * Cartas sin precio se EXCLUYEN del total (no se inventa precio) pero se cuentan en el total del set.
   *
   * Sin N+1: 2 queries fijas (cartas del set + sus PriceReference en lote); el "más reciente por
   * carta" se resuelve en memoria aprovechando `orderBy capturedDate desc`. NO genera PendingPriceEntry.
   */
  async computeSetValue(setId: string, asOf?: Date): Promise<SetValueAggregate> {
    const cards = await this.prisma.card.findMany({
      where: { setId },
      select: { id: true },
    });
    const totalCardCount = cards.length;
    if (totalCardCount === 0) {
      return { totalValueMxnCents: 0, pricedCardCount: 0, totalCardCount: 0 };
    }
    const cardIds = cards.map((c) => c.id);

    const refs = await this.prisma.priceReference.findMany({
      where: {
        cardId: { in: cardIds },
        // TD-1: tipo/grado/acabado desde la regla compartida (misma que usa set-price-sync al escribir).
        productType: SET_VALUE_RULE.productType,
        gradeKey: SET_VALUE_RULE.gradeKey,
        finish: SET_VALUE_RULE.finish,
        ...(asOf ? { capturedDate: { lte: asOf } } : {}),
      },
      orderBy: { capturedDate: 'desc' },
      // v1.x-fx-live: priceUsdCents + isManualOverride para recalcular el MXN vigente (solo valor "hoy").
      select: {
        cardId: true,
        priceMxnCents: true,
        priceUsdCents: true,
        isManualOverride: true,
      },
    });

    // v1.x-fx-live: el valor "hoy" (sin `asOf`) es una REFERENCIA DE MERCADO VIVA → recalcula el MXN
    // de referencias en USD con la FX vigente (izada UNA vez). El valor histórico (con `asOf`, que usa
    // el snapshot diario `set-value-snapshot`) queda CONGELADO: cada día del histórico conserva la FX
    // con que se ingirió (no se mueve retroactivamente la serie de tendencia).
    const fx = asOf ? null : await this.pricing.fxSnapshotSafe();

    // "Vigente más reciente por carta": primera fila vista por carta (orden capturedDate desc).
    const seen = new Set<string>();
    let totalValueMxnCents = 0;
    let pricedCardCount = 0;
    for (const r of refs) {
      if (seen.has(r.cardId)) continue;
      seen.add(r.cardId);
      totalValueMxnCents += asOf ? r.priceMxnCents : this.pricing.liveMxnCents(r, fx);
      pricedCardCount += 1;
    }

    return { totalValueMxnCents, pricedCardCount, totalCardCount };
  }

  /**
   * Serie temporal del valor del set para el rango (ARCHITECTURE §4.12, misma lógica que la
   * gráfica de portafolio). Lee SetValueSnapshot y arma points + change (primer vs último punto).
   * Sin snapshots → points [] y change flat con pct null. NO resuelve el `set` (lo hace el llamador).
   */
  async valueHistory(
    setId: string,
    range: string,
  ): Promise<{ range: SetValueRange; points: SetValuePointDTO[]; change: SetValueChange }> {
    const normalizedRange = this.normalizeRange(range);
    const from = this.rangeStart(normalizedRange);
    const snapshots = await this.prisma.setValueSnapshot.findMany({
      where: { setId, ...(from ? { asOfDate: { gte: from } } : {}) },
      orderBy: { asOfDate: 'asc' },
    });

    const points: SetValuePointDTO[] = snapshots.map((s) => ({
      date: s.asOfDate.toISOString().slice(0, 10),
      valueMxnCents: s.totalValueMxnCents,
      pricedCardCount: s.pricedCardCount,
    }));

    if (points.length === 0) {
      return {
        range: normalizedRange,
        points,
        change: { absMxnCents: 0, pct: null, direction: 'flat' },
      };
    }

    const first = points[0].valueMxnCents;
    const last = points[points.length - 1].valueMxnCents;
    const absMxnCents = last - first;
    const pct = first === 0 ? null : Math.round((absMxnCents / first) * 10000) / 100;
    const direction: SetValueChange['direction'] =
      absMxnCents > 0 ? 'up' : absMxnCents < 0 ? 'down' : 'flat';
    return { range: normalizedRange, points, change: { absMxnCents, pct, direction } };
  }

  /**
   * GET /catalog/featured-set/value-history — resuelve el set destacado server-side y devuelve su
   * serie. Si no hay ningún CardSet → { set: null, points: [], change flat } (degrada sin error).
   */
  async featuredSetHistory(range: string): Promise<SetValueHistoryResponse> {
    const set = await this.resolveFeaturedSet();
    if (!set) {
      return {
        set: null,
        range: this.normalizeRange(range),
        points: [],
        change: { absMxnCents: 0, pct: null, direction: 'flat' },
      };
    }
    const hist = await this.valueHistory(set.id, range);
    return { set: this.toSetRef(set), ...hist };
  }

  /**
   * GET /catalog/sets/:id/value-history — serie de un set por su id LOCAL. 404 si no existe.
   * Set sin snapshots → points [] y change flat, pero `set` siempre resuelto.
   */
  async setHistoryById(setId: string, range: string): Promise<SetValueHistoryResponse> {
    const set = await this.prisma.cardSet.findUnique({ where: { id: setId } });
    if (!set) throw BusinessException.notFound();
    const hist = await this.valueHistory(set.id, range);
    return { set: this.toSetRef(set), ...hist };
  }

  /** Snapshot idempotente del valor del set destacado HOY (job set-value-snapshot). */
  async snapshotFeaturedSet(): Promise<{
    setId: string | null;
    totalValueMxnCents: number;
    pricedCardCount: number;
    totalCardCount: number;
  }> {
    const set = await this.resolveFeaturedSet();
    if (!set) {
      this.logger.warn('set-value-snapshot: no hay CardSet destacado; nada que snapshotear.');
      return { setId: null, totalValueMxnCents: 0, pricedCardCount: 0, totalCardCount: 0 };
    }
    const asOfDate = today();
    const agg = await this.computeSetValue(set.id, asOfDate);
    await this.prisma.setValueSnapshot.upsert({
      where: { setId_asOfDate: { setId: set.id, asOfDate } },
      create: { setId: set.id, asOfDate, ...agg },
      update: { ...agg },
    });
    this.logger.log(
      `set-value-snapshot: set ${set.id} → ${agg.pricedCardCount}/${agg.totalCardCount} priceadas, ` +
        `${agg.totalValueMxnCents} MXN cents.`,
    );
    return { setId: set.id, ...agg };
  }

  private toSetRef(set: CardSet): SetRefDTO {
    return {
      id: set.id,
      name: set.name,
      series: set.series ?? undefined,
      releaseDate: set.releaseDate ?? undefined,
    };
  }

  private normalizeRange(range: string): SetValueRange {
    return (RANGES as string[]).includes(range) ? (range as SetValueRange) : '1m';
  }

  /** Fecha de inicio (00:00 UTC) del rango, o null para `all`. */
  private rangeStart(range: SetValueRange): Date | null {
    const now = new Date();
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    switch (range) {
      case '5d':
        d.setUTCDate(d.getUTCDate() - 5);
        return d;
      case '15d':
        d.setUTCDate(d.getUTCDate() - 15);
        return d;
      case '1m':
        d.setUTCMonth(d.getUTCMonth() - 1);
        return d;
      case '3m':
        d.setUTCMonth(d.getUTCMonth() - 3);
        return d;
      case '6m':
        d.setUTCMonth(d.getUTCMonth() - 6);
        return d;
      case '1y':
        d.setUTCFullYear(d.getUTCFullYear() - 1);
        return d;
      case 'ytd':
        return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
      case 'all':
      default:
        return null;
    }
  }
}
