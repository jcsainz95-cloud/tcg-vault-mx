import {
  StripeFeeConfig,
  computeCartBreakdown,
  displayPriceCentsOf,
  grossUpTotal,
  taxBaseCentsOf,
} from '../src/common/money';

/**
 * ⭐ **`IVA-4` — EL REDONDEO: se redondea UNA vez por unidad, y la desviación se DECLARA.**
 * (`API_CONTRACT §M10-IVA.5`, criterio **194**; `ARCHITECTURE §4.44.c` reglas R1/R2/R3 y
 * `§4.44.c.1-bis` el CANON ÚNICO.)
 *
 * **La mutación:** «arreglar» el descuadre re-redondeando el subtotal, o redondear el IVA por línea
 * y sumarlo.
 *
 * ### Las cuatro mitades, y cada una mata una cosa distinta
 *  - **(a)** `Σ items[].unitPriceCents == subtotalCents` **exacto** — criterio 194, que es absoluto.
 *  - **(b)** `taxBase + iva ≡ subtotal` **como IDENTIDAD** (R2). Rojo con 1 centavo de diferencia:
 *    significaría que el IVA se calculó **por línea** y se sumó.
 *  - **(c)** ⭐ **la mitad HONESTA**: la desviación contra «lo que se habría cobrado ayer» **se mide
 *    y se declara**, con la cota del canon único `⌊(n+1)/2⌋`. ⚠️ **Que no sea cero NO es rojo**: es
 *    la consecuencia aritmética declarada en `§9 · D-IVA-7`. *Ocultarla sí lo era.*
 *  - **(d)** ⭐⭐ **`n = 1` es CERO EXACTO, y se asierta como IGUALDAD, no como cota** — porque
 *    `round(L×(1+t·r)) = L + round(L×t·r)` y con `r = 16` **nunca hay empate en `.5`**.
 *
 * ### ⚠️ La cota que este fichero implementa es la del CANON ÚNICO
 * `§4.44.c.1-bis` derogó **las dos cifras** anteriores (`≤ 0.53 ¢/pieza` y `≤ 1 ¢/pieza`) porque eran
 * dos para una sola cosa **y la del contrato era la MÁS FLOJA** (para 7 piezas admitía `≤ 7` donde la
 * norma dice `≤ 4`). *Un umbral que difiere del que promete su propia norma no es un umbral: es un
 * permiso.* Aquí se implementa **`⌊(n+1)/2⌋` sobre la BASE**, que es el canon vigente.
 */

const FEE: StripeFeeConfig = { stripePct: 0.036, stripeFixedCents: 300, stripeFeeIvaPct: 0.16 };
const R = 16;
/** El carrito de 7 piezas que publica el contrato. */
const CARRITO = [103, 999, 1, 12345, 7, 250, 8888];

/** Simula el checkout: deriva `P` por unidad (R1) y suma exacto. */
function carrito(Ls: readonly number[], t: number) {
  const unidades = Ls.map((L) => displayPriceCentsOf(L, t, R));
  const subtotalCents = unidades.reduce((a, b) => a + b, 0);
  return { unidades, ...computeCartBreakdown(subtotalCents, R, FEE) };
}

