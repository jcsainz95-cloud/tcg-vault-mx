/**
 * featured.service.ts — v1.113⟨portada⟩ (API_CONTRACT §DYN.2, ARCHITECTURE §4.DYN (c)): Destacadas del día MATERIALIZADAS.
 *
 *  - `tick()`  — job `featured-rotation` (cada 15 min): si no existe la selección del día de portada `D`, y ya es hora
 *                (H − 15 min; en fase 2, M-94, también cuando exista el precio del día), la calcula y la escribe UNA vez.
 *  - `read()`  — `GET /catalog/featured`: la selección con mayor `effectiveFrom ≤ ahora`, filtrada por disponibilidad EN VIVO,
 *                en su orden, sin rellenar. ⛔ Sin parámetros: nada del visitante puede cambiarla (I-2).
 *  - `force()` — `POST /admin/jobs/featured-rotation {force:true}`: rehace la del día que se SIRVE.
 *  - `health()`— `dataHealth.featuredRotation` del tablero.
 * ⛔ No existe camino de respaldo «las más caras» (I-1): sin selección vigente ⇒ `data: []`.
 */
import { randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { SettingKey } from '../settings/settings.constants';
import { dayMx } from '../spend-alerts/spend-alerts.service';
import { mxDayStart } from '../spend-alerts/mx-day';
import { CatalogService, GroupedListingSummaryDTO } from './catalog.service';
import {
  FeaturedDials,
  FeaturedKey,
  featuredKeyOf,
  seededRng,
  selectFeatured,
} from './featured-selection';

/** Candado consultivo del job (single-flight entre instancias). ⛔ Ningún otro módulo usa este valor. */
export const FEATURED_ROTATION_LOCK_KEY = 91_130_101;
/** §DYN.2.3: la selección de D se calcula desde H − 30 min y se escribe a más tardar desde H − 15 min. */
const LOOKAHEAD_MS = 30 * 60_000;
const WRITE_FROM_BEFORE_H_MS = 15 * 60_000;
/** §DYN.2.5: `stale` ⇔ pasaron 15 min de `effectiveFrom(esperado)` sin servirlo. */
const STALE_GRACE_MS = 15 * 60_000;
const HOUR_MS = 3_600_000;

export type FeaturedSlotKind = 'new_arrival' | 'pool';
export type FeaturedListingDTO = GroupedListingSummaryDTO & { featuredSlot: FeaturedSlotKind };
export interface FeaturedResponse {
  businessDate: string | null;
  data: FeaturedListingDTO[];
}
export interface FeaturedHealth {
  status: 'ok' | 'stale' | 'never';
  servingBusinessDate: string | null;
  expectedBusinessDate: string;
}
export type FeaturedTickStatus = 'written' | 'exists' | 'waiting' | 'locked' | 'failed';

interface StoredSelection {
  businessDate: Date;
  effectiveFrom: Date;
  seed: string;
  dials: unknown;
  poolCount: number;
  newArrivalCandidates: number;
  forcedByUserId: string | null;
  items: (FeaturedKey & { position: number; slotKind: FeaturedSlotKind })[];
}

type Db = Prisma.TransactionClient | PrismaService;

const ymdOf = (d: Date) => d.toISOString().slice(0, 10);
const dbDate = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

@Injectable()
export class FeaturedService {
  private readonly logger = new Logger(FeaturedService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    private readonly settings: SettingsService,
  ) {}

  /** Los cinco diales `featured_*` (lectura en vivo: rigen la SIGUIENTE selección, criterio 926). */
  private async dials(): Promise<FeaturedDials & { rotationHour: number }> {
    const [poolSize, randomSlots, newArrivalSlots, windowDays, rotationHour] = await Promise.all([
      this.settings.getNumber(SettingKey.FEATURED_POOL_SIZE),
      this.settings.getNumber(SettingKey.FEATURED_RANDOM_SLOTS),
      this.settings.getNumber(SettingKey.FEATURED_NEW_ARRIVAL_SLOTS),
      this.settings.getNumber(SettingKey.FEATURED_NEW_ARRIVAL_WINDOW_DAYS),
      this.settings.getNumber(SettingKey.FEATURED_ROTATION_HOUR),
    ]);
    return { poolSize, randomSlots, newArrivalSlots, windowDays, rotationHour };
  }

  /** `effectiveFrom` del día de portada `ymd` = ese día a las H:00 CDMX (en UTC). */
  static effectiveFromOf(ymd: string, hour: number): Date {
    return new Date(mxDayStart(ymd).getTime() + hour * HOUR_MS);
  }

  /** El día de portada que DEBERÍA servirse en `now` (el último cuyo H:00 CDMX ya pasó). */
  static servedDayAt(now: Date, hour: number): string {
    return dayMx(new Date(now.getTime() - hour * HOUR_MS));
  }

  private async serving(now: Date, db: Db = this.prisma): Promise<StoredSelection | null> {
    return (await db.featuredSelection.findFirst({
      where: { effectiveFrom: { lte: now } },
      orderBy: { effectiveFrom: 'desc' },
      include: { items: { orderBy: { position: 'asc' } } },
    })) as StoredSelection | null;
  }

  /** §DYN.2.2 — lectura por petición, coste constante (render acotado a los ≤ 20 `cardId` de la selección). */
  async read(): Promise<FeaturedResponse> {
    const sel = await this.serving(new Date());
    if (!sel) return { businessDate: null, data: [] };
    const live = await this.catalog.featuredGroups(sel.items);
    const data: FeaturedListingDTO[] = [];
    for (const it of sel.items) {
      const g = live.get(featuredKeyOf(it));
      // Sin grupo vivo (vendido, apartado, retirado, sin precio) ⇒ se OMITE, no se rellena (924).
      if (g) data.push({ ...g, featuredSlot: it.slotKind });
    }
    return { businessDate: ymdOf(sel.businessDate), data };
  }

  /** §DYN.2.3 — el tic. Nunca lanza: un fallo se loguea y el siguiente tic reintenta (se sigue sirviendo la anterior, 927). */
  async tick(): Promise<{ status: FeaturedTickStatus; businessDate: string }> {
    const now = new Date();
    const d = await this.dials();
    const day = dayMx(new Date(now.getTime() + LOOKAHEAD_MS - d.rotationHour * HOUR_MS));
    const effectiveFrom = FeaturedService.effectiveFromOf(day, d.rotationHour);
    // Fase 1 (sin M-94): solo la condición de tiempo. Con M-94 se suma «o existe ListingPriceRun(daily, D, ok)».
    if (now.getTime() < effectiveFrom.getTime() - WRITE_FROM_BEFORE_H_MS) {
      const exists = await this.prisma.featuredSelection.findUnique({ where: { businessDate: dbDate(day) } });
      return { status: exists ? 'exists' : 'waiting', businessDate: day };
    }
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(${FEATURED_ROTATION_LOCK_KEY}) AS locked`;
          if (!locked) return { status: 'locked' as const, businessDate: day };
          const exists = await tx.featuredSelection.findUnique({ where: { businessDate: dbDate(day) } });
          if (exists) return { status: 'exists' as const, businessDate: day };
          await this.compute(tx, day, effectiveFrom, d, null);
          this.logger.log(`featured-rotation: selección de ${day} escrita (effectiveFrom ${effectiveFrom.toISOString()}).`);
          return { status: 'written' as const, businessDate: day };
        },
        { timeout: 120_000 },
      );
    } catch (e) {
      this.logger.error(
        `featured-rotation: el cálculo de ${day} FALLÓ (no se escribe nada; se sigue sirviendo la anterior y el ` +
          `siguiente tic reintenta): ${e instanceof Error ? e.message : String(e)}`,
      );
      return { status: 'failed', businessDate: day };
    }
  }

  /**
   * §DYN.2.4 — `force: true`: rehace la selección del día que se está SIRVIENDO (semilla nueva, diales vigentes,
   * `forcedByUserId`). Sin ninguna servida ⇒ calcula la del día esperado. Devuelve antes/después para la bitácora.
   */
  async force(userId: string): Promise<{ businessDate: string; before: StoredSelection | null; after: StoredSelection }> {
    const now = new Date();
    const d = await this.dials();
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(${FEATURED_ROTATION_LOCK_KEY})`;
        const before = await this.serving(now, tx);
        const day = before ? ymdOf(before.businessDate) : FeaturedService.servedDayAt(now, d.rotationHour);
        const effectiveFrom = before?.effectiveFrom ?? FeaturedService.effectiveFromOf(day, d.rotationHour);
        if (before) await tx.featuredSelection.delete({ where: { businessDate: before.businessDate } });
        await this.compute(tx, day, effectiveFrom, d, userId);
        const after = (await tx.featuredSelection.findUnique({
          where: { businessDate: dbDate(day) },
          include: { items: { orderBy: { position: 'asc' } } },
        })) as StoredSelection;
        return { businessDate: day, before, after };
      },
      { timeout: 120_000 },
    );
  }

  /** Calcula y escribe en UNA transacción (la del llamante): cabecera + ítems. */
  private async compute(
    tx: Db,
    day: string,
    effectiveFrom: Date,
    d: FeaturedDials & { rotationHour: number },
    forcedByUserId: string | null,
  ): Promise<void> {
    const cands = await this.catalog.featuredCandidates();
    const seed = randomBytes(32).toString('hex');
    const sel = selectFeatured(cands, effectiveFrom, d, seededRng(seed));
    await tx.featuredSelection.create({
      data: {
        businessDate: dbDate(day),
        effectiveFrom,
        seed,
        dials: {
          poolSize: d.poolSize,
          randomSlots: d.randomSlots,
          newArrivalSlots: d.newArrivalSlots,
          windowDays: d.windowDays,
          rotationHour: d.rotationHour,
        },
        poolCount: sel.poolCount,
        newArrivalCandidates: sel.newArrivalCandidates,
        forcedByUserId,
        items: {
          create: sel.items.map((i) => ({
            position: i.position,
            slotKind: i.slotKind,
            cardId: i.cardId,
            productType: i.productType,
            gradeKey: i.gradeKey,
            finish: i.finish,
          })),
        },
      },
    });
  }

  /** §DYN.2.5 — `dataHealth.featuredRotation`. */
  async health(): Promise<FeaturedHealth> {
    const now = new Date();
    const hour = await this.settings.getNumber(SettingKey.FEATURED_ROTATION_HOUR);
    const expected = FeaturedService.servedDayAt(now, hour);
    const sel = await this.serving(now);
    const serving = sel ? ymdOf(sel.businessDate) : null;
    if (!sel) {
      const any = await this.prisma.featuredSelection.findFirst({});
      if (!any) return { status: 'never', servingBusinessDate: null, expectedBusinessDate: expected };
    }
    const late = now.getTime() > FeaturedService.effectiveFromOf(expected, hour).getTime() + STALE_GRACE_MS;
    return { status: serving !== expected && late ? 'stale' : 'ok', servingBusinessDate: serving, expectedBusinessDate: expected };
  }
}
