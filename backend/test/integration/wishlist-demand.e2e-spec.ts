/**
 * wishlist-demand.e2e-spec.ts — rev v1.87⟨wishlist⟩ (API_CONTRACT §WSH.8): la «lista de compra casi segura» del dueño y el
 * borrado de la cuenta, contra la app REAL y Postgres real.
 *
 *  WSH-T8 (808, la parte de la demanda) · T17 (817) · T18 (818, 826) · T19 (819, 820) · T20 (821, lista exacta de claves
 *  y columnas) · T21 (822) · T35 (e2e: `pct` en puntos y el CSV escribe `-9.5`).
 *
 * ⚠️ La demanda agrega TODA la base: las filas de esta suite se localizan por `cardId` (cartas propias de la corrida).
 */
import { createWshWorld, WshCard, WshPerson, WshWorld } from './helpers/wishlist-db';

let w: WshWorld;

beforeAll(async () => {
  w = await createWshWorld();
});
afterAll(async () => {
  await w?.close();
});
beforeEach(async () => {
  await w.resetDials();
  // La demanda es GLOBAL: se parte sin deseos de otras pruebas de esta suite.
  await w.h.prisma.wishlistItem.deleteMany({});
});

const want = async (p: WshPerson, cardId: string, maxPct: 5 | 10 | 16, finish = 'normal') => {
  const r = await w.h.api('POST', '/wishlist', { token: p.token, json: { cardId, finish, maxPct } });
  expect(r.status).toBe(201);
};
const demand = (q = '') => w.h.api('GET', `/admin/reports/wishlist-demand${q}`, { token: w.adminToken });
const csv = (q = '') => w.h.api('GET', `/admin/reports/wishlist-demand/export.csv${q}`, { token: w.adminToken });
const rowOf = (body: any, c: WshCard) => body.rows.find((r: any) => r.cardId === c.id);

describe('WSH-T18 — acceso (818, 826)', () => {
  it('operador y cliente ⇒ 403 en la demanda y en su CSV', async () => {
    const cust = await w.customer();
    for (const token of [w.operatorToken, cust.token]) {
      expect((await w.h.api('GET', '/admin/reports/wishlist-demand', { token })).status).toBe(403);
      expect((await w.h.api('GET', '/admin/reports/wishlist-demand/export.csv', { token })).status).toBe(403);
    }
    expect((await w.h.api('GET', '/admin/reports/wishlist-demand')).status).toBe(401);
  });

  it('el margen deseado lo mueve solo el súper-admin (826)', async () => {
    const cust = await w.customer();
    const op = await w.h.api('PUT', '/admin/settings', { token: w.operatorToken, json: { wishlistTargetMarginPct: 20 } });
    expect(op.status).toBe(403);
    const cu = await w.h.api('PUT', '/admin/settings', { token: cust.token, json: { wishlistTargetMarginPct: 20 } });
    expect(cu.status).toBe(403);
    const ok = await w.h.api('PUT', '/admin/settings', { token: w.adminToken, json: { wishlistTargetMarginPct: 20 } });
    expect(ok.status).toBe(200);
  });
});

