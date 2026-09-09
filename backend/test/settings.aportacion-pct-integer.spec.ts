import { readFileSync } from 'fs';
import { join } from 'path';

import { SettingsService } from '../src/modules/settings/settings.service';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  SETTING_DEFAULTS,
  SETTING_VALIDATORS,
  SettingKey,
  validateAportacionPct,
} from '../src/modules/settings/settings.constants';
import { computeAportacionCostCents } from '../src/common/money';

/**
 * ⭐⭐ **`aportacion_pct` DECIMAL — el mismo defecto que `iva_pct`, en el dial del COSTO.**
 *
 * **Lo que estaba vivo, medido contra Postgres 16 real** (no deducido del tipo): el validador de
 * `aportacion_pct` era `isNum(v) && 0 <= v <= 100` (`typeof v === 'number'`), así que un `super_admin`
 * guardaba **`70.5`** sin un solo error. El porcentaje se congela por pieza en
 * `InventoryItem.acquisitionPct`, que es **`Int`**, y ahí
 * `prisma.inventoryItem.create({ acquisitionPct: 70.5 })` **NO revienta: escribe `70`**
 * (`70.9`→`70`, `99.999`→`99`, `0.5`→`0` — truncamiento hacia cero, silencioso).
 *
 * **Y el truncamiento es SOLO de la fila, no del cálculo**: `inventory.service.ts` valúa con
 * `computeAportacionCostCents(referenceCents, pct)` usando el **float vivo** y escribe la MISMA
 * variable en la columna `Int`. Con el dial en `70.5` y una referencia de MX$1,000.00 la pieza
 * archiva `acquisitionCostCents = 70500` **junto a** `acquisitionPct = 70`, cuyo 70 % de la misma
 * referencia son **70000**. La pieza queda **contradiciéndose a sí misma**: el porcentaje guardado
 * no reproduce el costo guardado, y falla **500 centavos por cada MX$1,000** de referencia.
 *
 * **Por qué es dinero y no cosmética.** `acquisitionCostCents` es la base del **P&L y del margen**, y
 * en aportación en especie es lo que se le acredita a quien aportó. Recalcular el costo desde el
 * porcentaje archivado da **menos costo del real** ⇒ **margen inflado**.
 *
 * **El camino del DTO ya estaba blindado** (`acquisitionPct` con `@IsInt()` en los tres DTOs de alta):
 * el dial era el ÚNICO hueco por el que entraba un decimal.
 *
 * ⛔ **La cura NO es volver decimal la columna.** `InventoryItem.acquisitionPct` vive en
 * `prisma/schema.prisma` (zona compartida, con un cambio de contrato en vuelo): su tipo es decisión
 * del arquitecto. Aquí se cierra por el lado del **validador** — un `422` explícito en vez de un
 * truncamiento mudo.
 *
 * ### Cómo se comprobó que este candado es un candado
 * Mutación sobre una **copia** del árbol: `validateAportacionPct` relajado a la versión de antes
 * (`isNum` en vez de `isInt`, mismo rango `[0, 100]`) ⇒ **5 de 14 rojos** aquí — los tres del
 * validador puro marcados «RED CON LA MUTACIÓN» más los dos de la puerta `PUT /admin/settings`. Con
 * el arreglo: **14/14 verde**. Los nueve restantes son contra-candados, tripwire y documentación:
 * pasan en los dos mundos **a propósito**, y están etiquetados como tales para que nadie los cuente
 * como cobertura del bug.
 */
