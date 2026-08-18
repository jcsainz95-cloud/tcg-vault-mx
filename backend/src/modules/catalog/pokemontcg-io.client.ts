import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Cliente HTTP de pokemontcg.io para el sync de catálogo (M2, ARCHITECTURE §4.8).
 *
 * Seguridad:
 *  - **Host FIJO** (`https://api.pokemontcg.io/v2`, sin parte controlable por el usuario) →
 *    sin SSRF. El cliente NUNCA acepta URLs arbitrarias.
 *  - `setId` se valida contra `^[a-z0-9]+(-[a-z0-9]+)*$` en el SERVICIO antes de interpolarlo
 *    en `q=set.id:<setId>` (anti-inyección del query remoto).
 *  - Autenticación con `POKEMONTCG_IO_API_KEY` (header `X-Api-Key`).
 */
export interface RemoteCardSet {
  id: string;
  name: string;
  series?: string;
  releaseDate?: string;
  printedTotal?: number;
  ptcgoCode?: string;
}

export interface RemoteCard {
  id: string;
  name: string;
  number: string;
  rarity?: string;
  supertype?: string;
  subtypes?: string[];
  images?: { small?: string; large?: string };
  // v1.6-finish: se DEJA de descartar `prices` — las llaves presentes derivan availableFinishes
  // (mapeo ARCHITECTURE §3.7) y el precio por acabado (`prices[llave].market`). Ver upsertCards.
  // v1.22: la LLAVE PRESENTE es la señal de que la impresión existe, con `market` o sin él.
  tcgplayer?: { url?: string; prices?: Record<string, { market?: number } | null> | null } | null;
  // v1.22-variantes-orden (§4.22a/§4.22f-S3): SEGUNDA señal de variantes — `cardmarket.prices`
  // publica `reverseHolo*` y ahí la señal es el VALOR (> 0), no la llave. SOLO ES TIPADO: el
  // endpoint `GET /v2/cards?q=set.id:*` NO usa `select=`, así que este bloque YA venía en el JSON
  // descargado y se estaba descartando ⇒ CERO requests extra.
  cardmarket?: { url?: string; prices?: Record<string, unknown> | null } | null;
  set: RemoteCardSet;
}

interface RemotePage<T> {
  data: T[];
  page: number;
  pageSize: number;
  count: number;
  totalCount: number;
}

@Injectable()
export class PokemonTcgIoClient {
  private readonly logger = new Logger(PokemonTcgIoClient.name);
  /** Host FIJO — no configurable por el usuario (anti-SSRF). */
  private readonly baseUrl = 'https://api.pokemontcg.io/v2';
  /** Reintentos ante 429/5xx transitorios (free tier rate-limitea a media importación). */
  private readonly maxRetries = 4;
  private readonly baseBackoffMs = 500;

  constructor(private readonly config: ConfigService) {}

  private headers(): Record<string, string> {
    const apiKey = this.config.get<string>('POKEMONTCG_IO_API_KEY');
    return apiKey ? { 'X-Api-Key': apiKey } : {};
  }

  /** Espera cancelable (aislada para poder mockear timers en test). */
  protected async sleep(ms: number): Promise<void> {
    await new Promise((r) => setTimeout(r, ms));
  }

  /**
   * GET con reintentos/backoff ante 429 (rate limit) y 5xx transitorios. Respeta `Retry-After`
   * si viene; si no, backoff exponencial. Así un 429 a media importación NO aborta el sync del
   * set: el barrido de cartas continúa tras esperar.
   */
  private async getJson<T>(path: string, attempt = 0): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, { headers: this.headers() });
    if ((res.status === 429 || res.status >= 500) && attempt < this.maxRetries) {
      const retryAfterHeader = Number(res.headers.get('retry-after'));
      const waitMs =
        Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
          ? retryAfterHeader * 1000
          : this.baseBackoffMs * 2 ** attempt;
      this.logger.warn(
        `pokemontcg.io ${path} -> HTTP ${res.status}; retry ${attempt + 1}/${this.maxRetries} en ${waitMs}ms`,
      );
      await this.sleep(waitMs);
      return this.getJson<T>(path, attempt + 1);
    }
    if (!res.ok) {
      throw new Error(`pokemontcg.io ${path} -> HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  }

  /** GET /v2/sets — todos los sets del catálogo remoto. */
  async getSets(): Promise<RemoteCardSet[]> {
    const body = await this.getJson<RemotePage<RemoteCardSet>>('/sets?pageSize=250');
    return body.data ?? [];
  }

  /** GET /v2/cards?q=set.id:{setId} — cartas de un set (paginado). setId ya validado. */
  async getCardsBySet(setId: string, page: number, pageSize = 250): Promise<RemotePage<RemoteCard>> {
    const q = encodeURIComponent(`set.id:${setId}`);
    return this.getJson<RemotePage<RemoteCard>>(`/cards?q=${q}&page=${page}&pageSize=${pageSize}`);
  }
}
