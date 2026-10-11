/**
 * wishlist-math.spec.ts — rev v1.87⟨wishlist⟩ (API_CONTRACT §WSH.3). La aritmética PURA de la lista de deseos.
 *
 * WSH-T22 (criterio 827) — las doce cifras al centavo, `m=20` ⇒ 83333 y `sale` ⇒ 85000.
 * WSH-T35 (unit, Q-WSH-UX-8) — `marginAtMarket = {-9483, -9.5}` con una cuenta al 5 % y `{0, 0}` al 16 %; `pct` en PUNTOS.
 *
 * ⛔ El oráculo son CIFRAS escritas a mano (las del contrato y del criterio 827), no la función medida: *un oráculo que
 * comparte implementación con lo que mide no es un oráculo* (precedente `helpers/iva-display.ts`).
 * Canarios de mutación (§WSH.9): redondear el intermedio a centavos ⇒ T22 rojo; `pct` como fracción ⇒ T35 rojo.
 */
import { ceiling, demandRowMath, fits, halfDiv, marginAtMarket, maxDisplay } from '../src/common/wishlist-math';

const DIALS = { ivaRatePct: 16, ivaTransferPct: 100 };
const M = 100000; // mercado $1,000
const NORMAL = 133400; // precio normal $1,150 sin IVA ⇒ $1,334 con IVA (criterio 827)

describe('halfDiv — redondeo a la mitad hacia arriba del cociente EXACTO', () => {
  it('casos de frontera', () => {
    expect(halfDiv(5, 2)).toBe(3);
    expect(halfDiv(7, 2)).toBe(4);
    expect(halfDiv(4, 3)).toBe(1);
    expect(halfDiv(5, 3)).toBe(2);
    expect(halfDiv(0, 7)).toBe(0);
  });
});

describe('maxDisplay (WSH.3) — el máximo del cliente con IVA dentro', () => {
  it('with_iva: el % ya incluye el IVA ⇒ 105000 / 110000 / 116000', () => {
    expect([5, 10, 16].map((p) => maxDisplay(M, p as 5 | 10 | 16, 'with_iva', DIALS))).toEqual([105000, 110000, 116000]);
  });
  it('without_iva: el % como si fuera precio de lista ⇒ 121800 / 127600 / 134560 (WSH-T31)', () => {
    expect([5, 10, 16].map((p) => maxDisplay(M, p as 5 | 10 | 16, 'without_iva', DIALS))).toEqual([121800, 127600, 134560]);
  });
  it('criterio 808: $1,000 al 10 % ⇒ 110000 con IVA y 127600 sin IVA', () => {
    expect(maxDisplay(M, 10, 'with_iva', DIALS)).toBe(110000);
    expect(maxDisplay(M, 10, 'without_iva', DIALS)).toBe(127600);
  });
  it('criterio 806: mercado 1200 al 10 % ⇒ 132000', () => {
    expect(maxDisplay(120000, 10, 'with_iva', DIALS)).toBe(132000);
  });
});

describe('fits (WSH.3)', () => {
  it('P = máximo exacto ⇒ cabe; P un centavo arriba ⇒ no; sin mercado ⇒ null', () => {
    expect(fits(110000, M, 10, 'with_iva', DIALS)).toBe(true);
    expect(fits(110001, M, 10, 'with_iva', DIALS)).toBe(false);
    expect(fits(110000, null, 10, 'with_iva', DIALS)).toBeNull();
  });
  it('WSH-T33: P 133400 al 16 % ⇒ no cabe con IVA (116000) y sí sin IVA (134560)', () => {
    expect(fits(133400, M, 16, 'with_iva', DIALS)).toBe(false);
    expect(fits(133400, M, 16, 'without_iva', DIALS)).toBe(true);
  });
});

