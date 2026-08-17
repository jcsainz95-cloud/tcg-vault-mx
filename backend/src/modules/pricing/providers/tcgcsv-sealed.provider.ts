import { Injectable, Logger } from '@nestjs/common';
import { PriceSource } from '@prisma/client';
import {
  SealedBulkPriceProvider,
  SealedBulkPriceResult,
  SealedPriceRow,
  TcgcsvGroupRef,
  TcgcsvProductRef,
} from '../pricing.types';

/**
 * Payloads crudos de tcgcsv.com (espejo diario estático de TCGplayer, JSON servido como
 * archivos, SIN API key). Todos los endpoints comparten el wrapper `{ results: [...] }`.
 * SUPUESTO a verificar en staging (1ª corrida manual, §4.19f): el formato se calibró con
 * las fixtures de `backend/test/fixtures/tcgcsv/` (el egress a tcgcsv.com está bloqueado
 * en dev); si el esquema real difiere, se ajustan adapter + fixtures.
 */
interface TcgcsvEnvelope<T> {
  totalItems?: number;
  success?: boolean;
  errors?: unknown[];
  results?: T[];
}

interface TcgcsvRawGroup {
  groupId?: number;
  name?: string;
  abbreviation?: string | null;
  publishedOn?: string | null;
}

interface TcgcsvRawProduct {
  productId?: number;
  name?: string;
  cleanName?: string | null;
  imageUrl?: string | null;
  extendedData?: { name?: string; displayName?: string; value?: unknown }[] | null;
}

interface TcgcsvRawPrice {
  productId?: number;
  lowPrice?: number | null;
  midPrice?: number | null;
  highPrice?: number | null;
  marketPrice?: number | null;
  directLowPrice?: number | null;
  subTypeName?: string | null;
}

/**
 * TcgcsvSealedBulkProvider — referencia de mercado del SELLADO vía TCGCSV
 * (v1.19-sealed-tcgcsv, ARCHITECTURE §4.19b).
 *
 * Seguridad (mismo patrón `PokemonTcgIoClient`):
 *  - **Host FIJO `https://tcgcsv.com`** (anti-SSRF; el cliente NUNCA acepta URLs arbitrarias).
 *  - **Categoría Pokémon = 3, CONSTANTE de servidor** (no configurable, no viene del cliente).
 *  - Todo `groupId` interpolado en un path se valida como **entero positivo** ANTES (nunca
 *    un string del cliente al path remoto).
 *  - **Sin API key** (no hay secreto nuevo). Timeout corto, `redirect:'error'` (sin seguir
 *    redirects fuera del host), `Accept: application/json`.
 *
 * Money-safe (doctrina §4.15d aplicada al sellado, §4.19b):
 *  - `subTypeName !== 'Normal'` → se OMITE la fila (el sellado se pricia solo en su sub-tipo
 *    base; nunca se atribuye el precio de un sub-tipo raro al producto).
 *  - `marketPrice` (o su fallback `midPrice`, con flag `usedFallbackMid`) ausente/NaN/<=0 →
 *    se OMITE.
 *  - Fallo de red/parse → `fetchSealedPricesForGroup` devuelve lo acumulado + log; NUNCA se
 *    borran precios previos (quedan stale, que es seguro). `listGroups`/`listSealedProducts`
 *    SÍ propagan el error (el proxy M2 lo mapea a `502 UPSTREAM_ERROR`).
 *  - `lowPrice`/`highPrice` NO se persisten (solo observabilidad/logs).
 */
@Injectable()
export class TcgcsvSealedBulkProvider implements SealedBulkPriceProvider {
  readonly source: PriceSource = 'tcgcsv';
  private readonly logger = new Logger(TcgcsvSealedBulkProvider.name);
  /** Host FIJO — no configurable por el usuario (anti-SSRF). */
  private readonly baseUrl = 'https://tcgcsv.com/tcgplayer';
  /** Categoría Pokémon en TCGplayer/TCGCSV. CONSTANTE de servidor (nunca del cliente). */
  private readonly pokemonCategoryId = 3;
  /** Timeout corto: TCGCSV sirve archivos estáticos; si tarda, algo anda mal. */
  private readonly timeoutMs = 15_000;

