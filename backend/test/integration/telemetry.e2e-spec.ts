/**
 * LIVE-7 (API_CONTRACT §14.7, v1.84) — salud y telemetría contra la app REAL (parsers de `src/body-parsers.ts`,
 * guards, ValidationPipe, filtro) y Postgres real. Más SES-6 (LIVE-2) por HTTP.
 *
 *  - HLT-1 (HTTP): `GET /health` trae `stripeMode` y ningún fragmento de la clave.
 *  - TLM-1: informe CSP con `documentURI …/reset-password?token=abc` ⇒ `204` y el log no contiene `abc`.
 *  - TLM-2: cuerpo de 20 KB ⇒ `413`, sin log.                     (mutación: quitar el límite)
 *  - TLM-3: 61.º informe en un minuto desde la misma IP ⇒ `429`.  (mutación: quitar el `@Throttle`)
 *  - TLM-4: `client-error` con `message` de 301 ⇒ `400 VALIDATION_ERROR`.
 *  - TLM-5: ninguna tabla cambia de tamaño tras 100 informes (conteo exacto antes/después).
 */
import { Logger } from '@nestjs/common';
import { E2EHarness } from './helpers/e2e-app';
import { E2E_USERS } from '../../prisma/e2e-fixtures';

const SECRET = 'abcLIVE7tokenXYZ';

const cspReport = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    'csp-report': {
      'document-uri': `https://tcghunt.mx/es/reset-password?token=${SECRET}`,
      'blocked-uri': 'https://evil.example.com/a.js?q=1',
      'effective-directive': 'script-src-elem',
      disposition: 'report',
      'script-sample': 'alert(1)',
      ...extra,
    },
  });

function spyLogs() {
  const warn = jest.spyOn(Logger.prototype, 'warn');
  const error = jest.spyOn(Logger.prototype, 'error');
  const lines = (prefix: string) =>
    [...warn.mock.calls, ...error.mock.calls].map((c) => String(c[0])).filter((l) => l.startsWith(prefix));
  return { warn, error, lines };
}

async function tableCounts(h: E2EHarness): Promise<Record<string, number>> {
  const tables = await h.prisma.$queryRawUnsafe<{ t: string }[]>(
    `SELECT table_name AS t FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1`,
  );
  const out: Record<string, number> = {};
  for (const { t } of tables) {
    const [{ n }] = await h.prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*)::bigint AS n FROM "${t.replace(/"/g, '""')}"`);
    out[t] = Number(n);
  }
  return out;
}

