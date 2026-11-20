/**
 * demand-gaps.e2e-spec.ts — §DEMANDA F1+F2 (API_CONTRACT_DEMANDA §9) contra la app REAL y Postgres real.
 * Cubre: m112 (3 tablas), acceso (401/403/400), fila única wishlist+búsqueda, carta con stock omitida, `null` ≠ 0, umbral 4/5 y 1/2,
 * término sin carta, lista blanca de la fila, CSV (inyección de fórmulas), `search-miss` con `cardId` (inexistente / con stock / 0 stock /
 * mismo hash dos veces / topes 200 y 300 / campo extra / interruptor), cierre idempotente, `demand-match` (único / varios / 2 corridas /
 * fallo ⇒ el endpoint sigue 200), retención 90/30 y huérfanos.
 * Mutaciones que deben ponerlo rojo: no verificar stock del cardId; guardar el término junto al cardId; no sumar wishlist por cuentas
 * DISTINTAS; quitar el prefijo `'` del CSV; no borrar los hashes al cerrar; quitar el `ON CONFLICT … people + EXCLUDED.people`.
 */
import { randomBytes } from 'crypto';
import { createWshWorld, WshWorld } from './helpers/wishlist-db';
import { MarketingSearchMissService } from '../../src/modules/marketing/marketing-search-miss.service';
import { DemandGapsService } from '../../src/modules/demand/demand-gaps.service';
import { DemandMatchService } from '../../src/modules/demand/demand-match.service';
import { CatalogService } from '../../src/modules/catalog/catalog.service';
import { toMexicoCityDateKey } from '../../src/common/business-days';

let w: WshWorld;
const RUN = randomBytes(3).toString('hex');
const L = (s: string) => s.replace(/\d/g, (c) => 'ghijklmnop'[Number(c)]); // solo letras (el filtro de PII no debe rozar el azar)
const WORD_UNI = `zzdemuni${L(RUN)}`; // 1 carta
const WORD_AMB = `zzdemamb${L(RUN)}`; // 2 cartas
const today = () => toMexicoCityDateKey(new Date());
const dayAgo = (n: number) => new Date(Date.parse(`${today()}T00:00:00.000Z`) - n * 86400_000);
const api = (path: string, token?: string) => w.h.api('GET', path, { token: token ?? w.adminToken });
const gaps = async (q = '') => {
  const r = await api(`/admin/reports/demand-gaps${q}`);
  expect(r.status).toBe(200);
  return r.body as any;
};
const rowOf = (body: any, key: string) => body.rows.find((r: any) => r.key === key);
const post = (body: unknown, ua = 'ua-d') => w.h.api('POST', '/marketing/search-miss', { json: body, headers: { 'user-agent': ua } });

let svc: MarketingSearchMissService;
let cardUni: { id: string; name: string };
let cardAmb1: { id: string; name: string };


beforeAll(async () => {
  w = await createWshWorld();
  svc = w.h.app.get(MarketingSearchMissService);
  const mk = async (name: string) => {
    const c = await w.h.prisma.card.create({ data: { externalId: `dem-${RUN}-${name}`, setId: w.setId, name, number: String(Math.floor(Math.random() * 900) + 100), rarity: 'Common', rarityCanonical: 'Common', availableFinishes: ['normal'] } });
    return { id: c.id, name: c.name };
  };
  cardUni = await mk(`${WORD_UNI} Unica`);
  cardAmb1 = await mk(`${WORD_AMB} V`);
  await mk(`${WORD_AMB} VMAX`);
  await w.h.prisma.configSetting.deleteMany({ where: { key: { in: ['marketing_search_log', 'demand_match_last_ok', 'search_closed_through'] } } });
});
afterAll(async () => {
  await w?.h.prisma.searchDemandDaily.deleteMany({});
  await w?.h.prisma.searchDemandSeen.deleteMany({});
  await w?.h.prisma.searchNoResultDaily.deleteMany({});
  await w?.h.prisma.searchNoResultSeen.deleteMany({});
  await w?.h.prisma.demandTermMatch.deleteMany({});
  await w?.h.prisma.configSetting.deleteMany({ where: { OR: [{ key: { in: ['marketing_search_log', 'demand_match_last_ok', 'search_closed_through'] } }, { key: { startsWith: 'search_salt_' } }] } });
  await w?.close();
});
beforeEach(async () => {
  await w.h.prisma.wishlistItem.deleteMany({});
  await w.h.prisma.searchDemandDaily.deleteMany({});
  await w.h.prisma.searchDemandSeen.deleteMany({});
  await w.h.prisma.searchNoResultDaily.deleteMany({});
  await w.h.prisma.searchNoResultSeen.deleteMany({});
  await w.h.prisma.demandTermMatch.deleteMany({});
  await w.h.prisma.configSetting.deleteMany({ where: { key: { in: ['marketing_search_log', 'demand_match_last_ok', 'search_closed_through'] } } });
  await w.h.prisma.configSetting.deleteMany({ where: { key: { in: ['demand_w_wishlist', 'demand_w_search', 'demand_search_window_days'] } } });
});

