import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * M-60 — portada del deck en `MetaDeckList` (rev `decks-portada`, ARCHITECTURE §12.4.3,
 * API_CONTRACT §13 «Portada del deck»). Migración ADITIVA escrita a mano: 4 columnas nullable + FK
 * `coverCardId → Card.id ON DELETE SET NULL`. ⛔ Sin backfill, sin default, sin índice, sin enum nuevo
 * (reusa `MetaMatchStatus`). Se verifica como TEXTO (misma doctrina que `migration.perf-catalog-index`):
 * la forma de la migración es la garantía de que no toca filas existentes. Y paridad con el schema.
 */
const MIG_DIR = join(__dirname, '..', 'prisma', 'migrations');
const MIG = '20260928120000_m60_meta_deck_list_cover';
const SQL_PATH = join(MIG_DIR, MIG, 'migration.sql');
const SCHEMA = readFileSync(join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');

function readSql(): string {
  if (!existsSync(SQL_PATH)) throw new Error(`falta la migración ${MIG}`);
  return readFileSync(SQL_PATH, 'utf8');
}
const statements = (): string[] =>
  (readSql()
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n')
    .match(/[^;]+;/g) ?? []
  ).map((s) => s.replace(/\s+/g, ' ').trim());

function model(name: string): string {
  const m = new RegExp(`\\nmodel ${name} \\{([\\s\\S]*?)\\n\\}`).exec(SCHEMA);
  if (!m) throw new Error(`no encuentro model ${name}`);
  return m[1];
}

describe('M-60 · MetaDeckList gana la portada (aditiva, sin backfill)', () => {
  it('las ÚNICAS sentencias son las 4 columnas nullable + la FK ON DELETE SET NULL', () => {
    expect(statements()).toEqual([
      'ALTER TABLE "MetaDeckList" ADD COLUMN "coverSetCode" TEXT, ADD COLUMN "coverNumber" TEXT, ADD COLUMN "coverMatchStatus" "MetaMatchStatus", ADD COLUMN "coverCardId" TEXT;',
      'ALTER TABLE "MetaDeckList" ADD CONSTRAINT "MetaDeckList_coverCardId_fkey" FOREIGN KEY ("coverCardId") REFERENCES "Card"("id") ON DELETE SET NULL ON UPDATE CASCADE;',
    ]);
  });

  it('⛔ no escribe filas, no pone default ni NOT NULL, no crea índice ni enum, no borra nada', () => {
    const sql = statements().join('\n');
    // (`ON UPDATE CASCADE` de la FK no es una escritura: se buscan SENTENCIAS de escritura.)
    expect(sql).not.toMatch(/(^|;\s*)UPDATE\s+"/im);
    expect(sql).not.toMatch(/\bINSERT\s+INTO\b|\bDELETE\s+FROM\b|\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/\bDEFAULT\b/i);
    expect(sql).not.toMatch(/NOT NULL/i);
    expect(sql).not.toMatch(/CREATE\s+(UNIQUE\s+)?INDEX/i);
    expect(sql).not.toMatch(/CREATE\s+TYPE/i);
    expect(sql).not.toMatch(/\bDROP\b/i);
  });

  it('el rollback está documentado en la cabecera de la migración', () => {
    const sql = readSql();
    expect(sql).toMatch(/ROLLBACK/);
    expect(sql).toMatch(/DROP CONSTRAINT "MetaDeckList_coverCardId_fkey"/);
    expect(sql).toMatch(/DROP COLUMN "coverCardId"/);
  });

  it('paridad con schema.prisma: 4 campos opcionales + relación nombrada con onDelete: SetNull y su inversa en Card', () => {
    const list = model('MetaDeckList');
    expect(list).toMatch(/\n\s*coverSetCode\s+String\?/);
    expect(list).toMatch(/\n\s*coverNumber\s+String\?/);
    expect(list).toMatch(/\n\s*coverMatchStatus\s+MetaMatchStatus\?/);
    expect(list).toMatch(/\n\s*coverCardId\s+String\?/);
    expect(list).toMatch(/\n\s*coverCard\s+Card\?\s+@relation\("MetaDeckListCover", fields: \[coverCardId\], references: \[id\], onDelete: SetNull\)/);
    expect(list).not.toMatch(/@@index\(\[coverCardId/);
    expect(model('Card')).toMatch(/\n\s*metaDeckListCovers\s+MetaDeckList\[\]\s+@relation\("MetaDeckListCover"\)/);
  });
});
