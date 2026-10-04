/**
 * label-proxy.ts — 🔒 descarga acotada de la etiqueta para el proxy `GET …/label.pdf` (API_CONTRACT §M4-SHIP.19.8,
 * §19.18.5 SEC-SDX-5 y §19.19.9; PS-84, PS-100).
 *
 * Es el ÚNICO `fetch` del sistema a una URL leída de una respuesta ajena, y va acotado:
 *  - la URL (y cada `Location`) pasa `assertProviderUrl` o no se pide; `redirect:'manual'`, máximo 3 saltos;
 *  - 🔒 `Authorization: Bearer` SOLO si el host del salto es el host de la API (`skydropxOrigin`); a cualquier otro
 *    host de `SKYDROPX_URL_HOSTS` (cubeta, URL firmada) va SIN credenciales — nuestro token nunca sale hacia un
 *    tercero que no es la API (ARCHITECTURE §4.60 (l)). `User-Agent` siempre;
 *  - `Content-Type` `application/pdf`, cuerpo ≤ 5 MB (se aborta al superarlo), timeout 10 s;
 *  - cualquier incumplimiento ⇒ `502 SHIPPING_PROVIDER_ERROR {op:'label_download'}` sin cuerpo.
 * La descarga al host de la API pasa por la cubeta del cliente (§19.19.3 (3)).
 */
import { SKYDROPX_USER_AGENT } from './http/skydropx-client';
import { assertProviderUrl } from './provider-url';
import { ShippingProviderError } from './shipping-provider.errors';

export const LABEL_MAX_BYTES = 5 * 1024 * 1024;
export const LABEL_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

export interface LabelApiAccess {
  readonly apiHost: string;
  accessToken(): Promise<string>;
  acquireSlot(): Promise<void>;
}

export interface LabelDownloadDeps {
  api: LabelApiAccess;
  allowedHosts: readonly string[];
  /** Inyectable SOLO para pruebas (un doble HTTP); por omisión, `fetch`. */
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
  timeoutMs?: number;
  maxBytes?: number;
}

const OP = 'label_download';

export async function downloadLabelPdf(labelUrl: string, deps: LabelDownloadDeps): Promise<Buffer> {
  const doFetch = deps.fetchImpl ?? ((url: string, init: RequestInit) => fetch(url, init));
  const maxBytes = deps.maxBytes ?? LABEL_MAX_BYTES;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? LABEL_TIMEOUT_MS);
  (timer as { unref?: () => void }).unref?.();
  try {
    const first = assertProviderUrl(labelUrl, deps.allowedHosts);
    if (first === null) throw ShippingProviderError.error(OP, null, 'url_rejected');
    let current: string = first;
    for (let hop = 0; ; hop += 1) {
      const host = new URL(current).host.toLowerCase();
      const headers: Record<string, string> = { 'User-Agent': SKYDROPX_USER_AGENT, Accept: 'application/pdf' };
      if (host === deps.api.apiHost) {
        await deps.api.acquireSlot();
        headers.Authorization = `Bearer ${await deps.api.accessToken()}`;
      }
      let res: Response;
      try {
        res = await doFetch(current, { method: 'GET', headers, redirect: 'manual', signal: controller.signal });
      } catch {
        throw ShippingProviderError.error(OP, null, controller.signal.aborted ? 'timeout' : 'network');
      }
      if (res.status >= 300 && res.status < 400) {
        await discard(res);
        const location = res.headers.get('location');
        const next: string | null = location ? resolveLocation(location, current) : null;
        const allowed: string | null = next === null ? null : assertProviderUrl(next, deps.allowedHosts);
        if (allowed === null || hop >= MAX_REDIRECTS) throw ShippingProviderError.error(OP, res.status, 'redirect');
        current = allowed;
        continue;
      }
      if (res.status < 200 || res.status >= 300) {
        await discard(res);
        throw ShippingProviderError.error(OP, res.status);
      }
      const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
      if (!contentType.startsWith('application/pdf')) {
        await discard(res);
        throw ShippingProviderError.error(OP, res.status, 'content_type');
      }
      const declared = Number(res.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > maxBytes) {
        await discard(res);
        throw ShippingProviderError.error(OP, res.status, 'too_large');
      }
      return await readCapped(res, maxBytes);
    }
  } finally {
    clearTimeout(timer);
  }
}

function resolveLocation(location: string, base: string): string | null {
  try {
    return new URL(location, base).toString();
  } catch {
    return null;
  }
}

async function discard(res: Response): Promise<void> {
  try {
    await res.body?.cancel();
  } catch {
    // nada: el cuerpo no se usa
  }
}

async function readCapped(res: Response, maxBytes: number): Promise<Buffer> {
  const body = res.body;
  if (!body) return Buffer.alloc(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch {
      throw ShippingProviderError.error(OP, res.status, 'network');
    }
    if (chunk.done) break;
    total += chunk.value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        // abortado igual
      }
      throw ShippingProviderError.error(OP, res.status, 'too_large');
    }
    chunks.push(chunk.value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength)));
}
