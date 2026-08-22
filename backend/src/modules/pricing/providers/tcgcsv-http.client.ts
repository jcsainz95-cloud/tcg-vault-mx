/**
 * tcgcsv-http.client.ts (v1.26, ARCHITECTURE §4.24a) — Base HTTP COMPARTIDA para los clientes de
 * tcgcsv.com (espejo diario estático de TCGplayer, JSON servido como archivos, SIN API key).
 *
 * Se EXTRAE de `TcgcsvSealedBulkProvider` (v1.19) para que el nuevo `TcgcsvCatalogClient` (singles,
 * §4.24a) REUSE la MISMA seguridad anti-SSRF SIN reinventarla:
 *  - **Host FIJO `https://tcgcsv.com/tcgplayer`** (el cliente NUNCA acepta URLs arbitrarias).
 *  - **Categoría Pokémon = 3, CONSTANTE de servidor** (no configurable, no viene del cliente).
 *  - Todo `groupId` interpolado en un path se valida como **entero positivo** ANTES.
 *  - **Sin API key.** Timeout corto, `redirect:'error'` (sin seguir redirects fuera del host),
 *    `Accept: application/json`. Payload sin `results[]` → lanza (dominio de fallo del llamador).
 *
 * SUPUESTO a verificar en staging (§4.19f/§4.24a): el egress a tcgcsv.com está BLOQUEADO en dev/CI;
 * el formato se calibró con las fixtures de `backend/test/fixtures/tcgcsv/`. Si el esquema real
 * difiere, se ajustan adapter + fixtures (S-D1/S-D2/S-D3).
 */
export interface TcgcsvEnvelope<T> {
  totalItems?: number;
  success?: boolean;
  errors?: unknown[];
  results?: T[];
}

export abstract class TcgcsvHttpClient {
  /** Host FIJO — no configurable por el usuario (anti-SSRF). */
  protected readonly baseUrl = 'https://tcgcsv.com/tcgplayer';
  /** Categoría Pokémon en TCGplayer/TCGCSV. CONSTANTE de servidor (nunca del cliente). */
  protected readonly pokemonCategoryId = 3;
  /** Timeout corto: TCGCSV sirve archivos estáticos; si tarda, algo anda mal. */
  protected readonly timeoutMs = 15_000;

  /** GET al host fijo con timeout + sin redirects + Accept JSON. */
  protected async getJson<T>(path: string): Promise<TcgcsvEnvelope<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        // User-Agent identificable: varias CDNs devuelven 401/403 al UA por defecto de
        // Node/undici (en prod, tcgcsv.com/tcgplayer/3/24688/products dio HTTP 401 sin él).
        // Afecta por igual a singles Y sellado (comparten este cliente base). Reversible.
        headers: {
          Accept: 'application/json',
          'User-Agent': 'tcg-vault-mx/1.0 (+https://tcghunt.mx)',
        },
        redirect: 'error',
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`tcgcsv.com ${path} -> HTTP ${res.status}`);
      const body = (await res.json()) as TcgcsvEnvelope<T>;
      if (!body || !Array.isArray(body.results)) {
        throw new Error(`tcgcsv.com ${path} -> payload inesperado (sin results[])`);
      }
      return body;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Valida el groupId como entero positivo ANTES de interpolarlo en el path remoto. */
  protected assertValidGroupId(groupId: number): void {
    if (!Number.isInteger(groupId) || groupId <= 0) {
      throw new Error(`tcgcsv: groupId inválido (${String(groupId)}); debe ser entero positivo`);
    }
  }
}