const want = async (p: { token: string }, cardId: string, finish = 'normal') => {
  const r = await w.h.api('POST', '/wishlist', { token: p.token, json: { cardId, finish, maxPct: 10 } });
  expect(r.status).toBe(201);
};
const seedDemand = (cardId: string, perDay: number[]) =>
  w.h.prisma.searchDemandDaily.createMany({ data: perDay.map((people, i) => ({ cardId, day: dayAgo(i + 1), people })) });
const seedTerm = (term: string, perDay: number[]) =>
  w.h.prisma.searchNoResultDaily.createMany({ data: perDay.map((people, i) => ({ termNormalized: term, day: dayAgo(i + 1), people })) });

describe('m112 y acceso', () => {
  it('m112 creó las tres tablas con su unicidad y su PK', async () => {
    const idx = await w.h.prisma.$queryRaw<{ indexname: string }[]>`SELECT indexname FROM pg_indexes WHERE tablename IN ('SearchDemandDaily','SearchDemandSeen','DemandTermMatch')`;
    expect(idx.map((i) => i.indexname)).toEqual(expect.arrayContaining(['SearchDemandDaily_cardId_day_key', 'SearchDemandDaily_cardId_idx', 'SearchDemandSeen_pkey', 'SearchDemandSeen_day_h_idx', 'DemandTermMatch_pkey']));
  });
  it('operador y cliente ⇒ 403; sin sesión ⇒ 401 (JSON y CSV); sort/dir/limit inválidos ⇒ 400', async () => {
    const cust = await w.customer();
    for (const token of [w.operatorToken, cust.token]) {
      expect((await api('/admin/reports/demand-gaps', token)).status).toBe(403);
      expect((await api('/admin/reports/demand-gaps/export.csv', token)).status).toBe(403);
    }
    expect((await w.h.api('GET', '/admin/reports/demand-gaps')).status).toBe(401);
    for (const q of ['?sort=otro', '?dir=up', '?limit=0', '?limit=201', '?limit=x']) {
      expect((await api(`/admin/reports/demand-gaps${q}`)).status).toBe(400);
      if (!q.startsWith('?limit')) expect((await api(`/admin/reports/demand-gaps/export.csv${q}`)).status).toBe(400);
    }
  });
  it('sin datos ⇒ 200 con filas vacías y matchedAt null', async () => {
    const b = await gaps();
    expect(b).toMatchObject({ windowDays: 30, sources: { wishlist: 'ok', search: 'ok', matchedAt: null } });
    expect(b.rows.filter((r: any) => [cardUni.id, cardAmb1.id].includes(r.cardId))).toEqual([]);
  });
});

