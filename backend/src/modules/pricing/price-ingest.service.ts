import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CardSet, Finish } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { SettingKey } from '../settings/settings.constants';
import { PricingService } from './pricing.service';
import { BulkFetchInput, BulkPriceProvider, BulkPriceRow, cardNumberVariants } from './pricing.types';
import { PokemonPriceTrackerBulkProvider } from './providers/pokemonpricetracker-bulk.provider';
import { PokemonTcgIoBulkProvider } from './providers/pokemontcg-io-bulk.provider';
import { TcgcsvSinglesBulkPriceProvider } from './providers/tcgcsv-singles-bulk.provider';
import { orderFinishes } from '../../common/card-order';
// H-1 (§4.36.6): «presente ⇔ > 0» en UN solo predicado compartido.
import { hasManualPrice } from '../../common/money';
import { FinishReconciler } from '../catalog/finish-reconciler.service';
import { PptSetMapper } from './ppt-set-mapper.service';
import { SetScope, classifySet, isModernSet, isPremiumRarity } from './ppt-sync-scope';
import { AuditService } from '../audit/audit.service';

/** InventoryStatus que NO cuentan como "activo" para el scope parcial (regla del PO: no withdrawn/lost). */
const INACTIVE_INVENTORY_STATUSES: ReadonlyArray<'withdrawn' | 'lost'> = ['withdrawn', 'lost'];

/** Scope resuelto de un set para la ingesta de PPT (+ cartas permitidas en el caso parcial). */
interface SetScopeInfo {
  scope: SetScope;
  /** cardIds permitidos en el caso `partial` (inventario activo ∪ rares). `null` en full/skip. */
  allowedCardIds: Set<string> | null;
}

/** Snapshot de FX cargado UNA vez por corrida (§4.15f), pasado a cada set. */
export type FxSnapshot = { rate: number; bufferPct: number };

/** v1.50.2 (§4.38h) — resultado de UNA corrida del ingest de estimados PSA. Todo es observabilidad. */
export interface GradedIngestResult {
  /** ¿El dial `graded_estimate_ingest_enabled` estaba `on` **y** la config del ingest era válida? */
  enabled: boolean;
  sets: number;
  cardsInScope: number;
  written: number;
  /** Filas NO escritas porque había override MANUAL del día (§O.6: el manual gana). */
  skippedManual: number;
  /** Saltadas por INV-D (§4.38l): hay slab PUBLICADO de ese grado ⇒ esa fila es dinero real. */
  skippedSlabPublished: number;
  /** Descartadas por `count < minSampleCount` **o** `count` DESCONOCIDO (fail-closed, §4.38k.1). */
  skippedSample: number;
  /** Entradas cuya forma el parser NO identificó positivamente ⇒ **no se escribió nada** de ellas. */
  unrecognized: number;
  dailyLimited: boolean;
  /** ⛔ Presente ⇒ el job PARÓ y hay que volver al ARQUITECTO (regla 9). */
  escalation: { reason: string; detail: string } | null;
}

/** Resumen de la ingesta de un set (observabilidad; NO expuesto por contrato). */
export interface IngestSetResult {
  setId: string;
  setExternalId: string | null;
  provider: string;
  /** Cartas locales tocadas (con ≥1 fila válida resuelta). */
  cardCount: number;
  /** Filas `PriceReference` upserteadas (por carta+acabado). */
  priced: number;
  /** Filas devueltas por el adapter que NO resolvieron a una carta local. */
  unresolved: number;
  /** Entradas omitidas por el adapter (mal formadas) + no resueltas. */
  skipped: number;
  /**
   * WS-A fix-ppt — el proveedor de paga agotó la cuota DIARIA en este set (429 daily). El orquestador
   * debe DETENER el barrido de los sets restantes (no resetea hasta 00:00 UTC). `undefined`/`false`
   * = la cuota no se agotó.
   */
  dailyLimited?: boolean;
  /** Scope aplicado a este set (`full`/`partial`/`skip`) — observabilidad del reporte. */
  scope?: SetScope;
  /** N-11 — presupuesto diario vivo tras este set (para la barra de progreso). */
  dailyRemaining?: number | null;
}

/**
 * N-11 (barra de progreso del sync de precios) — estado OBSERVABLE del barrido en curso (o del
 * último), en memoria del proceso. Calca `catalog-sync.getSyncStatus`. `GET /admin/pricing/sync-status`
 * lo expone; el front lo pollea. NO persistido (se pierde al reiniciar, como el de catálogo).
 */
export interface PriceSyncStatus {
  running: boolean;
  jobId: string | null;
  /** Sets a procesar en la corrida. */
  total: number;
  /** Sets ya intentados (éxito o fallo) — barra honesta done/total. */
  done: number;
  startedAt: string | null;
  finishedAt: string | null;
  /** Último error del barrido (mensaje), o null. */
  lastError: string | null;
  /** Presupuesto diario vivo restante del proveedor de paga, o null. */
  dailyRemaining: number | null;
  /** true si el barrido se DETUVO por límite diario (429 daily) → aviso "pausado hasta 00:00 UTC". */
  dailyLimited: boolean;
  /** Sets que quedaron pendientes si se detuvo por límite diario. */
  pending: number;
  /** Proveedor de la corrida (`pokemonpricetracker`/`pokemontcg_io`). */
  provider: string | null;
}

