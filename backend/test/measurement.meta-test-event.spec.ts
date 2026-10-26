/**
 * 🔒 Evento de prueba de Meta (API_CONTRACT §MKT.H.12; ARCHITECTURE §14.10 D-MKT2-10). Unitarias, sin red y sin BD.
 *
 *  C-B12  `buildMetaTestEventBody`: claves de cada nivel = las del contrato; `user_data` = solo un `fbp` sintético; URL con
 *         la versión de §MKT.H.1. CANARIO: `external_id` con hash ⇒ rojo.
 *  C-B13  Un doble de Meta (un `fetch` falso detrás de la implementación REAL de `postMetaDiagnostic`) que devuelve el token en
 *         `error.message`, en `messages` (como `access_token=…`) y en claves fuera de la lista ⇒ el token no está en la
 *         respuesta, ni en la fila de bitácora, ni en ningún log. CANARIO: sin redacción ⇒ rojo.
 *  C-B14  (mitad unitaria) `off` + bloqueo abierto ⇒ envía; sin token ⇒ 409 y 0 llamadas; 5 en la ventana ⇒ 429 con
 *         `retryAfterSeconds`; el candado consultivo se toma ANTES del conteo. La carrera real (N=10) va contra Postgres en
 *         `test/integration/measurement-meta-test.e2e-spec.ts`.
 *  Rol    `@Roles(super_admin)` de clase y nada más (otro rol ⇒ 403 en la integración).
 * Determinista: N=1.
 */
import { createHash } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { Role } from '@prisma/client';
import { ROLES_KEY } from '../src/common/decorators/roles.decorator';
import { AdminMeasurementController } from '../src/modules/measurement/admin-measurement.controller';
import { BACKEND_ENCENDER_BLOCKERS, META_GRAPH_API_VERSION, metaEventsUrl } from '../src/modules/measurement/measurement.config';
import {
  makeFetchMeasurementHttp,
  META_TEXT_MAX,
  redactMetaText,
  sanitizeMetaDiagnostic,
  type MeasurementHttp,
  type MetaDiagnostic,
} from '../src/modules/measurement/measurement-http';
import {
  buildMetaTestEventBody,
  metaTestEventStatus,
  newMetaTestEventIds,
  parseTestEventCode,
} from '../src/modules/measurement/meta-test-event';
import {
  META_TEST_EVENT_ACTION,
  META_TEST_EVENT_LIMIT,
  META_TEST_EVENT_WINDOW_MS,
  MetaTestEventService,
} from '../src/modules/measurement/meta-test-event.service';
import { BusinessException } from '../src/common/business.exception';
import { CAPI_TOKEN, PIXEL, SECRET_ENV_NAMES, fakeConfig, fullEnv } from './helpers/measurement-fixtures';

const NOW = new Date('2026-10-26T18:00:00.000Z');
const IDS = { uuid: '3f2b9c1e-8d4a-4b6f-9e2a-1c5d7f8a9b0c', fbpRandom: '4821930576' };

// ───────────────────────────── C-B12 ─────────────────────────────

const sorted = (o: unknown): string[] => Object.keys(o as Record<string, unknown>).sort();

/** Problemas del cuerpo (vacío = verde). Pura: el canario le pasa un cuerpo alterado. */
function bodyProblems(body: Record<string, unknown>): string[] {
  const out: string[] = [];
  const eq = (what: string, got: string[], want: string[]) => {
    if (JSON.stringify(got) !== JSON.stringify(want)) out.push(`${what}: ${got.join(',')} ≠ ${want.join(',')}`);
  };
  eq('raíz', sorted(body), ['access_token', 'data', 'test_event_code']);
  const data = body.data as Record<string, unknown>[];
  if (!Array.isArray(data) || data.length !== 1) return [...out, 'data no es un único evento'];
  const ev = data[0];
  eq('evento', sorted(ev), ['action_source', 'event_id', 'event_name', 'event_source_url', 'event_time', 'user_data']);
  eq('user_data', sorted(ev.user_data), ['fbp']);
  if (ev.event_name !== 'PageView') out.push('event_name');
  if (ev.action_source !== 'website') out.push('action_source');
  if (!/^test-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(String(ev.event_id))) out.push('event_id');
  if (!/^fb\.1\.\d{13}\.\d{10}$/.test(String((ev.user_data as Record<string, unknown>).fbp))) out.push('fbp');
  if (!Number.isInteger(ev.event_time)) out.push('event_time');
  return out;
}

