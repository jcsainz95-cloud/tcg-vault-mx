import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { SettingsController } from '../src/modules/settings/settings.controller';
import { SETTING_DEFAULTS, SettingKey } from '../src/modules/settings/settings.constants';
import { FxService } from '../src/modules/pricing/fx.service';
import { FxController } from '../src/modules/pricing/pricing.controller';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { FX_AUTO_STALE_AFTER_DAYS, FX_FALLBACK_RATE } from '../src/common/fx-mode';

/**
 * ⭐⭐ **LOS CANDADOS DEL MODO DEL TIPO DE CAMBIO** (API_CONTRACT §M2-F.6 · ARCHITECTURE §4.43 ·
 * v1.63.1). Trece, `FX-1` … `FX-13`.
 *
 * ### La vara: **estos candados miden el DINERO, no el rótulo**
 * *Un candado que no se puede poner rojo no vale, y un candado que mide el NOMBRE de un campo no vale
 * nada.* Por eso los dos ⭐⭐ de la feature (`FX-1`, `FX-2`) no asiertan campos del DTO: asiertan el
 * **`referenceMxnCents` de la MISMA carta** antes y después del flip —el peso que sale— y leen la
 * **fila `ConfigSetting` a pelo**, que es la mutación con disfraz (conservar el número en la
 * respuesta y borrarlo de la base).
 *
 * ### Por qué el arnés es una base de datos en memoria y no una pila de mocks
 * `FX-2(a)` y `FX-6` necesitan **tres estados de base distintos** (`"legacy"`, fila **ausente**, y
 * sembrada) y `FX-11` necesita **dos filas `FxRate` del mismo día compitiendo**. Con `jest.fn()` por
 * método eso no se puede montar sin que el propio mock decida el resultado. Aquí corren las clases
 * **reales** —`SettingsService`, `FxService`, `PricingService`, los dos controllers y `AuditService`—
 * contra una tabla en memoria que respeta lo que importa: los defaults de código cuando la fila NO
 * existe, el `orderBy effectiveDate desc` **con y sin** filtro de fuente, y una `$transaction` que
 * **revierte de verdad**.
 *
 * *El código de este pase es pequeño; la prueba es lo que cuesta, y es donde debe costar.*
 */

// ── El arnés ──────────────────────────────────────────────────────────────────────────────────────

type SettingRow = { key: string; valueJson: unknown; updatedBy?: string | null };
type FxRateRow = { id: string; rate: number; bufferPct: number; effectiveDate: Date; source: string };
type PriceRefRow = {
  cardId: string;
  productType: string;
  gradeKey: string;
  finish: string;
  priceMxnCents: number;
  priceUsdCents: number | null;
  isManualOverride: boolean;
  source: string;
  capturedDate: Date;
  cardProductId: string | null;
  refKind: string;
};