describe('WSH-T19 / T8 / T22 por HTTP — contenido, orden y cifras (819, 820, 827, 808)', () => {
  it('criterio 827 de punta a punta: mercado $1,000, normal $1,150 sin IVA, una cuenta por nivel', async () => {
    const c = await w.card();
    await w.market(c.id, 'normal', 100000);
    // precio normal $1,150: override de VENTA de la variante (M-30), la misma fuente que publicaría la pieza
    await w.h.prisma.variantPriceOverride.create({
      data: { cardId: c.id, productType: 'raw', gradeKey: 'raw:NM', finish: 'normal', sellOverrideCents: 115000 },
    });
    for (const p of [5, 10, 16] as const) await want(await w.customer(), c.id, p);
    const r = await demand();
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    const row = rowOf(r.body, c);
    expect(row.wantedCount).toBe(3);
    expect(row.tiers).toEqual([
      { maxPct: 16, accounts: 1, maxDisplayCents: 116000, ceilingCents: 86957 },
      { maxPct: 10, accounts: 1, maxDisplayCents: 110000, ceilingCents: 82459 },
      { maxPct: 5, accounts: 1, maxDisplayCents: 105000, ceilingCents: 78711 },
    ]);
    expect(row.mainCeilingCents).toBe(86957);
    expect(row.marketCents).toBe(100000);
    expect(row.normalPrice).toEqual({ listCents: 115000, displayCents: 133400 });
    expect(row.buyersAtNormalPrice).toBe(0);
    expect(r.body.dials).toEqual({ ivaMode: 'with_iva', ivaRatePct: 16, ivaTransferPct: 100, targetMarginPct: 15, marginBasis: 'cost' });

    await w.setDial('wishlist_max_iva_mode', 'without_iva');
    const r2 = rowOf((await demand()).body, c);
    expect(r2.tiers.map((t: any) => t.ceilingCents)).toEqual([100000, 95652, 91304]);
    expect(r2.tiers.map((t: any) => t.maxDisplayCents)).toEqual([134560, 127600, 121800]);
    expect(r2.buyersAtNormalPrice).toBe(1);

    await w.setDial('wishlist_max_iva_mode', 'with_iva');
    await w.setDial('wishlist_target_margin_pct', 20);
    expect(rowOf((await demand()).body, c).tiers[0].ceilingCents).toBe(83333);
  });

  it('solo cartas SIN piezas vendibles; orden por defecto; sin mercado al final con `null` (ni 0)', async () => {
    const withStock = await w.card();
    await w.market(withStock.id, 'normal', 100000);
    await w.piece(withStock.id, { listCents: 90000 });
    const two = await w.card();
    await w.market(two.id, 'normal', 50000);
    const oneHigh = await w.card();
    await w.market(oneHigh.id, 'normal', 300000);
    const oneLow = await w.card();
    await w.market(oneLow.id, 'normal', 10000);
    const noMarket = await w.card();
    const people = [await w.customer(), await w.customer(), await w.customer()];
    await want(people[0], withStock.id, 10);
    await want(people[0], two.id, 10);
    await want(people[1], two.id, 5);
    await want(people[0], oneHigh.id, 10);
    await want(people[1], oneLow.id, 16);
    await want(people[0], noMarket.id, 16);
    await want(people[1], noMarket.id, 5);
    await want(people[2], noMarket.id, 5);
    const r = await demand();
    const ids = r.body.rows.map((x: any) => x.cardId);
    expect(ids).not.toContain(withStock.id);
    expect(ids).toEqual([two.id, oneHigh.id, oneLow.id, noMarket.id]);
    const nm = rowOf(r.body, noMarket);
    expect(nm.wantedCount).toBe(3);
    expect(nm.marketCents).toBeNull();
    expect(nm.mainCeilingCents).toBeNull();
    expect(nm.marginAtMarket).toBeNull();
    expect(nm.buyersAtNormalPrice).toBeNull();
    expect(nm.normalPrice).toBeNull();
    expect(nm.tiers).toEqual([
      { maxPct: 16, accounts: 1, maxDisplayCents: null, ceilingCents: null },
      { maxPct: 5, accounts: 2, maxDisplayCents: null, ceilingCents: null },
    ]);
    // ordenar por otra columna
    const byMarket = await demand('?sort=market&dir=asc');
    expect(byMarket.body.rows.map((x: any) => x.cardId)).toEqual([oneLow.id, two.id, oneHigh.id, noMarket.id]);
    const bad = await demand('?sort=nombre');
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.field).toBe('sort');
  });

  it('cuentan los deseos pausados y sin verificar; no los de cuentas no activas', async () => {
    const c = await w.card();
    const paused = await w.customer();
    const unverified = await w.customer({ verified: false });
    const blocked = await w.customer();
    for (const p of [paused, unverified, blocked]) await want(p, c.id, 10);
    await w.h.api('PUT', '/wishlist/alerts', { token: paused.token, json: { paused: true } });
    await w.h.prisma.user.update({ where: { id: blocked.id }, data: { status: 'blocked' } });
    expect(rowOf((await demand()).body, c).wantedCount).toBe(2);
  });

  it('sellados: solo conteo de correos DISTINTOS pendientes (P-WSH-9)', async () => {
    const c = await w.card();
    const tcg = 800000000 + Math.floor(Math.random() * 99999999);
    for (const email of [`x-${w.run}@e2e.local`, `x-${w.run}@e2e.local`, `y-${w.run}@e2e.local`])
      await w.h.prisma.sealedRestockSubscription.create({ data: { email, cardId: c.id, tcgplayerProductId: tcg, sealedCondition: 'mint', sealedSubtype: 'box' } });
    await w.piece(c.id, { productType: 'sealed', rawCondition: null, sealedSubtype: 'box', sealedCondition: 'mint', tcgplayerProductId: tcg, sealedProductName: `Caja ${w.run}`, status: 'in_custody', listCents: null });
    const r = await demand();
    const s = r.body.sealed.find((x: any) => x.productName === `Caja ${w.run}`);
    expect(s).toEqual({ productName: `Caja ${w.run}`, sealedSubtype: 'box', sealedCondition: 'mint', waitingCount: 2 });
  });
});

