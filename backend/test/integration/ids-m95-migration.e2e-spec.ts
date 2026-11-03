/**
 * ids-m95-migration.e2e-spec.ts — 💰 **IDS-B1** (v1.116⟨ids⟩, M-95, API_CONTRACT §IDS.0 I-1 y §IDS.1, criterio 512) contra
 * Postgres REAL. Propiedad: backend.
 *
 * «Lo existente no cambia»: sobre una fixture con piezas, filas del día (`ListingPrice`) y un pedido, se deshace M-95b con la
 * reversa de su cabecera (estado ANTERIOR a la migración), se toma la foto, se aplica el TEXTO de M-95b y se compara:
 * `unitPriceCents`, `variantKey`, totales del pedido y `cardSnapshot` idénticos; toda pieza y toda línea `en` sin liga.
 * Además: el CHECK `stampType ⇔ stamped` muerde, el seed del dial es 75 y la migración es idempotente.
 *
 * Todo corre en UNA transacción que SIEMPRE se deshace: la BD compartida queda como estaba. Determinista (N=1).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';

jest.setTimeout(60_000);

const MIGRATIONS = join(__dirname, '..', '..', 'prisma', 'migrations');
const dirOf = (re: RegExp) => readdirSync(MIGRATIONS).find((d) => re.test(d));
const M95A_DIR = dirOf(/_m95a_ids_stamped_kind$/);
const M95B_DIR = dirOf(/_m95b_ids_versions$/);
const M95B = M95B_DIR ? readFileSync(join(MIGRATIONS, M95B_DIR, 'migration.sql'), 'utf8') : '';
const ROLLBACK = Symbol('rollback');

/** Parte un SQL en sentencias respetando los bloques `$$ … $$` (los `DO` llevan `;` dentro) y quitando comentarios. */
function statements(sql: string): string[] {
  const code = sql.replace(/^\s*--.*$/gm, '');
  const out: string[] = [];
  let cur = '';
  let inDollar = false;
  for (let i = 0; i < code.length; i++) {
    if (code.startsWith('$$', i)) {
      inDollar = !inDollar;
      cur += '$$';
      i++;
      continue;
    }
    const ch = code[i];
    if (ch === ';' && !inDollar) {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** La reversa de la cabecera de M-95b (sin el borrado de `_prisma_migrations`: la BD no se re-migra aquí). */
function reversal(sql: string): string[] {
  const head = sql.split('\n').filter((l) => l.startsWith('--   '));
  const start = head.findIndex((l) => l.includes('DROP TABLE IF EXISTS "StampedProductCandidate"'));
  const body = head
    .slice(start)
    .map((l) => l.replace(/^--\s+/, ''))
    .filter((l) => !l.includes('_prisma_migrations'))
    .join('\n');
  return statements(body);
}

describe('IDS-B1 — M-95 es aditiva: lo existente no cambia (criterio 512, I-1)', () => {
  const db = new PrismaClient();
  const run = randomUUID().slice(0, 8);

  afterAll(async () => {
    await db.$disconnect();
  });

  it('las dos migraciones existen y m95a solo añade el valor del enum', () => {
    expect(M95A_DIR).toBeDefined();
    expect(M95B_DIR).toBeDefined();
    const a = readFileSync(join(MIGRATIONS, M95A_DIR!, 'migration.sql'), 'utf8');
    expect(statements(a)).toEqual([`ALTER TYPE "CardProductKind" ADD VALUE IF NOT EXISTS 'stamped'`]);
    // Sin backfill: ningún UPDATE en m95b (los DEFAULT hacen la migración segura por construcción).
    expect(statements(M95B).some((s) => /^\s*UPDATE\b/i.test(s))).toBe(false);
  });

  it('deshacer → foto → aplicar M-95b: precios, variantKey, totales y snapshot idénticos; todo `en`; CHECK y seed', async () => {
    const outcome = await db
      .$transaction(
        async (tx) => {
          // --- fixture con el esquema vigente ---
          const set = await tx.cardSet.create({ data: { externalId: `m95-${run}`, name: `Set M95 ${run}` } });
          const card = await tx.card.create({
            data: { externalId: `m95-${run}-1`, setId: set.id, name: `Carta M95 ${run}`, number: '57', availableFinishes: ['normal', 'holofoil'] },
          });
          const runRow = await tx.listingPriceRun.create({
            data: { businessDate: new Date('2026-11-01'), trigger: 'daily', status: 'ok', scopeItemCount: 2 },
          });
          const pieces: { id: string; finish: 'normal' | 'holofoil' | 'reverse_holo' | 'first_edition_holofoil' }[] = [];
          for (const [i, finish] of (['normal', 'holofoil'] as const).entries()) {
            const p = await tx.inventoryItem.create({
              data: {
                folio: `M95-${run}-${i}`,
                cardId: card.id,
                productType: 'raw',
                rawCondition: 'NM',
                finish,
                status: 'listed',
                acquisitionType: 'compra',
              },
            });
            await tx.listingPrice.create({
              data: {
                inventoryItemId: p.id,
                variantKey: `${card.id}|raw|raw:NM|${finish}`,
                runId: runRow.id,
                status: 'priced',
                unitPriceCents: 12_300 + i,
                listPriceCents: 10_600 + i,
                ivaRatePct: 16,
                ivaTransferPct: 100,
                computedAt: new Date('2026-11-01T12:00:00Z'),
              },
            });
            pieces.push(p);
          }
          const order = await tx.order.create({
            data: { orderNumber: `M95-${run}`, status: 'settled', priceConvention: 'IVA_INCLUSIVE', guestEmail: `m95-${run}@example.test`, fulfillmentMode: 'direct_ship', shippingAddressSnapshot: { street: 'Calle 1', city: 'CDMX', postalCode: '01000' }, subtotalCents: 24_601, processingFeeCents: 100, ivaCents: 0, totalCents: 24_701 },
          });
          for (const [i, p] of pieces.entries()) {
            await tx.orderItem.create({
              data: { orderId: order.id, inventoryItemId: p.id, cardSnapshot: { name: `Carta M95 ${run}`, n: i }, unitPriceCents: 12_300 + i, finish: p.finish },
            });
          }

          // --- estado ANTERIOR: la reversa de la cabecera ---
          // Su precondición (cabecera de M-95b): sin productos `stamped`. Antes de M-95 no podía haberlos, pero esta BD sí los
          // tiene: el seed E2E trae uno (`E2E_IDS`) y otras suites crean los suyos. Se retiran DENTRO de esta transacción (se
          // deshace al final); sin esto, re-aplicar M-95b choca con su propio CHECK sobre filas que la reversa dejó sin tipo.
          // v1.116.5 (M-95c, FK Restrict): las piezas de esos productos los sueltan PRIMERO (antes de M-95 tampoco existían).
          await tx.inventoryItem.updateMany({ where: { cardProduct: { kind: 'stamped' } }, data: { cardProductId: null } });
          await tx.priceReference.deleteMany({ where: { cardProduct: { kind: 'stamped' } } });
          await tx.cardProduct.deleteMany({ where: { kind: 'stamped' } });
          for (const s of reversal(M95B)) await tx.$executeRawUnsafe(s);
          const cols = await tx.$queryRaw<{ n: bigint }[]>`
            SELECT count(*)::bigint AS n FROM information_schema.columns
            WHERE table_name IN ('InventoryItem','OrderItem') AND column_name = 'language'`;
          expect(Number(cols[0].n)).toBe(0);

          const snap = async () => ({
            lp: await tx.$queryRaw<unknown[]>`
              SELECT "inventoryItemId", "variantKey", "unitPriceCents", "listPriceCents", status::text
              FROM "ListingPrice" WHERE "inventoryItemId" IN (${Prisma.join(pieces.map((p) => p.id))}) ORDER BY "inventoryItemId"`,
            oi: await tx.$queryRaw<unknown[]>`
              SELECT "inventoryItemId", "unitPriceCents", "cardSnapshot", finish::text
              FROM "OrderItem" WHERE "orderId" = ${order.id} ORDER BY "inventoryItemId"`,
            order: await tx.$queryRaw<unknown[]>`
              SELECT "subtotalCents", "processingFeeCents", "ivaCents", "totalCents" FROM "Order" WHERE id = ${order.id}`,
            items: await tx.$queryRaw<unknown[]>`
              SELECT id, finish::text, "cardProductId", status::text FROM "InventoryItem"
              WHERE id IN (${Prisma.join(pieces.map((p) => p.id))}) ORDER BY id`,
          });
          const before = await snap();

          // --- aplicar el TEXTO de M-95b (dos veces: idempotente) ---
          for (const s of statements(M95B)) await tx.$executeRawUnsafe(s);
          for (const s of statements(M95B)) await tx.$executeRawUnsafe(s);
          const after = await snap();

          const notEn = await tx.$queryRaw<{ t: string; n: bigint }[]>`
            SELECT 'item' AS t, count(*)::bigint AS n FROM "InventoryItem" WHERE language <> 'en'
            UNION ALL SELECT 'order', count(*)::bigint FROM "OrderItem" WHERE language <> 'en' OR "stampType" IS NOT NULL OR "stampLabel" IS NOT NULL`;
          const dial = await tx.configSetting.findUnique({ where: { key: 'spanish_market_pct' } });

          // CHECK: un `stamped` sin tipo ⇒ error; un `set_base` con tipo ⇒ error.
          const checkBites = async (kind: string, stampType: string | null) => {
            await tx.$executeRawUnsafe('SAVEPOINT m95chk');
            try {
              await tx.$executeRawUnsafe(
                `INSERT INTO "CardProduct" (id, "cardId", "tcgplayerProductId", kind, name, "stampType", "updatedAt")
                 VALUES ($1, $2, $3, $4::"CardProductKind", 'x', $5::"StampType", now())`,
                randomUUID(),
                card.id,
                900_000_000 + Math.floor(Math.random() * 1e6),
                kind,
                stampType,
              );
              await tx.$executeRawUnsafe('RELEASE SAVEPOINT m95chk');
              return false;
            } catch {
              await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT m95chk');
              return true;
            }
          };
          const checks = {
            stampedWithoutType: await checkBites('stamped', null),
            baseWithType: await checkBites('set_base', 'league'),
            stampedWithType: await checkBites('stamped', 'prize_pack'),
          };
          throw Object.assign(new Error('rollback'), { [ROLLBACK]: { before, after, notEn, dial: dial?.valueJson, checks } });
        },
        { timeout: 50_000 },
      )
      .catch((e) => {
        if (e && e[ROLLBACK]) return e[ROLLBACK];
        throw e;
      });

    expect(outcome.after).toEqual(outcome.before);
    expect(outcome.before.lp).toHaveLength(2);
    expect(outcome.before.oi).toHaveLength(2);
    expect(outcome.notEn.map((r: { n: bigint }) => Number(r.n))).toEqual([0, 0]);
    expect(outcome.dial).toBe(75);
    expect(outcome.checks).toEqual({ stampedWithoutType: true, baseWithType: true, stampedWithType: false });
  });
});