interface SeedOpts {
  /** Filas `ConfigSetting` que EXISTEN. Lo que no esté aquí resuelve al default de código. */
  settings?: Record<string, unknown>;
  fxRates?: FxRateRow[];
  priceRefs?: PriceRefRow[];
  /** Fuerza el fallo del upsert de esa clave (para probar transaccionalidad). */
  failOnSettingKey?: string;
  env?: Record<string, string>;
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

const TODAY = daysAgo(0);

function banxicoRow(rate: number, date: Date = TODAY): FxRateRow {
  return { id: `banxico-${date.toISOString().slice(0, 10)}`, rate, bufferPct: 3, effectiveDate: date, source: 'banxico' };
}

function manualRow(rate: number, date: Date = TODAY): FxRateRow {
  return { id: `manual-${date.toISOString().slice(0, 10)}`, rate, bufferPct: 3, effectiveDate: date, source: 'manual' };
}

/** La carta de la prueba de conducta: referencia de MERCADO en USD ($10.00) — se valúa VIVA. */
function usdCardRef(): PriceRefRow {
  return {
    cardId: 'card-1',
    productType: 'raw',
    gradeKey: 'raw:NM',
    finish: 'normal',
    priceMxnCents: 18000, // congelado en la ingesta; solo es fallback money-safe
    priceUsdCents: 1000, // USD 10.00
    isManualOverride: false,
    source: 'pokemontcg_io',
    capturedDate: TODAY,
    cardProductId: null,
    refKind: 'market',
  };
}

/** El peso que DEBE salir, calculado aquí a mano (no con el helper de producción). */
function expectedMxnCents(usdCents: number, rate: number, bufferPct: number): number {
  return Math.round(usdCents * rate * (1 + bufferPct / 100));
}

function harness(seed: SeedOpts = {}) {
  const settingRows = new Map<string, SettingRow>(
    Object.entries(seed.settings ?? {}).map(([key, valueJson]) => [key, { key, valueJson }]),
  );
  const fxRates: FxRateRow[] = [...(seed.fxRates ?? [])];
  const priceRefs: PriceRefRow[] = [...(seed.priceRefs ?? [])];
  const auditEntries: Record<string, unknown>[] = [];

  /**
   * ⭐⭐ **v1.63.2 — cada escritura se anota con SI VINO POR EL HANDLE DE LA TRANSACCIÓN.**
   *
   * QA rompió `settings.service.ts:353` (`tx.` → `this.prisma.`) y **los 43 tests siguieron verdes**:
   * el arnés revertía por instantánea, así que daba igual por qué handle se hubiera escrito. Una
   * transaccionalidad que el arnés no puede distinguir **no está medida**. Ahora el `$transaction`
   * entrega un cliente **distinto**, y quien escriba por el de fuera queda marcado.
   */
  const writes: { key: string; inTx: boolean }[] = [];
  const auditWrites: { action: unknown; inTx: boolean }[] = [];

  const makeClient = (inTx: boolean) => ({
    configSetting: {
      findUnique: async ({ where }: { where: { key: string } }) => settingRows.get(where.key) ?? null,
      findMany: async () => [...settingRows.values()],
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { key: string };
        create: SettingRow;
        update: { valueJson: unknown; updatedBy?: string | null };
      }) => {
        if (seed.failOnSettingKey === where.key) throw new Error('boom: fallo al escribir el ajuste');
        writes.push({ key: where.key, inTx });
        const existing = settingRows.get(where.key);
        settingRows.set(where.key, {
          key: where.key,
          valueJson: existing ? update.valueJson : create.valueJson,
          updatedBy: existing ? update.updatedBy : create.updatedBy,
        });
        return settingRows.get(where.key);
      },
    },
    fxRate: {
      // Espeja Postgres en lo único que decide dinero aquí: el filtro por fuente y el orden por
      // fecha descendente. Sin filtro devuelve la última de CUALQUIER fuente — que es la conducta
      // de v1.62.2 y lo que FX-11 tiene que poder poner en rojo.
      //
      // ⚠️ **El desempate del MISMO día es DELIBERADAMENTE el adverso**: gana la fila escrita más
      // tarde, que es exactamente lo que pasa en producción cuando `PUT /admin/fx { rate }` escribe
      // su fila `manual-<hoy>` después de que el job dejó la de `banxico-<hoy>`. Con `effectiveDate`
      // empatado, Postgres no promete orden: un candado que se apoyara en que «gana la primera»
      // estaría midiendo la suerte del motor, no la regla (I-FX5).
      findFirst: async (args?: { where?: { source?: string } }) => {
        const src = args?.where?.source;
        const rows = fxRates
          .map((r, i) => ({ r, i }))
          .filter(({ r }) => src == null || r.source === src)
          .sort((a, b) => b.r.effectiveDate.getTime() - a.r.effectiveDate.getTime() || b.i - a.i);
        return rows[0]?.r ?? null;
      },
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { id: string };
        create: FxRateRow;
        update: Partial<FxRateRow>;
      }) => {
        const i = fxRates.findIndex((r) => r.id === where.id);
        if (i >= 0) fxRates[i] = { ...fxRates[i], ...update };
        else fxRates.push({ ...create });
        return {};
      },
    },
    priceReference: {
      findMany: async () => priceRefs.map((r) => ({ ...r })),
      findFirst: async () => (priceRefs[0] ? { ...priceRefs[0] } : null),
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        auditEntries.push(data);
        auditWrites.push({ action: data.action, inTx });
        return data;
      },
      findMany: async () => [...auditEntries],
      count: async () => auditEntries.length,
    },
  });

  /** El cliente de FUERA de la transacción: `this.prisma`. */
  const client = makeClient(false);
  /** El que entrega `$transaction`: `tx`. **Es otro objeto a propósito.** */
  const txClient = makeClient(true);

  const prisma = {
    ...client,
    // Revierte DE VERDAD: sin esto, «efecto y bitácora commitean o revierten juntos» sería una
    // frase, no una propiedad medible (FX-5, segundo caso).
    $transaction: async (cb: (tx: unknown) => unknown) => {
      const snapSettings = new Map(settingRows);
      const snapAudit = auditEntries.length;
      const snapFx = fxRates.length;
      try {
        return await cb(txClient);
      } catch (e) {
        settingRows.clear();
        for (const [k, v] of snapSettings) settingRows.set(k, v);
        auditEntries.length = snapAudit;
        fxRates.length = snapFx;
        throw e;
      }
    },
  } as unknown as PrismaService;

  const settings = new SettingsService(prisma);
  const fx = new FxService(prisma, settings, new ConfigService(seed.env ?? {}));
  const audit = new AuditService(prisma);
  const pricing = new PricingService(prisma, settings, fx, {} as never, {} as never, {} as never);
  const fxCtrl = new FxController(fx, audit);
  const settingsCtrl = new SettingsController(settings, audit, prisma);

  return {
    prisma,
    settings,
    fx,
    audit,
    pricing,
    fxCtrl,
    settingsCtrl,
    auditEntries,
    fxRates,
    /** ⭐ Las escrituras de `ConfigSetting`, con la marca de si fueron transaccionales. */
    writes,
    /** ⭐ Las entradas de bitácora, con la misma marca. */
    auditWrites,
    /** ⭐ Lee la fila `ConfigSetting` A PELO (no por el DTO): la mutación con disfraz vive aquí. */
    rawSetting: (key: string) => (settingRows.has(key) ? settingRows.get(key)!.valueJson : undefined),
    settingExists: (key: string) => settingRows.has(key),
    /** El peso que sale por la carta de mercado en USD, con la FX VIGENTE. */
    referenceMxnCents: async () => {
      const info = await pricing.getReference('card-1', 'raw' as never, 'raw:NM', 'normal' as never);
      return info.referenceMxnCents;
    },
  };
}

const MODE_KEY = SettingKey.FX_RATE_MODE;
const RATE_KEY = SettingKey.FX_MANUAL_OVERRIDE_RATE;

// ── FX-1 ⭐⭐ ──────────────────────────────────────────────────────────────────────────────────────

/**
 * **FX-1 — que el modo se vuelva a inferir del valor, mitad A:** que apagar el manual **borre el
 * número** (o que volver a manual exija reteclearlo).
 *
 * **EL candado de la feature, y es un VIAJE DE IDA Y VUELTA, no una aserción.**
 */
