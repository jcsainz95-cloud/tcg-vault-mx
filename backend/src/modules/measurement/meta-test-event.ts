/**
 * meta-test-event.ts — piezas PURAS del evento de prueba de Meta (API_CONTRACT §MKT.H.12; ARCHITECTURE §14.10 D-MKT2-10).
 *
 * - `parseTestEventCode`: el body `{ testEventCode }` (recortado, `^TEST[0-9]{3,10}$`, ⛔ claves de más).
 * - `newMetaTestEventIds`: lo único aleatorio (uuid v4 del `event_id` y los 10 dígitos del `fbp` sintético).
 * - `buildMetaTestEventBody`: el cuerpo que sale, lista CERRADA de claves por nivel. `user_data` = solo un `fbp` sintético
 *   nuevo, de nadie. ⛔ Sin `custom_data`, `external_id` (ni aleatorio con hash), `client_user_agent`, `client_ip_address`
 *   ni ningún dato personal. Candado C-B12 (`test/measurement.meta-test-event.spec.ts`).
 * - `metaTestEventStatus`: `accepted` ⇔ 2xx y `eventsReceived === 1`; `unreachable` = red/timeout; si no, `rejected`.
 */
import { randomInt, randomUUID } from 'node:crypto';
import { eventSourceUrl } from './measurement-bodies';
import type { MetaDiagnostic } from './measurement-http';

export const TEST_EVENT_CODE_RE = /^TEST[0-9]{3,10}$/;

export type TestEventCodeParse = { ok: true; code: string } | { ok: false };

/** `{ testEventCode: string }` y nada más. Ausente, otro tipo, otra forma o claves de más ⇒ `{ok:false}` (422). */
export function parseTestEventCode(body: Record<string, unknown>): TestEventCodeParse {
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== 'testEventCode') return { ok: false };
  const raw = body.testEventCode;
  if (typeof raw !== 'string') return { ok: false };
  const code = raw.trim();
  return TEST_EVENT_CODE_RE.test(code) ? { ok: true, code } : { ok: false };
}

export interface MetaTestEventIds {
  /** uuid v4 (sin el prefijo `test-`). */
  uuid: string;
  /** Exactamente 10 dígitos. */
  fbpRandom: string;
}

export function newMetaTestEventIds(): MetaTestEventIds {
  return { uuid: randomUUID(), fbpRandom: String(randomInt(1_000_000_000, 10_000_000_000)) };
}

export const metaTestEventId = (uuid: string): string => `test-${uuid}`;

export interface MetaTestEventInput {
  testEventCode: string;
  token: string;
  /** Primer origen de `APP_BASE_URL`. */
  origin: string;
  now: Date;
  ids: MetaTestEventIds;
}

export function buildMetaTestEventBody(i: MetaTestEventInput): Record<string, unknown> {
  return {
    data: [
      {
        event_name: 'PageView',
        event_time: Math.floor(i.now.getTime() / 1000),
        event_id: metaTestEventId(i.ids.uuid),
        action_source: 'website',
        event_source_url: eventSourceUrl(i.origin, '/'),
        user_data: { fbp: `fb.1.${i.now.getTime()}.${i.ids.fbpRandom}` },
      },
    ],
    test_event_code: i.testEventCode,
    access_token: i.token,
  };
}

export type MetaTestEventStatus = 'accepted' | 'rejected' | 'unreachable';

export function metaTestEventStatus(d: Pick<MetaDiagnostic, 'httpStatus' | 'eventsReceived'>): MetaTestEventStatus {
  if (d.httpStatus === null) return 'unreachable';
  return d.httpStatus >= 200 && d.httpStatus < 300 && d.eventsReceived === 1 ? 'accepted' : 'rejected';
}

/** Respuesta 200 de §MKT.H.12. */
export interface MetaTestEventResult {
  status: MetaTestEventStatus;
  httpStatus: number | null;
  metaVersion: string;
  pixelId: string;
  testEventCode: string;
  eventName: 'PageView';
  eventId: string;
  sentAt: string;
  eventsReceived: number | null;
  fbtraceId: string | null;
  metaMessages: string[];
  metaError: { code: number | null; subcode: number | null; type: string | null; message: string | null } | null;
}
