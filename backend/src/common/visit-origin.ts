/**
 * visit-origin.ts — saneador PURO de `visitOrigin` (§ORIGEN-VISITA; docs/API_CONTRACT_ORIGEN.md).
 *
 * ⛔ NUNCA lanza. Campo a campo: lo inválido (tipo raro, arreglo, regex, referrer fuera del enum, claves desconocidas)
 * se descarta y el resto vale; un `visitOrigin` roto da la misma respuesta que sin él (jamás 400). Independiente de
 * `measurement`/consentimiento/`MEASUREMENT_MODE`. ⛔ Estas columnas NO salen a GA4, Meta, CAPI ni MeasurementContext.
 */
import { parseFirstUtm } from './first-utm';

export const VISIT_REFERRERS = ['google', 'bing', 'chatgpt', 'perplexity', 'gemini', 'instagram', 'facebook', 'otro', 'directo'] as const;
export type VisitReferrerValue = (typeof VISIT_REFERRERS)[number];

export interface VisitColumns {
  visitUtmSource?: string;
  visitUtmMedium?: string;
  visitUtmCampaign?: string;
  visitUtmContent?: string;
  visitReferrer?: VisitReferrerValue;
}

const VISIT_KEYS = ['visitUtmSource', 'visitUtmMedium', 'visitUtmCampaign', 'visitUtmContent', 'visitReferrer'] as const satisfies readonly (keyof VisitColumns)[];

export function sanitizeVisitOrigin(raw: unknown): VisitColumns {
  const out: VisitColumns = {};
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const o = raw as Record<string, unknown>;
  // Mismo saneador que `firstUtm*` (regex ^[a-z0-9._-]{1,64}$, minúsculas); solo se leen estas cuatro claves.
  const u = parseFirstUtm({ utm_source: o.utmSource, utm_medium: o.utmMedium, utm_campaign: o.utmCampaign, utm_content: o.utmContent });
  if (u.source !== undefined) out.visitUtmSource = u.source;
  if (u.medium !== undefined) out.visitUtmMedium = u.medium;
  if (u.campaign !== undefined) out.visitUtmCampaign = u.campaign;
  if (u.content !== undefined) out.visitUtmContent = u.content;
  const r = o.referrer;
  if (typeof r === 'string' && (VISIT_REFERRERS as readonly string[]).includes(r)) out.visitReferrer = r as VisitReferrerValue;
  return out;
}

/** Proyección explícita para el `create` (solo las cinco claves; nada de dinero puede colarse). */
export function visitColumnsData(c: Partial<VisitColumns>): Partial<VisitColumns> {
  const out: Record<string, unknown> = {};
  for (const k of VISIT_KEYS) if (c[k] !== undefined) out[k] = c[k];
  return out as Partial<VisitColumns>;
}

/** Fusión única para los controladores: columnas de medición (si las hay) + origen de visita saneado (§ORIGEN-VISITA). */
export function mergeOriginColumns<M extends object>(measurementColumns: M | undefined, visitOrigin: unknown): M & VisitColumns {
  return { ...(measurementColumns ?? ({} as M)), ...sanitizeVisitOrigin(visitOrigin) };
}
