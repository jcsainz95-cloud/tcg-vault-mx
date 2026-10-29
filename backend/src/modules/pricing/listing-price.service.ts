/**
 * listing-price.service.ts — 💰 v1.113⟨portada⟩ + errata v1.113.1 (API_CONTRACT §DYN.5, ARCHITECTURE §4.DYN (e)): **el precio
 * del día.** Lo exhibido y lo cobrado salen del MISMO dato: la fila `ListingPrice` de cada pieza vendible, que solo se mueve
 * cuando corre un cálculo (§DYN.5.3). Aquí viven:
 *
 *  - el ESCRITOR (`run` / `enqueue`): calcula por el cuerpo único (`SaleDecisionService`, §DYN.5.1) y SOBRESCRIBE la fila
 *    (⛔ sin precio anterior, §DYN.5.5); bitácora en `ListingPriceRun`; lotes de 500 por transacción; single-flight;
 *  - el LECTOR (`salesFor`): fila `priced` ⇒ su `P` tal cual; `pending` ⇒ no se exhibe ni se cobra (`PRICE_PENDING`); sin
 *    fila ⇒ cálculo en vivo por el cuerpo único + `missing_row` encolado (§DYN.5.6/.7);
 *  - los disparadores que no tienen un sitio mejor (`onSettingsWritten` ⇒ `dial_change`, `bootstrap` al arrancar);
 *  - `health()` = `dataHealth.listingPrices` (§DYN.5.8).
 *
 * ⛔ Las corridas AUTOMÁTICAS de `price-ingest` no disparan nada aquí (el dueño pidió «una vez al día», §X.1 / DYN-B18).
 */
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ListingPrice, ListingPriceRunTrigger, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SEALED_SALE_PRICE_INCLUDE } from '../../common/money';
import type { IvaDials } from '../../common/money';
import { marketBracketOf } from '../../common/pricing-curve';
import { isSchedulerDisabled } from '../../config/test-env';
import { SettingsService } from '../settings/settings.service';
import { PRICE_AFFECTING_SETTING_KEYS, SettingKey, SettingKeyType } from '../settings/settings.constants';
import { dayMx } from '../spend-alerts/spend-alerts.service';
import { mxDayStart } from '../spend-alerts/mx-day';
import { PricingService } from './pricing.service';
import { isPricePending, SaleDecision, SaleDecisionBatch, SaleDecisionService, SaleItem } from './sale-decision.service';

/** Candado consultivo de las escrituras de `ListingPrice` (una transacción de lote a la vez entre instancias). */
export const LISTING_PRICE_LOCK_KEY = 91_130_102;
/** §DYN.5.3: lotes de 500 piezas por transacción. */
export const LISTING_PRICE_BATCH_SIZE = 500;
/** §DYN.5.3: la corrida diaria del día de portada `D` corre desde `effectiveFrom(D) − 60 min`. */
export const DAILY_RUN_LEAD_MS = 60 * 60_000;
const HOUR_MS = 3_600_000;
/** Estados en alcance: el `isSellable` del checkout (`ownerType = platform ∧ status ∈ {listed, in_stock}`, §DYN.5.2). */
const SCOPE_STATUSES = ['listed', 'in_stock'] as const;

/** Cómo resolvió un lector el precio de una pieza. */
export type PieceSale = { kind: 'priced'; decision: SaleDecision; from: 'row' | 'live' } | { kind: 'pending' };

export interface ListingPriceRunResult {
  runId: string;
  trigger: ListingPriceRunTrigger;
  status: 'ok' | 'failed';
  scopeItemCount: number;
  pricedCount: number;
  pendingCount: number;
}

export interface ListingPricesHealth {
  status: 'ok' | 'stale' | 'never';
  lastDailyBusinessDate: string | null;
}

const ymdOf = (d: Date) => d.toISOString().slice(0, 10);
const dbDate = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

