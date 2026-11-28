import { Injectable } from '@nestjs/common';
import type { TcgcsvGroupRef } from '../pricing/pricing.types';
import { TcgcsvCatalogClient } from '../pricing/providers/tcgcsv-singles.provider';

/** Vida del caché de `listGroups` (contrato §2: la lista de excepciones calcula candidatos del `listGroups` cacheado ≤ 24 h). */
export const GROUPS_CACHE_TTL_MS = 24 * 3_600_000;

/** Caché en memoria de `listGroups`. `peek()` NUNCA llama a nadie; `get()` llama solo si venció. */
@Injectable()
export class TcgcsvGroupsCache {
  private groups: TcgcsvGroupRef[] | null = null;
  private at = 0;

  constructor(private readonly client: TcgcsvCatalogClient) {}

  put(groups: TcgcsvGroupRef[], at = Date.now()): void {
    this.groups = groups;
    this.at = at;
  }

  /** Lo cacheado si tiene ≤ 24 h; `null` si no hay (o venció). Sin llamadas a proveedores. */
  peek(now = Date.now()): TcgcsvGroupRef[] | null {
    return this.groups && now - this.at <= GROUPS_CACHE_TTL_MS ? this.groups : null;
  }

  /** Relee `listGroups` aunque el caché sea vigente (p. ej. un grupo recién publicado). Lanza ante fallo. */
  async refresh(now = Date.now()): Promise<TcgcsvGroupRef[]> {
    const fresh = await this.client.listGroups();
    this.put(fresh, now);
    return fresh;
  }

  async get(now = Date.now()): Promise<TcgcsvGroupRef[]> {
    const hit = this.peek(now);
    if (hit) return hit;
    const fresh = await this.client.listGroups();
    this.put(fresh, now);
    return fresh;
  }
}
