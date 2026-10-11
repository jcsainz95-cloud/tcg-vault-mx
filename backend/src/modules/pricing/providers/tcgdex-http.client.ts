import { Injectable, Logger } from '@nestjs/common';

/**
 * tcgdex-http.client.ts — v1.91⟨precios⟩ (M-75, §PRE / ARCHITECTURE §4.PRE (e)) — cliente HTTP de
 * TCGdex v2, con la MISMA disciplina anti-SSRF que `TcgcsvHttpClient`:
 *  - **Host FIJO `https://api.tcgdex.net/v2/en`** (idioma inglés; el join es por set+número+acabado,
 *    independiente del idioma — criterio 884). El cliente NUNCA acepta URLs arbitrarias.
 *  - El `setId`/`cardId` interpolado se valida como slug seguro (`[A-Za-z0-9._-]+`) ANTES.
 *  - **Sin API key.** Timeout corto, `redirect:'error'`, `Accept: application/json`, UA identificable.
 *
 * Volumen (medido 2026-10-11): el listado de un set NO trae pricing (forma breve) ⇒ 1 llamada por carta
 * (~180 para Prismatic). ~0.18 s/carta, sin cabeceras de rate-limit expuestas, sin endpoint bulk de
 * pricing. El provider acota la concurrencia (`CONCURRENCY`) para no ahogar el barrido ni a TCGdex.
 */
@Injectable()
export class TcgdexHttpClient {
  private readonly logger = new Logger(TcgdexHttpClient.name);
  /** Host FIJO — no configurable por el usuario (anti-SSRF). Inglés (join por set+número+acabado). */
  protected readonly baseUrl = 'https://api.tcgdex.net/v2/en';
  protected readonly timeoutMs = 15_000;

  /** Valida un segmento de ruta (setId/cardId) como slug seguro ANTES de interpolarlo. */
  protected assertSafeId(id: string): void {
    if (typeof id !== 'string' || id === '' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
      throw new Error(`tcgdex: id inseguro (${String(id)})`);
    }
  }

  /** GET al host fijo con timeout + sin redirects + Accept JSON. Devuelve el JSON parseado. */
  protected async getJson<T>(path: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'tcg-vault-mx/1.0 (+https://tcghunt.mx)',
        },
        redirect: 'error',
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`api.tcgdex.net ${path} -> HTTP ${res.status}`);
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /** `GET /v2/en/sets` — lista breve de TODOS los sets (id, name, cardCount). Para el set-mapper. */
  async listSets(): Promise<unknown> {
    return this.getJson<unknown>('/sets');
  }

  /** `GET /v2/en/sets/{id}` — set en forma BREVE (sin pricing): `{ id, name, cardCount, cards:[...] }`. */
  async getSetBrief(tcgdexSetId: string): Promise<unknown> {
    this.assertSafeId(tcgdexSetId);
    return this.getJson<unknown>(`/sets/${tcgdexSetId}`);
  }

  /** `GET /v2/en/cards/{id}` — carta COMPLETA, con `pricing` (tcgplayer + cardmarket). */
  async getCard(tcgdexCardId: string): Promise<unknown> {
    this.assertSafeId(tcgdexCardId);
    return this.getJson<unknown>(`/cards/${tcgdexCardId}`);
  }
}
