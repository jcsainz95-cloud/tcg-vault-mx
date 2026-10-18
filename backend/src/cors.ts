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

export function buildCorsOptions(origins: string[] = resolveCorsOrigins()): CorsOptions {
  return { origin: origins, credentials: true, exposedHeaders: CORS_EXPOSED_HEADERS };
}
