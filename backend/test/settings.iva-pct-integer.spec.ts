import { readFileSync } from 'fs';
import { join } from 'path';

import { SettingsService } from '../src/modules/settings/settings.service';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  SETTING_DEFAULTS,
  SETTING_VALIDATORS,
  SettingKey,
  validateIvaPct,
} from '../src/modules/settings/settings.constants';
import { computeCartBreakdown } from '../src/common/money';

/**
 * ⭐⭐ **`iva_pct` DECIMAL — el dial aceptaba lo que la columna no sabe guardar.**
 *
 * **Lo que estaba vivo, medido contra Postgres 16 real** (no deducido del tipo): el validador de
 * `iva_pct` era `isNum(v) && 0 <= v <= 100` (`typeof v === 'number'`), así que un `super_admin`
 * guardaba **`8.5`** sin un solo error. La tasa se congela por orden en `Order.ivaRatePct`, que es
 * **`Int`**, y ahí `prisma.order.create({ ivaRatePct: 8.5 })` **NO revienta: escribe `8`**
 * (`8.9`→`8`, `15.999`→`15`, `0.5`→`0` — truncamiento hacia cero, silencioso).
 *
 * **Y el truncamiento es SOLO de la fila, no del cobro**: `computeCartBreakdown` usa el float vivo.
 * Con el dial en `8.5` y subtotal MX$100.00 se cobran **850** centavos de IVA y se archiva
 * `ivaRatePct = 8`, cuyo 8 % del mismo subtotal son **800**. La orden queda diciendo una tasa que
 * **no es** la que se cobró, y por 50 centavos hacia abajo en cada MX$100.
 *
 * **No es un valor de laboratorio**: el **8 %** es la tasa de IVA de la **zona fronteriza norte** de
 * México. `8.5` es el error de medio punto de alguien que está justo en ese cambio.
 *
 * ⛔ **La cura NO es volver decimal la columna.** `Order.ivaRatePct` es zona compartida y su tipo es
 * decisión del arquitecto. ✅ **v1.64 (`D-IVA-4`): esa decisión ya está tomada y este comentario decía
 * lo contrario.** D54 fue **APROBADA el 2026-09-09** y `PROJECT §Q` es **alcance vigente**;
 * `ARCHITECTURE §4.44.g` ratifica el criterio: **la columna sigue siendo `Int` y el rango sigue siendo
 * entero**, también para el dial nuevo `iva_transfer_pct` (ver `settings.iva-transfer-pct.spec.ts`).
 * El candado de abajo **no cambia**: se cierra por el lado del **validador** — un `422` explícito en
 * vez de un truncamiento mudo.
 *
 * ### Cómo se comprobó que este candado es un candado
 * Mutación sobre una **copia** del árbol: `validateIvaPct` relajado a la versión de hoy (`isNum` en
 * vez de `isInt`, mismo rango `[0, 100]`) ⇒ **5 de 13 rojos** aquí — los tres del validador puro
 * marcados «RED CON LA MUTACIÓN» más los dos de la puerta `PUT /admin/settings`. Con el arreglo:
 * **13/13 verde**. Los ocho restantes son contra-candados y documentación: pasan en los dos mundos
 * **a propósito**, y están etiquetados como tales para que nadie los cuente como cobertura del bug.
 */
