// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as fx from './fixtures';
import {
  DIRECT_SHIP_DEFAULT_DIALS,
  directShipFeeOf,
  shippingRuleKindOf,
  type DirectShipDials,
  type ShippingRuleCart,
} from './shipping-rule';
import { createGuestCheckoutSession, getGuestCheckoutQuote, getPublicShippingRule } from '@/lib/api';

/**
 * ENV-1 / ENV-F1 (frontend) · API_CONTRACT §4-G.12 — el MOCK replica la regla de envío v2.
 *
 * ⭐ Convención: los tres diales son CON IVA INCLUIDO (decisión del dueño 2026-10-24, `HECHOS.md` «envío v2 con
 * IVA incluido»; contrato v1.109.1): la `E` exhibida ES el valor del dial. Del contrato esta prueba lee la tabla de
 * defaults (punto 3) y el ejemplo de `shippingRule` del quote; los casos de ENV-1 van como tabla propia abajo.
 */

const CONTRACT = readFileSync(join(__dirname, '..', '..', '..', '..', 'docs', 'API_CONTRACT.md'), 'utf8');
const SECTION = (() => {
  const start = CONTRACT.indexOf('### <a id="4-G12"></a>4-G.12');
  const end = CONTRACT.indexOf('\n## 5. ', start);
  expect(start).toBeGreaterThan(-1);
  return CONTRACT.slice(start, end);
})();

const D: DirectShipDials = DIRECT_SHIP_DEFAULT_DIALS;
const cards = (...p: Array<'raw' | 'graded' | 'sealed'>): ShippingRuleCart => ({ productTypes: p, accessoryCount: 0 });
const acc: ShippingRuleCart = { productTypes: [], accessoryCount: 1 };

/** Los casos de ENV-1 (§4-G.12 punto 10) con los diales con IVA incluido: [nombre, carrito, S, caja, E, falta]. */
const ENV1: ReadonlyArray<[string, ShippingRuleCart, number, number | null, number, number | null]> = [
  ['raw, S=50000', cards('raw'), 50000, null, 10000, null],
  ['raw, S=500000 (solo cartas nunca es gratis)', cards('raw'), 500000, null, 10000, null],
  ['graded = carta (D-ENV-2), S=50000', cards('graded'), 50000, null, 10000, null],
  ['graded, S=500000', cards('graded'), 500000, null, 10000, null],
  ['sellado S=399999 ⇒ falta 1', cards('sealed'), 399999, null, 17500, 1],
  ['sellado S=400000 ⇒ 0 (umbral inclusivo)', cards('sealed'), 400000, null, 0, 0],
  ['carta + sellado con S ≥ T ⇒ 0', cards('raw', 'sealed'), 400000, null, 0, 0],
  ['carta + energía ⇒ regla del sellado (D-ENV-3)', { productTypes: ['raw'], accessoryCount: 1 }, 50000, null, 17500, 350000],
  ['caja 35000 bajo T', acc, 50000, 35000, 35000, 350000],
  ['caja 35000 sobre T (conserva su tarifa)', acc, 400000, 35000, 35000, 0],
  ['caja 15000 bajo T ⇒ tarifa del sellado', acc, 50000, 15000, 17500, 350000],
  ['caja 15000 sobre T ⇒ 0', acc, 400000, 15000, 0, 0],
];

