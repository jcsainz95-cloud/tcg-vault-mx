/**
 * ids-stamped-ingest.e2e-spec.ts — 💰 **IDS-B7** (v1.116⟨ids⟩, API_CONTRACT §IDS.3/.4, criterios 522, 523, 960, 962) contra Postgres
 * REAL. Propiedad: backend. Fixture TCGCSV (el egress a tcgcsv.com está vetado en CI):
 *  - `648703` «Pikachu ex - 057/191» de 22880 ⇒ `CardProduct stamped` de la carta del set_base `590025`, con precio;
 *  - energía básica 010 en DOS sets ⇒ 2 candidatas, 0 colgadas; `attach` ⇒ colgada y candidatas borradas; 2.º ⇒ 409;
 *  - 1539 con sufijo desconocido ⇒ sin producto;
 *  - un producto colgado no se re-cuelga; en TODO el caso: cero `PendingPriceEntry` y cero correos/avisos.
 * Deterministas (N=1).
 */
import { randomUUID } from 'crypto';
import { E2EHarness } from './helpers/e2e-app';
import { E2E_USERS } from '../../prisma/e2e-fixtures';
import { seedE2E } from '../../prisma/seed-e2e';
import { StampedIngestService } from '../../src/modules/pricing/stamped-ingest.service';

jest.setTimeout(120_000);