/**
 * PriceIngestService — corazón de WS-A (ARCHITECTURE §4.15c). Ingesta MASIVA de precios por SET
 * vía un `BulkPriceProvider` pluggable, con **upsert idempotente** de `PriceReference` por
 * `(cardId, 'raw', 'raw:NM', finish, hoy)`.
 *
 * ⛔ **v1.22-variantes-orden (§4.22a): NUNCA escribe `Card.availableFinishes`.** El refresco directo
 * de la lista blanca desde el proveedor (§4.15e) quedó DEROGADO — era la causa raíz del bug de tres
 * rondas del PO (VAR-1, §9): derivar las VARIANTES de la existencia de un PRECIO borraba el reverse
 * holo de toda carta sin precio de reverse holo.
 *
 * ✅ **v1.22-1 (§4.22g): Señal C money-safe.** Lo que este servicio SÍ hace ahora es escribir su
 * PROPIA columna de entrada `Card.pricedFinishesSnapshot` = los acabados que PPT reportó con
 * `market>0` y **alias VERIFICADO** (candado 2), por REEMPLAZO por carta en una corrida EXITOSA, y
 * luego LLAMAR a `FinishReconciler.reconcile(cardIds)` (§4.22g candado 4). El ÚNICO escritor de
 * `availableFinishes` sigue siendo el reconciliador del módulo `catalog`; aquí seguimos haciendo
 * CERO escrituras sobre `availableFinishes`. Ante fallo de PPT / 0 filas NO se toca ningún snapshot
 * (stale money-safe, como hoy no se borran precios). El drift se LOGUEA (`finishNotInCatalog`).
 *
 * ✅ **v1.27 (P-13, §4.25a): el snapshot ya NO compone `availableFinishes`** (el precio CONFIRMA,
 * nunca AÑADE; la lista blanca sale SOLO de `structuralFinishes`). El snapshot se conserva como
 * observabilidad/confirmación, y las filas del modo FORZADO (`fetchPrintings`, finish por etiqueta
 * de request) quedan EXCLUIDAS de él (§4.25a-2): sirven para precios, jamás como evidencia.
 *
 * - **Provider por dial:** `providerFor()` lee `PRICE_PROVIDER` y elige la implementación.
 * - **Resolución carta↔BD (§4.15d):** externalId (primario) → `(set, number)` (fallback); sin
 *   resolución → se OMITE (no crea `PriceReference` huérfana). Vive AQUÍ (no en el adapter) porque
 *   necesita la BD y el `BulkPriceRow` trae los identificadores (no un cardId ya resuelto).
 * - **FX una vez por corrida (§4.15f):** el `fx` lo carga el JOB y se pasa a cada `ingestSet`.
 * - **Money-safe:** respeta overrides manuales (vía `PricingService.persistMarketReference`), no
 *   toca `availableFinishes` en ningún caso (§4.22a), MXN sin conversión.
 */
@Injectable()
export class PriceIngestService {
  private readonly logger = new Logger(PriceIngestService.name);

  /**
   * N-11 — estado en memoria del barrido de precios (barra de progreso). Calca el patrón de
   * `catalog-sync`. Se inicializa "vacío/terminado"; lo maneja `ingestAll` (barrido completo).
   */
  private syncStatus: PriceSyncStatus = {
    running: false,
    jobId: null,
    total: 0,
    done: 0,
    startedAt: null,
    finishedAt: null,
    lastError: null,
    dailyRemaining: null,
    dailyLimited: false,
    pending: 0,
    provider: null,
  };

  /** GET /admin/pricing/sync-status — progreso del barrido de precios en curso (o del último). */
  getSyncStatus(): PriceSyncStatus {
    return { ...this.syncStatus };
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly pricing: PricingService,
    private readonly pptBulk: PokemonPriceTrackerBulkProvider,
    private readonly tcgIoBulk: PokemonTcgIoBulkProvider,
    // v1.22-1 (§4.22g): tras escribir `pricedFinishesSnapshot` (Señal C), este servicio LLAMA al
    // ÚNICO escritor de `availableFinishes`. NUNCA escribe `availableFinishes` directamente.
    private readonly finishReconciler: FinishReconciler,
    // WS-A fix-ppt: resuelve `CardSet.pptSetId` (causa raíz #1) y lee los diales de scope/throttle.
    private readonly pptSetMapper: PptSetMapper,
    private readonly config: ConfigService,
    // v1.44 (P-47, §4.35): PRIMARIO del barrido de singles por-acabado desde TCGCSV `tcgcsv_singles`.
    // Opcional en el constructor para no forzar la actualización de los mocks de tests que no lo usan
    // (dial != 'tcgcsv_singles' nunca lo dereferencia); en DI real SIEMPRE se inyecta.
    private readonly tcgcsvSinglesBulk?: TcgcsvSinglesBulkPriceProvider,
    // v1.50.2 (§4.38h.4): la TRAZA por carta saltada es OBLIGATORIA, no opcional — sin ella el descarte
    // por `count` bajo sería INVISIBLE (el `preview` lo vería como `NO_PSA10`, porque la fila no
    // existe). Va al final y opcional por la MISMA razón que `tcgcsvSinglesBulk`: no romper los mocks
    // posicionales de los tests que no tocan este camino. `AuditModule` es @Global ⇒ en DI real
    // SIEMPRE se inyecta.
    private readonly audit?: AuditService,
  ) {}

  /** Elige el `BulkPriceProvider` según el dial `PRICE_PROVIDER` (default legacy pokemontcg_io). */
  async providerFor(): Promise<BulkPriceProvider> {
    const wanted = await this.settings.getString(SettingKey.PRICE_PROVIDER);
    // v1.44 (§4.35): `tcgcsv_singles` entra como opción PRIMARIA del barrido. Se filtra `undefined`
    // (mocks de tests que no inyectan el provider) para no reventar el `.find`.
    const candidates: Array<BulkPriceProvider | undefined> = [
      this.pptBulk,
      this.tcgIoBulk,
      this.tcgcsvSinglesBulk,
    ];
    const providers = candidates.filter((p): p is BulkPriceProvider => p != null);
    const chosen = providers.find((p) => p.source === wanted);
    if (!chosen) {
      this.logger.warn(`PRICE_PROVIDER="${wanted}" desconocido → fallback a pokemontcg_io (legacy).`);
      return this.tcgIoBulk;
    }
    return chosen;
  }

  /** IDs internos de TODOS los `CardSet` locales (parent fan-out + fallback secuencial). */
  async listLocalSetIds(): Promise<string[]> {
    const sets = await this.prisma.cardSet.findMany({ select: { id: true } });
    return sets.map((s) => s.id);
  }

  /**
   * ¿Hubo ingesta de MERCADO reciente? (catch-up al boot, auditoría 2026-08-17).
   * "Reciente" = existe ≥1 `PriceReference` NO-manual con `capturedDate` de hoy o ayer (UTC).
   * Los overrides manuales del admin NO cuentan: un admin poniendo un precio a mano no
   * significa que el ingest masivo haya corrido.
   */
  async hasRecentIngest(): Promise<boolean> {
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    since.setUTCDate(since.getUTCDate() - 1);
    const row = await this.prisma.priceReference.findFirst({
      where: { capturedDate: { gte: since }, isManualOverride: false },
      select: { id: true },
    });
    return row !== null;
  }

