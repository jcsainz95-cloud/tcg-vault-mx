import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * ⭐⭐ **M-50 — LA MIGRACIÓN, LEÍDA COMO TEXTO, Y POR QUÉ ESO NO ES PEREZA.**
 * (`ARCHITECTURE §11 · v1.64-iva-inclusive` punto 5 y `§4.44.e`; `API_CONTRACT §M10-IVA.5` `IVA-3(c)`.)
 *
 * **El hueco que este fichero tapa, MEDIDO y no supuesto.** El candado principal del «sin default»
 * vive donde debe: en `test/integration/iva-price-convention.e2e-spec.ts`, mirando el DDL real
 * (`information_schema` + `pg_attrdef`) contra Postgres. Corrí las dos mutaciones prohibidas sobre
 * una COPIA del árbol:
 *
 * | Mutación | ¿la ve el candado de DDL? |
 * |---|---|
 * | `ADD COLUMN … NOT NULL DEFAULT 'IVA_EXCLUSIVE'` | **SÍ — 4 rojos**, entre ellos el que importa: el `INSERT` que omite la convención **deja de reventar** |
 * | lo mismo **+ `DROP DEFAULT`** al final | ⚠️ **NO. 27/27 verde.** |
 *
 * **Y no es un defecto del candado: es física.** Con el `DROP DEFAULT`, el esquema final es
 * **idéntico** al correcto — no hay estado que distinga los dos caminos. Pero `IVA-3(c)` pide
 * explícitamente que esa variante sea roja *«aunque después hiciera `DROP DEFAULT`»*, y tiene toda
 * la razón para pedirlo: **basta con que el `DROP` se caiga en un rebase** para que quede un default
 * vivo en una columna de dinero, y con él un camino de escritura que archive bajo una convención lo
 * que cobró bajo la otra. Lo que hay que impedir es **la forma de la migración**, no solo su
 * resultado. ⇒ **El único instrumento que puede ver la forma es el texto.** Por eso este fichero.
 *
 * *(Las dos mitades son complementarias y ninguna sobra: el texto ve la FORMA de la migración que
 * está en el repo; el DDL ve el ESTADO de la base que de verdad se desplegó, incluido lo que alguien
 * haya hecho a mano fuera del repo.)*
 */
const DIR = join(__dirname, '..', 'prisma', 'migrations');
const M50 = '20260909120000_m50_price_convention';
const sql = readFileSync(join(DIR, M50, 'migration.sql'), 'utf8');
/** Solo las sentencias, sin los comentarios `--` (que SÍ nombran la forma prohibida, para explicarla). */
const sentencias = sql
  .split('\n')
  .filter((l) => !l.trimStart().startsWith('--'))
  .join('\n');

/** Las DOS columnas cuyo «sin default» ES la decisión de `§4.44.e`. La prohibición es de ÉSTAS. */
const SIN_DEFAULT = /"(priceConvention|ivaTransferPct)"/;