describe('C-B12 · buildMetaTestEventBody (lista cerrada) y URL', () => {
  const body = buildMetaTestEventBody({ testEventCode: 'TEST12345', token: CAPI_TOKEN, origin: 'https://tcghunt.mx,https://www.tcghunt.mx'.split(',')[0], now: NOW, ids: IDS });

  it('claves de cada nivel = las de §MKT.H.12; valores con su forma', () => {
    expect(bodyProblems(body)).toEqual([]);
    const ev = (body.data as Record<string, unknown>[])[0];
    expect(ev).toEqual({
      event_name: 'PageView',
      event_time: Math.floor(NOW.getTime() / 1000),
      event_id: `test-${IDS.uuid}`,
      action_source: 'website',
      event_source_url: 'https://tcghunt.mx/',
      user_data: { fbp: `fb.1.${NOW.getTime()}.${IDS.fbpRandom}` },
    });
    expect(body.test_event_code).toBe('TEST12345');
    expect(body.access_token).toBe(CAPI_TOKEN);
  });

  it('origen con ruta/query ⇒ solo origen + «/»; ids nuevos por envío con la forma de Meta', () => {
    const b = buildMetaTestEventBody({ testEventCode: 'TEST123', token: CAPI_TOKEN, origin: 'https://tcghunt.mx/es?x=1', now: NOW, ids: newMetaTestEventIds() });
    expect((b.data as Record<string, unknown>[])[0].event_source_url).toBe('https://tcghunt.mx/');
    expect(bodyProblems(b)).toEqual([]);
    const a = newMetaTestEventIds();
    const c = newMetaTestEventIds();
    expect(a.uuid).not.toBe(c.uuid);
    expect(a.fbpRandom).toMatch(/^\d{10}$/);
  });

  it('URL = graph.facebook.com/<versión de §MKT.H.1>/<pixel>/events (sin token en la URL)', () => {
    expect(metaEventsUrl(PIXEL)).toBe(`https://graph.facebook.com/${META_GRAPH_API_VERSION}/${PIXEL}/events`);
    expect(metaEventsUrl(PIXEL)).not.toContain('access_token');
  });

  it('CANARIO: `external_id` aleatorio con hash ⇒ rojo; `client_user_agent` ⇒ rojo; `custom_data` ⇒ rojo', () => {
    const withHash = JSON.parse(JSON.stringify(body));
    withHash.data[0].user_data.external_id = createHash('sha256').update('cualquiera').digest('hex');
    expect(bodyProblems(withHash)).toEqual([expect.stringMatching(/^user_data: /)]);
    const withUa = JSON.parse(JSON.stringify(body));
    withUa.data[0].user_data.client_user_agent = 'Mozilla/5.0';
    expect(bodyProblems(withUa)).not.toEqual([]);
    const withCustom = JSON.parse(JSON.stringify(body));
    withCustom.data[0].custom_data = { value: 1 };
    expect(bodyProblems(withCustom)).toEqual([expect.stringMatching(/^evento: /)]);
  });
});

