import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * ⭐⭐ DECKS-META Fase 0 — la migración de LEGALIDAD, verificada como TEXTO (money-safe canary).
 *
 * (Misma doctrina que `migration.perf-catalog-index.spec.ts` / `migration.m50-no-default.spec.ts`:
 * el texto ve la FORMA de la migración.) El encargo Fase 0 autoriza AÑADIR procedencia de
 * legalidad al catálogo, y ⛔ **prohíbe** tocar datos existentes. La garantía money-safe se reduce
 * a hechos comprobables sobre la forma de la migración:
 *   1. sólo `ADD COLUMN` NULLABLE (x2), un `CREATE INDEX` de lectura, y un seed de config IDEMPOTENTE;
 *   2. NADA de `UPDATE`/`DELETE`/`TRUNCATE`/`DROP`, ningún `NOT NULL`/`DEFAULT` (⇒ no reescribe la tabla);
 *   3. el único `INSERT` toca `ConfigSetting` (config), NUNCA `Card` (datos).
 * Si la migración cumple esto, no puede mover un precio, borrar una fila ni bloquear la tabla.
 * La mitad «candado» es la paridad con el schema: si el `@@index`/columnas desaparecen del schema,
 * `migrate deploy` dejaría de declararlos y se perderían en silencio en un entorno nuevo.
 */
const MIG_DIR = join(__dirname, '..', 'prisma', 'migrations');
const MIG = '20260919120000_decks_meta_f0_legality';
const SCHEMA = readFileSync(join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');

const rawSql = readFileSync(join(MIG_DIR, MIG, 'migration.sql'), 'utf8');
/** Sólo las sentencias, sin los comentarios `--` (que explican, no ejecutan). */
const sentencias = rawSql
  .split('\n')
  .filter((l) => !l.trimStart().startsWith('--'))
  .join('\n')
  .trim();
const stmts = (sentencias.match(/[^;]+;/g) ?? []).map((s) => s.replace(/\s+/g, ' ').trim());

const INDEX_NAME = 'Card_regulationMark_idx';

describe('DECKS-META F0 — migración de legalidad ADITIVA y money-safe (añade sí, reescribe no)', () => {
  describe('⭐⭐ la migración es SOLO ADD COLUMN nullable + índice + seed de config idempotente', () => {
    it('⭐ las sentencias son EXACTAMENTE las cuatro esperadas, en orden', () => {
      expect(stmts).toEqual([
        `ALTER TABLE "Card" ADD COLUMN "regulationMark" TEXT;`,
        `ALTER TABLE "Card" ADD COLUMN "legalStandardRaw" TEXT;`,
        `CREATE INDEX "${INDEX_NAME}" ON "Card"("regulationMark");`,
        `INSERT INTO "ConfigSetting" ("key", "valueJson", "updatedBy", "updatedAt") VALUES ` +
          `('standard.active_regulation_marks', '["G","H","I"]'::jsonb, 'migration:decks-meta-f0', NOW()), ` +
          `('standard.banlist_card_ids', '[]'::jsonb, 'migration:decks-meta-f0', NOW()) ` +
          `ON CONFLICT ("key") DO NOTHING;`,
      ]);
    });

    it('⛔ ninguna sentencia reescribe o borra datos existentes (money-safe por construcción)', () => {
      expect(sentencias).not.toMatch(/\bUPDATE\b/i);
      expect(sentencias).not.toMatch(/\bDELETE\b/i);
      expect(sentencias).not.toMatch(/\bTRUNCATE\b/i);
      expect(sentencias).not.toMatch(/DROP\s+(TABLE|COLUMN|INDEX)/i);
    });

    it('⛔ las columnas son NULLABLE puras: sin NOT NULL y sin DEFAULT (⇒ ADD COLUMN no reescribe la tabla)', () => {
      // Un `ADD COLUMN ... NOT NULL` o `... DEFAULT <x>` fuerza reescritura/backfill y bloqueo.
      // Aquí ambas son TEXT nullable sin default: metadata-only, instantáneo en Postgres.
      const adds = stmts.filter((s) => /ALTER TABLE "Card" ADD COLUMN/i.test(s));
      expect(adds).toHaveLength(2);
      for (const a of adds) {
        expect(a).not.toMatch(/NOT\s+NULL/i);
        expect(a).not.toMatch(/DEFAULT/i);
        expect(a).toMatch(/\bTEXT\b/i);
      }
    });

    it('⛔ el índice es de LECTURA (no UNIQUE): no puede rechazar filas ni cambiar la semántica de escritura', () => {
      expect(sentencias).toMatch(/CREATE\s+INDEX/i);
      expect(sentencias).not.toMatch(/CREATE\s+UNIQUE\s+INDEX/i);
    });

    it('⛔ el único INSERT toca ConfigSetting (config), NUNCA "Card" (datos), y es IDEMPOTENTE', () => {
      const inserts = stmts.filter((s) => /^INSERT\s+INTO/i.test(s));
      expect(inserts).toHaveLength(1);
      expect(inserts[0]).toMatch(/INSERT\s+INTO\s+"ConfigSetting"/i);
      expect(inserts[0]).not.toMatch(/INSERT\s+INTO\s+"Card"/i);
      // Idempotente: re-correr el seed nunca pisa una ventana que el operador ya eligió.
      expect(inserts[0]).toMatch(/ON\s+CONFLICT\s*\("key"\)\s+DO\s+NOTHING/i);
    });

    it('siembra las DOS claves de config exactas de la ventana de legalidad (§2.3)', () => {
      expect(sentencias).toMatch(/'standard\.active_regulation_marks'/);
      expect(sentencias).toMatch(/'standard\.banlist_card_ids'/);
    });
  });

  describe('⭐ candado de paridad — el schema DECLARA las columnas y el índice', () => {
    it('el schema tiene `regulationMark String?` y `legalStandardRaw String?` en Card', () => {
      expect(SCHEMA).toMatch(/regulationMark\s+String\?/);
      expect(SCHEMA).toMatch(/legalStandardRaw\s+String\?/);
    });

    it('el schema tiene `@@index([regulationMark])`', () => {
      expect(SCHEMA).toMatch(/@@index\(\[regulationMark\]\)/);
    });
  });

  describe('⛔ estas columnas/índice viven SOLO en esta migración (nadie los duplicó ni borró en otra)', () => {
    it('ninguna otra migración menciona el índice ni las columnas de legalidad', () => {
      const otras = readdirSync(MIG_DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory() && d.name !== MIG)
        .map((d) => d.name)
        .filter((n) =>
          /Card_regulationMark_idx|"regulationMark"|"legalStandardRaw"/.test(
            readFileSync(join(MIG_DIR, n, 'migration.sql'), 'utf8'),
          ),
        );
      expect(otras).toEqual([]);
    });
  });
});