  /**
   * Ingesta de UN set por su id interno (child job `price-ingest-set`). Idempotente.
   * `fx` = snapshot cargado una vez por corrida.
   */
  async ingestSet(setId: string, fx: FxSnapshot): Promise<IngestSetResult> {
    const set = await this.prisma.cardSet.findUnique({ where: { id: setId } });
    if (!set) {
      this.logger.warn(`price-ingest-set: set ${setId} no existe localmente; se omite.`);
      return this.emptyResult(setId, null, 'none');
    }
    return this.ingestForSet(set, fx);
  }

  /**
   * WS-A fix-ppt — SETS a ingerir en la corrida completa, aplicando el SCOPE del PO cuando el
   * proveedor es el de PAGA (PokemonPriceTracker): sets modernos (año ≥ umbral) + sets viejos con
   * cartas en scope (inventario activo ∪ rares). Con el proveedor legacy (pokemontcg_io) NO hay
   * scope (se devuelven TODOS los sets, como siempre). El orden pone los modernos primero (mayor
   * valor de mercado) para que, si la cuota diaria se agota a media corrida, lo pendiente sea lo
   * menos crítico (sets viejos).
   */
  async listSetIdsForIngest(): Promise<string[]> {
    const provider = await this.providerFor();
    const sets = await this.prisma.cardSet.findMany();
    if (provider.source !== 'pokemonpricetracker') return sets.map((s) => s.id);

    const modern: string[] = [];
    const partial: string[] = [];
    let skipped = 0;
    for (const set of sets) {
      if (isModernSet(set)) {
        modern.push(set.id);
        continue;
      }
      const { scope } = await this.computeScope(set);
      if (scope === 'partial') partial.push(set.id);
      else skipped += 1;
    }
    this.logger.log(
      `price-ingest scope (pokemonpricetracker): ${modern.length} sets modernos (≥2020, full) + ` +
        `${partial.length} viejos con inventario/rares (partial), ${skipped} viejos omitidos (bulk).`,
    );
    return [...modern, ...partial];
  }

  /**
   * Ingesta de UN set por su externalId (`sv8`) o su id interno — para el disparo manual
   * `POST /admin/jobs/price-ingest { setId }` (verificación de esquema en la 1ª corrida, §4.15h).
   */
  async ingestSetByExternalId(setIdOrExternal: string, fx: FxSnapshot): Promise<IngestSetResult> {
    const set = await this.prisma.cardSet.findFirst({
      where: { OR: [{ externalId: setIdOrExternal }, { id: setIdOrExternal }] },
    });
    if (!set) {
      this.logger.warn(`price-ingest: set "${setIdOrExternal}" no encontrado (externalId/id); se omite.`);
      return this.emptyResult(setIdOrExternal, null, 'none');
    }
    // Disparo MANUAL de un set concreto (verificación de esquema, §4.15h): se fuerza el barrido
    // COMPLETO aunque el scope lo clasificaría como `skip` (el operador lo pidió explícitamente).
    return this.ingestForSet(set, fx, { manual: true });
  }

  /**
   * Ingesta secuencial y AWAITED del catálogo EN SCOPE (fallback sin Redis, §4.15c). Se DETIENE si el
   * proveedor de paga agota la cuota DIARIA (429 daily) y reporta cuántos sets quedaron pendientes
   * (money-safe: no se reintenta hasta 00:00 UTC).
   */
  async ingestAll(fx: FxSnapshot): Promise<{ sets: number; priced: number; pending: number; dailyLimited: boolean }> {
    const provider = await this.providerFor();
    const ids = await this.listSetIdsForIngest();
    // N-11: publica el estado observable ANTES de arrancar (barra honesta done/total).
    const jobId = `price-ingest-${new Date().toISOString().slice(0, 10)}`;
    this.syncStatus = {
      running: true,
      jobId,
      total: ids.length,
      done: 0,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      lastError: null,
      dailyRemaining: null,
      dailyLimited: false,
      pending: ids.length,
      provider: provider.source,
    };

    let priced = 0;
    let dailyLimited = false;
    let processed = 0;
    try {
      for (const id of ids) {
        const res = await this.ingestSet(id, fx);
        priced += res.priced;
        processed += 1;
        // Progreso honesto: done por set intentado; dailyRemaining vivo si el proveedor lo reporta.
        this.syncStatus.done = processed;
        this.syncStatus.pending = ids.length - processed;
        if (res.dailyRemaining != null) this.syncStatus.dailyRemaining = res.dailyRemaining;
        if (res.dailyLimited) {
          dailyLimited = true;
          this.syncStatus.dailyLimited = true;
          break;
        }
      }
    } catch (e) {
      this.syncStatus.lastError = (e as Error).message;
      throw e;
    } finally {
      this.syncStatus.running = false;
      this.syncStatus.finishedAt = new Date().toISOString();
      this.syncStatus.pending = ids.length - processed;
    }

    const pending = ids.length - processed;
    if (dailyLimited) {
      this.logger.warn(
        `price-ingest (secuencial): PARADA por cuota DIARIA agotada tras ${processed}/${ids.length} sets ` +
          `(${pending} pendientes; reintenta tras 00:00 UTC). ${priced} referencias escritas.`,
      );
    } else {
      this.logger.log(`price-ingest (secuencial): ${processed} sets, ${priced} referencias.`);
    }
    return { sets: ids.length, priced, pending, dailyLimited };
  }

  // ----------------------------------------------------------------------------

