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
  // v1.52-set-logos (M-47, §4.39.1 hecho 2/4): pokemontcg.io publica DOS imágenes por set y este tipo
  // las descartaba, así que el sync no las persistía. `logo` = el nombre del set dibujado (ancho, de
  // proporción MUY variable entre sets) — es la teja de selección de set. `symbol` = el glifo cuadrado
  // impreso en la carta. SOLO ES TIPADO: `GET /v2/sets` ya traía este bloque en el JSON descargado ⇒
  // CERO requests extra, cero latencia (mismo patrón que `RemoteCard.cardmarket`).
  // ⚠️ SIN VERIFICAR (§4.39.4, egress bloqueado en este entorno): si el `set` ANIDADO en una carta trae
  // o no `images`. Por eso ambas son opcionales y el ausente NO degrada (ver `upsertSet`): esa vía, si
  // no lo trae, simplemente no aporta el dato — jamás borra el que escribió `GET /v2/sets`.
  // Consecuencia OPERATIVA anotada en `docs/BACKEND_NOTES.md` §0.19.
  images?: { symbol?: string; logo?: string };
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
  // DECKS-META §2.2 (Fase 0): LEGALIDAD. Igual que `cardmarket` arriba, SOLO ES TIPADO: el endpoint
  // `GET /v2/cards` NO usa `select=`, así que estos campos YA venían en el JSON y hoy se descartan
  // (M3) ⇒ mapearlos cuesta CERO requests. `regulationMark` = la marca impresa ("F"/"G"/"H"/"I"…);
  // `legalities.standard` = "Legal"|"Banned" (ausente ⇒ no viene). Los lee `upsertCards` con
  // NO-DEGRADACIÓN. Confirmar que el payload en vivo los trae poblados es NO MEDIDO (egress, M9).
  regulationMark?: string | null;
  legalities?: { standard?: string; expanded?: string; unlimited?: string } | null;
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
  protected readonly baseBackoffMs: number = 500;
  /** Tope por petición del camino general (sync): evita un fetch colgado sin fin. */
  protected readonly requestTimeoutMs: number = 60_000;
  /** Camino ACOTADO (import de promos): 3 intentos, ≤2 s entre intentos, presupuesto total 10 s. */
  protected readonly boundedAttempts: number = 3;
  protected readonly boundedMaxWaitMs: number = 2_000;
  protected readonly boundedBudgetMs: number = 10_000;
  /** Caché en memoria del último resultado BUENO de la lista de sets (24 h). */
  protected readonly setsCacheTtlMs: number = 24 * 60 * 60 * 1000;
  private setsCache: { at: number; sets: RemoteCardSet[] } | null = null;

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
    const res = await fetch(`${this.baseUrl}${path}`, { headers: this.headers(), signal: AbortSignal.timeout(this.requestTimeoutMs) });
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
    return this.nonEmptySets(body);
  }

  /** QA-PRM-EMPTY: un 200 con `data` ausente, no-array o vacío NO es una respuesta (fail-closed), jamás `[]`. */
  private nonEmptySets(body: { data?: unknown } | null | undefined): RemoteCardSet[] {
    const data = body?.data;
    if (!Array.isArray(data) || data.length === 0) throw new Error('pokemontcg.io /sets -> 200 sin datos');
    return data as RemoteCardSet[];
  }

  /**
   * QA-PRM-FLAKY — lista de sets para el IMPORT: hasta 3 intentos, ≤2 s entre ellos, presupuesto total 10 s (un `Retry-After`
   * mayor que lo que queda del presupuesto corta). Una sola señal `AbortController` cancela fetch y esperas al agotarse el
   * presupuesto o al terminar: nada sigue en segundo plano tras responder. Éxito ⇒ caché 24 h; fallo ⇒ caché vigente si la hay;
   * sin caché ⇒ lanza (el servicio responde 503 POKEMONTCG_UNAVAILABLE).
   */
  async getSetsBounded(): Promise<RemoteCardSet[]> {
    const ctl = new AbortController();
    const started = Date.now();
    const budgetTimer = setTimeout(() => ctl.abort(), this.boundedBudgetMs);
    try {
      let lastErr: Error = new Error('sin intentos');
      for (let attempt = 0; attempt < this.boundedAttempts; attempt++) {
        let waitMs = Math.min(this.baseBackoffMs * 2 ** attempt, this.boundedMaxWaitMs);
        try {
          const res = await fetch(`${this.baseUrl}/sets?pageSize=250`, { headers: this.headers(), signal: ctl.signal });
          if (res.ok) {
            const sets = this.nonEmptySets((await res.json()) as { data?: unknown });
            this.setsCache = { at: Date.now(), sets };
            return sets;
          }
          lastErr = new Error(`pokemontcg.io /sets -> HTTP ${res.status}`);
          if (res.status !== 429 && res.status < 500) break; // 4xx no transitorio: no se reintenta
          const ra = Number(res.headers.get('retry-after'));
          if (Number.isFinite(ra) && ra > 0) {
            if (ra * 1000 > this.boundedBudgetMs - (Date.now() - started)) break; // Retry-After > lo que queda ⇒ se corta
            waitMs = Math.min(ra * 1000, this.boundedMaxWaitMs);
          }
        } catch (e) {
          lastErr = e as Error;
          if (ctl.signal.aborted) break;
        }
        if (attempt === this.boundedAttempts - 1) break;
        if (Date.now() - started + waitMs >= this.boundedBudgetMs) break;
        this.logger.warn(`pokemontcg.io /sets: ${lastErr.message}; intento ${attempt + 2}/${this.boundedAttempts} en ${waitMs}ms`);
        await this.sleepAbortable(waitMs, ctl.signal);
        if (ctl.signal.aborted) break;
      }
      const cached = this.setsCache;
      if (cached && Date.now() - cached.at < this.setsCacheTtlMs) {
        this.logger.warn(`pokemontcg.io /sets caído (${lastErr.message}); se usa la caché de ${Math.round((Date.now() - cached.at) / 60000)} min.`);
        return cached.sets;
      }
      throw lastErr;
    } finally {
      clearTimeout(budgetTimer);
      ctl.abort(); // nada vivo tras responder
    }
  }

  private sleepAbortable(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const t = setTimeout(done, ms);
      function done() {
        clearTimeout(t);
        signal.removeEventListener('abort', done);
        resolve();
      }
      signal.addEventListener('abort', done);
    });
  }

  /** GET /v2/cards?q=set.id:{setId} — cartas de un set (paginado). setId ya validado. */
  async getCardsBySet(setId: string, page: number, pageSize = 250): Promise<RemotePage<RemoteCard>> {
    const q = encodeURIComponent(`set.id:${setId}`);
    return this.getJson<RemotePage<RemoteCard>>(`/cards?q=${q}&page=${page}&pageSize=${pageSize}`);
  }
}
