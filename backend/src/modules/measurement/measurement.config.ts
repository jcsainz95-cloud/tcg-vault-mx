/**
 * measurement.config.ts — el interruptor de Fase 2 y el fail-closed por destino (API_CONTRACT §MKT.H.1;
 * ARCHITECTURE §14.1, D-MKT2-0). Función PURA sobre un mapa de variables: sin Nest, sin `now()`, sin red.
 *
 * - `MEASUREMENT_MODE` vale `on` SOLO si es exactamente `'on'`. Ausente, vacío, `ON`, `true`, `1`… ⇒ `off` (C-B1).
 * - Cada destino se habilita solo con sus DOS variables presentes y con forma válida. Si falta una o no cumple ⇒
 *   destino deshabilitado, con un motivo SIN valores (`missing_config` | `invalid_config`) para la línea de arranque
 *   `MEASUREMENT_DESTINATION_DISABLED` (C-B7). ⛔ Nunca se devuelve ni se registra el valor de un secreto.
 */
import type { MeasurementDestination } from '@prisma/client';

export type MeasurementMode = 'off' | 'on';

export type DestinationDisabledReason = 'missing_config' | 'invalid_config';

export interface Ga4Destination {
  enabled: true;
  measurementId: string;
  apiSecret: string;
}
export interface MetaDestination {
  enabled: true;
  pixelId: string;
  token: string;
}
export interface DisabledDestination {
  enabled: false;
  reason: DestinationDisabledReason;
}

export interface MeasurementConfig {
  mode: MeasurementMode;
  ga4: Ga4Destination | DisabledDestination;
  meta: MetaDestination | DisabledDestination;
}

/** Formas válidas (§MKT.H.1). */
export const GA4_MEASUREMENT_ID_RE = /^G-[A-Z0-9]{4,12}$/;
export const GA4_MP_API_SECRET_RE = /^[A-Za-z0-9_-]{1,128}$/;
export const META_PIXEL_ID_RE = /^\d{10,20}$/;
export const META_CAPI_TOKEN_RE = /^\S{20,512}$/;

/**
 * Versión de la API de Graph de Meta (CAPI y evento de prueba): FIJA en código. Su única fuente en `docs/` es el bloque
 * `META-GRAPH-VERSION` de API_CONTRACT §MKT.H.1; la paridad (y la caducidad `reviewBy`) la cobra C-B15
 * (`test/measurement.graph-version.spec.ts`). Cambiarla es un cambio de contrato (§MKT.H.12, «Cambiar la versión»).
 */
export const META_GRAPH_API_VERSION = 'v26.0';

/** Base de Graph. La URL de eventos sale SOLO de aquí (drenador y evento de prueba). */
export const META_GRAPH_URL = 'https://graph.facebook.com';

/** `POST <graph>/<versión>/<pixel>/events` (§MKT.H.5/.12). ⛔ El token no va en la URL: va en el cuerpo. */
export function metaEventsUrl(pixelId: string): string {
  return `${META_GRAPH_URL}/${META_GRAPH_API_VERSION}/${encodeURIComponent(pixelId)}/events`;
}

export type EnvLike = Record<string, string | undefined>;

/** `on` solo con el literal exacto. Cualquier otra cosa (incluido `ON`) ⇒ `off`. */
export function readMeasurementMode(env: EnvLike): MeasurementMode {
  return env.MEASUREMENT_MODE === 'on' ? 'on' : 'off';
}

function pair(
  a: string | undefined,
  aRe: RegExp,
  b: string | undefined,
  bRe: RegExp,
): { ok: true; a: string; b: string } | { ok: false; reason: DestinationDisabledReason } {
  const av = a?.trim() ?? '';
  const bv = b?.trim() ?? '';
  if (av === '' || bv === '') return { ok: false, reason: 'missing_config' };
  if (!aRe.test(av) || !bRe.test(bv)) return { ok: false, reason: 'invalid_config' };
  return { ok: true, a: av, b: bv };
}

