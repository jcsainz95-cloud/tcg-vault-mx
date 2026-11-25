import { Injectable } from '@nestjs/common';
import { CatalogService, SitemapItem } from './catalog.service';
import { SealedCatalogService } from './sealed-catalog.service';
import { MERCHANT_SERVER_CACHE_MS, MerchantFeedRaw } from './merchant-feed';

export interface PublicSnapshot {
  /** Entradas del sitemap (cartas + sellado). */
  sitemap: SitemapItem[];
  /** Insumos del feed de Merchant (cartas + sellado). */
  feedRows: MerchantFeedRaw[];
  generatedAt: string;
}

/**
 * Paridad feed de Google Merchant = sitemap = «vendible» (auditoría de producción 2026-11-25: 43 cartas `in_stock` en el feed
 * que la ficha y el sitemap daban por agotadas). Antes cada superficie tenía SU caché de 5 min con SU propia lectura
 * (`CatalogController.sitemapCache` y `MerchantFeedService.cache`): leídas en instantes distintos, una carta vendida entre las
 * dos lecturas salía del sitemap y seguía en el feed hasta 5 min, y el precio también podía ser de otra foto. Ahora hay UNA
 * foto (una lectura de «a la venta» de singles y una de sellado) de la que salen las dos proyecciones, con un TTL corto
 * (`MERCHANT_SERVER_CACHE_MS`, 60 s). Una foto con 0 entradas no se cachea; un cómputo a la vez.
 */
@Injectable()
export class PublicSnapshotService {
  constructor(
    private readonly catalog: CatalogService,
    private readonly sealed: SealedCatalogService,
  ) {}

  private cache: { at: number; value: PublicSnapshot } | null = null;
  private inflight: Promise<PublicSnapshot> | null = null;

  async get(): Promise<PublicSnapshot> {
    const c = this.cache;
    if (c && Date.now() - c.at < MERCHANT_SERVER_CACHE_MS) return c.value;
    if (this.inflight) return this.inflight;
    this.inflight = this.compute()
      .then((v) => {
        if (v.sitemap.length > 0 || v.feedRows.length > 0) this.cache = { at: Date.now(), value: v };
        return v;
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }

  /** Solo pruebas: descarta la foto. */
  invalidate(): void {
    this.cache = null;
  }

  private async compute(): Promise<PublicSnapshot> {
    const [cards, sealed] = await Promise.all([this.catalog.publicCardSnapshot(), this.sealed.publicSealedSnapshot()]);
    return {
      sitemap: [...cards.sitemap, ...sealed.sitemap],
      feedRows: [...cards.feedRows, ...sealed.feedRows],
      generatedAt: new Date().toISOString(),
    };
  }
}