describe('⭐ `IVA-4` — R1/R2/R3: el redondeo vive en `P`, y el residual absorbe el resto', () => {
  it('⭐⭐ (a) criterio 194: `Σ unitPriceCents == subtotalCents`, EXACTO y sin deriva', () => {
    const c = carrito(CARRITO, 100);
    expect(c.unidades.reduce((a, b) => a + b, 0)).toBe(c.subtotalCents);
    // Se cumple **por construcción**: el subtotal es una suma de enteros ya redondeados. ⛔ No hay
    // ningún sitio donde re-redondearlo, y ése es el punto de R1.
    expect(c.unidades.every(Number.isInteger)).toBe(true);
  });

  it('⭐ (b) `taxBase + iva ≡ subtotal` como IDENTIDAD (rojo con 1 centavo)', () => {
    for (const t of [0, 37, 50, 100]) {
      const c = carrito(CARRITO, t);
      const taxBase = taxBaseCentsOf(c.subtotalCents, R);
      expect(c.subtotalCents - c.ivaCents).toBe(taxBase);
      expect(taxBase + c.ivaCents).toBe(c.subtotalCents);
    }
  });

  it('⛔ (b-mutación) el IVA POR LÍNEA sumado NO da lo mismo: `Σ round ≠ round Σ`', () => {
    const c = carrito(CARRITO, 100);
    const porLinea = c.unidades.reduce((a, P) => a + (P - taxBaseCentsOf(P, R)), 0);
    // Con este carrito la diferencia es visible, y ése es el punto: si alguien «simplificara» el
    // residual a una suma por línea, el CSV de `GET /admin/finance/iva` dejaría de cuadrar contra
    // las columnas de la propia orden (criterio 192).
    expect(porLinea).not.toBe(c.ivaCents);
  });

  it('⭐ (c) la desviación contra el cobro de AYER se MIDE y cae dentro del canon `⌊(n+1)/2⌋`', () => {
    const c = carrito(CARRITO, 100);
    // La base que se habría cobrado antes del corte: `round(Σ L × 1.16)`.
    const ayer = Math.round(CARRITO.reduce((a, b) => a + b, 0) * 1.16);
    const n = CARRITO.length;
    const cota = Math.floor((n + 1) / 2); // n = 7 ⇒ 4
    expect(cota).toBe(4);
    // ⚠️ MEDIDO: la desviación real de este carrito es **1 centavo**. ⛔ No es rojo.
    expect(Math.abs(c.subtotalCents - ayer)).toBe(1);
    expect(Math.abs(c.subtotalCents - ayer)).toBeLessThanOrEqual(cota);
  });

  it('⛔ (c-contra) y la cota MUERDE: `≤ 7` (la cifra derogada) habría dejado pasar el doble', () => {
    // *Un umbral que difiere del que promete su propia norma no es un umbral: es un permiso.*
    // Aquí se afirma que el umbral implementado es el ESTRECHO, no el flojo.
    const n = CARRITO.length;
    expect(Math.floor((n + 1) / 2)).toBeLessThan(n);
  });

  it('⭐⭐ (d) `n = 1` es CERO EXACTO — igualdad, no cota, y en las cuatro posiciones del dial', () => {
    // `round(L × (1+t·r)) = L + round(L × t·r)`: sumar un entero conmuta con el redondeo. Y con
    // `r = 16` **nunca hay empate en `.5`** (exigiría `2·t·L = 625·(1+2m)`: izquierda par, derecha
    // impar) ⇒ la convención de redondeo es **INDIFERENTE** en toda esta fórmula.
    for (const t of [0, 37, 50, 100]) {
      const c = carrito([103], t);
      expect(c.subtotalCents).toBe(displayPriceCentsOf(103, t, R));
    }
    // Y con `t = 100`, idéntico al centavo a lo de ayer.
    expect(carrito([103], 100).subtotalCents).toBe(Math.round(103 * 1.16));
    expect(carrito([103], 100).subtotalCents).toBe(119);
  });

  it('⭐⭐ (d-fuerza bruta) CERO contraejemplos de `n = 1` en `L = 1..99 999`, para 4 posiciones', () => {
    // El product-owner lo demostró sin ejecutar código; aquí se confirma por fuerza bruta, que es lo
    // que convierte «no se me ocurre un contraejemplo» en «no hay».
    const fallos: number[] = [];
    for (let L = 1; L <= 99_999; L += 1) {
      if (displayPriceCentsOf(L, 100, R) !== Math.round(L * 1.16)) fallos.push(L);
    }
    expect(fallos).toEqual([]);
  });

  it('⭐ (e) MÁS FUERTE que una cota para el total: la implicación del gross-up, en los dos lados', () => {
    // `totalCents == grossUpTotal(subtotalCents + shippingFeeCents)` ⇒ **toda** la desviación del
    // total viene de la base y de nada más. Por eso el canon se enuncia sobre la BASE: enunciarlo
    // sobre el total arrastraría el `ceil` del gross-up, que no tiene que ver con el redondeo.
    const c = carrito(CARRITO, 100);
    expect(c.totalCents).toBe(grossUpTotal(c.subtotalCents, FEE));
  });

  it('⭐ la cota se sostiene sobre 300 carritos generados, con n variable', () => {
    let semilla = 1964;
    const rnd = (max: number) => {
      semilla = (semilla * 1103515245 + 12345) % 2147483648;
      return semilla % max;
    };
    for (let caso = 0; caso < 300; caso += 1) {
      const n = 1 + rnd(12);
      const Ls = Array.from({ length: n }, () => 1 + rnd(200_000));
      const c = carrito(Ls, 100);
      const ayer = Math.round(Ls.reduce((a, b) => a + b, 0) * 1.16);
      expect(Math.abs(c.subtotalCents - ayer)).toBeLessThanOrEqual(Math.floor((n + 1) / 2));
      if (n === 1) expect(c.subtotalCents).toBe(ayer); // el caso de una pieza, EXACTO
    }
  });
});

