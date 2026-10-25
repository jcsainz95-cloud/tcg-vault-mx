/**
 * shipping-rule.spec.ts — 💰 **ENV-1** (API_CONTRACT §4-G.12 punto 10) + mitades puras de **ENV-5** y del punto 7 (PS-3 con
 * envío 0). Propiedad: backend. Determinista (N=1 dicho como tal).
 *
 * Diales del contrato v1.109.1, los TRES exhibidos (IVA dentro; P-ENV-1 cerrada): `G_cartas = 10000`, `G_sellado = 17500`,
 * `T = 400000` ⇒ `E_cartas = 10000`, `E_sellado = 17500` con cualquier `t`/`r` (solo cambia la base: 8621 + 1379, 15086 + 2414).
 * `S` es el `breakdown.subtotalCents` (IVA dentro, ANTES del envío y de la comisión).
 * Canarios del contrato: umbral contra el TOTAL ⇒ rojo (`S = 399999`); `E` por `shippingFeeDisplayCentsOf` ⇒ 11600 ⇒ rojo.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ProductType } from '@prisma/client';
import {
  DirectShipDials,
  directShipFeeTaxSplitOf,
  directShipFeeOf,
  publicShippingRuleOf,
  shippingRuleDtoOf,
  shippingRuleKindOf,
} from '../src/modules/orders/shipping-rule';
import type { BoxChoice, FitBox } from '../src/modules/orders/box-fit';
import {
  computeDirectShipBreakdown,
  itemMissingRefundComponents,
  orderRemainingRefundComponents,
  shippingFeeDisplayCentsOf,
  taxBaseCentsOf,
} from '../src/common/money';
import { OWNER_ONLY_SETTING_KEYS, SETTING_DEFAULTS, SETTING_DTO_MAP, SETTING_VALIDATORS, SettingKey } from '../src/modules/settings/settings.constants';

const DIALS: DirectShipDials = { cardsFeeCents: 10000, sealedFeeCents: 17500, freeFromCents: 400000 };
const E_CARDS = 10000;
const E_SEALED = 17500;
const FEE = { stripePct: 0.036, stripeFixedCents: 300, stripeFeeIvaPct: 0.16 };

const box = (customerFeeCents: number): BoxChoice => ({
  box: { code: `b${customerFeeCents}`, label: 'Caja', lengthCm: 30, widthCm: 20, heightCm: 10, customerFeeCents, sortOrder: 0 } as FitBox,
  review: false,
});
const cart = (types: ProductType[], accessoryLineCount = 0, energyBundleCount = 0) => ({ productTypes: types, accessoryLineCount, energyBundleCount });
/** `E` del pedido, de punta a punta por la función pura (clase → umbral → caja). */
const feeOf = (types: ProductType[], S: number, o: { acc?: number; bundles?: number; choice?: BoxChoice | null } = {}) =>
  directShipFeeOf(shippingRuleKindOf(cart(types, o.acc ?? 0, o.bundles ?? 0)), S, DIALS, o.choice ?? null);

