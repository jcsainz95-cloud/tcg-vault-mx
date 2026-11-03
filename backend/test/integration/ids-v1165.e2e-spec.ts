/**
 * ids-v1165.e2e-spec.ts — errata v1.116.5⟨ids⟩ contra Postgres REAL y la app por HTTP. Propiedad: backend.
 *
 *  - **IDS-B30 (M-95c, PT-IDS-3; API_CONTRACT §IDS.1, ARCHITECTURE §15.1 D-IDS-V).** `InventoryItem.cardProductId` →
 *    `CardProduct.tcgplayerProductId` `ON DELETE RESTRICT ON UPDATE RESTRICT` + índice. Borrar un `CardProduct` con piezas ⇒
 *    `23503`; el alta con un `cardProductId` inexistente sigue `422 PRODUCT_NOT_FOUND` (no 500). La reversa de la cabecera de
 *    M-95c (en una transacción que SIEMPRE se deshace) deja la tabla como `m95b`: sin la FK ni su índice, y el resto igual.
 *    Canario: sin la FK, el borrado pasa ⇒ rojo.
 *  - **IDS-B31 (D-IDS-11; API_CONTRACT §DYN.5.3 `manual_price`).** Remapear un sellado listado (y `applyToSiblings`) ⇒ corrida
 *    `manual_price` con esas piezas; tras ella la fila sale del producto NUEVO (precio y valor de mercado). Mutación: sin
 *    encolar ⇒ rojo.
 * Deterministas (N=1): el cálculo se espera con `idle()`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { E2EHarness } from './helpers/e2e-app';
import { E2E_USERS } from '../../prisma/e2e-fixtures';
import { seedE2E } from '../../prisma/seed-e2e';
import { ListingPriceService } from '../../src/modules/pricing/listing-price.service';

jest.setTimeout(120_000);

const MIGRATIONS = join(__dirname, '..', '..', 'prisma', 'migrations');
const M95C_DIR = readdirSync(MIGRATIONS).find((d) => /_m95c_ids_card_product_fk$/.test(d));
const M95C = M95C_DIR ? readFileSync(join(MIGRATIONS, M95C_DIR, 'migration.sql'), 'utf8') : '';
const FK = 'InventoryItem_cardProductId_fkey';
const IDX = 'InventoryItem_cardProductId_idx';
const ROLLBACK = Symbol('rollback');

/** Las sentencias de la cabecera «Reversa» de M-95c (sin el borrado de `_prisma_migrations`: aquí no se re-migra). */
function reversal(sql: string): string[] {
  const head = sql.split('\n');
  const start = head.findIndex((l) => /^--\s*Reversa/.test(l));
  const out: string[] = [];
  for (const l of head.slice(start + 1)) {
    if (!l.startsWith('--')) break;
    const s = l.replace(/^--\s*/, '').trim();
    if (/^(ALTER|DROP)\b/.test(s)) out.push(s.replace(/;$/, ''));
  }
  return out;
}
/** El cuerpo de M-95c (sin comentarios), sentencia por sentencia. */
function body(sql: string): string[] {
  return sql
    .replace(/^\s*--.*$/gm, '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

describe('E2E — errata v1.116.5⟨ids⟩: M-95c (IDS-B30) y remapeo del sellado (IDS-B31)', () => {
  let h: E2EHarness;
  let admin: string;
  let lp: ListingPriceService;
  const run = randomUUID().slice(0, 8);
  const pid = 700_000_000 + Math.floor(Math.random() * 90_000_000);
  let setId: string;
  let shelf: string | null;
  let seq = 0;
  const cardIds: string[] = [];
  const today = () => new Date(new Date().toISOString().slice(0, 10));
  const err = (r: { body: unknown }) => (r.body as { error: { code: string } }).error;

  async function card(): Promise<string> {
    seq += 1;
    const c = await h.prisma.card.create({
      data: { externalId: `i65-${run}-${seq}`, setId, name: `Carta V1165 ${run} ${seq}`, number: String(seq), rarity: 'Common', rarityCanonical: 'Common', availableFinishes: ['normal'] },
    });
    cardIds.push(c.id);
    return c.id;
  }
  async function item(cardId: string, data: Partial<Prisma.InventoryItemUncheckedCreateInput> = {}) {
    seq += 1;
    return h.prisma.inventoryItem.create({
      data: {
        folio: `I65-${run}-${seq}`,
        cardId,
        productType: 'raw',
        rawCondition: 'NM',
        finish: 'normal',
        ownerType: 'platform',
        status: 'listed',
        acquisitionType: 'compra',
        acquisitionCostCents: 1000,
        firstListedAt: new Date(),
        locationId: shelf,
        ...data,
      },
    });
  }
  /** Restricciones e índices de `InventoryItem` (nombre ⇒ definición), para comparar la tabla antes y después. */
  async function shape(db: Prisma.TransactionClient): Promise<Record<string, string>> {
    const cons = await db.$queryRaw<{ n: string; d: string }[]>`
      SELECT conname AS n, pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conrelid = '"InventoryItem"'::regclass`;
    const idx = await db.$queryRaw<{ n: string; d: string }[]>`
      SELECT indexname AS n, indexdef AS d FROM pg_indexes WHERE tablename = 'InventoryItem'`;
    return Object.fromEntries([...cons, ...idx].map((r) => [r.n, r.d]));
  }

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    admin = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    lp = h.app.get(ListingPriceService);
    shelf = (await h.prisma.vaultLocation.findFirst({ where: { zone: 'platform_stock', isActive: true } }))?.id ?? null;
    setId = (await h.prisma.cardSet.create({ data: { externalId: `i65-${run}`, name: `Set V1165 ${run}` } })).id;
  });

  afterAll(async () => {
    if (h) {
      jest.restoreAllMocks();
      await lp?.idle();
      // Piezas ANTES que sus productos (la FK de M-95c lo exige).
      await h.prisma.inventoryItem.deleteMany({ where: { cardId: { in: cardIds } } });
      await h.prisma.priceReference.deleteMany({ where: { cardId: { in: cardIds } } });
      await h.prisma.cardProduct.deleteMany({ where: { cardId: { in: cardIds } } });
      await h.prisma.card.deleteMany({ where: { id: { in: cardIds } } });
      await h.prisma.cardSet.deleteMany({ where: { id: setId } });
      await h.close();
    }
  });

  describe('IDS-B30 — M-95c: FK Restrict de InventoryItem.cardProductId', () => {
    it('la migración existe y la BD tiene la FK (RESTRICT/RESTRICT) y su índice', async () => {
      expect(M95C_DIR).toBeDefined();
      const s = await shape(h.prisma);
      expect(s[FK]).toBe('FOREIGN KEY ("cardProductId") REFERENCES "CardProduct"("tcgplayerProductId") ON UPDATE RESTRICT ON DELETE RESTRICT');
      expect(s[IDX]).toMatch(/btree \("cardProductId"\)/);
    });

    it('borrar un CardProduct con piezas ⇒ 23503 (y nada borrado); sin piezas ⇒ se borra', async () => {
      const cid = await card();
      const cp = await h.prisma.cardProduct.create({
        data: { cardId: cid, tcgplayerProductId: pid, kind: 'stamped', name: `Liga ${run}`, finishes: ['normal'], stampType: 'league', stampLabel: 'League', sourceGroupId: 1539 },
      });
      const it = await item(cid, { cardProductId: pid });
      let code: string | undefined;
      try {
        await h.prisma.$executeRaw`DELETE FROM "CardProduct" WHERE id = ${cp.id}`;
      } catch (e) {
        code = (e as { meta?: { code?: string } }).meta?.code ?? String(e).match(/23503/)?.[0];
      }
      expect(code).toBe('23503');
      expect(await h.prisma.cardProduct.count({ where: { id: cp.id } })).toBe(1);
      // Cambiar el id del producto tampoco (ON UPDATE RESTRICT).
      await expect(h.prisma.cardProduct.update({ where: { id: cp.id }, data: { tcgplayerProductId: pid + 1 } })).rejects.toThrow();
      // Sin piezas, el borrado pasa.
      await h.prisma.inventoryItem.delete({ where: { id: it.id } });
      await h.prisma.cardProduct.delete({ where: { id: cp.id } });
      expect(await h.prisma.cardProduct.count({ where: { id: cp.id } })).toBe(0);
    });

    it('alta con cardProductId inexistente ⇒ 422 PRODUCT_NOT_FOUND (no 500) y nada escrito', async () => {
      const cid = await card();
      const r = await h.api('POST', '/admin/inventory/items', {
        token: admin,
        json: { cardId: cid, productType: 'raw', rawCondition: 'NM', acquisitionType: 'compra', acquisitionCostCents: 1000, cardProductId: pid + 7_777_777 },
      });
      expect([r.status, err(r)?.code]).toEqual([422, 'PRODUCT_NOT_FOUND']);
      expect(await h.prisma.inventoryItem.count({ where: { cardId: cid } })).toBe(0);
    });

    it('la reversa de la cabecera de M-95c deja InventoryItem como m95b (sin FK ni índice; el resto igual) y el cuerpo es idempotente', async () => {
      expect(M95C_DIR).toBeDefined();
      const rev = reversal(M95C);
      expect(rev.length).toBeGreaterThanOrEqual(2);
      const now = await shape(h.prisma);
      const expectedM95b = Object.fromEntries(Object.entries(now).filter(([n]) => n !== FK && n !== IDX));
      await h.prisma
        .$transaction(async (tx) => {
          for (const s of rev) await tx.$executeRawUnsafe(s);
          expect(await shape(tx)).toEqual(expectedM95b);
          // Re-aplicar el cuerpo (dos veces: idempotente) devuelve exactamente lo de ahora.
          for (const s of [...body(M95C), ...body(M95C)]) await tx.$executeRawUnsafe(s);
          expect(await shape(tx)).toEqual(now);
          throw ROLLBACK;
        })
        .catch((e) => {
          if (e !== ROLLBACK) throw e;
        });
      expect(await shape(h.prisma)).toEqual(now);
    });
  });

  describe('IDS-B31 — remapear un sellado listado ⇒ manual_price con esas piezas', () => {
    it('PUT …/mapping con applyToSiblings ⇒ corrida manual_price de la pieza y sus hermanas; la fila sale del producto nuevo', async () => {
      const cid = await card();
      const A = 800_000_000 + Math.floor(Math.random() * 90_000_000);
      const B = A + 1;
      for (const [p, cents] of [[A, 80_000], [B, 120_000]] as const) {
        await h.prisma.priceReference.create({
          data: { cardId: cid, productType: 'sealed', gradeKey: `sealed:tcg:${p}`, finish: 'normal', source: 'manual', priceMxnCents: cents, capturedDate: today(), isManualOverride: true, refKind: 'market' },
        });
      }
      const sealed = { productType: 'sealed', rawCondition: null, sealedSubtype: 'box', sealedCondition: 'mint' } as const;
      const S1 = await item(cid, { ...sealed, tcgplayerProductId: A, tcgplayerGroupId: 3000 });
      const S2 = await item(cid, { ...sealed }); // hermana sin mapeo (sin mercado ⇒ pending)
      await lp.run('manual_price', [S1.id, S2.id]);
      const r1 = await h.prisma.listingPrice.findUniqueOrThrow({ where: { inventoryItemId: S1.id } });
      expect([r1.status, r1.referenceMxnCents]).toEqual(['priced', 80_000]);
      expect((await h.prisma.listingPrice.findUniqueOrThrow({ where: { inventoryItemId: S2.id } })).status).toBe('pending');

      const enqueue = jest.spyOn(lp, 'enqueue');
      const r = await h.api('PUT', `/admin/pricing/sealed/items/${S1.id}/mapping`, {
        token: admin,
        json: { tcgplayerProductId: B, tcgplayerGroupId: 3000, applyToSiblings: true },
      });
      expect(r.status).toBe(200);
      const calls = enqueue.mock.calls.filter(([t]) => t === 'manual_price');
      enqueue.mockRestore();
      const ids = new Set(calls.flatMap(([, x]) => [...(x ?? [])]));
      expect([ids.has(S1.id), ids.has(S2.id)]).toEqual([true, true]);
      await lp.idle();
      const f1 = await h.prisma.listingPrice.findUniqueOrThrow({ where: { inventoryItemId: S1.id } });
      const f2 = await h.prisma.listingPrice.findUniqueOrThrow({ where: { inventoryItemId: S2.id } });
      expect([f1.status, f1.referenceMxnCents, f2.status, f2.referenceMxnCents]).toEqual(['priced', 120_000, 'priced', 120_000]);
      expect(f1.unitPriceCents).toBe(f2.unitPriceCents);
      expect(f1.unitPriceCents).not.toBe(r1.unitPriceCents);
    });

    it('desmapear (null) ⇒ manual_price de la pieza: su fila pasa a pending', async () => {
      const cid = await card();
      const A = 800_000_000 + Math.floor(Math.random() * 90_000_000);
      await h.prisma.priceReference.create({
        data: { cardId: cid, productType: 'sealed', gradeKey: `sealed:tcg:${A}`, finish: 'normal', source: 'manual', priceMxnCents: 80_000, capturedDate: today(), isManualOverride: true, refKind: 'market' },
      });
      const S = await item(cid, { productType: 'sealed', rawCondition: null, sealedSubtype: 'box', sealedCondition: 'mint', tcgplayerProductId: A, tcgplayerGroupId: 3000 });
      await lp.run('manual_price', [S.id]);
      expect((await h.prisma.listingPrice.findUniqueOrThrow({ where: { inventoryItemId: S.id } })).status).toBe('priced');
      const r = await h.api('PUT', `/admin/pricing/sealed/items/${S.id}/mapping`, { token: admin, json: { tcgplayerProductId: null } });
      expect(r.status).toBe(200);
      await lp.idle();
      expect((await h.prisma.listingPrice.findUniqueOrThrow({ where: { inventoryItemId: S.id } })).status).toBe('pending');
    });
  });
});
