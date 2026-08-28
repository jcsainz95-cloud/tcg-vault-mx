import { HttpStatus } from '@nestjs/common';
import { PricingController } from '../src/modules/pricing/pricing.controller';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { FxService } from '../src/modules/pricing/fx.service';
import { PriceSyncJobService } from '../src/jobs/price-sync.service';
import {
  SETTING_DEFAULTS,
  SettingKey,
  validateSealedSpreads,
  validateSealedSpreadFallback,
} from '../src/modules/settings/settings.constants';

/**
 * v2.1.9 · D3-b (API_CONTRACT §M2 `SealedSpreadsUpdateRequest` / ARCHITECTURE §4.36) —
 * **`PUT /admin/pricing/sealed-spreads` es PARCIAL POR LLAVE, y `null` RETIRA la regla.**
 *
 * ### Las tres cosas que se fijan aquí, y por qué cada una
 *
 * 1. **Merge parcial (llave ausente = no se toca).** El contrato ya decía «parcial» y el código
 *    **REEMPLAZABA el mapa entero**. Con `upc`/`collection` ya sembrados (v2.1.9), un cliente rancio
 *    que mandara las **cinco** llaves de siempre **los borraría en silencio** — literalmente el bug
 *    de D3 reabierto desde el otro lado, y la alternativa que el arquitecto descartó por escrito.
 *
 * 2. **`null` retira** (esa presentación vuelve al `fallbackPct`; el `GET` omite la llave), que es el
 *    gesto que el editor de M2 no tenía: hasta ahora vaciar el campo respondía `422`.
 *
 * 3. **`null` ≠ `0`, y es un bug de DINERO confundirlos.** `0` es un spread **legítimo** (§SUP-8):
 *    vender **al** mercado, sin markup. `null` es «no tengo regla, usa el global». Un editor que
 *    mandara `0` al vaciar el campo pondría esa presentación a precio de mercado **sin margen** sin
 *    que nadie lo pidiera — por eso hay un test que separa los dos explícitamente.
 *
 * `fallbackPct: null` ⇒ **`422`**: el global es el respaldo del que dependen las presentaciones sin
 * regla; retirarlo las dejaría en `PRICE_PENDING`, o sea **fuera de la vitrina**, por un gesto que
 * parece de limpieza.
 */

const SEED = SETTING_DEFAULTS[SettingKey.SEALED_SPREAD_PCT_BY_SUBTYPE] as Record<string, number>;

function build(stored: Record<string, number> = { ...SEED }, fallback = 25) {
  const store = new Map<string, unknown>([
    [SettingKey.SEALED_SPREAD_PCT_BY_SUBTYPE, { ...stored }],
    [SettingKey.SEALED_SPREAD_FALLBACK_PCT, fallback],
  ]);
  const settings = {
    getRaw: jest.fn(async (key: string) => store.get(key) ?? null),
    getNumber: jest.fn(async (key: string) => store.get(key) as number),
  } as unknown as SettingsService;
  const prisma = {
    configSetting: {
      upsert: jest.fn(async (args: { where: { key: string }; update: { valueJson: unknown } }) => {
        store.set(args.where.key, args.update.valueJson);
        return { key: args.where.key };
      }),
    },
  } as unknown as PrismaService;
  const audit = { log: jest.fn(async () => undefined) } as unknown as AuditService;
  const controller = new PricingController(
    new PricingService(prisma, settings, {} as FxService, {} as never, {} as never, {} as never),
    {} as FxService,
    settings,
    audit,
    prisma,
    {} as PriceSyncJobService,
    {} as never,
    {} as never,
  );
  return { controller, store, audit };
}

describe('D3-b · el PUT es PARCIAL por llave (antes REEMPLAZABA el mapa entero)', () => {
  it('EL BUG: mandar las CINCO llaves de siempre YA NO borra `upc` ni `collection`', async () => {
    // Es el escenario exacto del cliente rancio: un editor que aún no conoce las dos nuevas.
    const { controller, store } = build();
    await controller.putSealedSpreads(
      { spreadPctBySubtype: { box: 18, etb: 22, bundle: 25, tin: 30, blister: 35 } },
      'admin-1',
    );
    const after = store.get(SettingKey.SEALED_SPREAD_PCT_BY_SUBTYPE) as Record<string, number>;
    expect(after.upc).toBe(18);
    expect(after.collection).toBe(22);
    expect(Object.keys(after).sort()).toEqual(Object.keys(SEED).sort());
  });

  it('una sola llave se fija sin tocar las demás', async () => {
    const { controller, store } = build();
    await controller.putSealedSpreads({ spreadPctBySubtype: { upc: 12 } }, 'admin-1');
    const after = store.get(SettingKey.SEALED_SPREAD_PCT_BY_SUBTYPE) as Record<string, number>;
    expect(after.upc).toBe(12);
    expect(after.box).toBe(18); // intacta
    expect(Object.keys(after).sort()).toEqual(Object.keys(SEED).sort());
  });

  it('sólo `fallbackPct` no toca el mapa de presentaciones', async () => {
    const { controller, store } = build();
    await controller.putSealedSpreads({ fallbackPct: 30 }, 'admin-1');
    expect(store.get(SettingKey.SEALED_SPREAD_FALLBACK_PCT)).toBe(30);
    expect(store.get(SettingKey.SEALED_SPREAD_PCT_BY_SUBTYPE)).toEqual(SEED);
  });
});

