/**
 * prod-probe.ts — 🔒 sonda de SOLO LECTURA contra la API de PRODUCCIÓN de Skydropx (pieza D0 de
 * API_CONTRACT §M4-SHIP.19.19.15; mide los `M-PRD-1…6` de §19.19.18 SIN GASTAR).          · devops
 *
 * ── LA GARANTÍA DE CERO GASTO, EN TRES CAPAS ─────────────────────────────────────────────────────────────
 *  1. LISTA BLANCA DE PETICIONES (`assertReadOnlyRequest`), evaluada en `ProbeTransport.request` ANTES del
 *     ritmo y ANTES de la red. Solo pasan:
 *        POST  {origen}/api/v1/oauth/token          (token: no gasta, PROD §3)
 *        POST  {origen}/api/v1/quotations           (cotizar: no gasta, PROD §0 — ~120 peticiones, saldo intacto)
 *        POST  {origen}/api/v2/quotations
 *        GET   {origen}/…                           (cualquier lectura)
 *     Todo lo demás —`POST /api/v2/shipments` (COMPRA), `/cancellations`, `/protect`, `/pickups`, `/orders`,
 *     `PUT/PATCH/DELETE` de lo que sea, otro host, `http:`— lanza `ProbeForbiddenRequestError` y NO sale.
 *     La ruta se compara DESPUÉS de normalizar la URL (WHATWG), y a la red viaja esa misma URL normalizada:
 *     `/quotations/../shipments` o `/quotations/%2e%2e/shipments` se comparan como `/shipments` y se rechazan.
 *  2. PRE-VUELO (`preflight`): la sonda NO arranca si `SKYDROPX_ALLOW_SPEND` trae cualquier valor, ni donde el
 *     candado de compra del backend (`evaluateMutationGate`, spend-gate.ts — el MISMO código, importado) diría
 *     `allowed`, ni en CI (`CI` puesto), ni bajo pruebas. Es decir: solo corre donde, aunque hubiera un defecto en
 *     la capa 1, el backend tampoco podría comprar.
 *  3. PRUEBA PROPIA (`prod-probe.test.ts`, corre en el job `backend` de ci.yml): la tabla de la lista blanca, cero
 *     llamadas al transporte en cada rechazo, una corrida ENTERA contra un doble que registra cada petición, y un
 *     estático que exige que la única llamada a la red esté detrás de `assertReadOnlyRequest`.
 *
 * ── SECRETOS Y SALIDA ─────────────────────────────────────────────────────────────────────────────────────
 *  - Credenciales SOLO de `SKYDROPX_CLIENT_ID` / `SKYDROPX_CLIENT_SECRET` (entorno). Nunca de argumentos ni de
 *    fichero. Nunca se imprimen.
 *  - La salida NO vuelca respuestas: el informe se arma con campos ELEGIDOS (lista blanca por construcción,
 *    SEC-SDX-13); de lo que solo interesa la FORMA (M-PRD-4/5/6) se imprimen claves y tipos, nunca valores. Los
 *    ids (cotización, tarifa, plantilla) salen como huella `fp:<sha256[0..10]>`: se pueden comparar, no usar.
 *  - Toda línea pasa además por `Redactor.scrub` (token, id/secreto de cliente, ids de plantilla, correos,
 *    teléfonos, cadenas largas tipo token).
 *
 * ── CÓMO SE CORRE ── `scripts/skydropx/run-prod-probe.sh` (DEVOPS_NOTES §78). ⛔ No desde CI; solo desde un
 * entorno con salida a Internet y las credenciales ya puestas (HECHOS.md:48).
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { evaluateMutationGate, readMutationGateInput } from '../../backend/src/modules/shipping-provider/spend-gate';
import { skydropxOrigin } from '../../backend/src/modules/shipping-provider/http/skydropx-origin';

/** PROD §1 / §19.19.18: la URL base no es secreta y, si falta del entorno, la sonda usa la de la referencia. */
export const PROBE_DEFAULT_BASE_URL = 'https://pro.skydropx.com/api/v1';
/** §19.19.3 (0): sin User-Agent propio Cloudflare responde 1010 (PROD §2). */
export const PROBE_USER_AGENT = 'tcg-hunt-probe/1 (+https://tcghunt.mx)';
/** ≤ 2 req/s (§19.19.3 (3)); la medición de PROD usó ≥ 0.6 s. */
export const PROBE_MIN_INTERVAL_MS = 600;
const POLL_EVERY_MS = 1500;
const POLL_CEILING_MS = 20_000;
const CALL_TIMEOUT_MS = 10_000;