describe('F1 — wishlist + búsquedas en UNA fila; carta con stock omitida; null ≠ 0; lista blanca', () => {
  it('wishlist (cuentas distintas, sin doble conteo entre acabados) + búsqueda se suman en la misma fila; score con diales', async () => {
    const c = await w.card();
    const [a, b] = [await w.customer(), await w.customer()];
    await want(a, c.id, 'normal');
    await want(a, c.id, 'reverse_holo'); // la MISMA cuenta en otro acabado no suma
    await want(b, c.id, 'normal');
    await w.market(c.id, 'normal', 50000);
    await seedDemand(c.id, [3, 2]); // 5 personas, 2 días con ≥ 2 ⇒ pasa el umbral
    const body = await gaps();
    const r = rowOf(body, c.id);
    expect(r).toBeDefined();
    expect(r.signals).toEqual([
      { kind: 'wishlist', count: 2, unit: 'clientes', windowDays: null },
      { kind: 'search', count: 5, unit: 'personas', windowDays: 30, days: 2 },
    ]);
    expect(r.score).toBe(11); // 3×2 + 1×5
    expect(r.finish).toBe('normal'); // el acabado con más clientes
    expect(r).toMatchObject({ kind: 'card', cardId: c.id, term: null, cardName: c.name, setName: w.setName, marketCents: 50000 });
    // lista blanca exacta
    expect(Object.keys(r).sort()).toEqual(['buylistTodayCents', 'cardId', 'cardName', 'finish', 'imageSmallUrl', 'key', 'kind', 'marketCents', 'score', 'setName', 'signals', 'term']);
    expect(JSON.stringify(body)).not.toMatch(new RegExp(`${a.email}|${a.id}|${b.id}|userId|@e2e\\.local`));
    // diales: peso de búsqueda 10 ⇒ 3×2 + 10×5 = 56
    await w.setDial('demand_w_search', 10);
    expect(rowOf(await gaps(), c.id).score).toBe(56);
    await w.setDial('demand_w_search', 1);
  });
  it('una carta SIN precio de mercado ⇒ marketCents y buylistTodayCents null (nunca 0)', async () => {
    const c = await w.card();
    await want(await w.customer(), c.id);
    const r = rowOf(await gaps(), c.id);
    expect(r.marketCents).toBeNull();
    expect(r.buylistTodayCents).toBeNull();
  });
  it('carta con ≥ 1 pieza vendible hoy ⇒ OMITIDA aunque tenga wishlist y búsquedas', async () => {
    const c = await w.card();
    await want(await w.customer(), c.id);
    await seedDemand(c.id, [3, 3]);
    expect(rowOf(await gaps(), c.id)).toBeDefined();
    await w.piece(c.id);
    expect(rowOf(await gaps(), c.id)).toBeUndefined();
  });
  it('umbral: 4 personas ⇒ no sale; 5 en un solo día ⇒ no; 5/2 ⇒ sale (solo búsqueda)', async () => {
    await seedDemand(cardUni.id, [2, 2]);
    expect(rowOf(await gaps(), cardUni.id)).toBeUndefined();
    await w.h.prisma.searchDemandDaily.deleteMany({});
    await seedDemand(cardUni.id, [5]);
    expect(rowOf(await gaps(), cardUni.id)).toBeUndefined();
    await w.h.prisma.searchDemandDaily.deleteMany({});
    await seedDemand(cardUni.id, [3, 2]);
    const r = rowOf(await gaps(), cardUni.id);
    expect(r).toMatchObject({ finish: null, marketCents: null, buylistTodayCents: null, score: 5 });
    expect(r.signals).toHaveLength(1);
  });
  it('término sin carta ⇒ fila kind:term (cuarentena); asociado por demand-match ⇒ suma en la carta y desaparece la fila término', async () => {
    const term = `${WORD_UNI}`;
    await seedTerm(term, [3, 2]);
    let body = await gaps();
    const t = rowOf(body, `term:${term}`);
    expect(t).toMatchObject({ kind: 'term', cardId: null, term, cardName: term, setName: null, finish: null, imageSmallUrl: null, marketCents: null, buylistTodayCents: null });
    expect(t.signals).toEqual([{ kind: 'search', count: 5, unit: 'personas', windowDays: 30, days: 2 }]);
    await w.h.app.get(DemandMatchService).run();
    body = await gaps();
    expect(rowOf(body, `term:${term}`)).toBeUndefined();
    expect(rowOf(body, cardUni.id).signals[0]).toMatchObject({ kind: 'search', count: 5 });
    expect(body.sources.matchedAt).toEqual(expect.any(String));
  });
  it('un término fuera del vocabulario o con PII no sale', async () => {
    await seedTerm('maria lopez', [5, 5]);
    expect((await gaps()).rows.filter((r: any) => r.kind === 'term')).toEqual([]);
  });
  it('limit recorta pero totalRows cuenta todas; sort=search asc invierte', async () => {
    const [c1, c2, c3] = [await w.card(), await w.card(), await w.card()];
    await seedDemand(c1.id, [3, 2]);
    await seedDemand(c2.id, [6, 6]);
    await seedDemand(c3.id, [4, 4]);
    const all = (await gaps('?sort=search&dir=desc&limit=200')).rows.filter((r: any) => [c1.id, c2.id, c3.id].includes(r.cardId)).map((r: any) => r.cardId);
    expect(all).toEqual([c2.id, c3.id, c1.id]);
    const asc = (await gaps('?sort=search&dir=asc&limit=200')).rows.filter((r: any) => [c1.id, c2.id, c3.id].includes(r.cardId)).map((r: any) => r.cardId);
    expect(asc).toEqual([c1.id, c3.id, c2.id]);
    const lim = await gaps('?limit=1');
    expect(lim.rows).toHaveLength(1);
    expect(lim.totalRows).toBeGreaterThanOrEqual(3);
  });
  it('interruptor marketing_search_log=off ⇒ sources.search "off" y la wishlist se muestra; fuente de búsquedas rota ⇒ "error" y 200', async () => {
    const c = await w.card();
    await want(await w.customer(), c.id);
    await w.h.prisma.configSetting.create({ data: { key: 'marketing_search_log', valueJson: 'off' } });
    const off = await gaps();
    expect(off.sources.search).toBe('off');
    expect(rowOf(off, c.id)).toBeDefined();
    await w.h.prisma.configSetting.delete({ where: { key: 'marketing_search_log' } });
    const spy = jest.spyOn(w.h.prisma.searchDemandDaily, 'findMany').mockRejectedValueOnce(new Error('boom'));
    const err = await gaps();
    spy.mockRestore();
    expect(err.sources).toMatchObject({ wishlist: 'ok', search: 'error' });
    expect(rowOf(err, c.id)).toBeDefined();
  });
});