/** `effectiveFrom` del día de portada `ymd` = ese día a las H:00 CDMX (en UTC). Mismo cálculo que `FeaturedService`. */
export function portadaEffectiveFrom(ymd: string, hour: number): Date {
  return new Date(mxDayStart(ymd).getTime() + hour * HOUR_MS);
}
/** El día de portada que se sirve en `now` (el último cuyo H:00 CDMX ya pasó). */
export function portadaServedDay(now: Date, hour: number): string {
  return dayMx(new Date(now.getTime() - hour * HOUR_MS));
}

/**
 * La instrumentación de la FILA como decisión de venta (lo que el checkout congela en `OrderItem`, §DYN.5.7): `P`, `L`, base,
 * mercado y su tramo DERIVADO (`marketBracketOf`, no se guarda) y el acabado de la pieza.
 */
export function decisionOfRow(row: ListingPrice, item: { finish: SaleItem['finish'] }): SaleDecision {
  if (row.status !== 'priced' || row.unitPriceCents == null || row.listPriceCents == null || row.priceBasis == null) {
    throw new Error(`ListingPrice ${row.inventoryItemId}: fila no priced`);
  }
  return {
    unitPriceCents: row.unitPriceCents,
    listPriceCents: row.listPriceCents,
    fixedDisplayCents: row.fixedDisplayCents,
    priceBasis: row.priceBasis,
    marketMxnCents: row.marketMxnCents,
    marketBracket: marketBracketOf(row.marketMxnCents),
    finish: item.finish,
  };
}

/**
 * El cálculo EN VIVO de piezas sin fila, por el cuerpo único (§DYN.5.6 «sin fila»). `PRICE_PENDING` ⇒ `pending`; cualquier
 * otro error propaga (COND-1: un guardarraíl que un `catch` ancho pueda saltarse no es un guardarraíl).
 */
export async function liveSalesFor(
  decider: SaleDecisionService,
  items: readonly SaleItem[],
  dials: IvaDials,
  batch?: SaleDecisionBatch,
): Promise<Map<string, PieceSale>> {
  const out = new Map<string, PieceSale>();
  for (const item of items) {
    try {
      out.set(item.id, { kind: 'priced', decision: await decider.decide(item, dials, batch), from: 'live' });
    } catch (e) {
      if (!isPricePending(e)) throw e;
      out.set(item.id, { kind: 'pending' });
    }
  }
  return out;
}

