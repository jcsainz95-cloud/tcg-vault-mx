import { ivaIsIncluded, netRevenueCents } from '../src/common/money';

/**
 * ⭐⭐ `netRevenueCents` — EL HELPER ÚNICO DEL INGRESO PROPIO (v1.64-iva-inclusive / **D56**).
 * `ARCHITECTURE §4.44.j` · `API_CONTRACT §M10-IVA.5` candados `IVA-3` / `IVA-5`.
 *
 * Este fichero mide TRES cosas y ninguna es la forma de un campo:
 *
 *  1. **Que sobre una fila `IVA_EXCLUSIVE` el helper sigue siendo la IDENTIDAD.** Toda fila cobrada
 *     **antes** del corte lo es ⇒ `netRevenueCents(row) === row.subtotalCents`, bit a bit, para
 *     cualquier valor. *Una orden ya cobrada no se reinterpreta sola* (`IVA-3`).
 *  2. ⭐⭐ **Que la rama `IVA_INCLUSIVE` es `round(S/(1+r))`, ⛔ NO `S − ivaCents`** — la corrección
 *     de `D-IVA-10`: `ivaCents` es el residual del AGREGADO `G = S + E`, así que restarlo entero le
 *     quita a la mercancía **el IVA del envío** (`7200` donde son `10000`).
 *  3. ⭐⭐ **Que una fila SIN convención NO se adivina: LANZA.** Es el candado que la sesión pidió
 *     por nombre —*«que un camino de escritura que OLVIDE la convención falle»*— visto desde el
 *     lado del LECTOR. La columna es `NOT NULL` y **sin default de BD** para que ese estado no
 *     exista; si aun así llega (mock incompleto, `select` que olvidó la columna, fila sembrada a
 *     mano), tiene que sonar. Un `?? subtotalCents` de cortesía es exactamente la mutación que
 *     `IVA-3` mata: interpretaría la fila huérfana bajo la convención que hoy es mayoría, y el día
 *     del deploy 2 esa mayoría cambia de bando.
 */