describe('§MKT.H.12 · forma del body y status', () => {
  it('`^TEST[0-9]{3,10}$` recortado; ausente, otro tipo, otra forma o claves de más ⇒ no', () => {
    expect(parseTestEventCode({ testEventCode: '  TEST123  ' })).toEqual({ ok: true, code: 'TEST123' });
    expect(parseTestEventCode({ testEventCode: 'TEST1234567890' })).toEqual({ ok: true, code: 'TEST1234567890' });
    for (const bad of [{}, { testEventCode: 'TEST12' }, { testEventCode: 'TEST12345678901' }, { testEventCode: 'test123' }, { testEventCode: 123 }, { testEventCode: 'TEST123', extra: 1 }, { code: 'TEST123' }]) {
      expect(parseTestEventCode(bad as Record<string, unknown>)).toEqual({ ok: false });
    }
  });
  it('accepted ⇔ 2xx y eventsReceived === 1; unreachable = sin respuesta; resto rejected', () => {
    expect(metaTestEventStatus({ httpStatus: 200, eventsReceived: 1 })).toBe('accepted');
    expect(metaTestEventStatus({ httpStatus: 200, eventsReceived: 0 })).toBe('rejected');
    expect(metaTestEventStatus({ httpStatus: 200, eventsReceived: null })).toBe('rejected');
    expect(metaTestEventStatus({ httpStatus: 400, eventsReceived: 1 })).toBe('rejected');
    expect(metaTestEventStatus({ httpStatus: null, eventsReceived: null })).toBe('unreachable');
  });
});

// ───────────────────────────── C-B13 ─────────────────────────────

/** Respuesta de Meta que cita el token por todos lados. */
function leakyMetaJson(token: string): Record<string, unknown> {
  return {
    error: {
      message: `Invalid OAuth access token - Cannot parse access token: ${token}`,
      type: 'OAuthException',
      code: 190,
      error_subcode: 463,
      error_user_msg: `token ${token}`,
      fbtrace_id: 'AbCdEf123',
    },
    messages: [`POST https://graph.facebook.com/x?access_token=${token}&foo=1`, `${'x'.repeat(META_TEXT_MAX - 10)}${token}`],
    debug: token,
  };
}

const fakeFetch = (status: number, json: unknown) =>
  jest.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } }));

describe('C-B13 · el token no sale (respuesta, bitácora, log)', () => {
  it('sanitizeMetaDiagnostic: solo la lista cerrada; textos redactados y ≤ 300', () => {
    const d = sanitizeMetaDiagnostic(400, leakyMetaJson(CAPI_TOKEN), CAPI_TOKEN);
    expect(Object.keys(d).sort()).toEqual(['error', 'eventsReceived', 'fbtraceId', 'httpStatus', 'messages']);
    expect(Object.keys(d.error!).sort()).toEqual(['code', 'message', 'subcode', 'type']);
    expect(d.error).toMatchObject({ code: 190, subcode: 463, type: 'OAuthException' });
    expect(d.error!.message).toContain('[token]');
    const text = JSON.stringify(d);
    expect(text).not.toContain(CAPI_TOKEN);
    expect(text).not.toContain(CAPI_TOKEN.slice(0, 12));
    for (const m of d.messages) expect(m.length).toBeLessThanOrEqual(META_TEXT_MAX);
    expect(redactMetaText('a access_token=OTRO&b', null)).toBe('a [token]&b');
  });

  it('CANARIO: sin redacción (sin token que redactar) ⇒ el token aparece', () => {
    const d = sanitizeMetaDiagnostic(400, leakyMetaJson(CAPI_TOKEN), null);
    expect(JSON.stringify(d)).toContain(CAPI_TOKEN);
  });

  it('servicio completo sobre la implementación REAL de postMetaDiagnostic con un fetch falso ⇒ 0 apariciones', async () => {
    const f = fakeFetch(400, leakyMetaJson(CAPI_TOKEN));
    const w = world(fullEnv({ MEASUREMENT_MODE: 'off' }), makeFetchMeasurementHttp(f));
    const logs: string[] = [];
    const spies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map((lvl) =>
      jest.spyOn(Logger.prototype, lvl).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(' '))),
    );
    const res = await w.svc.send({ testEventCode: 'TEST123' }, { id: 'u1', role: Role.super_admin }, '10.0.0.1');
    spies.forEach((s) => s.mockRestore());
    // La llamada salió con el token en el CUERPO (no en la URL).
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe(metaEventsUrl(PIXEL));
    expect(JSON.parse(String(init.body)).access_token).toBe(CAPI_TOKEN);
    expect(res.status).toBe('rejected');
    expect(res.metaError).toMatchObject({ code: 190 });
    for (const [where, text] of [['respuesta', JSON.stringify(res)], ['bitácora', JSON.stringify(w.audits)], ['log', logs.join('\n')]] as const) {
      expect([where, text.includes(CAPI_TOKEN)]).toEqual([where, false]);
    }
    expect(logs).toEqual([`MEASUREMENT_META_TEST status=rejected http=400 version=${META_GRAPH_API_VERSION}`]);
  });

  it('red caída ⇒ unreachable, httpStatus null, nunca lanza', async () => {
    const http = makeFetchMeasurementHttp(jest.fn(async () => Promise.reject(new Error(`ECONNRESET ${CAPI_TOKEN}`))));
    const d = await http.postMetaDiagnostic(metaEventsUrl(PIXEL), { access_token: CAPI_TOKEN }, 5000);
    expect(d).toEqual({ httpStatus: null, eventsReceived: null, fbtraceId: null, messages: [], error: null });
  });

  it('cuerpo no JSON ⇒ solo el código', async () => {
    const http = makeFetchMeasurementHttp(jest.fn(async () => new Response(`<html>${CAPI_TOKEN}</html>`, { status: 502 })));
    const d = await http.postMetaDiagnostic(metaEventsUrl(PIXEL), { access_token: CAPI_TOKEN }, 5000);
    expect(d).toEqual({ httpStatus: 502, eventsReceived: null, fbtraceId: null, messages: [], error: null });
  });
});