describe('FX-1 ⭐⭐ — el interruptor va y vuelve SIN reteclear la tasa, y el catálogo lo siente', () => {
  function produccion() {
    return harness({
      settings: { [MODE_KEY]: 'manual', [RATE_KEY]: 19.0, [SettingKey.FX_BUFFER_PCT]: 3 },
      fxRates: [banxicoRow(18.2)],
      priceRefs: [usdCardRef()],
    });
  }

  it('(a) a AUTO: rige Banxico y el número manual SIGUE ahí — (b) y la FILA no se borró', async () => {
    const h = produccion();
    const res = await h.fxCtrl.setMode({ mode: 'auto' }, 'admin-1', 'super_admin' as never);

    expect(res.rate).toBe(18.2);
    expect(res.source).toBe('banxico');
    expect(res.mode).toBe('auto');
    // ⭐ el número guardado VIAJA aunque no rija.
    expect(res.manual.rate).toBe(19.0);
    expect(res.manual.applied).toBe(false);

    // ⭐ (b) LA FILA, a pelo. Rojo si el DTO conserva el número pero la base se limpió.
    expect(h.rawSetting(RATE_KEY)).toBe(19.0);
    expect(h.rawSetting(MODE_KEY)).toBe('auto');
  });

  it('(c) vuelta a MANUAL con body de sólo {mode} ⇒ 19.0 otra vez (sin reenviar la tasa)', async () => {
    const h = produccion();
    await h.fxCtrl.setMode({ mode: 'auto' }, 'admin-1', 'super_admin' as never);
    const back = await h.fxCtrl.setMode({ mode: 'manual' }, 'admin-1', 'super_admin' as never);

    expect(back.rate).toBe(19.0);
    expect(back.source).toBe('manual');
    expect(back.manual.applied).toBe(true);
    // Y la de Banxico sigue viajando al lado, para poder volver a comparar.
    expect(back.automatic.rate).toBe(18.2);
  });

  it('(d) alternar TRES veces da resultados idénticos (sin efectos acumulativos)', async () => {
    const h = produccion();
    for (let i = 0; i < 3; i++) {
      const a = await h.fxCtrl.setMode({ mode: 'auto' }, 'admin-1', 'super_admin' as never);
      expect([a.rate, a.source, a.manual.rate]).toEqual([18.2, 'banxico', 19.0]);
      const m = await h.fxCtrl.setMode({ mode: 'manual' }, 'admin-1', 'super_admin' as never);
      expect([m.rate, m.source, m.manual.rate]).toEqual([19.0, 'manual', 19.0]);
    }
  });

  it('(e) ⭐ LA CONDUCTA: el referenceMxnCents de la MISMA carta se mueve 18.2 ↔ 19.0', async () => {
    const h = produccion();
    // Punto de partida: manual 19.0 rige.
    expect(await h.referenceMxnCents()).toBe(expectedMxnCents(1000, 19.0, 3));

    await h.fxCtrl.setMode({ mode: 'auto' }, 'admin-1', 'super_admin' as never);
    expect(await h.referenceMxnCents()).toBe(expectedMxnCents(1000, 18.2, 3));

    await h.fxCtrl.setMode({ mode: 'manual' }, 'admin-1', 'super_admin' as never);
    expect(await h.referenceMxnCents()).toBe(expectedMxnCents(1000, 19.0, 3));
  });

  it('I-FX3 — cambiar el modo NUNCA escribe el valor (ni para «limpiarlo»)', async () => {
    const h = produccion();
    await h.fxCtrl.setMode({ mode: 'auto' }, 'admin-1', 'super_admin' as never);
    await h.fxCtrl.setMode({ mode: 'manual' }, 'admin-1', 'super_admin' as never);
    await h.fxCtrl.setMode({ mode: 'auto' }, 'admin-1', 'super_admin' as never);
    expect(h.rawSetting(RATE_KEY)).toBe(19.0);
  });
});

// ── FX-2 ⭐⭐ y FX-2(a) ⭐⭐ ────────────────────────────────────────────────────────────────────────

/**
 * **FX-2 — mitad B:** que **guardar un número encienda el manual solo**. El gemelo de FX-1, y el que
 * cierra **I-FX2**.
 */
describe('FX-2 ⭐⭐ — guardar una tasa en modo `auto` NO la enciende', () => {
  function enAuto() {
    return harness({
      settings: { [MODE_KEY]: 'auto', [SettingKey.FX_BUFFER_PCT]: 3 },
      fxRates: [banxicoRow(18.2)],
      priceRefs: [usdCardRef()],
    });
  }

  it('PUT /admin/fx { rate: 25 } ⇒ mode auto, rige 18.2, el 25 queda GUARDADO y sin aplicar', async () => {
    const h = enAuto();
    const res = await h.fxCtrl.setManual({ rate: 25 }, 'admin-1', 'super_admin' as never);

    expect(res.mode).toBe('auto');
    expect(res.rate).toBe(18.2);
    expect(res.source).toBe('banxico');
    expect(res.manual.rate).toBe(25);
    expect(res.manual.applied).toBe(false);
    // ⭐⭐ el amarre que mata la mutación silenciosa: la fila del modo existe y vale "auto".
    expect(h.rawSetting(MODE_KEY)).toBe('auto');
    expect(res.modeResolvedFrom).toBe('setting');
  });

  it('⭐ LA CONDUCTA: el referenceMxnCents NO se movió (sigue a 18.2)', async () => {
    const h = enAuto();
    const antes = await h.referenceMxnCents();
    await h.fxCtrl.setManual({ rate: 25 }, 'admin-1', 'super_admin' as never);
    expect(await h.referenceMxnCents()).toBe(antes);
    expect(await h.referenceMxnCents()).toBe(expectedMxnCents(1000, 18.2, 3));
  });
});

/**
 * **FX-2(a) ⭐⭐ — el ORDEN del pin de I-FX2** (v1.63.1). Resolver el modo **DESPUÉS** de aplicar la
 * escritura en vez de **antes**.
 *
 * ⚠️ **FX-2 no lo caza** porque arranca con `fx_rate_mode = "auto"` ya sembrado, así que la
 * resolución legacy nunca corre y el orden da igual; **FX-6 tampoco**, porque mide la LECTURA de
 * arranque, no una ESCRITURA. Éste es el hueco que quedaba entre los dos, y por donde pasa el dinero.
 */