describe('aportacion_pct — el dial no puede aceptar lo que `InventoryItem.acquisitionPct` (Int) no puede representar', () => {
  const gate = SETTING_VALIDATORS[SettingKey.APORTACION_PCT];

  // ---------------------------------------------------------------------------------------------
  // 1) El validador puro. Los TRES marcados son EL ROJO de la mutación; el cuarto es contra-candado.
  // ---------------------------------------------------------------------------------------------

  it('⭐ RED CON LA MUTACIÓN — rechaza 70.5 (el default 70 afinado por medio punto)', () => {
    expect(gate(70.5)).not.toBeNull();
    expect(gate(70.5)).toMatch(/integer/i);
  });

  it('⭐ RED CON LA MUTACIÓN — rechaza los decimales que truncaban a otro número', () => {
    // Cada uno con el entero al que Postgres lo truncaba: la fila habría dicho ESO.
    // (Medido con `prisma.inventoryItem.create` contra Postgres 16, no deducido del tipo.)
    for (const [entrada, loQueSeGuardaba] of [
      [70.5, 70],
      [70.9, 70],
      [99.999, 99],
      [0.5, 0],
      [100.0001, 100],
    ] as const) {
      expect(Math.trunc(entrada)).toBe(loQueSeGuardaba); // la mentira que se evita, explícita
      expect(gate(entrada)).not.toBeNull();
    }
  });

  it('⭐ RED CON LA MUTACIÓN — rechaza decimales incluso en los extremos del rango', () => {
    expect(gate(0.1)).not.toBeNull();
    expect(gate(99.9)).not.toBeNull();
  });

  // Contra-candado, NO rojo: el validador viejo ya los rechazaba (verde con y sin mutación).
  // Su trabajo es que el arreglo no haya abierto un agujero por el otro lado (p. ej. un `isInt`
  // mal escrito que dejara pasar un string numérico).
  it('CONTRA-CANDADO — NaN/Infinity/no-números siguen fuera', () => {
    for (const malo of [NaN, Infinity, -Infinity, '70', null, undefined, {}, [], true]) {
      expect(gate(malo as unknown)).not.toBeNull();
    }
  });

  // ---------------------------------------------------------------------------------------------
  // 2) Contra-candado: el arreglo NO puede haber cerrado de más.
  //    Verde antes y después — su trabajo es cazar un `isInt(v) && v === 70` de más.
  // ---------------------------------------------------------------------------------------------

  it('CONTRA-CANDADO — sigue aceptando los pct REALES del negocio: 70 (default) y 100 (alta rápida), y los bordes 0/100', () => {
    for (const bueno of [0, 70, 100]) {
      expect(gate(bueno)).toBeNull();
    }
  });

  it('CONTRA-CANDADO — sigue rechazando lo que ya rechazaba: fuera de [0, 100]', () => {
    expect(gate(-1)).not.toBeNull();
    expect(gate(101)).not.toBeNull();
  });

  it('CONTRA-CANDADO — el default de código (70) pasa su propio validador', () => {
    expect(gate(SETTING_DEFAULTS[SettingKey.APORTACION_PCT])).toBeNull();
  });

  it('CONTRA-CANDADO — la tabla apunta al validador nombrado (no a un lambda paralelo que pueda divergir)', () => {
    expect(gate).toBe(validateAportacionPct);
  });

  // ---------------------------------------------------------------------------------------------
  // 3) La puerta HTTP: `PUT /admin/settings` → 422 y CERO escritura.
  // ---------------------------------------------------------------------------------------------

  describe('PUT /admin/settings', () => {
    let prisma: any;
    let service: SettingsService;

    beforeEach(() => {
      prisma = {
        configSetting: { upsert: jest.fn().mockResolvedValue({}), findUnique: jest.fn().mockResolvedValue(null) },
        fxRate: { findFirst: jest.fn().mockResolvedValue(null) },
        $executeRaw: jest.fn().mockResolvedValue(1),
      };
      prisma.$transaction = jest.fn(async (cb: (tx: unknown) => unknown) => cb(prisma));
      service = new SettingsService(prisma as unknown as PrismaService);
    });

    it('⭐ RED CON LA MUTACIÓN — `{ aportacionPct: 70.5 }` sale 422 y NO se escribe la fila', async () => {
      await expect(service.update({ aportacionPct: 70.5 })).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
      expect(prisma.configSetting.upsert).not.toHaveBeenCalled();
    });

    it('⭐ RED CON LA MUTACIÓN — el 422 NOMBRA el dial y dice «integer», no un genérico', async () => {
      // Un 422 que no diga POR QUÉ deja al admin reintentando 70.5 hasta rendirse.
      await expect(service.update({ aportacionPct: 70.5 })).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        details: { errors: { aportacionPct: expect.stringMatching(/integer/i) } },
      });
    });

    it('CONTRA-CANDADO — `{ aportacionPct: 70 }` SÍ se guarda: el arreglo no bloquea el caso real', async () => {
      await expect(service.update({ aportacionPct: 70 })).resolves.toEqual({ aportacionPct: 70 });
      expect(prisma.configSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { key: 'aportacion_pct' } }),
      );
    });
  });

  // ---------------------------------------------------------------------------------------------
  // 4) Tripwire de acoplamiento. NO es el rojo: es el aviso para quien mueva la columna.
  //    Si `InventoryItem.acquisitionPct` deja de ser `Int`, este test cae y obliga a releer el rango
  //    de arriba (relajar el validador sin mover la columna reabre el truncamiento silencioso; moverla
  //    sin relajarlo deja un dial más estrecho que la columna: inofensivo pero mentiroso).
  // ---------------------------------------------------------------------------------------------

  it('TRIPWIRE — `InventoryItem.acquisitionPct` sigue siendo `Int?` (si cambia, revisar validateAportacionPct)', () => {
    const schema = readFileSync(join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');
    const modelo = schema.match(/model InventoryItem \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(modelo).toMatch(/^\s*acquisitionPct\s+Int\?/m);
  });

  // ---------------------------------------------------------------------------------------------
  // 5) El PORQUÉ, en aritmética de dinero: la contradicción interna que el 422 evita.
  //    Verde antes y después (mide `money.ts`, no el validador). Está aquí para que el día que
  //    alguien proponga relajar el rango vea, en centavos, lo que se reabre.
  // ---------------------------------------------------------------------------------------------

  it('DOCUMENTA EL DAÑO — la pieza archiva costo 70500 y pct 70, y el 70 % de la referencia son 70000', () => {
    const referenciaCents = 100_000; // MX$1,000.00 de referencia de mercado

    // Lo que `inventory.service.ts` calcula HOY con el float vivo del dial…
    const costoQueSeGuarda = computeAportacionCostCents(referenciaCents, 70.5);
    // …y lo que la fila truncada afirma que se aplicó.
    const pctQueArchivaLaColumna = Math.trunc(70.5);
    const costoQueReproduceLaFila = computeAportacionCostCents(referenciaCents, pctQueArchivaLaColumna);

    expect(costoQueSeGuarda).toBe(70_500);
    expect(pctQueArchivaLaColumna).toBe(70);
    expect(costoQueReproduceLaFila).toBe(70_000);
    // 500 centavos por cada MX$1,000 de referencia, y una pieza que se contradice a sí misma:
    // recalcular el costo desde su propio pct da MENOS costo ⇒ margen inflado.
    expect(costoQueSeGuarda - costoQueReproduceLaFila).toBe(500);
  });

  it('DOCUMENTA EL DAÑO — la brecha crece con el decimal: 70.9 ⇒ 900 centavos, 99.999 ⇒ 999', () => {
    const ref = 100_000;
    for (const [pct, brechaEsperada] of [
      [70.9, 900],
      [99.999, 999],
    ] as const) {
      const vivo = computeAportacionCostCents(ref, pct);
      const reproducido = computeAportacionCostCents(ref, Math.trunc(pct));
      expect(vivo - reproducido).toBe(brechaEsperada);
    }
  });
});