describe('D3-b · `null` RETIRA la regla; el GET deja de emitir la llave', () => {
  it('`{ upc: null }` borra la llave y el GET ya no la devuelve', async () => {
    const { controller } = build();
    await controller.putSealedSpreads({ spreadPctBySubtype: { upc: null } }, 'admin-1');
    const res = await controller.getSealedSpreads();
    expect(res.spreadPctBySubtype).not.toHaveProperty('upc');
    // Y sólo esa: las demás siguen.
    expect(res.spreadPctBySubtype.box).toBe(18);
    expect(res.spreadPctBySubtype.collection).toBe(22);
  });

  it('IDEMPOTENTE: retirar una llave que no estaba configurada devuelve 200, no error', async () => {
    const { controller } = build({ box: 18 });
    await expect(
      controller.putSealedSpreads({ spreadPctBySubtype: { upc: null } }, 'admin-1'),
    ).resolves.toBeDefined();
    const res = await controller.getSealedSpreads();
    expect(res.spreadPctBySubtype).toEqual({ box: 18 });
  });

  it('retirar una y ajustar otra EN LA MISMA escritura (por eso `null` y no un DELETE aparte)', async () => {
    const { controller } = build();
    await controller.putSealedSpreads(
      { spreadPctBySubtype: { upc: null, collection: 19 } },
      'admin-1',
    );
    const res = await controller.getSealedSpreads();
    expect(res.spreadPctBySubtype).not.toHaveProperty('upc');
    expect(res.spreadPctBySubtype.collection).toBe(19);
  });

  it('la retirada es VISIBLE en la auditoría (`before` la tiene, `after` no)', async () => {
    const { controller, audit } = build();
    await controller.putSealedSpreads({ spreadPctBySubtype: { upc: null } }, 'admin-1');
    const call = (audit.log as jest.Mock).mock.calls[0][0];
    expect(call.action).toBe('pricing.sealed_spreads.update');
    expect((call.before as { spreadPctBySubtype: Record<string, number> }).spreadPctBySubtype).toHaveProperty('upc');
    expect((call.after as { spreadPctBySubtype: Record<string, number> }).spreadPctBySubtype).not.toHaveProperty('upc');
  });
});

describe('D3-b · `null` ≠ `0` — la distinción que es un bug de DINERO', () => {
  it('`0` se PERSISTE como spread legítimo: vender AL mercado, sin markup (§SUP-8)', async () => {
    const { controller } = build();
    await controller.putSealedSpreads({ spreadPctBySubtype: { upc: 0 } }, 'admin-1');
    const res = await controller.getSealedSpreads();
    // La llave SIGUE ahí con valor 0 — NO se confunde con «retirada».
    expect(res.spreadPctBySubtype.upc).toBe(0);
    expect(Object.keys(res.spreadPctBySubtype)).toContain('upc');
  });

  it('`0` y `null` producen estados DISTINTOS sobre la misma llave', async () => {
    const zero = build();
    await zero.controller.putSealedSpreads({ spreadPctBySubtype: { upc: 0 } }, 'admin-1');
    const nul = build();
    await nul.controller.putSealedSpreads({ spreadPctBySubtype: { upc: null } }, 'admin-1');
    const a = (await zero.controller.getSealedSpreads()).spreadPctBySubtype;
    const b = (await nul.controller.getSealedSpreads()).spreadPctBySubtype;
    expect(a.upc).toBe(0); // markup 0% sobre mercado
    expect(b).not.toHaveProperty('upc'); // usa el fallbackPct
    expect(a).not.toEqual(b);
  });

  it('el validador acepta `null` y `0`, y sigue rechazando basura', () => {
    expect(validateSealedSpreads({ upc: null })).toBeNull();
    expect(validateSealedSpreads({ upc: 0 })).toBeNull();
    expect(validateSealedSpreads({ upc: -1 })).toMatch(/\[0, 1000\]/);
    expect(validateSealedSpreads({ upc: 1001 })).toMatch(/\[0, 1000\]/);
    expect(validateSealedSpreads({ upc: 'nada' })).toMatch(/null to remove/);
    expect(validateSealedSpreads({ jumbo: null })).toMatch(/invalid subtype/);
  });
});

describe('D3-b · `fallbackPct: null` ⇒ 422 (el global NO se retira)', () => {
  it('rechaza con 422 y con un mensaje que dice qué hacer en su lugar', async () => {
    const { controller, store } = build();
    await expect(
      controller.putSealedSpreads({ fallbackPct: null }, 'admin-1'),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      details: { field: 'fallbackPct' },
    });
    // Money-safe: no se persistió nada (ni el mapa, que iba en el mismo request si lo hubiera).
    expect(store.get(SettingKey.SEALED_SPREAD_FALLBACK_PCT)).toBe(25);
  });

  it('el motivo está en el mensaje: retirarlo dejaría PRICE_PENDING ⇒ fuera de la vitrina', () => {
    const msg = validateSealedSpreadFallback(null)!;
    expect(msg).toMatch(/PRICE_PENDING/);
    expect(msg).toMatch(/Use 0/); // el valor correcto para «sin markup global»
  });

  it('`fallbackPct: 0` SÍ se acepta — «sin markup global» es una decisión legítima', async () => {
    const { controller, store } = build();
    await controller.putSealedSpreads({ fallbackPct: 0 }, 'admin-1');
    expect(store.get(SettingKey.SEALED_SPREAD_FALLBACK_PCT)).toBe(0);
  });
});