describe('CSV', () => {
  it('cabecera, orden, dinero en pesos con 2 decimales, vacío si null, y una carta con nombre «=…» sale con prefijo \'', async () => {
    const evil = await w.h.prisma.card.create({ data: { externalId: `dem-${RUN}-evil`, setId: w.setId, name: '=HYPERLINK("http://x")', number: '900', rarity: 'Common', rarityCanonical: 'Common', availableFinishes: ['normal'] } });
    await want(await w.customer(), evil.id);
    await w.market(evil.id, 'normal', 123456);
    const r = await api('/admin/reports/demand-gaps/export.csv');
    expect(r.status).toBe(200);
    const text = typeof r.body === 'string' ? r.body : (r as any).text ?? String(r.body);
    const lines = text.trimEnd().split('\n');
    expect(lines[0]).toBe('tipo,card_id,termino,carta,set,acabado,clientes_wishlist,personas_busqueda,dias_busqueda,score,mercado,buylist_hoy');
    const line = lines.find((l: string) => l.includes(evil.id));
    expect(line).toBeDefined();
    expect(line).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(line!.startsWith('carta,')).toBe(true);
    expect(line).toContain(',1234.56,');
    expect(r.headers['content-disposition']).toMatch(/^attachment; filename="demanda-sin-stock-\d{4}-\d{2}-\d{2}\.csv"$/);
    await w.h.prisma.wishlistItem.deleteMany({});
    await w.h.prisma.card.delete({ where: { id: evil.id } }).catch(() => undefined);
  });
});

describe('CSV · nombre con la fecha de America/Mexico_City', () => {
  it('a las 03:00 UTC del 11 ya es 10 en CDMX ⇒ demanda-sin-stock-…-10.csv (no el día UTC)', async () => {
    const csv = await w.h.app.get(DemandGapsService).csv({}, new Date('2027-05-11T03:00:00.000Z'));
    expect(csv.filename).toBe('demanda-sin-stock-2027-05-10.csv');
    expect((await w.h.app.get(DemandGapsService).csv({}, new Date('2027-05-11T07:00:00.000Z'))).filename).toBe('demanda-sin-stock-2027-05-11.csv');
  });
});