describe('WSH-T20 / T21 / T35 — sin datos personales, CSV = JSON, `pct` en puntos', () => {
  it('claves de la respuesta EXACTAS; columnas del CSV EXACTAS; ningún correo ni id de cuenta', async () => {
    const a = await w.customer();
    const c = await w.card();
    await w.market(c.id, 'normal', 100000);
    await want(a, c.id, 5);
    const r = await demand();
    expect(Object.keys(r.body).sort()).toEqual(['dials', 'generatedAt', 'rows', 'sealed']);
    expect(Object.keys(r.body.dials).sort()).toEqual(['ivaMode', 'ivaRatePct', 'ivaTransferPct', 'marginBasis', 'targetMarginPct']);
    const row = rowOf(r.body, c);
    expect(Object.keys(row).sort()).toEqual(
      ['buyersAtNormalPrice', 'buylistTodayCents', 'cardId', 'cardName', 'finish', 'imageSmallUrl', 'mainCeilingCents', 'marginAtMarket', 'marketCents', 'normalPrice', 'number', 'setName', 'tiers', 'wantedCount'].sort(),
    );
    for (const t of row.tiers) expect(Object.keys(t).sort()).toEqual(['accounts', 'ceilingCents', 'maxDisplayCents', 'maxPct']);
    expect(r.text).not.toContain(a.email);
    expect(r.text).not.toContain(a.id);
    const wi = await w.h.prisma.wishlistItem.findFirstOrThrow({ where: { userId: a.id } });
    expect(r.text).not.toContain(wi.id);

    const f = await csv();
    expect(f.status).toBe(200);
    expect(String(f.headers['content-type'])).toContain('text/csv');
    const header = f.text.split('\n')[0].trim();
    expect(header).toBe(
      'carta,set,numero,acabado,la_buscan,cuentas_16,max_16,techo_16,cuentas_10,max_10,techo_10,cuentas_5,max_5,techo_5,techo_principal,mercado,normal_sin_iva,normal_con_iva,pagan_normal,margen_mercado,margen_mercado_pct,buylist_hoy',
    );
    expect(f.text).not.toContain(a.email);
    expect(f.text).not.toContain(a.id);
  });

  it('T35: una cuenta al 5 % ⇒ {-9483, -9.5}; el CSV escribe -94.83 y -9.5; una al 16 % ⇒ {0, 0}', async () => {
    const a = await w.customer();
    const c5 = await w.card();
    await w.market(c5.id, 'normal', 100000);
    await want(a, c5.id, 5);
    const c16 = await w.card();
    await w.market(c16.id, 'normal', 100000);
    await want(a, c16.id, 16);
    const r = await demand();
    expect(rowOf(r.body, c5).marginAtMarket).toEqual({ cents: -9483, pct: -9.5 });
    expect(rowOf(r.body, c16).marginAtMarket).toEqual({ cents: 0, pct: 0 });
    const line = (await csv()).text.split('\n').find((l) => l.startsWith(`"${c5.name}"`) || l.startsWith(c5.name))!;
    expect(line).toContain(',-94.83,-9.5,');
  });

  it('T21: el CSV trae las mismas filas y el mismo orden que el JSON con el `sort` activo; pesos con 2 decimales', async () => {
    const people = [await w.customer(), await w.customer()];
    const cs: WshCard[] = [];
    for (const m of [100000, 250000, 75000]) {
      const c = await w.card();
      await w.market(c.id, 'normal', m);
      cs.push(c);
    }
    await want(people[0], cs[0].id, 10);
    await want(people[1], cs[0].id, 16);
    await want(people[0], cs[1].id, 5);
    await want(people[1], cs[2].id, 10);
    for (const q of ['', '?sort=market&dir=asc', '?sort=ceiling&dir=desc', '?sort=buyers']) {
      const j = await demand(q);
      const f = await csv(q);
      const names = f.text.trim().split('\n').slice(1).filter((l) => l && !l.startsWith('sellados')).map((l) => l.split(',')[0].replace(/"/g, ''));
      const jsonNames = j.body.rows.map((x: any) => x.cardName);
      expect(names.slice(0, jsonNames.length)).toEqual(jsonNames);
    }
    const f = await csv();
    const l0 = f.text.split('\n').find((l) => l.includes(cs[0].name))!;
    expect(l0).toContain(',1000.00,'); // mercado en pesos con dos decimales
  });
});

describe('WSH-T17 — borrar la cuenta borra la lista (817)', () => {
  it('borrado suave ⇒ 0 WishlistItem/WishlistMail de la cuenta, 0 suscripciones de sellado con su correo previo; la demanda baja', async () => {
    const a = await w.customer();
    const c = await w.card();
    await want(a, c.id, 10);
    await w.h.prisma.wishlistMail.create({ data: { userId: a.id, locale: 'es', itemCount: 1 } });
    await w.h.prisma.sealedRestockSubscription.create({ data: { email: a.email, cardId: c.id, sealedCondition: 'mint' } });
    await w.h.prisma.sealedRestockSubscription.create({ data: { email: `otro-${w.run}@e2e.local`, userId: a.id, cardId: c.id, sealedCondition: 'mint' } });
    expect(rowOf((await demand()).body, c).wantedCount).toBe(1);
    // una orden liquidada fuerza el borrado SUAVE (con transacciones)
    await w.h.prisma.order.create({
      data: { userId: a.id, status: 'settled', subtotalCents: 100, processingFeeCents: 0, ivaCents: 0, totalCents: 100, priceConvention: 'IVA_INCLUSIVE' },
    });
    const del = await w.h.api('DELETE', `/admin/users/${a.id}`, { token: w.adminToken });
    expect(del.status).toBe(200);
    expect(del.body.mode).toBe('soft');
    expect(await w.h.prisma.wishlistItem.count({ where: { userId: a.id } })).toBe(0);
    expect(await w.h.prisma.wishlistMail.count({ where: { userId: a.id } })).toBe(0);
    expect(await w.h.prisma.sealedRestockSubscription.count({ where: { OR: [{ email: a.email }, { userId: a.id }] } })).toBe(0);
    expect(rowOf((await demand()).body, c)).toBeUndefined();
  });
});
