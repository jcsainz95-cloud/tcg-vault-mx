/**
 * LIVE-7 (API_CONTRACT §14.7, v1.84) — reducción de un informe CSP a los CUATRO campos que se registran:
 * `effectiveDirective`, ORIGEN de `blockedURI` (sin ruta), RUTA de `documentURI` (sin query ni fragmento) y
 * `disposition`. ⛔ Nada más: sin `sample`/`script-sample`, sin `referrer`, sin IP, sin UA. Las páginas
 * `reset-password?token=…` y `verify-email?token=…` llevan secretos en la query: por eso solo la ruta.
 *
 * Funciones puras: no lanzan con NINGUNA entrada (el endpoint responde `204` siempre).
 */

export interface CspLogFields {
  effectiveDirective?: string;
  blockedOrigin?: string;
  documentPath?: string;
  disposition?: 'enforce' | 'report';
}

/** Tope de líneas por petición (una lista `reports+json` puede traer muchas). */
export const CSP_MAX_REPORTS_PER_REQUEST = 20;
const MAX_PATH = 200;

const DIRECTIVE = /^[a-z][a-z0-9-]{0,39}$/;
/** Valores no-URL que los navegadores ponen en `blocked-uri`. */
const BLOCKED_KEYWORDS = new Set(['inline', 'eval', 'self', 'wasm-eval', 'trusted-types-policy', 'trusted-types-sink']);

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function directiveOf(v: unknown): string | undefined {
  // `violated-directive` legado puede traer la lista de fuentes (`script-src 'self'`): solo el nombre.
  const first = str(v)?.trim().split(/\s+/)[0];
  return first && DIRECTIVE.test(first) ? first : undefined;
}

function blockedOriginOf(v: unknown): string | undefined {
  const s = str(v)?.trim();
  if (!s) return undefined;
  if (BLOCKED_KEYWORDS.has(s)) return s;
  try {
    const u = new URL(s);
    if (['http:', 'https:', 'ws:', 'wss:'].includes(u.protocol)) return u.origin;
    // `data:`, `blob:`, `chrome-extension:` … ⇒ solo el esquema (el resto puede ser contenido).
    return /^[a-z][a-z0-9+.-]{0,30}:$/.test(u.protocol) ? u.protocol : undefined;
  } catch {
    return undefined;
  }
}

function documentPathOf(v: unknown): string | undefined {
  const s = str(v);
  if (!s) return undefined;
  try {
    return new URL(s).pathname.slice(0, MAX_PATH);
  } catch {
    return undefined;
  }
}

function dispositionOf(v: unknown): CspLogFields['disposition'] {
  return v === 'enforce' || v === 'report' ? v : undefined;
}

function compact(f: CspLogFields): CspLogFields | null {
  const out: CspLogFields = {};
  if (f.effectiveDirective) out.effectiveDirective = f.effectiveDirective;
  if (f.blockedOrigin) out.blockedOrigin = f.blockedOrigin;
  if (f.documentPath) out.documentPath = f.documentPath;
  if (f.disposition) out.disposition = f.disposition;
  return Object.keys(out).length > 0 ? out : null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Acepta el cuerpo tal como llegó (texto crudo del parser de la ruta, u objeto si otro parser ya lo leyó) en
 * cualquiera de las dos formas: `application/csp-report` (`{ "csp-report": {…} }`) o `application/reports+json`
 * (lista de `{ type: "csp-violation", body: {…} }`). Devuelve ≤ `CSP_MAX_REPORTS_PER_REQUEST` resúmenes.
 */
export function summarizeCspReports(raw: unknown): CspLogFields[] {
  let body: unknown = raw;
  if (typeof raw === 'string') {
    try {
      body = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  const out: CspLogFields[] = [];
  if (isRecord(body) && isRecord(body['csp-report'])) {
    const r = body['csp-report'];
    const line = compact({
      effectiveDirective: directiveOf(r['effective-directive']) ?? directiveOf(r['violated-directive']),
      blockedOrigin: blockedOriginOf(r['blocked-uri']),
      documentPath: documentPathOf(r['document-uri']),
      disposition: dispositionOf(r['disposition']),
    });
    if (line) out.push(line);
    return out;
  }
  if (Array.isArray(body)) {
    for (const item of body) {
      if (out.length >= CSP_MAX_REPORTS_PER_REQUEST) break;
      if (!isRecord(item) || item.type !== 'csp-violation' || !isRecord(item.body)) continue;
      const b = item.body;
      const line = compact({
        effectiveDirective: directiveOf(b.effectiveDirective),
        blockedOrigin: blockedOriginOf(b.blockedURL),
        documentPath: documentPathOf(b.documentURL),
        disposition: dispositionOf(b.disposition),
      });
      if (line) out.push(line);
    }
  }
  return out;
}

/** `path` de `client-error` recortado a la ruta: sin query ni fragmento (acepta relativo o URL absoluta). */
export function pathWithoutQuery(path: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
    try {
      return new URL(path).pathname;
    } catch {
      /* cae al recorte textual */
    }
  }
  return path.split(/[?#]/, 1)[0];
}
