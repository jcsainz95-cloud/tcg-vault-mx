/**
 * marketing-external-sources.ts — adaptadores de LECTURA del Panel: GA4 Data API y Search Console (API_CONTRACT §MKT.H.9;
 * ARCHITECTURE §14.9). Cuenta de servicio PROPIA de la tienda (`MKT_GOOGLE_SA_JSON`), solo lectura.
 *
 * FAIL-CLOSED: sin credenciales, con credenciales mal formadas o con cualquier error de la API, el adaptador devuelve
 * `{ ok: false }` y la tabla viaja `measured:false` con «NO MEDIDO — GA4 sin conectar» / «NO MEDIDO — Search Console sin
 * conectar». ⛔ Nunca «0». ⛔ Nunca se registra la llave, el token de acceso ni el cuerpo de la respuesta.
 *
 * Caché por `(fuente, consulta)` de 6 h (los periodos son cerrados). La red pasa por `GoogleReadPort`: las pruebas lo
 * sustituyen por un doble (⛔ no hay red a Google desde aquí ni desde CI).
 *
 * Search Console NO depende del aviso de privacidad (no toca al visitante): se lee en cuanto haya credenciales, con
 * cualquier `MEASUREMENT_MODE`. GA4 sí: con el modo apagado no hay datos que leer y su motivo es «GA4 sin encender».
 */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const GA4_READ_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
export const SC_READ_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
export const CACHE_TTL_MS = 6 * 3600 * 1000;

const GA4_PROPERTY_RE = /^\d{6,12}$/;
const SC_SITE_RE = /^(sc-domain:[a-z0-9.-]{1,253}|https:\/\/[^\s?#]{1,253}\/)$/;

export const GOOGLE_READ_PORT = Symbol('GOOGLE_READ_PORT');

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

export type SourceResult<T> = { ok: true; rows: T[] } | { ok: false };

export interface SearchConsoleRow {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface Ga4ReportSpec {
  dimensions: string[];
  metrics: string[];
  limit?: number;
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

  /**
   * GA4 Data API `runReport` genérico. ⚠️ El contrato no fija todavía la consulta de cada tabla GA4 (dimensiones y
   * métricas de a4, a5, b*, c*, d2, e3): ninguna tabla lo llama hasta que el arquitecto las defina.
   */
  async ga4Report(spec: Ga4ReportSpec, from: string, to: string, now = new Date()): Promise<SourceResult<Ga4Row>> {
    if (!this.key || !this.ga4Property) return { ok: false };
    const key = this.key;
    const prop = this.ga4Property;
    return this.cached(`ga4|${JSON.stringify(spec)}|${from}|${to}`, now, async () => {
      const url = `https://analyticsdata.googleapis.com/v1beta/properties/${prop}:runReport`;
      const data = (await this.port.postJson(key, GA4_READ_SCOPE, url, {
        dateRanges: [{ startDate: from, endDate: to }],
        dimensions: spec.dimensions.map((name) => ({ name })),
        metrics: spec.metrics.map((name) => ({ name })),
        limit: spec.limit ?? 50,
      })) as { rows?: { dimensionValues?: { value?: unknown }[]; metricValues?: { value?: unknown }[] }[] };
      return (data?.rows ?? []).map((r) => ({
        dimensions: (r.dimensionValues ?? []).map((d) => (typeof d.value === 'string' ? d.value : '')),
        metrics: (r.metricValues ?? []).map((m) => Number(m.value) || 0),
      }));
    });
  }

  private async cached<T>(k: string, now: Date, load: () => Promise<T[]>): Promise<SourceResult<T>> {
    const hit = this.cache.get(k);
    if (hit && now.getTime() - hit.at < CACHE_TTL_MS) return hit.value as SourceResult<T>;
    let value: SourceResult<T>;
    try {
      value = { ok: true, rows: await load() };
    } catch {
      // ⛔ Sin el mensaje (podría citar la URL o el cuerpo). El error no se cachea: la siguiente lectura reintenta.
      this.logger.warn(`marketing: lectura externa fallida (${k.split('|')[0]})`);
      return { ok: false };
    }
    this.cache.set(k, { at: now.getTime(), value });
    if (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value as string);
    return value;
  }
}