describe('FX-2(a) ⭐⭐ — el pin se resuelve ANTES de aplicar la escritura', () => {
  // El estado REAL de un entorno tras el deploy: sentinel (o fila ausente) y NINGUNA tasa manual.
  const casos: [string, Record<string, unknown>][] = [
    ['fila en "legacy" (el seed)', { [MODE_KEY]: 'legacy', [SettingKey.FX_BUFFER_PCT]: 3 }],
    ['fila AUSENTE (nunca sembrada)', { [SettingKey.FX_BUFFER_PCT]: 3 }],
  ];

  it.each(casos)('%s ⇒ el primer PUT /admin/fx { rate: 25 } NO enciende el manual', async (_n, s) => {
    const h = harness({ settings: s, fxRates: [banxicoRow(18.2)], priceRefs: [usdCardRef()] });
    const antes = await h.referenceMxnCents();

    const res = await h.fxCtrl.setManual({ rate: 25 }, 'admin-1', 'super_admin' as never);

    expect(res.mode).toBe('auto');
    expect(res.rate).toBe(18.2);
    expect(h.rawSetting(MODE_KEY)).toBe('auto');
    // ⭐ LA CONDUCTA: el catálogo no se movió. Con la resolución DESPUÉS de la escritura, el 25 ya
    // estaría en la base cuando se pregunta el modo ⇒ «manual» ⇒ repreciado al instante.
    expect(await h.referenceMxnCents()).toBe(antes);
    expect(await h.referenceMxnCents()).toBe(expectedMxnCents(1000, 18.2, 3));
  });

  it('la misma escritura por la OTRA puerta (PUT /admin/settings) pinnea igual', async () => {
    const h = harness({
      settings: { [MODE_KEY]: 'legacy', [SettingKey.FX_BUFFER_PCT]: 3 },
      fxRates: [banxicoRow(18.2)],
      priceRefs: [usdCardRef()],
    });
    await h.settingsCtrl.updateSettings({ fxManualOverrideRate: 25 }, 'admin-1', 'super_admin' as never);
    expect(h.rawSetting(MODE_KEY)).toBe('auto');
    expect((await h.fx.getCurrent()).rate).toBe(18.2);
  });
});

// ── FX-3 / FX-4 — I-FX4 por las dos puertas ──────────────────────────────────────────────────────

describe('FX-3 — «manual sin número» por la puerta del VALOR', () => {
  it('borrar la tasa estando en manual ⇒ 422 FX_MANUAL_RATE_REQUIRED y la fila sigue en 19.0', async () => {
    const h = harness({
      settings: { [MODE_KEY]: 'manual', [RATE_KEY]: 19.0, [SettingKey.FX_BUFFER_PCT]: 3 },
      fxRates: [banxicoRow(18.2)],
    });
    await expect(
      h.settingsCtrl.updateSettings({ fxManualOverrideRate: null }, 'admin-1', 'super_admin' as never),
    ).rejects.toMatchObject({ code: 'FX_MANUAL_RATE_REQUIRED' });

    // Sin escritura parcial: ni el valor ni el modo se movieron.
    expect(h.rawSetting(RATE_KEY)).toBe(19.0);
    expect(h.rawSetting(MODE_KEY)).toBe('manual');
  });

  it('en modo AUTO sí se puede borrar (no hay «manual sin número» que crear)', async () => {
    const h = harness({
      settings: { [MODE_KEY]: 'auto', [RATE_KEY]: 19.0, [SettingKey.FX_BUFFER_PCT]: 3 },
      fxRates: [banxicoRow(18.2)],
    });
    await h.settingsCtrl.updateSettings({ fxManualOverrideRate: null }, 'admin-1', 'super_admin' as never);
    expect(h.rawSetting(RATE_KEY)).toBeNull();
  });
});

describe('FX-4 — «manual sin número» por la puerta del MODO', () => {
  it('pedir manual sin tasa guardada ⇒ 422 FX_MANUAL_RATE_MISSING y el modo SIGUE en auto', async () => {
    const h = harness({
      settings: { [MODE_KEY]: 'auto', [SettingKey.FX_BUFFER_PCT]: 3 },
      fxRates: [banxicoRow(18.2)],
      priceRefs: [usdCardRef()],
    });
    await expect(
      h.fxCtrl.setMode({ mode: 'manual' }, 'admin-1', 'super_admin' as never),
    ).rejects.toMatchObject({ code: 'FX_MANUAL_RATE_MISSING', details: { savedManualRate: null } });

    expect(h.rawSetting(MODE_KEY)).toBe('auto');
    const state = await h.fx.getCurrent();
    expect(state.mode).toBe('auto');
    // Rojo si cambió el modo y luego falló, o si aplicó el fallback de 18.
    expect(state.rate).toBe(18.2);
    expect(await h.referenceMxnCents()).toBe(expectedMxnCents(1000, 18.2, 3));
  });
});

// ── FX-5 ⭐ — la bitácora ─────────────────────────────────────────────────────────────────────────

