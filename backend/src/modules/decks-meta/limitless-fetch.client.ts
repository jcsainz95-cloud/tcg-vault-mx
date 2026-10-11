import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  LIMITLESS_HOST,
  LIMITLESS_USER_AGENT,
  LimitlessFetchConfig,
  buildArchetypeUrl,
  buildDeckListUrl,
  buildHomeUrl,
  resolveFetchConfig,
} from './limitless.config';

/** Cota dura de saltos de redirect por request (los canónicos de Limitless no redirigen). */
const MAX_REDIRECT_HOPS = 3;

/**
 * DECKS-META Fase 2 — cliente HTTP de Limitless. Norma: spec §1, §9. Superficie que SEGURIDAD revisa.
 *
 * Seguridad (§9):
 *  - **Host FIJO** (`limitlesstcg.com`): las URLs las construyen `build*Url()` SÓLO desde IDs
 *    numéricos validados (`^\d+$`). Cero parte de la URL viene de entrada de usuario.
 *  - **Redirects NO se siguen a ciegas (anti-SSRF):** `redirect:'manual'`. Ante un 3xx se lee el
 *    `Location`, se resuelve contra la URL actual y se valida que su `origin` sea `LIMITLESS_HOST`
 *    **ANTES** de seguirlo; un redirect fuera del allowlist se RECHAZA sin traerlo (jamás se hace
 *    fetch de un `Location` no validado). Cota dura de saltos (`MAX_REDIRECT_HOPS`).
 *  - **Cap de bytes** (`META_FETCH_MAX_BYTES`, 3 MB): se lee el cuerpo por chunks y se aborta al
 *    superarlo (DoS de memoria). Fast-path por `content-length` cuando viene.
 *  - **Timeout** (`AbortController`, 10 s) + **reintentos** (2, backoff, respeta `Retry-After`).
 *  - El HTML crudo se DEVUELVE al parser pero jamás se persiste.
 *
 * El ESPACIADO entre requests y la COTA de nº de requests por corrida los gobierna el orquestador
 * (`DecksMetaRefreshService`), que es quien conoce la corrida completa.
 */
@Injectable()
export class LimitlessFetchClient {
  private readonly logger = new Logger(LimitlessFetchClient.name);

  constructor(private readonly config: ConfigService) {}

  cfg(): LimitlessFetchConfig {
    return resolveFetchConfig(this.config);
  }

  /** GET home «Top Decks». */
  async fetchHome(): Promise<string> {
    return this.getText(buildHomeUrl());
  }

  /** GET /decks/list/<listId> (lista completa, las 60). `listId` YA validado por el llamante. */
  async fetchDeckList(listId: string): Promise<string> {
    return this.getText(buildDeckListUrl(listId));
  }

  /** GET /decks/<archetypeId> (metadata opcional; NUNCA para las 60). `archetypeId` YA validado. */
  async fetchArchetype(archetypeId: string): Promise<string> {
    return this.getText(buildArchetypeUrl(archetypeId));
  }

  /** Espera cancelable (aislada para poder mockear timers en test). */
  protected async sleep(ms: number): Promise<void> {
    await new Promise((r) => setTimeout(r, ms));
  }

