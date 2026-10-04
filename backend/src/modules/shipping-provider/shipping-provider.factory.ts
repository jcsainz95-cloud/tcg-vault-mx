/**
 * shipping-provider.factory.ts — qué adaptador se inyecta en `SHIPPING_PROVIDER_PORT` (API_CONTRACT §19.19.7,
 * §19.19.12). Función sobre un mapa de entorno (el módulo le pasa `process.env`); la llave de gasto se lee del proceso.
 *
 *  - `SHIPPING_PROVIDER_ADAPTER = 'skydropx' | 'fake'` (default `skydropx`); cualquier otro valor ⇒ el arranque falla.
 *  - `fake` con la llave de gasto girada (`isSpendKeyTurned()`, que lee el entorno del PROCESO) ⇒ el arranque FALLA
 *    (un despliegue real nunca corre con el doble).
 *  - `NODE_ENV=test` ⇒ SOLO `Fake`/`Noop`: el adaptador real no se construye nunca por inyección bajo pruebas (se
 *    construye a mano en las unitarias, con un transporte grabador).
 *  - `skydropx` sin `SKYDROPX_BASE_URL`/`CLIENT_ID`/`CLIENT_SECRET` ⇒ `Noop` (`409 {missing:['env']}`).
 *
 * ⭐ `SKYDROPX_CLIENT_SECRET` se lee SOLO aquí en `backend/src` (`C-SDX-1`, PS-86); `SKYDROPX_ALLOW_SPEND`, solo en
 * `spend-gate.ts` (C-SDX-8): aquí se pregunta con `isSpendKeyTurned()`.
 */
import { FakeShippingProvider } from './fake-shipping-provider';
import { SkydropxClient } from './http/skydropx-client';
import { NoopShippingProviderAdapter } from './noop-shipping-provider.adapter';
import { resolveUrlHosts } from './provider-url';
import { SkydropxAdapter } from './skydropx.adapter';
import { ShippingProviderPort } from './shipping-provider.port';
import { isSpendKeyTurned } from './spend-gate';

export type EnvMap = Record<string, string | undefined>;

export interface SkydropxRuntimeConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  rps: number;
}

export function readSkydropxConfig(env: EnvMap): SkydropxRuntimeConfig | null {
  const baseUrl = env.SKYDROPX_BASE_URL?.trim();
  const clientId = env.SKYDROPX_CLIENT_ID?.trim();
  const clientSecret = env.SKYDROPX_CLIENT_SECRET?.trim();
  if (!baseUrl || !clientId || !clientSecret) return null;
  const rpsRaw = Number(env.SKYDROPX_RPS);
  return { baseUrl, clientId, clientSecret, rps: Number.isFinite(rpsRaw) && rpsRaw > 0 ? rpsRaw : 2 };
}

export interface ShippingProviderSelection {
  port: ShippingProviderPort;
  kind: 'skydropx' | 'fake' | 'noop';
  /** Hosts admitidos para `labelUrl`/`trackingUrl` (`SKYDROPX_URL_HOSTS` o el host de la API). */
  urlHosts: string[];
  /** Solo con el adaptador real: el cliente (el proxy de la etiqueta pide token y turno de la cubeta). */
  client: SkydropxClient | null;
}

export function selectShippingProvider(env: EnvMap): ShippingProviderSelection {
  const adapter = (env.SHIPPING_PROVIDER_ADAPTER ?? 'skydropx').trim() || 'skydropx';
  if (adapter !== 'skydropx' && adapter !== 'fake') {
    throw new Error(`SHIPPING_PROVIDER_ADAPTER desconocido: '${adapter}' (admite 'skydropx' | 'fake')`);
  }
  if (adapter === 'fake') {
    if (isSpendKeyTurned()) {
      throw new Error(
        "SHIPPING_PROVIDER_ADAPTER='fake' con la llave de gasto girada: un despliegue que puede gastar no " +
          'corre con el doble (§19.19.7). El proceso no arranca.',
      );
    }
    return { port: new FakeShippingProvider(), kind: 'fake', urlHosts: resolveUrlHosts(env.SKYDROPX_URL_HOSTS, 'fake.invalid'), client: null };
  }
  const noop = (): ShippingProviderSelection => ({
    port: new NoopShippingProviderAdapter(),
    kind: 'noop',
    urlHosts: [],
    client: null,
  });
  if (env.NODE_ENV === 'test') return noop();
  const config = readSkydropxConfig(env);
  if (!config) return noop();
  const client = new SkydropxClient(config);
  return {
    port: new SkydropxAdapter({ client }),
    kind: 'skydropx',
    urlHosts: resolveUrlHosts(env.SKYDROPX_URL_HOSTS, client.apiHost),
    client,
  };
}