describe('FX-5 ⭐ — la bitácora lleva los NÚMEROS y el ACTOR, y es transaccional', () => {
  it('tras el flip: fx.mode.change con actor, entidad y los DOS efectiveRate', async () => {
    const h = harness({
      settings: { [MODE_KEY]: 'manual', [RATE_KEY]: 19.0, [SettingKey.FX_BUFFER_PCT]: 3 },
      fxRates: [banxicoRow(18.2)],
    });
    await h.fxCtrl.setMode({ mode: 'auto' }, 'usr_admin', 'super_admin' as never);

    const last = h.auditEntries.filter((e) => e.action === 'fx.mode.change').pop() as never as {
      actorUserId: string;
      actorRole: string;
      entityType: string;
      entityId: string;
      before: { mode: string; effectiveRate: number; source: string; bufferPct: number };
      after: { mode: string; effectiveRate: number; source: string; effectiveDate: string };
    };
    expect(last).toBeDefined();
    expect(last.actorUserId).toBe('usr_admin');
    expect(last.actorRole).toBe('super_admin');
    expect(last.entityType).toBe('ConfigSetting');
    expect(last.entityId).toBe('fx_rate_mode');
    // ⭐ los NÚMEROS, no los rótulos.
    expect(last.before.effectiveRate).toBe(19.0);
    expect(last.after.effectiveRate).toBe(18.2);
    expect(last.before.mode).toBe('manual');
    expect(last.after.mode).toBe('auto');
    // Y el colchón: sin él, la entrada no permite reconstruir el precio de aquel día.
    expect(last.before.bufferPct).toBe(3);
    expect(last.after.source).toBe('banxico');
  });

  it('idempotente en el EFECTO, no en la bitácora: pedir el modo vigente deja entrada before==after', async () => {
    const h = harness({
      settings: { [MODE_KEY]: 'manual', [RATE_KEY]: 19.0, [SettingKey.FX_BUFFER_PCT]: 3 },
      fxRates: [banxicoRow(18.2)],
    });
    const res = await h.fxCtrl.setMode({ mode: 'manual' }, 'usr_admin', 'super_admin' as never);
    expect(res.rate).toBe(19.0);
    const entries = h.auditEntries.filter((e) => e.action === 'fx.mode.change');
    expect(entries).toHaveLength(1);
    expect((entries[0] as { before: unknown }).before).toEqual((entries[0] as { after: unknown }).after);
  });

  it('transaccionalidad: si la escritura del ajuste falla, NO queda entrada (ni efecto sin entrada)', async () => {
    const h = harness({
      settings: { [MODE_KEY]: 'manual', [RATE_KEY]: 19.0, [SettingKey.FX_BUFFER_PCT]: 3 },
      fxRates: [banxicoRow(18.2)],
      failOnSettingKey: MODE_KEY,
    });
    await expect(h.fxCtrl.setMode({ mode: 'auto' }, 'usr_admin', 'super_admin' as never)).rejects.toThrow();
    expect(h.auditEntries.filter((e) => e.action === 'fx.mode.change')).toHaveLength(0);
    expect(h.rawSetting(MODE_KEY)).toBe('manual');
  });

  it('fx.override queda NORMALIZADA: before, claves de entidad y `applied`', async () => {
    const h = harness({
      settings: { [MODE_KEY]: 'auto', [SettingKey.FX_BUFFER_PCT]: 3 },
      fxRates: [banxicoRow(18.2)],
    });
    await h.fxCtrl.setManual({ rate: 25 }, 'usr_admin', 'super_admin' as never);
    const entry = h.auditEntries.find((e) => e.action === 'fx.override') as never as {
      actorUserId: string;
      entityType: string;
      entityId: string;
      before: { effectiveRate: number };
      after: { manualRate: number; applied: boolean; effectiveRate: number };
    };
    expect(entry.actorUserId).toBe('usr_admin');
    expect(entry.entityType).toBe('ConfigSetting');
    expect(entry.entityId).toBe('fx_manual_override_rate');
    expect(entry.before.effectiveRate).toBe(18.2);
    expect(entry.after.manualRate).toBe(25);
    // ⭐ guardar en `auto` es un gesto legítimo cuyo efecto es NINGUNO todavía, y se distingue.
    expect(entry.after.applied).toBe(false);
    expect(entry.after.effectiveRate).toBe(18.2);
  });
});

// ── FX-6 ⭐⭐ — la migración ──────────────────────────────────────────────────────────────────────

/**
 * **FX-6 — que el despliegue cambie de conducta solo**: sembrar `'auto'`, un `?? "auto"` en el
 * lector, o un `UPDATE` de migración. **Son DOS bases de datos**, y una verificación por lo negativo.
 */
describe('FX-6 ⭐⭐ — el despliegue NO cambia la conducta por su cuenta', () => {
  it('(a) «producción» con la fila en "legacy": sigue en MANUAL con 19.0000', async () => {
    const h = harness({
      settings: { [MODE_KEY]: 'legacy', [RATE_KEY]: 19.0, [SettingKey.FX_BUFFER_PCT]: 3 },
      fxRates: [banxicoRow(18.2)],
      priceRefs: [usdCardRef()],
    });
    const state = await h.fx.getCurrent();
    expect(state.mode).toBe('manual');
    expect(state.rate).toBe(19.0);
    expect(state.modeResolvedFrom).toBe('legacy');
    expect(await h.referenceMxnCents()).toBe(expectedMxnCents(1000, 19.0, 3));
  });

  it('(a-bis) «producción» con la fila AUSENTE: idéntico (el default de código es el sentinel)', async () => {
    const h = harness({
      settings: { [RATE_KEY]: 19.0, [SettingKey.FX_BUFFER_PCT]: 3 },
      fxRates: [banxicoRow(18.2)],
    });
    const state = await h.fx.getCurrent();
    expect(state.mode).toBe('manual');
    expect(state.rate).toBe(19.0);
    expect(state.modeResolvedFrom).toBe('legacy');
  });

  it('(b) «instalación limpia»: sin override y en "legacy" ⇒ AUTO con la tasa de Banxico', async () => {
    const h = harness({
      settings: { [MODE_KEY]: 'legacy', [SettingKey.FX_BUFFER_PCT]: 3 },
      fxRates: [banxicoRow(18.2)],
    });
    const state = await h.fx.getCurrent();
    expect(state.mode).toBe('auto');
    expect(state.rate).toBe(18.2);
    expect(state.source).toBe('banxico');
    expect(state.modeResolvedFrom).toBe('legacy');
  });

  it('(c) ⭐ POR LO NEGATIVO: SETTING_DEFAULTS[fx_rate_mode] === "legacy", nunca auto ni manual', () => {
    expect(SETTING_DEFAULTS[SettingKey.FX_RATE_MODE]).toBe('legacy');
    expect(SETTING_DEFAULTS[SettingKey.FX_RATE_MODE]).not.toBe('auto');
    expect(SETTING_DEFAULTS[SettingKey.FX_RATE_MODE]).not.toBe('manual');
  });

  it('(c-bis) `legacy` NUNCA sale por la API: el DTO sólo emite auto|manual', async () => {
    for (const seedRow of ['legacy', undefined, null, true, 'AUTO', 'basura']) {
      const h = harness({
        settings: seedRow === undefined ? {} : { [MODE_KEY]: seedRow },
        fxRates: [banxicoRow(18.2)],
      });
      const state = await h.fx.getCurrent();
      expect(['auto', 'manual']).toContain(state.mode);
      expect(state.modeResolvedFrom).toBe('legacy');
    }
  });

  it('(d) el seed NO tiene lógica: sigue siendo el bucle sobre SETTING_DEFAULTS', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'prisma', 'seed.ts'), 'utf8');
    expect(src).toContain('for (const [key, value] of Object.entries(SETTING_DEFAULTS))');
    // Rojo si aparece una derivación del modo en el seed (§4.43g punto 2).
    expect(src).not.toContain('fx_rate_mode');
    expect(src).not.toContain('FX_RATE_MODE');
  });

  it('⛔ `fx_rate_mode` NO se puede editar por PUT /admin/settings (clave desconocida ⇒ 422)', async () => {
    const h = harness({ settings: { [MODE_KEY]: 'manual', [RATE_KEY]: 19.0 } });
    await expect(
      h.settingsCtrl.updateSettings({ fxRateMode: 'auto' }, 'admin-1', 'super_admin' as never),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(h.rawSetting(MODE_KEY)).toBe('manual');
    // Y tampoco se EXPONE en el DTO de M10.
    const dto = await h.settings.getAllDto();
    expect(dto).not.toHaveProperty('fxRateMode');
  });
});

