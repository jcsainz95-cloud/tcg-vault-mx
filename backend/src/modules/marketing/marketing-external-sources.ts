/**
 * marketing-external-sources.ts — adaptadores de LECTURA del Panel: GA4 Data API y Search Console (API_CONTRACT §MKT.H.9;
 * ARCHITECTURE §14.9). Cuenta de servicio PROPIA de la tienda (`MKT_GOOGLE_SA_JSON`), solo lectura.
 *
 * FAIL-CLOSED: sin credenciales, con credenciales mal formadas o con cualquier error de la API, el adaptador devuelve
 * `{ ok: false }` y la tabla viaja `measured:false` con «NO MEDIDO — GA4 sin conectar» / «NO MEDIDO — Search Console sin
 * conectar». ⛔ Nunca «0». ⛔ Nunca se registra la llave, el token de acceso ni el cuerpo de la respuesta; del error, solo su clase.
 *
 * Caché por `(fuente, consulta)` de 6 h (los periodos son cerrados). La red pasa por `GoogleReadPort`: las pruebas lo
 * sustituyen por un doble (⛔ no hay red a Google desde aquí ni desde CI).
 *
 * Search Console NO depende del aviso de privacidad (no toca al visitante): se lee en cuanto haya credenciales, con
 * cualquier `MEASUREMENT_MODE`. GA4 sí: con el modo apagado no hay datos que leer y su motivo es «GA4 sin encender».
 */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { classifySourceError, isGa4IncompatibleQueryError } from './marketing-source-error';
import { withInternalExclusion } from './internal-traffic';

export const GA4_READ_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
export const SC_READ_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
export const CACHE_TTL_MS = 6 * 3600 * 1000;

