/**
 * envio-v2.e2e-spec.ts — 💰 REGLA DE ENVÍO v2 (API_CONTRACT §4-G.12, v1.109) contra Postgres REAL, app Nest completa por
 * HTTP. Propiedad: backend. Pruebas escritas ANTES del código (rojas sobre `5c7e652b`).
 *
 *  ENV-2 `shippingRule` en todo `200` del quote (también 100 % podado: `kind:null`); solo cartas ⇒ 10000 (v1.109.1: dial exhibido).
 *  ENV-3 `session` = `quote` en cada caso de ENV-1; mover un dial tras la sesión no mueve lo cobrado.
 *  ENV-4 el retiro sigue en 20300 al mover los tres diales; el directo no se mueve al mover `shipping_fee_cents`.
 *  ENV-5 diales por `GET/PUT /admin/settings`: defaults, validadores, bitácora, operador ⇒ `403`.
 *  ENV-6 `GET /checkout/shipping-rule` sin sesión ⇒ `{10000, 17500, 400000}` + `Cache-Control: public, max-age=300`.
 *  ENV-7 dos sellados de 208906 con `E = 0` (cobrados por la regla real): reembolsos por pieza + remanente ⇒
 *        `Σ = totalCents`, sin `23514`; canario: IVA remanente al envío ⇒ `23514`.
 *  ENV-8 M-91 siembra los tres diales con su default y ⛔ NO copia `shipping_fee_cents` (neto vs exhibido); idempotente.
 *
 * v1.109.1 (P-ENV-1 cerrada): los diales de envío directo son EXHIBIDOS ⇒ `E` = dial exacto (10000 / 17500).
 *
 * Deterministas (N=1 dicho como tal). Los diales se restauran a sus defaults en `beforeEach`/`afterAll`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '@prisma/client';
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { AccDb, FUNDA_DIMS } from './helpers/accessories-b-db';
import { ShipPrepDb } from './helpers/ship-prep-db';
import { SettingKey, SettingKeyType } from '../../src/modules/settings/settings.constants';
import { SettingsService } from '../../src/modules/settings/settings.service';
import { computeDirectShipBreakdown, computeShipmentBreakdown, displayPriceCentsOf, itemMissingRefundComponents } from '../../src/common/money';
import { E2E_FOLIOS, E2E_USERS } from '../../prisma/e2e-fixtures';

const RUN = `env2${Date.now().toString(36)}`;
const E_CARDS = 10000;
const E_SEALED = 17500;
/** El retiro desde bóveda: `shipping_fee_cents` 17500 NETO ⇒ 20300 exhibido (sin cambio en v1.109.1). */
const E_WITHDRAWAL = 20300;
const T = 400000;
const MIGRATIONS = join(__dirname, '..', '..', 'prisma', 'migrations');
const M91_DIR = readdirSync(MIGRATIONS).find((d) => /_m91_envio_v2_dials$/.test(d));
const M91 = M91_DIR ? readFileSync(join(MIGRATIONS, M91_DIR, 'migration.sql'), 'utf8') : '';
const ROLLBACK = Symbol('rollback');
/**
 * Las claves nuevas van LITERALES (no `SettingKey.*`) a propósito: así la suite corre también sobre el árbol de ANTES
 * (`5c7e652b`, sin las claves) y cada prueba se pone roja por CONDUCTA, no por no compilar. ENV-5 (unitaria) fija que
 * `SettingKey` las nombra igual.
 */
const K_CARDS = 'direct_ship_cards_fee_cents' as SettingKeyType;
const K_SEALED = 'direct_ship_sealed_fee_cents' as SettingKeyType;
const K_FREE = 'direct_ship_free_from_cents' as SettingKeyType;
const DEFAULTS: Record<string, unknown> = { [K_CARDS]: 10000, [K_SEALED]: 17500, [K_FREE]: 400000, [SettingKey.SHIPPING_FEE_CENTS]: 17500 };