describe('netRevenueCents — el ingreso propio de una fila de dinero (§4.44.j)', () => {
  describe('IVA_EXCLUSIVE — la convención de TODA fila del deploy 1', () => {
    // Vectores: el del criterio 185 (10000), los importes reales de la base de desarrollo
    // (115000/21200), el cero, el uno, y el techo Int32 de una columna `*Cents`.
    const vectores: { subtotalCents: number }[] = [
      { subtotalCents: 10000 },
      { subtotalCents: 115000 },
      { subtotalCents: 0 },
      { subtotalCents: 1 },
      { subtotalCents: 17500 },
      { subtotalCents: 2147483647 },
    ];

    it.each(vectores)(
      'devuelve el subtotal INTACTO (subtotal=$subtotalCents)',
      ({ subtotalCents }) => {
        expect(netRevenueCents({ subtotalCents, ivaRatePct: 16, priceConvention: 'IVA_EXCLUSIVE' })).toBe(
          subtotalCents,
        );
      },
    );

    it('⭐ la TASA de la fila NO participa: cambiarla no mueve el ingreso ni un centavo', () => {
      // Si alguien "mejorara" el helper neteando siempre, esto se pone rojo: es la mutación que
      // convertiría el P&L histórico en otro número (rojo 26242 del candado IVA-5).
      const base = netRevenueCents({ subtotalCents: 10000, ivaRatePct: 16, priceConvention: 'IVA_EXCLUSIVE' });
      for (const r of [0, 8, 16, 100]) {
        expect(netRevenueCents({ subtotalCents: 10000, ivaRatePct: r, priceConvention: 'IVA_EXCLUSIVE' })).toBe(base);
      }
      expect(base).toBe(10000);
    });
  });

  describe('IVA_INCLUSIVE — la convención con la que se cobra desde D56', () => {
    it('es la BASE GRAVABLE de la mercancía: el impuesto trasladado NO es ingreso propio (crit. 191)', () => {
      // Las tres posiciones del dial que publica `PROJECT §Q.4` / `API_CONTRACT §M10-IVA.2`.
      expect(netRevenueCents({ subtotalCents: 11600, ivaRatePct: 16, priceConvention: 'IVA_INCLUSIVE' })).toBe(10000);
      expect(netRevenueCents({ subtotalCents: 10800, ivaRatePct: 16, priceConvention: 'IVA_INCLUSIVE' })).toBe(9310);
      expect(netRevenueCents({ subtotalCents: 10000, ivaRatePct: 16, priceConvention: 'IVA_INCLUSIVE' })).toBe(8621);
    });

    it('⛔ NUNCA devuelve el subtotal a secas (sería contar el IVA como ingreso)', () => {
      expect(netRevenueCents({ subtotalCents: 11600, ivaRatePct: 16, priceConvention: 'IVA_INCLUSIVE' })).not.toBe(11600);
    });

    it('⛔⛔ `D-IVA-10`: NO usa `ivaCents` — la fórmula `S − ivaCents` da 7200 donde son 10000', () => {
      // Este es el defecto que el arquitecto corrigió y que `IVA-9(b)` pone en rojo: con un pedido
      // `direct_ship` (`S = 11600`, `E = 20300`) el residual AGREGADO es `4400`, que incluye el IVA
      // del ENVÍO. Restarlo del subtotal le quita a la mercancía un IVA que no es suyo.
      const neto = netRevenueCents({ subtotalCents: 11600, ivaRatePct: 16, priceConvention: 'IVA_INCLUSIVE' });
      expect(neto).toBe(10000);
      expect(neto).not.toBe(11600 - 4400); // 7200 — la fórmula falsa de v1.64
    });
  });

  describe('⭐⭐ una fila SIN convención NO se interpreta: LANZA (candado IVA-3, lado lector)', () => {
    // `as any`: el compilador ya impide construir esto en código de producción — que es la PRIMERA
    // línea de defensa y está probada por el hecho de que el árbol compila. Aquí se prueba la
    // SEGUNDA: el runtime, para las filas que no pasan por el compilador (SQL a mano, mocks, JSON).
    const huerfanas: unknown[] = [undefined, null, '', 'iva_exclusive', 'IVA_EXCLUSIVO', 'EXCLUSIVE', 0, 100, true, {}];

    it.each(huerfanas.map((v) => [JSON.stringify(v) ?? String(v), v] as const))(
      'priceConvention = %s ⇒ throw',
      (_label, valor) => {
        expect(() =>
          netRevenueCents({ subtotalCents: 10000, ivaRatePct: 16, priceConvention: valor as never }),
        ).toThrow(/unknown priceConvention/);
      },
    );

    it('el mensaje dice POR QUÉ no se adivina (para quien lo vea en un log de producción)', () => {
      let msg = '';
      try {
        netRevenueCents({ subtotalCents: 1, ivaRatePct: 16, priceConvention: undefined as never });
      } catch (e) {
        msg = (e as Error).message;
      }
      expect(msg).toContain('MUST NOT be guessed');
      expect(msg).toContain('IVA-3');
    });

    it('⛔ CONTRA-CANDADO: no cae a `subtotalCents` ni a `subtotal − iva` en la rama huérfana', () => {
      // Este test existe para matar las DOS mutaciones "amables" a la vez. Si alguien sustituye el
      // `throw` por cualquiera de los dos valores plausibles, esto se pone rojo.
      let devuelto: unknown = 'no-devolvio';
      try {
        devuelto = netRevenueCents({ subtotalCents: 10000, ivaRatePct: 16, priceConvention: undefined as never });
      } catch {
        devuelto = 'lanzo';
      }
      expect(devuelto).toBe('lanzo');
      expect(devuelto).not.toBe(10000);
      expect(devuelto).not.toBe(8400);
    });
  });

  describe('⛔ solo columnas persistidas: el helper no puede leer un dial aunque quiera', () => {
    it('el LECTOR de la convención es UNO solo, y es `ivaIsIncluded` (`IVA-12(b)`)', () => {
      // `netRevenueCents` ⛔ no tiene su propio `switch`: delega. Un segundo switch sería un segundo
      // sitio donde la misma fila puede interpretarse distinto.
      expect(ivaIsIncluded('IVA_EXCLUSIVE')).toBe(false);
      expect(ivaIsIncluded('IVA_INCLUSIVE')).toBe(true);
      expect(() => ivaIsIncluded(undefined as never)).toThrow(/unknown priceConvention/);
    });

    it('es una función PURA de un argumento (§4.44.j: nunca el dial vivo)', () => {
      // Estructural y barato, pero mata una familia entera: en cuanto alguien le pase un segundo
      // argumento (el dial, los settings, el `PrismaService`), esta aserción cae.
      expect(netRevenueCents.length).toBe(1);
    });

    it('mismo input ⇒ mismo output, siempre (no hay estado ni reloj ni I/O)', () => {
      const row = { subtotalCents: 115000, ivaRatePct: 16, priceConvention: 'IVA_EXCLUSIVE' as const };
      const salidas = new Set(Array.from({ length: 50 }, () => netRevenueCents(row)));
      expect([...salidas]).toEqual([115000]);
    });
  });
});