/** M-PRD-1: los valores declarados que manda el contrato (§19.19.18). */
export const M_PRD_1_VALUES = [2500, 2501, 3000, 5000, 7500, 10000, 10001, 15000, 20000, 30000, 50000, 100000];

// ══ Capa 1: la lista blanca ════════════════════════════════════════════════════════════════════════════════

export class ProbeForbiddenRequestError extends Error {
  constructor(
    public readonly method: string,
    public readonly target: string,
    public readonly reason: string,
  ) {
    super(`prod-probe: petición VETADA antes de la red (${reason}): ${method} ${target}`);
    this.name = 'ProbeForbiddenRequestError';
  }
}

/** Las únicas escrituras admitidas (sufijos bajo el origen). Ninguna gasta (PROD §0, §3). */
export const PROBE_ALLOWED_POST_SUFFIXES = ['/api/v1/oauth/token', '/api/v1/quotations', '/api/v2/quotations'] as const;

/**
 * Lanza `ProbeForbiddenRequestError` si la petición no es de solo lectura. Devuelve la URL NORMALIZADA, que es la
 * única que el transporte manda a la red (así lo comparado y lo enviado son la misma cosa).
 */
export function assertReadOnlyRequest(method: string, url: string, origin: string): string {
  const m = String(method).toUpperCase();
  let u: URL;
  let o: URL;
  try {
    u = new URL(url);
    o = new URL(origin);
  } catch {
    throw new ProbeForbiddenRequestError(m, String(url), 'url_invalida');
  }
  if (u.protocol !== 'https:') throw new ProbeForbiddenRequestError(m, u.pathname, 'no_https');
  if (u.username || u.password) throw new ProbeForbiddenRequestError(m, u.pathname, 'credenciales_en_url');
  if (u.host.toLowerCase() !== o.host.toLowerCase()) throw new ProbeForbiddenRequestError(m, u.host, 'otro_host');
  const prefix = o.pathname.replace(/\/+$/, '');
  if (!u.pathname.startsWith(`${prefix}/`)) throw new ProbeForbiddenRequestError(m, u.pathname, 'fuera_del_origen');
  if (m === 'GET') return u.toString();
  if (m === 'POST') {
    const allowed = PROBE_ALLOWED_POST_SUFFIXES.map((s) => `${prefix}${s}`);
    if (allowed.includes(u.pathname) && u.search === '' && u.hash === '') return u.toString();
    throw new ProbeForbiddenRequestError(m, u.pathname, 'post_fuera_de_la_lista_blanca');
  }
  throw new ProbeForbiddenRequestError(m, u.pathname, 'metodo_no_admitido');
}

// ══ Redacción ══════════════════════════════════════════════════════════════════════════════════════════════

export const REDACTED = '«…»';

export function fp(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'fp:-';
  return `fp:${createHash('sha256').update(String(value)).digest('hex').slice(0, 10)}`;
}

export class Redactor {
  private readonly secrets = new Set<string>();

  add(value: string | null | undefined): void {
    if (typeof value === 'string' && value.trim().length >= 6) this.secrets.add(value.trim());
  }

  scrub(text: string): string {
    let out = text;
    // Los más largos primero: un secreto que contiene a otro no deja medio secreto a la vista.
    for (const s of [...this.secrets].sort((a, b) => b.length - a.length)) out = out.split(s).join(REDACTED);
    out = out.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, REDACTED); // correos
    out = out.replace(/(?<![\w:])\+?\d[\d\s-]{8,}\d(?!\w)/g, (m) => (m.replace(/\D/g, '').length >= 10 ? REDACTED : m)); // teléfonos
    out = out.replace(/[A-Za-z0-9_\-.]{40,}/g, REDACTED); // cadenas tipo token
    return out;
  }
}

