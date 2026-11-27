/**
 * auto-link-b3-sweep.e2e-spec.ts — 💰 §AUTO-ENLACE §10 contra Postgres REAL y la app por HTTP. Propiedad: backend.
 *  §10.1 grupo B3 sin referencia previa ⇒ enlaces SÍ, precios NO (0 PriceReference legibles) hasta que el dueño confirma el grupo; `b3_unverified` en la lista con el
 *        grupo que eligió B3 primero y ≤ 5 muestras; `via:'b3'` llega a `auto-link-runs`; variantes CON referencia previa siguen el candado (§9.6).
 *  §10.2 rotación de ≤ 10 sets ya ligados por corrida (tras la tanda principal), por último barrido más antiguo; un barrido sin cambios también rota.
 *  §10.4 `no_source_product` (cartas sin producto en la fuente) ≠ `name_mismatch`.
 */
import { randomUUID } from 'crypto';
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { E2E_USERS } from '../../prisma/e2e-fixtures';
import { CatalogAutoLinkService } from '../../src/modules/catalog/catalog-auto-link.service';
import { TcgcsvCatalogClient } from '../../src/modules/pricing/providers/tcgcsv-singles.provider';
import { FxService } from '../../src/modules/pricing/fx.service';

jest.setTimeout(240_000);

