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
import { orderFinishes } from '../../common/card-order';
import { FinishReconciler } from '../catalog/finish-reconciler.service';
import { PptSetMapper } from './ppt-set-mapper.service';
import { SetScope, classifySet, isModernSet, isRareRarity } from './ppt-sync-scope';

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
  ) {}

  /** Elige el `BulkPriceProvider` según el dial `PRICE_PROVIDER` (default legacy pokemontcg_io). */
  async providerFor(): Promise<BulkPriceProvider> {
    const wanted = await this.settings.getString(SettingKey.PRICE_PROVIDER);
    const providers: BulkPriceProvider[] = [this.pptBulk, this.tcgIoBulk];
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
    const ids = await this.listSetIdsForIngest();
    let priced = 0;
    let dailyLimited = false;
    let processed = 0;
    for (const id of ids) {
      const res = await this.ingestSet(id, fx);
      priced += res.priced;
      processed += 1;
      if (res.dailyLimited) {
        dailyLimited = true;
        break;
      }
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
    if (result.requestOk && result.rows.length > 0 && byCard.size > 0) {
      const reconcileIds: string[] = [];
      for (const [cardId, finishes] of byCard) {
        const verified = orderFinishes(
          [...finishes.values()]
            .filter((row) => row.finishAliasVerified && row.marketCents > 0)
            .map((row) => row.finish),
        );
        await this.prisma.card.update({
          where: { id: cardId },
          data: { pricedFinishesSnapshot: verified },
        });
        reconcileIds.push(cardId);
      }
      await this.finishReconciler.reconcile(reconcileIds);
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
    };
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
    // Cartas RARAS del set (por rarity; el bulk common/uncommon se excluye).
    const cards = await this.prisma.card.findMany({
      where: { setId: set.id },
      select: { id: true, rarity: true },
    });
    const allowed = new Set<string>();
    for (const it of invItems) allowed.add(it.cardId);
    for (const c of cards) if (isRareRarity(c.rarity)) allowed.add(c.id);

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

  private emptyResult(setId: string, externalId: string | null, provider: string): IngestSetResult {
    return { setId, setExternalId: externalId, provider, cardCount: 0, priced: 0, unresolved: 0, skipped: 0 };
  }
}