describe('E2E — IDS-B7 productos de liga: ingesta, empate y attach (sin cola)', () => {
  let h: E2EHarness;
  let admin: string;
  let svc: StampedIngestService;
  const run = randomUUID().slice(0, 8);
  // Ids de producto únicos por corrida (la `@unique` es global): base 590025 y liga 648703 «desplazados».
  const off = 100_000_000 + Math.floor(Math.random() * 800_000_000);
  const P = { base: off + 590025, liga: off + 648703, energyA: off + 1, energyB: off + 2, energyLiga: off + 3, raro: off + 4, lone: off + 5, loneLiga: off + 6 };
  const setIds: string[] = [];
  const cardIds: string[] = [];
  const fx = { rate: 20, bufferPct: 0 };
  let pikachu: string;
  let energyA: string;
  let energyB: string;

  async function catalogCard(setExt: string, printedTotal: number, number: string, name: string, productId: number, productName: string) {
    let set = await h.prisma.cardSet.findUnique({ where: { externalId: setExt } });
    if (!set) {
      set = await h.prisma.cardSet.create({ data: { externalId: setExt, name: `Set ${setExt}`, printedTotal } });
      setIds.push(set.id);
    }
    const c = await h.prisma.card.create({ data: { externalId: `${setExt}-${number}`, setId: set.id, name, number, availableFinishes: ['normal', 'holofoil'] } });
    cardIds.push(c.id);
    await h.prisma.cardProduct.create({ data: { cardId: c.id, tcgplayerProductId: productId, kind: 'set_base', name: productName, finishes: ['holofoil'] } });
    return c.id;
  }

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    admin = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    svc = h.app.get(StampedIngestService);
    pikachu = await catalogCard(`ssp-${run}`, 191, '57', `Pikachu ex ${run}`, P.base, `Pikachu ex ${run} - 057/191`);
    // Las energías: nombre del catálogo SIN total ⇒ la llave sale de Card.number/printedTotal (v1.116.2) = «10/16» en los dos sets.
    energyA = await catalogCard(`sve-${run}`, 16, '10', `Basic Fire Energy ${run}`, P.energyA, `Basic Fire Energy ${run} - 010`);
    energyB = await catalogCard(`mee-${run}`, 16, '10', `Basic Fire Energy ${run}`, P.energyB, `Basic Fire Energy ${run} - 010`);
    // Una carta cuyo producto de liga trae número SIN total: ⛔ nunca empata (v1.116.2, IDS-B7).
    await catalogCard(`ssp-${run}`, 191, '33', `Lone ${run}`, P.lone, `Lone ${run} - 033`);
  });

  afterAll(async () => {
    if (h) {
      await h.prisma.stampedProductCandidate.deleteMany({ where: { cardId: { in: cardIds } } });
      await h.prisma.priceReference.deleteMany({ where: { cardId: { in: cardIds } } });
      await h.prisma.cardProduct.deleteMany({ where: { cardId: { in: cardIds } } });
      await h.prisma.card.deleteMany({ where: { id: { in: cardIds } } });
      await h.prisma.cardSet.deleteMany({ where: { id: { in: setIds } } });
      await h.close();
    }
  });

  it('22880: empate único ⇒ colgado con precio; ambiguo ⇒ candidatas; 1539 sin tipo ⇒ nada; cero cola/avisos', async () => {
    const pendingBefore = await h.prisma.pendingPriceEntry.count();
    const outboxBefore = await h.prisma.auditLog.count({ where: { action: { contains: 'mail' } } });
    const index = await svc.buildCatalogIndex();
    const g22880 = await svc.ingestGroup(
      22880,
      [
        { productId: P.liga, name: `Pikachu ex ${run} - 057/191`, number: '057/191' },
        { productId: P.energyLiga, name: `Basic Fire Energy ${run} - 010/016`, number: '010/016' },
        { productId: P.loneLiga, name: `Lone ${run} - 033`, number: '033' },
        { productId: off + 9, name: 'Play! Pokemon Prize Pack Series One', number: null },
      ],
      [
        { productId: P.liga, subTypeName: 'Holofoil', marketPrice: 26.39 },
        { productId: P.energyLiga, subTypeName: 'Holofoil', marketPrice: 0.5 },
        { productId: P.loneLiga, subTypeName: 'Holofoil', marketPrice: 2 },
      ],
      index,
      fx,
    );
    expect(g22880.log).toMatchObject({ grupo: 22880, colgados: 1, ambiguos: 1, sinPareja: 1, sinTipo: 0, sinNumero: 1, conPrecio: 1 });
    expect(await h.prisma.cardProduct.findUnique({ where: { tcgplayerProductId: P.loneLiga } })).toBeNull();
    // Número sin total (v1.116.2; DEVOPS_NOTES §108.1) ⇒ sinPareja: ni colgado NI candidatas. La ambigüedad de la energía se
    // prueba arriba con números CON total («010/016»), que es lo único que hoy llega a ser candidata.
    expect(await h.prisma.stampedProductCandidate.count({ where: { tcgplayerProductId: P.loneLiga } })).toBe(0);
    const cp = await h.prisma.cardProduct.findUniqueOrThrow({ where: { tcgplayerProductId: P.liga } });
    expect(cp).toMatchObject({ cardId: pikachu, kind: 'stamped', stampType: 'prize_pack', stampLabel: null, sourceGroupId: 22880, finishes: ['holofoil'] });
    const ref = await h.prisma.priceReference.findFirst({ where: { cardProductId: cp.id } });
    expect(ref).toMatchObject({ source: 'tcgcsv_singles', priceUsdCents: 2639, finish: 'holofoil', productType: 'raw', gradeKey: 'raw:NM' });
    const cands = await h.prisma.stampedProductCandidate.findMany({ where: { tcgplayerProductId: P.energyLiga }, orderBy: { cardId: 'asc' } });
    expect(cands.map((c) => c.cardId).sort()).toEqual([energyA, energyB].sort());
    expect(await h.prisma.cardProduct.findUnique({ where: { tcgplayerProductId: P.energyLiga } })).toBeNull();

    const g1539 = await svc.ingestGroup(
      1539,
      [{ productId: P.raro, name: `Pikachu ex ${run} - 057/191 (Winner)`, number: '057/191' }],
      [{ productId: P.raro, subTypeName: 'Holofoil', marketPrice: 99 }],
      index,
      fx,
    );
    expect(g1539.log).toMatchObject({ colgados: 0, sinTipo: 1 });
    expect(await h.prisma.cardProduct.findUnique({ where: { tcgplayerProductId: P.raro } })).toBeNull();

    // Un colgado no se re-cuelga aunque otra corrida lo viera de otra forma.
    await svc.ingestGroup(22880, [{ productId: P.liga, name: `Pikachu ex ${run} - 057/191`, number: '057/191' }], [], new Map(), fx);
    expect((await h.prisma.cardProduct.findUniqueOrThrow({ where: { tcgplayerProductId: P.liga } })).cardId).toBe(pikachu);

    expect(await h.prisma.pendingPriceEntry.count()).toBe(pendingBefore);
    expect(await h.prisma.auditLog.count({ where: { action: { contains: 'mail' } } })).toBe(outboxBefore);
  });

  it('attach: sin candidata ⇒ 404; elige la carta ⇒ colgado y candidatas borradas; segundo attach ⇒ 409', async () => {
    const nf = await h.api('POST', `/admin/inventory/stamped-candidates/${P.energyLiga}/attach`, { token: admin, json: { cardId: pikachu } });
    expect(nf.status).toBe(404);
    const ok = await h.api<{ combos: unknown[]; candidates: unknown[] }>('POST', `/admin/inventory/stamped-candidates/${P.energyLiga}/attach`, {
      token: admin,
      json: { cardId: energyA },
    });
    expect(ok.status).toBe(200);
    expect(Array.isArray(ok.body.combos)).toBe(true);
    expect(await h.prisma.stampedProductCandidate.count({ where: { tcgplayerProductId: P.energyLiga } })).toBe(0);
    expect(await h.prisma.cardProduct.findUniqueOrThrow({ where: { tcgplayerProductId: P.energyLiga } })).toMatchObject({ cardId: energyA, kind: 'stamped' });
    const audit = await h.prisma.auditLog.findFirst({ where: { action: 'inventory.stamped_attach' }, orderBy: { createdAt: 'desc' } });
    expect(audit).not.toBeNull();
    const again = await h.api<{ error: { code: string } }>('POST', `/admin/inventory/stamped-candidates/${P.energyLiga}/attach`, { token: admin, json: { cardId: energyB } });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('STAMPED_PRODUCT_TAKEN');
  });
});
