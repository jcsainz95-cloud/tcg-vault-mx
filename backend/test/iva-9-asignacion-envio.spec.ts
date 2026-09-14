import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  netRevenueCents,
  netShippingRevenueCents,
  shipmentNetRevenueCents,
  taxBaseCentsOf,
} from '../src/common/money';
import { stripComments } from './helpers/strip-comments';

/**
 * ⭐⭐ **`IVA-9` — LA ASIGNACIÓN DEL IVA DEL ENVÍO: son una IDENTIDAD y una FLECHA.**
 * (`API_CONTRACT §M10-IVA.5`; `ARCHITECTURE §4.44.j.1`, que resuelve la marca interna `IVA-R1`.)
 *
 * **El problema, en una línea:** bajo `IVA_INCLUSIVE`, `Order.ivaCents` es el **residual del
 * AGREGADO** `G = S + E`. El IVA que corresponde a la línea de **envío** ⛔ **no está persistido por
 * separado**, así que repartirlo entre mercancía y envío es una **decisión de asignación**.
 *
 * **La decisión del arquitecto:** *«el IVA del envío es el RESIDUAL DEL RESIDUAL»* — el envío
 * **absorbe el residuo**:
 * ```
 * ivaMercanciaCents = S − round(S / (1+r))
 * ivaEnvioCents     = ivaCents − ivaMercanciaCents
 * netShipping       = E − ivaEnvioCents
 * ```
 *
 * **Por qué el ENVÍO y no la mercancía:** (1) la mercancía ya tiene fórmula canónica y publicada
 * (criterio 191) y es la cifra grande y auditada; (2) el envío es, **por decisión del dueño**,
 * *«costo operativo trasladado, no una venta»* ⇒ es el sitio correcto para aparcar un centavo de
 * asignación; (3) es **R3** un nivel más abajo: *el residual absorbe el redondeo, jamás la cifra
 * autoritativa*.
 *
 * ### ⛔⛔ Y LA FLECHA, que es la mitad que no es aritmética
 * `ivaCents → partes`, **NUNCA** `partes → ivaCents`. `Order.ivaCents` es un número **FISCAL** y es
 * la **única fuente** del desglose de la factura del cliente (criterio 192). Hacerlo depender de una
 * asignación de reporte sería convertir un número fiscal en un derivado de un informe de gestión.
 */

const R = 16;
/** El fixture del contrato: pedido `direct_ship` `IVA_INCLUSIVE`. */
const PEDIDO = {
  subtotalCents: 11_600,
  shippingFeeCents: 20_300,
  ivaCents: 4_400,
  ivaRatePct: R,
  priceConvention: 'IVA_INCLUSIVE' as const,
};