/** La FORMA de un valor (claves y tipos), nunca sus valores. Para M-PRD-4/5/6. */
export function shapeOf(v: unknown, depth = 4): unknown {
  if (v === null) return 'null';
  if (Array.isArray(v)) return v.length === 0 ? '[] (vacío)' : [`${v.length} ×`, depth > 0 ? shapeOf(v[0], depth - 1) : '…'];
  if (typeof v === 'object') {
    if (depth <= 0) return '{…}';
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) out[k] = shapeOf((v as Record<string, unknown>)[k], depth - 1);
    return out;
  }
  return typeof v;
}

// ══ Transporte ═════════════════════════════════════════════════════════════════════════════════════════════

export interface ProbeFetchInit {
  method: string;
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}
export interface ProbeFetchResponse {
  status: number;
  text(): Promise<string>;
}
export type ProbeFetch = (url: string, init: ProbeFetchInit) => Promise<ProbeFetchResponse>;

export interface ProbeResponse {
  status: number;
  json: any;
  ms: number;
}

export interface ProbeTransportOptions {
  origin: string;
  fetchImpl: ProbeFetch;
  minIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export class EdgeBlockedError extends Error {}

export class ProbeTransport {
  readonly origin: string;
  private readonly fetchImpl: ProbeFetch;
  private readonly minIntervalMs: number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => number;
  private last = 0;
  requests = 0;

  constructor(opts: ProbeTransportOptions) {
    this.origin = opts.origin;
    this.fetchImpl = opts.fetchImpl;
    this.minIntervalMs = opts.minIntervalMs ?? PROBE_MIN_INTERVAL_MS;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = opts.now ?? (() => Date.now());
  }

  url(path: string, query?: Record<string, string>): string {
    const u = `${this.origin}${path}`;
    if (!query || Object.keys(query).length === 0) return u;
    return `${u}?${new URLSearchParams(query).toString()}`;
  }

  /**
   * ⭐ EL ÚNICO SITIO DEL FICHERO QUE TOCA LA RED. La lista blanca va PRIMERO: una petición vetada no consume
   * turno, no espera y no abre conexión. (El estático de la prueba exige este orden.)
   */
  async request(
    method: 'GET' | 'POST',
    path: string,
    opts: { query?: Record<string, string>; json?: unknown; form?: Record<string, string>; token?: string } = {},
  ): Promise<ProbeResponse> {
    const safeUrl = assertReadOnlyRequest(method, this.url(path, opts.query), this.origin);
    for (let attempt = 0; ; attempt += 1) {
      await this.pace();
      const headers: Record<string, string> = { 'User-Agent': PROBE_USER_AGENT, Accept: 'application/json' };
      let body: string | undefined;
      if (opts.form) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        body = new URLSearchParams(opts.form).toString();
      } else if (opts.json !== undefined) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(opts.json);
      }
      if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
      const started = this.now();
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), CALL_TIMEOUT_MS);
      let res: ProbeFetchResponse;
      try {
        this.requests += 1;
        res = await this.fetchImpl(safeUrl, { method, headers, body, signal: ctl.signal });
      } finally {
        clearTimeout(timer);
      }
      const text = await res.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      if (res.status === 403 && (json === null || /1010|browser_signature_banned/.test(text))) {
        throw new EdgeBlockedError('403 del borde (Cloudflare 1010): NO se reintenta (§19.19.3 (0))');
      }
      // 429: la sonda nunca lo fuerza; si llega, espera y reintenta ≤ 2 (todas sus peticiones son de lectura).
      if (res.status === 429 && attempt < 2) {
        await this.sleep(2000 * 2 ** attempt);
        continue;
      }
      return { status: res.status, json, ms: this.now() - started };
    }
  }

  private async pace(): Promise<void> {
    const wait = this.last + this.minIntervalMs - this.now();
    if (wait > 0) await this.sleep(wait);
    this.last = this.now();
  }
}

// ══ Capa 2: pre-vuelo ══════════════════════════════════════════════════════════════════════════════════════

export type EnvMap = Record<string, string | undefined>;

export type PreflightResult =
  | { ok: true; origin: string; clientId: string; clientSecret: string; minIntervalMs: number; baseUrlFrom: 'env' | 'referencia' }
  | { ok: false; reason: string };

const nonEmpty = (v: string | undefined): boolean => typeof v === 'string' && v.trim() !== '';

