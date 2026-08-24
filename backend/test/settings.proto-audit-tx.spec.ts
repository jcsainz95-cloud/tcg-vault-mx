import { SettingsService } from '../src/modules/settings/settings.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { BusinessException } from '../src/common/business.exception';

/**
 * P48-B1 (v2.1.6, pentester + seguridad) — tres agujeros en `PUT /admin/settings`, que gobierna
 * **IVA, comisiones, topes AML y el umbral de INE**.
 *
 * 1. **Lista blanca esquivable por la cadena de prototipos.** `SETTING_DTO_MAP[dtoKey]` con
 *    `'__proto__'` / `'constructor'` / `'toString'` devuelve un heredado **truthy**, así que pasaba
 *    el `if (!settingKey)` y llegaba al `upsert` con una clave no-string ⇒ **500**.
 * 2. **El «todo o nada» del propio comentario era falso en la ESCRITURA.** La validación sí era
 *    atómica; los `upsert` corrían **sin transacción**, así que cualquier fallo a mitad —no solo el
 *    de `__proto__`— dejaba unos diales escritos y otros no.
 * 3. **La bitácora se perdía justo donde más importa.** El controller auditaba **después** de que
 *    `update()` retornara: una excepción saltaba el `audit.log` y el dial que sí se persistió **no
 *    dejaba entrada**.
 */

function harness(opts: { failOnKey?: string } = {}) {
  const written: Array<{ key: unknown; value: unknown }> = [];
  const audited: Array<Record<string, unknown>> = [];
  let rolledBack = false;

  const client = {
    configSetting: {
      upsert: jest.fn(async ({ where, create }: never) => {
        const key = (where as { key: unknown }).key;
        if (opts.failOnKey != null && key === opts.failOnKey) throw new Error('boom a mitad');
        written.push({ key, value: (create as { valueJson: unknown }).valueJson });
        return {};
      }),
    },
    auditLog: { create: jest.fn(async ({ data }: never) => audited.push(data as never)) },
  };

  const prisma = {
    ...client,
    // Espeja el comportamiento real: si el callback lanza, TODO lo escrito dentro se revierte.
    $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => {
      const snapshotW = written.length;
      const snapshotA = audited.length;
      try {
        return await cb(client);
      } catch (e) {
        written.length = snapshotW;
        audited.length = snapshotA;
        rolledBack = true;
        throw e;
      }
    }),
  } as unknown as PrismaService;

  return { svc: new SettingsService(prisma), written, audited, prisma, wasRolledBack: () => rolledBack };
}

/** Espeja lo que hace el controller: audita DENTRO de la transacción, con el cliente `tx`. */
const auditWithin = async (
  tx: { auditLog: { create: (a: unknown) => Promise<unknown> } },
  applied: Record<string, unknown>,
) => {
  await tx.auditLog.create({ data: { action: 'settings.update', after: applied } });
};

/**
 * ⚠️ El payload se construye con `JSON.parse`, NO con un literal — y la diferencia es el vector.
 * `{ __proto__: x }` en un literal **fija el prototipo** y no crea propiedad propia (por eso
 * `Object.entries` lo ve vacío), mientras que `JSON.parse('{"__proto__": x}')` **sí crea una
 * propiedad propia enumerable**. El body de un `PUT` llega por `JSON.parse`, así que ésta es la
 * forma fiel del ataque; con un literal el test pasaría sin probar nada.
 */
const wire = (json: string): Record<string, unknown> => JSON.parse(json) as Record<string, unknown>;

