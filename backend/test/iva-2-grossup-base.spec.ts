import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  StripeFeeConfig,
  computeCartBreakdown,
  computeDirectShipBreakdown,
  computeShipmentBreakdown,
  grossUpTotal,
} from '../src/common/money';
import { stripComments } from './helpers/strip-comments';

/**
 * ⭐⭐ **`IVA-2` — LA LÍNEA DE MAYOR RIESGO DEL CAMBIO, Y SE MIDE EN PESOS.**
 * (`API_CONTRACT §M10-IVA.5`; `ARCHITECTURE §4.44.d`.)
 *
 * **La mutación:** restaurar `grossUpBase = subtotal + iva` bajo `IVA_INCLUSIVE`, o dejar vivo un
 * identificador **`baseCents` a secas** que alguien vuelva a alimentar así.
 *
 * **El daño, en el fixture de `IVA-1`:** con `S = 11600` la mutación produce `grossUpBase = 13200`
 * ⇒ **`totalCents = 14139`** en vez de `12469` — **+13.4 % a TODOS los clientes, en silencio, sin
 * excepción y sin log**. No revienta nada: simplemente se cobra de más.
 *
 * ### ⚠️⚠️ DISCREPANCIA CON EL CONTRATO, DICHA AQUÍ Y ENRUTADA AL ARQUITECTO
 * `API_CONTRACT §M10-IVA.5` (`IVA-2`) publica **`14164`** para esa mutación. **Medido: son `14139`.**
 * `grossUpTotal(13200) = ceil((13200 + 1.16·300) / (1 − 1.16·0.036)) = ceil(13548 / 0.95824) =
 * ceil(14138.6) = 14139`. El `14164` parece salir de aplicar *«+13.6 %»* sobre `12469`
 * (`12469 × 1.136 = 14164.8`) en vez de correr el gross-up; el factor real es **1.1339**.
 *
 * ⛔ **Esto NO afloja el candado y por eso se implementa igual:** lo NORMATIVO de `IVA-2` es
 * *«rojo si `totalCents > 12469`»*, y eso se asierta tal cual. El `14164` es la **ilustración del
 * daño**, no el umbral. Se asierta el valor **medido** —y se dice por qué— en vez de copiar una
 * cifra que este árbol no produce: *un test que asierta un número que el código no puede dar no
 * mide el código, mide el documento.* Enrutado en `docs/BACKEND_NOTES.md` (regla 9).
 *
 * ### Las DOS mitades, y hacen falta las dos
 *  - **En pesos:** `totalCents` nunca supera `12469` con ese carrito.
 *  - ⭐ **Estructural:** `totalCents == grossUpTotal(subtotalCents + shippingFeeCents, fee)` **como
 *    IDENTIDAD**, en los **TRES** desgloses (cart, shipment, direct-ship) — *rojo si uno solo de los
 *    tres suma el IVA aparte*. Con los tres derivando de **un solo cuerpo**
 *    (`inclusiveBreakdown`), reintroducir el defecto en uno solo ya no es posible sin tocar los
 *    tres… y esta prueba es la que garantiza que sigan derivando de uno solo.
 */

const FEE: StripeFeeConfig = { stripePct: 0.036, stripeFixedCents: 300, stripeFeeIvaPct: 0.16 };
const R = 16;