export function preflight(env: EnvMap): PreflightResult {
  if (nonEmpty(env.SKYDROPX_ALLOW_SPEND)) {
    return { ok: false, reason: 'spend_key_present: la sonda no corre con la llave de gasto puesta (con cualquier valor)' };
  }
  const gate = evaluateMutationGate(readMutationGateInput(env as NodeJS.ProcessEnv));
  if (gate === 'allowed') return { ok: false, reason: 'spend_gate_open: aquí el backend podría comprar; la sonda no corre' };
  if (gate.forbidden === 'ci') return { ok: false, reason: 'ci: la sonda no corre en CI (el CI no tiene ni debe tener credenciales)' };
  if (gate.forbidden === 'test_runtime') return { ok: false, reason: 'test_runtime: bajo pruebas la sonda no sale a la red' };
  const clientId = env.SKYDROPX_CLIENT_ID?.trim() ?? '';
  const clientSecret = env.SKYDROPX_CLIENT_SECRET?.trim() ?? '';
  if (!clientId || !clientSecret) return { ok: false, reason: 'missing_credentials: faltan SKYDROPX_CLIENT_ID / SKYDROPX_CLIENT_SECRET' };
  const baseUrlFrom = nonEmpty(env.SKYDROPX_BASE_URL) ? 'env' : 'referencia';
  let origin: string;
  try {
    origin = skydropxOrigin(baseUrlFrom === 'env' ? (env.SKYDROPX_BASE_URL as string) : PROBE_DEFAULT_BASE_URL);
  } catch (e) {
    return { ok: false, reason: `bad_base_url: ${(e as Error).message}` };
  }
  const rps = Number(env.SKYDROPX_RPS);
  // Nunca más rápido que 2 req/s, aunque SKYDROPX_RPS diga otra cosa.
  const minIntervalMs = Math.max(PROBE_MIN_INTERVAL_MS, Number.isFinite(rps) && rps > 0 ? Math.ceil(1000 / rps) : 0);
  return { ok: true, origin, clientId, clientSecret, minIntervalMs, baseUrlFrom };
}

// ══ Las mediciones ═════════════════════════════════════════════════════════════════════════════════════════

/** Paquete A (PROD §4.5): 25×18×3 cm, 1 kg. Origen 14210 Tlalpan → destino 06600 Cuauhtémoc (M-PRD-1). */
const ADDRESS_FROM_14210 = {
  country_code: 'MX',
  postal_code: '14210',
  area_level1: 'Ciudad de México',
  area_level2: 'Tlalpan',
  area_level3: 'Jardines en la Montaña',
};
const ADDRESS_TO_06600 = {
  country_code: 'MX',
  postal_code: '06600',
  area_level1: 'Ciudad de México',
  area_level2: 'Cuauhtémoc',
  area_level3: 'Juárez',
};

export interface QuoteSpec {
  height: number;
  declaredValue: number;
  orderId?: string;
  fromTemplateId?: string;
  templateMode?: 'top_level' | 'address_from';
}

