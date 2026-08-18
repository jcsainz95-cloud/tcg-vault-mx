import { Injectable, Logger } from '@nestjs/common';
import { CardSet, Finish } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { SettingKey } from '../settings/settings.constants';
import { PricingService } from './pricing.service';
import { BulkPriceProvider, BulkPriceRow, cardNumberVariants } from './pricing.types';
import { PokemonPriceTrackerBulkProvider } from './providers/pokemonpricetracker-bulk.provider';
import { PokemonTcgIoBulkProvider } from './providers/pokemontcg-io-bulk.provider';

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
}

/**
 * PriceIngestService — corazón de WS-A (ARCHITECTURE §4.15c). Ingesta MASIVA de precios por SET
 * vía un `BulkPriceProvider` pluggable, con **upsert idempotente** de `PriceReference` por
 * `(cardId, 'raw', 'raw:NM', finish, hoy)`.
 *
 * ⛔ **v1.22-variantes-orden (§4.22a): CERO escrituras sobre `Card`.** El refresco de
 * `Card.availableFinishes` desde el proveedor (§4.15e) queda **DEROGADO** — era la causa raíz del
 * bug de tres rondas del PO (VAR-1, §9): derivar las VARIANTES de la existencia de un PRECIO
 * borraba el reverse holo de toda carta sin precio de reverse holo. La autoridad única es el
 * **sync de catálogo** (`CatalogSyncService.upsertCards`). Aquí solo se LOGUEA el drift
 * (`finishNotInCatalog`).
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
    return this.ingestForSet(set, fx);
  }

  /** Ingesta secuencial y AWAITED de TODO el catálogo (fallback sin Redis, §4.15c). */
  async ingestAll(fx: FxSnapshot): Promise<{ sets: number; priced: number }> {
    const ids = await this.listLocalSetIds();
    let priced = 0;
    for (const id of ids) {
      const res = await this.ingestSet(id, fx);
      priced += res.priced;
    }
    this.logger.log(`price-ingest (secuencial): ${ids.length} sets, ${priced} referencias.`);
    return { sets: ids.length, priced };
  }

  // ----------------------------------------------------------------------------

  private async ingestForSet(set: CardSet, fx: FxSnapshot): Promise<IngestSetResult> {
    const provider = await this.providerFor();
    const result = await provider.fetchPricesForSet({ set });

    // Agrupa las filas VÁLIDAS por cardId RESUELTO (§4.15c/§4.15d).
    const byCard = new Map<string, Map<Finish, BulkPriceRow>>();
    let unresolved = 0;
    for (const row of result.rows) {
      const cardId = await this.resolveCardId(row, set);
      if (!cardId) {
        unresolved += 1;
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
      // ⛔ v1.22-variantes-orden (§4.22a-1/2): ELIMINADO el `card.update({ availableFinishes })`
      // que vivía aquí (VAR-1, §9). El price-ingest hace **CERO escrituras** sobre `Card`: derivar
      // las VARIANTES de la existencia de un PRECIO clobbeaba a `['normal']` toda carta cuyo
      // reverse holo no tuviera precio, y ensanchaba/estrechaba una lista blanca de seguridad
      // (SEC-A1) desde un feed de terceros. Autoridad única = `CatalogSyncService.upsertCards`.
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
      `price-ingest-set(${set.externalId}, ${provider.source}): ${byCard.size} cartas, ` +
        `${priced} refs, ${unresolved} sin resolver, ${result.skipped} omitidas por el adapter, ` +
        `${driftPairs.length} finishNotInCatalog.`,
    );
    return {
      setId: set.id,
      setExternalId: set.externalId,
      provider: provider.source,
      cardCount: byCard.size,
      priced,
      unresolved,
      skipped: result.skipped + unresolved,
    };
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