describe('LIVE-7 — salud y telemetría (sin throttler: comportamiento)', () => {
  let h: E2EHarness;
  beforeAll(async () => {
    h = await E2EHarness.create();
  });
  afterAll(async () => {
    await h?.close();
  });
  afterEach(() => jest.restoreAllMocks());

  it('HLT-1: GET /health trae stripeMode ∈ {live,test,none} y ningún sk_/rk_', async () => {
    const r = await h.api('GET', '/health');
    expect([200, 503]).toContain(r.status);
    expect(['live', 'test', 'none']).toContain(r.body.stripeMode);
    expect(r.text).not.toMatch(/[sr]k_(live|test)/);
  });

  it('TLM-1: application/csp-report ⇒ 204 y el log no lleva la query (token), ni sample, ni ruta del bloqueado', async () => {
    const logs = spyLogs();
    const r = await h.api('POST', '/telemetry/csp', {
      rawBody: cspReport(),
      headers: { 'content-type': 'application/csp-report', 'user-agent': 'UA-LEAK-E2E' },
    });
    expect(r.status).toBe(204);
    const lines = logs.lines('CSP_VIOLATION');
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain(SECRET);
    expect(lines[0]).not.toContain('alert(1)');
    expect(lines[0]).not.toContain('a.js');
    expect(lines[0]).not.toContain('UA-LEAK-E2E');
    expect(lines[0]).not.toContain('127.0.0.1');
    expect(lines[0]).toContain('/es/reset-password');
    expect(lines[0]).toContain('https://evil.example.com');
  });

  it('TLM-1 (reports+json): la lista también se entiende; 204', async () => {
    const logs = spyLogs();
    const body = JSON.stringify([
      {
        type: 'csp-violation',
        url: `https://tcghunt.mx/es/verify-email?token=${SECRET}`,
        body: { documentURL: `https://tcghunt.mx/es/verify-email?token=${SECRET}`, blockedURL: 'eval', effectiveDirective: 'script-src', disposition: 'enforce' },
      },
    ]);
    const r = await h.api('POST', '/telemetry/csp', { rawBody: body, headers: { 'content-type': 'application/reports+json' } });
    expect(r.status).toBe(204);
    const lines = logs.lines('CSP_VIOLATION');
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain(SECRET);
    expect(lines[0]).toContain('/es/verify-email');
  });

  it('cuerpo ininteligible ⇒ 204 (nunca 400), sin log', async () => {
    const logs = spyLogs();
    for (const [rawBody, ct] of [
      ['{roto', 'application/csp-report'],
      ['no es json', 'application/reports+json'],
      ['{roto', 'application/json'],
      ['', 'application/csp-report'],
    ]) {
      const r = await h.api('POST', '/telemetry/csp', { rawBody, headers: { 'content-type': ct } });
      expect(r.status).toBe(204);
    }
    expect(logs.lines('CSP_VIOLATION')).toHaveLength(0);
  });

  it('TLM-2: cuerpo de 20 KB ⇒ 413, sin log; 16 KB justos ⇒ 204', async () => {
    const logs = spyLogs();
    const big = cspReport({ pad: 'x'.repeat(20 * 1024) });
    const r = await h.api('POST', '/telemetry/csp', { rawBody: big, headers: { 'content-type': 'application/csp-report' } });
    expect(r.status).toBe(413);
    expect(logs.lines('CSP_VIOLATION')).toHaveLength(0);
    const base = cspReport({ pad: '' });
    const exact = cspReport({ pad: 'x'.repeat(16 * 1024 - Buffer.byteLength(base)) });
    expect(Buffer.byteLength(exact)).toBe(16 * 1024);
    const ok = await h.api('POST', '/telemetry/csp', { rawBody: exact, headers: { 'content-type': 'application/csp-report' } });
    expect(ok.status).toBe(204);
  });

  it('TLM-4: client-error con message de 301 ⇒ 400 VALIDATION_ERROR, sin log; 300 ⇒ 204 y una línea CLIENT_ERROR', async () => {
    const logs = spyLogs();
    const bad = await h.api('POST', '/telemetry/client-error', { json: { message: 'x'.repeat(301), path: '/es' } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
    expect(logs.lines('CLIENT_ERROR')).toHaveLength(0);
    const ok = await h.api('POST', '/telemetry/client-error', {
      json: { message: 'y'.repeat(300), path: `/es/reset-password?token=${SECRET}`, digest: 'd1', release: 'sha1' },
    });
    expect(ok.status).toBe(204);
    const lines = logs.lines('CLIENT_ERROR');
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain(SECRET);
    expect(lines[0]).toContain('/es/reset-password');
  });

  it('TLM-5: 100 informes (50 CSP + 50 client-error) no cambian el tamaño de NINGUNA tabla', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const before = await tableCounts(h);
    expect(Object.keys(before).length).toBeGreaterThan(10);
    for (let i = 0; i < 50; i++) {
      const a = await h.api('POST', '/telemetry/csp', { rawBody: cspReport(), headers: { 'content-type': 'application/csp-report' } });
      const b = await h.api('POST', '/telemetry/client-error', { json: { message: `e${i}`, path: '/es/x' } });
      expect([a.status, b.status]).toEqual([204, 204]);
    }
    expect(await tableCounts(h)).toEqual(before);
  });

  it('SES-6 (LIVE-2) por HTTP: login y refresh no devuelven sat ni sid; refresh lleva sat en el token', async () => {
    const login = await h.api('POST', '/auth/login', { json: { email: E2E_USERS.customer.email, password: E2E_USERS.customer.password } });
    expect(login.status).toBe(200);
    expect(login.text).not.toMatch(/"(sat|sid)"/);
    const refresh = await h.api('POST', '/auth/refresh', { json: { refreshToken: login.body.refreshToken } });
    expect(refresh.status).toBe(200);
    expect(Object.keys(refresh.body).sort()).toEqual(['accessToken', 'deviceToken', 'refreshToken']);
    expect(refresh.text).not.toMatch(/"(sat|sid)"/);
    const claims = JSON.parse(Buffer.from(String(refresh.body.refreshToken).split('.')[1], 'base64url').toString());
    const loginClaims = JSON.parse(Buffer.from(String(login.body.refreshToken).split('.')[1], 'base64url').toString());
    expect(typeof claims.sat).toBe('number');
    expect(claims.sat).toBe(loginClaims.sat);
    expect(claims.exp).toBeLessThanOrEqual(claims.sat + 30 * 24 * 3600);
  });
});

describe('LIVE-7 · TLM-3 — tope por IP (throttler real re-activado)', () => {
  let h: E2EHarness;
  let prev: string | undefined;
  beforeAll(async () => {
    prev = process.env.E2E_ENABLE_THROTTLER;
    process.env.E2E_ENABLE_THROTTLER = 'true';
    h = await E2EHarness.create();
  });
  afterAll(async () => {
    await h?.close();
    if (prev === undefined) delete process.env.E2E_ENABLE_THROTTLER;
    else process.env.E2E_ENABLE_THROTTLER = prev;
  });
  afterEach(() => jest.restoreAllMocks());

  it('csp: 60 informes ⇒ 204; el 61.º en el mismo minuto ⇒ 429 RATE_LIMITED', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const statuses: number[] = [];
    for (let i = 0; i < 61; i++) {
      const r = await h.api('POST', '/telemetry/csp', { rawBody: cspReport(), headers: { 'content-type': 'application/csp-report' } });
      statuses.push(r.status);
      if (i === 60) expect(r.body?.error?.code).toBe('RATE_LIMITED');
    }
    expect(statuses.slice(0, 60).every((s) => s === 204)).toBe(true);
    expect(statuses[60]).toBe(429);
  });

  it('client-error: 30 ⇒ 204; el 31.º ⇒ 429', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) {
      const r = await h.api('POST', '/telemetry/client-error', { json: { message: 'm', path: '/es' } });
      statuses.push(r.status);
    }
    expect(statuses.slice(0, 30).every((s) => s === 204)).toBe(true);
    expect(statuses[30]).toBe(429);
  });
});
