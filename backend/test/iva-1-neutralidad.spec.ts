import {
  StripeFeeConfig,
  computeCartBreakdown,
  displayPriceCentsOf,
  grossUpTotal,
  netRevenueCents,
  taxBaseCentsOf,
} from '../src/common/money';

/**
 * ⭐⭐ **`IVA-1` — EL CANDADO DE LA FEATURE, Y ES UNA IGUALDAD CONTRA EL PASADO.**
 * (`API_CONTRACT §M10-IVA.5`, criterio **185**; `ARCHITECTURE §4.44.a/.c`.)
 *
 * > *«Si alguien paga un centavo distinto, es un fallo de release.»*
 *
 * ### Qué mide y qué ⛔ no
 * ⛔ **No mide la forma de ningún campo.** Mide **qué dinero sale**: con el dial en su valor inicial
 * (`100 %`, el NEUTRO), una pieza de `L = MX$100.00` produce **exactamente** las cifras que se
 * producían antes del corte, y **el margen no se mueve**. Ésa es la promesa entera de D54/D56.
 *
 * ### ⭐⭐ Y el VIAJE COMPLETO, que es lo que lo hace un candado y no una constante copiada
 * Las **tres** posiciones que `PROJECT §Q.4` publica —`{100 → 11600/1600/12469/neto 10000}`,
 * `{50 → 10800/1490/11634/neto 9310}`, `{0 → 10000/1379/10799/neto 8621}`— se asiertan enteras. Una
 * implementación que produzca otra cosa **está mal**, aunque el caso neutro cuadre: *un candado que
 * solo prueba el punto de partida no distingue «la fórmula es correcta» de «alguien clavó el
 * resultado del arranque».*
 *
 * ### ⛔ Y el dial en 0 % NO pone el IVA en 0
 * `t = 0` exhibe `10000` y el IVA registrado sigue siendo **`1379`** — el residual de lo que de
 * verdad se cobró. *Mover el dial reduce el NETO, jamás el impuesto registrado* (criterio 192).
 */

/** Los diales de Stripe vigentes (`0.036` / `300`), con su IVA derivado de `iva_pct` (v1.40). */
const FEE: StripeFeeConfig = { stripePct: 0.036, stripeFixedCents: 300, stripeFeeIvaPct: 0.16 };
const R = 16;
/** `L` del criterio 185: **una** pieza de MX$100.00. */
const L = 10_000;

/** Una posición del dial, calculada por el camino REAL del checkout (derivar `P` → desglosar). */
function posicion(t: number) {
  const displayPriceCents = displayPriceCentsOf(L, t, R);
  const b = computeCartBreakdown(displayPriceCents, R, FEE);
  return {
    displayPriceCents,
    subtotalCents: b.subtotalCents,
    ivaCents: b.ivaCents,
    processingFeeCents: b.processingFeeCents,
    totalCents: b.totalCents,
    // El margen de la orden ya liquidada, por el MISMO helper que el P&L.
    netRevenueCents: netRevenueCents({
      subtotalCents: b.subtotalCents,
      ivaRatePct: b.ivaRatePct,
      priceConvention: b.priceConvention,
    }),
  };
}

