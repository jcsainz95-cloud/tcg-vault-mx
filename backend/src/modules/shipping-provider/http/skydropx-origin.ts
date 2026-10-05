/**
 * skydropx-origin.ts — origen normalizado de la API (API_CONTRACT §M4-SHIP.19.19.3 (1), PS-92).
 *
 * `SKYDROPX_BASE_URL` sin `/` final y sin sufijo `/api/v1` o `/api/v2`; exige `https:`. Las rutas se arman
 * `${origin}/api/v1/…` y `${origin}/api/v2/…`. Así sirven el valor de la referencia (`…/api/v1`), el del entorno
 * anterior (solo el origen) y uno con `/` final: las mismas URLs. ⛔ Ninguna constante de host en el código
 * (`C-SDX-1`): el valor viene SOLO del entorno.
 */
export class InvalidSkydropxBaseUrlError extends Error {
  constructor(reason: string) {
    super(`SKYDROPX_BASE_URL inválida: ${reason}`);
    this.name = 'InvalidSkydropxBaseUrlError';
  }
}

export function skydropxOrigin(baseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl.trim());
  } catch {
    throw new InvalidSkydropxBaseUrlError('no es una URL');
  }
  if (parsed.protocol !== 'https:') throw new InvalidSkydropxBaseUrlError('exige https');
  if (parsed.username || parsed.password) throw new InvalidSkydropxBaseUrlError('sin credenciales en la URL');
  if (parsed.search || parsed.hash) throw new InvalidSkydropxBaseUrlError('sin query ni fragmento');
  let path = parsed.pathname.replace(/\/+$/, '');
  path = path.replace(/\/api\/v[12]$/, '');
  path = path.replace(/\/+$/, '');
  return `${parsed.protocol}//${parsed.host}${path}`;
}

/** Host (con puerto si lo hubiera) del origen de la API: el ÚNICO al que viaja nuestro `Bearer` (§19.19.9). */
export function skydropxApiHost(origin: string): string {
  return new URL(origin).host.toLowerCase();
}