// ───────────────────────────── C-B14 (unitaria) ─────────────────────────────

type Audit = { action: string; entityType?: string; entityId?: string; after?: unknown; actorUserId?: string | null; ip?: string };

function world(env: Record<string, string | undefined>, http: MeasurementHttp, recent: Date[] = []) {
  const calls: string[] = [];
  const audits: Audit[] = [];
  const tx = {
    $executeRaw: jest.fn(async () => {
      calls.push('lock');
      return 1;
    }),
    auditLog: {
      findMany: jest.fn(async () => {
        calls.push('count');
        return recent.map((createdAt) => ({ createdAt }));
      }),
    },
  };
  const prisma = { $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) };
  const audit = {
    log: jest.fn(async (e: Audit) => {
      calls.push('audit');
      audits.push(e);
    }),
  };
  const svc = new MetaTestEventService(prisma as never, audit as never, http, fakeConfig(env));
  return { svc, prisma, tx, audit, audits, calls };
}

const okHttp = (): jest.Mocked<MeasurementHttp> => ({
  postJson: jest.fn(async (_u: string, _b: unknown, _t: number): Promise<number | null> => 204),
  postMetaDiagnostic: jest.fn(
    async (_u: string, _b: unknown, _t: number): Promise<MetaDiagnostic> => ({ httpStatus: 200, eventsReceived: 1, fbtraceId: 'Atrace1', messages: [], error: null }),
  ),
});

