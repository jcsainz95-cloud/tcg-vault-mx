import { Injectable, Logger } from '@nestjs/common';
import { CardSet, PriceSource } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { BulkFetchInput, BulkPriceProvider, BulkPriceResult, BulkPriceRow } from '../pricing.types';
import { TcgcsvCatalogClient, deriveCardProductsFromTcgcsv } from './tcgcsv-singles.provider';

/**
 * TcgcsvSinglesBulkPriceProvider (v1.44, P-47, ARCHITECTURE §4.35) — PROVEEDOR PRIMARIO del barrido
 * diario de precios de SINGLES por-acabado, leído de TCGCSV `tcgcsv_singles`.
 *
 * Cierra la brecha abierta por el fix P-47 (`35e948a`): la API v2 de PPT expone UN solo `market`
 * (impresión primaria), así que PPT dejó de poblar el precio por-acabado (reverse_holo/holofoil).
 * La fuente por-acabado CORRECTA es TCGCSV (`marketPrice` por `subTypeName`), que HOY solo corría en
 * import/`--force` (`CardProductResolverService`, §4.27e). Este provider la lleva al BARRIDO DIARIO.
 *
 * SEPARACIÓN ESTRUCTURA ↔ PRECIO (§4.35a, mismo patrón que `sealed-price-ingest`):
 *  - **PRECIO** (lo que hace este provider): para cada `CardProduct` YA existente del set lee su
 *    `marketPrice` por `(subTypeName → Finish)` y emite un `BulkPriceRow` por variante con
 *    `marketCents > 0`, keyed por `cardProductId` (join EXACTO por `CardProduct.tcgplayerProductId`).
 *  - **ESTRUCTURA** (lo que NO hace): NUNCA crea/actualiza `CardProduct.finishes` ni
 *    `Card.availableFinishes` (la lista blanca SEC-A1 sigue gateada a import/`--force`, §4.27d). Un
 *    `productId` de TCGCSV SIN `CardProduct` local (estructura aún no resuelta) se OMITE — money-safe:
 *    el reprecio diario solo cotiza variantes cuya estructura ya existe (dependencia explícita §4.35b).
 *
 * Money-safe (NORMATIVO §4.35):
 *  - Cada acabado toma SU `marketPrice`; `marketPrice` null/≤0 ⇒ se OMITE la fila (jamás el precio de
 *    otro acabado, jamás un 0 inventado ⇒ la celda queda «—»/PRICE_PENDING).
 *  - `subTypeName` desconocido ⇒ OMITIDO por `deriveCardProductsFromTcgcsv` (anti-invención §4.27).
 *  - Fallo remoto/parse (`getProducts`/`getPrices` LANZAN) ⇒ se captura y devuelve
 *    `requestOk:false` con 0 filas: el `PriceIngestService` NO borra precios previos (quedan stale,
 *    que es seguro; mismo criterio que el resto del arnés).
 *  - El upsert respeta `isManualOverride` (lo garantiza `PricingService.persistMarketReference`).
 *  - FX USD→MXN Banxico + colchón lo aplica el ingest (`currency:'USD'`), no este provider.
 *
 * Nota: `providerSetId`/`minPrice`/`fetchPrintings` de `BulkFetchInput` son diales de PPT y este
 * provider los IGNORA (resuelve su propio `groupId` TCGCSV, S-D3).
 */
/**
 * Cota superior de cordura (USD) para el `market` por-acabado de un single, ANTES de convertir a
 * centavos (P47-1, money-safe). Cualquier `market` > esta cota se trata como dato de feed corrupto:
 * se OMITE la fila y se audita (warn), en vez de clamparse en silencio a MAX_CENTS. Elegida en el
 * orden de las decenas de miles de USD: muy por encima de cualquier single real de Pokémon y muy por
 * debajo de MAX_CENTS (≈USD 21.4M), de modo que jamás se emita un precio de venta absurdo.
 */
const MAX_SANE_MARKET_USD = 50_000;