  /** GET al host fijo con timeout + sin redirects + Accept JSON. */
  private async getJson<T>(path: string): Promise<TcgcsvEnvelope<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        headers: { Accept: 'application/json' },
        redirect: 'error',
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`tcgcsv.com ${path} -> HTTP ${res.status}`);
      const body = (await res.json()) as TcgcsvEnvelope<T>;
      if (!body || !Array.isArray(body.results)) {
        throw new Error(`tcgcsv.com ${path} -> payload inesperado (sin results[])`);
      }
      return body;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Valida el groupId como entero positivo ANTES de interpolarlo en el path remoto. */
  private assertValidGroupId(groupId: number): void {
    if (!Number.isInteger(groupId) || groupId <= 0) {
      throw new Error(`tcgcsv: groupId inválido (${String(groupId)}); debe ser entero positivo`);
    }
  }

  /** Grupos de la categoría Pokémon (explorador de curación M2). Lanza ante fallo remoto. */
  async listGroups(): Promise<TcgcsvGroupRef[]> {
    const body = await this.getJson<TcgcsvRawGroup>(`/${this.pokemonCategoryId}/groups`);
    const groups: TcgcsvGroupRef[] = [];
    for (const g of body.results ?? []) {
      if (typeof g?.groupId !== 'number' || !Number.isInteger(g.groupId) || !g?.name) continue;
      groups.push({
        groupId: g.groupId,
        name: g.name,
        ...(g.abbreviation ? { abbreviation: g.abbreviation } : {}),
        ...(g.publishedOn ? { publishedOn: g.publishedOn } : {}),
      });
    }
    return groups;
  }

  /**
   * Productos SELLADOS de un grupo (explorador de curación M2). Lanza ante fallo remoto.
   *
   * Heurística conservadora de "sellado" (§4.19b, a confirmar en staging): un product SIN
   * `extendedData` de carta individual (sin entradas `Number`/`Rarity`) se considera sellado;
   * los que las traen son singles y se descartan. La heurística solo LIMPIA la lista del
   * explorador, no decide dinero (la curación es humana: el admin ve el nombre y decide).
   */
  async listSealedProducts(groupId: number): Promise<TcgcsvProductRef[]> {
    this.assertValidGroupId(groupId);
    const body = await this.getJson<TcgcsvRawProduct>(
      `/${this.pokemonCategoryId}/${groupId}/products`,
    );
    const products: TcgcsvProductRef[] = [];
    for (const p of body.results ?? []) {
      if (typeof p?.productId !== 'number' || !Number.isInteger(p.productId) || !p?.name) continue;
      if (this.looksLikeSingleCard(p)) continue;
      products.push({
        productId: p.productId,
        name: p.name,
        ...(p.cleanName ? { cleanName: p.cleanName } : {}),
        ...(p.imageUrl ? { imageUrl: p.imageUrl } : {}),
      });
    }
    return products;
  }

  /** true si el product trae extendedData de carta individual (Number/Rarity) → es un single. */
  private looksLikeSingleCard(p: TcgcsvRawProduct): boolean {
    const ext = p.extendedData;
    if (!Array.isArray(ext)) return false;
    return ext.some((e) => e?.name === 'Number' || e?.name === 'Rarity');
  }

  /**
   * Precios del grupo para el INGEST. Money-safe: NUNCA lanza por fallo de red/parse —
   * devuelve lo acumulado (posiblemente vacío) + log; los precios previos quedan STALE.
   */
  async fetchSealedPricesForGroup(groupId: number): Promise<SealedBulkPriceResult> {
    this.assertValidGroupId(groupId);
    const rows: SealedPriceRow[] = [];
    let fetchedRaw = 0;
    let skipped = 0;
    try {
      const body = await this.getJson<TcgcsvRawPrice>(
        `/${this.pokemonCategoryId}/${groupId}/prices`,
      );
      for (const entry of body.results ?? []) {
        fetchedRaw += 1;
        const row = this.mapPrice(entry);
        if (row) rows.push(row);
        else skipped += 1;
      }
    } catch (e) {
      // Money-safe: ante un fallo del remoto NO se borran precios; se devuelve lo acumulado.
      this.logger.warn(
        `tcgcsv: precios del grupo ${groupId} fallaron: ${(e as Error).message}. ` +
          `Se devuelven ${rows.length} filas acumuladas (precios previos quedan STALE, no se borran).`,
      );
    }
    return { rows, fetchedRaw, skipped };
  }

  /** Mapea/valida UNA entrada de precios → SealedPriceRow, o null si se OMITE (money-safe). */
  private mapPrice(entry: TcgcsvRawPrice): SealedPriceRow | null {
    if (
      typeof entry?.productId !== 'number' ||
      !Number.isInteger(entry.productId) ||
      entry.productId <= 0
    ) {
      return null;
    }
    // Solo el sub-tipo BASE ('Normal'): nunca se atribuye el precio de un sub-tipo raro
    // (p. ej. 'Holofoil'/'Reverse Holofoil' de un producto mixto) al producto sellado.
    if (entry.subTypeName !== 'Normal') return null;

    const market = entry.marketPrice;
    const mid = entry.midPrice;
    let priceUsd: number;
    let usedFallbackMid: boolean;
    if (typeof market === 'number' && Number.isFinite(market) && market > 0) {
      priceUsd = market;
      usedFallbackMid = false;
    } else if (typeof mid === 'number' && Number.isFinite(mid) && mid > 0) {
      // Fallback marketPrice→midPrice: aceptable SOLO aquí (referencia informativa, §4.19d);
      // se marca con el flag para observabilidad. Para raw/singles sigue PROHIBIDO.
      priceUsd = mid;
      usedFallbackMid = true;
    } else {
      return null;
    }
    return {
      tcgplayerProductId: entry.productId,
      marketCents: Math.round(priceUsd * 100),
      usedFallbackMid,
      currency: 'USD',
    };
  }
}