describe('ENV-1 💰 regla de envío v2 (pura, §4-G.12 pasos 1–3)', () => {
  it('E = dial exacto (10000 / 17500 / 400000); canario: por `shippingFeeDisplayCentsOf` saldría 11600 (IVA apilado)', () => {
    expect(DIALS).toEqual({ cardsFeeCents: E_CARDS, sealedFeeCents: E_SEALED, freeFromCents: 400000 });
    expect(feeOf(['raw'], 50000).feeCents).not.toBe(shippingFeeDisplayCentsOf(10000, { ivaTransferPct: 100, ivaRatePct: 16 }));
    expect(shippingFeeDisplayCentsOf(10000, { ivaTransferPct: 100, ivaRatePct: 16 })).toBe(11600);
  });

  it('desglose del envío (R2, IVA por resta): 10000 ⇒ 8621 + 1379; 17500 ⇒ 15086 + 2414; r=8 ⇒ 9259 + 741; ida y vuelta = dial', () => {
    expect(directShipFeeTaxSplitOf(10000, 16)).toEqual({ baseCents: 8621, ivaCents: 1379 });
    expect(directShipFeeTaxSplitOf(17500, 16)).toEqual({ baseCents: 15086, ivaCents: 2414 });
    expect(directShipFeeTaxSplitOf(10000, 8)).toEqual({ baseCents: 9259, ivaCents: 741 });
    for (const [g, r] of [[10000, 16], [17500, 16], [10000, 8], [10000, 0]] as const) {
      const sp = directShipFeeTaxSplitOf(g, r);
      expect(sp.baseCents + sp.ivaCents).toBe(g);
    }
    // con t = 100, la base re-exhibida da el dial (el requisito del dueño: el cliente ve 10000 y 17500 exactos).
    expect(shippingFeeDisplayCentsOf(8621, { ivaTransferPct: 100, ivaRatePct: 16 })).toBe(10000);
    expect(shippingFeeDisplayCentsOf(15086, { ivaTransferPct: 100, ivaRatePct: 16 })).toBe(17500);
  });

  it('IVA-6 (desglose agregado): con E = 10000 el IVA del pedido = (S+E) − base(S+E) y el total = gross-up de S + E, sin sumando extra', () => {
    const bd = computeDirectShipBreakdown(50000, E_CARDS, 16, FEE);
    expect(bd.shippingFeeCents).toBe(10000);
    expect(bd.ivaCents).toBe(60000 - taxBaseCentsOf(60000, 16));
    expect(bd.totalCents).toBe(bd.subtotalCents + bd.shippingFeeCents + bd.processingFeeCents);
  });

  // v1.109.3 (dueño 2026-10-25, «Envío gratis desde MX$4,000 para CUALQUIER pedido»): el umbral vale para las dos clases.
  it.each([
    ['raw', 50000],
    ['raw', 399999],
    ['graded', 50000],
    ['graded', 399999],
  ] as const)('solo cartas (%s) S < T (S = %i) ⇒ 10000', (t, S) => {
    expect(shippingRuleKindOf(cart([t]))).toBe('cards_only');
    const f = feeOf([t], S);
    expect(f).toEqual({ feeCents: 10000, baseFeeCents: 17500, freeShippingApplied: false, boxFeeApplies: false });
    expect(shippingRuleDtoOf('cards_only', S, DIALS, f)).toEqual({ kind: 'cards_only', freeFromCents: 400000, freeShippingRemainingCents: 400000 - S, freeShippingApplied: false, boxFeeApplies: false });
  });

  it.each([
    ['raw', 400000],
    ['raw', 500000],
    ['graded', 400000],
    ['graded', 500000],
  ] as const)('solo cartas (%s) S ≥ T (S = %i) ⇒ 0 y `freeShippingApplied` (umbral inclusivo)', (t, S) => {
    const f = feeOf([t], S);
    expect(f).toEqual({ feeCents: 0, baseFeeCents: 17500, freeShippingApplied: true, boxFeeApplies: false });
    expect(shippingRuleDtoOf('cards_only', S, DIALS, f)).toEqual({ kind: 'cards_only', freeFromCents: 400000, freeShippingRemainingCents: 0, freeShippingApplied: true, boxFeeApplies: false });
  });

  it('caso del pentester: cartas con S ≥ T ⇒ 0 con un accesorio barato y también sin él (añadir nada no abarata)', () => {
    const sin = feeOf(['raw'], 400000);
    const con = feeOf(['raw'], 400000 + 100, { acc: 1 });
    expect(sin.feeCents).toBe(0);
    expect(con.feeCents).toBe(0);
    expect(sin.freeShippingApplied && con.freeShippingApplied).toBe(true);
    // y bajo T el accesorio sigue cambiando la clase (10000 ⇒ 17500), ⛔ nunca la abarata.
    expect(feeOf(['raw'], 50000).feeCents).toBe(10000);
    expect(feeOf(['raw'], 50100, { acc: 1 }).feeCents).toBe(17500);
  });

  it('raw + graded juntos siguen siendo «solo cartas» (D-ENV-2)', () => {
    expect(shippingRuleKindOf(cart(['raw', 'graded']))).toBe('cards_only');
    expect(feeOf(['raw', 'graded'], 90000).feeCents).toBe(10000);
    expect(feeOf(['raw', 'graded'], 900000).feeCents).toBe(0);
  });

  it('sellado con S = 399999 ⇒ 17500 y «te falta 1»; S = 400000 ⇒ 0 (umbral inclusivo)', () => {
    const under = feeOf(['sealed'], 399999);
    expect(under).toEqual({ feeCents: 17500, baseFeeCents: 17500, freeShippingApplied: false, boxFeeApplies: false });
    expect(shippingRuleDtoOf('sealed', 399999, DIALS, under)).toEqual({ kind: 'sealed', freeFromCents: 400000, freeShippingRemainingCents: 1, freeShippingApplied: false, boxFeeApplies: false });
    const at = feeOf(['sealed'], 400000);
    expect(at).toEqual({ feeCents: 0, baseFeeCents: 17500, freeShippingApplied: true, boxFeeApplies: false });
    expect(shippingRuleDtoOf('sealed', 400000, DIALS, at)).toEqual({ kind: 'sealed', freeFromCents: 400000, freeShippingRemainingCents: 0, freeShippingApplied: true, boxFeeApplies: false });
    expect(shippingRuleDtoOf('sealed', 900000, DIALS, feeOf(['sealed'], 900000)).freeShippingRemainingCents).toBe(0);
  });

  it('canario: el umbral se mide sobre S, NO sobre el total (con S = 399999 el total ya pasa de T y el envío NO es gratis)', () => {
    const f = feeOf(['sealed'], 399999);
    const bd = computeDirectShipBreakdown(399999, f.feeCents, 16, FEE);
    expect(bd.totalCents).toBeGreaterThanOrEqual(400000);
    expect(f.feeCents).toBe(17500);
  });

  it('mixto carta + sellado con S ≥ T ⇒ 0; bajo T ⇒ 17500 (la regla del sellado manda)', () => {
    expect(shippingRuleKindOf(cart(['raw', 'sealed']))).toBe('sealed');
    expect(feeOf(['raw', 'sealed'], 400000).feeCents).toBe(0);
    expect(feeOf(['graded', 'sealed'], 450000).feeCents).toBe(0);
    expect(feeOf(['raw', 'sealed'], 399999).feeCents).toBe(17500);
  });

  it('carta + energía ⇒ 17500 (accesorio = sellado, D-ENV-3); carta + paquete de energías ⇒ 17500; solo accesorio ⇒ sellado', () => {
    expect(shippingRuleKindOf(cart(['raw'], 1))).toBe('sealed');
    expect(feeOf(['raw'], 50500, { acc: 1 }).feeCents).toBe(17500);
    expect(feeOf(['raw'], 50000, { bundles: 1 }).feeCents).toBe(17500);
    expect(shippingRuleKindOf(cart([], 1))).toBe('sealed');
    expect(shippingRuleKindOf(cart([], 0, 1))).toBe('sealed');
  });

  it('caja grande 35000 ⇒ 35000 bajo T (conserva su tarifa); boxFeeApplies', () => {
    const under = feeOf(['sealed'], 100000, { acc: 1, choice: box(35000) });
    expect(under).toEqual({ feeCents: 35000, baseFeeCents: 17500, freeShippingApplied: false, boxFeeApplies: true });
  });

  it('v1.109.2: caja 35000 sobre T ⇒ 35000, `freeShippingApplied:false`, `boxFeeApplies:true` (gratis ⇔ E = 0)', () => {
    for (const S of [400000, 500000]) {
      const over = feeOf(['sealed'], S, { acc: 1, choice: box(35000) });
      expect(over).toEqual({ feeCents: 35000, baseFeeCents: 17500, freeShippingApplied: false, boxFeeApplies: true });
      expect(shippingRuleDtoOf('sealed', S, DIALS, over)).toEqual({ kind: 'sealed', freeFromCents: 400000, freeShippingRemainingCents: 0, freeShippingApplied: false, boxFeeApplies: true });
    }
    // Invariante del contrato v1.109.2: `freeShippingApplied` ⇔ `E = 0` en todo pedido no vacío.
    for (const c of [null, 15000, 17500, 17501, 35000]) {
      for (const S of [100000, 399999, 400000, 900000]) {
        const f = feeOf(['sealed'], S, { acc: 1, choice: c === null ? null : box(c) });
        expect(f.freeShippingApplied).toBe(f.feeCents === 0);
      }
    }
    for (const S of [100000, 399999, 400000, 900000]) {
      const f = feeOf(['raw'], S);
      expect(f.freeShippingApplied).toBe(f.feeCents === 0);
    }
  });

  it('`deckPull` sin paquete aceptado + solo cartas ⇒ 10000 (la oferta no cobra ni cuenta como sellado)', () => {
    // Un `deckPull` con `withEnergyBundle:false` (o con oferta no aceptada) NO entra a `energyBundles` (§AC.4): el
    // carrito que llega a la regla son solo sus cartas, con `energyBundleCount = 0`.
    expect(shippingRuleKindOf(cart(['raw', 'raw', 'graded'], 0, 0))).toBe('cards_only');
    expect(feeOf(['raw', 'raw', 'graded'], 50000)).toEqual({ feeCents: 10000, baseFeeCents: 17500, freeShippingApplied: false, boxFeeApplies: false });
    expect(feeOf(['raw', 'raw', 'graded'], 399999).feeCents).toBe(10000);
    expect(feeOf(['raw', 'raw', 'graded'], 500000).feeCents).toBe(0);
    // y con el paquete ACEPTADO el mismo carrito ya es sellado (contraste: el candado mira la cuenta, no la presencia del pull).
    expect(feeOf(['raw', 'raw', 'graded'], 50000, { bundles: 1 }).feeCents).toBe(17500);
  });

  it('caja chica 15000 ⇒ 17500 bajo T y 0 sobre T; caja igual a E_sellado (17500) no es «grande»; 18000 ya lo es (v1.109.1)', () => {
    expect(feeOf(['sealed'], 100000, { acc: 1, choice: box(15000) })).toEqual({ feeCents: 17500, baseFeeCents: 17500, freeShippingApplied: false, boxFeeApplies: false });
    expect(feeOf(['sealed'], 400000, { acc: 1, choice: box(15000) })).toEqual({ feeCents: 0, baseFeeCents: 17500, freeShippingApplied: true, boxFeeApplies: false });
    expect(feeOf(['sealed'], 400000, { acc: 1, choice: box(17500) }).feeCents).toBe(0);
    expect(feeOf(['sealed'], 400000, { acc: 1, choice: box(17501) }).feeCents).toBe(17501);
    expect(feeOf(['sealed'], 100000, { acc: 1, choice: box(18000) })).toMatchObject({ feeCents: 18000, boxFeeApplies: true });
  });

  it('bajo el umbral es bit a bit el max(E_sellado, caja) de §AC.7', () => {
    for (const c of [1, 15000, 17499, 17500, 17501, 18000, 35000, 999999]) {
      expect(feeOf(['sealed'], 100000, { acc: 1, choice: box(c) }).feeCents).toBe(Math.max(E_SEALED, c));
    }
  });

  it('vacío ⇒ kind null y E = 0; el DTO va en null/false', () => {
    expect(shippingRuleKindOf(cart([]))).toBeNull();
    const f = directShipFeeOf(null, 0, DIALS, null);
    expect(f.feeCents).toBe(0);
    expect(shippingRuleDtoOf(null, 0, DIALS, f)).toEqual({ kind: null, freeFromCents: null, freeShippingRemainingCents: null, freeShippingApplied: false, boxFeeApplies: false });
  });

  it('E = dial con t = 0 y con r = 8: mover el IVA no mueve lo que paga el cliente (solo la base)', () => {
    // `DirectShipDials` no lleva diales de IVA: no hay camino por el que `t`/`r` lleguen a `E`.
    expect(Object.keys(DIALS).sort()).toEqual(['cardsFeeCents', 'freeFromCents', 'sealedFeeCents']);
    expect(directShipFeeOf('cards_only', 50000, DIALS, null).feeCents).toBe(10000);
    expect(computeDirectShipBreakdown(50000, 10000, 8, FEE).shippingFeeCents).toBe(10000);
    expect(directShipFeeTaxSplitOf(10000, 8)).toEqual({ baseCents: 9259, ivaCents: 741 });
  });

  it('GET /checkout/shipping-rule (forma pura de ENV-6): {10000, 17500, 400000, MXN, ivaIncluded}', () => {
    expect(publicShippingRuleOf(DIALS)).toEqual({ cardsOnlyFeeCents: 10000, sealedFeeCents: 17500, freeFromCents: 400000, currency: 'MXN', ivaIncluded: true });
  });
});