// ── FX-11 ⭐ — I-FX5, la precedencia ──────────────────────────────────────────────────────────────

describe('FX-11 ⭐ — una fila `FxRate` de fuente `manual` NO RIGE NUNCA', () => {
  it('dos filas del MISMO día compitiendo ⇒ rige la de banxico, y rate === automatic.rate', async () => {
    const h = harness({
      settings: { [MODE_KEY]: 'auto', [SettingKey.FX_BUFFER_PCT]: 3 },
      // La manual va DESPUÉS a propósito: con `findFirst` sin filtro, empata o gana.
      fxRates: [banxicoRow(18.2), manualRow(25)],
      priceRefs: [usdCardRef()],
    });
    const state = await h.fx.getCurrent();
    expect(state.rate).toBe(18.2);
    expect(state.source).toBe('banxico');
    expect(state.rate).toBe(state.automatic.rate);
    expect(state.effectiveDate).toBe(state.automatic.effectiveDate);
    expect(await h.referenceMxnCents()).toBe(expectedMxnCents(1000, 18.2, 3));
  });

  it('⭐ por la VÍA REAL: PUT /admin/fx { rate: 25 } escribe esa fila, y el GET siguiente sigue en 18.2', async () => {
    const h = harness({
      settings: { [MODE_KEY]: 'auto', [SettingKey.FX_BUFFER_PCT]: 3 },
      fxRates: [banxicoRow(18.2)],
      priceRefs: [usdCardRef()],
    });
    await h.fxCtrl.setManual({ rate: 25 }, 'admin-1', 'super_admin' as never);
    // El escritor NO se toca: la fila manual del día se sigue escribiendo (traza forense).
    expect(h.fxRates.some((r) => r.source === 'manual' && r.rate === 25)).toBe(true);

    const state = await h.fxCtrl.current();
    expect(state.rate).toBe(18.2);
    expect(state.source).toBe('banxico');
    expect(await h.referenceMxnCents()).toBe(expectedMxnCents(1000, 18.2, 3));
  });
});

// ── FX-12 — el acuse ─────────────────────────────────────────────────────────────────────────────

