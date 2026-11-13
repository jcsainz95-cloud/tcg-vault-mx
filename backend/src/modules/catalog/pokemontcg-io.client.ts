import { AsyncLocalStorage } from 'node:async_hooks';
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
  // AUTO-B: SOLO TIPADO (el endpoint no usa `select=`, ya venian en el JSON); alimentan `Card.contentKey`.
  hp?: string | null;
  attacks?: { name?: string | null }[] | null;
  abilities?: { name?: string | null }[] | null;
  rules?: string[] | null;
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
  /**
   * Modo PACIENTE (segunda pasada del barrido, decisión del dueño 2026-11-13: pokemontcg.io da 5xx en ~60 % de los pedidos): más
   * intentos y un backoff mucho más largo (5, 10, 20, 40, 60, 60 s ≈ 3 min por pedido). Se activa SOLO dentro de `runPatient(fn)`
   * (AsyncLocalStorage: no contamina a otro llamador concurrente, p. ej. un import manual del admin).
   */
  protected readonly patientMaxRetries: number = 6;
  protected readonly patientBaseBackoffMs: number = 5_000;
  protected readonly patientMaxWaitMs: number = 60_000;
  private readonly patience = new AsyncLocalStorage<boolean>();
  /** Tope por petición del camino general (sync): evita un fetch colgado sin fin. */
  protected readonly requestTimeoutMs: number = 60_000;
  /** Camino ACOTADO (import de promos): 4 intentos, ≤2 s entre intentos, presupuesto total 20 s. */
  protected readonly boundedAttempts: number = 4;
  protected readonly boundedMaxWaitMs: number = 2_000;
  protected readonly boundedBudgetMs: number = 20_000;
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
  /** Ejecuta `fn` en modo paciente (más intentos y backoff largo) — ver `patientMaxRetries`. */
  runPatient<T>(fn: () => Promise<T>): Promise<T> {
    return this.patience.run(true, fn);
  }

  private async getJson<T>(path: string, attempt = 0): Promise<T> {
    const patient = this.patience.getStore() === true;
    const maxRetries = patient ? this.patientMaxRetries : this.maxRetries;
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, { headers: this.headers(), signal: AbortSignal.timeout(this.requestTimeoutMs) });
    } catch (e) {
      // Timeout o fallo de red de ESTE cliente: el error lleva SIEMPRE el prefijo `pokemontcg.io` (lo lee el clasificador de la alerta de 48 h,
      // que no culpa a la fuente por un timeout nuestro). En modo paciente se reintenta; en el normal sale como siempre (una sola vez).
      const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
      const detail = e instanceof Error ? e.message : String(e);
      if (patient && attempt < maxRetries) {
        const waitMs = Math.min(this.patientBaseBackoffMs * 2 ** attempt, this.patientMaxWaitMs);
        this.logger.warn(`pokemontcg.io ${path} -> ${timedOut ? 'timeout' : 'network'}; retry ${attempt + 1}/${maxRetries} en ${waitMs}ms (paciente)`);
        await this.sleep(waitMs);
        return this.getJson<T>(path, attempt + 1);
      }
      throw new Error(`pokemontcg.io ${path} -> ${timedOut ? 'timeout' : 'network'}: ${detail}`);
    }
    if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
      const retryAfterHeader = Number(res.headers.get('retry-after'));
      const backoff = patient
        ? Math.min(this.patientBaseBackoffMs * 2 ** attempt, this.patientMaxWaitMs)
        : this.baseBackoffMs * 2 ** attempt;
      const headerMs = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0 ? retryAfterHeader * 1000 : null;
      // En modo paciente un `Retry-After` desmedido se acota (60 s): el presupuesto del barrido manda.
      const waitMs = headerMs === null ? backoff : patient ? Math.min(headerMs, this.patientMaxWaitMs) : headerMs;
      this.logger.warn(
        `pokemontcg.io ${path} -> HTTP ${res.status}; retry ${attempt + 1}/${maxRetries} en ${waitMs}ms${patient ? ' (paciente)' : ''}`,
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
    const sets = this.nonEmptySets(body);
    // Calienta la caché del import de promos: M2 lista los sets al abrirse, así la caché ya existe (y sobrevive a un 503 puntual).
    this.setsCache = { at: Date.now(), sets };
    return sets;
  }

  /** QA-PRM-EMPTY: un 200 con `data` ausente, no-array o vacío NO es una respuesta (fail-closed), jamás `[]`. */
  private nonEmptySets(body: { data?: unknown } | null | undefined): RemoteCardSet[] {
    const data = body?.data;
    if (!Array.isArray(data) || data.length === 0) throw new Error('pokemontcg.io /sets -> 200 sin datos');
    return data as RemoteCardSet[];
  }

  /**
   * QA-PRM-FLAKY — lista de sets para el IMPORT: hasta 4 intentos, ≤2 s entre ellos, presupuesto total 20 s (un `Retry-After`
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