describe('E2E — §AUTO-ENLACE §10 grupo B3 retenido, rotación de acabados, no_source_product', () => {
  let h: E2EHarness;
  let admin: string;
  let job: CatalogAutoLinkService;
  const run = randomUUID().slice(0, 8);
  const word = (s: string) => s.replace(/[0-9]/g, (d) => 'ghijklmnop'[Number(d)]); // el nombre del set no lleva dígitos (la normalización los trata aparte)
  const W = word(run);
  const base = 950_000 + (parseInt(run.slice(0, 4), 16) % 4_000) * 20;
  const GB1 = base + 1; // grupo B3 del set S1
  const GB2 = base + 2; // grupo B3 del set S2
  const GX = base + 3; // otro grupo cualquiera (candidato distinto)
  const GN = base + 4; // set `no_source_product`
  const GU = base + 5; // set sin ligar de la tanda principal (rotación)
  const SWEEP0 = base + 10; // grupos 10..21 para los 12 sets ya ligados
  const setIds: string[] = [];
  const cardIds: string[] = [];
  const productsOf = new Map<number, { productId: number; name: string; number: string }[]>();
  const extraFinish = new Set<number>(); // grupos cuya fuente trae además `Holofoil`
  const names = ['Pikachu', 'Eevee', 'Snorlax', 'Mewtwo'];
  const day = (n: number) => new Date(new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10));
  const pubs = (s: string) => ({ publishedOn: s });
  const groups = [
    { groupId: GB1, name: `EX Zorua${W}`, ...pubs('2020-01-01') },
    { groupId: GB2, name: `EX Dratini${W}`, ...pubs('2020-01-01') },
    { groupId: GX, name: `EX Zorua${W} Frontiers`, ...pubs('2021-06-01') }, // empata el nombre: la escalera por nombre queda ambigua y decide la regla B3
    { groupId: GX + 100, name: `EX Dratini${W} Frontiers`, ...pubs('2021-06-01') },
    { groupId: GN, name: `Nada${W}`, ...pubs('2020-01-01') },
    { groupId: GU, name: `Zzz sin ligar ${W}`, ...pubs('2020-01-01') },
    ...Array.from({ length: 12 }, (_, i) => ({ groupId: SWEEP0 + i, name: `Barrido ${W} ${String.fromCharCode(97 + i)}`, ...pubs('2020-01-01') })),
  ];

  async function mkSet(tag: string, opts: { name: string; series?: string; pptSetId?: string; cards: string[] }): Promise<{ setId: string; cardIds: string[] }> {
    const s = await h.prisma.cardSet.create({ data: { externalId: `b3-${tag}-${run}`, name: opts.name, series: opts.series ?? null, pptSetId: opts.pptSetId ?? null, releaseDate: '2020/01/01' } });
    setIds.push(s.id);
    const ids: string[] = [];
    for (let i = 0; i < opts.cards.length; i++) {
      const c = await h.prisma.card.create({ data: { externalId: `b3-${tag}-${run}-${i}`, setId: s.id, name: opts.cards[i], number: String(i + 1), availableFinishes: ['normal'] } });
      ids.push(c.id);
      cardIds.push(c.id);
    }
    return { setId: s.id, cardIds: ids };
  }
  const prior = (cardId: string, mxn: number) =>
    h.prisma.priceReference.create({ data: { cardId, productType: 'raw', gradeKey: 'raw:NM', finish: 'normal', source: 'tcgdex', priceUsdCents: null, priceMxnCents: mxn, capturedDate: day(3), refKind: 'market' } as never });
  /** §12.3: «referencia previa» = SOLO fuente TCGCSV (sin `cardProductId`, como una fila legada). */
  const priorTcgcsv = (cardId: string, mxn: number) =>
    h.prisma.priceReference.create({ data: { cardId, productType: 'raw', gradeKey: 'raw:NM', finish: 'normal', source: 'tcgcsv_singles', priceUsdCents: null, priceMxnCents: mxn, capturedDate: day(3), refKind: 'market' } as never });
  const list = () => h.api<any>('GET', '/admin/catalog/link-exceptions', { token: admin });
  const confirm = (setId: string, groupId: number) => h.api<any>('POST', `/admin/catalog/link-exceptions/${setId}/confirm`, { token: admin, json: { groupId } });
  const tcgcsvRefs = (ids: string[]) => h.prisma.priceReference.count({ where: { cardId: { in: ids }, source: 'tcgcsv_singles' } });
  const opts = () => ({ retryDelayMs: 0, onlySetIds: setIds, maxSets: 50 });
  let S1: { setId: string; cardIds: string[] };
  let S2: { setId: string; cardIds: string[] };

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    admin = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    job = h.app.get(CatalogAutoLinkService);
    const client = h.app.get(TcgcsvCatalogClient);
    jest.spyOn(client, 'listGroups').mockImplementation(async () => groups as never);
    jest.spyOn(client, 'getProducts').mockImplementation(async (g: number) => (productsOf.get(g) ?? []) as never);
    jest.spyOn(client, 'getPrices').mockImplementation(
      async (g: number) =>
        (productsOf.get(g) ?? []).flatMap((p) => [
          { productId: p.productId, subTypeName: 'Normal', marketPrice: 2 },
          ...(extraFinish.has(g) ? [{ productId: p.productId, subTypeName: 'Holofoil', marketPrice: 5 }] : []),
        ]) as never,
    );
    jest.spyOn(h.app.get(FxService), 'getCurrent').mockResolvedValue({ rate: 18, bufferPct: 0, source: 'banxico', effectiveDate: '2026-11-25' } as never);
    await h.prisma.auditLog.deleteMany({ where: { action: { in: ['catalog.auto_link_claim', 'catalog.auto_link_run', 'catalog.auto_link', 'catalog.link_repair', 'catalog.group_confirm_claim', 'catalog.group_confirmed'] } } });
  });

  afterAll(async () => {
    if (h) {
      const cps = await h.prisma.cardProduct.findMany({ where: { cardId: { in: cardIds } }, select: { id: true } });
      await h.prisma.priceReviewCase.deleteMany({ where: { cardId: { in: cardIds } } });
      await h.prisma.priceReference.deleteMany({ where: { OR: [{ cardId: { in: cardIds } }, { cardProductId: { in: cps.map((c) => c.id) } }] } });
      await h.prisma.cardProduct.deleteMany({ where: { cardId: { in: cardIds } } });
      await h.prisma.card.deleteMany({ where: { id: { in: cardIds } } });
      await h.prisma.cardSet.deleteMany({ where: { id: { in: setIds } } });
      await h.prisma.auditLog.deleteMany({ where: { OR: [{ entityId: { in: [...cardIds, ...setIds] } }, { action: { in: ['catalog.auto_link_run', 'catalog.auto_link_claim', 'catalog.auto_link', 'catalog.link_repair', 'catalog.group_confirm_claim', 'catalog.group_confirmed', 'catalog.finish_reconciled'] } }] } });
      await h.close();
    }
  });

  it('§10.1 rojo→verde: grupo B3 SIN referencia previa ⇒ los enlaces se escriben, los precios NO (0 PriceReference tcgcsv); motivo `b3_unverified`; sin reintento (espera 7 días)', async () => {
    // Nombre local «Zorua…», serie «EX», grupo «EX Zorua…» ⇒ solo la regla B3 (prefijo de serie) lo resuelve; el grupo NO es el de ningún id numérico.
    S1 = await mkSet('S1', { name: `Zorua${W}`, series: 'EX', cards: names.slice(0, 3) });
    productsOf.set(GB1, names.slice(0, 3).map((name, i) => ({ productId: GB1 * 100 + i + 1, name, number: String(i + 1) })));
    const r = await job.run(opts());
    const s = r.sets.find((x) => x.setId === S1.setId)!;
    expect(s).toMatchObject({ linked: 3, priced: 0, reason: 'b3_unverified' });
    expect(await h.prisma.cardProduct.count({ where: { cardId: { in: S1.cardIds } } })).toBe(3); // el enlace SÍ (reversible)
    expect(await tcgcsvRefs(S1.cardIds)).toBe(0); // el precio NO: ni lectura legada ni nada que `ListingPrice` pudiera leer
    expect(await h.prisma.priceReference.count({ where: { cardId: { in: S1.cardIds } } })).toBe(0);
    const au = await h.prisma.auditLog.findFirstOrThrow({ where: { action: 'catalog.auto_link', entityId: S1.setId } });
    expect(au.after).toMatchObject({ via: 'b3', groupId: GB1, reason: 'b3_unverified', priced: 0, linked: 3 });
    const wait = Date.parse((au.after as { nextAttemptAt: string }).nextAttemptAt) - Date.now();
    expect(wait).toBeGreaterThan(6 * 86_400_000);
    expect(await h.prisma.cardSet.findUniqueOrThrow({ where: { id: S1.setId }, select: { cardGroupId: true, cardGroupVia: true } })).toEqual({ cardGroupId: GB1, cardGroupVia: 'auto' });
  });

  it('§10.1/B4 la lista trae el set (100 % ligado) con `b3_unverified`, `candidates[0]` = el grupo que eligió B3, muestra ≤ 5 y canConfirm; `auto-link-runs` conserva `via:"b3"`', async () => {
    const ex = await list();
    const row = ex.body.sets.find((x: any) => x.setId === S1.setId);
    expect(row).toMatchObject({ reason: 'b3_unverified', canConfirm: true, unlinked: 0, total: 3, groupUsed: { groupId: GB1, via: 'b3' } });
    expect(row.candidates[0].groupId).toBe(GB1);
    expect(row.candidates.length).toBeLessThanOrEqual(5);
    expect(row.sample.length).toBe(3);
    expect(row.sample[0]).toEqual({ cardName: 'Pikachu', number: '1', finish: 'normal', newPriceCents: 3600 });
    const runs = await h.api<any>('GET', '/admin/catalog/auto-link-runs?days=1', { token: admin });
    const mine = runs.body.runs.flatMap((x: any) => x.sets).find((x: any) => x.setId === S1.setId);
    expect(mine).toMatchObject({ via: 'b3', groupId: GB1, linked: 3, priced: 0 });
    // Un set 100 % ligado y retenido no cuenta como «cartas sin ligar».
    expect(ex.body.summary.unlinkedCards).not.toBeUndefined();
  });

  it('§10.1 `confirm {groupId}` libera: precia esas variantes en la misma llamada, fija `confirmed` y el set sale de la lista; el job ya no lo retiene', async () => {
    const r = await confirm(S1.setId, GB1);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ groupUsed: { groupId: GB1, via: 'confirmed' }, priced: 3 });
    expect(await tcgcsvRefs(S1.cardIds)).toBe(3);
    expect(await h.prisma.cardSet.findUniqueOrThrow({ where: { id: S1.setId }, select: { cardGroupVia: true } })).toEqual({ cardGroupVia: 'confirmed' });
    expect((await list()).body.sets.some((x: any) => x.setId === S1.setId)).toBe(false);
  });

  it('§10.1/§12.3 variantes CON referencia TCGCSV previa no se retienen por B3 (previo 3000 → 3600); una referencia tcgdex NO libera; la sin referencia queda retenida; set `b3_unverified` con b3Published=1 y b3Held=2', async () => {
    S2 = await mkSet('S2', { name: `Dratini${W}`, series: 'EX', cards: names.slice(0, 3) });
    productsOf.set(GB2, names.slice(0, 3).map((name, i) => ({ productId: GB2 * 100 + i + 1, name, number: String(i + 1) })));
    await priorTcgcsv(S2.cardIds[0], 3000);
    await prior(S2.cardIds[1], 3000); // tcgdex: NO cuenta como referencia previa (§12.3)
    const r = await job.run(opts());
    expect(r.sets.find((x) => x.setId === S2.setId)).toMatchObject({ linked: 3, priced: 1, reason: 'b3_unverified' });
    expect(await h.prisma.priceReference.count({ where: { cardId: S2.cardIds[0], source: 'tcgcsv_singles', priceMxnCents: 3600 } })).toBe(1);
    expect(await tcgcsvRefs([S2.cardIds[1], S2.cardIds[2]])).toBe(0);
    const row = (await list()).body.sets.find((x: any) => x.setId === S2.setId);
    expect(row.sample.map((x: any) => x.cardName).sort()).toEqual(['Eevee', 'Snorlax']);
    expect(row).toMatchObject({ reason: 'b3_unverified', b3Published: 1, b3Held: 2 });
  });

  it('§10.4 `no_source_product`: cartas cuyo número no existe en el grupo de la fuente salen con motivo propio (no `name_mismatch`)', async () => {
    const N = await mkSet('N', { name: `Nada${W}`, pptSetId: String(GN), cards: ['Pikachu', 'Eevee'] });
    productsOf.set(GN, [{ productId: GN * 100 + 1, name: 'Pikachu', number: '1' }]); // la carta 2 no existe en la fuente
    const r = await job.run(opts());
    expect(r.sets.find((x) => x.setId === N.setId)).toMatchObject({ linked: 1 });
    const row = (await list()).body.sets.find((x: any) => x.setId === N.setId);
    expect(row).toMatchObject({ reason: 'no_source_product', unlinked: 1, canConfirm: false, reviewable: 0, noSourceProduct: 1 });
    const cards = await h.api<any>('GET', `/admin/catalog/link-exceptions/${N.setId}/cards`, { token: admin });
    expect(cards.body.items).toEqual([expect.objectContaining({ name: 'Eevee', number: '2', reason: 'no_source_product', candidates: [] })]);
  });

  it('§10.2 rotación: 12 sets ya ligados ⇒ 10 por corrida (los de barrido más antiguo), la tanda principal va primero; la corrida siguiente barre los 2 restantes y luego ninguno', async () => {
    await h.prisma.auditLog.deleteMany({ where: { action: { in: ['catalog.auto_link_claim', 'catalog.auto_link'] }, entityId: { in: setIds } } });
    const sweepSets: string[] = [];
    for (let i = 0; i < 12; i++) {
      const g = SWEEP0 + i;
      const set = await mkSet(`W${i}`, { name: `Barrido ${W} ${String.fromCharCode(97 + i)}`, pptSetId: String(g), cards: ['Pikachu'] });
      productsOf.set(g, [{ productId: g * 100 + 1, name: 'Pikachu', number: '1' }]);
      await h.prisma.cardProduct.create({ data: { cardId: set.cardIds[0], tcgplayerProductId: g * 100 + 1, kind: 'set_base', name: 'Pikachu', finishes: ['normal'] } });
      if (i % 2 === 0) extraFinish.add(g); // la fuente trae un acabado nuevo en los sets pares (6 de 12)
      sweepSets.push(set.setId);
    }
    const U = await mkSet('U', { name: `Zzz sin ligar ${W}`, pptSetId: String(GU), cards: ['Pikachu'] }); // tanda principal
    productsOf.set(GU, [{ productId: GU * 100 + 1, name: 'Pikachu', number: '1' }]);
    // S1/S2/N también están 100 % ligados o no; para medir solo los 12, el barrido se limita a ellos.
    const only = [...sweepSets, U.setId];
    const r1 = await job.run({ retryDelayMs: 0, onlySetIds: only, maxSets: 50 });
    expect(r1.swept).toBe(10);
    expect(r1.setsTried).toBe(1); // el barrido NO cuenta en la tanda principal
    expect(r1.sets[0].setId).toBe(U.setId); // principal primero
    expect(r1.sets.slice(1).every((s) => s.sweep === true && sweepSets.includes(s.setId))).toBe(true);
    const sweptNow = new Set(r1.sets.filter((s) => s.sweep).map((s) => s.setId));
    // Acabado nuevo añadido SOLO en los barridos pares; el resto, barrido sin cambios (auditoría `sweep:true, finishesAdded:0` para rotar).
    for (const [i, id] of sweepSets.entries()) {
      const finishes = (await h.prisma.card.findFirstOrThrow({ where: { setId: id }, select: { availableFinishes: true } })).availableFinishes;
      expect(finishes.includes('holofoil')).toBe(sweptNow.has(id) && i % 2 === 0);
    }
    const noChange = [...sweptNow].find((id) => sweepSets.indexOf(id) % 2 === 1)!;
    const rot = await h.prisma.auditLog.findFirstOrThrow({ where: { action: 'catalog.auto_link', entityId: noChange } });
    expect(rot.after).toMatchObject({ sweep: true, finishesAdded: 0, linked: 0, noProgress: false });
    // 2.ª corrida el mismo día: solo los 2 que faltaban; 3.ª: ninguno.
    const r2 = await job.run({ retryDelayMs: 0, onlySetIds: only, maxSets: 50 });
    expect(r2.swept).toBe(2);
    expect(new Set([...sweptNow, ...r2.sets.filter((s) => s.sweep).map((s) => s.setId)]).size).toBe(12);
    const r3 = await job.run({ retryDelayMs: 0, onlySetIds: only, maxSets: 50 });
    expect(r3.swept).toBe(0);
    // Sin cambios de enlaces: el barrido no toca cartas ya ligadas (0 enlaces nuevos).
    expect(await h.prisma.cardProduct.count({ where: { cardId: { in: cardIds }, card: { setId: { in: sweepSets } } } })).toBe(12);
  });

  it('§10.2 el barrido respeta el tope de llamadas de la corrida: con maxCalls=5 corta (call_cap) y mañana sigue', async () => {
    await h.prisma.auditLog.deleteMany({ where: { action: { in: ['catalog.auto_link_claim', 'catalog.auto_link'] } } });
    const r = await job.run({ retryDelayMs: 0, onlySetIds: setIds, maxSets: 50, maxCalls: 5 });
    expect(r.tcgcsvCalls).toBeLessThanOrEqual(5);
    expect(r.aborted).toBe('call_cap');
  });
});