  /**
   * GET con timeout + reintentos + cap de bytes. Lanza si agota reintentos, si un redirect apunta
   * fuera del allowlist, o si la respuesta supera el cap. El llamante (orquestador) captura por deck.
   */
  private async getText(url: string, attempt = 0, hops = 0): Promise<string> {
    const { timeoutMs, maxBytes, retries } = this.cfg();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        // `manual`: un 3xx llega SIN seguirse. Lo validamos y seguimos a mano (anti-SSRF, §9).
        redirect: 'manual',
        headers: { 'User-Agent': LIMITLESS_USER_AGENT, Accept: 'text/html' },
      });

      // Reintento ante 429/5xx transitorios (respeta Retry-After); tras agotar, se lanza.
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        const waitMs = this.retryDelayMs(res, attempt);
        this.logger.warn(`limitless ${url} -> HTTP ${res.status}; retry ${attempt + 1}/${retries} en ${waitMs}ms`);
        await this.drain(res);
        await this.sleep(waitMs);
        return this.getText(url, attempt + 1, hops);
      }

      // Anti-SSRF: un 3xx NO se sigue a ciegas. Se lee `Location`, se resuelve contra la URL actual y
      // se valida su `origin` contra el allowlist ANTES de seguirlo. Off-host ⇒ se RECHAZA sin traerlo.
      if (res.status >= 300 && res.status < 400) {
        await this.drain(res);
        if (hops >= MAX_REDIRECT_HOPS) {
          throw new Error(`limitless ${url} -> demasiados redirects (> ${MAX_REDIRECT_HOPS})`);
        }
        const location = res.headers.get('location');
        if (!location) {
          throw new Error(`limitless ${url} -> HTTP ${res.status} sin Location`);
        }
        const next = this.resolveRedirect(location, url);
        if (!next || !this.isAllowlistedUrl(next)) {
          throw new Error(`limitless ${url} -> redirect fuera del allowlist (${location})`);
        }
        return this.getText(next, 0, hops + 1);
      }

      if (!res.ok) {
        await this.drain(res);
        throw new Error(`limitless ${url} -> HTTP ${res.status}`);
      }

      // Defensa en profundidad: con `redirect:'manual'` `res.url` es siempre la URL pedida (ya
      // allowlisted por `build*Url()` y por la validación del salto), pero se re-comprueba.
      if (!this.isAllowlistedUrl(res.url || url)) {
        await this.drain(res);
        throw new Error(`limitless ${url} -> respuesta fuera del allowlist (${res.url})`);
      }

      // Fast-path: content-length declarado por encima del cap ⇒ aborta sin leer el cuerpo.
      const declared = Number(res.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > maxBytes) {
        controller.abort();
        throw new Error(`limitless ${url} -> content-length ${declared} > cap ${maxBytes}`);
      }

      return await this.readCapped(res, maxBytes, controller, url);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Delay del reintento: `Retry-After` (segundos) si viene y es válido; si no, backoff 2 s → 5 s. */
  private retryDelayMs(res: Response, attempt: number): number {
    const retryAfter = Number(res.headers.get('retry-after'));
    if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000;
    return attempt === 0 ? 2000 : 5000;
  }

  private isAllowlistedUrl(u: string): boolean {
    try {
      return new URL(u).origin === LIMITLESS_HOST;
    } catch {
      return false;
    }
  }

  /** Resuelve un `Location` (absoluto o relativo) contra la URL actual; `null` si no es una URL válida. */
  private resolveRedirect(location: string, base: string): string | null {
    try {
      return new URL(location, base).toString();
    } catch {
      return null;
    }
  }

  /**
   * Lee el cuerpo por chunks acumulando bytes; al superar `maxBytes` aborta y lanza (cap de memoria).
   * Si no hay stream disponible, cae a `res.text()` y aplica el cap sobre el resultado.
   */
  private async readCapped(res: Response, maxBytes: number, controller: AbortController, url: string): Promise<string> {
    const body = res.body as ReadableStream<Uint8Array> | null;
    if (!body || typeof body.getReader !== 'function') {
      const text = await res.text();
      if (Buffer.byteLength(text) > maxBytes) {
        throw new Error(`limitless ${url} -> cuerpo ${Buffer.byteLength(text)} > cap ${maxBytes}`);
      }
      return text;
    }
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let total = 0;
    let out = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          controller.abort();
          await reader.cancel().catch(() => undefined);
          throw new Error(`limitless ${url} -> cuerpo > cap ${maxBytes} (abortado)`);
        }
        out += decoder.decode(value, { stream: true });
      }
    }
    out += decoder.decode();
    return out;
  }

  /** Descarta el cuerpo de una respuesta que no se va a parsear (libera el socket). */
  private async drain(res: Response): Promise<void> {
    try {
      await res.arrayBuffer();
    } catch {
      // best-effort
    }
  }
}