describe('ENV-5 (mitad pura) — los tres diales en las cuatro estructuras de settings.constants.ts', () => {
  const K = SettingKey as Record<string, string>;
  const D = SETTING_DEFAULTS as Record<string, unknown>;
  const V = SETTING_VALIDATORS as Record<string, (x: unknown) => string | null>;

  it('claves, defaults (EXHIBIDOS, P-ENV-1 cerrada) y nombres del DTO', () => {
    expect(K.DIRECT_SHIP_CARDS_FEE_CENTS).toBe('direct_ship_cards_fee_cents');
    expect(K.DIRECT_SHIP_SEALED_FEE_CENTS).toBe('direct_ship_sealed_fee_cents');
    expect(K.DIRECT_SHIP_FREE_FROM_CENTS).toBe('direct_ship_free_from_cents');
    expect(D.direct_ship_cards_fee_cents).toBe(10000);
    expect(D.direct_ship_sealed_fee_cents).toBe(17500);
    expect(D.direct_ship_free_from_cents).toBe(400000);
    expect(SETTING_DTO_MAP.directShipCardsFeeCents).toBe('direct_ship_cards_fee_cents');
    expect(SETTING_DTO_MAP.directShipSealedFeeCents).toBe('direct_ship_sealed_fee_cents');
    expect(SETTING_DTO_MAP.directShipFreeFromCents).toBe('direct_ship_free_from_cents');
    // `shipping_fee_cents` se queda (retiro desde bóveda) con su default de siempre.
    expect(D.shipping_fee_cents).toBe(17500);
    expect(SETTING_DTO_MAP.shippingFeeCents).toBe('shipping_fee_cents');
  });

  it.each([
    ['direct_ship_cards_fee_cents', 0, true],
    ['direct_ship_cards_fee_cents', 10000, true],
    ['direct_ship_cards_fee_cents', -1, false],
    ['direct_ship_cards_fee_cents', 100.5, false],
    ['direct_ship_cards_fee_cents', '10000', false],
    // TL-ENV-4: tope MAX_CENTS (Int32) en los dos `F`, como el umbral.
    ['direct_ship_cards_fee_cents', 2_147_483_647, true],
    ['direct_ship_cards_fee_cents', 2_147_483_648, false],
    ['direct_ship_sealed_fee_cents', 0, true],
    ['direct_ship_sealed_fee_cents', -1, false],
    ['direct_ship_sealed_fee_cents', null, false],
    ['direct_ship_sealed_fee_cents', 2_147_483_647, true],
    ['direct_ship_sealed_fee_cents', 2_147_483_648, false],
    ['direct_ship_free_from_cents', 1, true],
    ['direct_ship_free_from_cents', 2_147_483_647, true],
    ['direct_ship_free_from_cents', 0, false],
    ['direct_ship_free_from_cents', 2_147_483_648, false],
    ['direct_ship_free_from_cents', 4000.5, false],
    ['direct_ship_free_from_cents', '400000', false],
  ] as const)('%s = %p ⇒ válido %p', (key, v, ok) => {
    expect(typeof V[key]).toBe('function');
    expect(V[key](v) === null).toBe(ok);
  });

  it('ENV-8 (mitad estática): el INSERT de M-91 siembra EXACTAMENTE los defaults de código y no lee `shipping_fee_cents`', () => {
    const dir = readdirSync(join(__dirname, '..', 'prisma', 'migrations')).find((d) => /_m91_envio_v2_dials$/.test(d));
    expect(dir).toBeDefined();
    const sql = readFileSync(join(__dirname, '..', 'prisma', 'migrations', dir as string, 'migration.sql'), 'utf8').replace(/--.*$/gm, '');
    const seeded = Object.fromEntries([...sql.matchAll(/\('(direct_ship_[a-z_]+)', '(\d+)'::jsonb/g)].map((m) => [m[1], Number(m[2])]));
    expect(seeded).toEqual({ direct_ship_cards_fee_cents: D.direct_ship_cards_fee_cents, direct_ship_sealed_fee_cents: D.direct_ship_sealed_fee_cents, direct_ship_free_from_cents: D.direct_ship_free_from_cents });
    expect(sql).not.toMatch(/shipping_fee_cents/);
    expect(sql).toMatch(/ON CONFLICT \("key"\) DO NOTHING/);
  });

  it('⛔ no son diales del dueño (super_admin, como el resto de M10)', () => {
    for (const k of ['direct_ship_cards_fee_cents', 'direct_ship_sealed_fee_cents', 'direct_ship_free_from_cents']) {
      expect(OWNER_ONLY_SETTING_KEYS as readonly string[]).not.toContain(k);
    }
  });
});

describe('§4-G.12 punto 7 (pura) — reembolsos con envío 0: dos sellados de 208906', () => {
  const S = 2 * 208906;
  const bd = computeDirectShipBreakdown(S, 0, 16, FEE);
  const order = { subtotalCents: bd.subtotalCents, shippingFeeCents: 0, processingFeeCents: bd.processingFeeCents, ivaCents: bd.ivaCents, ivaRatePct: 16, totalCents: bd.totalCents, priceConvention: 'IVA_INCLUSIVE' as const };

  it('el agregado es 57629 y Σ por pieza 57630 (residuo −1, la razón del caso)', () => {
    expect(feeOf(['sealed', 'sealed'], S).feeCents).toBe(0);
    expect(bd.ivaCents).toBe(S - taxBaseCentsOf(S, 16));
    expect(bd.ivaCents).toBe(57629);
    expect(2 * (208906 - taxBaseCentsOf(208906, 16))).toBe(57630);
  });

  it('remanente: tres IVA/envío en 0, Σ amount = total exacto, |Σ IVA − iva| ≤ ⌈n/2⌉, sin negativos', () => {
    const r1 = itemMissingRefundComponents(order, 208906);
    const r2 = itemMissingRefundComponents(order, 208906);
    const rest = orderRemainingRefundComponents(order, [r1, r2]);
    expect(rest.shippingCents).toBe(0);
    expect(rest.shippingIvaCents).toBe(0);
    expect(rest.merchandiseIvaCents).toBe(0);
    for (const v of Object.values(rest)) expect(v).toBeGreaterThanOrEqual(0);
    expect(rest.amountCents).toBe(rest.merchandiseCents + rest.shippingCents + rest.processingFeeCents + rest.compensationCents);
    expect(r1.amountCents + r2.amountCents + rest.amountCents).toBe(order.totalCents);
    const ivaSum = r1.merchandiseIvaCents + r2.merchandiseIvaCents + rest.merchandiseIvaCents + rest.shippingIvaCents;
    expect(Math.abs(ivaSum - order.ivaCents)).toBeLessThanOrEqual(Math.ceil(2 / 2));
  });

  it('con envío > 0 nada cambia: el envío absorbe el residuo (PS-3 ±0)', () => {
    const o2 = { ...order, shippingFeeCents: 20300 };
    const bd2 = computeDirectShipBreakdown(S, 20300, 16, FEE);
    Object.assign(o2, { processingFeeCents: bd2.processingFeeCents, ivaCents: bd2.ivaCents, totalCents: bd2.totalCents });
    const r1 = itemMissingRefundComponents(o2, 208906);
    const r2 = itemMissingRefundComponents(o2, 208906);
    const rest = orderRemainingRefundComponents(o2, [r1, r2]);
    expect(rest.shippingIvaCents).toBe(o2.ivaCents - r1.merchandiseIvaCents - r2.merchandiseIvaCents);
    expect(r1.merchandiseIvaCents + r2.merchandiseIvaCents + rest.shippingIvaCents).toBe(o2.ivaCents);
  });
});