  private async ingestForSet(
    set: CardSet,
    fx: FxSnapshot,
    opts: { manual?: boolean } = {},
  ): Promise<IngestSetResult> {
    const provider = await this.providerFor();
    // v1.44 (P-47, §4.35): el PRIMARIO de singles reprecia SOLO por-acabado (marketPrice de TCGCSV por
    // CardProduct+finish) y NO re-resuelve estructura. Va por un camino DEDICADO, keyed por
    // `cardProductId`, que NO comparte el colapso `(cardId, finish)` ni el bloque snapshot/reconcile
    // del flujo PPT/pokemontcg.io (ese bloque tocaría estructura; §4.35 lo prohíbe a diario).
    if (provider.source === 'tcgcsv_singles') {
      return this.ingestSinglesForSet(set, provider, fx);
    }
    const input = await this.buildFetchInput(provider, set, opts.manual === true);
    if (input === 'skip') {
      // Set viejo sin inventario activo ni rares (scope PO): no se pide nada (ahorra créditos).
      this.logger.log(`price-ingest-set(${set.externalId}, ${provider.source}): scope=skip (viejo sin inventario/rares).`);
      const empty = this.emptyResult(set.id, set.externalId, provider.source);
      return { ...empty, scope: 'skip' };
    }
    const { fetchInput, scope, allowedCardIds } = input;
    const result = await provider.fetchPricesForSet(fetchInput);

    // Agrupa las filas VÁLIDAS por cardId RESUELTO (§4.15c/§4.15d). En scope `partial`, SOLO se
    // conservan las cartas permitidas (inventario activo ∪ rares) — así, aunque el barrido traiga
    // el set entero, NO se persiste el bulk de comunes de un set viejo (regla del PO).
    const byCard = new Map<string, Map<Finish, BulkPriceRow>>();
    let unresolved = 0;
    let outOfScope = 0;
    for (const row of result.rows) {
      const cardId = await this.resolveCardId(row, set);
      if (!cardId) {
        unresolved += 1;
        continue;
      }
      if (allowedCardIds && !allowedCardIds.has(cardId)) {
        outOfScope += 1;
        continue;
      }
      const finishes = byCard.get(cardId) ?? new Map<Finish, BulkPriceRow>();
      // Si el proveedor repite un acabado para la misma carta, gana la ÚLTIMA (idempotente igual).
      finishes.set(row.finish, row);
      byCard.set(cardId, finishes);
    }

    // v1.22 (§4.22a): CATÁLOGO de acabados de las cartas tocadas — se lee SOLO para detectar drift
    // y LOGUEARLO (`finishNotInCatalog`). NUNCA para escribir `availableFinishes` desde aquí.
    const catalogFinishes = new Map<string, Finish[]>();
    if (byCard.size > 0) {
      const rows = await this.prisma.card.findMany({
        where: { id: { in: [...byCard.keys()] } },
        select: { id: true, externalId: true, availableFinishes: true },
      });
      for (const r of rows) catalogFinishes.set(r.id, (r.availableFinishes ?? ['normal']) as Finish[]);
    }

    let priced = 0;
    const driftPairs: string[] = [];
    for (const [cardId, finishes] of byCard) {
      const known = catalogFinishes.get(cardId) ?? ['normal'];
      for (const [finish, row] of finishes) {
        // El adapter ya garantizó market > 0; doble-guard money-safe.
        if (row.marketCents <= 0) continue;
        await this.pricing.persistMarketReference(
          cardId,
          finish,
          { marketCents: row.marketCents, currency: row.currency, source: provider.source },
          fx,
        );
        // §4.22a — DRIFT observable: el proveedor reporta un acabado que el CATÁLOGO no declara.
        // `PriceReference` se persiste igual (dato inocuo: el quote valida el finish contra
        // `Card.availableFinishes` ANTES de leer precio, SEC-A1), pero queda evidencia para el
        // dueño. El remedio es un `sync-all {force:true}` o el override manual — jamás escribir
        // la lista blanca desde un feed de precios.
        if (!known.includes(finish)) driftPairs.push(`${cardId}:${finish}`);
        priced += 1;
      }
      // ⛔ v1.22-variantes-orden (§4.22a-1/2): NUNCA se escribe `card.update({ availableFinishes })`
      // aquí (VAR-1, §9). La lista blanca la recompone SOLO el reconciliador (abajo), a partir de
      // las columnas de entrada. Este bucle solo persiste PRECIOS (tolerante con alias SUPUESTO).
    }

    // v1.22-1 (§4.22g) — Señal C: REEMPLAZO money-safe de `pricedFinishesSnapshot` + reconcile.
    // Solo en una corrida EXITOSA con filas (`requestOk && rows>0`): ante fallo total / 0 filas /
    // modo sample-only NO se toca ningún snapshot (stale conservador). Por cada carta VISTA con ≥1
    // fila válida, el snapshot se reemplaza por sus acabados con `market>0 && finishAliasVerified`
    // (vacío si ninguno es verificado ⇒ se limpia lo stale, reparabilidad §4.22g). Luego se llama
    // al ÚNICO escritor de `availableFinishes`. `price-ingest` JAMÁS escribe `availableFinishes`.
    //
    // v1.27 (P-13.2, §4.25a-2): las filas del modo FORZADO (`forcedPrinting`, finish por etiqueta
    // de request) NO son evidencia — se EXCLUYEN del snapshot. Si TODAS las filas de una carta son
    // forzadas (corrida `fetchPrintings`), su snapshot se CONSERVA tal cual (ni se escribe ni se
    // limpia: una corrida por-impresión no aporta ni retira evidencia del modo lista). El reconcile
    // SÍ corre igual: es idempotente y repara availableFinishes stale con la fórmula §4.25a.
    if (result.requestOk && result.rows.length > 0 && byCard.size > 0) {
      const reconcileIds: string[] = [];
      for (const [cardId, finishes] of byCard) {
        const evidence = [...finishes.values()].filter((row) => row.forcedPrinting !== true);
        if (evidence.length > 0) {
          const verified = orderFinishes(
            evidence
              .filter((row) => row.finishAliasVerified && row.marketCents > 0)
              .map((row) => row.finish),
          );
          await this.prisma.card.update({
            where: { id: cardId },
            data: { pricedFinishesSnapshot: verified },
          });
        }
        reconcileIds.push(cardId);
      }
      await this.finishReconciler.reconcile(reconcileIds);
    }

    // v2.1.1 (P-48, §4.36.5b-ter) — CONTINUIDAD DEL GUARDARRAÍL: el pase posterior al barrido ABRE
    // entradas, no solo las cierra. Hasta aquí la SALIDA de la cola cabalgaba sobre el barrido (una
    // `PriceReference` nueva la cierra en la siguiente resolución) pero la ENTRADA estaba atada solo a
    // eventos de publicación: el guardarraíl se cerraba solo y NO se abría solo, así que cada
    // degradación futura del feed dependía de que alguien pulsara «publicar». Solo tras una corrida
    // EXITOSA con filas (mismo criterio conservador que el snapshot de acabados: ante fallo total o 0
    // filas no se concluye nada).
    if (result.requestOk && result.rows.length > 0) {
      await this.reconcilePublishedPrices(set);
    }

    if (driftPairs.length > 0) {
      this.logger.warn(
        `price-ingest-set(${set.externalId}, ${provider.source}): finishNotInCatalog — ` +
          `${driftPairs.length} referencia(s) de acabados FUERA de Card.availableFinishes ` +
          `[${driftPairs.slice(0, 20).join(', ')}${driftPairs.length > 20 ? ', …' : ''}]. ` +
          `El precio SÍ se persiste; el catálogo NO se modifica (§4.22a).`,
      );
    }

    this.logger.log(
      `price-ingest-set(${set.externalId}, ${provider.source}, scope=${scope}): ${byCard.size} cartas, ` +
        `${priced} refs, ${unresolved} sin resolver, ${outOfScope} fuera de scope, ` +
        `${result.skipped} omitidas por el adapter, ${driftPairs.length} finishNotInCatalog` +
        `${result.dailyLimited ? ', 429 DAILY (parada)' : ''}.`,
    );
    return {
      setId: set.id,
      setExternalId: set.externalId,
      provider: provider.source,
      cardCount: byCard.size,
      priced,
      unresolved,
      skipped: result.skipped + unresolved + outOfScope,
      dailyLimited: result.dailyLimited,
      scope,
      dailyRemaining: result.dailyRemaining ?? null,
    };
  }

