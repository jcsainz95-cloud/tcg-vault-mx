/**
 * 💰 P-DB-LIMPIEZA · E — qué base usa `limpieza-republicar` (unidad, sin red). Propiedad: backend.
 * Desde fuera de Railway (`railway run`, máquina del dueño) la red interna no se alcanza: con `DATABASE_URL` interna y
 * `DATABASE_PUBLIC_URL` presente, la pública (mismo salto que `scripts/geo/import-sepomex.ts` `resolveDatabaseUrl`).
 */
import { resolveRepublicarDatabaseUrl } from '../src/cli/limpieza-republicar';

const INTERNAL = 'postgresql://u:p@postgres.railway.internal:5432/railway';
const PUBLIC = 'postgresql://u:p@roundhouse.proxy.rlwy.net:41234/railway';
const LOCAL = 'postgresql://u:p@localhost:5432/tcg?schema=public';

describe('resolveRepublicarDatabaseUrl', () => {
  it('URL interna de Railway + DATABASE_PUBLIC_URL ⇒ la pública', () => {
    expect(resolveRepublicarDatabaseUrl({ DATABASE_URL: INTERNAL, DATABASE_PUBLIC_URL: PUBLIC })).toEqual({ url: PUBLIC, viaPublica: true });
  });
  it('URL interna SIN DATABASE_PUBLIC_URL ⇒ se niega diciendo qué URL poner', () => {
    expect(() => resolveRepublicarDatabaseUrl({ DATABASE_URL: INTERNAL })).toThrow(/URL PÚBLICA/);
  });
  it('URL no interna ⇒ la misma, aunque exista DATABASE_PUBLIC_URL', () => {
    expect(resolveRepublicarDatabaseUrl({ DATABASE_URL: PUBLIC, DATABASE_PUBLIC_URL: 'postgresql://x@otra:1/db' })).toEqual({ url: PUBLIC, viaPublica: false });
    expect(resolveRepublicarDatabaseUrl({ DATABASE_URL: LOCAL })).toEqual({ url: LOCAL, viaPublica: false });
  });
  it('sin DATABASE_URL o ilegible ⇒ se niega', () => {
    expect(() => resolveRepublicarDatabaseUrl({})).toThrow(/Falta DATABASE_URL/);
    expect(() => resolveRepublicarDatabaseUrl({ DATABASE_URL: 'no es url' })).toThrow(/no es una URL válida/);
  });
});