const GA4_PROPERTY_RE = /^\d{6,12}$/;
const SC_SITE_RE = /^(sc-domain:[a-z0-9.-]{1,253}|https:\/\/[^\s?#]{1,253}\/)$/;

export const GOOGLE_READ_PORT = Symbol('GOOGLE_READ_PORT');

/** Campos usados de `inspectionResult.indexStatusResult` (§GSHOP.A). */
export interface UrlInspectionFields {
  verdict: string | null;
  coverageState: string | null;
  pageFetchState: string | null;
  robotsTxtState: string | null;
  indexingState: string | null;
  googleCanonical: string | null;
  userCanonical: string | null;
  lastCrawlTime: Date | null;
}
/** Resultado de UNA inspección: `forbidden` = 403 (sin permiso), `rate_limited` = 429, `transient` = 5xx/red, `invalid` = 400 u otra forma. */
export type UrlInspectOutcome =
  | { kind: 'ok'; fields: UrlInspectionFields }
  | { kind: 'not_configured' | 'forbidden' | 'rate_limited' | 'transient' | 'invalid'; errClass?: string };

/** Credencial de cuenta de servicio ya leída (solo los dos campos que hacen falta). */
export interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

export interface GoogleReadPort {
  /** POST JSON autenticado con la cuenta de servicio. Devuelve el JSON o lanza. ⛔ No registra nada. */
  postJson(key: ServiceAccountKey, scope: string, url: string, body: unknown): Promise<unknown>;
}

/** Implementación real con `google-auth-library` (JWT de cuenta de servicio). */
export const googleAuthReadPort: GoogleReadPort = {
  async postJson(key, scope, url, body) {
    const { JWT } = await import('google-auth-library');
    const client = new JWT({ email: key.client_email, key: key.private_key, scopes: [scope] });
    const res = await client.request({ url, method: 'POST', data: body, timeout: 10_000 });
    return res.data;
  },
};

/** `unfiltered`: GA4 rechazó el filtro de tráfico propio para esa consulta y se leyó sin él (MKT-V2 §4). */
export type SourceResult<T> = { ok: true; rows: T[]; unfiltered?: true; timeZone?: string } | { ok: false };

/** Consultas simultáneas a GA4 por pantalla (MKT-V2 §5). */
export const GA4_MAX_CONCURRENT = 4;
/** Aviso en el log cuando queda menos de este % de la cuota por hora. */
export const GA4_QUOTA_WARN_FRACTION = 0.2;

export interface SearchConsoleRow {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface SearchConsolePageRow {
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}
export interface SearchConsoleTotals {
  clicks: number;
  impressions: number;
}

export interface Ga4ReportSpec {
  dimensions: readonly string[];
  metrics: readonly string[];
  limit?: number;
  /** Filtro `inListFilter` sobre una dimensión (a5: los cinco eventos; e3: la lista de asistentes). */
  inList?: { dimension: string; values: readonly string[] };
  /** Orden descendente por una métrica (c1: por vistas). */
  orderByMetricDesc?: string;
}
export interface Ga4Row {
  dimensions: string[];
  metrics: number[];
}

/** Lee y valida la llave. Cualquier forma inesperada ⇒ `null` (fail-closed). */
export function parseServiceAccount(raw: string | undefined): ServiceAccountKey | null {
  if (!raw || raw.trim() === '') return null;
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    if (typeof j.client_email !== 'string' || typeof j.private_key !== 'string') return null;
    if (!/^[^\s@]+@[^\s@]+$/.test(j.client_email) || !j.private_key.includes('PRIVATE KEY')) return null;
    return { client_email: j.client_email, private_key: j.private_key };
  } catch {
    return null;
  }
}

@Injectable()
export class MarketingExternalSources {
  private readonly logger = new Logger(MarketingExternalSources.name);
  private readonly key: ServiceAccountKey | null;
  private readonly ga4Property: string | null;
  private readonly scSite: string | null;
  private readonly port: GoogleReadPort;
  private readonly cache = new Map<string, { at: number; value: SourceResult<unknown> }>();
  private inFlight = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(
    @Optional() config?: ConfigService,
    @Optional() @Inject(GOOGLE_READ_PORT) port?: GoogleReadPort,
  ) {
    const get = (k: string): string | undefined => (config ? config.get<string>(k) : process.env[k]);
    this.key = parseServiceAccount(get('MKT_GOOGLE_SA_JSON'));
    const prop = get('MKT_GA4_PROPERTY_ID')?.trim();
    this.ga4Property = prop && GA4_PROPERTY_RE.test(prop) ? prop : null;
    const site = get('MKT_SEARCH_CONSOLE_SITE')?.trim();
    this.scSite = site && SC_SITE_RE.test(site) ? site : null;
    this.port = port ?? googleAuthReadPort;
  }

  ga4Configured(): boolean {
    return this.key !== null && this.ga4Property !== null;
  }

  searchConsoleConfigured(): boolean {
    return this.key !== null && this.scSite !== null;
  }

  /** e1 — consultas de Google del rango (días `YYYY-MM-DD`, ambos inclusive). */
  async searchConsoleQueries(from: string, to: string, now = new Date()): Promise<SourceResult<SearchConsoleRow>> {
    if (!this.key || !this.scSite) return { ok: false };
    const key = this.key;
    const site = this.scSite;
    return this.cached(`sc|${from}|${to}`, now, async () => {
      const url = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`;
      const data = (await this.port.postJson(key, SC_READ_SCOPE, url, {
        startDate: from,
        endDate: to,
        dimensions: ['query'],
        rowLimit: 50,
      })) as { rows?: { keys?: unknown[]; clicks?: unknown; impressions?: unknown; ctr?: unknown; position?: unknown }[] };
      const rows = (data?.rows ?? []).map((r) => ({
        query: typeof r.keys?.[0] === 'string' ? (r.keys[0] as string) : '',
        clicks: Number(r.clicks) || 0,
        impressions: Number(r.impressions) || 0,
        ctr: Number(r.ctr) || 0,
        position: Number(r.position) || 0,
      }));
      return rows.filter((r) => r.query !== '');
    });
  }

  /** Origen (`https://host`) de la propiedad Search Console si es de prefijo de URL; `null` si es de dominio (`sc-domain:`) o sin conectar. */
  searchConsoleOrigin(): string | null {
    return this.scSite && this.scSite.startsWith('https://') ? this.scSite.replace(/\/+$/, '') : null;
  }

  /**
   * §GSHOP.A — URL Inspection de UNA url (`POST …/v1/urlInspection/index:inspect`). Misma cuenta de servicio y misma propiedad que el
   * resto de lecturas (alcance de solo lectura). Sin caché ni semáforo (el llamador marca el ritmo). Nunca lanza ni registra el
   * mensaje del error: solo su clase de lista cerrada (`classifySourceError`).
   */
  async urlInspect(inspectionUrl: string): Promise<UrlInspectOutcome> {
    if (!this.key || !this.scSite) return { kind: 'not_configured' };
    try {
      const data = (await this.port.postJson(this.key, SC_READ_SCOPE, 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', {
        inspectionUrl,
        siteUrl: this.scSite,
        languageCode: 'es',
      })) as { inspectionResult?: { indexStatusResult?: Record<string, unknown> } };
      const r = data?.inspectionResult?.indexStatusResult;
      if (!r || typeof r !== 'object') return { kind: 'invalid', errClass: 'sin-indexStatusResult' };
      const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
      const crawl = str(r.lastCrawlTime) ? new Date(r.lastCrawlTime as string) : null;
      return {
        kind: 'ok',
        fields: {
          verdict: str(r.verdict),
          coverageState: str(r.coverageState),
          pageFetchState: str(r.pageFetchState),
          robotsTxtState: str(r.robotsTxtState),
          indexingState: str(r.indexingState),
          googleCanonical: str(r.googleCanonical),
          userCanonical: str(r.userCanonical),
          lastCrawlTime: crawl && !Number.isNaN(crawl.getTime()) ? crawl : null,
        },
      };
    } catch (err) {
      const errClass = classifySourceError(err);
      const http = /http=(\d{3})/.exec(errClass)?.[1];
      if (http === '403' || errClass.includes('reason=PERMISSION_DENIED')) return { kind: 'forbidden', errClass };
      if (http === '429' || errClass.includes('RESOURCE_EXHAUSTED')) return { kind: 'rate_limited', errClass };
      if (http === '400') return { kind: 'invalid', errClass };
      return { kind: 'transient', errClass };
    }
  }

  /** Totales de Search Console del rango, SIN dimensión (r1). */
  async searchConsoleTotals(from: string, to: string, now = new Date()): Promise<SourceResult<SearchConsoleTotals>> {
    return this.scQuery<SearchConsoleTotals>(`sc-total|${from}|${to}`, from, to, [], 1, now, (r) => ({ clicks: Number(r.clicks) || 0, impressions: Number(r.impressions) || 0 }));
  }

  /** e2 — páginas de Google del rango (hasta 250). */
  async searchConsolePages(from: string, to: string, now = new Date()): Promise<SourceResult<SearchConsolePageRow>> {
    return this.scQuery<SearchConsolePageRow>(`sc-page|${from}|${to}`, from, to, ['page'], 250, now, (r) => ({
      page: typeof r.keys?.[0] === 'string' ? (r.keys[0] as string) : '',
      clicks: Number(r.clicks) || 0,
      impressions: Number(r.impressions) || 0,
      ctr: Number(r.ctr) || 0,
      position: Number(r.position) || 0,
    }));
  }

  private async scQuery<T>(
    cacheKey: string,
    from: string,
    to: string,
    dimensions: string[],
    rowLimit: number,
    now: Date,
    map: (r: { keys?: unknown[]; clicks?: unknown; impressions?: unknown; ctr?: unknown; position?: unknown }) => T,
  ): Promise<SourceResult<T>> {
    if (!this.key || !this.scSite) return { ok: false };
    const key = this.key;
    const site = this.scSite;
    return this.cached(cacheKey, now, async () => {
      const url = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`;
      const data = (await this.port.postJson(key, SC_READ_SCOPE, url, {
        startDate: from,
        endDate: to,
        ...(dimensions.length ? { dimensions } : {}),
        rowLimit,
      })) as { rows?: { keys?: unknown[]; clicks?: unknown; impressions?: unknown; ctr?: unknown; position?: unknown }[] };
      return (data?.rows ?? []).map(map);
    });
  }

  /** GA4 Data API `runReport`. Las consultas de cada tabla viven en `marketing-ga4.ts` (API_CONTRACT v1.105 §MKT.H.9). */
  async ga4Report(spec: Ga4ReportSpec, from: string, to: string, now = new Date()): Promise<SourceResult<Ga4Row>> {
    if (!this.key || !this.ga4Property) return { ok: false };
    const key = this.key;
    const prop = this.ga4Property;
    // MKT-V2 §4: TODA consulta excluye el tráfico propio (`diag-*`, `qa-*`…). El filtro entra en la llave de caché.
    return this.cached(`ga4|nx1|${JSON.stringify(spec)}|${from}|${to}`, now, async (): Promise<Ga4Row[] & { __unfiltered?: true; __tz?: string }> => {
      const url = `https://analyticsdata.googleapis.com/v1beta/properties/${prop}:runReport`;
      const run = async (filtered: boolean) => {
        const own = spec.inList ? { filter: { fieldName: spec.inList.dimension, inListFilter: { values: [...spec.inList.values] } } } : undefined;
        const dimensionFilter = filtered ? withInternalExclusion(own) : own;
        return this.limited(
          () =>
            this.port.postJson(key, GA4_READ_SCOPE, url, {
              dateRanges: [{ startDate: from, endDate: to }],
              dimensions: spec.dimensions.map((name) => ({ name })),
              metrics: spec.metrics.map((name) => ({ name })),
              limit: spec.limit ?? 50,
              returnPropertyQuota: true,
              ...(dimensionFilter ? { dimensionFilter } : {}),
              ...(spec.orderByMetricDesc ? { orderBys: [{ metric: { metricName: spec.orderByMetricDesc }, desc: true }] } : {}),
            }),
        );
      };
      let unfiltered = false;
      let raw: unknown;
      try {
        raw = await run(true);
      } catch (err) {
        // MKT-V2 §4: SOLO un 400 INVALID_ARGUMENT de compatibilidad (dimensión/métrica) reintenta sin filtro; 403/429/5xx/red y
        // cualquier otro 400 lanzan (la fila sale NO MEDIDO) para no mezclar tráfico propio sin avisar.
        if (!isGa4IncompatibleQueryError(err)) throw err;
        raw = await run(false);
        unfiltered = true;
      }
      const data = raw as {
        rows?: { dimensionValues?: { value?: unknown }[]; metricValues?: { value?: unknown }[] }[];
        propertyQuota?: { tokensPerHour?: { consumed?: unknown; remaining?: unknown } };
        metadata?: { timeZone?: unknown };
      };
      this.warnQuota(data?.propertyQuota);
      const rows: Ga4Row[] & { __unfiltered?: true; __tz?: string } = (data?.rows ?? []).map((r) => ({
        dimensions: (r.dimensionValues ?? []).map((d) => (typeof d.value === 'string' ? d.value : '')),
        metrics: (r.metricValues ?? []).map((m) => Number(m.value) || 0),
      }));
      if (unfiltered) rows.__unfiltered = true;
      if (typeof data?.metadata?.timeZone === 'string') rows.__tz = data.metadata.timeZone;
      return rows;
    }).then((r) => {
      if (!r.ok) return r;
      const x = r.rows as { __unfiltered?: true; __tz?: string };
      return { ...r, ...(x.__unfiltered ? { unfiltered: true as const } : {}), ...(x.__tz ? { timeZone: x.__tz } : {}) };
    });
  }

  /** Semáforo: como mucho `GA4_MAX_CONCURRENT` lecturas de GA4 a la vez. */
  private async limited<T>(fn: () => Promise<T>): Promise<T> {
    // El cupo se TRASPASA al que espera (no se libera y se vuelve a tomar): así nadie se cuela entre medias y nunca hay 5.
    if (this.inFlight >= GA4_MAX_CONCURRENT) await new Promise<void>((res) => this.waiting.push(res));
    else this.inFlight++;
    try {
      return await fn();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.inFlight--;
    }
  }

  /** Aviso (sin datos) cuando queda poca cuota por hora. */
  private warnQuota(q: { tokensPerHour?: { consumed?: unknown; remaining?: unknown } } | undefined): void {
    const consumed = Number(q?.tokensPerHour?.consumed);
    const remaining = Number(q?.tokensPerHour?.remaining);
    if (!Number.isFinite(consumed) || !Number.isFinite(remaining) || consumed + remaining <= 0) return;
    if (remaining / (consumed + remaining) < GA4_QUOTA_WARN_FRACTION) this.logger.warn('marketing: cuota por hora de GA4 por debajo del 20 %');
  }

  private async cached<T>(k: string, now: Date, load: () => Promise<T[]>): Promise<SourceResult<T>> {
    const hit = this.cache.get(k);
    if (hit && now.getTime() - hit.at < CACHE_TTL_MS) return hit.value as SourceResult<T>;
    let value: SourceResult<T>;
    try {
      value = { ok: true, rows: await load() };
    } catch (err) {
      // ⛔ Sin el mensaje (podría citar la URL, el sitio o el cuerpo): solo la CLASE, de lista cerrada
      // (`marketing-source-error.ts`). El error no se cachea: la siguiente lectura reintenta.
      this.logger.warn(`marketing: lectura externa fallida (${k.split('|')[0]}) ${classifySourceError(err)}`);
      return { ok: false };
    }
    this.cache.set(k, { at: now.getTime(), value });
    if (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value as string);
    return value;
  }
}