describe('FX-12 — sin segunda tasa, el interruptor exige ACUSE', () => {
  function sinBanxico() {
    return harness({
      settings: { [MODE_KEY]: 'manual', [RATE_KEY]: 19.0, [SettingKey.FX_BUFFER_PCT]: 3 },
      fxRates: [],
      priceRefs: [usdCardRef()],
    });
  }

  it('a `auto` sin acuse ⇒ 422 FX_NO_AUTOMATIC_RATE, y el modo SIGUE en manual con 19.0', async () => {
    const h = sinBanxico();
    await expect(h.fxCtrl.setMode({ mode: 'auto' }, 'admin-1', 'super_admin' as never)).rejects.toMatchObject({
      code: 'FX_NO_AUTOMATIC_RATE',
      details: { currentRate: 19.0, fallbackRate: FX_FALLBACK_RATE },
    });
    expect(h.rawSetting(MODE_KEY)).toBe('manual');
    expect((await h.fx.getCurrent()).rate).toBe(19.0);
    expect(await h.referenceMxnCents()).toBe(expectedMxnCents(1000, 19.0, 3));
  });

  it('con acuse ⇒ 200, source `fallback`, rate 18, y la bitácora lo registra', async () => {
    const h = sinBanxico();
    const res = await h.fxCtrl.setMode(
      { mode: 'auto', acknowledgeNoAutomaticRate: true },
      'admin-1',
      'super_admin' as never,
    );
    expect(res.source).toBe('fallback');
    expect(res.rate).toBe(FX_FALLBACK_RATE);
    expect(res.automatic.status).toBe('missing');
    const entry = h.auditEntries.filter((e) => e.action === 'fx.mode.change').pop() as never as {
      after: { acknowledgedNoAutomaticRate?: boolean };
    };
    expect(entry.after.acknowledgedNoAutomaticRate).toBe(true);
    // ⭐ el salto que el acuse existe para hacer consciente: ~5% de todo el catálogo.
    expect(await h.referenceMxnCents()).toBe(expectedMxnCents(1000, FX_FALLBACK_RATE, 3));
  });

  it('⛔ NO se pide con `stale`: ahí hay un número real que el humano puede juzgar', async () => {
    const h = harness({
      settings: { [MODE_KEY]: 'manual', [RATE_KEY]: 19.0, [SettingKey.FX_BUFFER_PCT]: 3 },
      fxRates: [banxicoRow(18.2, daysAgo(40))],
    });
    const res = await h.fxCtrl.setMode({ mode: 'auto' }, 'admin-1', 'super_admin' as never);
    expect(res.automatic.status).toBe('stale');
    expect(res.rate).toBe(18.2);
    const entry = h.auditEntries.filter((e) => e.action === 'fx.mode.change').pop() as never as {
      after: { acknowledgedNoAutomaticRate?: boolean };
    };
    expect(entry.after.acknowledgedNoAutomaticRate).toBeUndefined();
  });

  it('el acuse NO escribe la tasa (I-FX3 intacto: es un acuse, no un número)', async () => {
    const h = sinBanxico();
    await h.fxCtrl.setMode({ mode: 'auto', acknowledgeNoAutomaticRate: true }, 'admin-1', 'super_admin' as never);
    expect(h.rawSetting(RATE_KEY)).toBe(19.0);
  });

  it('`mode` fuera del enum ⇒ 422 VALIDATION_ERROR (y el modo no cambia)', async () => {
    const h = sinBanxico();
    for (const bad of [undefined, 'AUTO', 'legacy', 1, null]) {
      await expect(
        h.fxCtrl.setMode({ mode: bad }, 'admin-1', 'super_admin' as never),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    }
    expect(h.rawSetting(MODE_KEY)).toBe('manual');
  });
});

// ── FX-13 — auditar por `fx.mode.change` es COMPLETO ──────────────────────────────────────────────

describe('FX-13 — un cambio de modo entrado por PUT /admin/settings TAMBIÉN deja fx.mode.change', () => {
  it('fxManualOverrideRate: 30 en "legacy" sin tasa ⇒ settings.update Y fx.mode.change', async () => {
    const h = harness({
      settings: { [MODE_KEY]: 'legacy', [SettingKey.FX_BUFFER_PCT]: 3 },
      fxRates: [banxicoRow(18.2)],
    });
    await h.settingsCtrl.updateSettings({ fxManualOverrideRate: 30 }, 'usr_admin', 'super_admin' as never);

    expect(h.auditEntries.filter((e) => e.action === 'settings.update')).toHaveLength(1);
    const modeEntries = h.auditEntries.filter((e) => e.action === 'fx.mode.change');
    expect(modeEntries).toHaveLength(1);
    const entry = modeEntries[0] as never as {
      actorUserId: string;
      entityId: string;
      before: { bufferPct: number; effectiveRate: number };
      after: { bufferPct: number; mode: string };
    };
    expect(entry.actorUserId).toBe('usr_admin');
    expect(entry.entityId).toBe('fx_rate_mode');
    expect(entry.before.bufferPct).toBe(3);
    expect(entry.after.bufferPct).toBe(3);
    expect(entry.after.mode).toBe('auto');
    expect(h.rawSetting(MODE_KEY)).toBe('auto');
  });

  it('sin escritura del VALOR no se pinnea nada (sólo el colchón) — ni entrada de modo', async () => {
    const h = harness({
      settings: { [MODE_KEY]: 'legacy', [RATE_KEY]: 19.0, [SettingKey.FX_BUFFER_PCT]: 3 },
      fxRates: [banxicoRow(18.2)],
    });
    await h.fxCtrl.setManual({ bufferPct: 5 }, 'admin-1', 'super_admin' as never);
    expect(h.rawSetting(MODE_KEY)).toBe('legacy');
    expect(h.auditEntries.filter((e) => e.action === 'fx.mode.change')).toHaveLength(0);
  });

  it('reescribir la tasa con el modo YA explícito no inventa un cambio de modo en la bitácora', async () => {
    const h = harness({
      settings: { [MODE_KEY]: 'manual', [RATE_KEY]: 19.0, [SettingKey.FX_BUFFER_PCT]: 3 },
      fxRates: [banxicoRow(18.2)],
    });
    await h.fxCtrl.setManual({ rate: 20 }, 'admin-1', 'super_admin' as never);
    expect(h.auditEntries.filter((e) => e.action === 'fx.mode.change')).toHaveLength(0);
    expect(h.auditEntries.filter((e) => e.action === 'fx.override')).toHaveLength(1);
    expect(h.rawSetting(MODE_KEY)).toBe('manual');
  });
});

// ── FX-7 — el fallback deja de llamarse `manual` ─────────────────────────────────────────────────

describe('FX-7 — el fallback duro NO se firma como del dueño', () => {
  it('sin FxRate, sin tasa manual y en auto ⇒ source `fallback`, rate 18, automatic.missing', async () => {
    const h = harness({ settings: { [MODE_KEY]: 'auto', [SettingKey.FX_BUFFER_PCT]: 3 }, fxRates: [] });
    const state = await h.fx.getCurrent();
    expect(state.source).toBe('fallback'); // rojo con la conducta de v1.62.2 (`manual`)
    expect(state.rate).toBe(FX_FALLBACK_RATE);
    expect(state.automatic.status).toBe('missing');
    expect(state.automatic.rate).toBeNull();
    expect(state.automatic.ageDays).toBeNull();
    expect(state.automatic.applied).toBe(false);
  });
});

// ── FX-8 — el refresco deja de afirmar un fetch que no ocurrió ────────────────────────────────────

describe('FX-8 — el refresco declara el resultado REAL', () => {
  it('sin BANXICO_SIE_TOKEN ⇒ outcome failed/no_token, fetchedRate null, y la bitácora lo dice', async () => {
    const h = harness({
      settings: { [MODE_KEY]: 'manual', [RATE_KEY]: 19.0, [SettingKey.FX_BUFFER_PCT]: 3 },
      fxRates: [],
      env: {},
    });
    const res = await h.fxCtrl.refresh('usr_admin', 'super_admin' as never);
    expect(res.refresh.outcome).toBe('failed');
    expect(res.refresh.reason).toBe('no_token');
    expect(res.refresh.fetchedRate).toBeNull();
    // El estado devuelto sigue siendo VERDADERO (la llamada completó): 200, no 502.
    expect(res.rate).toBe(19.0);

    const entry = h.auditEntries.filter((e) => e.action === 'fx.refresh').pop() as never as {
      after: { outcome: string; reason: string; fetchedRate: number | null };
    };
    expect(entry.after.outcome).toBe('failed');
    expect(entry.after.reason).toBe('no_token');
    // ⭐ Rojo si la bitácora guarda el valor del override como si Banxico lo hubiera traído.
    expect(entry.after.fetchedRate).toBeNull();
  });

  it('HTTP no-OK ⇒ failed/http_error; payload inválido ⇒ failed/invalid_payload; red ⇒ network_error', async () => {
    const casos: [unknown, string][] = [
      [{ ok: false, status: 503 }, 'http_error'],
      [{ ok: true, json: async () => ({ bmx: { series: [{ datos: [] }] } }) }, 'invalid_payload'],
      ['THROW', 'network_error'],
    ];
    for (const [respuesta, reason] of casos) {
      const h = harness({
        settings: { [MODE_KEY]: 'auto', [SettingKey.FX_BUFFER_PCT]: 3 },
        fxRates: [banxicoRow(18.2)],
        env: { BANXICO_SIE_TOKEN: 'tok' },
      });
      const spy = jest
        .spyOn(global, 'fetch')
        .mockImplementation(async () =>
          respuesta === 'THROW' ? Promise.reject(new Error('ECONNRESET')) : (respuesta as never),
        );
      const res = await h.fx.refreshFromBanxico();
      expect([res.outcome, res.reason]).toEqual(['failed', reason]);
      expect(res.fetchedRate).toBeNull();
      spy.mockRestore();
    }
  });

  it('fetch OK con valor distinto ⇒ updated; con el mismo valor ⇒ unchanged (y NO cambia el modo)', async () => {
    const h = harness({
      settings: { [MODE_KEY]: 'manual', [RATE_KEY]: 19.0, [SettingKey.FX_BUFFER_PCT]: 3 },
      fxRates: [banxicoRow(18.2, daysAgo(1))],
      env: { BANXICO_SIE_TOKEN: 'tok' },
    });
    const spy = jest.spyOn(global, 'fetch').mockImplementation(
      async () =>
        ({
          ok: true,
          json: async () => ({ bmx: { series: [{ datos: [{ dato: '18.5000' }] }] } }),
        }) as never,
    );
    const primera = await h.fx.refreshFromBanxico();
    expect(primera.outcome).toBe('updated');
    expect(primera.fetchedRate).toBe(18.5);

    const segunda = await h.fx.refreshFromBanxico();
    expect(segunda.outcome).toBe('unchanged');
    spy.mockRestore();

    // ⛔ El refresco NO cambia el modo ni toca la tasa manual: sólo refresca la de comparación.
    expect(h.rawSetting(MODE_KEY)).toBe('manual');
    expect(h.rawSetting(RATE_KEY)).toBe(19.0);
    const state = await h.fx.getCurrent();
    expect(state.rate).toBe(19.0);
    expect(state.automatic.rate).toBe(18.5);
  });
});

// ── FX-9 ⭐ — las DOS tasas viajan siempre ────────────────────────────────────────────────────────

describe('FX-9 ⭐ — la precondición de dinero: las dos tasas, lado a lado', () => {
  it('en MANUAL: manual.rate 19.0 Y automatic.rate 18.2, con fecha y edad', async () => {
    const h = harness({
      settings: { [MODE_KEY]: 'manual', [RATE_KEY]: 19.0, [SettingKey.FX_BUFFER_PCT]: 3 },
      fxRates: [banxicoRow(18.2, daysAgo(3))],
    });
    const state = await h.fxCtrl.current();
    expect(state.manual.rate).toBe(19.0);
    expect(state.manual.applied).toBe(true);
    expect(state.automatic.rate).toBe(18.2); // rojo si viene null, ausente, o igual a `rate`
    expect(state.automatic.rate).not.toBe(state.rate);
    expect(state.automatic.effectiveDate).toBe(daysAgo(3).toISOString().slice(0, 10));
    expect(state.automatic.ageDays).toBe(3);
    expect(state.automatic.status).toBe('fresh'); // 3 días es NORMAL (FIX en días hábiles)
    expect(state.automatic.applied).toBe(false);
  });

  it('simétrico en AUTO: manual.rate sigue viajando con el número guardado', async () => {
    const h = harness({
      settings: { [MODE_KEY]: 'auto', [RATE_KEY]: 19.0, [SettingKey.FX_BUFFER_PCT]: 3 },
      fxRates: [banxicoRow(18.2)],
    });
    const state = await h.fxCtrl.current();
    expect(state.manual.rate).toBe(19.0);
    expect(state.manual.applied).toBe(false);
    expect(state.automatic.applied).toBe(true);
    expect(state.rate).toBe(state.automatic.rate);
  });

  it('las dos en las MISMAS unidades: tasa CRUDA, sin colchón, con el colchón al lado', async () => {
    const h = harness({
      settings: { [MODE_KEY]: 'manual', [RATE_KEY]: 19.0, [SettingKey.FX_BUFFER_PCT]: 7 },
      fxRates: [banxicoRow(18.2)],
    });
    const state = await h.fxCtrl.current();
    expect(state.bufferPct).toBe(7);
    expect(state.rate).toBe(19.0); // NO 19 × 1.07
    expect(state.automatic.rate).toBe(18.2); // NO 18.2 × 1.07
  });
});

// ── FX-10 — la frescura no se sella con today() ───────────────────────────────────────────────────

describe('FX-10 — la edad sale de la fila, no del reloj de la respuesta', () => {
  it('única fila banxico de hace 40 días ⇒ ageDays 40 y status stale', async () => {
    const h = harness({
      settings: { [MODE_KEY]: 'auto', [SettingKey.FX_BUFFER_PCT]: 3 },
      fxRates: [banxicoRow(18.2, daysAgo(40))],
    });
    const state = await h.fx.getCurrent();
    expect(state.automatic.effectiveDate).toBe(daysAgo(40).toISOString().slice(0, 10));
    expect(state.automatic.ageDays).toBe(40); // rojo si vale 0 (sellada con today())
    expect(state.automatic.status).toBe('stale');
    // La vitrina NO se bloquea por una tasa vieja: se DECLARA. La tasa sigue rigiendo.
    expect(state.rate).toBe(18.2);
    expect(state.effectiveDate).toBe(state.automatic.effectiveDate);
  });

  it('el umbral es 5 días: 5 es `fresh`, 6 es `stale`', async () => {
    for (const [dias, status] of [
      [FX_AUTO_STALE_AFTER_DAYS, 'fresh'],
      [FX_AUTO_STALE_AFTER_DAYS + 1, 'stale'],
    ] as [number, string][]) {
      const h = harness({
        settings: { [MODE_KEY]: 'auto', [SettingKey.FX_BUFFER_PCT]: 3 },
        fxRates: [banxicoRow(18.2, daysAgo(dias))],
      });
      expect((await h.fx.getCurrent()).automatic.status).toBe(status);
    }
  });
});
