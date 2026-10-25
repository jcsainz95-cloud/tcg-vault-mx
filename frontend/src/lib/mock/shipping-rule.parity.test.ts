// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as fx from './fixtures';
import { mockPullToken } from './accessories';
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
 * IVA incluido»; contrato v1.109.1): la `E` exhibida ES el valor del dial. Umbral para CUALQUIER clase (dueño
 * 2026-10-25, `HECHOS.md` «Envío gratis desde MX$4,000 para CUALQUIER pedido (opción A)»; contrato v1.109.3).
 *
 * Del contrato esta prueba LEE: la tabla de defaults (punto 3), el ejemplo de `shippingRule` del quote (objeto entero),
 * los casos numéricos de ENV-1 de cartas, sellado y caja (punto 10) y el predicado de T9 de ENV-F1. El resto de ENV-1
 * (mixtos, energía, vacío) va como tabla propia abajo porque el contrato lo dice en prosa sin cifras.
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
  ['raw, S=50000', cards('raw'), 50000, null, 10000, 350000],
  // 💰 dueño 2026-10-25 (opción A): el umbral vale también para solo cartas.
  ['solo cartas S < T ⇒ 10000 (S=399999, falta 1)', cards('raw'), 399999, null, 10000, 1],
  ['solo cartas S ≥ T ⇒ 0 (S=400000, umbral inclusivo)', cards('raw'), 400000, null, 0, 0],
  ['raw, S=500000 ⇒ 0', cards('raw'), 500000, null, 0, 0],
  ['graded = carta (D-ENV-2), S=50000', cards('graded'), 50000, null, 10000, 350000],
  ['graded, S=500000 ⇒ 0', cards('graded'), 500000, null, 0, 0],
  ['sellado S=399999 ⇒ falta 1', cards('sealed'), 399999, null, 17500, 1],
  ['sellado S=400000 ⇒ 0 (umbral inclusivo)', cards('sealed'), 400000, null, 0, 0],
  ['carta + sellado con S ≥ T ⇒ 0', cards('raw', 'sealed'), 400000, null, 0, 0],
  ['carta + energía ⇒ regla del sellado (D-ENV-3)', { productTypes: ['raw'], accessoryCount: 1 }, 50000, null, 17500, 350000],
  // v1.109.5: caja grande ⇒ sin promesa de «te faltan» (`null`), bajo y sobre T.
  ['caja 35000 bajo T', acc, 50000, 35000, 35000, null],
  ['caja 35000 sobre T (conserva su tarifa)', acc, 400000, 35000, 35000, null],
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

  it('el ejemplo de `shippingRule` del quote del contrato (solo cartas) es el objeto entero del mock con su `S`', () => {
    const m = /"shippingRule":\s*(\{[^{}]*\})/.exec(CONTRACT);
    expect(m, 'ejemplo de shippingRule en el 200 de POST /checkout/guest/quote').toBeTruthy();
    const example = JSON.parse(m![1]);
    expect(example.kind).toBe('cards_only');
    // `S` del mismo ejemplo: el último `subtotalCents` antes de `shippingRule` (el de `breakdown`, no el de `vaultBreakdown`
    // — ambos valen 25000 hoy; se toma el de `breakdown` por posición).
    const before = CONTRACT.slice(0, m!.index);
    const sMatch = /"breakdown":\s*\{\s*"subtotalCents":\s*(\d+)/g;
    let s: number | null = null;
    for (let x = sMatch.exec(before); x; x = sMatch.exec(before)) s = Number(x[1]);
    expect(s, '`breakdown.subtotalCents` del ejemplo').not.toBeNull();
    expect(directShipFeeOf('cards_only', s!, D).rule).toEqual(example);
  });
});

/** Lee una cifra de la sección §4-G.12 con un patrón literal del punto 10; rojo si el contrato cambia la frase. */
function read(re: RegExp, what: string): number[] {
  const m = re.exec(SECTION);
  expect(m, `${what} en §4-G.12 punto 10`).toBeTruthy();
  return m!.slice(1).map(Number);
}

