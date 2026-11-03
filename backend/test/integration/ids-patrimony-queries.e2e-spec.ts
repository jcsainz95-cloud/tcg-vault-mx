/**
 * ids-patrimony-queries.e2e-spec.ts — IDS-B26 (API_CONTRACT §IDS.9, v1.116.4; D-IDS-R «por lote») contra Postgres REAL.
 * Propiedad: backend. `holdings` con 2 y con 20 piezas `es` / de liga / promo hace el MISMO número de consultas: la puerta
 * (`PatrimonyValuationService.valuePieces`) se llama UNA vez por petición y cada lectura suya es ≤ 1 sin importar N.
 *
 * Contador: eventos `query` del cliente Prisma (SQL emitido), con un `PrismaService` propio con `log: query` (el de la app no
 * emite eventos). Calentamiento previo: las lecturas con caché (dial X, FX) no se cuentan en ninguna de las dos mediciones.
 * Determinista (N=1).
 */
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { PrismaService } from '../../src/prisma/prisma.service';
import { VaultService } from '../../src/modules/vault/vault.service';

jest.setTimeout(180_000);

describe('IDS-B26 — `holdings` sin N+1: 2 y 20 piezas `es`/liga/promo ⇒ mismas consultas', () => {
  let h: E2EHarness;
  let queries = 0;
  const run = randomUUID().slice(0, 8);
  const base = 400_000_000 + Math.floor(Math.random() * 90_000_000);
  let setId: string;
  let cardId: string;
  const users: string[] = [];

  beforeAll(async () => {
    const counting = new PrismaService({ log: [{ emit: 'event', level: 'query' }] } as never);
    (counting as unknown as { $on: (e: 'query', cb: () => void) => void }).$on('query', () => {
      queries += 1;
    });
    h = await E2EHarness.create((b) => b.overrideProvider(PrismaService).useValue(counting));
    await seedE2E(h.prisma);
    setId = (await h.prisma.cardSet.create({ data: { externalId: `idn-${run}`, name: `Set N1 ${run}` } })).id;
    cardId = (await h.prisma.card.create({ data: { externalId: `idn-${run}-1`, setId, name: `Carta N1 ${run}`, number: '1', rarity: 'Common', availableFinishes: ['normal'] } })).id;
    await h.prisma.priceReference.create({
      data: { cardId, productType: 'raw', gradeKey: 'raw:NM', finish: 'normal', source: 'manual', priceMxnCents: 40_000, capturedDate: new Date(new Date().toISOString().slice(0, 10)), isManualOverride: true, refKind: 'market' },
    });
    const cp = await h.prisma.cardProduct.create({
      data: { cardId, tcgplayerProductId: base, kind: 'stamped', name: `Liga ${run}`, finishes: ['normal'], stampType: 'league', sourceGroupId: 1539 },
    });
    await h.prisma.priceReference.create({
      data: { cardId, productType: 'raw', gradeKey: 'raw:NM', finish: 'normal', source: 'manual', cardProductId: cp.id, priceMxnCents: 90_000, capturedDate: new Date(new Date().toISOString().slice(0, 10)), isManualOverride: true, refKind: 'market' },
    });
    await h.prisma.cardProduct.create({ data: { cardId, tcgplayerProductId: base + 1, kind: 'promo', name: `Promo ${run}`, finishes: ['normal'] } });
  });

  afterAll(async () => {
    if (h) {
      await h.prisma.inventoryItem.deleteMany({ where: { ownerUserId: { in: users } } });
      await h.prisma.priceReference.deleteMany({ where: { cardId } });
      await h.prisma.cardProduct.deleteMany({ where: { cardId } });
      await h.prisma.card.deleteMany({ where: { id: cardId } });
      await h.prisma.cardSet.deleteMany({ where: { id: setId } });
      await h.prisma.user.deleteMany({ where: { id: { in: users } } });
      await h.close();
    }
  });

  /** Un cliente con `n` piezas que rotan entre (es, null), (en, liga), (es, liga) y promo. */
  async function customerWith(n: number): Promise<string> {
    const u = await h.prisma.user.create({ data: { email: `idn.${run}.${users.length}@e2e.local`, name: 'Cliente N1', role: 'customer' } });
    users.push(u.id);
    const kinds: Partial<Prisma.InventoryItemUncheckedCreateInput>[] = [
      { language: 'es' },
      { cardProductId: base },
      { language: 'es', cardProductId: base },
      { cardProductId: base + 1 },
    ];
    for (let i = 0; i < n; i++) {
      await h.prisma.inventoryItem.create({
        data: {
          folio: `IDN-${run}-${users.length}-${String(i).padStart(3, '0')}`,
          cardId,
          productType: 'raw',
          rawCondition: 'NM',
          finish: 'normal',
          acquisitionType: 'compra',
          ownerType: 'customer',
          ownerUserId: u.id,
          ownershipStatus: 'settled',
          status: 'in_custody',
          ...kinds[i % kinds.length],
        } as Prisma.InventoryItemUncheckedCreateInput,
      });
    }
    return u.id;
  }

  async function countHoldings(userId: string): Promise<number> {
    const vault = h.app.get(VaultService);
    queries = 0;
    const r = (await vault.holdings(userId)) as unknown as { data: unknown[] };
    const n = queries;
    expect(r.data.length).toBeGreaterThan(0);
    return n;
  }

  it('mismo número de consultas Prisma con 2 y con 20 piezas', async () => {
    const two = await customerWith(2);
    const twenty = await customerWith(20);
    await countHoldings(await customerWith(4)); // calentamiento (cachés de dial y FX)
    const q2 = await countHoldings(two);
    const q20 = await countHoldings(twenty);
    expect({ q2, q20 }).toEqual({ q2, q20: q2 });
  });
});