describe('F2 — POST /marketing/search-miss con cardId', () => {
  it('cardId inexistente o no-uuid ⇒ 204 y camino de texto (idéntico a hoy)', async () => {
    const term = `${WORD_UNI} unica`;
    expect((await post({ term, kind: 'card', cardId: '99999999-9999-4999-8999-999999999999' })).status).toBe(204);
    expect((await post({ term, kind: 'card', cardId: 'no-es-uuid' }, 'ua-e')).status).toBe(204);
    expect(await w.h.prisma.searchDemandSeen.count()).toBe(0);
    expect(await w.h.prisma.searchNoResultSeen.count({ where: { termNormalized: term } })).toBe(2);
  });
  it('carta CON stock ⇒ 204 sin escritura alguna (DM-4: con un término que SÍ está en el vocabulario, así que quitar el `return` de `stocked` lo pone rojo)', async () => {
    const c = await w.card();
    await w.piece(c.id);
    // El término ES el nombre de una carta del catálogo ⇒ el vocabulario lo permite: si la ruta de `stocked` cayera al camino de texto, escribiría
    // en `SearchNoResultSeen`. (`'whatever'` no lo permitía y el test no distinguía.)
    expect((await post({ term: `${WORD_UNI} unica`, kind: 'card', cardId: c.id })).status).toBe(204);
    expect(await w.h.prisma.searchDemandSeen.count()).toBe(0);
    expect(await w.h.prisma.searchNoResultSeen.count()).toBe(0);
    // Control: el MISMO término sin cardId SÍ escribe (el vocabulario lo permite) ⇒ el 0 de arriba lo causó el `stocked`, no el filtro.
    expect((await post({ term: `${WORD_UNI} unica`, kind: 'card' })).status).toBe(204);
    expect(await w.h.prisma.searchNoResultSeen.count({ where: { termNormalized: `${WORD_UNI} unica` } })).toBe(1);
  });
  it('0 stock ⇒ UNA persona en SearchDemandSeen (hash 16 hex) y el término NO se guarda; mismo hash dos veces = 1; otra IP = 2; otro user-agent NO es otra persona (DM-1)', async () => {
    const term = `${WORD_UNI} unica`;
    for (let i = 0; i < 3; i++) expect((await post({ term, kind: 'card', cardId: cardUni.id })).status).toBe(204);
    let rows = await w.h.prisma.searchDemandSeen.findMany({});
    expect(rows).toHaveLength(1);
    expect(rows[0].cardId).toBe(cardUni.id);
    expect(rows[0].h).toMatch(/^[0-9a-f]{16}$/);
    expect(await w.h.prisma.searchNoResultSeen.count()).toBe(0);
    await post({ term, kind: 'card', cardId: cardUni.id }, 'ua-otro');
    expect(await w.h.prisma.searchDemandSeen.count()).toBe(1); // DM-1: el UA no entra al hash
    expect(await svc.record('x', { ip: '198.51.100.7', userAgent: 'ua-d' }, new Date(), cardUni.id)).toBe(true);
    rows = await w.h.prisma.searchDemandSeen.findMany({});
    expect(rows).toHaveLength(2);
    expect(JSON.stringify(rows)).not.toMatch(/ua-d|ua-otro|127\.0\.0\.1|::1|198\.51/);
  });
  it('cuerpo con campo extra ⇒ 204 sin escritura; interruptor apagado ⇒ nada', async () => {
    expect((await post({ term: 'x', kind: 'card', cardId: cardUni.id, extra: 1 })).status).toBe(204);
    expect(await w.h.prisma.searchDemandSeen.count()).toBe(0);
    await w.h.prisma.configSetting.create({ data: { key: 'marketing_search_log', valueJson: 'off' } });
    expect((await post({ term: 'x', kind: 'card', cardId: cardUni.id })).status).toBe(204);
    expect(await w.h.prisma.searchDemandSeen.count()).toBe(0);
  });
  const UA_OK = 'Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0';
  it('robots: UA vacío o de bot ⇒ 204 sin contar NADA (ni demanda ni texto), por HTTP y por servicio', async () => {
    for (const ua of ['Googlebot/2.1', 'curl/8.0', 'python-requests/2.31', 'HeadlessChrome/120', 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots) preview']) {
      expect((await post({ term: `${WORD_UNI} unica`, kind: 'card', cardId: cardUni.id }, ua)).status).toBe(204);
    }
    expect(await svc.record('x', { ip: '203.0.113.1', userAgent: '' }, new Date(), cardUni.id)).toBe(false);
    expect(await svc.record('x', { ip: '203.0.113.1' }, new Date(), cardUni.id)).toBe(false);
    expect(await w.h.prisma.searchDemandSeen.count()).toBe(0);
    expect(await w.h.prisma.searchNoResultSeen.count()).toBe(0);
    expect(await svc.record('x', { ip: '203.0.113.1', userAgent: UA_OK }, new Date(), cardUni.id)).toBe(true); // un navegador sí
  });
  it('DM-1: 30 user-agent distintos desde UNA IP ⇒ UNA persona; y una persona cuenta como mucho 10 cartas distintas por día', async () => {
    for (let i = 0; i < 30; i++) await svc.record('x', { ip: '192.0.2.50', userAgent: `Mozilla/5.0 variante-${i}` }, new Date(), cardUni.id);
    expect(await w.h.prisma.searchDemandSeen.count({ where: { cardId: cardUni.id } })).toBe(1);
    await w.h.prisma.searchDemandSeen.deleteMany({});
    const ids = Array.from({ length: 14 }, () => randomUuid());
    await w.h.prisma.card.createMany({ data: ids.map((id, i) => ({ id, externalId: `dem-${RUN}-p${i}`, setId: w.setId, name: `PerPerson ${L(RUN)} ${i}`, number: `P${i}`, rarity: 'Common', rarityCanonical: 'Common', availableFinishes: ['normal'] })) });
    for (const id of ids) await svc.record('x', { ip: '192.0.2.51', userAgent: UA_OK }, new Date(), id);
    expect(await w.h.prisma.searchDemandSeen.count()).toBe(10); // las 4 restantes de la MISMA persona no escriben
    expect(await svc.record('x', { ip: '192.0.2.52', userAgent: UA_OK }, new Date(), ids[13])).toBe(true); // otra persona sí
    await w.h.prisma.searchDemandSeen.deleteMany({});
    await w.h.prisma.card.deleteMany({ where: { id: { in: ids } } });
  });
  it('topes: la persona 201 de una carta no escribe (bajo concurrencia)', async () => {
    await Promise.all(Array.from({ length: 230 }, (_, i) => svc.record('x', { ip: `192.0.2.${i}`, userAgent: UA_OK }, new Date(), cardUni.id)));
    expect(await w.h.prisma.searchDemandSeen.count({ where: { cardId: cardUni.id } })).toBe(200);
  });
  it('DM-2: con el tope global de 1000 cartas/día lleno, una carta nueva NO entra, pero las EXENTAS (wishlist activa o Daily ≤ 30 d) sí; una Daily de hace 40 d no exime', async () => {
    const day = today();
    // 1000 cardId de relleno directos en la tabla (sin FK): el tope global cuenta cardId DISTINTOS del día.
    await w.h.prisma.searchDemandSeen.createMany({ data: Array.from({ length: 1000 }, (_, i) => ({ cardId: `relleno-${RUN}-${i}`, day: new Date(`${day}T00:00:00.000Z`), h: 'ffffffffffffffff' })) });
    const [c1, c2, c3] = [await w.card(), await w.card(), await w.card()];
    const rec = (id: string, n: number) => svc.record('x', { ip: `198.18.0.${n}`, userAgent: UA_OK }, new Date(), id);
    expect(await rec(c1.id, 1)).toBe(false); // sin exención: el relleno no deja entrar a la 1001
    await want(await w.customer(), c2.id);
    expect(await rec(c2.id, 2)).toBe(true); // wishlist activa ⇒ exenta
    await w.h.prisma.searchDemandDaily.create({ data: { cardId: c3.id, day: dayAgo(10), people: 3 } });
    expect(await rec(c3.id, 3)).toBe(true); // Daily de hace 10 d ⇒ exenta
    await w.h.prisma.searchDemandDaily.deleteMany({ where: { cardId: c3.id } });
    await w.h.prisma.searchDemandDaily.create({ data: { cardId: c3.id, day: dayAgo(40), people: 3 } });
    await w.h.prisma.searchDemandSeen.deleteMany({ where: { cardId: c3.id } });
    expect(await rec(c3.id, 4)).toBe(false); // Daily de hace 40 d ⇒ no exenta
  });
  it('cierre: hashes → people (Daily) y hashes borrados; idempotente (2 corridas = mismas people)', async () => {
    const d1 = new Date('2027-05-10T18:00:00.000Z');
    for (let i = 0; i < 3; i++) await svc.record('x', { ip: `10.0.0.${i}`, userAgent: 'u' }, d1, cardUni.id);
    expect(await w.h.prisma.searchDemandSeen.count()).toBe(3);
    expect(await svc.closePastDays(new Date('2027-05-11T06:10:00.000Z'))).toBe(1);
    expect(await w.h.prisma.searchDemandSeen.count()).toBe(0); // hashes borrados
    const first = (await w.h.prisma.searchDemandDaily.findMany({})).map((r) => [r.cardId, r.people]);
    expect(first).toEqual([[cardUni.id, 3]]);
    expect(await svc.closePastDays(new Date('2027-05-11T06:11:00.000Z'))).toBe(0);
    expect((await w.h.prisma.searchDemandDaily.findMany({})).map((r) => [r.cardId, r.people])).toEqual(first);
    await w.h.prisma.configSetting.deleteMany({ where: { key: 'search_closed_through' } });
  });
});

