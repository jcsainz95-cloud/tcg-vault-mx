import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { SettingKey } from '../settings/settings.constants';
import { PricingService } from './pricing.service';
import { TcgcsvSealedBulkProvider } from './providers/tcgcsv-sealed.provider';
import type { FxSnapshot } from './price-ingest.service';

/** Resumen de una corrida del ingest de sellado (observabilidad; NO expuesto por contrato). */
export interface SealedIngestRunResult {
  /** Grupos TCGCSV procesados (distintos de los items mapeados, o el `groupId` del disparo acotado). */
  groups: number;
  /** Filas `PriceReference` upserteadas (una por par distinto (anchorCardId, productId)). */
  priced: number;
  /** Filas cuyo precio salió de `midPrice` (fallback observado, §4.19d). */
  usedFallbackMid: number;
  /** Entradas del remoto omitidas por el adapter (sub-tipo raro / market inválido). */
  skipped: number;
  /** Pares mapeados sin fila de precio en el remoto (referencia queda null/stale — inocuo). */
  unmatched: number;
}

/**
 * SealedPriceIngestService — ingesta de la referencia de mercado del SELLADO vía TCGCSV
 * (v1.19-sealed-tcgcsv, ARCHITECTURE §4.19d). SEPARADO de `PriceIngestService` (otra interfaz
 * product-keyed, otro dial, otro dominio de fallo: un TCGCSV caído no toca el pricing de singles).
 *
 * Algoritmo normativo (§4.19d):
 *  1. El dial `sealed_price_source` lo lee el JOB (fail-closed; ver jobs/sealed-price-ingest).
 *  2. `SELECT DISTINCT tcgplayerGroupId` de los `InventoryItem` sealed mapeados.
 *  3. FX UNA vez por corrida (el snapshot lo carga el job y se pasa aquí).
 *  4. Por grupo: `fetchSealedPricesForGroup` → filtra a los productId mapeados de ese grupo.
 *  5. Por cada par DISTINTO `(anchorCardId, tcgplayerProductId)`: upsert idempotente de
 *     `PriceReference` vía `persistSealedMarketReference` (respeta `isManualOverride`).
 *
 * Doctrina (§4.19a): la referencia es INFORMATIVA — no publica, no fija `listPriceCents`,
 * no encola `PendingPriceEntry`. Un sellado sin mapeo/sin precio simplemente no tiene
 * referencia (null/stale — inocuo).
 */
@Injectable()
export class SealedPriceIngestService {
  private readonly logger = new Logger(SealedPriceIngestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly pricing: PricingService,
    private readonly provider: TcgcsvSealedBulkProvider,
  ) {}

  /** Dial fail-closed `sealed_price_source` (`tcgcsv | off`, seed `off`, §4.19e). */
  async isEnabled(): Promise<boolean> {
    const dial = await this.settings.getString(SettingKey.SEALED_PRICE_SOURCE);
    return dial === 'tcgcsv';
  }

  /** Grupos TCGCSV distintos de los items sellados MAPEADOS (alcance minúsculo del job). */
  async listMappedGroupIds(): Promise<number[]> {
    const rows = await this.prisma.inventoryItem.findMany({
      where: { productType: 'sealed', tcgplayerGroupId: { not: null }, tcgplayerProductId: { not: null } },
      distinct: ['tcgplayerGroupId'],
      select: { tcgplayerGroupId: true },
    });
    return rows
      .map((r) => r.tcgplayerGroupId)
      .filter((g): g is number => g != null);
  }

  /**
   * Corre la ingesta SECUENCIAL y AWAITED (sin fan-out, §4.19d). `groupId` acota a UN grupo
   * (verificación de esquema en staging, §4.19f); sin él, barre los grupos mapeados.
   * El `fx` es el snapshot cargado UNA vez por corrida por el job (§4.15f/§4.19d).
   */
  async run(fx: FxSnapshot, groupId?: number): Promise<SealedIngestRunResult> {
    const groupIds = groupId != null ? [groupId] : await this.listMappedGroupIds();
    const result: SealedIngestRunResult = {
      groups: groupIds.length,
      priced: 0,
      usedFallbackMid: 0,
      skipped: 0,
      unmatched: 0,
    };
    for (const gid of groupIds) {
      const r = await this.ingestGroup(gid, fx);
      result.priced += r.priced;
      result.usedFallbackMid += r.usedFallbackMid;
      result.skipped += r.skipped;
      result.unmatched += r.unmatched;
    }
    this.logger.log(
      `sealed-price-ingest: ${result.groups} grupos, ${result.priced} referencias ` +
        `(${result.usedFallbackMid} vía midPrice), ${result.unmatched} pares sin precio remoto, ` +
        `${result.skipped} entradas omitidas por el adapter.`,
    );
    return result;
  }

  private async ingestGroup(
    groupId: number,
    fx: FxSnapshot,
  ): Promise<Omit<SealedIngestRunResult, 'groups'>> {
    // Pares DISTINTOS (anchorCardId, productId) mapeados de ESTE grupo. El anchorCardId es el
    // cardId del item (el sellado se ancla a una Card para nombre/imagen, §3.6). Varias copias
    // físicas del mismo producto ancladas a la misma Card = UN solo upsert (idempotente igual).
    const items = await this.prisma.inventoryItem.findMany({
      where: {
        productType: 'sealed',
        tcgplayerGroupId: groupId,
        tcgplayerProductId: { not: null },
      },
      distinct: ['cardId', 'tcgplayerProductId'],
      select: { cardId: true, tcgplayerProductId: true },
    });
    if (items.length === 0) {
      this.logger.warn(`sealed-price-ingest: grupo ${groupId} sin items mapeados; se omite.`);
      return { priced: 0, usedFallbackMid: 0, skipped: 0, unmatched: 0 };
    }

    // El adapter NUNCA lanza aquí: ante fallo devuelve lo acumulado (precios previos quedan stale).
    const fetched = await this.provider.fetchSealedPricesForGroup(groupId);
    const byProductId = new Map(fetched.rows.map((r) => [r.tcgplayerProductId, r]));

    let priced = 0;
    let usedFallbackMid = 0;
    let unmatched = 0;
    for (const item of items) {
      const productId = item.tcgplayerProductId as number;
      const row = byProductId.get(productId);
      if (!row) {
        // Mapeo sin fila remota (productId erróneo o producto sin precio hoy): la referencia
        // queda null/stale — inocuo e informativo (§4.19c). No se borra nada.
        unmatched += 1;
        continue;
      }
      await this.pricing.persistSealedMarketReference(
        item.cardId,
        productId,
        { marketCents: row.marketCents },
        fx,
      );
      priced += 1;
      if (row.usedFallbackMid) usedFallbackMid += 1;
    }
    return { priced, usedFallbackMid, skipped: fetched.skipped, unmatched };
  }
}