export function quotationBody(q: QuoteSpec): Record<string, unknown> {
  const quotation: Record<string, unknown> = {
    address_from:
      q.fromTemplateId && q.templateMode === 'address_from' ? { address_template_id: q.fromTemplateId } : { ...ADDRESS_FROM_14210 },
    address_to: { ...ADDRESS_TO_06600 },
    parcels: [{ length: 25, width: 18, height: q.height, weight: 1, package_protected: true, declared_value: q.declaredValue }],
  };
  if (q.fromTemplateId && q.templateMode === 'top_level') quotation.address_template_from_id = q.fromTemplateId;
  if (q.orderId) quotation.order_id = q.orderId;
  return { quotation };
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

export interface QuoteOutcome {
  status: number;
  idFp: string;
  rawId: string | null;
  completed: boolean;
  polls: number;
  seconds: number;
  echo: { protected: unknown; declared: number | null; protectionValue: number | null } | null;
  protectionTotals: number[];
  successfulRates: number;
  requiresOriginVerification: unknown;
  ratesRequiringVerification: { true: number; false: number; other: number };
  templateEchoMatches: boolean | null;
  firstRateId: string | null;
  errorShape: unknown;
}

export interface ProbeContext {
  t: ProbeTransport;
  token: string;
  log: (line: string) => void;
}

export async function quote(ctx: ProbeContext, spec: QuoteSpec): Promise<QuoteOutcome> {
  const started = ctx.t.now();
  const created = await ctx.t.request('POST', '/api/v1/quotations', { json: quotationBody(spec), token: ctx.token });
  const id = created.json && typeof created.json.id === 'string' ? (created.json.id as string) : null;
  let body = created.json;
  let polls = 0;
  if (id && (created.status === 200 || created.status === 201)) {
    while (!(body && body.is_completed === true) && ctx.t.now() - started < POLL_CEILING_MS) {
      await ctx.t.sleep(POLL_EVERY_MS);
      const r = await ctx.t.request('GET', `/api/v1/quotations/${encodeURIComponent(id)}`, { token: ctx.token });
      polls += 1;
      if (r.status !== 200) break;
      body = r.json;
    }
  }
  const pkg = body && Array.isArray(body.packages) && body.packages.length > 0 ? body.packages[0] : null;
  const rates: any[] = body && Array.isArray(body.rates) ? body.rates : [];
  const ok = rates.filter((r) => r && r.success === true);
  const totals = [...new Set(ok.map((r) => num(r.protection_value_total)).filter((n): n is number => n !== null))].sort((a, b) => a - b);
  const verif = { true: 0, false: 0, other: 0 };
  for (const r of rates) {
    if (r?.requires_origin_verification === true) verif.true += 1;
    else if (r?.requires_origin_verification === false) verif.false += 1;
    else verif.other += 1;
  }
  const preferred = ok.find((r) => r.provider_name === 'ninetynineminutes') ?? ok[0];
  return {
    status: created.status,
    idFp: fp(id),
    rawId: id,
    completed: !!(body && body.is_completed === true),
    polls,
    seconds: Math.round((ctx.t.now() - started) / 100) / 10,
    echo: pkg ? { protected: pkg.package_protected, declared: num(pkg.declared_value), protectionValue: num(pkg.protection_value) } : null,
    protectionTotals: totals,
    successfulRates: ok.length,
    requiresOriginVerification: body ? body.requires_origin_verification : undefined,
    ratesRequiringVerification: verif,
    templateEchoMatches: spec.fromTemplateId ? (body ? body.address_template_from_id === spec.fromTemplateId : false) : null,
    firstRateId: preferred && typeof preferred.id === 'string' ? preferred.id : null,
    errorShape: created.status >= 400 ? shapeOf(created.json, 3) : undefined,
  };
}

export async function balance(ctx: ProbeContext): Promise<{ status: number; balance: number | null; currency: string | null }> {
  const r = await ctx.t.request('GET', '/api/v1/finance/credits', { token: ctx.token });
  const d = r.json && r.json.data ? r.json.data : r.json;
  return { status: r.status, balance: d ? num(d.balance) : null, currency: d && typeof d.currency === 'string' ? d.currency : null };
}

export interface ProbeOptions {
  only: Set<string>;
  values: number[];
  heightBase: number;
  runId: string;
  stateFile: string | null;
  followup: boolean;
}

export interface ProbeReport {
  startedAt: string;
  origin: string;
  baseUrlFrom: string;
  balanceBefore?: unknown;
  balanceAfter?: unknown;
  balanceUnchanged?: boolean | null;
  'M-PRD-1'?: unknown;
  'M-PRD-2'?: unknown;
  'M-PRD-3'?: unknown;
  'M-PRD-4'?: unknown;
  'M-PRD-5'?: unknown;
  'M-PRD-6'?: unknown;
  requests?: number;
  aborted?: string;
}

async function getToken(t: ProbeTransport, clientId: string, clientSecret: string): Promise<{ status: number; token: string | null; meta: unknown }> {
  const r = await t.request('POST', '/api/v1/oauth/token', {
    form: { grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret },
  });
  const token = r.json && typeof r.json.access_token === 'string' ? (r.json.access_token as string) : null;
  return {
    status: r.status,
    token,
    meta: r.json ? { expires_in: r.json.expires_in, scope: r.json.scope, token_type: r.json.token_type, created_at: typeof r.json.created_at } : null,
  };
}

/** Corre las mediciones pedidas. Toda petición pasa por `ctx.t.request` (capa 1). */
export async function runProbe(
  cfg: Extract<PreflightResult, { ok: true }>,
  t: ProbeTransport,
  redactor: Redactor,
  opts: ProbeOptions,
  print: (line: string) => void,
): Promise<ProbeReport> {
  const log = (line: string): void => print(redactor.scrub(line));
  redactor.add(cfg.clientId);
  redactor.add(cfg.clientSecret);
  const report: ProbeReport = { startedAt: new Date(t.now()).toISOString(), origin: cfg.origin, baseUrlFrom: cfg.baseUrlFrom };
  const want = (k: string): boolean => opts.only.size === 0 || opts.only.has(k);

  const tok = await getToken(t, cfg.clientId, cfg.clientSecret);
  log(`token: HTTP ${tok.status} ${JSON.stringify(tok.meta)}`);
  if (!tok.token) {
    report.aborted = `token HTTP ${tok.status}`;
    return report;
  }
  redactor.add(tok.token);
  const ctx: ProbeContext = { t, token: tok.token, log };

  report.balanceBefore = await balance(ctx);
  log(`saldo antes: ${JSON.stringify(report.balanceBefore)}`);

  // ── Seguimiento de la reutilización (M-PRD-2, a +1 h / +25 h): solo re-envía el cuerpo guardado. ──
  if (opts.followup) {
    if (!opts.stateFile) throw new Error('--followup exige --state <fichero>');
    const st = JSON.parse(readFileSync(opts.stateFile, 'utf8')) as { savedAt: string; spec: QuoteSpec; idFp: string };
    const q = await quote(ctx, st.spec);
    const hours = Math.round(((t.now() - Date.parse(st.savedAt)) / 3_600_000) * 10) / 10;
    report['M-PRD-2'] = { followup: true, hoursSinceFirst: hours, sameQuotation: q.idFp === st.idFp, status: q.status, echo: q.echo };
    log(`M-PRD-2 seguimiento: +${hours} h ⇒ ${q.idFp === st.idFp ? 'MISMA cotización (sigue reutilizando)' : 'cotización NUEVA'}`);
  } else {
    let rateIdForOffice: string | null = null;

    if (want('M-PRD-1')) {
      const seen = new Set<string>();
      const rows: unknown[] = [];
      for (let i = 0; i < opts.values.length; i += 1) {
        const v = opts.values[i];
        let height = opts.heightBase + i;
        let q = await quote(ctx, { height, declaredValue: v });
        const echoOk = (o: QuoteOutcome): boolean => !!o.echo && o.echo.protected === true && o.echo.declared === v;
        let retried = false;
        if (!echoOk(q) || seen.has(q.idFp)) {
          height += 37; // reutilizada o eco que no coincide ⇒ un alto que nadie ha pedido
          q = await quote(ctx, { height, declaredValue: v });
          retried = true;
        }
        seen.add(q.idFp);
        rateIdForOffice = rateIdForOffice ?? q.firstRateId;
        const row = {
          declared: v,
          height,
          retried,
          status: q.status,
          quotation: q.idFp,
          completed: q.completed,
          echoProtected: q.echo?.protected,
          echoDeclared: q.echo?.declared,
          protectionValue: q.echo?.protectionValue,
          protectionTotals: q.protectionTotals,
          echoMatches: echoOk(q),
          ratio: q.echo?.protectionValue != null ? Math.round((q.echo.protectionValue / v) * 100000) / 100000 : null,
          error: q.errorShape,
        };
        rows.push(row);
        log(`M-PRD-1 ${JSON.stringify(row)}`);
      }
      report['M-PRD-1'] = rows;
    }

    if (want('M-PRD-2')) {
      const base: QuoteSpec = { height: opts.heightBase + 60, declaredValue: 2500 };
      const a = await quote(ctx, base);
      const b = await quote(ctx, base);
      const c = await quote(ctx, { ...base, orderId: `tcgprobe-${opts.runId}-1` });
      const d = await quote(ctx, { ...base, orderId: `tcgprobe-${opts.runId}-2` });
      report['M-PRD-2'] = {
        statuses: [a.status, b.status, c.status, d.status],
        controlReused: a.idFp === b.idFp,
        orderIdBreaksReuse: c.idFp !== a.idFp,
        twoOrderIdsDiffer: c.idFp !== d.idFp,
        quotations: [a.idFp, b.idFp, c.idFp, d.idFp],
        orderIdError: c.errorShape ?? d.errorShape,
      };
      log(`M-PRD-2 ${JSON.stringify(report['M-PRD-2'])}`);
      if (opts.stateFile) {
        writeFileSync(opts.stateFile, JSON.stringify({ savedAt: new Date(t.now()).toISOString(), spec: base, idFp: a.idFp }, null, 2));
        log(`M-PRD-2: estado guardado para el seguimiento a +1 h y +25 h (--followup --state …)`);
      }
    }

    if (want('M-PRD-3')) {
      const r = await t.request('GET', '/api/v1/address_templates', { query: { page: '1', per_page: '20' }, token: ctx.token });
      const list: any[] = r.json && Array.isArray(r.json.data) ? r.json.data : [];
      const flat = list.map((x) => (x && x.attributes ? { id: x.id, ...x.attributes } : x));
      for (const x of flat) if (x && x.id != null) redactor.add(String(x.id));
      const from = flat.find((x) => x && x.address_type === 'from');
      const templates = flat.map((x) => ({ id: fp(x?.id), addressType: x?.address_type, isDefault: x?.default ?? x?.is_default }));
      const variants: unknown[] = [];
      if (from && from.id != null) {
        for (const [k, mode] of [[0, 'top_level'], [1, 'address_from']] as const) {
          const q = await quote(ctx, { height: opts.heightBase + 70 + k, declaredValue: 2500, fromTemplateId: String(from.id), templateMode: mode });
          variants.push({
            mode,
            status: q.status,
            requiresOriginVerification: q.requiresOriginVerification,
            ratesRequiringVerification: q.ratesRequiringVerification,
            templateEchoMatches: q.templateEchoMatches,
            successfulRates: q.successfulRates,
            error: q.errorShape,
          });
        }
      }
      report['M-PRD-3'] = { templatesStatus: r.status, templates, variants };
      log(`M-PRD-3 ${JSON.stringify(report['M-PRD-3'])}`);
    }

    if (want('M-PRD-4')) {
      const out: unknown[] = [];
      for (const p of ['/api/v1/finance/extra-charges', '/api/v1/finance/extra_charges']) {
        const r = await t.request('GET', p, { token: ctx.token });
        out.push({ path: p, status: r.status, shape: shapeOf(r.json, 4) });
        if (r.status === 200) break;
      }
      report['M-PRD-4'] = out;
      log(`M-PRD-4 ${JSON.stringify(out)}`);
    }

    if (want('M-PRD-5')) {
      if (!rateIdForOffice) {
        const q = await quote(ctx, { height: opts.heightBase + 80, declaredValue: 2500 });
        rateIdForOffice = q.firstRateId;
      }
      if (rateIdForOffice) {
        redactor.add(rateIdForOffice);
        const r = await t.request('GET', '/api/v1/office_points', { query: { rate_id: rateIdForOffice, direction: 'delivery' }, token: ctx.token });
        report['M-PRD-5'] = { rate: fp(rateIdForOffice), status: r.status, shape: shapeOf(r.json, 4) };
      } else {
        report['M-PRD-5'] = { skipped: 'sin tarifa exitosa para consultar' };
      }
      log(`M-PRD-5 ${JSON.stringify(report['M-PRD-5'])}`);
    }

    if (want('M-PRD-6')) {
      const ref = `tcgprobe-${opts.runId}`;
      const params: Array<Record<string, string>> = [
        {},
        { reference: ref },
        { q: ref },
        { search: ref },
        { 'filter[reference]': ref },
        { external_reference: ref },
      ];
      const out: unknown[] = [];
      for (const extra of params) {
        const r = await t.request('GET', '/api/v1/shipments', { query: { page: '1', per_page: '5', ...extra }, token: ctx.token });
        const meta = r.json && r.json.meta ? r.json.meta : null;
        out.push({ params: Object.keys(extra), status: r.status, totalCount: meta ? meta.total_count : undefined, metaKeys: meta ? Object.keys(meta).sort() : null });
      }
      report['M-PRD-6'] = out;
      log(`M-PRD-6 ${JSON.stringify(out)}`);
    }
  }

  report.balanceAfter = await balance(ctx);
  const before = (report.balanceBefore as { balance: number | null }).balance;
  const after = (report.balanceAfter as { balance: number | null }).balance;
  report.balanceUnchanged = before !== null && after !== null ? before === after : null;
  log(`saldo después: ${JSON.stringify(report.balanceAfter)} ⇒ ${report.balanceUnchanged ? 'SIN CAMBIO' : '⚠️ CAMBIÓ o no se pudo leer — investigar antes de nada'}`);
  report.requests = t.requests;
  return report;
}

// ══ CLI ════════════════════════════════════════════════════════════════════════════════════════════════════

export function parseArgs(argv: string[]): ProbeOptions & { out: string | null; dryRun: boolean } {
  const opts = {
    only: new Set<string>(),
    values: [...M_PRD_1_VALUES],
    heightBase: 20,
    runId: Date.now().toString(36),
    stateFile: null as string | null,
    followup: false,
    out: null as string | null,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = (): string => {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`${a} exige un valor`);
      i += 1;
      return v;
    };
    if (a === '--only') for (const k of next().split(',')) opts.only.add(k.trim().toUpperCase());
    else if (a === '--values') opts.values = next().split(',').map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0);
    else if (a === '--height-base') opts.heightBase = Number(next());
    else if (a === '--state') opts.stateFile = next();
    else if (a === '--followup') opts.followup = true;
    else if (a === '--out') opts.out = next();
    else if (a === '--dry-run') opts.dryRun = true;
    else throw new Error(`argumento desconocido: ${a}`);
  }
  if (!Number.isInteger(opts.heightBase) || opts.heightBase < 1 || opts.heightBase > 150) throw new Error('--height-base: entero 1..150');
  return opts;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const print = (l: string): void => {
    process.stdout.write(`${l}\n`);
  };
  let cfg: PreflightResult;
  let fetchImpl: ProbeFetch;
  if (args.dryRun) {
    // Ensayo sin red: el mismo programa contra el doble de la prueba. Sirve para ver el plan de peticiones.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createStubSkydropx } = require('./probe-stub') as typeof import('./probe-stub');
    const stub = createStubSkydropx();
    cfg = { ok: true, origin: stub.origin, clientId: stub.clientId, clientSecret: stub.clientSecret, minIntervalMs: 0, baseUrlFrom: 'referencia' };
    fetchImpl = stub.fetch;
    const t = new ProbeTransport({ origin: cfg.origin, fetchImpl, minIntervalMs: 0, sleep: async () => undefined });
    const report = await runProbe(cfg, t, new Redactor(), args, print);
    for (const c of stub.calls) print(`[ensayo] ${c.method} ${new URL(c.url).pathname}`);
    print(`[ensayo] ${stub.calls.length} peticiones; ${report.requests} por el transporte`);
    return 0;
  }
  cfg = preflight(process.env);
  if (!cfg.ok) {
    process.stderr.write(`prod-probe: NO arranca — ${cfg.reason}\n`);
    return 2;
  }
  fetchImpl = (url, init) => fetch(url, init as RequestInit) as unknown as Promise<ProbeFetchResponse>;
  const t = new ProbeTransport({ origin: cfg.origin, fetchImpl, minIntervalMs: cfg.minIntervalMs });
  const redactor = new Redactor();
  print(`prod-probe · origen ${cfg.origin} (${cfg.baseUrlFrom}) · ritmo ≥ ${cfg.minIntervalMs} ms · solo lectura`);
  const report = await runProbe(cfg, t, redactor, args, print);
  const json = redactor.scrub(JSON.stringify(report, null, 2));
  if (args.out) writeFileSync(args.out, `${json}\n`);
  print(json);
  return report.aborted ? 1 : report.balanceUnchanged === false ? 3 : 0;
}

if (require.main === module) {
  main().then(
    (code) => process.exit(code),
    (err: unknown) => {
      const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      process.stderr.write(`prod-probe: abortado — ${new Redactor().scrub(msg)}\n`);
      process.exit(err instanceof ProbeForbiddenRequestError ? 4 : 1);
    },
  );
}