function tableDefault(dtoKey: string): number {
  const row = SECTION.split('\n').find((l) => l.startsWith(`| \`${dtoKey}\``));
  expect(row, `fila de ${dtoKey} en la tabla de diales de §4-G.12`).toBeTruthy();
  return Number(row!.split('|')[2].replace(/[`\s]/g, ''));
}

describe('ENV-1 (frontend) · el mock replica la regla de envío v2 de §4-G.12', () => {
  it('los defaults del mock son los de la tabla del contrato (punto 3) y los de M10 del simulador', () => {
    expect(tableDefault('directShipCardsFeeCents')).toBe(D.cardsFeeCents);
    expect(tableDefault('directShipSealedFeeCents')).toBe(D.sealedFeeCents);
    expect(tableDefault('directShipFreeFromCents')).toBe(D.freeFromCents);
    expect(fx.mockSettings.directShipCardsFeeCents).toBe(D.cardsFeeCents);
    expect(fx.mockSettings.directShipSealedFeeCents).toBe(D.sealedFeeCents);
    expect(fx.mockSettings.directShipFreeFromCents).toBe(D.freeFromCents);
  });

  it.each(ENV1.map((c) => [...c] as const))('%s', (_name, cart, s, box, fee, remaining) => {
    const out = directShipFeeOf(shippingRuleKindOf(cart), s, D, box === null ? null : { customerFeeCents: box });
    expect(out.feeCents).toBe(fee);
    expect(out.rule.freeShippingRemainingCents).toBe(remaining);
    expect(out.rule.boxFeeApplies).toBe(box !== null && box > D.sealedFeeCents);
  });

  it('vacío ⇒ `kind: null` y envío 0', () => {
    const empty = directShipFeeOf(shippingRuleKindOf(cards()), 0, D);
    expect(empty.feeCents).toBe(0);
    expect(empty.rule.kind).toBeNull();
  });

  it('el ejemplo de `shippingRule` del quote del contrato (solo cartas) es exactamente lo que da el mock', () => {
    const m = /"shippingRule":\s*(\{[^{}]*\})/.exec(CONTRACT);
    expect(m, 'ejemplo de shippingRule en el 200 de POST /checkout/guest/quote').toBeTruthy();
    const example = JSON.parse(m![1]);
    expect(example.kind).toBe('cards_only');
    expect(directShipFeeOf('cards_only', 25000, D).rule).toEqual(example);
  });
});

describe('ENV-2/3/6 (frontend, mock) · quote, sesión y GET público', () => {
  afterEach(() => {
    fx.setMockSettings({
      directShipCardsFeeCents: D.cardsFeeCents,
      directShipSealedFeeCents: D.sealedFeeCents,
      directShipFreeFromCents: D.freeFromCents,
      ivaPct: 16,
    });
  });

  it('ENV-6: GET /checkout/shipping-rule ⇒ los diales tal cual (IVA incluido)', async () => {
    expect(await getPublicShippingRule()).toEqual({
      cardsOnlyFeeCents: 10000,
      sealedFeeCents: 17500,
      freeFromCents: 400000,
      currency: 'MXN',
      ivaIncluded: true,
    });
  });

  it('IVA incluido: mover la tasa del IVA NO mueve el envío exhibido (exacto al dial)', async () => {
    fx.setMockSettings({ ivaPct: 8 });
    expect((await getGuestCheckoutQuote(['inv-1001'])).breakdown.shippingFeeCents).toBe(10000);
    expect((await getPublicShippingRule()).sealedFeeCents).toBe(17500);
  });

  it('ENV-2: carrito solo de cartas (gradeada) ⇒ 10000 y `kind: cards_only`; 100 % podado ⇒ `kind: null`', async () => {
    const q = await getGuestCheckoutQuote(['inv-1001']);
    expect(q.breakdown.shippingFeeCents).toBe(10000);
    expect(q.shippingRule?.kind).toBe('cards_only');
    const dead = await getGuestCheckoutQuote(['no-existe']);
    expect(dead.breakdown.shippingFeeCents).toBe(0);
    expect(dead.shippingRule).toEqual({
      kind: null,
      freeFromCents: null,
      freeShippingRemainingCents: null,
      freeShippingApplied: false,
      boxFeeApplies: false,
    });
  });

  it('sellado bajo el umbral ⇒ 17500 con la falta exacta; dos sellados ≥ T ⇒ envío 0 y `freeShippingApplied`', async () => {
    const one = await getGuestCheckoutQuote(['inv-1008']);
    expect(one.breakdown.shippingFeeCents).toBe(17500);
    expect(one.shippingRule?.freeShippingRemainingCents).toBe(400000 - one.breakdown.subtotalCents);
    const two = await getGuestCheckoutQuote(['inv-1008', 'inv-1009']);
    expect(two.breakdown.subtotalCents).toBeGreaterThanOrEqual(400000);
    expect(two.breakdown.shippingFeeCents).toBe(0);
    expect(two.shippingRule).toMatchObject({ kind: 'sealed', freeShippingApplied: true, freeShippingRemainingCents: 0 });
    // §4-G.0-2: el total sigue siendo subtotal + envío + comisión (la comisión baja con el envío gratis).
    expect(two.breakdown.totalCents).toBe(two.breakdown.subtotalCents + two.breakdown.processingFeeCents);
  });

  // 💰 TL-R2 (techlead, release sobre 230b9bd3): el backend cuenta como accesorio solo los paquetes ACEPTADOS
  // (`guest-checkout.service.ts`: `energyBundleCount: acc.energyBundles.length` en quote, `part.bundles.length` en
  // sesión). El mock contaba todo `deckPulls` ⇒ un pull sin paquete con solo cartas cobraba 17500 en vez de 10000.
  it('paridad: deckPull SIN paquete + solo cartas ⇒ 10000 y `cards_only` (quote y sesión)', async () => {
    const pulls = [{ pullToken: 'cualquiera', withEnergyBundle: false }];
    const q = await getGuestCheckoutQuote(['inv-1001'], undefined, undefined, { deckPulls: pulls });
    // Sin el arreglo la clase sale `sealed` y, con S ≥ T, el envío sale 0 (no 17500): se asierta la clase primero.
    expect(q.shippingRule?.kind).toBe('cards_only');
    expect(q.breakdown.shippingFeeCents).toBe(10000);
    const s = await createGuestCheckoutSession({
      inventoryItemIds: ['inv-1001'],
      email: 'tlr2@example.com',
      shippingAddress: {
        line1: 'Calle 1',
        neighborhood: 'Centro',
        city: 'Guadalajara',
        state: 'Jalisco',
        postalCode: '44100',
        country: 'MX',
        phone: '3312345678',
        recipientName: 'Tl Dos',
      },
      acceptedTerms: true,
      deckPulls: pulls,
    });
    expect(s.breakdown.shippingFeeCents).toBe(10000);
  });

  it('M10 mueve la tarifa del mock (criterio 196) y ENV-3: la sesión cobra lo mismo que el quote', async () => {
    fx.setMockSettings({ directShipCardsFeeCents: 5000 });
    const q = await getGuestCheckoutQuote(['inv-1001']);
    expect(q.breakdown.shippingFeeCents).toBe(5000);
    const s = await createGuestCheckoutSession({
      inventoryItemIds: ['inv-1001'],
      email: 'env3@example.com',
      shippingAddress: {
        line1: 'Calle 1',
        neighborhood: 'Centro',
        city: 'Guadalajara',
        state: 'Jalisco',
        postalCode: '44100',
        country: 'MX',
        phone: '3312345678',
        recipientName: 'Env Tres',
      },
      acceptedTerms: true,
    });
    expect(s.breakdown.shippingFeeCents).toBe(q.breakdown.shippingFeeCents);
    expect(s.breakdown.totalCents).toBe(q.breakdown.totalCents);
  });
});