describe('C-B14 · modo, configuración y límite (unitaria)', () => {
  it('`off` y `on` con el bloqueo de encendido abierto ⇒ envía y responde accepted', async () => {
    expect(BACKEND_ENCENDER_BLOCKERS.map((b) => b.id)).toContain('MKT-F2-3');
    for (const mode of ['off', 'on', undefined]) {
      const http = okHttp();
      const w = world(fullEnv({ MEASUREMENT_MODE: mode }), http);
      const res = await w.svc.send({ testEventCode: 'TEST999' }, { id: 'u1', role: Role.super_admin }, '1.2.3.4');
      expect(http.postMetaDiagnostic).toHaveBeenCalledTimes(1);
      expect(http.postMetaDiagnostic.mock.calls[0][2]).toBe(5000);
      expect(res).toMatchObject({ status: 'accepted', httpStatus: 200, metaVersion: META_GRAPH_API_VERSION, pixelId: PIXEL, testEventCode: 'TEST999', eventName: 'PageView', eventsReceived: 1, fbtraceId: 'Atrace1', metaMessages: [], metaError: null });
      expect(res.eventId).toMatch(/^test-/);
      expect(w.audits).toEqual([
        {
          actorUserId: 'u1',
          actorRole: Role.super_admin,
          action: META_TEST_EVENT_ACTION,
          entityType: 'MeasurementTestEvent',
          entityId: res.eventId,
          after: { status: 'accepted', httpStatus: 200, metaVersion: META_GRAPH_API_VERSION, testEventCode: 'TEST999', eventsReceived: 1, fbtraceId: 'Atrace1', metaErrorCode: null },
          ip: '1.2.3.4',
        },
      ]);
      // El candado se toma ANTES de contar, y la fila se escribe dentro de la misma transacción.
      expect(w.calls).toEqual(['lock', 'count', 'audit']);
    }
  });

  it('sin token / token sin forma ⇒ 409 MEASUREMENT_META_NOT_CONFIGURED con el motivo, 0 llamadas, 0 filas', async () => {
    for (const [over, reason] of [
      [{ [SECRET_ENV_NAMES.capiToken]: undefined }, 'missing_config'],
      [{ META_PIXEL_ID: 'abc' }, 'invalid_config'],
    ] as const) {
      const http = okHttp();
      const w = world(fullEnv(over), http);
      const err = await w.svc.send({ testEventCode: 'TEST123' }, { id: 'u1' }, undefined).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BusinessException);
      expect((err as BusinessException).getStatus()).toBe(409);
      expect((err as BusinessException).code).toBe('MEASUREMENT_META_NOT_CONFIGURED');
      expect((err as BusinessException).details).toEqual({ reason });
      expect(http.postMetaDiagnostic).not.toHaveBeenCalled();
      expect(w.prisma.$transaction).not.toHaveBeenCalled();
    }
  });

  it('forma inválida ⇒ 422 `details.field`, sin el valor; no cuenta ni audita', async () => {
    const http = okHttp();
    const w = world(fullEnv(), http);
    const err = (await w.svc.send({ testEventCode: 'NOPE<script>' }, { id: 'u1' }, undefined).catch((e: unknown) => e)) as BusinessException;
    expect(err.getStatus()).toBe(422);
    expect(err.details).toEqual({ field: 'testEventCode' });
    expect(JSON.stringify(err.getResponse())).not.toContain('NOPE');
    expect(w.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('5 envíos en la ventana ⇒ 429 RATE_LIMITED con retryAfterSeconds; no llama ni audita', async () => {
    const http = okHttp();
    const now = Date.now();
    // Las 5 más recientes, de la más nueva a la más vieja (así las devuelve la consulta): la 5.ª hace 50 min ⇒ libera en ~10 min.
    const recent = [1, 2, 3, 4, 50].map((m) => new Date(now - m * 60_000));
    const w = world(fullEnv(), http, recent);
    const err = (await w.svc.send({ testEventCode: 'TEST123' }, { id: 'u1' }, undefined).catch((e: unknown) => e)) as BusinessException;
    expect(err.getStatus()).toBe(429);
    expect(err.code).toBe('RATE_LIMITED');
    const s = Number(err.details.retryAfterSeconds);
    expect(s).toBeGreaterThan(9 * 60);
    expect(s).toBeLessThanOrEqual(10 * 60);
    expect(http.postMetaDiagnostic).not.toHaveBeenCalled();
    expect(w.audits).toEqual([]);
    expect(META_TEST_EVENT_LIMIT).toBe(5);
    expect(META_TEST_EVENT_WINDOW_MS).toBe(3_600_000);
    // 4 en la ventana ⇒ pasa.
    const w4 = world(fullEnv(), okHttp(), recent.slice(0, 4));
    await expect(w4.svc.send({ testEventCode: 'TEST123' }, { id: 'u1' }, undefined)).resolves.toMatchObject({ status: 'accepted' });
  });
});

describe('Rol · @Roles(super_admin) de clase, sin marketing:read', () => {
  it('la metadata de la clase es exactamente [super_admin] y el método no la sobreescribe', () => {
    expect(Reflect.getMetadata(ROLES_KEY, AdminMeasurementController)).toEqual([Role.super_admin]);
    expect(Reflect.getMetadata(ROLES_KEY, AdminMeasurementController.prototype.metaTestEvent)).toBeUndefined();
    expect(Reflect.getMetadata('permission', AdminMeasurementController.prototype.metaTestEvent)).toBeUndefined();
  });
});