describe('WSH-T22 — criterio 827, las doce cifras al centavo', () => {
  const row = (mode: 'with_iva' | 'without_iva', marginPct: number, basis: 'cost' | 'sale') =>
    demandRowMath({
      marketCents: M,
      normalDisplayCents: NORMAL,
      tiers: [
        { maxPct: 5, accounts: 1 },
        { maxPct: 10, accounts: 1 },
        { maxPct: 16, accounts: 1 },
      ],
      ivaMode: mode,
      dials: DIALS,
      targetMarginPct: marginPct,
      marginBasis: basis,
    });

  it('con IVA, 15 % sobre costo ⇒ 78711 / 82459 / 86957 (5/10/16) y techo 86957', () => {
    const r = row('with_iva', 15, 'cost');
    const by = Object.fromEntries(r.tiers.map((t) => [t.maxPct, t.ceilingCents]));
    expect(by).toEqual({ 5: 78711, 10: 82459, 16: 86957 });
    expect(r.mainCeilingCents).toBe(86957);
  });

  it('sin IVA ⇒ 91304 / 95652 / 100000 (el 16 % lo topa el precio normal 133400)', () => {
    const r = row('without_iva', 15, 'cost');
    const by = Object.fromEntries(r.tiers.map((t) => [t.maxPct, t.ceilingCents]));
    expect(by).toEqual({ 5: 91304, 10: 95652, 16: 100000 });
    expect(r.mainCeilingCents).toBe(100000);
  });

  it('margen 20 % y 16 % con IVA ⇒ 83333', () => {
    const r = row('with_iva', 20, 'cost');
    expect(r.tiers.find((t) => t.maxPct === 16)!.ceilingCents).toBe(83333);
  });

  it('base `sale` y 16 % con IVA ⇒ 85000 (P-WSH-7 (b))', () => {
    const r = row('with_iva', 15, 'sale');
    expect(r.tiers.find((t) => t.maxPct === 16)!.ceilingCents).toBe(85000);
  });

  it('`ceiling` directo: un solo redondeo — 105000 al 15 % sobre costo ⇒ 78711 (redondear el intermedio daría 78710)', () => {
    expect(ceiling(105000, 'cost', 15, 16)).toBe(78711);
  });

  it('niveles en orden 16 → 10 → 5, solo los que tienen cuentas, con su máximo CON IVA', () => {
    const r = demandRowMath({
      marketCents: M,
      normalDisplayCents: null,
      tiers: [
        { maxPct: 5, accounts: 2 },
        { maxPct: 16, accounts: 1 },
      ],
      ivaMode: 'with_iva',
      dials: DIALS,
      targetMarginPct: 15,
      marginBasis: 'cost',
    });
    expect(r.tiers.map((t) => [t.maxPct, t.accounts, t.maxDisplayCents])).toEqual([
      [16, 1, 116000],
      [5, 2, 105000],
    ]);
  });

  it('sin mercado ⇒ todo `null` (ni 0): máximos, techos, techo principal, margen y compradores (807, 820)', () => {
    const r = demandRowMath({
      marketCents: null,
      normalDisplayCents: null,
      tiers: [{ maxPct: 10, accounts: 3 }],
      ivaMode: 'with_iva',
      dials: DIALS,
      targetMarginPct: 15,
      marginBasis: 'cost',
    });
    expect(r.tiers).toEqual([{ maxPct: 10, accounts: 3, maxDisplayCents: null, ceilingCents: null }]);
    expect(r.mainCeilingCents).toBeNull();
    expect(r.marginAtMarket).toBeNull();
    expect(r.buyersAtNormalPrice).toBeNull();
  });

  it('cuántas pagan el precio normal: cuentas con máximo ≥ P normal', () => {
    const r = demandRowMath({
      marketCents: M,
      normalDisplayCents: 110000,
      tiers: [
        { maxPct: 5, accounts: 4 },
        { maxPct: 10, accounts: 2 },
        { maxPct: 16, accounts: 1 },
      ],
      ivaMode: 'with_iva',
      dials: DIALS,
      targetMarginPct: 15,
      marginBasis: 'cost',
    });
    expect(r.buyersAtNormalPrice).toBe(3);
  });
});

describe('WSH-T35 (unit) — `marginAtMarket` en PUNTOS porcentuales con un decimal', () => {
  it('una cuenta al 5 % con IVA ⇒ { cents: -9483, pct: -9.5 }', () => {
    expect(marginAtMarket(105000, M, 16)).toEqual({ cents: -9483, pct: -9.5 });
  });
  it('una al 16 % ⇒ { cents: 0, pct: 0 }', () => {
    expect(marginAtMarket(116000, M, 16)).toEqual({ cents: 0, pct: 0 });
  });
  it('positivo: tope 133400 ⇒ +15000 = +15.0 puntos', () => {
    expect(marginAtMarket(133400, M, 16)).toEqual({ cents: 15000, pct: 15 });
  });
  it('redondeo simétrico: +x y −x salen del mismo |x|', () => {
    const neg = marginAtMarket(105000, M, 16)!;
    expect(neg.pct).toBe(-9.5);
    expect(Math.abs(neg.pct)).toBe(9.5);
  });
  it('M ≤ 0 ⇒ null (nunca división entre cero)', () => {
    expect(marginAtMarket(105000, 0, 16)).toBeNull();
  });
  it('vía la fila: una sola cuenta al 5 % sin precio normal ⇒ -9483 / -9.5', () => {
    const r = demandRowMath({
      marketCents: M,
      normalDisplayCents: null,
      tiers: [{ maxPct: 5, accounts: 1 }],
      ivaMode: 'with_iva',
      dials: DIALS,
      targetMarginPct: 15,
      marginBasis: 'cost',
    });
    expect(r.marginAtMarket).toEqual({ cents: -9483, pct: -9.5 });
  });
});