  /**
   * v1.44 (P-47, §4.35) — barrido DIARIO de PRECIO por-acabado de singles desde TCGCSV
   * `tcgcsv_singles`. El provider ya hizo el join EXACTO por `CardProduct.tcgplayerProductId` y
   * devuelve una fila por `(cardProductId, finish, marketCents>0)`; aquí SOLO se upsertea la
   * `PriceReference` keyed por `cardProductId` (source `tcgcsv_singles`, FX del snapshot), respetando
   * `isManualOverride` (lo garantiza `persistMarketReference`).
   *
   * SEPARACIÓN ESTRUCTURA ↔ PRECIO (§4.35a): NO escribe `CardProduct.finishes` ni
   * `Card.availableFinishes`, NO toca `pricedFinishesSnapshot`, NO llama al `FinishReconciler`. La
   * composición sigue GATEADA a import/`--force` (§4.27d). Money-safe: un acabado sin `marketPrice`
   * fresco en TCGCSV NO produce fila (el provider ya lo omitió) ⇒ queda «—»/PRICE_PENDING, jamás el
   * precio de otro acabado ni un 0. La precedencia §4.27f (`sourceRank`/`isBetterRef`) hace que la
   * fila `tcgcsv_singles` (con `cardProductId`) gane sobre cualquier residuo de PPT (`cardProductId=null`).
   */
  private async ingestSinglesForSet(
    set: CardSet,
    provider: BulkPriceProvider,
    fx: FxSnapshot,
  ): Promise<IngestSetResult> {
    const result = await provider.fetchPricesForSet({ set });
    const touchedCards = new Set<string>();
    let priced = 0;
    let skipped = result.skipped;
    for (const row of result.rows) {
      // Defensa en profundidad: el provider de singles SIEMPRE puebla ambos; sin ellos no se escribe
      // (nunca una `PriceReference` huérfana ni una variante sin su `cardProductId` money-safe).
      if (!row.cardId || !row.cardProductId) {
        skipped += 1;
        continue;
      }
      if (!(row.marketCents > 0)) {
        skipped += 1;
        continue;
      }
      await this.pricing.persistMarketReference(
        row.cardId,
        row.finish,
        { marketCents: row.marketCents, currency: row.currency, source: 'tcgcsv_singles' },
        fx,
        row.cardProductId,
      );
      touchedCards.add(row.cardId);
      priced += 1;
    }
    this.logger.log(
      `price-ingest-set(${set.externalId}, tcgcsv_singles): ${touchedCards.size} cartas, ${priced} ` +
        `refs por-acabado (keyed por cardProduct), ${skipped} omitidas` +
        `${result.requestOk ? '' : ' [fetch FALLÓ → 0 filas, precios previos STALE]'}. ` +
        `Estructura NO re-resuelta (§4.35).`,
    );
    // §4.36(c) — COEXISTENCIA de las DOS CAPAS ortogonales (ESCRIBIR-luego-LEER): la capa REFERENCIA
    // (P-47, `tcgcsv_singles`) acaba de upsertear las `PriceReference` per-acabado del set; ahora la
    // capa REGLA (curva v2) LEE esas mismas filas para re-resolver el precio de venta de las piezas
    // PUBLICADAS y abrir/cerrar su entrada en la cola. Sin esto, el barrido PRIMARIO (tcgcsv_singles)
    // repreciaría la referencia pero NUNCA re-resolvería la curva de lo ya `listed` (regresión del
    // guardarraíl continuo, §4.36.5b-ter). Mismo criterio conservador que el flujo PPT/pokemontcg.io:
    // solo tras una corrida EXITOSA con filas. Falla-seguro (los precios YA se persistieron).
    if (result.requestOk && result.rows.length > 0) {
      await this.reconcilePublishedPrices(set);
    }
    return {
      setId: set.id,
      setExternalId: set.externalId,
      provider: provider.source,
      cardCount: touchedCards.size,
      priced,
      unresolved: 0,
      skipped,
      dailyLimited: false,
      scope: 'full',
      dailyRemaining: null,
    };
  }