describe('⭐⭐ `IVA-2` — el IVA NO se suma a la base del gross-up (o se cobra dos veces)', () => {
  it('⭐⭐ en PESOS: con el fixture de `IVA-1`, `totalCents` es 12469 y ⛔ nunca más', () => {
    const b = computeCartBreakdown(11_600, R, FEE);
    expect(b.totalCents).toBe(12_469);
    // ⛔ El umbral del contrato, literal: «rojo si `totalCents > 12469`».
    expect(b.totalCents).toBeLessThanOrEqual(12_469);
    // Y la cifra exacta de la mutación, nombrada para que se reconozca en un informe.
    expect(b.totalCents).not.toBe(14_139);
  });

  it('⭐ la mutación, reintroducida: `G = S + iva` produce EXACTAMENTE 14139 (+13.4 %)', () => {
    const b = computeCartBreakdown(11_600, R, FEE);
    const mutado = grossUpTotal(b.subtotalCents + b.ivaCents, FEE);
    // ⚠️ MEDIDO: 14139, no el 14164 que publica el contrato (ver la nota de cabecera).
    expect(mutado).toBe(14_139);
    expect(mutado / b.totalCents).toBeGreaterThan(1.13);
    expect(mutado).not.toBe(b.totalCents);
    // Y lo NORMATIVO —el umbral— se cumple con cualquiera de las dos cifras: la mutación excede.
    expect(mutado).toBeGreaterThan(12_469);
  });

  it('⭐⭐ la IDENTIDAD estructural, en los TRES desgloses', () => {
    const cart = computeCartBreakdown(11_600, R, FEE);
    expect(cart.totalCents).toBe(grossUpTotal(cart.subtotalCents, FEE));

    const shipment = computeShipmentBreakdown(20_300, R, FEE);
    // En el retiro de bóveda el «subtotal» del DTO ES la tarifa ⇒ el agregado es esa cifra sola.
    expect(shipment.totalCents).toBe(grossUpTotal(shipment.subtotalCents, FEE));

    const direct = computeDirectShipBreakdown(11_600, 20_300, R, FEE);
    expect(direct.totalCents).toBe(
      grossUpTotal(direct.subtotalCents + direct.shippingFeeCents, FEE),
    );
  });

  it('⭐ y la identidad se sostiene sobre 500 carritos generados, no solo sobre el fixture', () => {
    // Un `it` fijo prueba lo que se me ocurrió; esto prueba lo que no. Determinista a propósito
    // (semilla fija): un candado de dinero que cambia de veredicto entre corridas no es un candado.
    let semilla = 20260914;
    const rnd = (max: number) => {
      semilla = (semilla * 1103515245 + 12345) % 2147483648;
      return semilla % max;
    };
    for (let caso = 0; caso < 500; caso += 1) {
      const S = rnd(5_000_000) + 1;
      const E = rnd(3) === 0 ? 0 : rnd(100_000);
      const d = computeDirectShipBreakdown(S, E, R, FEE);
      expect(d.totalCents).toBe(grossUpTotal(S + E, FEE));
      // ⛔ El IVA NO es un sumando del total (identidad (b) de §M10-IVA.4).
      expect(d.totalCents).toBe(d.subtotalCents + d.shippingFeeCents + d.processingFeeCents);
    }
  });

  it('⛔ POR LO NEGATIVO, sobre el CÓDIGO: no sobrevive ningún identificador `baseCents` a secas', () => {
    // §4.44.d lo pone como norma de NOMBRES porque **el nombre era el defecto**: `baseCents` valía
    // `subtotal + iva` y se leía como «la base gravable». Dos conceptos distintos con el mismo
    // nombre, en un fichero de dinero. Rojo en cuanto reaparezca, aunque ese día los números cuadren.
    const money = stripComments(readFileSync(join(__dirname, '..', 'src', 'common', 'money.ts'), 'utf8'));
    expect(money).not.toMatch(/\bbaseCents\b/);
    // Y los dos nombres que SÍ deben existir, cada uno con su significado.
    expect(money).toMatch(/\bgrossUpBaseCents\b/);
    expect(money).toMatch(/\btaxBaseCents\b/);
  });

  it('⭐⭐ y los TRES desgloses derivan de UN SOLO cuerpo (no tres copias de la misma línea)', () => {
    // *Tres copias de `G = S + E` son tres sitios donde reintroducir el defecto.* Se asierta que las
    // tres funciones públicas delegan en `inclusiveBreakdown`, y que ninguna calcula su propio total.
    const money = stripComments(readFileSync(join(__dirname, '..', 'src', 'common', 'money.ts'), 'utf8'));
    for (const fn of [
      'computeCartBreakdown',
      'computeShipmentBreakdown',
      'computeDirectShipBreakdown',
    ]) {
      const i = money.indexOf(`export function ${fn}(`);
      expect(i).toBeGreaterThan(-1);
      const cuerpo = money.slice(i, money.indexOf('\n}\n', i));
      expect(cuerpo).toContain('inclusiveBreakdown(');
      // ⛔ Ninguna llama al gross-up por su cuenta: si lo hiciera, podría pasarle otra base.
      expect(cuerpo).not.toContain('grossUpTotal(');
    }
    // Y el cuerpo único existe y tiene la línea, escrita una sola vez.
    expect(money.match(/const grossUpBaseCents = subtotalCents \+ shippingFeeCents;/g)).toHaveLength(1);
  });
});

/**
 * ⭐⭐ **EL CANARIO — el instrumento del assert estructural MUERDE.**
 * *La mutación realista contra una prueba que lee código no es que el código cambie: es que la
 * prueba deje de encontrar nada y pase verde por ceguera.*
 */
describe('⭐ canario de `IVA-2`: la mitad que lee CÓDIGO no es ciega', () => {
  it('m1 — `stripComments` no borra código: el fichero real trae las dos palabras buscadas', () => {
    const money = stripComments(readFileSync(join(__dirname, '..', 'src', 'common', 'money.ts'), 'utf8'));
    expect(money.length).toBeGreaterThan(5_000);
    expect(money).toContain('export function computeCartBreakdown(');
  });

  it('⭐⭐ m2 — un `baseCents` reintroducido SÍ casa con el patrón que lo prohíbe', () => {
    const mutante = stripComments('const baseCents = subtotalCents + ivaCents;\n');
    expect(mutante).toMatch(/\bbaseCents\b/);
    // …y `grossUpBaseCents` ⛔ NO cuenta como `baseCents` (el `\b` del patrón lo separa): si contara,
    // el candado sería rojo permanente y alguien lo borraría.
    expect(stripComments('const grossUpBaseCents = 1;\n')).not.toMatch(/\bbaseCents\b/);
  });

  it('m3 — un comentario que MENCIONE `baseCents` no dispara el rojo (eje fantasma)', () => {
    // `money.ts` explica en prosa el defecto que cerró; si el assert mirara el texto crudo, el
    // candado sería rojo por su propia documentación. *Un rojo por algo que no existe entrena a
    // desactivar el candado.*
    expect(stripComments('// antes esto se llamaba baseCents\nconst x = 1;\n')).not.toMatch(/\bbaseCents\b/);
  });
});