describe('P48-B1 (1) — la cadena de prototipos NO esquiva la lista blanca', () => {
  it.each(['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty'])(
    '`%s` se rechaza con 422 VALIDATION_ERROR, NO con un 500',
    async (key) => {
      const h = harness();
      const err = await h.svc.update(wire(`{"${key}": {"ivaPct": 999}}`)).catch((e) => e);
      expect(err).toBeInstanceOf(BusinessException);
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.getResponse()).toMatchObject({ details: { errors: { [key]: 'unknown setting key' } } });
      // Y JAMÁS toca la base con una clave no-string.
      expect(h.written).toHaveLength(0);
    },
  );

  it('el ACUMULADOR de errores tampoco se envenena: el 422 realmente sale (bug de segundo nivel)', async () => {
    // Segunda instancia de la MISMA clase, un nivel más abajo y encontrada por este test: con un
    // `errors = {}` normal, `errors['__proto__'] = 'unknown setting key'` NO crea propiedad —es el
    // setter de [[Prototype]], y con un string es un no-op silencioso—, así que el error se PERDÍA,
    // `Object.keys(errors).length` seguía en 0 y la petición continuaba como si fuera válida.
    const h = harness();
    const err = await h.svc.update(wire('{"__proto__": {"ivaPct": 999}}')).catch((e) => e);
    expect(err).toBeInstanceOf(BusinessException);
    expect(Object.keys(err.getResponse().details.errors)).toContain('__proto__');
  });

  it('un dial LEGÍTIMO sigue pasando (la corrección no rompe la lista blanca real)', async () => {
    const h = harness();
    await h.svc.update({ ivaPct: 16 });
    expect(h.written).toEqual([{ key: 'iva_pct', value: 16 }]);
  });

  it('mezclar una clave de prototipo con una legítima rechaza el LOTE entero (todo o nada)', async () => {
    const h = harness();
    await expect(h.svc.update(wire('{"ivaPct": 16, "__proto__": "x"}'))).rejects.toBeInstanceOf(
      BusinessException,
    );
    expect(h.written).toHaveLength(0);
  });
});

describe('P48-B1 (2) — el «todo o nada» de la ESCRITURA es real: hay transacción', () => {
  it('varios diales se escriben DENTRO de una `$transaction`', async () => {
    const h = harness();
    await h.svc.update({ ivaPct: 16, stripeFeePct: 0.036 });
    expect(h.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(h.written).toHaveLength(2);
  });

  it('si un upsert revienta a mitad, NINGÚN dial queda escrito (antes quedaban los previos)', async () => {
    const h = harness({ failOnKey: 'stripe_fee_pct' });
    await expect(h.svc.update({ ivaPct: 16, stripeFeePct: 0.036 })).rejects.toThrow('boom a mitad');
    expect(h.wasRolledBack()).toBe(true);
    expect(h.written).toHaveLength(0);
  });
});

describe('P48-B1 (3) — la bitácora vive DENTRO del alcance del fallo', () => {
  it('éxito ⇒ diales + entrada de auditoría, en el MISMO commit', async () => {
    const h = harness();
    await h.svc.update({ ivaPct: 16 }, 'admin-1', auditWithin as never);
    expect(h.written).toHaveLength(1);
    expect(h.audited).toHaveLength(1);
    expect(h.audited[0]).toMatchObject({ action: 'settings.update', after: { ivaPct: 16 } });
  });

  it('fallo a mitad ⇒ NI dial NI bitácora: es imposible que exista uno sin el otro', async () => {
    const h = harness({ failOnKey: 'stripe_fee_pct' });
    await expect(
      h.svc.update({ ivaPct: 16, stripeFeePct: 0.036 }, 'admin-1', auditWithin as never),
    ).rejects.toThrow('boom a mitad');
    expect(h.written).toHaveLength(0);
    expect(h.audited).toHaveLength(0);
  });

  it('si la AUDITORÍA revienta, los diales revierten (la bitácora no es opcional en un endpoint de dinero)', async () => {
    const h = harness();
    const failingAudit = async () => {
      throw new Error('auditoría caída');
    };
    await expect(h.svc.update({ ivaPct: 16 }, 'admin-1', failingAudit as never)).rejects.toThrow('auditoría caída');
    expect(h.written).toHaveLength(0);
  });

  it('la auditoría recibe el cliente TRANSACCIONAL, no el global', async () => {
    const h = harness();
    const seen: unknown[] = [];
    await h.svc.update({ ivaPct: 16 }, 'admin-1', (async (tx: unknown) => {
      seen.push(tx);
    }) as never);
    // El `tx` que llega es el cliente de la transacción (tiene `configSetting` y `auditLog`), no el
    // `PrismaService` completo — si se auditara con el global, la fila sobreviviría al rollback.
    expect(seen).toHaveLength(1);
    expect(seen[0]).toHaveProperty('auditLog');
    expect(seen[0]).not.toHaveProperty('$transaction');
  });
});