describe('M-50 — el DDL sin default, verificado sobre la FORMA de la migración (`IVA-3(c)`)', () => {
  describe('⭐⭐ ⛔ la forma prohibida no aparece, ni con `DROP DEFAULT` de coartada', () => {
    /**
     * ⚠️ **v1.64(4) — ESTE ASSERT SE ACOTA A LAS DOS COLUMNAS DE CONVENCIÓN, y el acotarlo es la
     * norma, no una concesión.** Hasta v1.64(3) M-50 no tenía ni un `NOT NULL DEFAULT`, así que la
     * prohibición global y la correcta daban lo mismo y no había que elegir. El **PASO 3-BIS**
     * (`shippingCostIvaCents INTEGER NOT NULL DEFAULT 0`) obliga a elegir, y la elección ya estaba
     * escrita cuatro asserts más abajo, en el test que barre TODAS las migraciones: **§4.44.e no
     * prohíbe los defaults, prohíbe ÉSTE**. Dejarlo global habría dado un rojo sobre una sentencia
     * correcta, y el primero que lo viera lo habría borrado entero — llevándose por delante el que
     * sí importa. *Un candado que grita ante conducta correcta se desactiva solo.*
     */
    it('⛔ ninguna sentencia da `NOT NULL DEFAULT` a `priceConvention` ni a `ivaTransferPct`', () => {
      for (const stmt of sentencias.match(/ALTER TABLE[^;]+;/gi) ?? []) {
        if (SIN_DEFAULT.test(stmt)) expect(stmt).not.toMatch(/NOT\s+NULL\s+DEFAULT/i);
      }
    });

    /**
     * ⭐ **Y el contra-candado de haber acotado el anterior: la EXCEPCIÓN está ENUMERADA.** Acotar
     * sin enumerar sería abrir la puerta: cualquier `NOT NULL DEFAULT` nuevo sobre cualquier otra
     * columna entraría mudo en una migración de dinero. Aquí hay **exactamente uno**, y añadir un
     * segundo obliga a pasar por este test y a justificarlo.
     */
    it('⭐ el ÚNICO `NOT NULL DEFAULT` de toda M-50 es el de `shippingCostIvaCents` (PASO 3-BIS)', () => {
      const conDefault = (sentencias.match(/ALTER TABLE[^;]+;/gi) ?? [])
        .filter((s) => /NOT\s+NULL\s+DEFAULT/i.test(s))
        .map((s) => s.replace(/\s+/g, ' ').trim());
      expect(conDefault).toEqual([
        'ALTER TABLE "ShipmentRequest" ADD COLUMN "shippingCostIvaCents" INTEGER NOT NULL DEFAULT 0;',
      ]);
    });

    it('⛔ ninguna sentencia usa `DROP DEFAULT` (si no se puso, no hay que quitarlo)', () => {
      // ⭐ ÉSTE es el assert que mata la mutación que el candado de DDL no puede ver. Un `DROP
      // DEFAULT` en esta migración solo puede significar una cosa: que antes hubo un `DEFAULT`.
      // Sigue siendo GLOBAL —sin acotar— y con el PASO 3-BIS es más fuerte que antes: si alguien
      // «arregla» ese default quitándolo después, se entera aquí.
      expect(sentencias).not.toMatch(/DROP\s+DEFAULT/i);
    });

    it('⛔ ni la palabra `DEFAULT` aparece en un `ALTER TABLE` de las dos columnas de convención', () => {
      const alters = (sentencias.match(/ALTER TABLE[^;]+;/gi) ?? []).filter((a) => SIN_DEFAULT.test(a));
      expect(alters.length).toBeGreaterThan(0); // control: el regex encuentra algo
      for (const a of alters) expect(a).not.toMatch(/DEFAULT/i);
    });
  });

  describe('⭐ el ORDEN obligatorio: añadir NULLABLE → backfill EXPLÍCITO → SET NOT NULL', () => {
    it.each(['Order', 'ShipmentRequest'])('%s: los tres pasos existen y van en ESE orden', (tabla) => {
      const add = sentencias.search(new RegExp(`ALTER TABLE "${tabla}" ADD COLUMN "priceConvention"`, 'i'));
      const backfill = sentencias.search(new RegExp(`UPDATE "${tabla}"[\\s\\S]*?'IVA_EXCLUSIVE'`, 'i'));
      const notNull = sentencias.search(new RegExp(`ALTER TABLE "${tabla}"\\s+ALTER COLUMN "priceConvention" SET NOT NULL`, 'i'));
      expect(add).toBeGreaterThanOrEqual(0);
      expect(backfill).toBeGreaterThan(add);
      expect(notNull).toBeGreaterThan(backfill);
    });

    it('el backfill escribe `IVA_EXCLUSIVE` — la verdad de cómo se cobraron — y nunca la otra', () => {
      expect(sentencias).toMatch(/UPDATE "Order"\s+SET "priceConvention" = 'IVA_EXCLUSIVE'/i);
      expect(sentencias).toMatch(/UPDATE "ShipmentRequest"\s+SET "priceConvention" = 'IVA_EXCLUSIVE'/i);
      expect(sentencias).not.toMatch(/SET "priceConvention" = 'IVA_INCLUSIVE'/i);
    });
  });

  describe('⭐⭐ `IVA-3(d)` — ⛔ el dial NO se backfillea: sería inventar un hecho', () => {
    it('no existe ningún `UPDATE` que escriba `ivaTransferPct`', () => {
      // «Esas órdenes se cobraron cuando el dial no existía.» `NULL` dice la verdad; `100` mentiría.
      expect(sentencias).not.toMatch(/UPDATE[\s\S]*?"ivaTransferPct"\s*=/i);
    });

    it('la columna se añade y ahí se queda (nullable, sin tocar)', () => {
      expect(sentencias).toMatch(/ALTER TABLE "Order" ADD COLUMN "ivaTransferPct"\s+INTEGER;/i);
      expect(sentencias).not.toMatch(/"ivaTransferPct"[^;]*NOT NULL/i);
    });
  });

  /**
   * ⭐⭐ **M-50.3-BIS (v1.64(4), `§4.44.f-ter`, candado `IVA-11(c)(d)`) — `shippingCostIvaCents`.**
   *
   * El IVA acreditable del costo de envío, **congelado al capturar**, para que netear sea **una
   * resta**. Existe porque `ShipmentRequest` **no tiene `ivaRatePct`**: derivar el neto con
   * `costo/(1+r)` obligaría a leer el **dial vivo** y un P&L histórico cambiaría al mover `iva_pct`
   * — incumpliendo `IVA-5`, que ya está verde.
   *
   * **Lo que este bloque defiende es el `@default(0)` HONESTO y su frontera con el prohibido.** No
   * son dos criterios: es uno solo aplicado dos veces —*un default vale cuando la ausencia de
   * verdad significa ese valor*—, y da respuestas distintas porque las dos ausencias significan
   * cosas distintas. Aquí «no se capturó el IVA de ese costo» **es** cero (`net = bruto`, la
   * dirección conservadora: subestima la ganancia). En `priceConvention`, «nadie dijo con qué regla
   * se cobró» **no es** `IVA_EXCLUSIVE`.
   */
  describe('⭐⭐ M-50.3-bis — `shippingCostIvaCents`: aditiva, con default HONESTO y ⛔ sin backfill', () => {
    it('se añade una sola vez, entera, `NOT NULL DEFAULT 0`', () => {
      const adds = sentencias.match(/ALTER TABLE "ShipmentRequest" ADD COLUMN "shippingCostIvaCents"[^;]*;/gi) ?? [];
      expect(adds).toHaveLength(1);
      expect(adds[0]).toMatch(/INTEGER\s+NOT\s+NULL\s+DEFAULT\s+0;/i);
    });

    /**
     * ⛔ **La mitad que carga el dinero.** `costo × 16/116` sobre las filas existentes inventaría un
     * **crédito fiscal** que nadie verificó, sobre facturas que nadie miró — y a diferencia de casi
     * todo lo demás, sería un invento que **infla la ganancia**. Misma doctrina que `ivaTransferPct`.
     */
    it('⛔ NO se backfillea: ninguna sentencia escribe `shippingCostIvaCents`', () => {
      expect(sentencias).not.toMatch(/UPDATE[\s\S]*?"shippingCostIvaCents"\s*=/i);
      expect(sentencias).not.toMatch(/SET\s+"shippingCostIvaCents"/i);
    });

    it('⭐ y la ÚNICA sentencia que la nombra en toda M-50 es ese `ADD COLUMN`', () => {
      // Contra-candado: cierra la puerta a que el crédito se derive en cualquier otra forma
      // (`INSERT … SELECT`, `UPDATE` disfrazado, expresión aritmética) sin que nadie lo lea.
      const nombran = (sentencias.match(/[^;]*"shippingCostIvaCents"[^;]*;/gi) ?? []).map((s) =>
        s.replace(/\s+/g, ' ').trim(),
      );
      expect(nombran).toEqual([
        'ALTER TABLE "ShipmentRequest" ADD COLUMN "shippingCostIvaCents" INTEGER NOT NULL DEFAULT 0;',
      ]);
      // ⛔ y por si alguien la derivara sin nombrarla: en M-50 no hay aritmética de tasa, ninguna.
      expect(sentencias).not.toMatch(/\b116\b|\/\s*1\.16|\*\s*16\s*\//);
    });

    it('⛔ NO es nullable — un `NULL` exigiría un backfill que INVENTA «costó cero» vs «no consta»', () => {
      const [add] = sentencias.match(/ALTER TABLE "ShipmentRequest" ADD COLUMN "shippingCostIvaCents"[^;]*;/i) ?? [];
      expect(add).toMatch(/NOT\s+NULL/i);
      // La ambigüedad se hace VISIBLE (contador `shippingCostMissingCount` del P&L, D-2), ⛔ no se
      // resuelve falsamente. `API_CONTRACT §M10-IVA.8` e `IVA-11(b)`.
    });

    it('⛔ vive SOLO en M-50: ninguna otra migración la menciona', () => {
      const otras = readdirSync(DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory() && d.name !== M50)
        .map((d) => d.name)
        .filter((n) => /shippingCostIvaCents/i.test(readFileSync(join(DIR, n, 'migration.sql'), 'utf8')));
      expect(otras).toEqual([]);
    });

    it('⛔ y NO toca la columna que ya existía: `shippingCostCents` sigue como estaba (M-16)', () => {
      // El bruto es el dato PRIMARIO (`R3`): la factura del carrier. M-50 no lo netea, no lo
      // reescribe y no lo renombra — el neteo ocurre al LEER, en el P&L del D-2.
      expect(sentencias).not.toMatch(/"shippingCostCents"/);
    });
  });

  describe('⛔ criterio 190 — NINGUNA sentencia reescribe un importe de una orden existente', () => {
    it.each(['subtotalCents', 'ivaCents', 'processingFeeCents', 'totalCents', 'shippingFeeCents', 'ivaRatePct'])(
      'no hay `UPDATE … SET "%s" =` en toda la migración',
      (col) => {
        expect(sentencias).not.toMatch(new RegExp(`UPDATE[\\s\\S]*?"${col}"\\s*=`, 'i'));
      },
    );

    it('⭐ y en general: los ÚNICOS `UPDATE` de la migración son los DOS del backfill de convención', () => {
      // Contra-candado estructural: si mañana alguien añade un tercer `UPDATE` a M-50 —del signo que
      // sea— este test lo obliga a mirarse. Una migración de dinero no gana sentencias por descuido.
      const updates = sentencias.match(/UPDATE\s+"[^"]+"/gi) ?? [];
      expect(updates).toEqual(['UPDATE "Order"', 'UPDATE "ShipmentRequest"']);
    });

    it('⛔ y no hay `DELETE`, ni `DROP TABLE`, ni `DROP COLUMN`: la migración es ADITIVA', () => {
      expect(sentencias).not.toMatch(/\bDELETE\b/i);
      expect(sentencias).not.toMatch(/DROP\s+(TABLE|COLUMN)/i);
    });
  });

  describe('la fila del dial se siembra en 100 y ⛔ nunca pisa un valor elegido', () => {
    it('`INSERT … ON CONFLICT DO NOTHING` con `100`', () => {
      expect(sentencias).toMatch(/INSERT INTO "ConfigSetting"[\s\S]*?'iva_transfer_pct'[\s\S]*?100/i);
      // Misma semántica que el `update: {}` del seed (§11.0): si el dueño ya movió el dial, no se toca.
      expect(sentencias).toMatch(/ON CONFLICT\s*\("key"\)\s*DO NOTHING/i);
    });
  });

  describe('⛔ M-50 es la ÚNICA migración que toca esto (nadie la "completó" en otra)', () => {
    it('ninguna otra migración menciona `priceConvention`, `ivaTransferPct` ni `PriceConvention`', () => {
      const otras = readdirSync(DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory() && d.name !== M50)
        .map((d) => d.name);
      const culpables = otras.filter((n) => {
        const s = readFileSync(join(DIR, n, 'migration.sql'), 'utf8');
        return /priceConvention|ivaTransferPct|PriceConvention/i.test(s);
      });
      expect(culpables).toEqual([]);
    });

    /**
     * ⚠️ **Acotado A PROPÓSITO a las DOS columnas de M-50, y la primera versión de este test estaba
     * MAL por no acotarlo.** Lo escribí como *«ninguna migración usa `NOT NULL DEFAULT` sobre `Order`
     * o `ShipmentRequest`»* y salió rojo con **cuatro** sentencias **legítimas y correctas**
     * (`chargebackNeedsManual false`, `shippingCostCents 0`, `fulfillmentMode 'vault'`,
     * `shippingFeeCents 0`). **⭐ v1.64(4): ya son CINCO** — se les suma
     * **`shippingCostIvaCents 0`** (M-50 PASO 3-BIS), y es la primera que cae **dentro de la propia
     * M-50**: por eso el primer assert de este fichero pasó de global a acotado. *Que la excepción
     * honesta aterrizara en el mismo fichero que la prohibición es lo que obligó a escribir la
     * frontera en código y no solo en un comentario.* **§4.44.e no prohíbe los defaults: prohíbe
     * ÉSTE.** La diferencia es de
     * significado, no de sintaxis: en `shippingCostCents` la ausencia **de verdad significa cero**,
     * así que el default dice la verdad; en `priceConvention` la ausencia significa *«nadie dijo con
     * qué regla se cobró»*, y **ahí un default convierte un hueco en una afirmación falsa**. Un test
     * que prohibiera los dos por igual no defendería la norma: la caricaturizaría, y el primero que
     * necesitara un default honesto lo borraría — y se llevaría por delante el que sí importa.
     */
    it('⛔ NINGUNA migración del repo da un DEFAULT a `priceConvention` ni a `ivaTransferPct`', () => {
      const dirs = readdirSync(DIR, { withFileTypes: true }).filter((d) => d.isDirectory());
      const culpables: string[] = [];
      for (const d of dirs) {
        const cuerpo = readFileSync(join(DIR, d.name, 'migration.sql'), 'utf8')
          .split('\n')
          .filter((l) => !l.trimStart().startsWith('--'))
          .join('\n');
        for (const stmt of cuerpo.match(/ALTER TABLE[^;]+;/gi) ?? []) {
          if (/"(priceConvention|ivaTransferPct)"/.test(stmt) && /DEFAULT/i.test(stmt)) {
            culpables.push(`${d.name}: ${stmt.trim()}`);
          }
        }
      }
      expect(culpables).toEqual([]);
    });
  });
});