  /**
   * v2.1.1 (P-48, §4.36.5b-ter) — RE-RESUELVE el precio de venta de las piezas PUBLICADAS del set que
   * el barrido acaba de repreciar y **abre o cierra** su entrada en la cola según el veredicto. Es lo
   * que hace CONTINUO al guardarraíl: sin esto, una pieza ya `listed` cuyo mercado se degrada deja de
   * venderse en silencio hasta que alguien pulse «publicar» (§N.5 pide lo contrario).
   *
   * - **No es un job nuevo ni una fan-out nueva:** es el lote que el barrido YA tiene en la mano.
   * - **Alcance = el SET completo, no solo las variantes con fila nueva.** A propósito: el caso feo es
   *   justamente el acabado/carta que el proveedor DEJÓ de reportar; si solo mirásemos lo que vino en
   *   la respuesta, ese caso —el que más se parece a una degradación real— nunca se detectaría.
   * - **Solo `raw`:** es lo que este barrido reprecia (`productType='raw'`, `gradeKey='raw:NM'`). El
   *   sellado y las gradeadas tienen su propio ingest y su propia clave de cola.
   * - **Las piezas con override manual POR PIEZA se saltan**, igual que en `resolvePublishSalePrice`:
   *   su precio no depende del mercado, así que ni escalan ni cierran nada.
   * - **NO cambia el `status`** (§4.36.5b-bis decisión 3): la pieza sigue `listed`. No hay exposición
   *   que cerrar (la resolución en lectura ya la sacó de Compra y de `stockCount`) y un flip
   *   `listed → in_stock` competiría con un checkout en vuelo. La señal es la entrada en la cola.
   *
   * Falla-seguro: un error aquí NO tumba la ingesta (los precios ya se persistieron); se loguea.
   */
  private async reconcilePublishedPrices(set: CardSet): Promise<void> {
    try {
      const items = await this.prisma.inventoryItem.findMany({
        where: {
          ownerType: 'platform',
          status: 'listed',
          productType: 'raw',
          card: { setId: set.id },
        },
        include: { card: true },
      });
      if (items.length === 0) return;
      // Pago mínimo BE-25: curva izada UNA vez; referencias y overrides EN LOTE (sin N+1 por pieza).
      const curve = await this.pricing.loadPricingCurve();
      const keys = items.map((it) => ({
        cardId: it.cardId,
        productType: it.productType,
        gradeKey: this.pricing.gradeKeyFor(it),
        finish: it.finish,
      }));
      const refs = await this.pricing.getReferencesBatch(keys);
      const overrides = await this.pricing.getVariantOverridesBatch(keys);
      let opened = 0;
      let closed = 0;
      for (const item of items) {
        // Override manual POR PIEZA: el precio no sale del mercado ⇒ el barrido no opina sobre su cola.
        // H-1 (E5-bis): `<= 0` es AUSENTE, así que esa pieza SÍ deriva de la curva y SÍ tiene que
        // entrar al barrido. Con el `!= null` de antes se saltaba y NUNCA se reconciliaba — el mismo
        // hueco de D5, recién abierto por este bucle.
        if (hasManualPrice(item)) continue;
        const gradeKey = this.pricing.gradeKeyFor(item);
        const key = `${item.cardId}|${item.productType}|${gradeKey}|${item.finish}`;
        const ref = refs.get(key);
        const refCents = ref && ref.status === 'priced' ? (ref.referenceMxnCents ?? null) : null;
        // SEAM ÚNICO del eje de venta (§4.36.5b): mismo cuerpo, mismo veredicto que publicación y
        // checkout — el barrido no puede llegar a una conclusión distinta de la del storefront.
        const decision = this.pricing.decideSalePrice({
          referenceMxnCents: refCents,
          rarityCanonical: item.card.rarityCanonical ?? item.card.rarity,
          controls: overrides.get(key) ?? null,
          curve,
        });
        // §4.36.5c: el MISMO seam abre y cierra. `reason != null` ⇒ entra a la cola; `null` ⇒ se cierra
        // la entrada abierta de esa clave si el mercado volvió a resolver.
        await this.pricing.settlePendingForVariant(
          decision.pendingReason,
          { cardId: item.cardId, productType: item.productType, gradeKey, finish: item.finish },
          'inventory',
        );
        if (decision.pendingReason != null) opened++;
        else closed++;
      }
      if (opened > 0) {
        this.logger.warn(
          `price-ingest-set(${set.externalId}): ${opened} pieza(s) PUBLICADA(s) dejaron de resolver precio ` +
            `tras el barrido y entraron a la cola (siguen \`listed\`); ${closed} re-verificada(s) sana(s).`,
        );
      }
    } catch (e) {
      this.logger.warn(
        `price-ingest-set(${set.externalId}): la reconciliación de piezas publicadas falló ` +
          `(los precios YA se persistieron): ${(e as Error).message}`,
      );
    }
  }

  /**
   * WS-A fix-ppt — arma la entrada de `fetchPricesForSet`. Para el proveedor legacy (pokemontcg_io)
   * es `{ set }` sin scope. Para el de PAGA (PokemonPriceTracker):
   *  - Resuelve `pptSetId` (causa raíz #1) vía `PptSetMapper` (una carga de `/api/v2/sets` cacheada).
   *  - Aplica el SCOPE del PO: modernos → full; viejos → partial (con `allowedCardIds` = inventario ∪
   *    rares) o skip. `manual` fuerza full (disparo explícito del operador).
   *  - Pasa `minPrice` (dial) en partial para no traer bulk desde el origen, y `fetchPrintings` (dial).
   * Devuelve `'skip'` si el set queda fuera de scope.
   */
  private async buildFetchInput(
    provider: BulkPriceProvider,
    set: CardSet,
    manual: boolean,
  ): Promise<'skip' | { fetchInput: BulkFetchInput; scope: SetScope; allowedCardIds: Set<string> | null }> {
    if (provider.source !== 'pokemonpricetracker') {
      return { fetchInput: { set }, scope: 'full', allowedCardIds: null };
    }

    const scopeInfo = manual
      ? ({ scope: 'full', allowedCardIds: null } as SetScopeInfo)
      : await this.computeScope(set);
    if (scopeInfo.scope === 'skip') return 'skip';

    const map = await this.pptSetMapper.resolveForSets([set]);
    const providerSetId = map.get(set.id) ?? null;

    const fetchInput: BulkFetchInput = {
      set,
      providerSetId,
      // En partial: `minPrice` (unidad del proveedor) para excluir bulk en el origen. Dial opcional;
      // sin él, el filtro de allowedCardIds igual evita persistir bulk (a costa de más créditos).
      minPrice: scopeInfo.scope === 'partial' ? this.partialMinPrice() : null,
      fetchPrintings: this.fetchPrintingsEnabled(),
    };
    return { fetchInput, scope: scopeInfo.scope, allowedCardIds: scopeInfo.allowedCardIds };
  }

  /**
   * WS-A fix-ppt — SCOPE de un set (regla del PO). Moderno (año ≥ umbral) → full. Viejo → partial si
   * tiene ≥1 carta con inventario ACTIVO (no withdrawn/lost) ∪ carta RARA; si no, skip. Devuelve los
   * `cardIds` permitidos para el filtro de persistencia del caso partial.
   */
  private async computeScope(set: CardSet): Promise<SetScopeInfo> {
    if (isModernSet(set)) return { scope: 'full', allowedCardIds: null };

    // Cartas del set con inventario ACTIVO.
    const invItems = await this.prisma.inventoryItem.findMany({
      where: { card: { setId: set.id }, status: { notIn: [...INACTIVE_INVENTORY_STATUSES] } },
      select: { cardId: true },
      distinct: ['cardId'],
    });
    // Cartas PREMIUM/CHASE del set (refinamiento PO: Illustration Rare para arriba + ex/GX/V…;
    // NO bulk, NO rare normal, NO reverse holo como tier). Ver `isPremiumRarity`.
    const cards = await this.prisma.card.findMany({
      where: { setId: set.id },
      select: { id: true, rarity: true },
    });
    const allowed = new Set<string>();
    for (const it of invItems) allowed.add(it.cardId);
    for (const c of cards) if (isPremiumRarity(c.rarity)) allowed.add(c.id);

    const scope = classifySet(set, allowed.size);
    return { scope, allowedCardIds: scope === 'partial' ? allowed : null };
  }

