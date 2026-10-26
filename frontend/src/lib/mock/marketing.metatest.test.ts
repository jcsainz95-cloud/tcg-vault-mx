/**
 * Servidor falso de `POST /admin/measurement/meta-test-event` (contrato §MKT.H.12, v1.112): las cinco salidas
 * (accepted, rejected con y sin mensaje, unreachable, 409, 429) + 422, solo súper-admin, límite de 5 por 60 min móviles
 * en el que 409/422/429 no cuentan. Las claves del resultado son exactamente las de `MetaTestEventResult`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ApiFixtureError } from './fixtures';
import { MOCK_META_TEST_CODES as C, MOCK_META_VERSION, mockMetaTestEvent, resetMarketingMock } from './marketing';

const T0 = Date.parse('2026-10-26T18:00:00Z');
const MIN = 60_000;

function fails(fn: () => unknown): ApiFixtureError {
  try {
    fn();
  } catch (e) {
    if (e instanceof ApiFixtureError) return e;
    throw e;
  }
  throw new Error('no lanzó');
}

beforeEach(() => {
  window.localStorage.clear();
  resetMarketingMock();
});
afterEach(() => resetMarketingMock());

describe('mockMetaTestEvent · salidas', () => {
  it('accepted: 200, eventsReceived 1, eventId `test-<uuid v4>`, versión de §MKT.H.1, claves exactas del contrato', () => {
    const r = mockMetaTestEvent(' TEST12345 ', T0);
    expect(r.status).toBe('accepted');
    expect(r.httpStatus).toBe(200);
    expect(r.eventsReceived).toBe(1);
    expect(r.testEventCode).toBe('TEST12345');
    expect(r.eventName).toBe('PageView');
    expect(r.eventId).toMatch(/^test-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(r.sentAt).toBe(new Date(T0).toISOString());
    expect(Object.keys(r).sort()).toEqual(
      [
        'status', 'httpStatus', 'metaVersion', 'pixelId', 'testEventCode', 'eventName', 'eventId', 'sentAt',
        'eventsReceived', 'fbtraceId', 'metaMessages', 'metaError',
      ].sort(),
    );
  });

  it('la versión del mock es la de la tabla `META-GRAPH-VERSION` del contrato', () => {
    const contract = readFileSync(resolve(__dirname, '../../../../docs/API_CONTRACT.md'), 'utf8');
    const block = contract.split('<!-- META-GRAPH-VERSION:start -->')[1]?.split('<!-- META-GRAPH-VERSION:end -->')[0] ?? '';
    const version = /\|\s*`(v\d+\.\d+)`\s*\|/.exec(block)?.[1];
    expect(version).toBeDefined();
    expect(MOCK_META_VERSION).toBe(version);
    expect(mockMetaTestEvent('TEST123', T0).metaVersion).toBe(version);
  });

  it('rejected con mensaje y sin mensaje', () => {
    const a = mockMetaTestEvent(C.rejected, T0);
    expect(a.status).toBe('rejected');
    expect(a.metaError?.message).toEqual(expect.any(String));
    const b = mockMetaTestEvent(C.rejectedNoMessage, T0);
    expect(b.status).toBe('rejected');
    expect(b.metaError).not.toBeNull();
    expect(b.metaError?.message).toBeNull();
  });

  it('unreachable: httpStatus, eventsReceived y fbtraceId nulos', () => {
    const r = mockMetaTestEvent(C.unreachable, T0);
    expect(r).toMatchObject({ status: 'unreachable', httpStatus: null, eventsReceived: null, fbtraceId: null, metaError: null });
  });

  it('409 MEASUREMENT_META_NOT_CONFIGURED con `details.reason`, sin valores', () => {
    const e = fails(() => mockMetaTestEvent(C.notConfigured, T0));
    expect(e.status).toBe(409);
    expect(e.code).toBe('MEASUREMENT_META_NOT_CONFIGURED');
    expect(e.details).toEqual({ reason: 'missing_config' });
  });

  it.each([[''], ['TEST12'], ['TEST12345678901'], ['test123'], ['TEST 123'], [42], [undefined]])(
    '422 VALIDATION_ERROR para %j, con `details.field` y ⛔ sin el valor',
    (bad) => {
      const e = fails(() => mockMetaTestEvent(bad, T0));
      expect(e.status).toBe(422);
      expect(e.code).toBe('VALIDATION_ERROR');
      expect(e.details).toEqual({ field: 'testEventCode' });
      if (typeof bad === 'string' && bad) expect(JSON.stringify(e.details) + e.message).not.toContain(bad);
    },
  );

  it('429 forzado por código, con retryAfterSeconds', () => {
    const e = fails(() => mockMetaTestEvent(C.rateLimited, T0));
    expect(e.status).toBe(429);
    expect(e.code).toBe('RATE_LIMITED');
    expect(e.details?.retryAfterSeconds).toEqual(expect.any(Number));
  });

  it('403 para otro rol', () => {
    window.localStorage.setItem('tcg.role', 'vault_operator');
    expect(fails(() => mockMetaTestEvent('TEST123', T0)).status).toBe(403);
  });
});

describe('mockMetaTestEvent · límite de 5 por 60 min móviles', () => {
  it('el 6.º en la hora ⇒ 429 con la espera hasta que caduque el más viejo; 409 y 422 no cuentan', () => {
    fails(() => mockMetaTestEvent(C.notConfigured, T0));
    fails(() => mockMetaTestEvent('mal', T0));
    for (let i = 0; i < 5; i++) mockMetaTestEvent(i === 2 ? C.unreachable : 'TEST123', T0 + i * MIN);
    const e = fails(() => mockMetaTestEvent('TEST123', T0 + 10 * MIN));
    expect(e.status).toBe(429);
    expect(e.details?.retryAfterSeconds).toBe(50 * 60);
    // pasado el más viejo, se libera un hueco
    expect(mockMetaTestEvent('TEST123', T0 + 60 * MIN).status).toBe('accepted');
  });
});
