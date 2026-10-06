/**
 * LIVE-7 (API_CONTRACT §14.7) — `POST /api/v1/telemetry/client-error`, lado cliente.
 * Req `{ message ≤ 300, digest? ≤ 64, path ≤ 200, release? ≤ 40 }`, público, sin cookies ni auth.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '@/lib/config';
import { buildClientErrorReport, reportClientError } from './report-client-error';

const realMocks = config.useMocks;
let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  config.useMocks = false;
  fetchSpy = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => {
  config.useMocks = realMocks;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('buildClientErrorReport — forma del contrato', () => {
  it('message, digest, path y release con sus topes', () => {
    const r = buildClientErrorReport(
      Object.assign(new Error('x'.repeat(400)), { digest: 'd'.repeat(80) }),
      '/es/' + 'a'.repeat(300),
      'f'.repeat(50),
    );
    expect(r.message).toHaveLength(300);
    expect(r.digest).toHaveLength(64);
    expect(r.path.length).toBeLessThanOrEqual(200);
    expect(r.release).toHaveLength(40);
  });

  it('⛔ la ruta sale SIN query ni fragmento (reset-password?token=… lleva un secreto)', () => {
    const r = buildClientErrorReport(new Error('boom'), '/es/reset-password?token=SECRETO#x');
    expect(r.path).toBe('/es/reset-password');
    expect(JSON.stringify(r)).not.toContain('SECRETO');
  });

  it('⛔ una URL dentro del mensaje pierde su query', () => {
    const r = buildClientErrorReport(
      new Error('Failed to load https://api.tcghunt.mx/api/v1/auth/verify-email?token=SECRETO ok'),
      '/es',
    );
    expect(r.message).toBe('Failed to load https://api.tcghunt.mx/api/v1/auth/verify-email ok');
  });

  it('sin digest ni release ⇒ los campos opcionales no viajan', () => {
    const r = buildClientErrorReport(new Error('boom'), '/es');
    expect(r).toEqual({ message: 'boom', path: '/es' });
  });

  it('un error sin mensaje manda un texto no vacío', () => {
    const r = buildClientErrorReport(new Error(''), '/es');
    expect(r.message.length).toBeGreaterThan(0);
  });
});

describe('reportClientError — la llamada', () => {
  it('POST JSON a {apiBaseUrl}/telemetry/client-error, sin cookies, sin Authorization, keepalive', async () => {
    window.localStorage.setItem('tcg.accessToken', 'TOKEN');
    await reportClientError(new Error('boom'), '/es/catalog?q=1');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${config.apiBaseUrl}/telemetry/client-error`);
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('omit');
    expect(init.keepalive).toBe(true);
    const h = new Headers(init.headers);
    expect(h.get('content-type')).toBe('application/json');
    expect(h.get('authorization')).toBeNull();
    expect(JSON.parse(String(init.body))).toEqual({ message: 'boom', path: '/es/catalog' });
    window.localStorage.removeItem('tcg.accessToken');
  });

  it('release = NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA si Vercel lo expone', async () => {
    vi.stubEnv('NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA', 'abc123');
    await reportClientError(new Error('boom'), '/es');
    expect(JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body)).release).toBe('abc123');
  });

  it('modo mocks ⇒ no llama a nadie (no hay backend)', async () => {
    config.useMocks = true;
    await reportClientError(new Error('boom'), '/es');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('si el envío falla, no lanza (la pantalla de error no puede romperse por su telemetría)', async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError('network'));
    await expect(reportClientError(new Error('boom'), '/es')).resolves.toBeUndefined();
  });
});
