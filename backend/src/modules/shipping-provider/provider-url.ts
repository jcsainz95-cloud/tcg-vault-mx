/**
 * provider-url.ts — 🔒 toda URL que devuelve el proveedor es ENTRADA NO CONFIABLE (API_CONTRACT §M4-SHIP.19.18.5,
 * SEC-SDX-5, `C-SDX-7`; y §19.19.9).
 *
 * `assertProviderUrl` es PURA: acepta solo `https:`, sin usuario/contraseña, sin puerto explícito, longitud ≤ 2048 y
 * `hostname` en la lista (`SKYDROPX_URL_HOSTS`: coincidencia exacta o `*.dominio` ⇒ cualquier subdominio de UN
 * nivel); lo demás ⇒ `null`. Se aplica AL ESCRIBIR, en un solo helper (`providerUrlsFrom`) que usan los tres
 * escritores (`setTrackingFromProvider`, la rama «sin número» de §19.7 paso 9 y el refresco del sondeo).
 */
const MAX_URL_LENGTH = 2048;

/**
 * Lista de hosts admitidos: `SKYDROPX_URL_HOSTS` (separada por comas) o, si falta, SOLO el host de la API
 * (§19.19.12: valor inicial = el host de producción). ⛔ Sin host literal en el código (`C-SDX-1`).
 */
export function resolveUrlHosts(envValue: string | undefined, apiHost: string): string[] {
  const fromEnv = (envValue ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter((h) => h !== '');
  return fromEnv.length > 0 ? fromEnv : [apiHost.toLowerCase()];
}

function hostAllowed(hostname: string, allowedHosts: readonly string[]): boolean {
  const host = hostname.toLowerCase();
  for (const entry of allowedHosts) {
    const e = entry.toLowerCase();
    if (e.startsWith('*.')) {
      const base = e.slice(2);
      if (host.endsWith(`.${base}`)) {
        const label = host.slice(0, host.length - base.length - 1);
        if (label !== '' && !label.includes('.')) return true;
      }
    } else if (host === e) {
      return true;
    }
  }
  return false;
}

export function assertProviderUrl(url: unknown, allowedHosts: readonly string[]): string | null {
  if (typeof url !== 'string' || url === '' || url.length > MAX_URL_LENGTH) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (parsed.username !== '' || parsed.password !== '') return null;
  if (parsed.port !== '') return null;
  if (!hostAllowed(parsed.hostname, allowedHosts)) return null;
  return parsed.toString();
}

/** Host para la bitácora `provider_url_rejected` (⛔ nunca la URL entera: puede llevar firma). */
export function hostOf(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  try {
    return new URL(url).host || null;
  } catch {
    return null;
  }
}

export interface ProviderUrls {
  labelUrl: string | null;
  trackingUrl: string | null;
  rejected: { field: 'labelUrl' | 'trackingUrl'; host: string | null }[];
}

/**
 * ⭐ EL único sitio que produce los valores de `labelUrl`/`trackingUrl` a escribir (`C-SDX-7` (2)). Una URL
 * rechazada ⇒ `null` + entrada en `rejected` (el escritor deja la bitácora). ⛔ Nunca descarta la compra.
 */
export function providerUrlsFrom(
  result: { labelUrl?: unknown; trackingUrl?: unknown },
  allowedHosts: readonly string[],
): ProviderUrls {
  const rejected: ProviderUrls['rejected'] = [];
  const check = (field: 'labelUrl' | 'trackingUrl', raw: unknown): string | null => {
    if (raw === null || raw === undefined || raw === '') return null;
    const ok = assertProviderUrl(raw, allowedHosts);
    if (ok === null) rejected.push({ field, host: hostOf(raw) });
    return ok;
  };
  return {
    labelUrl: check('labelUrl', result.labelUrl),
    trackingUrl: check('trackingUrl', result.trackingUrl),
    rejected,
  };
}
