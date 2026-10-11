import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * ⭐⭐ **PERF-CATALOG — el índice de rendimiento de "Compra", verificado como TEXTO.**
 *
 * El encargo perf-catalog autoriza cambiar la VELOCIDAD del catálogo (`GET /catalog/cards`,
 * `GET /catalog/facets`) pero ⛔ **prohíbe** cambiar los datos o el resultado (mismos ítems,
 * mismo orden, mismos precios, mismas facetas). La optimización elegida es un **índice**
 * (`InventoryItem(ownerType, status, createdAt DESC)`) que sirve la lectura compartida de
 * `CatalogService.fetchSellable`.
 *
 * **Por qué esta prueba basta para fijar «el resultado NO cambió».** Un índice de Postgres
 * jamás altera la salida de una consulta — solo el PLAN. Así que la garantía money-safe se
 * reduce a UN hecho comprobable sobre la FORMA de la migración: *que no contiene NADA salvo
 * el `CREATE INDEX`.* Si la migración solo crea un índice, no puede mover un ítem, reordenar
 * una rejilla ni tocar un precio. Ésa es la mitad «canario». La mitad «candado» es la paridad
 * con el schema: si el `@@index` desaparece del schema, `prisma migrate deploy` dejaría de
 * declararlo y el índice podría no recrearse en un entorno nuevo — la mejora se perdería en
 * silencio. (Misma doctrina que `migration.m50-no-default.spec.ts`: el texto ve la FORMA.)
 */
const MIG_DIR = join(__dirname, '..', 'prisma', 'migrations');
const MIG = '20260917130000_perf_catalog_inventory_read_index';
const SCHEMA = readFileSync(join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');

const rawSql = readFileSync(join(MIG_DIR, MIG, 'migration.sql'), 'utf8');
/** Solo las sentencias, sin los comentarios `--` (que explican, no ejecutan). */
const sentencias = rawSql
  .split('\n')
  .filter((l) => !l.trimStart().startsWith('--'))
  .join('\n')
  .trim();

const INDEX_NAME = 'InventoryItem_ownerType_status_createdAt_idx';

describe('PERF-CATALOG — índice de "Compra" money-safe (velocidad sí, resultado no)', () => {
  describe('⭐⭐ la migración es SOLO un índice ⇒ no puede cambiar ítems, orden ni precios', () => {
    it('⭐ la ÚNICA sentencia de la migración es el `CREATE INDEX` esperado', () => {
      const stmts = (sentencias.match(/[^;]+;/g) ?? []).map((s) => s.replace(/\s+/g, ' ').trim());
      expect(stmts).toEqual([
        `CREATE INDEX "${INDEX_NAME}" ON "InventoryItem"("ownerType", "status", "createdAt" DESC);`,
      ]);
    });

    it('⛔ no hay NINGUNA sentencia que escriba o borre datos (money-safe por construcción)', () => {
      // Un índice cambia el plan, jamás el resultado. Estas formas SÍ lo cambiarían:
      expect(sentencias).not.toMatch(/\bUPDATE\b/i);
      expect(sentencias).not.toMatch(/\bINSERT\b/i);
      expect(sentencias).not.toMatch(/\bDELETE\b/i);
      expect(sentencias).not.toMatch(/\bTRUNCATE\b/i);
      expect(sentencias).not.toMatch(/\bALTER\s+TABLE\b/i);
      expect(sentencias).not.toMatch(/DROP\s+(TABLE|COLUMN|INDEX)/i);
    });

    it('⛔ es aditiva: `CREATE INDEX` sin `UNIQUE` (un único no aditivo podría rechazar filas)', () => {
      // Un índice ÚNICO puede FALLAR el deploy si hay duplicados y cambia la semántica de escritura.
      // Éste es un índice de LECTURA puro, no una restricción.
      expect(sentencias).toMatch(/CREATE\s+INDEX/i);
      expect(sentencias).not.toMatch(/CREATE\s+UNIQUE\s+INDEX/i);
    });
  });

  describe('⭐ candado de paridad — el schema DECLARA el índice (y con las columnas medidas)', () => {
    it('el schema tiene `@@index([ownerType, status, createdAt(sort: Desc)])` en InventoryItem', () => {
      // Sin esto, `prisma migrate dev` querría revertir el índice y `migrate deploy` no lo
      // recrearía en un entorno limpio: la mejora se perdería sin que nadie se enterase.
      expect(SCHEMA).toMatch(/@@index\(\[ownerType,\s*status,\s*createdAt\(sort:\s*Desc\)\]\)/);
    });

    it('⛔ el ORDEN de columnas es exactamente (ownerType, status, createdAt DESC) — no otro', () => {
      // Contra-candado: reordenar las columnas (p.ej. `createdAt` primero) rompería el plan que
      // se midió (el prefijo `(ownerType,status)` es el que sirve el filtro y a `facets`). Si
      // alguien reordena, este test lo obliga a re-medir.
      const [stmt] = sentencias.match(/CREATE INDEX[^;]+;/i) ?? [];
      expect(stmt).toBeDefined();
      const cols = (stmt as string).match(/\(([^)]*)\)\s*;?\s*$/);
      expect(cols?.[1].replace(/\s+/g, ' ').trim()).toBe('"ownerType", "status", "createdAt" DESC');
    });
  });

  describe('⛔ el índice vive SOLO en esta migración (nadie lo duplicó ni lo borró en otra)', () => {
    it('ninguna otra migración menciona el índice', () => {
      const otras = readdirSync(MIG_DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory() && d.name !== MIG)
        .map((d) => d.name)
        .filter((n) => new RegExp(INDEX_NAME).test(readFileSync(join(MIG_DIR, n, 'migration.sql'), 'utf8')));
      expect(otras).toEqual([]);
    });
  });
});