@Injectable()
export class TcgcsvSinglesBulkPriceProvider implements BulkPriceProvider {
  readonly source: PriceSource = 'tcgcsv_singles';
  private readonly logger = new Logger(TcgcsvSinglesBulkPriceProvider.name);
  /** Cache de `groupId` por set dentro del proceso (idéntico patrón a `CardProductResolverService`). */
  private readonly groupIdCache = new Map<string, number>();

  constructor(
    private readonly tcgcsv: TcgcsvCatalogClient,
    private readonly prisma: PrismaService,
  ) {}

  async fetchPricesForSet(input: BulkFetchInput): Promise<BulkPriceResult> {
    const { set } = input;
    const empty: BulkPriceResult = { rows: [], fetchedRaw: 0, skipped: 0, requestOk: false };

    let groupId: number | null;
    try {
      groupId = await this.resolveGroupId(set);
    } catch (e) {
      this.logger.warn(
        `tcgcsv_singles: no se pudo resolver el groupId de "${set.name}": ${(e as Error).message}. ` +
          `Se devuelven 0 filas (precios previos quedan STALE, money-safe).`,
      );
      return empty;
    }
    if (groupId == null) return empty;

    let products, prices;
    try {
      [products, prices] = await Promise.all([
        this.tcgcsv.getProducts(groupId),
        this.tcgcsv.getPrices(groupId),
      ]);
    } catch (e) {
      // Money-safe: ante fallo remoto NO se toca ningún precio (stale conservador, §4.35).
      this.logger.warn(
        `tcgcsv_singles: fetch del grupo ${groupId} (set "${set.name}") falló: ${(e as Error).message}. ` +
          `Se devuelven 0 filas (precios previos quedan STALE, no se borran).`,
      );
      return empty;
    }

    const derived = deriveCardProductsFromTcgcsv(products, prices);

    // Join por `productId` EXACTO a los `CardProduct` LOCALES YA existentes (estructura resuelta en
    // import/`--force`). NUNCA se crean aquí (estructura ≠ precio): un productId sin CardProduct se OMITE.
    const productIds = derived.map((d) => d.productId);
    const existing = productIds.length
      ? await this.prisma.cardProduct.findMany({
          where: { tcgplayerProductId: { in: productIds } },
          select: {
            id: true,
            tcgplayerProductId: true,
            cardId: true,
            card: { select: { externalId: true } },
          },
        })
      : [];
    const byProductId = new Map(existing.map((cp) => [cp.tcgplayerProductId, cp]));

    const rows: BulkPriceRow[] = [];
    let fetchedRaw = 0;
    let skipped = 0;
    let unresolvedProducts = 0;
    for (const dp of derived) {
      const cp = byProductId.get(dp.productId);
      for (const pf of dp.pricesByFinish) {
        fetchedRaw += 1;
        if (!cp) {
          // Estructura del producto aún no resuelta localmente (§4.35b): se OMITE (no se inventa carta).
          skipped += 1;
          unresolvedProducts += 1;
          continue;
        }
        // Cada acabado toma SU marketPrice; ausente/≤0 ⇒ OMITIR (celda «—»/PRICE_PENDING, jamás 0).
        if (pf.marketPrice == null || pf.marketPrice <= 0) {
          skipped += 1;
          continue;
        }
        // P47-1 (money-safe): el `market` viene de un feed EXTERNO (TCGCSV). Un valor no finito
        // (Infinity/-Infinity/NaN por dato corrupto o malicioso) NO se clampa a MAX_CENTS en
        // silencio — se OMITE la fila (mismo invariante que ≤0: la celda queda «—»/PRICE_PENDING,
        // jamás un precio inventado). `-Infinity`/`NaN` ya caerían en el ≤0 de arriba en su mayoría,
        // pero se hace explícito para no depender de la coerción de comparación con NaN.
        if (!Number.isFinite(pf.marketPrice)) {
          skipped += 1;
          continue;
        }
        // Cota superior de CORDURA antes de convertir a centavos. Un single de Pokémon real cotiza,
        // aun en los grados/alter más caros, muy por debajo de USD 50k (los outliers de subasta tipo
        // Pikachu Illustrator no cotizan como `market` de TCGplayer). Elegimos 50 000 USD: decenas de
        // miles, muy por encima de cualquier carta real y muy por debajo de MAX_CENTS (≈USD 21.4M).
        // Un `market` por encima de esta cota es dato corrupto ⇒ se OMITE y se AUDITA (warn), para que
        // no se clampe en silencio a MAX_CENTS (riesgo de dinero: precio de venta absurdo inyectado).
        if (pf.marketPrice > MAX_SANE_MARKET_USD) {
          skipped += 1;
          this.logger.warn(
            `tcgcsv_singles: market ANÓMALO omitido (P47-1) — productId=${dp.productId} ` +
              `finish=${pf.finish} market=${pf.marketPrice} USD supera la cota de cordura ` +
              `(${MAX_SANE_MARKET_USD} USD). Fila OMITIDA (no se clampa a MAX_CENTS); dato de feed corrupto.`,
          );
          continue;
        }
        const marketCents = Math.round(pf.marketPrice * 100);
        if (marketCents <= 0) {
          skipped += 1;
          continue;
        }
        rows.push({
          externalId: cp.card.externalId,
          cardId: cp.cardId,
          cardProductId: cp.id,
          finish: pf.finish,
          marketCents,
          currency: 'USD', // TCGCSV publica SIEMPRE USD (precios TCGplayer) ⇒ el ingest aplica FX+colchón.
          // El subTypeName se mapeó por `TCGCSV_SUBTYPE_TO_FINISH` (espejo estricto), no un alias supuesto.
          finishAliasVerified: true,
        });
      }
    }

    if (unresolvedProducts > 0) {
      this.logger.log(
        `tcgcsv_singles: grupo ${groupId} (set "${set.name}") — ${unresolvedProducts} variante(s) de ` +
          `productos SIN CardProduct local (estructura no resuelta); se OMITEN hasta un --force del set (§4.35b).`,
      );
    }
    return { rows, fetchedRaw, skipped, requestOk: true };
  }

