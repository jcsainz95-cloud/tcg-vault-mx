/**
 * ids-v1168.e2e-spec.ts — v1.116.8⟨ids⟩ (API_CONTRACT §IDS.9 IDS-B32; §IDS I-6 «Acabado del alta» y «Piezas del cajón», A2)
 * contra Postgres REAL y la app por HTTP. Propiedad: backend. Sin cambio de código: fija lo ya construido
 * (`resolveFinish(dto, version.stamp?.finishes ?? card.availableFinishes)`, `inventory.service.ts`). Determinista (N=1).
 *
 * Sobre la semilla E2E: «E2E League Bird» (`E2E_CARDS.league`, `availableFinishes=['normal']`) y su producto de liga `P`
 * (`E2E_IDS.stamped`, League Cup `620000001`, `finishes=['holofoil']`, referencia propia MX$120 frente a MX$200 de la carta).
 *
 *  - Lote `POST /admin/inventory/items/batch`: `{finish:'holofoil', cardProductId:P}` crea la pieza con ese acabado, `language`
 *    y `cardProductId` correctos; `{finish:'normal', cardProductId:P}` y `{finish:'holofoil'}` sin `P` ⇒ `FINISH_NOT_AVAILABLE`
 *    por línea (las demás líneas siguen). Se publica por `bulk-publish` y, tras la corrida, la fila del día queda `priced`
 *    con `variantKey` `…|holofoil|v:<versión>` y la referencia de `P` (en inglés; en español la exhibida es `null`, IDS-B15).
 *  - Lectura del cajón (A2, segunda lectura): `GET /admin/inventory/items?cardId&productType=raw&ownerType=platform&stamped=true`
 *    SIN `finish` devuelve la pieza con su `version`; la lectura de hoy con `finish=normal` no la trae.
 *  - El conteo de la casilla `normal` del binder (`GET /admin/inventory/master-sets/:setId`) no cambia.
 *
 * Mutación: `resolveFinish` siempre contra `Card.availableFinishes` ⇒ rojo (las dos líneas buenas caen a FINISH_NOT_AVAILABLE).
 */
import { randomUUID } from 'crypto';
import { E2EHarness } from './helpers/e2e-app';
import { E2E_CARDS, E2E_IDS, E2E_SET, E2E_USERS } from '../../prisma/e2e-fixtures';
import { seedE2E } from '../../prisma/seed-e2e';
import { scaleByPct } from '../../src/common/card-version';
import { ListingPriceService } from '../../src/modules/pricing/listing-price.service';

jest.setTimeout(120_000);

type BatchLine = { index: number; ok: boolean; inventoryItemIds?: string[]; error?: { code: string } };
type BatchBody = { summary: { requested: number; createdItems: number; failedLines: number }; results: BatchLine[] };
type ItemRow = { id: string; finish: string; language: string; version: { key: string; language: string; stamp: { productId: number } | null } };
type Cell = { cardId: string; countsByFinish: { finish: string; count: number }[]; totalCount: number };