export function readMeasurementConfig(env: EnvLike): MeasurementConfig {
  const mode = readMeasurementMode(env);
  const g = pair(env.GA4_MEASUREMENT_ID, GA4_MEASUREMENT_ID_RE, env.GA4_MP_API_SECRET, GA4_MP_API_SECRET_RE);
  const m = pair(env.META_PIXEL_ID, META_PIXEL_ID_RE, env.META_CAPI_TOKEN, META_CAPI_TOKEN_RE);
  return {
    mode,
    ga4: g.ok ? { enabled: true, measurementId: g.a, apiSecret: g.b } : { enabled: false, reason: g.reason },
    meta: m.ok ? { enabled: true, pixelId: m.a, token: m.b } : { enabled: false, reason: m.reason },
  };
}

/** ¿Este destino puede encolar y enviar? Modo `on` Y destino habilitado. */
export function destinationEnabled(cfg: MeasurementConfig, d: MeasurementDestination): boolean {
  if (cfg.mode !== 'on') return false;
  return d === 'ga4_mp' ? cfg.ga4.enabled : cfg.meta.enabled;
}

/**
 * Las líneas de arranque (C-B7): una por destino deshabilitado, SOLO con el modo `on` (con `off` no hay nada que
 * habilitar). ⛔ Sin valores: solo el nombre del destino y el motivo.
 */
export function disabledDestinationLines(cfg: MeasurementConfig): string[] {
  if (cfg.mode !== 'on') return [];
  const out: string[] = [];
  if (!cfg.ga4.enabled) out.push(`MEASUREMENT_DESTINATION_DISABLED destination=ga4_mp reason=${cfg.ga4.reason}`);
  if (!cfg.meta.enabled) out.push(`MEASUREMENT_DESTINATION_DISABLED destination=meta_capi reason=${cfg.meta.reason}`);
  return out;
}

// ───────────── SEC-MKT-3: bloqueos de encendido también en el backend (ARCHITECTURE §14.1 D-MKT2-0c) ─────────────

/** Un bloqueo de encendido cuyo dueño es backend (mismo formato que `ENCENDER_BLOCKERS` del frontend). */
export interface MeasurementEncenderBlocker {
  id: string;
  what: string;
  closedBy: string;
}

/**
 * Los bloqueos ABIERTOS de dueño backend. Con `MEASUREMENT_MODE=on` y alguno aquí, el modo EFECTIVO es `off` y el arranque
 * registra `MEASUREMENT_ENCENDER_BLOCKED`: encender solo el backend ya no se salta lo que bloquea el frontend (SEC-MKT-3). Una
 * entrada sale en el commit que cierra su ficha de TECH_DEBT; la paridad con el frontend y con las fichas la vigila
 * `test/measurement.encender-gate.spec.ts`. MKT-TL2 salió con la prueba 3 (`test/marketing-cross-table.audit.spec.ts`);
 * MKT-F2-4 salió con C-B11 verde contra Postgres y el ciclo reversa ⇒ `migrate deploy` de m86 (TECH_DEBT MKT-F2-4, 2026-10-26).
 */
export const BACKEND_ENCENDER_BLOCKERS: readonly MeasurementEncenderBlocker[] = [
  {
    id: 'MKT-F2-3',
    what: "META_GRAPH_API_VERSION ('v26.0') sin verificar vigente para la fecha de encendido",
    closedBy: 'evento de prueba de Meta aceptado (2xx) con la versión fijada, anotado en BACKEND_NOTES (TECH_DEBT MKT-F2-3)',
  },
];

/** Token de inyección de la lista (lo provee `MeasurementModule`; las pruebas que construyen el servicio a mano no lo pasan). */
export const MEASUREMENT_ENCENDER_BLOCKERS = Symbol('MEASUREMENT_ENCENDER_BLOCKERS');

/**
 * Modo efectivo: `on` solo si se pidió `on` Y no queda ningún bloqueo. Devuelve también las líneas de arranque (sin valores:
 * solo ids). Con `off` pedido no hay nada que decir.
 */
export function gateMeasurementConfig(
  cfg: MeasurementConfig,
  blockers: readonly MeasurementEncenderBlocker[],
): { config: MeasurementConfig; lines: string[] } {
  if (cfg.mode !== 'on' || blockers.length === 0) return { config: cfg, lines: [] };
  return {
    config: { ...cfg, mode: 'off' },
    lines: [`MEASUREMENT_ENCENDER_BLOCKED requested=on effective=off blockers=${blockers.map((b) => b.id).join(',')}`],
  };
}