  /**
   * Resuelve el `groupId` TCGCSV del set (misma lógica S-D3/§4.27d que `CardProductResolverService`):
   * `pptSetId` entero == groupId; si no, match ÚNICO por nombre (exacto preferido) vía `listGroups()`.
   * `null` (con log) si no hay match ÚNICO ⇒ el llamador no toca ningún precio (money-safe).
   */
  private async resolveGroupId(set: CardSet): Promise<number | null> {
    const cached = this.groupIdCache.get(set.id);
    if (cached != null) return cached;

    if (set.pptSetId && /^\d+$/.test(set.pptSetId)) {
      const groupId = parseInt(set.pptSetId, 10);
      this.groupIdCache.set(set.id, groupId);
      return groupId;
    }

    const groups = await this.tcgcsv.listGroups();
    const target = normalizeName(set.name);
    const exact = groups.filter((g) => normalizeName(g.name) === target);
    const matches =
      exact.length > 0
        ? exact
        : groups.filter((g) => {
            const gn = normalizeName(g.name);
            return gn.includes(target) || target.includes(gn);
          });
    if (matches.length === 1) {
      this.groupIdCache.set(set.id, matches[0].groupId);
      return matches[0].groupId;
    }
    this.logger.warn(
      `tcgcsv_singles: no se resolvió un groupId ÚNICO para "${set.name}" (${matches.length} candidatos; ` +
        `pptSetId="${set.pptSetId ?? ''}"). No se toca ningún precio (money-safe).`,
    );
    return null;
  }
}

/** Normaliza un nombre de set/grupo para el match S-D3: minúsculas, solo alfanuméricos. */
function normalizeName(raw: string): string {
  return (raw ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