describe('⭐⭐ `IVA-1` — el arranque es NEUTRO: nadie paga distinto el día del despliegue', () => {
  it('⭐⭐ con el dial en su valor INICIAL (100 %), las cinco cifras son las de hoy', () => {
    expect(posicion(100)).toEqual({
      displayPriceCents: 11_600,
      subtotalCents: 11_600,
      ivaCents: 1_600,
      processingFeeCents: 869,
      totalCents: 12_469,
      // ⭐ La mitad que importa: **el margen no se movió**.
      netRevenueCents: 10_000,
    });
  });

  it('⛔ rojo con 12468 o 12470 — el total es una IGUALDAD, no una cota', () => {
    const { totalCents } = posicion(100);
    expect(totalCents).not.toBe(12_468);
    expect(totalCents).not.toBe(12_470);
  });

  it('⭐⭐ el VIAJE del dial: las TRES posiciones de `PROJECT §Q.4`, enteras', () => {
    expect(posicion(50)).toEqual({
      displayPriceCents: 10_800,
      subtotalCents: 10_800,
      ivaCents: 1_490,
      processingFeeCents: 834,
      totalCents: 11_634,
      netRevenueCents: 9_310,
    });
    expect(posicion(0)).toEqual({
      displayPriceCents: 10_000,
      subtotalCents: 10_000,
      // ⛔ **JAMÁS 0**: mover el dial reduce el NETO, nunca el impuesto registrado (crit. 192).
      ivaCents: 1_379,
      processingFeeCents: 799,
      totalCents: 10_799,
      netRevenueCents: 8_621,
    });
  });

  it('⭐ bajar el dial NO baja el impuesto: baja el MARGEN, y la diferencia sale de ahí', () => {
    const cien = posicion(100);
    const cero = posicion(0);
    // El cliente paga MENOS…
    expect(cero.totalCents).toBeLessThan(cien.totalCents);
    // …y lo que se cede sale del margen, ⛔ no del IVA (que baja solo porque la base bajó).
    expect(cien.netRevenueCents - cero.netRevenueCents).toBe(1_379);
    expect(cero.ivaCents).toBeGreaterThan(0);
  });

  it('⭐ el delta del criterio 188: de 100 % a 50 % son **−690** centavos por unidad', () => {
    expect(posicion(50).netRevenueCents - posicion(100).netRevenueCents).toBe(-690);
  });

  it('⭐ `t = 100` reproduce `round(L × 1.16)` para CUALQUIER `L`, no solo para 10000', () => {
    // La identidad de §4.44.c.1-ter punto 1: `round(L × (1+t·r)) = L + round(L × t·r)`. Se mide por
    // fuerza bruta sobre un rango ancho: si el redondeo se hiciera de otra forma, aquí saldría.
    for (let x = 1; x <= 50_000; x += 1) {
      if (displayPriceCentsOf(x, 100, R) !== Math.round(x * 1.16)) {
        throw new Error(`divergencia en L=${x}`);
      }
    }
    expect(displayPriceCentsOf(50_000, 100, R)).toBe(Math.round(50_000 * 1.16));
  });
});

/**
 * ⭐⭐ **EL CANARIO — se reintroduce cada defecto y se exige el rojo.**
 * *Un candado sin canario no es un candado: es una esperanza.*
 */
describe('⭐ canario de `IVA-1`: las mutaciones producen OTRO dinero, y se nombra cuál', () => {
  it('m1 — derivar con `L × (1+r)` ignorando el dial ⇒ el dial deja de mover el precio', () => {
    const mutado = (Lx: number, _t: number) => Math.round(Lx * 1.16);
    // Con `t = 0` el precio real es `10000`; la mutación seguiría exhibiendo `11600`.
    expect(mutado(L, 0)).toBe(11_600);
    expect(displayPriceCentsOf(L, 0, R)).toBe(10_000);
    expect(mutado(L, 0)).not.toBe(displayPriceCentsOf(L, 0, R));
  });

  it('m2 — calcular el IVA con `round(P × r)` en vez de por RESIDUAL ⇒ el desglose no cuadra', () => {
    const P = displayPriceCentsOf(L, 100, R);
    const porResidual = P - taxBaseCentsOf(P, R); // 1600
    const mutado = Math.round((P * R) / 100); // 1856
    expect(porResidual).toBe(1_600);
    expect(mutado).toBe(1_856);
    // La mutación rompe la identidad `taxBase + iva ≡ P`: sobre el mismo precio exhibido reporta
    // 256 centavos de impuesto que nadie cobró.
    expect(P - mutado + mutado).toBe(P);
    expect(taxBaseCentsOf(P, R) + mutado).not.toBe(P);
  });

  it('m3 — «simplificar» el neto a `subtotal − iva` con el dial en 0 ⇒ 8621 se convierte en 8621…', () => {
    // ⚠️ Con `E = 0` las dos fórmulas COINCIDEN, y por eso este canario existe: **el caso de bóveda
    // no distingue la mutación**. La que sí la distingue es `IVA-9(b)`, con envío. Se dice aquí para
    // que nadie lea el verde de este fichero como cobertura de esa fórmula.
    const p = posicion(0);
    expect(p.subtotalCents - p.ivaCents).toBe(p.netRevenueCents);
    expect(p.netRevenueCents).toBe(8_621);
  });

  it('⭐⭐ m4 — clavar el resultado del arranque (`return 11600`) pasa el caso neutro y MUERE en el viaje', () => {
    const clavado = () => 11_600;
    expect(clavado()).toBe(posicion(100).displayPriceCents); // el caso neutro NO lo distingue
    expect(clavado()).not.toBe(posicion(50).displayPriceCents); // el viaje SÍ
    expect(clavado()).not.toBe(posicion(0).displayPriceCents);
  });

  it('m5 — apagar el gross-up (cobrar `G` a secas) deja a la plataforma pagando la comisión', () => {
    const G = posicion(100).subtotalCents;
    expect(grossUpTotal(G, FEE)).toBe(12_469);
    expect(G).toBe(11_600);
    // Cobrar `G` deja 869 centavos sin cubrir: la plataforma no netearía su base.
    expect(grossUpTotal(G, FEE) - G).toBe(869);
  });
});
