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
  tcgplayer?: { url?: string };
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

  constructor(private readonly config: ConfigService) {}

  private headers(): Record<string, string> {
    const apiKey = this.config.get<string>('POKEMONTCG_IO_API_KEY');
    return apiKey ? { 'X-Api-Key': apiKey } : {};
  }

  private async getJson<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, { headers: this.headers() });
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