  /** Dial `POKEMONPRICETRACKER_PARTIAL_MIN_PRICE` (unidad del proveedor); vacío → sin filtro. */
  private partialMinPrice(): string | null {
    const raw = this.config.get<string>('POKEMONPRICETRACKER_PARTIAL_MIN_PRICE');
    return raw && String(raw).trim() !== '' ? String(raw).trim() : null;
  }

  /** Dial `POKEMONPRICETRACKER_FETCH_PRINTINGS=true` → barrido por impresión (reverse holo). */
  private fetchPrintingsEnabled(): boolean {
    return String(this.config.get<string>('POKEMONPRICETRACKER_FETCH_PRINTINGS') ?? '').toLowerCase() === 'true';
  }

  /**
   * Resuelve la carta local (§4.15d): externalId (PRIMARIO) → `(set, number)` (FALLBACK).
   * Sin resolución → null (la fila se OMITE en el llamador, no se crea referencia huérfana).
   *
   * P-6 (2026-08-18): el fallback tolera las VARIANTES de formato del número del proveedor de
   * paga (`"104/159"` o `"004"` contra nuestro `"104"`, ver `cardNumberVariants`). El número
   * EXACTO manda; solo si no casa se prueban las variantes, y únicamente se acepta si casan con
   * UNA sola carta del set (money-safe: ante ambigüedad se omite en vez de adivinar la carta).
   */
  private async resolveCardId(row: BulkPriceRow, set: CardSet): Promise<string | null> {
    if (row.externalId) {
      const byExt = await this.prisma.card.findUnique({
        where: { externalId: row.externalId },
        select: { id: true },
      });
      if (byExt) return byExt.id;
    }
    if (row.number) {
      // El ingest está acotado a ESTE set → el fallback busca por (set.id, number).
      const byNumber = await this.prisma.card.findFirst({
        where: { setId: set.id, number: row.number },
        select: { id: true },
      });
      if (byNumber) return byNumber.id;

      const variants = cardNumberVariants(row.number);
      if (variants.length > 0) {
        const matches = await this.prisma.card.findMany({
          where: { setId: set.id, number: { in: variants } },
          select: { id: true },
          take: 2,
        });
        if (matches.length === 1) return matches[0].id;
        if (matches.length > 1) {
          this.logger.warn(
            `price-ingest: el número "${row.number}" del proveedor casa con ${matches.length} cartas ` +
              `del set ${set.externalId} → se OMITE (no se adivina la carta).`,
          );
        }
      }
    }
    return null;
  }

