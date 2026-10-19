/**
 * measurement-input.ts — saneador PURO del objeto `measurement` de `POST /checkout/session`,
 * `POST /checkout/guest/session` y `POST /buylist/requests` (API_CONTRACT §MKT.H.2).
 *
 * ⛔ NUNCA lanza. Lee campo a campo y DESCARTA lo que no cumple: un `measurement` mal formado da la misma respuesta
 * que sin él (nunca 400 por este campo). Claves desconocidas ⇒ se ignoran.
 *
 * Reglas:
 * - Sin `consent` con dos booleanos o sin `noticeVersion` válido ⇒ el objeto entero se ignora (no hay consentimiento
 *   que registrar; las columnas quedan NULL, como con el modo apagado).
 * - `consent.analytics=false` ⇒ fuera `firstUtm` y `gaClientId`. `consent.ads=false` ⇒ fuera `fbp`/`fbc`.
 * - Cada `utm` pasa `parseFirstUtm` (§MKT.C); `landedAt` futuro o de hace más de 90 días ⇒ se descarta.
 */
import { parseFirstUtm } from '../../common/first-utm';

export interface MeasurementConsent {
  analytics: boolean;
  ads: boolean;
}

/** Las columnas que se escriben EN LA MISMA escritura que crea `Order`/`SellRequest` (§MKT.H.2/.7). */
export interface MeasurementColumns {
  measurementConsentAnalytics: boolean;
  measurementConsentAds: boolean;
  measurementNoticeVersion: string;
  firstUtmSource?: string;
  firstUtmMedium?: string;
  firstUtmCampaign?: string;
  firstUtmContent?: string;
  firstUtmLandedAt?: Date;
}

/** Las claves de `MeasurementColumns`, una por una (TL-MKT2-D8). */
const MEASUREMENT_COLUMN_KEYS = [
  'measurementConsentAnalytics',
  'measurementConsentAds',
  'measurementNoticeVersion',
  'firstUtmSource',
  'firstUtmMedium',
  'firstUtmCampaign',
  'firstUtmContent',
  'firstUtmLandedAt',
] as const satisfies readonly (keyof MeasurementColumns)[];

/**
 * Proyección EXPLÍCITA de las columnas de medición para el `create` de `Order`/`SellRequest`: solo esas ocho claves, así
 * que aunque llegue un objeto con más campos (p. ej. `totalCents`) ⛔ nada de dinero se pisa al esparcirla al final.
 */
export function measurementColumnsData(c: Partial<MeasurementColumns>): Partial<MeasurementColumns> {
  const out: Partial<Record<keyof MeasurementColumns, unknown>> = {};
  for (const k of MEASUREMENT_COLUMN_KEYS) if (c[k] !== undefined) out[k] = c[k];
  return out as Partial<MeasurementColumns>;
}

/** Lo que va a `MeasurementContext` después del commit (solo si hay al menos uno). */
export interface MeasurementContextInput {
  gaClientId?: string;
  fbp?: string;
  fbc?: string;
}

export interface SanitizedMeasurement {
  columns: MeasurementColumns;
  context: MeasurementContextInput | null;
}

const NOTICE_VERSION_RE = /^[A-Za-z0-9._-]{1,32}$/;
const GA_CLIENT_ID_RE = /^\d{1,10}\.\d{1,10}$/;
const FBP_RE = /^fb\.\d\.\d{10,13}\.\d{1,20}$/;
const FBC_RE = /^fb\.\d\.\d{10,13}\.[A-Za-z0-9_-]{1,500}$/;
const LANDED_MAX_AGE_MS = 90 * 24 * 3600 * 1000;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, re: RegExp): string | undefined => (typeof v === 'string' && re.test(v) ? v : undefined);

function landedAt(v: unknown, now: Date): Date | undefined {
  if (typeof v !== 'string' || v.length > 40) return undefined;
  const t = Date.parse(v);
  if (!Number.isFinite(t)) return undefined;
  if (t > now.getTime() || now.getTime() - t > LANDED_MAX_AGE_MS) return undefined;
  return new Date(t);
}

/**
 * Sanea el objeto. `null` ⇒ no se escribe nada (sin consentimiento legible). Pura: `now` entra por parámetro.
 * ⛔ No mira el modo: el modo lo decide `MeasurementService.prepare` (con `off`, ni se llama).
 */
export function sanitizeMeasurementInput(raw: unknown, now: Date): SanitizedMeasurement | null {
  try {
    if (!isObj(raw)) return null;
    const consent = raw.consent;
    if (!isObj(consent) || typeof consent.analytics !== 'boolean' || typeof consent.ads !== 'boolean') return null;
    const noticeVersion = str(raw.noticeVersion, NOTICE_VERSION_RE);
    if (!noticeVersion) return null;

    const columns: MeasurementColumns = {
      measurementConsentAnalytics: consent.analytics,
      measurementConsentAds: consent.ads,
      measurementNoticeVersion: noticeVersion,
    };
    const context: MeasurementContextInput = {};

    if (consent.analytics) {
      if (isObj(raw.firstUtm)) {
        const fu = raw.firstUtm;
        const utm = parseFirstUtm({
          utm_source: fu.source,
          utm_medium: fu.medium,
          utm_campaign: fu.campaign,
          utm_content: fu.content,
        });
        if (utm.source) columns.firstUtmSource = utm.source;
        if (utm.medium) columns.firstUtmMedium = utm.medium;
        if (utm.campaign) columns.firstUtmCampaign = utm.campaign;
        if (utm.content) columns.firstUtmContent = utm.content;
        // La fecha de llegada solo acompaña a un origen válido (sin utm, no hay «primer toque» que fechar).
        const anyUtm = utm.source || utm.medium || utm.campaign || utm.content;
        const at = anyUtm ? landedAt(fu.landedAt, now) : undefined;
        if (at) columns.firstUtmLandedAt = at;
      }
      const ga = str(raw.gaClientId, GA_CLIENT_ID_RE);
      if (ga) context.gaClientId = ga;
    }
    if (consent.ads) {
      const fbp = str(raw.fbp, FBP_RE);
      const fbc = str(raw.fbc, FBC_RE);
      if (fbp) context.fbp = fbp;
      if (fbc) context.fbc = fbc;
    }
    return { columns, context: Object.keys(context).length > 0 ? context : null };
  } catch {
    // Defensa en profundidad: un getter hostil o un proxy no tumba la compra.
    return null;
  }
}
