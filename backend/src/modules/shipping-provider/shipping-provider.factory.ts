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
 *  - 🔒 v1.80.12.12 (§M4-SHIP.19.31.5 (2)): la llave del doble puesta con un adaptador que NO es `fake` (incluido el
 *    default `skydropx`, con o sin credenciales) ⇒ el arranque FALLA (`fakePurchaseKeyMisplaced`, del `env` recibido).
 *  - El doble de la pila trae una `labelUrl` por defecto en un host admitido (`https://<host>/labels/fake.pdf`) para que
 *    `labelAvailable` sea `true` y «Imprimir etiqueta» se pueda probar; `GET …/label.pdf` con `kind='fake'` NUNCA la
 *    descarga (sirve `FakeShippingProvider.labelPdf()`, §19.31.5 (3)).
 *
 * ⭐ `SKYDROPX_CLIENT_SECRET` se lee SOLO aquí en `backend/src` (`C-SDX-1`, PS-86); `SKYDROPX_ALLOW_SPEND` y la llave del
 * doble, solo en `spend-gate.ts` (C-SDX-8): aquí se pregunta con `isSpendKeyTurned()` / `fakePurchaseKeyMisplaced()`.
 */
import { FakeShippingProvider } from './fake-shipping-provider';
import { SkydropxClient } from './http/skydropx-client';
import { NoopShippingProviderAdapter } from './noop-shipping-provider.adapter';
import { resolveUrlHosts } from './provider-url';
import { SkydropxAdapter } from './skydropx.adapter';
import { ShippingProviderPort } from './shipping-provider.port';
import { fakePurchaseKeyMisplaced, isSpendKeyTurned, ProviderKind } from './spend-gate';

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
  kind: ProviderKind;
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
  if (fakePurchaseKeyMisplaced(adapter, env as NodeJS.ProcessEnv)) {
    throw new Error(
      `La llave de compra del doble está puesta con SHIPPING_PROVIDER_ADAPTER='${adapter}': solo vale con 'fake' ` +
        '(§19.31.5). El proceso no arranca.',
    );
  }
  if (adapter === 'fake') {
    if (isSpendKeyTurned()) {
      throw new Error(
        "SHIPPING_PROVIDER_ADAPTER='fake' con la llave de gasto girada: un despliegue que puede gastar no " +
          'corre con el doble (§19.19.7). El proceso no arranca.',
      );
    }
    const urlHosts = resolveUrlHosts(env.SKYDROPX_URL_HOSTS, FAKE_LABEL_HOST);
    const fake = new FakeShippingProvider();
    fake.defaultLabelUrl = fakeLabelUrlFor(urlHosts);
    return { port: fake, kind: 'fake', urlHosts, client: null };
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

/** Host de la API del doble (no resuelve: `.invalid`, RFC 2606). */
export const FAKE_LABEL_HOST = 'fake.invalid';

/**
 * La `labelUrl` que el doble de la pila devuelve con cada guía: en el PRIMER host admitido (`*.dominio` ⇒ `labels.dominio`)
 * para que pase `assertProviderUrl` al escribirse. ⛔ Nunca se descarga: con `kind='fake'` el proxy sirve el PDF fijo.
 */
export function fakeLabelUrlFor(urlHosts: readonly string[]): string {
  const first = (urlHosts[0] ?? FAKE_LABEL_HOST).replace(/^\*\./, 'labels.');
  return `https://${first}/labels/fake.pdf`;
}
