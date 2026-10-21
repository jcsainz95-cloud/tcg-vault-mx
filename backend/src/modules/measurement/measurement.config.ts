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

/** Versión de la API de Graph de Meta: FIJA en código (§MKT.H.1). Cambiarla es un cambio revisado. */
export const META_GRAPH_API_VERSION = 'v21.0';

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