@Injectable()
export class ListingPriceService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ListingPriceService.name);
  /** Single-flight en proceso: las corridas se encadenan (nunca dos a la vez en esta instancia). */
  private chain: Promise<unknown> = Promise.resolve();
  /** Encolados aún no lanzados, por disparador: `null` = alcance completo; `Set` = esas piezas. */
  private readonly queued = new Map<ListingPriceRunTrigger, Set<string> | null>();
  private flushScheduled = false;
  private destroyed = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly decider: SaleDecisionService,
    private readonly settings: SettingsService,
  ) {}

  // ───────────────────────────────────────────── disparadores ─────────────────────────────────────────────

  /** `bootstrap` una vez al desplegar M-94 (hasta que haya una corrida `bootstrap` ok). Fuera de la suite automatizada. */
  async onApplicationBootstrap(): Promise<void> {
    // Toda escritura de una clave que mueve el precio dispara `dial_change` (§DYN.5.3/.4), venga por la puerta que venga.
    this.settings.onKeysWritten((keys) => this.onSettingsWritten(keys));
    if (isSchedulerDisabled()) return;
    try {
      const done = await this.prisma.listingPriceRun.findFirst({ where: { trigger: 'bootstrap', status: 'ok' }, select: { id: true } });
      if (!done) this.enqueue('bootstrap');
    } catch (e) {
      this.logger.error(`listing-price: no se pudo comprobar el bootstrap: ${(e as Error).message}`);
    }
  }

  /** Al cerrar: deja terminar lo que corre (una corrida a medias no deja filas incoherentes, pero sí ruido) y no lanza más. */
  async onModuleDestroy(): Promise<void> {
    this.queued.clear();
    this.destroyed = true;
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([this.idle(), new Promise((r) => (timer = setTimeout(r, 10_000)))]);
    if (timer) clearTimeout(timer);
  }

  /** §DYN.5.3/.4 — un `PUT` que tocó claves: si alguna está en `PRICE_AFFECTING_SETTING_KEYS`, `dial_change` al instante. */
  onSettingsWritten(keys: readonly SettingKeyType[]): void {
    if (keys.some((k) => (PRICE_AFFECTING_SETTING_KEYS as readonly string[]).includes(k))) this.enqueue('dial_change');
  }

  /**
   * Encola un cálculo (fuera de la petición que lo dispara: nunca la hace fallar ni esperar). Los encolados del mismo
   * disparador se FUNDEN en una corrida (alcance completo absorbe a uno parcial). Devuelve la promesa de la corrida que lo
   * atiende (las pruebas la esperan; los llamantes no).
   */
  enqueue(trigger: ListingPriceRunTrigger, ids?: readonly string[]): Promise<unknown> {
    if (ids && ids.length === 0) return this.chain;
    const prev = this.queued.get(trigger);
    if (prev === null || !ids) this.queued.set(trigger, null);
    else this.queued.set(trigger, new Set([...(prev ?? []), ...ids]));
    if (!this.flushScheduled) {
      this.flushScheduled = true;
      this.chain = this.chain.then(() => this.flush());
    }
    return this.chain;
  }

  /**
   * Encola el cálculo de las piezas de plataforma que cumplan `where` (override de variante, precio del producto sellado:
   * las piezas afectadas, §DYN.5.3 `manual_price`). Nunca lanza: un fallo de la lectura se loguea.
   */
  enqueueWhere(trigger: ListingPriceRunTrigger, where: Prisma.InventoryItemWhereInput): Promise<unknown> {
    // En la cadena (no suelto): `idle()` espera también a esta lectura, y su corrida va detrás de las anteriores.
    this.chain = this.chain
      .then(() => this.prisma.inventoryItem.findMany({ where: { ...where, ownerType: 'platform' }, select: { id: true } }))
      .then((rows) => {
        void this.enqueue(trigger, rows.map((r) => r.id));
      })
      .catch((e: Error) => this.logger.error(`listing-price ${trigger}: no se pudo leer el alcance: ${e.message}`));
    return this.chain;
  }

  /** Espera a que no quede nada encolado ni corriendo (pruebas y cierre). */
  async idle(): Promise<void> {
    let last: Promise<unknown>;
    do {
      last = this.chain;
      await last.catch(() => undefined);
    } while (last !== this.chain);
  }

  private async flush(): Promise<void> {
    this.flushScheduled = false;
    const work = [...this.queued.entries()];
    this.queued.clear();
    for (const [trigger, ids] of work) {
      if (this.destroyed) return;
      await this.runNow(trigger, ids ? [...ids] : undefined).catch(() => undefined);
    }
  }

  /** Corre un cálculo AHORA, en la cadena (single-flight), y espera su resultado. */
  run(trigger: ListingPriceRunTrigger, ids?: readonly string[], opts: { businessDate?: string } = {}): Promise<ListingPriceRunResult> {
    const p = this.chain.then(() => this.runNow(trigger, ids ? [...ids] : undefined, opts));
    this.chain = p.catch(() => undefined);
    return p;
  }

  // ───────────────────────────────────────────── escritor ─────────────────────────────────────────────

  private async runNow(
    trigger: ListingPriceRunTrigger,
    ids: string[] | undefined,
    opts: { businessDate?: string } = {},
  ): Promise<ListingPriceRunResult> {
    const startedAt = new Date();
    const hour = await this.settings.getNumber(SettingKey.FEATURED_ROTATION_HOUR);
    const businessDate = opts.businessDate ?? portadaServedDay(startedAt, hour);
    const run = await this.prisma.listingPriceRun.create({
      data: { businessDate: dbDate(businessDate), trigger, status: 'running', scopeItemCount: 0, startedAt },
    });
    let priced = 0;
    let pending = 0;
    let scope = 0;
    try {
      // Los dos diales que derivan `P`, UNA lectura por corrida (⛔ nunca por pieza: dos piezas con posiciones distintas del
      // dial darían precios que no corresponden a ninguna posición).
      const dials = await this.settings.getIvaDials();
      // Alcance: el `isSellable` del checkout (§DYN.5.2) MÁS las piezas apartadas que YA tienen fila: el que las apartó las
      // sigue cotizando y pagando con ella (§4-R.2), y al liberarse vuelven con el precio vigente, no con el de antes.
      const where: Prisma.InventoryItemWhereInput = {
        ownerType: 'platform',
        OR: [{ status: { in: [...SCOPE_STATUSES] } }, { status: 'reserved', listingPrice: { isNot: null } }],
        ...(ids ? { id: { in: ids } } : {}),
      };
      const items = (await this.prisma.inventoryItem.findMany({
        where,
        include: { card: { include: { set: true } }, ...SEALED_SALE_PRICE_INCLUDE },
        orderBy: { id: 'asc' },
      })) as SaleItem[];
      scope = items.length;
      for (let i = 0; i < items.length; i += LISTING_PRICE_BATCH_SIZE) {
        const chunk = items.slice(i, i + LISTING_PRICE_BATCH_SIZE);
        const batch = await this.decider.loadBatch(chunk);
        const sales = await liveSalesFor(this.decider, chunk, dials, batch);
        await this.prisma.$transaction(
          async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LISTING_PRICE_LOCK_KEY})`;
            // Las piezas se «agarran» ANTES de escribir, en orden y sin esperar: una pieza que alguien está BORRANDO (o
            // cambiando de llave) en este instante se salta —sin fila, el lector la precia en vivo y encola
            // `missing_row`— en vez de esperar con 500 filas a medio escribir (medido: un `DELETE` de piezas contra el
            // lote ⇒ `40P01 deadlock`). `FOR KEY SHARE` no choca con las reservas ni con los cambios de estado.
            const held = new Set(
              (
                await tx.$queryRaw<{ id: string }[]>`
                  SELECT id FROM "InventoryItem" WHERE id = ANY(${chunk.map((c) => c.id)}::text[])
                  ORDER BY id FOR KEY SHARE SKIP LOCKED`
              ).map((r) => r.id),
            );
            for (const item of chunk) {
              if (!held.has(item.id)) continue;
              const s = sales.get(item.id)!;
              if (s.kind === 'priced') priced += 1;
              else pending += 1;
              await this.writeRow(tx, item, s, dials, run.id, startedAt);
            }
          },
          { timeout: 120_000 },
        );
      }
      // Fuera de alcance (vendida, apartada, retirada…) ⇒ su fila sale: si vuelve a la venta, el lector la precia en vivo y
      // encola `missing_row` (nunca un precio de antes de irse). Solo filas de corridas que empezaron ANTES que ésta.
      const inScope = new Set(items.map((x) => x.id));
      const candidates = await this.prisma.listingPrice.findMany({
        where: { computedAt: { lt: startedAt }, ...(ids ? { inventoryItemId: { in: ids } } : {}) },
        select: { inventoryItemId: true },
      });
      const stale = candidates.map((c) => c.inventoryItemId).filter((x) => !inScope.has(x));
      if (stale.length > 0) {
        await this.prisma.listingPrice.deleteMany({ where: { inventoryItemId: { in: stale }, computedAt: { lt: startedAt } } });
      }
      await this.prisma.listingPriceRun.update({
        where: { id: run.id },
        data: { status: 'ok', scopeItemCount: scope, pricedCount: priced, pendingCount: pending, finishedAt: new Date() },
      });
      this.logger.log(`listing-price ${trigger}: ${scope} piezas (${priced} priced, ${pending} pending), día ${businessDate}.`);
      return { runId: run.id, trigger, status: 'ok', scopeItemCount: scope, pricedCount: priced, pendingCount: pending };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`listing-price ${trigger} FALLÓ (las filas de lotes ya escritos quedan; el resto conserva la suya): ${msg}`);
      await this.prisma.listingPriceRun
        .update({
          where: { id: run.id },
          data: { status: 'failed', scopeItemCount: scope, pricedCount: priced, pendingCount: pending, finishedAt: new Date(), error: msg.slice(0, 1000) },
        })
        .catch(() => undefined);
      return { runId: run.id, trigger, status: 'failed', scopeItemCount: scope, pricedCount: priced, pendingCount: pending };
    }
  }

  /**
   * SOBRESCRIBE la fila (§DYN.5.5) — salvo que ya la haya escrito una corrida que empezó DESPUÉS que ésta (dos instancias):
   * gana la más reciente, que leyó diales y mercado más nuevos.
   */
  private async writeRow(
    tx: Prisma.TransactionClient,
    item: SaleItem,
    s: PieceSale,
    dials: IvaDials,
    runId: string,
    computedAt: Date,
  ): Promise<void> {
    const gk = this.decider.gradeKeyOf(item);
    const vk = `${item.cardId}|${item.productType}|${gk ?? '-'}|${item.finish}`;
    const d = s.kind === 'priced' ? s.decision : null;
    await tx.$executeRaw`
      INSERT INTO "ListingPrice" ("inventoryItemId", "variantKey", "runId", "status", "unitPriceCents", "listPriceCents",
        "fixedDisplayCents", "priceBasis", "marketMxnCents", "ivaRatePct", "ivaTransferPct", "computedAt")
      VALUES (${item.id}, ${vk}, ${runId}, ${d ? 'priced' : 'pending'}::"ListingPriceStatus", ${d?.unitPriceCents ?? null}::int,
        ${d?.listPriceCents ?? null}::int, ${d?.fixedDisplayCents ?? null}::int, ${d?.priceBasis ?? null}::"PriceBasis",
        ${d?.marketMxnCents ?? null}::int, ${dials.ivaRatePct}::int, ${dials.ivaTransferPct}::int, ${computedAt})
      ON CONFLICT ("inventoryItemId") DO UPDATE SET
        "variantKey" = EXCLUDED."variantKey", "runId" = EXCLUDED."runId", "status" = EXCLUDED."status",
        "unitPriceCents" = EXCLUDED."unitPriceCents", "listPriceCents" = EXCLUDED."listPriceCents",
        "fixedDisplayCents" = EXCLUDED."fixedDisplayCents", "priceBasis" = EXCLUDED."priceBasis",
        "marketMxnCents" = EXCLUDED."marketMxnCents", "ivaRatePct" = EXCLUDED."ivaRatePct",
        "ivaTransferPct" = EXCLUDED."ivaTransferPct", "computedAt" = EXCLUDED."computedAt"
      WHERE "ListingPrice"."computedAt" <= EXCLUDED."computedAt"`;
  }

  // ───────────────────────────────────────────── lector ─────────────────────────────────────────────

  /** Las filas de estas piezas (una consulta). */
  async rowsFor(ids: readonly string[], db: Prisma.TransactionClient | PrismaService = this.prisma): Promise<Map<string, ListingPrice>> {
    if (ids.length === 0) return new Map();
    const rows = await db.listingPrice.findMany({ where: { inventoryItemId: { in: [...new Set(ids)] } } });
    return new Map(rows.map((r) => [r.inventoryItemId, r]));
  }

  /**
   * 💰 §DYN.5.6/.7 — el precio de cada pieza tal como lo exhibe y lo cobra la tienda: fila `priced` ⇒ su `P` tal cual (aunque
   * `PriceReference` o un dial ya se hayan movido); `pending` ⇒ `pending`; sin fila ⇒ cálculo en vivo por el cuerpo único y
   * `missing_row` encolado.
   */
  async salesFor(items: readonly SaleItem[], dials: IvaDials): Promise<Map<string, PieceSale>> {
    const rows = await this.rowsFor(items.map((i) => i.id));
    const out = new Map<string, PieceSale>();
    const missing: SaleItem[] = [];
    for (const item of items) {
      const row = rows.get(item.id);
      if (!row) missing.push(item);
      else if (row.status === 'pending') out.set(item.id, { kind: 'pending' });
      else out.set(item.id, { kind: 'priced', decision: decisionOfRow(row, item), from: 'row' });
    }
    if (missing.length > 0) {
      // Las entradas del cuerpo, izadas SOLO para las piezas sin fila (con fila no se lee curva, política ni override).
      const b = await this.decider.loadBatch(missing);
      for (const [id, s] of await liveSalesFor(this.decider, missing, dials, b)) out.set(id, s);
      void this.enqueue('missing_row', missing.map((m) => m.id));
    }
    return out;
  }

  // ───────────────────────────────────────────── diaria y salud ─────────────────────────────────────────────

  /** El día de portada cuya corrida diaria ya toca en `now` (desde `effectiveFrom(D) − 60 min`). */
  static dailyDayAt(now: Date, hour: number): string {
    return dayMx(new Date(now.getTime() + DAILY_RUN_LEAD_MS - hour * HOUR_MS));
  }

  /** ¿Hay `daily` ok del día de portada `ymd`? */
  async hasDailyOk(ymd: string): Promise<boolean> {
    const r = await this.prisma.listingPriceRun.findFirst({
      where: { trigger: 'daily', businessDate: dbDate(ymd), status: 'ok' },
      select: { id: true },
    });
    return r != null;
  }

  /**
   * §DYN.5.3 `daily` — lo llama el tic de `featured-rotation` cada 15 min: si ya es `effectiveFrom(D) − 60 min` y no hay `daily`
   * ok de `D`, calcula TODO (awaited). Un fallo deja la corrida `failed` y el siguiente tic reintenta.
   */
  async dailyTick(now: Date = new Date()): Promise<{ status: 'ran' | 'exists' | 'waiting' | 'failed'; businessDate: string }> {
    const hour = await this.settings.getNumber(SettingKey.FEATURED_ROTATION_HOUR);
    const day = ListingPriceService.dailyDayAt(now, hour);
    if (now.getTime() < portadaEffectiveFrom(day, hour).getTime() - DAILY_RUN_LEAD_MS) return { status: 'waiting', businessDate: day };
    if (await this.hasDailyOk(day)) return { status: 'exists', businessDate: day };
    const res = await this.run('daily', undefined, { businessDate: day });
    return { status: res.status === 'ok' ? 'ran' : 'failed', businessDate: day };
  }

  /** §DYN.5.8 — `dataHealth.listingPrices`: `stale` ⇔ no hay `daily` ok del día vigente pasada su `effectiveFrom`. */
  async health(now: Date = new Date()): Promise<ListingPricesHealth> {
    const hour = await this.settings.getNumber(SettingKey.FEATURED_ROTATION_HOUR);
    const last = await this.prisma.listingPriceRun.findFirst({
      where: { trigger: 'daily', status: 'ok' },
      orderBy: { businessDate: 'desc' },
      select: { businessDate: true },
    });
    if (!last) return { status: 'never', lastDailyBusinessDate: null };
    const lastYmd = ymdOf(last.businessDate);
    const serving = portadaServedDay(now, hour);
    return { status: lastYmd >= serving ? 'ok' : 'stale', lastDailyBusinessDate: lastYmd };
  }
}

/** Para los que construyen el lector a mano (pruebas unitarias): el cuerpo único sobre un `PricingService`. */
export function saleDecisionOf(pricing: PricingService): SaleDecisionService {
  return new SaleDecisionService(pricing);
}