describe('demand-match', () => {
  const seedAll = async () => {
    await seedTerm(WORD_UNI, [3, 2]);
    await seedTerm(WORD_AMB, [3, 2]);
  };
  it('único ⇒ matched; varios ⇒ ambiguous; 2 corridas ⇒ mismas filas', async () => {
    await seedAll();
    const job = w.h.app.get(DemandMatchService);
    await job.run();
    const snap = async () => (await w.h.prisma.demandTermMatch.findMany({ orderBy: { termNormalized: 'asc' } })).map((m) => [m.termNormalized, m.status, m.cardId]);
    const first = await snap();
    expect(first).toEqual(
      expect.arrayContaining([
        [WORD_UNI, 'matched', cardUni.id],
        [WORD_AMB, 'ambiguous', null],
      ]),
    );
    await job.run();
    expect(await snap()).toEqual(first);
    // ambiguous ⇒ fila término visible; matched ⇒ no
    const body = await gaps();
    expect(rowOf(body, `term:${WORD_AMB}`)).toMatchObject({ kind: 'term' });
    expect(rowOf(body, `term:${WORD_UNI}`)).toBeUndefined();
  });
  it('ninguna coincidencia ⇒ none (fila término visible)', async () => {
    await seedTerm(WORD_UNI, [3, 2]);
    const spy = jest.spyOn(w.h.app.get(CatalogService), 'searchAllCards').mockResolvedValue({ data: [], page: 1, pageSize: 5, total: 0 } as never);
    await w.h.app.get(DemandMatchService).run();
    spy.mockRestore();
    expect((await w.h.prisma.demandTermMatch.findUniqueOrThrow({ where: { termNormalized: WORD_UNI } })).status).toBe('none');
    expect(rowOf(await gaps(), `term:${WORD_UNI}`)).toMatchObject({ kind: 'term' });
  });
  it('fallo del job ⇒ lanza (la cola reintenta), no marca «última corrida buena», y el endpoint sigue 200 con los matches previos', async () => {
    await seedAll();
    const job = w.h.app.get(DemandMatchService);
    await job.run();
    const ok = await w.h.prisma.configSetting.findUniqueOrThrow({ where: { key: 'demand_match_last_ok' } });
    const spy = jest.spyOn(w.h.app.get(CatalogService), 'searchAllCards').mockRejectedValue(new Error('catálogo caído'));
    await w.h.prisma.demandTermMatch.updateMany({ data: { status: 'ambiguous', cardId: null } }); // fuerza re-evaluación
    await expect(job.run(new Date(Date.now() + 60_000))).rejects.toThrow('catálogo caído');
    spy.mockRestore();
    expect((await w.h.prisma.configSetting.findUniqueOrThrow({ where: { key: 'demand_match_last_ok' } })).valueJson).toBe(ok.valueJson);
    const r = await api('/admin/reports/demand-gaps');
    expect(r.status).toBe(200);
    expect((r.body as any).sources.matchedAt).toBe(new Date(ok.valueJson as string).toISOString());
  });
  it('DM-5: un término que hace lanzar a searchAllCards NO aborta el lote: los demás se evalúan y se marca «última corrida buena»', async () => {
    await seedAll();
    const cat = w.h.app.get(CatalogService);
    const real = cat.searchAllCards.bind(cat);
    const spy = jest.spyOn(cat, 'searchAllCards').mockImplementation(async (q: any) => {
      if (q.q === WORD_AMB) throw new Error('término venenoso');
      return real(q);
    });
    const evaluated = await w.h.app.get(DemandMatchService).run();
    spy.mockRestore();
    expect(evaluated).toBe(1);
    expect((await w.h.prisma.demandTermMatch.findMany({})).map((m) => [m.termNormalized, m.status])).toEqual([[WORD_UNI, 'matched']]);
    expect(await w.h.prisma.configSetting.findUnique({ where: { key: 'demand_match_last_ok' } })).not.toBeNull();
  });
  it('un término ya matched no se re-evalúa antes de 30 días', async () => {
    await seedTerm(WORD_UNI, [3, 2]);
    const job = w.h.app.get(DemandMatchService);
    await job.run();
    const spy = jest.spyOn(w.h.app.get(CatalogService), 'searchAllCards');
    await job.run();
    expect(spy).not.toHaveBeenCalled(); // matched hoy ⇒ no se re-evalúa
    await w.h.prisma.demandTermMatch.update({ where: { termNormalized: WORD_UNI }, data: { matchedAt: new Date(Date.now() - 31 * 86400_000) } });
    await job.run();
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe('retención', () => {
  it('SearchDemandDaily: > 90 d borra; bajo el umbral > 30 d borra; sobre el umbral ≤ 90 d se queda; DemandTermMatch huérfano se borra', async () => {
    const d = (n: number) => new Date(Date.parse(`${today()}T00:00:00.000Z`) - n * 86400_000);
    const [a, b] = [await w.card(), await w.card()];
    await w.h.prisma.searchDemandDaily.createMany({
      data: [
        { cardId: a.id, day: d(40), people: 1 }, // bajo umbral, > 30 d ⇒ borra
        { cardId: a.id, day: d(2), people: 1 },
        { cardId: b.id, day: d(40), people: 4 }, // sobre umbral (4+2 en 2 días) ≤ 90 ⇒ se queda
        { cardId: b.id, day: d(3), people: 2 },
        { cardId: b.id, day: d(120), people: 9 }, // > 90 ⇒ borra
      ],
    });
    await seedTerm('vivo', [1]);
    await w.h.prisma.demandTermMatch.createMany({ data: [{ termNormalized: 'vivo', status: 'none', matchedAt: new Date() }, { termNormalized: 'huerfano', status: 'none', matchedAt: new Date() }] });
    await svc.purgeExpired(new Date());
    const left = (await w.h.prisma.searchDemandDaily.findMany({ orderBy: [{ cardId: 'asc' }, { day: 'asc' }] })).map((r) => [r.cardId === a.id ? 'a' : 'b', r.people]).sort();
    expect(left).toEqual([['a', 1], ['b', 2], ['b', 4]]);
    expect((await w.h.prisma.demandTermMatch.findMany({})).map((m) => m.termNormalized)).toEqual(['vivo']);
  });
});

function randomUuid(): string {
  const hex = randomBytes(16).toString('hex').split('');
  hex[12] = '4';
  hex[16] = '8';
  const h = hex.join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
