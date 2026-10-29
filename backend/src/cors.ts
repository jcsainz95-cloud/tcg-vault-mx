/**
 * cors.ts — opciones de CORS en UN sitio que `main.ts` usa y que una prueba puede importar
 * (`main.ts` no: arranca el servidor al importarse). Mismo patrón que `trust-proxy.ts`.
 *
 * S-M2: allow-list de orígenes desde `APP_BASE_URL` (lista separada por comas si hay varios
 * orígenes válidos). Nunca se refleja un origin arbitrario (`origin: true` con credenciales).
 * Fallback seguro si `APP_BASE_URL` no está seteada: solo orígenes de desarrollo local
 * (`http://localhost:3000`, `http://localhost:5173`) — jamás un comodín. En staging/prod
 * `APP_BASE_URL` DEBE fijarse (ver docs/BACKEND_NOTES.md).
 */
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

export function resolveCorsOrigins(): string[] {
  const raw = process.env.APP_BASE_URL;
  const origins = (raw ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  if (origins.length > 0) return origins;
  return ['http://localhost:3000', 'http://localhost:5173'];
}

/**
 * Cabeceras que JS del front (otro origen) puede leer además de las CORS-safelisted.
 * `Content-Disposition`: lleva el nombre del archivo de toda descarga con `requestBlob`
 * (Excel/CSV del Panel de Marketing §MKT.E/§MKT.G.7, inventario, guías, reportes, Card Show).
 * Sin exponerla, el navegador la oculta y el front cae a su nombre por defecto.
 */
export const CORS_EXPOSED_HEADERS = ['Content-Disposition'];

/** §DYN.6.5 — segundos que el navegador puede reutilizar un preflight. */
export const CORS_PREFLIGHT_MAX_AGE_S = 600;

export function buildCorsOptions(origins: string[] = resolveCorsOrigins()): CorsOptions {
  // v1.113⟨portada⟩ (API_CONTRACT §DYN.6.5): el navegador guarda el preflight 10 min (`Access-Control-Max-Age: 600`) en vez de
  // repetir el `OPTIONS` antes de cada petición con credenciales. Sin efecto en ninguna respuesta del contrato.
  return { origin: origins, credentials: true, exposedHeaders: CORS_EXPOSED_HEADERS, maxAge: CORS_PREFLIGHT_MAX_AGE_S };
}