describe('⭐⭐ `IVA-9` — el envío absorbe el residuo, y la suma es EXACTA', () => {
  it('⭐⭐ (a) LA IDENTIDAD, con CERO centavos de deriva', () => {
    const neto = netRevenueCents(PEDIDO);
    const netoEnvio = netShippingRevenueCents(PEDIDO);
    expect(neto + netoEnvio + PEDIDO.ivaCents).toBe(
      PEDIDO.subtotalCents + PEDIDO.shippingFeeCents,
    );
    expect(neto + netoEnvio + PEDIDO.ivaCents).toBe(31_900);
    // ⛔ Rojo con ±1 centavo — *es lo que separa «resuelto» de «declarado»*.
    expect(neto + netoEnvio + PEDIDO.ivaCents).not.toBe(31_899);
    expect(neto + netoEnvio + PEDIDO.ivaCents).not.toBe(31_901);
  });

  it('⭐⭐ (b) la MERCANCÍA contra el criterio 191: `10000`, ⛔ NUNCA `7200`', () => {
    expect(netRevenueCents(PEDIDO)).toBe(10_000);
    // `7200` es lo que da `subtotalCents − ivaCents`: **la fórmula que v1.64 publicó y era FALSA**
    // (`§9 · D-IVA-10`). Le resta a la mercancía el IVA del ENVÍO — 2 800 por pedido, en silencio.
    expect(PEDIDO.subtotalCents - PEDIDO.ivaCents).toBe(7_200);
    expect(netRevenueCents(PEDIDO)).not.toBe(7_200);
  });

  it('⭐ (c) el ENVÍO absorbe el residuo: `20300 − (4400 − 1600) == 17500`', () => {
    const ivaMercancia = PEDIDO.subtotalCents - taxBaseCentsOf(PEDIDO.subtotalCents, R);
    expect(ivaMercancia).toBe(1_600);
    expect(PEDIDO.ivaCents - ivaMercancia).toBe(2_800); // el IVA del envío
    expect(netShippingRevenueCents(PEDIDO)).toBe(17_500);
  });

  it('⭐⭐ (d) LA FLECHA, por lo negativo: alterar `ivaCents` mueve las PARTES, ⛔ no al revés', () => {
    // Se altera `ivaCents` «a pelo», como lo haría un `UPDATE` en la BD.
    const alterado = { ...PEDIDO, ivaCents: 4_401 };
    expect(netShippingRevenueCents(alterado)).toBe(17_499);
    expect(netShippingRevenueCents(alterado)).not.toBe(netShippingRevenueCents(PEDIDO));
    // ⛔ Y la mercancía NO se mueve: su base es la suya, no el residual agregado.
    expect(netRevenueCents(alterado)).toBe(10_000);
    // ⭐ La identidad sigue siendo exacta **con el valor alterado**: es el envío quien absorbe.
    expect(netRevenueCents(alterado) + netShippingRevenueCents(alterado) + alterado.ivaCents).toBe(
      alterado.subtotalCents + alterado.shippingFeeCents,
    );
  });

  it('⭐⭐ (e) CASO BÓVEDA (`E = 0`) — el que ESCONDÍA el defecto', () => {
    // *Ahí las dos fórmulas coinciden*, y por eso los dos ejemplos del criterio 191 (`11600→10000` y
    // `10000→8621`) no lo veían fallar: eran de bóveda. Se prueba explícitamente.
    const boveda = {
      subtotalCents: 11_600,
      shippingFeeCents: 0,
      ivaCents: 1_600,
      ivaRatePct: R,
      priceConvention: 'IVA_INCLUSIVE' as const,
    };
    expect(netShippingRevenueCents(boveda)).toBe(0);
    expect(netRevenueCents(boveda)).toBe(taxBaseCentsOf(11_600, R));
    expect(netRevenueCents(boveda)).toBe(10_000);
    // …y aquí, y SOLO aquí, `S − ivaCents` coincide. Por eso el candado (b) usa el caso CON envío.
    expect(boveda.subtotalCents - boveda.ivaCents).toBe(netRevenueCents(boveda));
  });

  it('⛔ bajo `IVA_EXCLUSIVE` la tarifa persistida YA es neta: el helper es la identidad', () => {
    const historica = { ...PEDIDO, priceConvention: 'IVA_EXCLUSIVE' as const };
    expect(netShippingRevenueCents(historica)).toBe(20_300);
    expect(netRevenueCents(historica)).toBe(11_600);
  });

  it('⭐ la identidad se sostiene sobre 500 pedidos generados (no solo sobre el fixture)', () => {
    let semilla = 909;
    const rnd = (max: number) => {
      semilla = (semilla * 1103515245 + 12345) % 2147483648;
      return semilla % max;
    };
    for (let caso = 0; caso < 500; caso += 1) {
      const S = 1 + rnd(2_000_000);
      const E = rnd(3) === 0 ? 0 : rnd(200_000);
      // `ivaCents` como lo persiste el checkout: residual del AGREGADO.
      const ivaCents = S + E - taxBaseCentsOf(S + E, R);
      const fila = { subtotalCents: S, shippingFeeCents: E, ivaCents, ivaRatePct: R, priceConvention: 'IVA_INCLUSIVE' as const };
      expect(netRevenueCents(fila) + netShippingRevenueCents(fila) + ivaCents).toBe(S + E);
      // ⭐ Y la mercancía es SIEMPRE su propia base gravable, con envío o sin él.
      expect(netRevenueCents(fila)).toBe(taxBaseCentsOf(S, R));
    }
  });

  it('⛔ POR LO NEGATIVO, sobre el CÓDIGO: nadie reparte con `round(E/(1+r))`', () => {
    // Ésa es **literalmente** la mutación que `IVA-9` declara roja, y es el cuerpo que `admin.service`
    // tenía antes del corte (`ARCHITECTURE §9 · D-IVA-11`). Rojo en cuanto reaparezca.
    const admin = stripComments(
      readFileSync(join(__dirname, '..', 'src', 'modules', 'admin', 'admin.service.ts'), 'utf8'),
    );
    expect(admin).not.toMatch(/shippingFeeCents\s*\/\s*\(?\s*1\s*\+/);
    // Y el helper del envío vive en `money.ts`, en UN solo sitio.
    const money = stripComments(readFileSync(join(__dirname, '..', 'src', 'common', 'money.ts'), 'utf8'));
    expect(money.match(/export function netShippingRevenueCents\(/g)).toHaveLength(1);
  });

  it('⛔⛔ y NINGÚN camino RECALCULA `Order.ivaCents` desde las partes', () => {
    // La flecha, medida sobre el código: el P&L y el tablero leen `o.ivaCents`, ⛔ no lo escriben.
    const admin = stripComments(
      readFileSync(join(__dirname, '..', 'src', 'modules', 'admin', 'admin.service.ts'), 'utf8'),
    );
    expect(admin).not.toMatch(/ivaCents\s*=\s*[^=]/);
  });
});

/** ⭐ **EL CANARIO** — cada fórmula descartada, reintroducida, produce una cifra distinta. */
describe('⭐ canario de `IVA-9`: las dos fórmulas falsas y lo que cuestan', () => {
  it('⭐⭐ m1 — `netRevenue = S − ivaCents` (la fórmula de v1.64) pierde 2800 por pedido', () => {
    const falso = PEDIDO.subtotalCents - PEDIDO.ivaCents;
    expect(netRevenueCents(PEDIDO) - falso).toBe(2_800);
    expect(falso).toBe(7_200);
  });

  it('⭐⭐ m2 — repartir con `round(E/(1+r))` rompe la identidad en el caso que la delata', () => {
    // Se busca un caso donde el reparto por cuenta propia difiera del residual del residual, en vez
    // de afirmar que existe. *Un canario que no encuentra su mutación no es un canario.*
    let encontrado: { S: number; E: number } | null = null;
    for (let S = 1; S <= 4_000 && !encontrado; S += 1) {
      for (let E = 1; E <= 400; E += 1) {
        const ivaCents = S + E - taxBaseCentsOf(S + E, R);
        const fila = { subtotalCents: S, shippingFeeCents: E, ivaCents, ivaRatePct: R, priceConvention: 'IVA_INCLUSIVE' as const };
        const porSuCuenta = E - (E - taxBaseCentsOf(E, R)); // = round(E/(1+r))
        if (porSuCuenta !== netShippingRevenueCents(fila)) {
          encontrado = { S, E };
          break;
        }
      }
    }
    expect(encontrado).not.toBeNull();
    const { S, E } = encontrado!;
    const ivaCents = S + E - taxBaseCentsOf(S + E, R);
    const fila = { subtotalCents: S, shippingFeeCents: E, ivaCents, ivaRatePct: R, priceConvention: 'IVA_INCLUSIVE' as const };
    const porSuCuenta = taxBaseCentsOf(E, R);
    // La mutación rompe la identidad exacta: la suma de las partes ya no da `G`.
    expect(netRevenueCents(fila) + porSuCuenta + ivaCents).not.toBe(S + E);
    // …mientras que la fórmula buena la cumple.
    expect(netRevenueCents(fila) + netShippingRevenueCents(fila) + ivaCents).toBe(S + E);
  });

  it('m3 — la `ShipmentRequest` usa SU helper: con `ivaRatePct` no existiría la columna', () => {
    // `shipmentNetRevenueCents` netea por RESTA porque esa tabla **no tiene `ivaRatePct`** (medido en
    // `schema.prisma`). Usar `netRevenueCents` ahí obligaría a inventar una tasa ⇒ dial vivo ⇒
    // `IVA-5` roto. Aquí se afirma que las dos funciones NO son intercambiables.
    const fila = { shippingFeeCents: 20_300, ivaCents: 2_800, priceConvention: 'IVA_INCLUSIVE' as const };
    expect(shipmentNetRevenueCents(fila)).toBe(17_500);
    // Con un `ivaCents` corrupto, la resta lo refleja — y eso es correcto: el dato primario manda.
    expect(shipmentNetRevenueCents({ ...fila, ivaCents: 2_801 })).toBe(17_499);
  });
});
