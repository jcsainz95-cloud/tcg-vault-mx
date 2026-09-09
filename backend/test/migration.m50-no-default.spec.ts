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

describe('M-50 — el DDL sin default, verificado sobre la FORMA de la migración (`IVA-3(c)`)', () => {
  describe('⭐⭐ ⛔ la forma prohibida no aparece, ni con `DROP DEFAULT` de coartada', () => {
    it('⛔ ninguna sentencia usa `NOT NULL DEFAULT`', () => {
      expect(sentencias).not.toMatch(/NOT\s+NULL\s+DEFAULT/i);
    });

    it('⛔ ninguna sentencia usa `DROP DEFAULT` (si no se puso, no hay que quitarlo)', () => {
      // ⭐ ÉSTE es el assert que mata la mutación que el candado de DDL no puede ver. Un `DROP
      // DEFAULT` en esta migración solo puede significar una cosa: que antes hubo un `DEFAULT`.
      expect(sentencias).not.toMatch(/DROP\s+DEFAULT/i);
    });

    it('⛔ ni siquiera aparece la palabra `DEFAULT` en un `ALTER TABLE` de estas dos tablas', () => {
      const alters = sentencias.match(/ALTER TABLE[^;]+;/gi) ?? [];
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
     * `shippingFeeCents 0`). **§4.44.e no prohíbe los defaults: prohíbe ÉSTE.** La diferencia es de
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