  /**
   * v1.50.2 (§4.38h) — **INGEST AUTOMÁTICO DE ESTIMADOS PSA (fase 2).** Deja de ser manual.
   *
   * ### Alcance: SOLO cartas con INVENTARIO PUBLICADO (y por qué eso resuelve la cuota)
   * `includeEbay=true` cuesta **2 créditos por carta**. Barrer el catálogo entero sería insostenible;
   * pedir precio de gradeo **solo de lo que efectivamente estamos vendiendo** hace el coste
   * proporcional al inventario real, que es el único conjunto donde el estimado tiene superficie donde
   * mostrarse (una carta sin publicar no tiene teja ni ficha). Encima va el tope DURO
   * `graded_estimate_ingest_max_cards_per_run` (seed 250): un error de alcance no puede quemar la
   * cuota del día.
   *
   * ### Fail-closed en tres puntos, todos deliberados
   *  1. `graded_estimate_ingest_enabled` (seed `off`) — dial PROPIO, distinto del de exhibición: se
   *     puede rodar el ingest **en observación con la vitrina apagada** (§4.38d).
   *  2. `ingestConfigInvalid` — con `minSampleCount`/`sourceStat` corruptos NO sabemos *cuánta* muestra
   *     exigimos ni *qué número* es el precio. Adivinar eso es escribir dinero a ciegas.
   *  3. El parser solo escribe lo que identifica POSITIVAMENTE como monto (§4.38h.1).
   *
   * ### INV-D (§4.38l): la MISMA guarda que el override manual
   * Si la carta tiene un **slab publicado** de ese grado, esa fila **es el precio real** de esa pieza:
   * el job **la salta** y deja `AuditLog`. Es la misma regla que hace que
   * `POST /admin/pricing/override` con `intent:"graded_estimate"` devuelva `409`.
   *
   * ### ⛔ Escalada (regla 9)
   * Si el proveedor revela que `includeEbay=true` **no** combina con `fetchAllInSet=true`, el job
   * **PARA** y lo reporta: NO se degrada a «una petición por carta». Eso multiplicaría el coste por el
   * nº de cartas e invalidaría el modelo de barrido por set — rediseño de arquitectura y de costo, no
   * decisión de implementación.
   */
  async ingestGradedEstimates(fx: FxSnapshot): Promise<GradedIngestResult> {
    const result: GradedIngestResult = {
      enabled: false,
      sets: 0,
      cardsInScope: 0,
      written: 0,
      skippedManual: 0,
      skippedSlabPublished: 0,
      skippedSample: 0,
      unrecognized: 0,
      dailyLimited: false,
      escalation: null,
    };
    // Config COMPLETA (no la del storefront): los DOS diales son independientes, así que el ingest
    // tiene que poder correr con la EXHIBICIÓN apagada — que es la secuencia de encendido que pide
    // §4.38h («rodar en observación antes de publicar»).
    const cfg = await this.pricing.loadGradedEstimateConfigForAdmin();
    if (!cfg.ingestEnabled) {
      this.logger.log('graded-estimate-ingest: dial `graded_estimate_ingest_enabled` = off → no se pide nada.');
      return result;
    }
    if (cfg.ingestConfigInvalid) {
      this.logger.warn(
        'graded-estimate-ingest: config del INGEST presente-pero-INVÁLIDA (minSampleCount/sourceStat/' +
          'ingestMaxCardsPerRun) → NO se escribe nada. Corrige con PUT /admin/pricing/graded-estimates.',
      );
      return result;
    }
    result.enabled = true;

    // ALCANCE: cartas con inventario RAW publicado. Orden DETERMINISTA (cardId asc) para que el tope
    // por corrida sea reproducible y no dependa del orden que devuelva la BD.
    const published = await this.prisma.inventoryItem.findMany({
      where: { ownerType: 'platform', status: 'listed', productType: 'raw' },
      select: { cardId: true },
      distinct: ['cardId'],
      orderBy: { cardId: 'asc' },
    });
    const cardIds = published.map((r) => r.cardId).slice(0, cfg.ingestMaxCardsPerRun);
    if (cardIds.length === 0) return result;
    result.cardsInScope = cardIds.length;

    const cards = await this.prisma.card.findMany({
      where: { id: { in: cardIds } },
      select: { id: true, setId: true, set: true },
    });
    const bySet = new Map<string, { set: CardSet; allowed: Set<string> }>();
    for (const c of cards) {
      if (!c.set) continue;
      const entry = bySet.get(c.setId) ?? { set: c.set, allowed: new Set<string>() };
      entry.allowed.add(c.id);
      bySet.set(c.setId, entry);
    }
    // INV-D — una sola query batcheada para TODO el alcance (jamás una por carta).
    const slabsByCard = await this.pricing.getPublishedSlabGradesBatch(cardIds);

    for (const { set, allowed } of bySet.values()) {
      const map = await this.pptSetMapper.resolveForSets([set]);
      const providerSetId = map.get(set.id) ?? null;
      const res = await this.pptBulk.fetchGradedEstimatesForSet({
        set,
        providerSetId,
        grades: cfg.grades,
        minSampleCount: cfg.minSampleCount,
        sourceStat: cfg.sourceStat,
      });
      result.sets += 1;
      result.unrecognized += res.drops.filter((d) => d.reason === 'unrecognized_shape').length;
      result.skippedSample += res.drops.filter((d) => d.reason === 'sample_too_small').length;

      // ⛔ ESCALADA — se PARA y se devuelve; no se intenta ninguna vía alternativa.
      if (res.escalate) {
        result.escalation = res.escalate;
        this.logger.error(
          `⛔ graded-estimate-ingest ESCALADA AL ARQUITECTO (regla 9, §4.38h.4): ${res.escalate.reason}. ` +
            `${res.escalate.detail} — el job PARA. NO se implementa el modo «una petición por carta»: ` +
            'cambia el modelo de coste (2 créditos × carta) y obliga a un ingest CURADO POR LISTA, que ' +
            'es decisión de arquitectura y de presupuesto.',
        );
        await this.auditGradedSkip('graded_estimate.ingest.escalated', null, {
          setExternalId: set.externalId,
          ...res.escalate,
        });
        return result;
      }

      // La traza de los DESCARTES del parser es obligatoria: sin ella, el descarte por muestra baja es
      // invisible para el operador (la fila sencillamente no existe y el preview dice `NO_PSA10`).
      for (const d of res.drops) {
        this.logger.warn(
          `graded-estimate-ingest: DESCARTADA entrada (${d.reason}) set=${set.externalId} ` +
            `card=${d.externalId ?? 'n/d'} count=${d.count ?? 'DESCONOCIDO'} muestra=${d.sample}`,
        );
        await this.auditGradedSkip('graded_estimate.ingest.skipped', null, {
          setExternalId: set.externalId,
          providerCardId: d.externalId,
          reason: d.reason,
          count: d.count,
          sample: d.sample,
        });
      }

      for (const row of res.rows) {
        const cardId = await this.resolveCardId(
          { externalId: row.externalId, number: row.number } as BulkPriceRow,
          set,
        );
        if (!cardId || !allowed.has(cardId)) continue; // fuera del alcance publicado ⇒ no se escribe.
        // INV-D: con slab publicado de ese grado, esa fila es DINERO de una pieza real.
        if ((slabsByCard.get(cardId) ?? []).includes(row.gradeValue)) {
          result.skippedSlabPublished += 1;
          this.logger.warn(
            `graded-estimate-ingest: SALTADA card=${cardId} PSA ${row.gradeValue} — hay slab PUBLICADO ` +
              'de ese grado (INV-D, §4.38l): esa fila es su precio de mercado REAL, no un estimado.',
          );
          await this.auditGradedSkip('graded_estimate.ingest.skipped', cardId, {
            reason: 'slab_published',
            gradeValue: row.gradeValue,
          });
          continue;
        }
        // INV-FX: `currency` viaja tal cual del proveedor; el escritor decide dónde cae el numeral.
        const wrote = await this.pricing.persistGradedEstimateReference(
          cardId,
          row.gradeValue,
          { amountCents: row.amountCents, currency: row.currency, source: 'pokemonpricetracker' },
          fx,
        );
        if (wrote) result.written += 1;
        else result.skippedManual += 1; // el override MANUAL gana (§O.6): no se pisa, se cuenta.
      }

      if (res.dailyLimited) {
        result.dailyLimited = true;
        this.logger.warn('graded-estimate-ingest: 429 DAILY → PARADA (lo ya escrito se conserva).');
        break;
      }
    }

    this.logger.log(
      `graded-estimate-ingest: ${result.sets} set(s), ${result.cardsInScope} carta(s) en alcance, ` +
        `${result.written} referencia(s) escritas, ${result.skippedManual} respetando override manual, ` +
        `${result.skippedSlabPublished} con slab publicado, ${result.skippedSample} por muestra ` +
        `insuficiente, ${result.unrecognized} con forma no reconocida.`,
    );
    return result;
  }

  /** Traza obligatoria en `AuditLog` (§4.38h.4). Nunca revienta el job por un fallo de bitácora. */
  private async auditGradedSkip(
    action: string,
    cardId: string | null,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (!this.audit) return;
    try {
      await this.audit.log({
        action,
        entityType: 'PriceReference',
        ...(cardId ? { entityId: cardId } : {}),
        after: payload,
      });
    } catch (e) {
      this.logger.warn(`graded-estimate-ingest: no se pudo escribir la bitácora: ${(e as Error).message}`);
    }
  }

  private emptyResult(setId: string, externalId: string | null, provider: string): IngestSetResult {
    return { setId, setExternalId: externalId, provider, cardCount: 0, priced: 0, unresolved: 0, skipped: 0 };
  }
}
