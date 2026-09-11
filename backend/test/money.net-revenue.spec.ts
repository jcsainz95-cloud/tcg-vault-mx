import { netRevenueCents } from '../src/common/money';

/**
 * ⭐⭐ `netRevenueCents` — EL HELPER ÚNICO DEL INGRESO PROPIO (v1.64-iva-inclusive, DEPLOY 1).
 * `ARCHITECTURE §4.44.j` · `API_CONTRACT §M10-IVA.5` candados `IVA-3` / `IVA-5`.
 *
 * Este fichero mide TRES cosas y ninguna es la forma de un campo:
 *
 *  1. **Que en el DEPLOY 1 el helper es la IDENTIDAD.** Toda fila del sistema es `IVA_EXCLUSIVE`
 *     ⇒ `netRevenueCents(row) === row.subtotalCents`, bit a bit, para cualquier valor. **Ése es el
 *     punto entero del deploy 1**: dejar el P&L probado NEUTRO antes de que exista la otra rama.
 *  2. **Que la otra rama ya está escrita y hace lo correcto**, para que el deploy 2 no tenga que
 *     tocar esta decisión (`IVA_INCLUSIVE` ⇒ el IVA no es ingreso propio).
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
    const vectores: { subtotalCents: number; ivaCents: number }[] = [
      { subtotalCents: 10000, ivaCents: 1600 },
      { subtotalCents: 115000, ivaCents: 21200 },
      { subtotalCents: 0, ivaCents: 0 },
      { subtotalCents: 1, ivaCents: 0 },
      { subtotalCents: 17500, ivaCents: 2800 },
      { subtotalCents: 2147483647, ivaCents: 296204640 },
    ];

    it.each(vectores)(
      'devuelve el subtotal INTACTO (subtotal=$subtotalCents, iva=$ivaCents)',
      ({ subtotalCents, ivaCents }) => {
        expect(netRevenueCents({ subtotalCents, ivaCents, priceConvention: 'IVA_EXCLUSIVE' })).toBe(
          subtotalCents,
        );
      },
    );

    it('⭐ el `ivaCents` de la fila NO participa: cambiarlo no mueve el ingreso ni un centavo', () => {
      // Si alguien "mejorara" el helper neteando siempre, esto se pone rojo: es la mutación que
      // convertiría el P&L histórico en otro número (rojo 26242 del candado IVA-5).
      const base = netRevenueCents({ subtotalCents: 10000, ivaCents: 1600, priceConvention: 'IVA_EXCLUSIVE' });
      for (const iva of [0, 1, 999, 1600, 9999, 10000]) {
        expect(netRevenueCents({ subtotalCents: 10000, ivaCents: iva, priceConvention: 'IVA_EXCLUSIVE' })).toBe(base);
      }
      expect(base).toBe(10000);
    });
  });

  describe('IVA_INCLUSIVE — la rama que el deploy 2 encenderá (aquí sin fila que la alcance)', () => {
    it('resta el IVA: el impuesto trasladado NO es ingreso propio (criterio 191)', () => {
      // Las tres posiciones del dial que publica `PROJECT §Q.4` / `API_CONTRACT §M10-IVA.2`.
      expect(netRevenueCents({ subtotalCents: 11600, ivaCents: 1600, priceConvention: 'IVA_INCLUSIVE' })).toBe(10000);
      expect(netRevenueCents({ subtotalCents: 10800, ivaCents: 1490, priceConvention: 'IVA_INCLUSIVE' })).toBe(9310);
      expect(netRevenueCents({ subtotalCents: 10000, ivaCents: 1379, priceConvention: 'IVA_INCLUSIVE' })).toBe(8621);
    });

    it('⛔ NUNCA devuelve el subtotal a secas (sería contar el IVA como ingreso)', () => {
      expect(netRevenueCents({ subtotalCents: 11600, ivaCents: 1600, priceConvention: 'IVA_INCLUSIVE' })).not.toBe(11600);
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
          netRevenueCents({ subtotalCents: 10000, ivaCents: 1600, priceConvention: valor as never }),
        ).toThrow(/unknown priceConvention/);
      },
    );

    it('el mensaje dice POR QUÉ no se adivina (para quien lo vea en un log de producción)', () => {
      let msg = '';
      try {
        netRevenueCents({ subtotalCents: 1, ivaCents: 0, priceConvention: undefined as never });
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
        devuelto = netRevenueCents({ subtotalCents: 10000, ivaCents: 1600, priceConvention: undefined as never });
      } catch {
        devuelto = 'lanzo';
      }
      expect(devuelto).toBe('lanzo');
      expect(devuelto).not.toBe(10000);
      expect(devuelto).not.toBe(8400);
    });
  });

  describe('⛔ solo columnas persistidas: el helper no puede leer un dial aunque quiera', () => {
    it('es una función PURA de un argumento (§4.44.j: nunca el dial vivo)', () => {
      // Estructural y barato, pero mata una familia entera: en cuanto alguien le pase un segundo
      // argumento (el dial, los settings, el `PrismaService`), esta aserción cae.
      expect(netRevenueCents.length).toBe(1);
    });

    it('mismo input ⇒ mismo output, siempre (no hay estado ni reloj ni I/O)', () => {
      const row = { subtotalCents: 115000, ivaCents: 21200, priceConvention: 'IVA_EXCLUSIVE' as const };
      const salidas = new Set(Array.from({ length: 50 }, () => netRevenueCents(row)));
      expect([...salidas]).toEqual([115000]);
    });
  });
});