describe('ENV-1 / ENV-F1 (frontend) · los casos que el contrato da con cifras, leídos del contrato', () => {
  it('ENV-1 cartas: «raw y graded ⇒ E con S = a y b, 0 con S = T» (umbral para cualquier clase)', () => {
    const [fee, s1, s2, zero, sT] = read(
      /raw y graded ⇒ (\d+) con `S` = (\d+) y (\d+), (\d+) con `S` = (\d+)/,
      'caso ENV-1 de solo cartas',
    );
    for (const p of ['raw', 'graded'] as const) {
      const kind = shippingRuleKindOf(cards(p));
      expect(kind).toBe('cards_only');
      for (const s of [s1, s2]) {
        const out = directShipFeeOf(kind, s, D);
        expect(out.feeCents).toBe(fee);
        expect(out.rule).toMatchObject({ freeShippingApplied: false, freeShippingRemainingCents: D.freeFromCents - s });
      }
      const atT = directShipFeeOf(kind, sT, D);
      expect(atT.feeCents).toBe(zero);
      expect(atT.rule).toMatchObject({ freeShippingApplied: true, freeShippingRemainingCents: 0, freeFromCents: D.freeFromCents });
    }
  });

  it('ENV-1 sellado: «S = a ⇒ E y falta f; S = T ⇒ 0»', () => {
    const [s1, fee, falta, sT, zero] = read(
      /sellado `S` = (\d+) ⇒ (\d+) y falta (\d+); `S` = (\d+) ⇒ (\d+)/,
      'caso ENV-1 de sellado',
    );
    const under = directShipFeeOf('sealed', s1, D);
    expect([under.feeCents, under.rule.freeShippingRemainingCents]).toEqual([fee, falta]);
    expect(directShipFeeOf('sealed', sT, D).feeCents).toBe(zero);
  });

  it('ENV-1 cajas: grande conserva su tarifa bajo y sobre T; chica ⇒ tarifa del sellado bajo T y 0 sobre T', () => {
    const [big, bigFee] = read(/caja (\d+) ⇒\s+(\d+) bajo y sobre T/, 'caso ENV-1 de caja grande');
    const [small, smallUnder, smallOver] = read(/caja (\d+) ⇒ (\d+) bajo T y (\d+) sobre T/, 'caso ENV-1 de caja chica');
    const kind = shippingRuleKindOf(acc);
    for (const s of [50000, D.freeFromCents]) {
      const out = directShipFeeOf(kind, s, D, { customerFeeCents: big });
      expect(out.feeCents).toBe(bigFee);
      expect(out.rule.boxFeeApplies).toBe(true);
    }
    expect(directShipFeeOf(kind, D.freeFromCents, D, { customerFeeCents: big }).rule.freeShippingApplied).toBe(false);
    expect(directShipFeeOf(kind, 50000, D, { customerFeeCents: small }).feeCents).toBe(smallUnder);
    expect(directShipFeeOf(kind, D.freeFromCents, D, { customerFeeCents: small }).feeCents).toBe(smallOver);
  });

  // v1.109.5 (QA sobre fc84acde: S=474000 cobraba 35000 con T9 «te faltan» pintado): con caja grande cruzar T no quita
  // el envío ⇒ `freeShippingRemainingCents: null` bajo y sobre T, y T9 no se pinta. Las `S` se leen del contrato.
  it('ENV-1 v1.109.5: caja grande ⇒ `boxFeeApplies` y `freeShippingRemainingCents: null` bajo y sobre T (sin T9); chica ⇒ T − S', () => {
    const [big, bigFee, sUnder, sOver] = read(
      /caja (\d+) ⇒\s+(\d+) bajo y sobre T \(`boxFeeApplies:true` y `freeShippingRemainingCents:null` en ambos — `S` = (\d+) y (\d+) —/,
      'caso ENV-1 v1.109.5 de caja grande',
    );
    expect(sUnder).toBeLessThan(D.freeFromCents);
    expect(sOver).toBeGreaterThanOrEqual(D.freeFromCents);
    expect(SECTION).toContain('el mock devuelve `null` con caja grande ⇒ sin T9, bajo y sobre T');
    const kind = shippingRuleKindOf(acc);
    for (const s of [sUnder, sOver]) {
      const out = directShipFeeOf(kind, s, D, { customerFeeCents: big });
      expect(out.feeCents, `E con caja grande, S=${s}`).toBe(bigFee);
      expect(out.rule, `S=${s}`).toMatchObject({ boxFeeApplies: true, freeShippingRemainingCents: null, freeShippingApplied: false });
    }
    // Chica: «remaining = T − S, como sin caja».
    const [small] = read(/caja (\d+) ⇒ \d+ bajo T y \d+ sobre T \(chica: remaining = `T − S`/, 'caso ENV-1 de caja chica (remaining)');
    expect(directShipFeeOf(kind, sUnder, D, { customerFeeCents: small }).rule.freeShippingRemainingCents).toBe(D.freeFromCents - sUnder);
  });

  it('ENV-F1: T9 ⇔ `kind ≠ null ∧ freeShippingRemainingCents > 0` — el mock lo da en las dos clases bajo T y lo quita en T', () => {
    expect(SECTION).toContain('T9 se pinta con `kind ≠ null ∧ freeShippingRemainingCents > 0`');
    const t9 = (r: { kind: unknown; freeShippingRemainingCents: number | null }) =>
      r.kind !== null && (r.freeShippingRemainingCents ?? 0) > 0;
    for (const kind of ['cards_only', 'sealed'] as const) {
      expect(t9(directShipFeeOf(kind, D.freeFromCents - 1, D).rule), `${kind} bajo T`).toBe(true);
      expect(t9(directShipFeeOf(kind, D.freeFromCents, D).rule), `${kind} en T`).toBe(false);
    }
    expect(t9(directShipFeeOf(null, 0, D).rule)).toBe(false);
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
    expect((await getGuestCheckoutQuote(['inv-1003'])).breakdown.shippingFeeCents).toBe(10000);
    expect((await getPublicShippingRule()).sealedFeeCents).toBe(17500);
  });

  it('ENV-2: carrito solo de cartas bajo T ⇒ 10000, `kind: cards_only` y la falta; 100 % podado ⇒ `kind: null`', async () => {
    const q = await getGuestCheckoutQuote(['inv-1003']);
    expect(q.breakdown.shippingFeeCents).toBe(10000);
    expect(q.shippingRule?.kind).toBe('cards_only');
    expect(q.shippingRule?.freeShippingRemainingCents).toBe(400000 - q.breakdown.subtotalCents);
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

  it('solo cartas (gradeada) con S ≥ T ⇒ envío 0 y `freeShippingApplied` (dueño 2026-10-25, opción A)', async () => {
    const q = await getGuestCheckoutQuote(['inv-1001']);
    expect(q.breakdown.subtotalCents).toBeGreaterThanOrEqual(400000);
    expect(q.breakdown.shippingFeeCents).toBe(0);
    expect(q.shippingRule).toMatchObject({ kind: 'cards_only', freeShippingApplied: true, freeShippingRemainingCents: 0 });
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
    const q = await getGuestCheckoutQuote(['inv-1003'], undefined, undefined, { deckPulls: pulls });
    // Sin el arreglo la clase sale `sealed` (y el envío 17500 bajo T): se asierta la clase primero.
    expect(q.shippingRule?.kind).toBe('cards_only');
    expect(q.breakdown.shippingFeeCents).toBe(10000);
    const s = await createGuestCheckoutSession({
      inventoryItemIds: ['inv-1003'],
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

  // TL-ENV-F5 (techlead, 2026-10-25): la otra mitad de TL-R2. Un pull con token VÁLIDO y `withEnergyBundle: true` deja
  // el paquete aceptado (`energyBundles`) ⇒ cuenta como accesorio (D-ENV-3) ⇒ `sealed` y 17500 aun con solo cartas.
  // Muerde si se quita `+ acc.energyBundles.length` del cálculo de envío del quote (`lib/api.ts`) o de la sesión.
  it('paridad: deckPull CON paquete aceptado + solo cartas ⇒ `sealed` y 17500 (quote y sesión)', async () => {
    // MOCK: token legible `mock-pull:<slug>:<ids>`; el deck existe y sus ids están en el carrito ⇒ válido.
    const pulls = [{ pullToken: mockPullToken('dragapult-ex', ['inv-1003']), withEnergyBundle: true }];
    const q = await getGuestCheckoutQuote(['inv-1003'], undefined, undefined, { deckPulls: pulls });
    expect(q.unavailableBundles, 'el paquete tiene que quedar aceptado, no podado').toEqual([]);
    expect(q.energyBundles).toHaveLength(1);
    expect(q.breakdown.subtotalCents).toBeLessThan(D.freeFromCents);
    expect(q.shippingRule?.kind).toBe('sealed');
    expect(q.breakdown.shippingFeeCents).toBe(17500);
    const s = await createGuestCheckoutSession({
      inventoryItemIds: ['inv-1003'],
      email: 'tlf5@example.com',
      shippingAddress: {
        line1: 'Calle 1',
        neighborhood: 'Centro',
        city: 'Guadalajara',
        state: 'Jalisco',
        postalCode: '44100',
        country: 'MX',
        phone: '3312345678',
        recipientName: 'Tl Cinco',
      },
      acceptedTerms: true,
      deckPulls: pulls,
    });
    expect(s.breakdown.shippingFeeCents).toBe(17500);
  });

  it('M10 mueve la tarifa del mock (criterio 196) y ENV-3: la sesión cobra lo mismo que el quote', async () => {
    fx.setMockSettings({ directShipCardsFeeCents: 5000 });
    const q = await getGuestCheckoutQuote(['inv-1003']);
    expect(q.breakdown.shippingFeeCents).toBe(5000);
    const s = await createGuestCheckoutSession({
      inventoryItemIds: ['inv-1003'],
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