describe('💰 §4-G.12 — regla de envío v2 (Postgres real)', () => {
  let h: E2EHarness;
  let acc: AccDb;
  let prep: ShipPrepDb;
  let fee: Awaited<ReturnType<SettingsService['getStripeFee']>>;
  let customerToken: string;
  let capBefore: unknown;
  const bd = (S: number, E: number) => computeDirectShipBreakdown(S, E, 16, fee);

  const setDial = (key: SettingKeyType, value: unknown) =>
    h.prisma.configSetting.upsert({
      where: { key },
      create: { key, valueJson: value as Prisma.InputJsonValue, updatedBy: RUN },
      update: { valueJson: value as Prisma.InputJsonValue, updatedBy: RUN },
    });
  const resetDials = async () => {
    for (const [k, v] of Object.entries(DEFAULTS)) await setDial(k as SettingKeyType, v);
  };

  /**
   * Pieza vendible cuyo `P` cotizado es `cents`. El override por pieza es NETO (`P = L + round(L·t·r)`, §4.44.b), así que
   * se busca el `L` que exhibe `cents`; si ningún `L` lo exhibe exacto (p. ej. 50000 con r=16) y `exact` es `false`, se toma
   * el primero por encima y se devuelve el `P` real. Se COMPRUEBA contra el quote: sin eso, un `S` del contrato no es ese `S`.
   */
  const piece = async (productType: 'raw' | 'graded' | 'sealed', cents: number, exact = true) => {
    let L = Math.floor(cents / 1.16) - 2;
    while (displayPriceCentsOf(L, 100, 16) < cents) L += 1;
    const P = displayPriceCentsOf(L, 100, 16);
    if (exact && P !== cents) throw new Error(`fixture: ningún L exhibe exactamente ${cents}`);
    const it = await acc.mkItem({ productType, listPriceCents: L });
    const q = await acc.quote({ inventoryItemIds: [it.id] });
    if (q.status !== 200 || q.body.items?.[0]?.unitPriceCents !== P) {
      throw new Error(`fixture: ${productType} con listPriceCents=${L} cotiza ${q.status} ${JSON.stringify(q.body.items?.[0]?.unitPriceCents ?? q.body)} (esperado ${P})`);
    }
    return { id: it.id, P };
  };

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    acc = new AccDb(h, RUN);
    await acc.init();
    prep = new ShipPrepDb(h, `${RUN}p`);
    await prep.init();
    fee = await h.app.get(SettingsService).getStripeFee();
    customerToken = await h.login(E2E_USERS.customer.email, E2E_USERS.customer.password);
    capBefore = (await h.prisma.configSetting.findUnique({ where: { key: SettingKey.OPERATOR_REFUND_CAP_24H_CENTS } }))?.valueJson ?? null;
  });

  afterAll(async () => {
    if (h) {
      await resetDials();
      if (capBefore !== null) await setDial(SettingKey.OPERATOR_REFUND_CAP_24H_CENTS, capBefore);
    }
    await prep?.cleanup();
    await acc?.cleanup();
    await h?.close();
  });

  beforeEach(async () => {
    await resetDials();
    await acc.clearBoxes();
  });

  // ================================================================ ENV-2

  describe('ENV-2 — `shippingRule` en todo 200 del quote', () => {
    it('carrito solo de cartas ⇒ envío 10000 y `kind: cards_only` (v1.109.3: con umbral y «te falta»)', async () => {
      const it1 = await piece('raw', 50000, false);
      const q = await acc.quote({ inventoryItemIds: [it1.id] });
      expect(q.status).toBe(200);
      expect(q.body.breakdown).toEqual(bd(it1.P, E_CARDS));
      expect(q.body.shippingRule).toEqual({ kind: 'cards_only', freeFromCents: T, freeShippingRemainingCents: T - it1.P, freeShippingApplied: false, boxFeeApplies: false });
    });

    it('100 % podado ⇒ breakdown en ceros (envío 0) y `shippingRule.kind: null`', async () => {
      const ghost = '00000000-0000-4000-8000-0000000e2e01';
      const q = await acc.quote({ inventoryItemIds: [ghost] });
      expect(q.status).toBe(200);
      expect(q.body.items).toEqual([]);
      expect(q.body.breakdown.shippingFeeCents).toBe(0);
      expect(q.body.breakdown.totalCents).toBe(0);
      expect(q.body.shippingRule).toEqual({ kind: null, freeFromCents: null, freeShippingRemainingCents: null, freeShippingApplied: false, boxFeeApplies: false });
    });

    it('sellado bajo el umbral ⇒ `freeShippingRemainingCents` = T − subtotal del MISMO breakdown', async () => {
      const s1 = await piece('sealed', 150000);
      const q = await acc.quote({ inventoryItemIds: [s1.id] });
      expect(q.body.shippingRule).toEqual({ kind: 'sealed', freeFromCents: T, freeShippingRemainingCents: T - q.body.breakdown.subtotalCents, freeShippingApplied: false, boxFeeApplies: false });
      expect(q.body.shippingRule.freeShippingRemainingCents).toBe(250000);
    });
  });

  // ================================================================ ENV-3

  describe('ENV-3 — `session` cobra con la misma regla que `quote` (casos de ENV-1)', () => {
    type Case = {
      name: string;
      build: () => Promise<{ cart: Record<string, unknown>; S: number }>;
      /** Función de `S` cuando el `S` real sale del fixture (`piece(…, false)`). */
      fee: number | ((S: number) => number);
      rule: Record<string, unknown> | ((S: number) => Record<string, unknown>);
      box?: boolean;
    };
    // v1.109.3 (dueño 2026-10-25, «Envío gratis desde MX$4,000 para CUALQUIER pedido»): S ≥ T ⇒ 0 también en cartas.
    const cards = (t: 'raw' | 'graded', S: number): Case => ({
      name: `solo ${t} con S≈${S} ⇒ ${S >= T ? 0 : E_CARDS}`,
      build: async () => {
        const p = await piece(t, S, false);
        return { cart: { inventoryItemIds: [p.id] }, S: p.P };
      },
      fee: (s) => (s >= T ? 0 : E_CARDS),
      rule: (s) => ({ kind: 'cards_only', freeFromCents: T, freeShippingRemainingCents: Math.max(0, T - s), freeShippingApplied: s >= T, boxFeeApplies: false }),
    });
    const accessory = async (priceCents: number) => (await acc.mkAccessory({ priceCents, stockQty: 5, dims: FUNDA_DIMS })).id;
    const CASES: Case[] = [
      cards('raw', 50000),
      cards('raw', 500000),
      cards('graded', 50000),
      cards('graded', 500000),
      {
        name: 'pentester: cartas con S ≥ T + accesorio barato ⇒ 0 (sin el accesorio también: ver cards(raw, 500000))',
        build: async () => {
          const p = await piece('raw', 400000, false);
          return { cart: { inventoryItemIds: [p.id], accessoryLines: [{ accessoryId: await accessory(100), quantity: 1 }] }, S: p.P + 100 };
        },
        fee: 0,
        rule: { kind: 'sealed', freeFromCents: T, freeShippingRemainingCents: 0, freeShippingApplied: true, boxFeeApplies: false },
      },
      {
        name: 'sellado S=399999 ⇒ 17500, falta 1',
        build: async () => ({ cart: { inventoryItemIds: [(await piece('sealed', 399999)).id] }, S: 399999 }),
        fee: E_SEALED,
        rule: { kind: 'sealed', freeFromCents: T, freeShippingRemainingCents: 1, freeShippingApplied: false, boxFeeApplies: false },
      },
      {
        name: 'sellado S=400000 ⇒ 0',
        build: async () => ({ cart: { inventoryItemIds: [(await piece('sealed', 400000)).id] }, S: 400000 }),
        fee: 0,
        rule: { kind: 'sealed', freeFromCents: T, freeShippingRemainingCents: 0, freeShippingApplied: true, boxFeeApplies: false },
      },
      {
        name: 'carta + sellado con S ≥ T ⇒ 0',
        build: async () => ({ cart: { inventoryItemIds: [(await piece('raw', 100000)).id, (await piece('sealed', 300000)).id] }, S: 400000 }),
        fee: 0,
        rule: { kind: 'sealed', freeFromCents: T, freeShippingRemainingCents: 0, freeShippingApplied: true, boxFeeApplies: false },
      },
      {
        name: 'carta + energía ⇒ 17500',
        build: async () => {
          const fire = await acc.setEnergy('fire', { stockQty: 20 });
          return { cart: { inventoryItemIds: [(await piece('raw', 49500)).id], accessoryLines: [{ accessoryId: fire, quantity: 1 }] }, S: 50000 };
        },
        fee: E_SEALED,
        rule: { kind: 'sealed', freeFromCents: T, freeShippingRemainingCents: T - 50000, freeShippingApplied: false, boxFeeApplies: false },
      },
      {
        name: 'caja 35000 bajo T ⇒ 35000',
        build: async () => {
          await acc.setBoxes([{ code: 'grande', l: 30, w: 20, h: 10, fee: 35000 }]);
          return { cart: { accessoryLines: [{ accessoryId: await accessory(10000), quantity: 1 }] }, S: 10000 };
        },
        fee: 35000,
        box: true,
        // v1.109.5: caja grande ⇒ sin «te faltan» (`null`), bajo y sobre T.
        rule: { kind: 'sealed', freeFromCents: T, freeShippingRemainingCents: null, freeShippingApplied: false, boxFeeApplies: true },
      },
      {
        name: 'caja 35000 sobre T ⇒ 35000 (conserva su tarifa; v1.109.2: no es «gratis»)',
        build: async () => {
          await acc.setBoxes([{ code: 'grande', l: 30, w: 20, h: 10, fee: 35000 }]);
          return { cart: { inventoryItemIds: [(await piece('sealed', 400000)).id], accessoryLines: [{ accessoryId: await accessory(10000), quantity: 1 }] }, S: 410000 };
        },
        fee: 35000,
        box: true,
        rule: { kind: 'sealed', freeFromCents: T, freeShippingRemainingCents: null, freeShippingApplied: false, boxFeeApplies: true },
      },
      {
        name: 'caja 15000 bajo T ⇒ 17500',
        build: async () => {
          await acc.setBoxes([{ code: 'chica', l: 30, w: 20, h: 10, fee: 15000 }]);
          return { cart: { accessoryLines: [{ accessoryId: await accessory(10000), quantity: 1 }] }, S: 10000 };
        },
        fee: E_SEALED,
        box: true,
        rule: { kind: 'sealed', freeFromCents: T, freeShippingRemainingCents: T - 10000, freeShippingApplied: false, boxFeeApplies: false },
      },
      {
        name: 'caja 15000 sobre T ⇒ 0',
        build: async () => {
          await acc.setBoxes([{ code: 'chica', l: 30, w: 20, h: 10, fee: 15000 }]);
          return { cart: { inventoryItemIds: [(await piece('sealed', 400000)).id], accessoryLines: [{ accessoryId: await accessory(10000), quantity: 1 }] }, S: 410000 };
        },
        fee: 0,
        box: true,
        rule: { kind: 'sealed', freeFromCents: T, freeShippingRemainingCents: 0, freeShippingApplied: true, boxFeeApplies: false },
      },
      {
        name: 'caja 18000 bajo T ⇒ 18000 (v1.109.1: con E_sellado = 17500 la caja grande entra antes)',
        build: async () => {
          await acc.setBoxes([{ code: 'media', l: 30, w: 20, h: 10, fee: 18000 }]);
          return { cart: { accessoryLines: [{ accessoryId: await accessory(10000), quantity: 1 }] }, S: 10000 };
        },
        fee: 18000,
        box: true,
        rule: { kind: 'sealed', freeFromCents: T, freeShippingRemainingCents: null, freeShippingApplied: false, boxFeeApplies: true },
      },
    ];

    it.each(CASES.map((c) => [c.name, c] as const))('%s — quote = session = Order', async (_n, c) => {
      const { cart, S } = await c.build();
      const fee = typeof c.fee === 'function' ? c.fee(S) : c.fee;
      const rule = typeof c.rule === 'function' ? c.rule(S) : c.rule;
      const q = await acc.quote(cart);
      expect(q.status).toBe(200);
      expect(q.body.breakdown).toEqual(bd(S, fee));
      expect(q.body.shippingRule).toEqual(rule);
      const s = await acc.session(cart);
      expect(s.status).toBe(201);
      expect(s.body.breakdown).toEqual(q.body.breakdown);
      const order = await h.prisma.order.findUniqueOrThrow({ where: { id: s.body.orderId } });
      expect(order.shippingFeeCents).toBe(fee);
      expect(order.subtotalCents).toBe(S);
      expect(order.totalCents).toBe(q.body.breakdown.totalCents);
      if (c.box) {
        // §4-G.12 paso 3: `shippingBoxSnapshot.baseFeeCents = E_sellado` (también sobre el umbral).
        expect((order.shippingBoxSnapshot as { baseFeeCents: number }).baseFeeCents).toBe(E_SEALED);
      }
    });

    it('mover los diales DESPUÉS de la sesión no mueve lo cobrado (pedido congelado; liquida con su total)', async () => {
      const it1 = await piece('raw', 50000, false);
      const s = await acc.session({ inventoryItemIds: [it1.id] });
      expect(s.status).toBe(201);
      const before = await h.prisma.order.findUniqueOrThrow({ where: { id: s.body.orderId } });
      expect(before.shippingFeeCents).toBe(E_CARDS);
      await setDial(K_CARDS, 50000);
      await setDial(K_SEALED, 1);
      await setDial(K_FREE, 1);
      await acc.settle(s);
      const after = await h.prisma.order.findUniqueOrThrow({ where: { id: s.body.orderId } });
      expect(after.status).toBe('settled');
      expect({ e: after.shippingFeeCents, t: after.totalCents, i: after.ivaCents, f: after.processingFeeCents }).toEqual({
        e: before.shippingFeeCents,
        t: before.totalCents,
        i: before.ivaCents,
        f: before.processingFeeCents,
      });
    });
  });

  // ================================================================ ENV-4

  describe('ENV-4 — retiro desde bóveda y envío directo, dos diales distintos', () => {
    let addressId: string;
    let custSettledId: string;
    beforeAll(async () => {
      const customer = await h.prisma.user.findUniqueOrThrow({ where: { email: E2E_USERS.customer.email } });
      addressId = (await prep.mkAddress(customer.id)).id;
      custSettledId = (await h.prisma.inventoryItem.findUniqueOrThrow({ where: { folio: E2E_FOLIOS.custSettled } })).id;
    });
    afterAll(async () => {
      await h.prisma.address.deleteMany({ where: { id: addressId } });
    });
    const withdrawalQuote = () => h.api('POST', '/shipments/quote', { token: customerToken, json: { inventoryItemIds: [custSettledId], addressId } });

    it('mover los tres diales nuevos ⇒ el retiro sigue en 20300', async () => {
      const r0 = await withdrawalQuote();
      expect(r0.status).toBe(200);
      expect(r0.body.breakdown.subtotalCents).toBe(E_WITHDRAWAL);
      await setDial(K_CARDS, 1);
      await setDial(K_SEALED, 99999);
      await setDial(K_FREE, 1);
      const r1 = await withdrawalQuote();
      expect(r1.body.breakdown).toEqual(r0.body.breakdown);
      expect(r1.body.breakdown).toMatchObject({ subtotalCents: E_WITHDRAWAL, totalCents: computeShipmentBreakdown(E_WITHDRAWAL, 16, fee).totalCents });
    });

    it('mover `shipping_fee_cents` ⇒ el retiro se mueve y el directo NO (cartas 10000, sellado 17500)', async () => {
      await setDial(SettingKey.SHIPPING_FEE_CENTS, 50000);
      const r = await withdrawalQuote();
      expect(r.body.breakdown.subtotalCents).toBe(58000);
      const c = await piece('raw', 50000, false);
      const s1 = await piece('sealed', 60000);
      expect((await acc.quote({ inventoryItemIds: [c.id] })).body.breakdown.shippingFeeCents).toBe(E_CARDS);
      expect((await acc.quote({ inventoryItemIds: [s1.id] })).body.breakdown.shippingFeeCents).toBe(E_SEALED);
    });
  });

  // ================================================================ ENV-5

  describe('ENV-5 — diales por M10 (`GET/PUT /admin/settings`)', () => {
    const put = (json: unknown, token = prep.adminToken) => h.api('PUT', '/admin/settings', { token, json });

    it('GET expone los tres con sus defaults; `shippingFeeCents` sigue', async () => {
      const r = await h.api('GET', '/admin/settings', { token: prep.adminToken });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ directShipCardsFeeCents: 10000, directShipSealedFeeCents: 17500, directShipFreeFromCents: 400000, shippingFeeCents: 17500 });
    });

    it('PUT válido (súper-admin) ⇒ 200, se lee, queda en bitácora y gobierna el quote', async () => {
      const r = await put({ directShipFreeFromCents: 350000, directShipCardsFeeCents: 9000 });
      expect(r.status).toBe(200);
      const g = await h.api('GET', '/admin/settings', { token: prep.adminToken });
      expect(g.body).toMatchObject({ directShipFreeFromCents: 350000, directShipCardsFeeCents: 9000 });
      const log = await h.prisma.auditLog.findFirst({ where: { action: 'settings.update', actorUserId: prep.adminId }, orderBy: { createdAt: 'desc' } });
      expect(log?.after).toMatchObject({ directShipFreeFromCents: 350000, directShipCardsFeeCents: 9000 });
      const s1 = await piece('sealed', 360000);
      expect((await acc.quote({ inventoryItemIds: [s1.id] })).body.breakdown.shippingFeeCents).toBe(0);
      const c = await piece('raw', 50000, false);
      expect((await acc.quote({ inventoryItemIds: [c.id] })).body.breakdown.shippingFeeCents).toBe(9000);
    });

    it.each([
      [{ directShipFreeFromCents: 0 }, 'directShipFreeFromCents'],
      [{ directShipFreeFromCents: 2_147_483_648 }, 'directShipFreeFromCents'],
      [{ directShipCardsFeeCents: -1 }, 'directShipCardsFeeCents'],
      // TL-ENV-4: `MAX_CENTS + 1` ⇒ 422 en los dos `F`.
      [{ directShipCardsFeeCents: 2_147_483_648 }, 'directShipCardsFeeCents'],
      [{ directShipSealedFeeCents: 2_147_483_648 }, 'directShipSealedFeeCents'],
      [{ directShipSealedFeeCents: 1.5 }, 'directShipSealedFeeCents'],
      [{ directShipSealedFeeCents: '17500' }, 'directShipSealedFeeCents'],
    ])('PUT %j ⇒ 422 VALIDATION_ERROR y nada se escribe', async (body, key) => {
      const r = await put(body);
      expect(r.status).toBe(422);
      expect(r.body.error.code).toBe('VALIDATION_ERROR');
      expect(JSON.stringify(r.body.error.details)).toContain(key);
      const g = await h.api('GET', '/admin/settings', { token: prep.adminToken });
      expect(g.body).toMatchObject({ directShipCardsFeeCents: 10000, directShipSealedFeeCents: 17500, directShipFreeFromCents: 400000 });
    });

    it('mover `t` o `r` NO mueve `E` (el dial es exhibido); solo cambia su base dentro del IVA agregado', async () => {
      const c = await piece('raw', 50000, false);
      try {
        await setDial(SettingKey.IVA_TRANSFER_PCT, 0);
        const q0 = await acc.quote({ inventoryItemIds: [c.id] });
        expect(q0.status).toBe(200);
        expect(q0.body.breakdown.shippingFeeCents).toBe(E_CARDS);
        await setDial(SettingKey.IVA_TRANSFER_PCT, 100);
        await setDial(SettingKey.IVA_PCT, 8);
        const q8 = await acc.quote({ inventoryItemIds: [c.id] });
        expect(q8.body.breakdown.shippingFeeCents).toBe(E_CARDS);
        const G = q8.body.breakdown.subtotalCents + E_CARDS;
        expect(q8.body.breakdown.ivaCents).toBe(G - Math.round((G * 100) / 108));
      } finally {
        await setDial(SettingKey.IVA_TRANSFER_PCT, 100);
        await setDial(SettingKey.IVA_PCT, 16);
      }
    });

    it('operador ⇒ 403 en GET y en PUT; nada se escribe', async () => {
      expect((await h.api('GET', '/admin/settings', { token: prep.opToken })).status).toBe(403);
      const r = await put({ directShipFreeFromCents: 1 }, prep.opToken);
      expect(r.status).toBe(403);
      const row = await h.prisma.configSetting.findUnique({ where: { key: K_FREE } });
      expect(row?.valueJson).toBe(400000);
    });
  });

  // ================================================================ ENV-6

  describe('ENV-6 — `GET /checkout/shipping-rule` (público)', () => {
    it('sin sesión ⇒ 200 {10000, 17500, 400000, MXN, ivaIncluded} y caché pública de 300 s', async () => {
      const r = await h.api('GET', '/checkout/shipping-rule');
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ cardsOnlyFeeCents: E_CARDS, sealedFeeCents: E_SEALED, freeFromCents: T, currency: 'MXN', ivaIncluded: true });
      expect(r.headers['cache-control']).toBe('public, max-age=300');
    });

    it('con sesión válida NO se rechaza (a diferencia de /checkout/guest/*), y sigue a los diales vivos', async () => {
      await setDial(K_CARDS, 20000);
      const r = await h.api('GET', '/checkout/shipping-rule', { token: customerToken });
      expect(r.status).toBe(200);
      expect(r.body.cardsOnlyFeeCents).toBe(20000);
    });
  });

  // ================================================================ ENV-7

  describe('ENV-7 — sellados con envío 0: los reembolsos por pieza + remanente cuadran sin 23514', () => {
    type OrderRow = Awaited<ReturnType<typeof h.prisma.order.findUniqueOrThrow>>;
    /** Faltan TODAS ⇒ `prepared` cierra; devuelve las filas del libro y comprueba las invariantes de §4-G.12 punto 7. */
    const allMissing = async (shipmentId: string, order: OrderRow, prices: number[]) => {
      await setDial(SettingKey.OPERATOR_REFUND_CAP_24H_CENTS, 1_000_000_000);
      const ship = await h.prisma.shipmentRequest.findUniqueOrThrow({ where: { id: shipmentId }, include: { items: true } });
      for (const l of ship.items) {
        const m = await prep.mark(ship.id, l.id, { status: 'missing', missingReason: 'not_found' });
        expect(m.status).toBe(200);
      }
      const q = await prep.queue();
      const row = q.body.data.find((r: { shipmentId: string }) => r.shipmentId === ship.id);
      expect(row.preparation.refundPreviewCents).toBe(order.totalCents);
      const res = await prep.prepare(ship.id, order.totalCents);
      expect({ status: res.status, outcome: res.body?.outcome, error: res.body?.error }).toEqual({ status: 200, outcome: 'closed_nothing_to_ship', error: undefined });
      const rows = await h.prisma.paymentRefund.findMany({ where: { orderId: order.id } });
      const per = prices.map((p) => itemMissingRefundComponents(order, p));
      const remainder = order.totalCents - per.reduce((x, r) => x + r.amountCents, 0);
      expect(rows.filter((r) => r.kind === 'item_missing').map((r) => r.amountCents).sort()).toEqual(per.map((r) => r.amountCents).sort());
      // (a) remanente 0 ⇒ ninguna fila (CHECK `amountCents > 0`); (b) si no, una fila con sus tres IVA/envío en 0.
      const rest = rows.filter((r) => r.kind === 'order_remaining');
      expect(rest).toHaveLength(remainder > 0 ? 1 : 0);
      for (const r of rest) expect(r).toMatchObject({ amountCents: remainder, shippingCents: 0, shippingIvaCents: 0, merchandiseIvaCents: 0, merchandiseCents: 0, processingFeeCents: remainder });
      expect(rows.reduce((x, r) => x + r.amountCents, 0)).toBe(order.totalCents);
      for (const r of rows) expect(Math.min(r.shippingIvaCents, r.merchandiseIvaCents, r.processingFeeCents)).toBeGreaterThanOrEqual(0);
      const ivaSum = rows.reduce((x, r) => x + r.merchandiseIvaCents + r.shippingIvaCents, 0);
      expect(Math.abs(ivaSum - order.ivaCents)).toBeLessThanOrEqual(Math.ceil(prices.length / 2));
      // El residuo que ANTES iba al envío (negativo: la razón del caso).
      return { rows, remainder, residual: order.ivaCents - per.reduce((x, r) => x + r.merchandiseIvaCents, 0) };
    };
    const paidSealed = async (prices: number[]) => {
      const pieces = [];
      for (const p of prices) pieces.push(await piece('sealed', p));
      const paid = await acc.paidOrder({ inventoryItemIds: pieces.map((x) => x.id) });
      const order = await h.prisma.order.findUniqueOrThrow({ where: { id: paid.orderId } });
      expect(order.status).toBe('settled');
      expect(order.shippingFeeCents).toBe(0);
      expect(order.subtotalCents).toBe(prices.reduce((x, y) => x + y, 0));
      return { order, shipmentId: paid.shipmentId };
    };

    it('contrato: dos de 208906 cobrados por la regla real (E = 0, IVA 57629 vs 57630 por pieza) ⇒ Σ = total; canario 23514', async () => {
      const { order, shipmentId } = await paidSealed([208906, 208906]);
      expect(order.ivaCents).toBe(57629);
      const { residual } = await allMissing(shipmentId, order, [208906, 208906]);
      expect(residual).toBe(-1);

      // Canario: una fila con el residuo de IVA al envío (−1), como la escribía la fórmula de antes ⇒ la BD dice 23514.
      let caught: unknown = null;
      await h.prisma
        .$transaction(async (tx) => {
          try {
            await tx.paymentRefund.create({
              data: {
                idempotencyKey: `canary:${RUN}`,
                kind: 'order_remaining',
                orderId: order.id,
                amountCents: 1,
                merchandiseCents: 0,
                merchandiseIvaCents: 0,
                shippingCents: 0,
                shippingIvaCents: residual,
                processingFeeCents: 1,
                requestedByUserId: prep.adminId,
                requestedByRole: 'super_admin',
              },
            });
          } catch (e) {
            caught = e;
          }
          throw ROLLBACK;
        })
        .catch((e) => {
          if (e !== ROLLBACK) throw e;
        });
      expect(String((caught as Error | null)?.message ?? caught)).toMatch(/23514|PaymentRefund_amount_identity_chk|violates check constraint/);
    });

    it('208906 + 191094 (S = T exacto, E = 0): remanente 1 ⇒ UNA fila con IVA/envío en 0 (antes: −1 ⇒ 23514)', async () => {
      const { order, shipmentId } = await paidSealed([208906, 191094]);
      const { remainder, residual } = await allMissing(shipmentId, order, [208906, 191094]);
      expect({ remainder, residual }).toEqual({ remainder: 1, residual: -1 });
    });

    it('la misma orden por fixture (sin pasar por la regla): el reembolso por sí solo cuadra', async () => {
      const S = 400000;
      const b = computeDirectShipBreakdown(S, 0, 16, fee);
      const d = await prep.mkDirect({
        prices: [208906, 191094],
        money: { subtotalCents: S, shippingFeeCents: 0, processingFeeCents: b.processingFeeCents, ivaCents: b.ivaCents, totalCents: b.totalCents },
      });
      const order = await h.prisma.order.findUniqueOrThrow({ where: { id: d.order.id } });
      const { remainder, residual } = await allMissing(d.shipment.id, order, [208906, 191094]);
      expect({ remainder, residual }).toEqual({ remainder: 1, residual: -1 });
    });
  });

  // ================================================================ ENV-8

  describe('ENV-8 — M-91 siembra los defaults y ⛔ no copia `shipping_fee_cents`', () => {
    const inTx = async (fn: (tx: Prisma.TransactionClient) => Promise<void>) =>
      h.prisma
        .$transaction(async (tx) => {
          await fn(tx);
          throw ROLLBACK;
        })
        .catch((e) => {
          if (e !== ROLLBACK) throw e;
        });
    const read = async (tx: Prisma.TransactionClient, key: string) => (await tx.configSetting.findUnique({ where: { key } }))?.valueJson ?? null;
    const NEW = [K_CARDS, K_SEALED, K_FREE] as string[];

    it('el fichero existe y es solo de datos (sin DDL)', () => {
      expect(M91_DIR).toBeDefined();
      expect(M91.replace(/--.*$/gm, '')).not.toMatch(/\b(CREATE|ALTER|DROP)\b/i);
    });

    it('con `shipping_fee_cents` vivo en 15900 y sin filas nuevas ⇒ siembra 10000/17500/400000 (NO 15900); otra vez ⇒ igual', async () => {
      await inTx(async (tx) => {
        await tx.configSetting.deleteMany({ where: { key: { in: NEW } } });
        await tx.configSetting.upsert({ where: { key: 'shipping_fee_cents' }, create: { key: 'shipping_fee_cents', valueJson: 15900 }, update: { valueJson: 15900 } });
        await tx.$executeRawUnsafe(M91);
        const after = [await read(tx, K_CARDS), await read(tx, K_SEALED), await read(tx, K_FREE)];
        expect(after).toEqual([10000, 17500, 400000]);
        expect(after).toEqual([DEFAULTS[K_CARDS], DEFAULTS[K_SEALED], DEFAULTS[K_FREE]]);
        await tx.$executeRawUnsafe(M91);
        expect([await read(tx, K_CARDS), await read(tx, K_SEALED), await read(tx, K_FREE)]).toEqual([10000, 17500, 400000]);
        expect(await tx.configSetting.count({ where: { key: { in: NEW } } })).toBe(3);
        expect(await read(tx, 'shipping_fee_cents')).toBe(15900);
      });
    });

    it('filas ya escritas (PUT del súper-admin) ⇒ no se pisan', async () => {
      await inTx(async (tx) => {
        await tx.configSetting.deleteMany({ where: { key: { in: NEW } } });
        await tx.configSetting.create({ data: { key: K_SEALED, valueJson: 12345 } });
        await tx.$executeRawUnsafe(M91);
        expect(await read(tx, K_SEALED)).toBe(12345);
        expect(await read(tx, K_CARDS)).toBe(10000);
      });
    });
  });
});