describe('iva_pct — el dial no puede aceptar lo que `Order.ivaRatePct` (Int) no puede representar', () => {
  const gate = SETTING_VALIDATORS[SettingKey.IVA_PCT];

  // ---------------------------------------------------------------------------------------------
  // 1) El validador puro. Los TRES marcados son EL ROJO de la mutación; el cuarto es contra-candado.
  // ---------------------------------------------------------------------------------------------

  it('⭐ RED CON LA MUTACIÓN — rechaza 8.5 (la tasa fronteriza mal tecleada por medio punto)', () => {
    expect(gate(8.5)).not.toBeNull();
    expect(gate(8.5)).toMatch(/integer/i);
  });

  it('⭐ RED CON LA MUTACIÓN — rechaza los decimales que truncaban a otro número', () => {
    // Cada uno con el entero al que Postgres lo truncaba: la fila habría dicho ESO.
    for (const [entrada, loQueSeGuardaba] of [
      [8.5, 8],
      [8.9, 8],
      [15.999, 15],
      [0.5, 0],
      [16.0001, 16],
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
    for (const malo of [NaN, Infinity, -Infinity, '16', null, undefined, {}, [], true]) {
      expect(gate(malo as unknown)).not.toBeNull();
    }
  });

  // ---------------------------------------------------------------------------------------------
  // 2) Contra-candado: el arreglo NO puede haber cerrado de más.
  //    Verde antes y después — su trabajo es cazar un `isInt(v) && v === 16` de más.
  // ---------------------------------------------------------------------------------------------

  it('sigue aceptando las tasas mexicanas REALES: 0, 8 y 16 (y los bordes 0/100)', () => {
    for (const bueno of [0, 8, 16, 100]) {
      expect(gate(bueno)).toBeNull();
    }
  });

  it('sigue rechazando lo que ya rechazaba: fuera de [0, 100]', () => {
    expect(gate(-1)).not.toBeNull();
    expect(gate(101)).not.toBeNull();
  });

  it('el default de código (16) pasa su propio validador', () => {
    expect(gate(SETTING_DEFAULTS[SettingKey.IVA_PCT])).toBeNull();
  });

  it('la tabla apunta al validador nombrado (no a un lambda paralelo que pueda divergir)', () => {
    expect(gate).toBe(validateIvaPct);
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

    it('⭐ RED CON LA MUTACIÓN — `{ ivaPct: 8.5 }` sale 422 y NO se escribe la fila', async () => {
      await expect(service.update({ ivaPct: 8.5 })).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
      expect(prisma.configSetting.upsert).not.toHaveBeenCalled();
    });

    it('⭐ RED CON LA MUTACIÓN — el 422 NOMBRA el dial y dice «integer», no un genérico', async () => {
      // Un 422 que no diga POR QUÉ deja al admin reintentando 8.5 hasta rendirse.
      await expect(service.update({ ivaPct: 8.5 })).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        details: { errors: { ivaPct: expect.stringMatching(/integer/i) } },
      });
    });

    it('`{ ivaPct: 8 }` (zona fronteriza norte) SÍ se guarda: el arreglo no bloquea el caso real', async () => {
      await expect(service.update({ ivaPct: 8 })).resolves.toEqual({ ivaPct: 8 });
      expect(prisma.configSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { key: 'iva_pct' } }),
      );
    });
  });

  // ---------------------------------------------------------------------------------------------
  // 4) Tripwire de acoplamiento. NO es el rojo: es el aviso para quien mueva la columna.
  //    Si `Order.ivaRatePct` deja de ser `Int`, este test cae y obliga a releer el rango de arriba
  //    (relajar el validador sin mover la columna reabre el truncamiento silencioso; moverla sin
  //    relajarlo deja un dial más estrecho que la columna, que es inofensivo pero mentiroso).
  // ---------------------------------------------------------------------------------------------

  it('TRIPWIRE — `Order.ivaRatePct` sigue siendo `Int` en el esquema (si cambia, revisar validateIvaPct)', () => {
    const schema = readFileSync(join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');
    const modelo = schema.match(/model Order \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(modelo).toMatch(/^\s*ivaRatePct\s+Int\b/m);
  });

  // ---------------------------------------------------------------------------------------------
  // 5) El PORQUÉ, en aritmética de dinero: la divergencia que el 422 evita.
  //    Verde antes y después (mide `money.ts`, no el validador). Está aquí para que el día que
  //    alguien proponga relajar el rango vea, en centavos, lo que se reabre.
  // ---------------------------------------------------------------------------------------------

  it('DOCUMENTA EL DAÑO — cobrar a 8.5 y archivar 8 no cuadra: 850 ≠ 800 centavos sobre MX$100', () => {
    const fee = { stripePct: 0.036, stripeFixedCents: 300, stripeFeeIvaPct: 0.16 };
    const cobradoConElFloat = computeCartBreakdown(10000, 8.5, fee);
    const loQueDiriaLaFilaTruncada = computeCartBreakdown(10000, Math.trunc(8.5), fee);

    expect(cobradoConElFloat.ivaCents).toBe(850);
    expect(loQueDiriaLaFilaTruncada.ivaCents).toBe(800);
    // 50 centavos por cada MX$100 de subtotal, y una fila que declara la tasa equivocada.
    expect(cobradoConElFloat.ivaCents - loQueDiriaLaFilaTruncada.ivaCents).toBe(50);
  });
});