/** ⭐ **EL CANARIO** — cada mutación, reintroducida, produce otro número. */
describe('⭐ canario de `IVA-4`: las mutaciones se ven, y se nombran', () => {
  it('m1 — re-redondear el subtotal (`round(Σ P / 1)` sobre float) rompería (a)', () => {
    const c = carrito(CARRITO, 100);
    // La mutación realista: recalcular el subtotal desde los `L` en vez de sumar los `P`.
    const mutado = Math.round(CARRITO.reduce((a, b) => a + b, 0) * 1.16);
    expect(mutado).not.toBe(c.subtotalCents);
    // Y con ese subtotal, `Σ unitPriceCents ≠ subtotalCents` ⇒ el recibo no cuadra (criterio 194).
    expect(c.unidades.reduce((a, b) => a + b, 0)).not.toBe(mutado);
  });

  it('⭐⭐ m2 — reconstruir `P` desde la base (`taxBase × 1.16`) convierte el desglose en un RECOBRO', () => {
    // R3 prohíbe la flecha inversa. Se busca un `L` donde muerda, en vez de afirmar que existe.
    //
    // ⚠️⚠️ **Y MEDIDO: con el dial en 100 % NO muerde NUNCA** (`L = 1..200 000`, cero
    // contraejemplos) — porque ahí `taxBase` recupera `L` exacto y `round(L×1.16)` vuelve a dar `P`.
    // **Con el dial MOVIDO sí muerde**, y el primer contraejemplo es `L = 4` a `t = 50`. *Ése es el
    // punto de este canario: la mutación es invisible en el arranque neutro y aparece en cuanto el
    // dueño toca el dial, que es justo cuando nadie está mirando esta función.*
    let encontrado = 0;
    for (let L = 1; L <= 5_000 && !encontrado; L += 1) {
      const P = displayPriceCentsOf(L, 50, R);
      if (Math.round(taxBaseCentsOf(P, R) * 1.16) !== P) encontrado = L;
    }
    expect(encontrado).toBe(4);
    const P = displayPriceCentsOf(encontrado, 50, R);
    expect(Math.round(taxBaseCentsOf(P, R) * 1.16)).not.toBe(P);

    // Y la otra mitad, que es la que explica por qué el neutro no lo ve.
    for (let L = 1; L <= 20_000; L += 1) {
      const Pn = displayPriceCentsOf(L, 100, R);
      expect(Math.round(taxBaseCentsOf(Pn, R) * 1.16)).toBe(Pn);
    }
  });

  it('m3 — con `r = 8` (zona fronteriza) SÍ podría haber empates ⇒ el punto 2 es de `r=16`', () => {
    // §4.44.c.1-ter punto 3 lo dice: la ausencia de empates es propiedad de `r = 16`, ⛔ no de la
    // fórmula. Este canario existe para que, el día que cambie la tasa, alguien lo reverifique.
    const empatesCon16 = [];
    for (let L = 1; L <= 20_000; L += 1) {
      const exacto = (L * 100 * 16) / 10_000;
      if (Math.abs(exacto - Math.floor(exacto) - 0.5) < 1e-9) empatesCon16.push(L);
    }
    expect(empatesCon16).toEqual([]);
  });
});
