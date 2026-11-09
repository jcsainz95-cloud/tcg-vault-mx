import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/** Claves de `ConfigSetting` del catalogo automatico (estado persistido; sobrevive a un reinicio). Sin valor de negocio: solo bookkeeping. */
export const CATALOG_AUTO_KEYS = {
  lastSuccessAt: 'catalog.auto.lastSuccessAt',
  watchSince: 'catalog.auto.watchSince',
  staleAlert: 'catalog.auto.staleAlert',
  contentKeyBackfill: 'catalog.auto.contentKeyBackfill',
  tcgcsvFirstSeen: 'catalog.auto.tcgcsvFirstSeen',
  /** Compuerta Black Star (backtest ciego): `{open,n,k,expansions}`. Escribe SOLO `PromoCollectionLinkService.recompute`. */
  promoGate: 'catalog.auto.promoGate',
} as const;

/** Lectura/escritura minima del estado AUTO en `ConfigSetting` (tabla existente: sin migracion). */
@Injectable()
export class CatalogAutoStateService {
  constructor(private readonly prisma: PrismaService) {}

  async get<T>(key: string): Promise<T | null> {
    const row = await this.prisma.configSetting.findUnique({ where: { key } });
    return row ? (row.valueJson as unknown as T) : null;
  }

  async set(key: string, value: unknown): Promise<void> {
    const valueJson = value as never;
    await this.prisma.configSetting.upsert({
      where: { key },
      create: { key, valueJson, updatedBy: 'system:catalog-auto' },
      update: { valueJson, updatedBy: 'system:catalog-auto' },
    });
  }

  async getLastSuccessAt(): Promise<string | null> {
    const v = await this.get<{ at?: string }>(CATALOG_AUTO_KEYS.lastSuccessAt);
    return typeof v?.at === 'string' ? v.at : null;
  }

  async setLastSuccessAt(iso: string): Promise<void> {
    await this.set(CATALOG_AUTO_KEYS.lastSuccessAt, { at: iso });
  }

  /**
   * Primera vez que NOSOTROS vimos cada grupo de TCGCSV (persistido). Devuelve el mapa `groupId -> ISO` ya con los ids nuevos
   * sellados con `now`. Idempotente: un id ya visto conserva su fecha.
   */
  async recordFirstSeen(groupIds: number[], now: Date): Promise<Record<string, string>> {
    const cur = (await this.get<Record<string, string>>(CATALOG_AUTO_KEYS.tcgcsvFirstSeen)) ?? {};
    let dirty = false;
    for (const id of groupIds) {
      if (cur[String(id)] === undefined) {
        cur[String(id)] = now.toISOString();
        dirty = true;
      }
    }
    if (dirty) await this.set(CATALOG_AUTO_KEYS.tcgcsvFirstSeen, cur);
    return cur;
  }
}
