/**
 * auto-link-card-confirm.e2e-spec.ts — 💰 §AUTO-ENLACE §9.4 (confirmación POR CARTA) y §9.6 (candado de precios) contra Postgres REAL y la app por HTTP.
 * Propiedad: backend.
 *  GET …/:setId/cards (name_mismatch|collision, ≤ 5 candidatos del mismo número sin dueño) · POST …/cards/:cardId/confirm (enlace + precios + bitácora
 *  en una transacción; 404/422/409/429/503; idempotente) · carrera: ≥ 30 `confirm` simultáneos con una corrida del job (k/N) · el job nunca mueve un
 *  enlace confirmado · una variante RETENIDA por el candado no se escribe y el cliente nunca la lee.
 */
import { randomUUID } from 'crypto';
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { E2E_USERS } from '../../prisma/e2e-fixtures';
import { CatalogAutoLinkService } from '../../src/modules/catalog/catalog-auto-link.service';
import { TcgcsvCatalogClient } from '../../src/modules/pricing/providers/tcgcsv-singles.provider';
import { FxService } from '../../src/modules/pricing/fx.service';
import { PricingService } from '../../src/modules/pricing/pricing.service';

jest.setTimeout(240_000);

describe('E2E — §AUTO-ENLACE §9.4 confirmación por carta + §9.6 candado', () => {
  let h: E2EHarness;
  let admin: string;
  let operator: string;
  const run = randomUUID().slice(0, 8);
  const base = 930_000 + (parseInt(run.slice(0, 4), 16) % 5_000) * 10;
  const GA = base + 1; // set de 40 name_mismatch + 2 colisión
  const GB = base + 2; // set 100 % automático (el job trabaja en paralelo)
  const GF = base + 3; // proveedor caído
  const GH = base + 4; // candado: referencia previa baja
  const setIds: string[] = [];
  const cardIds: string[] = [];
  const failing = new Set<number>();
  const productsOf = new Map<number, { productId: number; name: string; number: string }[]>();
  const holo = new Set<number>(); // productos con acabado Holofoil además de Normal
  const groups = [GA, GB, GF, GH].map((g) => ({ groupId: g, name: `Grupo ${g} ${run}` }));

  async function mkSet(tag: string, group: number, cards: { name: string; number: string }[]): Promise<{ setId: string; cardIds: string[] }> {
    const s = await h.prisma.cardSet.create({ data: { externalId: `cc-${tag}-${run}`, name: `Grupo ${group} ${run}`, pptSetId: String(group), releaseDate: '2020/01/01' } });
    setIds.push(s.id);
    const ids: string[] = [];
    for (const [i, c] of cards.entries()) {
      const row = await h.prisma.card.create({ data: { externalId: `cc-${tag}-${run}-${i}`, setId: s.id, name: c.name, number: c.number, availableFinishes: ['normal'] } });
      ids.push(row.id);
      cardIds.push(row.id);
    }
    return { setId: s.id, cardIds: ids };
  }
  const list = (setId: string, token = admin) => h.api<any>('GET', `/admin/catalog/link-exceptions/${setId}/cards`, { token });
  const confirm = (setId: string, cardId: string, productId: unknown, token = admin) => h.api<any>('POST', `/admin/catalog/link-exceptions/${setId}/cards/${cardId}/confirm`, { token, json: { productId } });
  const code = (r: { body: any }) => r.body?.code ?? r.body?.error?.code;
  const clearClaims = () => h.prisma.auditLog.deleteMany({ where: { action: { in: ['catalog.card_confirm_claim', 'catalog.auto_link_claim'] } } });

  let A: { setId: string; cardIds: string[] };
  let B: { setId: string; cardIds: string[] };
  let F: { setId: string; cardIds: string[] };
  let H: { setId: string; cardIds: string[] };

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    admin = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    operator = await h.login(E2E_USERS.operator.email, E2E_USERS.operator.password);
    const client = h.app.get(TcgcsvCatalogClient);
    jest.spyOn(client, 'listGroups').mockImplementation(async () => groups as never);
    jest.spyOn(client, 'getProducts').mockImplementation(async (g: number) => {
      if (failing.has(g)) throw new Error('boom secret-detail');
      return (productsOf.get(g) ?? []) as never;
    });
    jest.spyOn(client, 'getPrices').mockImplementation(async (g: number) =>
      (productsOf.get(g) ?? []).flatMap((p) => [
        { productId: p.productId, subTypeName: 'Normal', marketPrice: 2 },
        ...(holo.has(p.productId) ? [{ productId: p.productId, subTypeName: 'Holofoil', marketPrice: 4 }] : []),
      ]) as never,
    );
    jest.spyOn(h.app.get(FxService), 'getCurrent').mockResolvedValue({ rate: 18, bufferPct: 0, source: 'banxico', effectiveDate: '2026-11-25' } as never);

    // A: 40 cartas con el nombre local distinto del de TCGCSV (mismo número ⇒ name_mismatch) + 2 gemelas (número 50) y UN producto ⇒ colisión.
    A = await mkSet('A', GA, [...Array.from({ length: 40 }, (_, i) => ({ name: `Local Distinta ${i + 1}`, number: String(i + 1) })), { name: 'Gemela Uno', number: '50' }, { name: 'Gemela Dos', number: '50' }]);
    productsOf.set(GA, [...Array.from({ length: 40 }, (_, i) => ({ productId: GA * 100 + i + 1, name: `Nombre Remoto ${i + 1}`, number: `${i + 1}/102` })), { productId: GA * 100 + 50, name: 'Gemela Remota', number: '50/102' }, { productId: GA * 100 + 90, name: 'Mellizo Remoto', number: '90/102' }]);
    holo.add(GA * 100 + 1);
    // B: 5 cartas que el plan liga solo (mismo nombre y número).
    B = await mkSet('B', GB, ['Pikachu', 'Eevee', 'Snorlax', 'Mewtwo', 'Gengar'].map((name, i) => ({ name, number: String(i + 1) })));
    productsOf.set(GB, ['Pikachu', 'Eevee', 'Snorlax', 'Mewtwo', 'Gengar'].map((name, i) => ({ productId: GB * 100 + i + 1, name, number: String(i + 1) })));
    // F: proveedor caído. H: una carta con referencia previa (tcgdex, hace 3 días) muy baja ⇒ el candado retiene el precio de TCGCSV.
    F = await mkSet('F', GF, [{ name: 'Caida', number: '1' }]);
    productsOf.set(GF, [{ productId: GF * 100 + 1, name: 'Remota Caida', number: '1' }]);
    H = await mkSet('H', GH, [{ name: 'Con Base', number: '1' }, { name: 'Sin Base', number: '2' }]);
    productsOf.set(GH, [{ productId: GH * 100 + 1, name: 'Remota Base', number: '1' }, { productId: GH * 100 + 2, name: 'Remota Nueva', number: '2' }]);
    const d = new Date(Date.now() - 3 * 86_400_000);
    await h.prisma.priceReference.create({ data: { cardId: H.cardIds[0], productType: 'raw', gradeKey: 'raw:NM', finish: 'normal', source: 'tcgdex', priceUsdCents: null, priceMxnCents: 100, capturedDate: new Date(d.toISOString().slice(0, 10)), refKind: 'market' } });
    await clearClaims();
  });

  afterAll(async () => {
    if (h) {
      const cps = await h.prisma.cardProduct.findMany({ where: { cardId: { in: cardIds } }, select: { id: true } });
      await h.prisma.priceReviewCase.deleteMany({ where: { cardId: { in: cardIds } } });
      await h.prisma.priceReference.deleteMany({ where: { OR: [{ cardId: { in: cardIds } }, { cardProductId: { in: cps.map((c) => c.id) } }] } });
      await h.prisma.cardProduct.deleteMany({ where: { cardId: { in: cardIds } } });
      await h.prisma.card.deleteMany({ where: { id: { in: cardIds } } });
      await h.prisma.cardSet.deleteMany({ where: { id: { in: setIds } } });
      // El job recorre TODOS los sets sin ligar (también los sembrados): sus filas de intento (`link_repair`/`auto_link`) no deben sobrevivir a esta suite (otra suite mide el total de cartas sin ligar).
      await h.prisma.auditLog.deleteMany({ where: { OR: [{ entityId: { in: [...cardIds, ...setIds] } }, { action: { in: ['catalog.auto_link_run', 'catalog.auto_link_claim', 'catalog.auto_link', 'catalog.link_repair', 'catalog.card_confirm_claim', 'catalog.auto_unlink', 'catalog.auto_unlink_claim'] } }] } });
      await h.close();
    }
  });

  it('GET: solo super_admin; name_mismatch por carta con ≤ 5 candidatos del MISMO número sin dueño (acabados y precio en centavos MXN); la colisión muestra su producto; ≤ 50', async () => {
    expect((await list(A.setId, operator)).status).toBe(403);
    expect((await h.api('GET', `/admin/catalog/link-exceptions/${randomUUID()}/cards`, { token: admin })).status).toBe(404);
    const r = await list(A.setId);
    expect(r.status).toBe(200);
    expect(r.body.setId).toBe(A.setId);
    expect(r.body.items).toHaveLength(42);
    const uno = r.body.items.find((i: any) => i.cardId === A.cardIds[0]);
    expect(uno).toMatchObject({ name: 'Local Distinta 1', number: '1', reason: 'name_mismatch' });
    expect(uno.candidates).toEqual([{ productId: GA * 100 + 1, name: 'Nombre Remoto 1', number: '1/102', finishes: ['normal', 'holofoil'], priceCents: 3600 }]);
    const gem = r.body.items.filter((i: any) => i.number === '50');
    expect(gem).toHaveLength(2);
    expect(gem.every((g: any) => g.reason === 'collision' && g.candidates.length === 1 && g.candidates[0].productId === GA * 100 + 50)).toBe(true);
    expect(JSON.stringify(r.body)).not.toMatch(/token|secret|password/i);
    expect(r.body.items.length).toBeLessThanOrEqual(50);
  });

  it('POST confirm: liga la carta con el producto elegido, precia sus acabados, audita con el usuario; repetir = alreadyConfirmed sin escribir; fuera de la lista y de otro número = 422; 403/404/400', async () => {
    const cid = A.cardIds[0];
    const pid = GA * 100 + 1;
    expect((await confirm(A.setId, cid, pid, operator)).status).toBe(403);
    expect((await confirm(randomUUID(), cid, pid)).status).toBe(404);
    expect((await confirm(A.setId, randomUUID(), pid)).status).toBe(404);
    expect((await confirm(A.setId, cid, 'x')).status).toBe(422); // §10 menor: 422 VALIDATION_ERROR coherente (no 400)
    expect([(await confirm(A.setId, cid, 1.5)).status, (await confirm(A.setId, cid, undefined)).status]).toEqual([422, 422]);
    const no = await confirm(A.setId, cid, GA * 100 + 2); // producto de OTRO número
    expect([no.status, code(no)]).toEqual([422, 'PRODUCT_NOT_CANDIDATE']);
    expect(await h.prisma.cardProduct.count({ where: { cardId: cid } })).toBe(0);

    const r = await confirm(A.setId, cid, pid);
    expect([r.status, JSON.stringify(r.body)]).toEqual([200, expect.anything()]);
    expect(r.body).toEqual({ cardId: cid, productId: pid, priced: 2, alreadyConfirmed: false });
    const cp = await h.prisma.cardProduct.findUniqueOrThrow({ where: { tcgplayerProductId: pid } });
    expect(cp).toMatchObject({ cardId: cid, finishes: ['normal', 'holofoil'] });
    expect((await h.prisma.priceReference.findMany({ where: { cardProductId: cp.id } })).map((p) => [p.finish, p.priceMxnCents]).sort()).toEqual([['holofoil', 7200], ['normal', 3600]]);
    expect((await h.prisma.card.findUniqueOrThrow({ where: { id: cid } })).availableFinishes).toEqual(['normal', 'holofoil']);
    const au = await h.prisma.auditLog.findMany({ where: { action: 'catalog.card_link_confirmed', entityId: cid } });
    expect(au).toHaveLength(1);
    expect(au[0].actorUserId).not.toBeNull();
    expect(au[0].after).toMatchObject({ cardId: cid, productId: pid, setId: A.setId, reason: 'name_mismatch', before: null });
    // Idempotente: mismo producto ⇒ alreadyConfirmed, 0 escrituras.
    const snap = JSON.stringify(await h.prisma.priceReference.findMany({ where: { cardProductId: cp.id }, orderBy: { id: 'asc' } }));
    const again = await confirm(A.setId, cid, pid);
    expect([again.status, again.body]).toEqual([200, { cardId: cid, productId: pid, priced: 0, alreadyConfirmed: true }]);
    expect(JSON.stringify(await h.prisma.priceReference.findMany({ where: { cardProductId: cp.id }, orderBy: { id: 'asc' } }))).toBe(snap);
    expect(await h.prisma.auditLog.count({ where: { action: 'catalog.card_link_confirmed', entityId: cid } })).toBe(1);
    // Otra carta pide ese producto ⇒ 409 PRODUCT_TAKEN; la carta ya sale de la lista.
    const taken = await confirm(A.setId, A.cardIds[1], pid);
    expect([taken.status, code(taken)]).toEqual([409, 'PRODUCT_TAKEN']);
    expect((await list(A.setId)).body.items.some((i: any) => i.cardId === cid)).toBe(false);
  });

  it('colisión: se confirma UNA carta por vez; la hermana ya no tiene candidato (el producto quedó ligado) y pedirlo da 409', async () => {
    const [uno, dos] = [A.cardIds[40], A.cardIds[41]];
    const pid = GA * 100 + 50;
    expect((await confirm(A.setId, uno, pid)).status).toBe(200);
    const hermana = (await list(A.setId)).body.items.find((i: any) => i.cardId === dos);
    expect(hermana).toMatchObject({ reason: 'no_source_product', candidates: [] }); // ya sin candidato: queda marcada, informativa
    const taken = await confirm(A.setId, dos, pid);
    expect([taken.status, code(taken)]).toEqual([409, 'PRODUCT_TAKEN']);
    expect(await h.prisma.cardProduct.count({ where: { tcgplayerProductId: pid } })).toBe(1);
  });

  it('503 UPSTREAM_ERROR con mensaje fijo si el proveedor falla (GET y POST), sin escribir nada', async () => {
    failing.add(GF);
    const g = await list(F.setId);
    expect([g.status, code(g)]).toEqual([503, 'UPSTREAM_ERROR']);
    expect(JSON.stringify(g.body)).not.toMatch(/boom|secret-detail/);
    const p = await confirm(F.setId, F.cardIds[0], GF * 100 + 1);
    expect(p.status).toBe(503);
    expect(await h.prisma.cardProduct.count({ where: { cardId: F.cardIds[0] } })).toBe(0);
    expect(await h.prisma.auditLog.count({ where: { action: { in: ['catalog.card_link_confirmed', 'catalog.card_confirm_claim'] }, entityId: F.cardIds[0] } })).toBe(0);
    failing.clear();
  });

  it('el job NO mueve un enlace confirmado: tras la confirmación, una corrida deja carta y producto donde estaban', async () => {
    const job = h.app.get(CatalogAutoLinkService);
    const before = await h.prisma.cardProduct.findMany({ where: { cardId: { in: A.cardIds } }, select: { id: true, cardId: true, tcgplayerProductId: true, finishes: true }, orderBy: { tcgplayerProductId: 'asc' } });
    await clearClaims();
    const first = await job.run({ trigger: 'manual', maxSets: 50, onlySetIds: setIds });
    expect(first.sets.some((x) => x.setId === B.setId && x.linked === 5)).toBe(true); // el set 100 % automático sí lo liga el job
    expect(await h.prisma.cardProduct.findMany({ where: { cardId: { in: A.cardIds } }, select: { id: true, cardId: true, tcgplayerProductId: true, finishes: true }, orderBy: { tcgplayerProductId: 'asc' } })).toEqual(before);
    expect(before.length).toBeGreaterThanOrEqual(2);
  });

  it('§9.6 candado: variante CON referencia previa que salta ×N sin consenso ⇒ el enlace sí, el PRECIO no (0 filas tcgcsv), caso `sell` abierto y el cliente sigue leyendo la referencia previa; sin referencia previa ⇒ se escribe', async () => {
    const withBase = H.cardIds[0];
    const noBase = H.cardIds[1];
    const r = await confirm(H.setId, withBase, GH * 100 + 1);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ cardId: withBase, priced: 0, held: 1, alreadyConfirmed: false });
    expect(await h.prisma.cardProduct.count({ where: { cardId: withBase } })).toBe(1);
    expect(await h.prisma.priceReference.count({ where: { cardId: withBase, source: 'tcgcsv_singles' } })).toBe(0); // NO legible por NINGUNA vía
    const kase = await h.prisma.priceReviewCase.findFirstOrThrow({ where: { cardId: withBase, axis: 'sell', status: 'open' } });
    expect(kase).toMatchObject({ finish: 'normal', baselineMxnCents: 100, productType: 'raw' });
    expect(kase.proposedMxnCents).toBe(1850); // la mediana de las dos fuentes (100 y 3600) que el candado detuvo; NO se publicó
    const pricing = h.app.get(PricingService);
    expect((await pricing.getReference(withBase, 'raw', 'raw:NM', 'normal')).referenceMxnCents).toBe(100); // lectura legada: lo previo
    const held = await pricing.saleRetentionFor([{ cardId: withBase, productType: 'raw', gradeKey: 'raw:NM', finish: 'normal' }]);
    expect([...held.values()][0]).toMatchObject({ status: 'priced', referenceMxnCents: 100 });
    const ok = await confirm(H.setId, noBase, GH * 100 + 2);
    expect(ok.body).toMatchObject({ priced: 1 });
    expect(await h.prisma.priceReference.count({ where: { cardId: noBase, source: 'tcgcsv_singles' } })).toBe(1);
  });

  it('CARRERA §9.8: ≥ 30 `confirm` simultáneos (10 cartas × 3 + 2 gemelas por el mismo producto) mientras corre el job ⇒ 0 doble enlace, 0 5xx; k/N medido', async () => {
    const job = h.app.get(CatalogAutoLinkService);
    // Estado limpio de la lista A: 10 cartas aún sin ligar (números 11..20) + el par de gemelas de una 2.ª tanda.
    const pick = A.cardIds.slice(10, 20);
    const twins = await mkSet('T', GA, [{ name: 'Mellizo Uno', number: '90' }, { name: 'Mellizo Dos', number: '90' }]);
    // el set T comparte grupo con A: se lista por SU setId (el payload del grupo ya lo trae)
    await clearClaims();
    const calls: Promise<{ status: number; body: any; tag: string }>[] = [];
    for (const [i, cid] of pick.entries()) for (let k = 0; k < 3; k++) calls.push(confirm(A.setId, cid, GA * 100 + 11 + i).then((r) => ({ ...r, tag: `card-${i}` })));
    calls.push(confirm(twins.setId, twins.cardIds[0], GA * 100 + 90).then((r) => ({ ...r, tag: 'twin' })));
    calls.push(confirm(twins.setId, twins.cardIds[1], GA * 100 + 90).then((r) => ({ ...r, tag: 'twin' })));
    const C = await mkSet('C', GB, ['Ditto', 'Lapras', 'Vaporeon', 'Jolteon', 'Flareon'].map((name, i) => ({ name, number: String(i + 11) })));
    productsOf.set(GB, [...productsOf.get(GB)!, ...['Ditto', 'Lapras', 'Vaporeon', 'Jolteon', 'Flareon'].map((name, i) => ({ productId: GB * 100 + i + 11, name, number: String(i + 11) }))]);
    const jobRun = job.run({ trigger: 'manual', maxSets: 50, onlySetIds: setIds });
    const res = await Promise.all(calls);
    const jr = await jobRun;
    const N = res.length;
    const ok200 = res.filter((r) => r.status === 200).length;
    const wrote = res.filter((r) => r.status === 200 && r.body.alreadyConfirmed === false).length;
    const already = res.filter((r) => r.status === 200 && r.body.alreadyConfirmed === true).length;
    const c409 = res.filter((r) => r.status === 409).length;
    const c429 = res.filter((r) => r.status === 429).length;
    const fiveXX = res.filter((r) => r.status >= 500).length;
    // eslint-disable-next-line no-console
    console.log(`[AE-10 carrera] N=${N} 200=${ok200} (escribieron ${wrote}, ya-confirmadas ${already}) 409=${c409} 429=${c429} 5xx=${fiveXX}`);
    expect(N).toBe(32);
    expect(fiveXX).toBe(0);
    expect(wrote).toBe(11); // 10 cartas + UNA de las mellizas
    expect(already).toBe(20); // las 20 repeticiones son idempotentes (nunca 429 ni escritura)
    expect(c409).toBe(1); // la otra melliza pidió un producto que ya era de su hermana
    expect(ok200 + c409 + c429).toBe(N);
    // Invariantes de BD: cada carta ≤ 1 producto, cada producto ≤ 1 dueño.
    const cps = await h.prisma.cardProduct.findMany({ where: { cardId: { in: [...A.cardIds, ...twins.cardIds] } }, select: { cardId: true, tcgplayerProductId: true } });
    expect(new Set(cps.map((c) => c.cardId)).size).toBe(cps.length);
    expect(new Set(cps.map((c) => c.tcgplayerProductId)).size).toBe(cps.length);
    expect(await h.prisma.cardProduct.count({ where: { tcgplayerProductId: GA * 100 + 90 } })).toBe(1);
    for (const [i, cid] of pick.entries()) expect((await h.prisma.cardProduct.findMany({ where: { cardId: cid } })).map((c) => c.tcgplayerProductId)).toEqual([GA * 100 + 11 + i]);
    // Una auditoría por carta confirmada (la bitácora no se duplica por las repeticiones).
    for (const cid of pick) expect(await h.prisma.auditLog.count({ where: { action: 'catalog.card_link_confirmed', entityId: cid } })).toBe(1);
    // La corrida concurrente NO movió ningún enlace confirmado ni creó un segundo producto en esas cartas (ya comprobado arriba) y terminó sin error.
    expect(jr.ran).toBe(true);
    expect(await h.prisma.card.count({ where: { setId: C.setId, cardProducts: { some: {} } } })).toBe(5); // el job ligó el set C mientras llovían las confirmaciones
  });
});