describe('E2E — §IDS v1.116.8 (A2): IDS-B32, alta de liga por lote con el acabado de P y lectura del cajón', () => {
  let h: E2EHarness;
  let admin: string;
  let lp: ListingPriceService;
  let cardId: string;
  let setId: string;
  const P = E2E_IDS.stamped.tcgplayerProductId;
  const run = randomUUID().slice(0, 8);
  const created: string[] = [];
  const startedAt = new Date(Date.now() - 1_000);

  const line = (extra: Record<string, unknown>) => ({
    productType: 'raw',
    cardId,
    rawCondition: 'NM',
    acquisitionType: 'compra',
    acquisitionCostCents: 1_000,
    ...extra,
  });
  const leagueCell = async (): Promise<Cell> => {
    const r = await h.api<{ cells: Cell[] }>('GET', `/admin/inventory/master-sets/${setId}`, { token: admin });
    expect(r.status).toBe(200);
    const cell = r.body.cells.find((c) => c.cardId === cardId);
    expect(cell).toBeDefined();
    return cell!;
  };
  const drawerRead = async (q: string): Promise<ItemRow[]> => {
    const r = await h.api<{ data: ItemRow[] }>('GET', `/admin/inventory/items?cardId=${cardId}&productType=raw&ownerType=platform&pageSize=100${q}`, {
      token: admin,
    });
    expect(r.status).toBe(200);
    return r.body.data;
  };

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    admin = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    lp = h.app.get(ListingPriceService);
    const card = await h.prisma.card.findUniqueOrThrow({ where: { externalId: E2E_CARDS.league.externalId } });
    cardId = card.id;
    setId = card.setId;
    // Premisas de la semilla (si cambian, la prueba deja de medir lo que dice).
    expect(card.availableFinishes).toEqual(['normal']);
    const p = await h.prisma.cardProduct.findUniqueOrThrow({ where: { tcgplayerProductId: P } });
    expect([p.cardId, p.kind, p.finishes]).toEqual([cardId, 'stamped', ['holofoil']]);
    expect(await h.prisma.priceReference.count({ where: { cardProductId: p.id, finish: 'holofoil' } })).toBeGreaterThan(0);
    expect(E2E_SET.externalId).toBe((await h.prisma.cardSet.findUniqueOrThrow({ where: { id: setId } })).externalId);
  });

  afterAll(async () => {
    if (h) {
      await lp?.idle();
      // Limpieza por `created` Y por (cardId, cardProductId=P, createdAt ≥ startedAt) —no por folio—: con el código mutado el lote crea piezas que la prueba nunca llega a
      // registrar (falla antes), y quedarían en la BD para la corrida siguiente (medido: 3 sobrantes ⇒ falso rojo al restaurar).
      const mine = await h.prisma.inventoryItem.findMany({
        where: { OR: [{ id: { in: created } }, { cardId, createdAt: { gte: startedAt }, cardProductId: P }] },
        select: { id: true },
      });
      const ids = mine.map((i) => i.id);
      await h.prisma.inventoryMovement.deleteMany({ where: { itemId: { in: ids } } });
      await h.prisma.inventoryItem.deleteMany({ where: { id: { in: ids } } });
      await h.close();
    }
  });

  it('IDS-B32: lote con finish de P ⇒ crea (language/cardProductId correctos) y publica con la referencia de P; acabado fuera de P.finishes ⇒ FINISH_NOT_AVAILABLE por línea; el cajón la lee con stamped=true sin finish; la casilla normal no cambia', async () => {
    const before = await leagueCell();
    const normalBefore = before.countsByFinish.find((c) => c.finish === 'normal')?.count ?? 0;
    const stampedBefore = (await drawerRead('&stamped=true')).map((i) => i.id);

    const batch = await h.api<BatchBody>('POST', '/admin/inventory/items/batch', {
      token: admin,
      json: {
        batchKey: `ids-b32-${run}`,
        items: [
          line({ finish: 'holofoil', cardProductId: P, language: 'es' }), // 0: liga en español con el acabado de P
          line({ finish: 'normal', cardProductId: P }), // 1: liga con el acabado de la casilla, que P no tiene
          line({ finish: 'holofoil' }), // 2: sin liga, acabado que la carta no tiene
          line({ finish: 'holofoil', cardProductId: P }), // 3: liga en inglés (sin `language`)
        ],
      },
    });
    expect(batch.status).toBe(200);
    expect(batch.body.results.map((r) => r.ok)).toEqual([true, false, false, true]);
    expect(batch.body.results.map((r) => r.error?.code ?? null)).toEqual([null, 'FINISH_NOT_AVAILABLE', 'FINISH_NOT_AVAILABLE', null]);
    expect(batch.body.summary).toEqual({ requested: 4, createdItems: 2, failedLines: 2 });
    const esId = batch.body.results[0].inventoryItemIds![0];
    const enId = batch.body.results[3].inventoryItemIds![0];
    created.push(esId, enId);

    const es = await h.prisma.inventoryItem.findUniqueOrThrow({ where: { id: esId } });
    const en = await h.prisma.inventoryItem.findUniqueOrThrow({ where: { id: enId } });
    // Medido: el alta de compra con precio derivable la AUTO-publica (`listed` ya al salir del lote), como cualquier pieza
    // completa del cuerpo de hoy; `bulk-publish` sobre ella es el no-op idempotente de `PUBLISHABLE_ORIGIN_STATUSES`.
    expect([es.finish, es.language, es.cardProductId, es.listPriceCents, es.ownerType, es.status]).toEqual(['holofoil', 'es', P, null, 'platform', 'listed']);
    expect([en.finish, en.language, en.cardProductId, en.listPriceCents]).toEqual(['holofoil', 'en', P, null]);
    // La línea 1 no creó nada (acotado a esta corrida: otra suite o una corrida mutada podrían dejar piezas de P).
    expect(await h.prisma.inventoryItem.count({ where: { cardId, finish: 'normal', cardProductId: P, createdAt: { gte: startedAt } } })).toBe(0);

    // Se puede publicar (precio derivado de la versión, sin `listPriceCents`) y, tras la corrida, la fila del día es de P.
    const pub = await h.api<{ results: { ok: boolean; priceSource?: string; salePriceCents?: number; error?: { code: string } }[] }>(
      'POST',
      '/admin/inventory/items/bulk-publish',
      { token: admin, json: { batchKey: `ids-b32-pub-${run}`, items: [{ inventoryItemId: esId }, { inventoryItemId: enId }] } },
    );
    expect(pub.status).toBe(200);
    expect(pub.body.results.map((r) => [r.ok, r.error?.code ?? null])).toEqual([
      [true, null],
      [true, null],
    ]);
    expect((await h.prisma.inventoryItem.findMany({ where: { id: { in: [esId, enId] } } })).map((i) => i.status)).toEqual(['listed', 'listed']);
    await lp.idle();
    await lp.run('publish', [esId, enId]);
    const rowEs = await h.prisma.listingPrice.findUniqueOrThrow({ where: { inventoryItemId: esId } });
    const rowEn = await h.prisma.listingPrice.findUniqueOrThrow({ where: { inventoryItemId: enId } });
    expect([rowEs.status, rowEs.variantKey]).toEqual(['priced', `${cardId}|raw|raw:NM|holofoil|v:es.${P}`]);
    expect([rowEn.status, rowEn.variantKey]).toEqual(['priced', `${cardId}|raw|raw:NM|holofoil|v:en.${P}`]);
    // Inglés de liga: la referencia exhibida es la de P (MX$120), no la de la carta (MX$200). Español: exhibida null (IDS-B15),
    // y su precio sale de la de P × X ⇒ por debajo del inglés de liga.
    expect(rowEn.referenceMxnCents).toBe(E2E_IDS.stamped.refNmCents);
    expect(rowEn.referenceMxnCents).not.toBe(E2E_CARDS.league.refNmCents);
    expect(rowEs.referenceMxnCents).toBeNull();
    expect(rowEs.unitPriceCents).toBeLessThan(rowEn.unitPriceCents!);
    expect(await h.prisma.pendingPriceEntry.count({ where: { cardId, createdAt: { gte: startedAt } } })).toBe(0);

    // Lectura del cajón (A2): la de hoy (`finish=normal`) no la trae; la segunda (`stamped=true` sin `finish`) sí, con su versión.
    const first = await drawerRead('&finish=normal');
    expect(first.map((i) => i.id)).not.toContain(esId);
    expect(first.map((i) => i.id)).not.toContain(enId);
    const second = await drawerRead('&stamped=true');
    const mine = second.filter((i) => i.id === esId || i.id === enId);
    expect(mine.map((i) => [i.id, i.finish, i.version.key, i.version.stamp?.productId]).sort()).toEqual(
      [
        [enId, 'holofoil', `en.${P}`, P],
        [esId, 'holofoil', `es.${P}`, P],
      ].sort(),
    );
    expect(second.every((i) => i.version.stamp != null)).toBe(true);
    // Ids, no longitudes: con restos de otras corridas (tope pageSize=100) una resta de largos mide otra cosa.
    expect(second.map((i) => i.id).sort()).toEqual([...stampedBefore, esId, enId].sort());
    const esOnly = await drawerRead('&stamped=true&language=es');
    expect(esOnly.map((i) => i.id)).toContain(esId);
    expect(esOnly.map((i) => i.id)).not.toContain(enId);

    // La casilla `normal` del binder no cambia (I-6: inglés sin liga).
    const after = await leagueCell();
    expect(after.countsByFinish.find((c) => c.finish === 'normal')?.count ?? 0).toBe(normalBefore);
    expect(after.totalCount).toBe(before.totalCount);
    expect(after.countsByFinish.find((c) => c.finish === 'holofoil')).toBeUndefined();
  });
  it('IDS-B33/B35/B37 (integración): GET …/versions trae buySuggestedCents entero por combo; liga usa el mercado de P; es = scaleByPct(en, X) sobre la MISMA referencia', async () => {
    type Combo = { finish: string; language: 'en' | 'es'; stamp: { productId: number } | null; buySuggestedCents: number | null; appliedMarketPct: number | null; baseReferenceMxnCents: number | null };
    const r = await h.api<{ combos: Combo[] }>('GET', `/admin/inventory/cards/${cardId}/versions`, { token: admin });
    expect(r.status).toBe(200);
    const pick = (language: 'en' | 'es', league: boolean) => r.body.combos.find((c) => c.language === language && (c.stamp != null) === league && (league ? c.finish === 'holofoil' : c.finish === 'normal'))!;
    const [enBase, esBase, enP, esP] = [pick('en', false), pick('es', false), pick('en', true), pick('es', true)];
    for (const c of [enBase, esBase, enP, esP]) {
      expect(c).toBeDefined();
      expect(Number.isInteger(c.buySuggestedCents)).toBe(true);
      expect(c.buySuggestedCents!).toBeGreaterThan(0);
    }
    // IDS-B35: el mercado de P (MX$120) no es el de la carta (MX$200) ⇒ otra compra.
    expect(enP.baseReferenceMxnCents).toBe(E2E_IDS.stamped.refNmCents);
    expect(enP.buySuggestedCents).not.toBe(enBase.buySuggestedCents);
    // IDS-B33/B37: primero la curva, después X, con scaleByPct.
    const pct = esBase.appliedMarketPct!;
    expect(esBase.buySuggestedCents).toBe(scaleByPct(enBase.buySuggestedCents!, pct));
    expect(esP.buySuggestedCents).toBe(scaleByPct(enP.buySuggestedCents!, pct));
  });
});
