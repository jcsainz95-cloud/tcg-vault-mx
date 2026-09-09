import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { SettingsController } from '../src/modules/settings/settings.controller';
import {
  SETTING_DEFAULTS,
  SettingKey,
  validateFxManualOverrideRate,
} from '../src/modules/settings/settings.constants';
import { FxService, parseBanxicoRate } from '../src/modules/pricing/fx.service';
import { FxController } from '../src/modules/pricing/pricing.controller';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { AuditService } from '../src/modules/audit/audit.service';
import {
  FX_AUTO_STALE_AFTER_DAYS,
  FX_FALLBACK_RATE,
  FX_RATE_BAND_TEXT,
  FX_RATE_MAX,
  FX_RATE_MIN,
  isFxRateInBand,
} from '../src/common/fx-mode';

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
  /**
   * ⭐⭐ S-FX-1 — el gancho que permite ESCALONAR dos peticiones de verdad. Se llama **antes** de cada
   * escritura de `ConfigSetting`; si devuelve una promesa, la transacción se queda ahí **con lo que
   * haya tomado** (incluido el candado). Es la ventana de ~20 ms del PoC, hecha determinista.
   */
  onWrite?: (key: string) => Promise<void> | void;
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
  /**
   * ⭐⭐ v1.63.2b — **las LECTURAS también se anotan, con su handle.** Sin esto, el arnés medía por
   * dónde se ESCRIBE y no por dónde se LEE: cambiar `prepareFxModePin(validated, tx)` por
   * `this.prisma` —o sea, deshacer *la mitad que arregla*— dejaba los 83 verdes.
   */
  const reads: { fuente: 'configSetting' | 'fxRate'; key?: string; inTx: boolean }[] = [];
  /** Ventana `[desde, hasta)` de lecturas de la ÚLTIMA transacción que tomó el candado del FX. */
  const ventanaCandado: { desde: number | null; hasta: number | null } = { desde: null, hasta: null };

  /**
   * ⭐⭐ **El `pg_advisory_xact_lock`, emulado con la MISMA semántica que importa:** exclusión mutua
   * **por transacción**, que se suelta al commit o al rollback. Sin esto, el arnés no puede distinguir
   * «las dos puertas se serializan» de «las dos commitean», que es exactamente S-FX-1.
   */
  const gateQueue: (() => void)[] = [];
  let gateBusy = false;
  const acquireGate = () =>
    new Promise<void>((resolve) => {
      const run = () => {
        gateBusy = true;
        resolve();
      };
      if (!gateBusy) run();
      else gateQueue.push(run);
    });
  const releaseGate = () => {
    gateBusy = false;
    gateQueue.shift()?.();
  };

  /** Estado de UNA transacción del arnés (cada `$transaction` recibe su propio cliente). */
  type TxState = { locked: boolean; snapshot?: () => void };

  const makeClient = (inTx: boolean, tx?: TxState) => ({
    /**
     * Solo entiende el `SELECT pg_advisory_xact_lock(...)` de `lockFxGate`. ⛔ Llamarlo fuera de una
     * transacción es un error de producción, no del arnés: el candado tiene que soltarse con el
     * commit, y fuera de una transacción **no hay commit que lo suelte**.
     */
    $executeRaw: async (..._args: unknown[]) => {
      if (!inTx || !tx) throw new Error('lockFxGate() llamado FUERA de una transacción');
      if (!tx.locked) {
        await acquireGate();
        tx.locked = true;
        // Desde AQUÍ hasta el final de la transacción, toda lectura del estado del FX es una lectura
        // «bajo el candado»: la ventana en la que la decisión de dinero se toma.
        ventanaCandado.desde = reads.length;
        ventanaCandado.hasta = null;
      }
      return 1;
    },
    configSetting: {
      findUnique: async ({ where }: { where: { key: string } }) => {
        reads.push({ fuente: 'configSetting', key: where.key, inTx });
        return settingRows.get(where.key) ?? null;
      },
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
        // El «antes» se congela en la PRIMERA escritura de la transacción, no al abrirla: si se
        // congelara antes de esperar el candado, revertir desharía lo que la otra puerta commiteó
        // mientras esperábamos — un artefacto del arnés que taparía justo lo que se mide.
        tx?.snapshot?.();
        if (seed.onWrite) await seed.onWrite(where.key);
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
        reads.push({ fuente: 'fxRate', inTx });
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

  const prisma = {
    ...client,
    // Revierte DE VERDAD: sin esto, «efecto y bitácora commitean o revierten juntos» sería una
    // frase, no una propiedad medible (FX-5, segundo caso).
    // ⭐⭐ v1.63.2: **cada transacción recibe SU PROPIO cliente**, con su estado de candado. Dos
    // transacciones concurrentes tienen que poder existir a la vez en el arnés, o S-FX-1 no se puede
    // ni escribir.
    $transaction: async (cb: (tx: unknown) => unknown) => {
      const tx: TxState = { locked: false };
      const snap: { settings: Map<string, SettingRow> | null; audit: number; fx: number } = {
        settings: null,
        audit: 0,
        fx: 0,
      };
      tx.snapshot = () => {
        if (snap.settings) return;
        snap.settings = new Map(settingRows);
        snap.audit = auditEntries.length;
        snap.fx = fxRates.length;
      };
      try {
        return await cb(makeClient(true, tx));
      } catch (e) {
        const previas = snap.settings;
        if (previas) {
          settingRows.clear();
          for (const [k, v] of previas) settingRows.set(k, v);
          auditEntries.length = snap.audit;
          fxRates.length = snap.fx;
        }
        throw e;
      } finally {
        if (tx.locked) {
          ventanaCandado.hasta = reads.length;
          releaseGate();
        }
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
    /** ⭐⭐ Las lecturas, con su handle. */
    reads,
    /** ⭐⭐ Las lecturas hechas BAJO el candado del FX, en la última transacción que lo tomó. */
    lecturasBajoCandado: () =>
      ventanaCandado.desde == null
        ? null
        : reads.slice(ventanaCandado.desde, ventanaCandado.hasta ?? reads.length),
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

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// v1.63.2 · **LOS CANDADOS QUE QA ROMPIÓ Y SIGUIERON VERDES**
//
// QA mutó siete cosas y el arnés no se enteró. Cinco eran huecos de cobertura (la conducta de hoy es
// correcta, pero nadie la sostenía) y **dos eran de la clase que este proyecto lleva ocho veces
// cazando: un test que IMPORTA la constante que dice verificar se compara consigo mismo**.
// ══════════════════════════════════════════════════════════════════════════════════════════════════

// ── FX-14 — los rótulos del contrato, escritos con LITERALES ──────────────────────────────────────

/**
 * **El defecto:** `FX-7` y `FX-12` decían `expect(state.rate).toBe(FX_FALLBACK_RATE)` **importando la
 * constante**, y `FX-10` derivaba sus fixtures de `FX_AUTO_STALE_AFTER_DAYS`. Cambiar `18 → 19` o
 * `5 → 10` **dejaba los 43 tests en verde**: el candado medía el rótulo contra sí mismo.
 *
 * ⇒ **Los dos números del contrato se afirman AQUÍ, con literales, una sola vez**, y el resto del
 * fichero usa literales también. *Si el contrato cambia el número, el rojo aparece en el sitio donde
 * está escrito por qué ese número es ése — que es donde tiene que aparecer.*
 */
describe('FX-14 — los dos números del contrato, contra un LITERAL (no contra sí mismos)', () => {
  it('el fallback duro es 18 (§M2-F: «una constante escondida, ni siquiera una tasa real»)', () => {
    expect(FX_FALLBACK_RATE).toBe(18);
  });

  it('el umbral de `stale` es 5 días (el FIX de Banxico es en días hábiles)', () => {
    expect(FX_AUTO_STALE_AFTER_DAYS).toBe(5);
  });

  it('y la CONDUCTA con el literal: sin fila de Banxico, en auto, rige 18', async () => {
    const h = harness({ settings: { [MODE_KEY]: 'auto', [SettingKey.FX_BUFFER_PCT]: 3 }, fxRates: [] });
    const state = await h.fx.getCurrent();
    expect(state.rate).toBe(18); // ⛔ literal a propósito
    expect(state.source).toBe('fallback');
  });

  it('y la del umbral: 5 días es `fresh`, 6 es `stale` — con literales', async () => {
    for (const [dias, status] of [
      [5, 'fresh'],
      [6, 'stale'],
    ] as [number, string][]) {
      const h = harness({
        settings: { [MODE_KEY]: 'auto', [SettingKey.FX_BUFFER_PCT]: 3 },
        fxRates: [banxicoRow(18.2, daysAgo(dias))],
      });
      expect((await h.fx.getCurrent()).automatic.status).toBe(status);
    }
  });
});

// ── FX-15 ⭐ — el pin y el valor, en la MISMA transacción ─────────────────────────────────────────

/**
 * **La mutación que sobrevivía:** sacar el pin de la transacción (`settings.service.ts:353`,
 * `tx.` → `this.prisma.`). El comentario del código promete *«es imposible que quede el número nuevo
 * sin su modo materializado»* — y **nadie lo medía**.
 *
 * Se mide con el handle: el arnés entrega en `$transaction` un cliente **distinto**, así que una
 * escritura por `this.prisma` queda marcada `inTx: false`. **Rojo con una sola escritura fuera.**
 */
describe('FX-15 ⭐ — el pin del modo se materializa DENTRO de la transacción del valor', () => {
  it('PUT /admin/fx { rate } desde `legacy`: las DOS escrituras van por `tx`', async () => {
    const h = harness({
      settings: { [MODE_KEY]: 'legacy', [SettingKey.FX_BUFFER_PCT]: 3 },
      fxRates: [banxicoRow(18.2)],
    });
    await h.fxCtrl.setManual({ rate: 25 }, 'admin-1', 'super_admin' as never);

    const modo = h.writes.filter((w) => w.key === MODE_KEY);
    const valor = h.writes.filter((w) => w.key === RATE_KEY);
    expect(modo.length).toBeGreaterThan(0); // el pin se materializó (si no, no hay nada que medir)
    expect(valor.length).toBeGreaterThan(0);
    expect(h.writes.filter((w) => !w.inTx)).toEqual([]); // ⛔ ninguna fuera
  });

  it('y la bitácora de esa escritura también (efecto y entrada commitean o revierten juntos)', async () => {
    const h = harness({
      settings: { [MODE_KEY]: 'legacy', [SettingKey.FX_BUFFER_PCT]: 3 },
      fxRates: [banxicoRow(18.2)],
    });
    await h.fxCtrl.setManual({ rate: 25 }, 'admin-1', 'super_admin' as never);
    expect(h.auditWrites.length).toBeGreaterThan(0);
    expect(h.auditWrites.filter((a) => !a.inTx)).toEqual([]);
  });
});

// ── FX-16 ⭐ — la bitácora del INTERRUPTOR es transaccional ───────────────────────────────────────

/**
 * **La mutación que sobrevivía:** sacar `opts.audit(...)` de la `$transaction` de
 * `fx.service.ts:264`. `FX-5` cubría la puerta de `settings` (donde el fallo es del upsert), **no la
 * de `fx.service`**, que tiene su propia transacción. §M2-F.2 regla 5 dice *«obligatoria y
 * **transaccional**»*: las dos mitades de esa frase necesitan un candado cada una.
 */
describe('FX-16 ⭐ — `PUT /admin/fx/mode` escribe efecto y bitácora por el MISMO `tx`', () => {
  it('el flip deja la entrada dentro de la transacción, no al lado', async () => {
    const h = harness({
      settings: { [MODE_KEY]: 'manual', [RATE_KEY]: 19.0, [SettingKey.FX_BUFFER_PCT]: 3 },
      fxRates: [banxicoRow(18.2)],
    });
    await h.fxCtrl.setMode({ mode: 'auto' }, 'usr_admin', 'super_admin' as never);

    const modo = h.auditWrites.filter((a) => a.action === 'fx.mode.change');
    expect(modo).toHaveLength(1);
    expect(modo[0]?.inTx).toBe(true);
    expect(h.writes.filter((w) => w.key === MODE_KEY && !w.inTx)).toEqual([]);
  });
});

// ── FX-17 ⭐ — la basura NO resuelve `auto` por su cuenta ─────────────────────────────────────────

/**
 * **La mutación que sobrevivía:** que un valor basura en la fila (`"AUTO"`, `true`, `1`) resolviera
 * `auto` en vez de caer a la **resolución legacy**. `FX-6` solo fixturea `"legacy"` y la fila
 * ausente, así que la rama de basura no la miraba nadie — y §M2-F.1 **nombra esa fila**.
 *
 * ⭐ La distinción es de dinero: con basura y una tasa manual guardada, **legacy dice `manual`** (la
 * conducta de v1.62.2, literal) y `auto` diría Banxico ⇒ **el catálogo entero se movería en un
 * deploy**, que es exactamente lo que I-FX2/FX-6 existen para impedir.
 */
describe('FX-17 ⭐ — un valor no reconocido en `fx_rate_mode` cae a LEGACY, jamás a `auto`', () => {
  const basura: unknown[] = ['AUTO', 'Manual', 'legacy', true, 1, null, {}, ''];

  it.each(basura.map((v) => [JSON.stringify(v) ?? String(v), v] as [string, unknown]))(
    'con tasa manual guardada y la fila valiendo %s ⇒ mode `manual` (from `legacy`)',
    async (_n, valor) => {
      const h = harness({
        settings: { [MODE_KEY]: valor, [RATE_KEY]: 19.0, [SettingKey.FX_BUFFER_PCT]: 3 },
        fxRates: [banxicoRow(18.2)],
        priceRefs: [usdCardRef()],
      });
      const state = await h.fx.getCurrent();
      expect(state.mode).toBe('manual');
      expect(state.modeResolvedFrom).toBe('legacy');
      expect(state.rate).toBe(19.0);
      // ⭐ LA CONDUCTA: el peso que sale es el del manual, no el de Banxico.
      expect(await h.referenceMxnCents()).toBe(expectedMxnCents(1000, 19.0, 3));
    },
  );

  it('y SIN tasa manual, la misma basura resuelve `auto` — también por legacy, no por la fila', async () => {
    for (const valor of basura) {
      const h = harness({
        settings: { [MODE_KEY]: valor, [SettingKey.FX_BUFFER_PCT]: 3 },
        fxRates: [banxicoRow(18.2)],
      });
      const state = await h.fx.getCurrent();
      expect(state.mode).toBe('auto');
      // ⭐ La mitad que mata la mutación: `from` distingue «lo dijo la fila» de «lo dedujo el legacy».
      expect(state.modeResolvedFrom).toBe('legacy');
    }
  });
});

// ── FX-18 ⭐ — `unchanged` SÍ escribe la fila del día ─────────────────────────────────────────────

/**
 * **La mutación que sobrevivía (M-1):** no escribir la fila cuando el `outcome` es `unchanged`.
 * *El párrafo que escribí para defender esa conducta era justo el que nadie podía poner rojo* — y es
 * el que alguien «arreglará» leyendo la tabla del contrato, que solo dice «(se escribió fila)» junto
 * a `updated`.
 *
 * ⭐ **Y es dinero:** el escritor sella `effectiveDate: today()`, así que **no escribir produce un
 * `stale` FALSO garantizado**: Banxico confirma hoy el mismo número, no se escribe fila, y
 * `automatic.ageDays` sigue creciendo hasta que el panel declara vieja **una tasa que acabamos de
 * confirmar**. `outcome` habla del VALOR; la fila habla de CUÁNDO se confirmó.
 */
describe('FX-18 ⭐ — un refresco `unchanged` escribe la fila de hoy igual (o inventa un `stale`)', () => {
  it('misma tasa que ayer ⇒ outcome `unchanged` Y fila de hoy ⇒ ageDays 0, status fresh', async () => {
    const h = harness({
      settings: { [MODE_KEY]: 'auto', [SettingKey.FX_BUFFER_PCT]: 3 },
      fxRates: [banxicoRow(18.5, daysAgo(6))], // ⇒ hoy estaría `stale` si no se escribe
      env: { BANXICO_SIE_TOKEN: 'tok' },
    });
    // Punto de partida: la única fila de Banxico tiene 6 días ⇒ vieja.
    expect((await h.fx.getCurrent()).automatic.status).toBe('stale');

    const spy = jest.spyOn(global, 'fetch').mockImplementation(
      async () =>
        ({ ok: true, json: async () => ({ bmx: { series: [{ datos: [{ dato: '18.5000' }] }] } }) }) as never,
    );
    const res = await h.fx.refreshFromBanxico();
    spy.mockRestore();

    expect(res.outcome).toBe('unchanged'); // el VALOR no cambió…
    const hoy = TODAY.toISOString().slice(0, 10);
    expect(h.fxRates.some((r) => r.source === 'banxico' && r.id === `banxico-${hoy}`)).toBe(true);

    // ⭐ …pero la CONFIRMACIÓN sí, y por eso el panel deja de mentir.
    const state = await h.fx.getCurrent();
    expect(state.automatic.ageDays).toBe(0);
    expect(state.automatic.status).toBe('fresh');
    expect(state.automatic.effectiveDate).toBe(hoy);
  });
});

// ── FX-19 ⭐ — el colchón de la bitácora es el de DESPUÉS ─────────────────────────────────────────

/**
 * **La mutación que sobrevivía (M-2):** `bufferPct: bufferAfter → bufferBefore`. Los fixtures usaban
 * el mismo colchón antes y después, así que la aserción comprobaba **que la clave estaba, no que
 * valiera**. El contrato dice que sin el colchón *«la entrada no permite reconstruir el precio de
 * aquel día»* — una entrada con el colchón EQUIVOCADO reconstruye **otro precio**, que es peor que
 * no tenerlo, porque parece correcta.
 */
describe('FX-19 ⭐ — `before.bufferPct` y `after.bufferPct` son NÚMEROS DISTINTOS cuando el colchón cambia', () => {
  it('PUT /admin/fx { rate, bufferPct: 7 } sobre un colchón de 3 ⇒ before 3, after 7', async () => {
    const h = harness({
      settings: { [MODE_KEY]: 'manual', [RATE_KEY]: 19.0, [SettingKey.FX_BUFFER_PCT]: 3 },
      fxRates: [banxicoRow(18.2)],
    });
    await h.fxCtrl.setManual({ rate: 19.0, bufferPct: 7 }, 'usr_admin', 'super_admin' as never);

    const entry = h.auditEntries.find((e) => e.action === 'fx.override') as never as {
      before: { bufferPct: number; effectiveRate: number };
      after: { bufferPct: number; effectiveRate: number };
    };
    expect(entry.before.bufferPct).toBe(3);
    expect(entry.after.bufferPct).toBe(7); // ⛔ rojo si la entrada guarda el colchón VIEJO
    expect(entry.after.bufferPct).not.toBe(entry.before.bufferPct);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// v1.63.2 · **S-FX-1 / S-FX-2 — LOS DOS HALLAZGOS DEL PENTESTER** (`docs/PENTEST_NOTES.md`)
// ══════════════════════════════════════════════════════════════════════════════════════════════════

// ── FX-20 ⭐⭐ — la carrera entre las dos puertas ─────────────────────────────────────────────────

/**
 * ⭐⭐ **S-FX-1 (CRÍTICA, verificada LIVE-DB): dos peticiones normales que se solapan dejaban el
 * interruptor del dinero en un ESTADO IMPOSIBLE.**
 *
 * `mode:"manual"` con `fx_manual_override_rate = null` cae al **fallback duro de 18**: **−5.26 %
 * instantáneo sobre todo lo que la plataforma compra y vende**, con **las dos peticiones devolviendo
 * 200**, **sin disparar el acuse** y con la bitácora afirmando `19 / manual` mientras el sistema
 * cotiza `18 / fallback`. Y **queda pegado**: el pentester midió que no se auto-corrige y que los dos
 * gestos intuitivos de deshacer dan 422.
 *
 * ### Cómo se mide aquí, y por qué esto SÍ puede ponerse rojo
 * El arnés emula lo único del motor que decide el resultado: **`pg_advisory_xact_lock` es exclusión
 * mutua por transacción**, y el gancho `onWrite` congela a la puerta A **dentro** de su transacción,
 * con lo que haya tomado. Es la ventana de ~20 ms del PoC, hecha determinista.
 *
 * **Verificado por mutación** (quitando `lockFxGate`/la relectura de `settings.service.ts` y
 * `fx.service.ts`): sin el arreglo, las dos commitean, queda `manual` + `null`, `source:"fallback"`,
 * el peso cae a 18 y la entrada de bitácora afirma 19. Con el arreglo, la segunda puerta **espera,
 * vuelve a leer y se niega**.
 */
describe('FX-20 ⭐⭐ — S-FX-1: las dos puertas del FX no pueden cruzarse', () => {
  /** El estado EXACTO del PoC: `auto` con un 19 guardado (lo que deja `PUT /admin/fx {rate:19}`). */
  function conCarrera() {
    let soltar!: () => void;
    const puertaAEnEspera = new Promise<void>((r) => (soltar = r));
    let pausado = false;
    const h = harness({
      settings: { [MODE_KEY]: 'auto', [RATE_KEY]: 19.0, [SettingKey.FX_BUFFER_PCT]: 3 },
      fxRates: [banxicoRow(18.2)],
      priceRefs: [usdCardRef()],
      // La puerta A (borrar el número) se queda congelada justo antes de escribirlo.
      onWrite: async (key) => {
        if (key === RATE_KEY && !pausado) {
          pausado = true;
          await puertaAEnEspera;
        }
      },
    });
    return { h, soltar };
  }

  /** Cede el bucle de eventos unas cuantas veces: suficiente para que la otra puerta arranque. */
  const dejarCorrer = async () => {
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  };

  it('⭐⭐ solapadas, NUNCA queda «manual sin número» — y una de las dos se niega con 422', async () => {
    const { h, soltar } = conCarrera();

    // Puerta A: `PUT /admin/settings { fxManualOverrideRate: null }` — legítima en modo `auto`.
    const puertaA = h.settingsCtrl
      .updateSettings({ fxManualOverrideRate: null }, 'admin-1', 'super_admin' as never)
      .then(
        () => 'ok' as const,
        (e) => e as { code?: string },
      );
    await dejarCorrer(); // A ya entró en su transacción y está congelada dentro

    // Puerta B: `PUT /admin/fx/mode { mode: "manual" }` — legítima mientras el 19 exista.
    const puertaB = h.fxCtrl.setMode({ mode: 'manual' }, 'admin-2', 'super_admin' as never).then(
      () => 'ok' as const,
      (e) => e as { code?: string },
    );
    await dejarCorrer(); // con el arreglo, B está BLOQUEADA en el candado; sin él, ya commiteó

    soltar();
    const [resA, resB] = await Promise.all([puertaA, puertaB]);

    // ⭐⭐ EL INVARIANTE, y es el único que importa: el estado imposible no existe.
    const modo = h.rawSetting(MODE_KEY);
    const tasa = h.rawSetting(RATE_KEY);
    expect(modo === 'manual' && (tasa === null || tasa === undefined)).toBe(false);

    // ⭐ LA CONDUCTA (el dinero): jamás el fallback duro. Rige Banxico (18.2) o el manual (19).
    const estado = await h.fx.getCurrent();
    expect(estado.source).not.toBe('fallback');
    expect(estado.rate).not.toBe(18);
    expect([18.2, 19.0]).toContain(estado.rate);
    expect(await h.referenceMxnCents()).toBe(expectedMxnCents(1000, estado.rate, 3));

    // Exactamente una de las dos puertas se niega, y con el 422 correcto (no un 500).
    const fallos = [resA, resB].filter((r) => r !== 'ok') as { code?: string }[];
    expect(fallos).toHaveLength(1);
    expect(['FX_MANUAL_RATE_MISSING', 'FX_MANUAL_RATE_REQUIRED']).toContain(fallos[0]?.code);
  });

  it('⭐ la bitácora NO puede afirmar un número que no rigió (el no-repudio de S-FX-1)', async () => {
    const { h, soltar } = conCarrera();
    const puertaA = h.settingsCtrl
      .updateSettings({ fxManualOverrideRate: null }, 'admin-1', 'super_admin' as never)
      .catch(() => undefined);
    await dejarCorrer();
    const puertaB = h.fxCtrl
      .setMode({ mode: 'manual' }, 'admin-2', 'super_admin' as never)
      .catch(() => undefined);
    await dejarCorrer();
    soltar();
    await Promise.all([puertaA, puertaB]);

    const vivo = await h.fx.getCurrent();
    const ultima = h.auditEntries
      .filter((e) => e.action === 'fx.mode.change' || e.action === 'fx.override')
      .pop() as never as { after: { effectiveRate: number; source: string } } | undefined;
    // Si quedó entrada, tiene que describir EL ESTADO QUE RIGE. Es la mitad del hallazgo que no es
    // dinero pero sí es peor: un registro que miente no permite reconstruir nada.
    if (ultima) {
      expect(ultima.after.effectiveRate).toBe(vivo.rate);
      expect(ultima.after.source).toBe(vivo.source);
    }
  });

  it('⭐ el candado se toma DENTRO de la transacción, y sólo cuando el FX está en juego', async () => {
    // Estructural, y es la mitad que impide el arreglo de mentira («lo serializo con un mutex del
    // proceso»): un candado de proceso no protege a la segunda instancia del contenedor.
    const h = harness({
      settings: { [MODE_KEY]: 'auto', [RATE_KEY]: 19.0, [SettingKey.FX_BUFFER_PCT]: 3 },
      fxRates: [banxicoRow(18.2)],
    });
    // `$executeRaw` del arnés lanza si lo llaman fuera de una transacción: si alguien saca el
    // `lockFxGate` de su `$transaction`, esto revienta en vez de pasar en verde.
    await h.fxCtrl.setMode({ mode: 'manual' }, 'admin-1', 'super_admin' as never);
    await h.settingsCtrl.updateSettings({ fxManualOverrideRate: 21 }, 'admin-1', 'super_admin' as never);

    // Y un `PUT` que NO toca el FX no se serializa con nadie (no se toma el candado por costumbre).
    await expect(
      h.settingsCtrl.updateSettings({ fxBufferPct: 5 }, 'admin-1', 'super_admin' as never),
    ).resolves.toBeDefined();
  });
});

// ── FX-21 ⭐ — la banda de cordura de la tasa de Banxico ──────────────────────────────────────────

/**
 * ⭐ **S-FX-2 (ALTA):** la tasa **tecleada** estaba acotada a `(0, 1000]` y la que **llega de
 * Banxico** —la que en modo `auto` rige sin que nadie la mire— solo se comprobaba `isFinite && > 0`.
 * Y el parser leía `"19,5"` como **195**: un ×10 en todo el catálogo por un separador decimal.
 */
describe('FX-21 ⭐ — la tasa de Banxico se valida como la tecleada, y el parser no adivina', () => {
  it.each([
    ['18.5000', 18.5],
    ['1.000000', 1], // el extremo inferior, CERRADO (v1.63.4)
    ['999.9999', 999.9999],
    ['1,000.0000', 1000], // coma de millares legítima, y el extremo superior CERRADO
  ] as [string, number][])('formato SIE válido `%s` se lee como %s', (raw, esperado) => {
    const r = parseBanxicoRate(raw);
    expect(r.ok && r.rate).toBe(esperado);
  });

  /**
   * ⚠️ **v1.63.4 (`FX-24`) — este caso se reescribió, y el porqué importa.**
   *
   * Antes decía `parseBanxicoRate(raw, 100_000)` con vectores `'1,234.5678'` y `'0.0001'`: subía el
   * techo **por llamada** para poder afirmar «el formato se entiende» sin que la banda estorbara. Con
   * el piso puesto, `0.0001` **ya no entra con ningún techo**, y el parámetro `maxRate` desapareció
   * porque *un tope por llamada es una segunda banda con otro nombre*.
   *
   * La afirmación que aquel caso quería hacer —**el formato SIE se entiende aunque el número no
   * valga**— se hace mejor **sin tocar la banda**: mirando el `why`. `format` significa «no sé qué
   * número me diste»; `out_of_band` significa «lo leí perfectamente y no es una tasa».
   */
  it.each([
    ['1,234.5678', 'out_of_band'], // formato SIE legítimo, número fuera de banda por arriba
    ['0.0001', 'out_of_band'], // ⭐ y por ABAJO: el hueco que v1.63.4 cierra
    ['19,5', 'format'], // coma DECIMAL: no se adivina que quería decir 19.5
  ] as [string, string][])('`%s` se rechaza por `%s` (leer bien ≠ aceptar)', (raw, why) => {
    const r = parseBanxicoRate(raw);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.why).toBe(why);
  });

  it('el espacio sobrante SÍ se tolera (`" 18.5 "` es 18.5): es ruido de transporte, no formato', () => {
    expect(parseBanxicoRate(' 18.5 ')).toEqual({ ok: true, rate: 18.5 });
  });

  it.each(['19,5', '2,000,000', '1,2,3', '1e9', 'abc', 'Infinity', '-5', '', '  ', '1 8.5', null, 18.5])(
    '⛔ `%s` NO se interpreta: se rechaza en vez de adivinar',
    (raw) => {
      // ⭐ `"19,5"` es EL caso del hallazgo: con `replace(',', '')` daba 195. Adivinar que quería
      // decir 19.5 es cómo se cuela un ×10; si Banxico cambia de formato hay que enterarse por un
      // `failed`, no por el precio.
      expect(parseBanxicoRate(raw as never).ok).toBe(false);
    },
  );

  it('⛔ fuera de banda `[1, 1000]`: `9999` se rechaza (×549 en el catálogo, sin desbordar nada)', () => {
    const r = parseBanxicoRate('9999');
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.why).toBe('out_of_band');
    expect(parseBanxicoRate('1000').ok).toBe(true); // el borde SÍ entra (misma banda que la manual)
    expect(parseBanxicoRate('1000.0001').ok).toBe(false);
    // ⭐ v1.63.4 — y el otro borde, que hasta v1.63.3 no existía.
    expect(parseBanxicoRate('1').ok).toBe(true);
    expect(parseBanxicoRate('0.999999').ok).toBe(false);
  });

  it('⭐ LA CONDUCTA: un payload fuera de banda deja `failed/invalid_payload` y NO escribe fila', async () => {
    const h = harness({
      settings: { [MODE_KEY]: 'auto', [SettingKey.FX_BUFFER_PCT]: 3 },
      fxRates: [banxicoRow(18.2)],
      priceRefs: [usdCardRef()],
      env: { BANXICO_SIE_TOKEN: 'tok' },
    });
    const antes = await h.referenceMxnCents();
    const spy = jest.spyOn(global, 'fetch').mockImplementation(
      async () =>
        ({ ok: true, json: async () => ({ bmx: { series: [{ datos: [{ dato: '9999' }] }] } }) }) as never,
    );
    const res = await h.fx.refreshFromBanxico();
    spy.mockRestore();

    expect([res.outcome, res.reason]).toEqual(['failed', 'invalid_payload']);
    expect(res.fetchedRate).toBeNull();
    // ⭐ Ni una fila nueva, ni un peso movido: la tasa anterior sigue rigiendo.
    expect(h.fxRates.filter((r) => r.source === 'banxico')).toHaveLength(1);
    expect(await h.referenceMxnCents()).toBe(antes);
  });

  it('⭐ y el ×10 del separador: `19,5` tampoco entra (antes se guardaba como 195)', async () => {
    const h = harness({
      settings: { [MODE_KEY]: 'auto', [SettingKey.FX_BUFFER_PCT]: 3 },
      fxRates: [banxicoRow(18.2)],
      priceRefs: [usdCardRef()],
      env: { BANXICO_SIE_TOKEN: 'tok' },
    });
    const spy = jest.spyOn(global, 'fetch').mockImplementation(
      async () =>
        ({ ok: true, json: async () => ({ bmx: { series: [{ datos: [{ dato: '19,5' }] }] } }) }) as never,
    );
    const res = await h.fx.refreshFromBanxico();
    spy.mockRestore();
    expect(res.outcome).toBe('failed');
    expect((await h.fx.getCurrent()).automatic.rate).toBe(18.2); // ⛔ jamás 195
  });
});

// ── FX-22 ⭐⭐ — bajo el candado se lee POR EL MISMO HANDLE que escribe ───────────────────────────

/**
 * ⭐⭐ **El hueco que encontró el coordinador, y la explicación honesta de por qué existía.**
 *
 * FX-20 mide **el ORDEN** (leer *después* de tomar el candado) y lo mide bien: mover la lectura otra
 * vez fuera de la transacción —dejando el candado puesto— **la pone roja**. Lo que no medía nadie es
 * el **HANDLE**: cambiar `prepareFxModePin(validated, tx)` por `this.prisma` dejaba los 83 en verde.
 *
 * ### ⚠️ Y hay que decir por qué, porque no es un descuido del arnés
 * En **Postgres READ COMMITTED** —el nivel por defecto, y el que usa `$transaction` si no se pide
 * otro— una lectura por **otra conexión**, hecha **después** de adquirir el candado, ve **lo mismo**
 * que una lectura por el `tx`: el estado commiteado en ese instante. **El arnés estaba en lo cierto al
 * quedarse verde**: cambiar solo el handle, conservando el orden, *no* reabre S-FX-1 con este nivel de
 * aislamiento. Lo que arregla es **cuándo** se lee; el handle es la otra mitad de la disciplina.
 *
 * ### Entonces, ¿por qué esto es un candado y no una manía?
 * Porque el handle **sí** decide en dos casos que este código puede alcanzar sin avisar:
 * 1. **Lecturas propias:** en cuanto una ruta lea el estado *después* de haber escrito algo en su
 *    transacción, `this.prisma` **no verá su propia escritura** y validará contra un estado que ya no
 *    existe ni fuera ni dentro. Hoy no pasa **por orden de las líneas**, que es una garantía frágil.
 * 2. **Aislamiento:** si alguien pone `isolationLevel: 'Serializable'` en esa `$transaction` —una
 *    línea, y suena a mejora—, con el handle de fuera la lectura y la escritura pasan a vivir en
 *    **snapshots distintos**, y ahí sí se pierde la relación que el candado protege.
 *
 * ⇒ **Se mide lo que se puede medir sin mentir:** *bajo el candado, el estado del FX se lee por el
 * mismo handle que lo escribe.* ⛔ **No** se ha falseado el arnés para que una lectura de fuera
 * devuelva datos rancios: eso modelaría un Postgres que no existe (sería REPEATABLE READ) y mandaría
 * al siguiente a perseguir un fallo que el motor no comete. *Un arnés que miente en la otra dirección
 * cuesta lo mismo que uno que no mide.*
 */
describe('FX-22 ⭐⭐ — la lectura que decide va por el `tx` del candado, no por el cliente de fuera', () => {
  it('`PUT /admin/settings { fxManualOverrideRate }`: TODA lectura bajo el candado es del `tx`', async () => {
    const h = harness({
      settings: { [MODE_KEY]: 'legacy', [SettingKey.FX_BUFFER_PCT]: 3 },
      fxRates: [banxicoRow(18.2)],
    });
    await h.settingsCtrl.updateSettings({ fxManualOverrideRate: 21 }, 'admin-1', 'super_admin' as never);

    const bajoCandado = h.lecturasBajoCandado();
    expect(bajoCandado).not.toBeNull();
    // Si no hay ninguna lectura en la ventana, el candado no está protegiendo ninguna decisión: sería
    // un candado decorativo, y este test tiene que caer también en ese caso.
    expect(bajoCandado?.length).toBeGreaterThanOrEqual(3); // modo + tasa + colchón (+ FxRate)
    expect(bajoCandado?.filter((r) => !r.inTx)).toEqual([]);
  });

  it('`PUT /admin/fx/mode`: lo mismo por la otra puerta', async () => {
    const h = harness({
      settings: { [MODE_KEY]: 'manual', [RATE_KEY]: 19.0, [SettingKey.FX_BUFFER_PCT]: 3 },
      fxRates: [banxicoRow(18.2)],
    });
    await h.fxCtrl.setMode({ mode: 'auto' }, 'admin-1', 'super_admin' as never);

    const bajoCandado = h.lecturasBajoCandado();
    expect(bajoCandado?.length).toBeGreaterThanOrEqual(3);
    expect(bajoCandado?.filter((r) => !r.inTx)).toEqual([]);
  });

  it('CONTROL: una lectura pura (`GET /admin/fx`) NO toma el candado ni pretende ir por un `tx`', () => {
    // La disciplina es de las ESCRITURAS. Serializar los `GET` sería pagar contención por costumbre.
    const h = harness({
      settings: { [MODE_KEY]: 'auto', [SettingKey.FX_BUFFER_PCT]: 3 },
      fxRates: [banxicoRow(18.2)],
    });
    return h.fx.getCurrent().then(() => {
      expect(h.lecturasBajoCandado()).toBeNull(); // nunca se abrió una ventana
      expect(h.reads.length).toBeGreaterThan(0);
      expect(h.reads.every((r) => !r.inTx)).toBe(true);
    });
  });
});

// ── FX-R2 ⭐⭐ — EL COLCHÓN ES LA CUARTA PUERTA (R2 del techlead, v1.63.3) ───────────────────────

/**
 * ⚠️ **v1.63.4 — ESTE BLOQUE SE LLAMABA `FX-24`, Y HUBO QUE RENOMBRARLO.**
 *
 * `FX-24` era una etiqueta **local de backend** (nació de la condición **R2** del techlead, no del
 * contrato). En v1.63.4 el **arquitecto** asignó `FX-24` al candado de **la banda `[1, 1000]`**
 * (§M2-F.6). Dos bloques con el mismo identificador en el mismo fichero es exactamente cómo un
 * hallazgo se enruta al candado equivocado, así que el local cede el nombre y pasa a `FX-R2`:
 * **los identificadores de candado los pone el contrato; los locales llevan otro prefijo.**
 * (Lo mismo vale para `FX-21`, etiqueta local de `S-FX-2`, hoy absorbida por `FX-24(a)`.)
 */

/**
 * ⭐⭐ **La cuarta puerta, y estaba abierta en la única ruta donde el código prometía que no.**
 *
 * `tocaElFx` solo miraba `fx_manual_override_rate`, así que un `PUT` que **solo** movía el colchón
 * **no tomaba `lockFxGate`** y auditaba con una foto leída **fuera de toda transacción**. Y el colchón
 * no es un dial cualquiera: **el precio convertido es `tasa × (1 + colchón)`**, y por eso
 * `FxAuditState` lo lleva — *sin el colchón la entrada no permite reconstruir el precio de aquel día*.
 *
 * ⇒ Un `PUT /admin/fx/mode` concurrente commitea en esa ventana y la entrada `fx.override` queda
 * afirmando un `mode`/`effectiveRate`/`source` **que nunca coexistieron con ese colchón**. Es `S-FX-1`
 * en miniatura, por la cuarta puerta.
 *
 * **Las tres mitades que hacen falta, y ninguna basta sola:**
 * 1. **la puerta se toma** aunque el `PUT` traiga solo el colchón;
 * 2. **se lee bajo ella y por el `tx`** (si no, serializar solo mueve el estado imposible más tarde);
 * 3. **la bitácora se proyecta desde esa lectura**, no desde la de antes de entrar.
 *
 * ⛔ Y la mitad que impide «arreglarlo» de más: tomar la puerta **no** convierte el `PUT` del colchón
 * en una escritura del modo. I-FX2 dice *«toda escritura DEL VALOR pinnea»*, no *«toda llamada que
 * tome la puerta»*: si el colchón materializara el modo, mover un colchón en un entorno `legacy`
 * escribiría `fx_rate_mode` sin que nadie tocara el interruptor.
 */
describe('FX-R2 ⭐⭐ — el colchón toma la puerta del FX, lee bajo ella y audita con esa lectura', () => {
  it('`PUT /admin/fx { bufferPct }` (SOLO el colchón) toma el candado y lee TODO por el `tx`', async () => {
    const h = harness({
      settings: { [MODE_KEY]: 'manual', [RATE_KEY]: 19.0, [SettingKey.FX_BUFFER_PCT]: 3 },
      fxRates: [banxicoRow(18.2)],
    });
    await h.fxCtrl.setManual({ bufferPct: 7 }, 'admin-1', 'super_admin' as never);

    const bajoCandado = h.lecturasBajoCandado();
    // Rojo si la puerta no se abrió: sin candado, `lecturasBajoCandado()` devuelve `null`.
    expect(bajoCandado).not.toBeNull();
    // Y rojo si se abrió pero no protege ninguna decisión (un candado decorativo).
    expect(bajoCandado?.length).toBeGreaterThanOrEqual(3); // modo + tasa + colchón (+ FxRate)
    expect(bajoCandado?.filter((r) => !r.inTx)).toEqual([]);
  });

  it('⭐ la entrada `fx.override` describe el estado que coexistió con ese colchón', async () => {
    const h = harness({
      settings: { [MODE_KEY]: 'manual', [RATE_KEY]: 19.0, [SettingKey.FX_BUFFER_PCT]: 3 },
      fxRates: [banxicoRow(18.2)],
    });
    await h.fxCtrl.setManual({ bufferPct: 7 }, 'admin-1', 'super_admin' as never);

    const entry = h.auditEntries.filter((e) => e.action === 'fx.override').pop() as never as {
      before: { bufferPct: number; effectiveRate: number; mode: string; source: string };
      after: { bufferPct: number; effectiveRate: number; mode: string; source: string; applied: boolean };
    };
    expect(entry).toBeDefined();
    // El colchón, que es la mitad del precio: 3 → 7, con los dos lados escritos.
    expect(entry.before.bufferPct).toBe(3);
    expect(entry.after.bufferPct).toBe(7);
    // Y el resto del estado, coherente con el que rige de verdad: no se movió el modo ni la tasa.
    expect(entry.after.mode).toBe('manual');
    expect(entry.after.source).toBe('manual');
    expect(entry.after.effectiveRate).toBe(19.0);
    expect(entry.after.applied).toBe(true);
  });

  it('⛔ CONTROL — mover el colchón NO pinnea el modo: la puerta no es una escritura del valor', async () => {
    // El entorno arranca en `legacy` (nadie ha tocado el interruptor). Si tomar la puerta bastara
    // para materializar, un `PUT` de colchón escribiría `fx_rate_mode` a espaldas del dueño.
    const h = harness({
      settings: { [MODE_KEY]: 'legacy', [RATE_KEY]: 19.0, [SettingKey.FX_BUFFER_PCT]: 3 },
      fxRates: [banxicoRow(18.2)],
    });
    await h.fxCtrl.setManual({ bufferPct: 7 }, 'admin-1', 'super_admin' as never);

    expect(h.rawSetting(MODE_KEY)).toBe('legacy'); // ⛔ intacto
    expect(h.auditEntries.filter((e) => e.action === 'fx.mode.change')).toHaveLength(0);
    expect(h.rawSetting(SettingKey.FX_BUFFER_PCT)).toBe(7); // y el dial sí se escribió
  });

  it('⭐ y la fila forense `FxRate` congela el colchón LEÍDO BAJO LA PUERTA, no una cuarta lectura', async () => {
    // `setManual` leía el colchón una CUARTA vez, por `this.prisma` y ya fuera de la transacción, solo
    // para congelarlo en la fila forense. No regía nada, pero eran cuatro valores del mismo dial en
    // una sola petición — y el que se guardaba para la posteridad era el de fuera.
    const h = harness({
      settings: { [MODE_KEY]: 'manual', [RATE_KEY]: 19.0, [SettingKey.FX_BUFFER_PCT]: 3 },
      fxRates: [banxicoRow(18.2)],
    });
    await h.fxCtrl.setManual({ rate: 21 }, 'admin-1', 'super_admin' as never);

    const forense = h.fxRates.filter((r) => r.source === 'manual').pop();
    expect(forense).toBeDefined();
    expect(Number(forense?.bufferPct)).toBe(3);
    // Y ninguna lectura de `ConfigSetting` fuera de transacción después de abrirse la ventana: la
    // cuarta lectura era exactamente eso.
    const bajoCandado = h.lecturasBajoCandado();
    expect(bajoCandado?.filter((r) => !r.inTx)).toEqual([]);
  });
});

// ── FX-24 ⭐⭐ — EL PISO DE LA BANDA: `[1, 1000]`, UNA sola, para las DOS puertas ─────────────────

/**
 * ⭐⭐ **`FX-24`** (API_CONTRACT `§M2-F.6` · `§M2-F.8` · ARCHITECTURE `§4.43c-quinquies` · `D-FX-4`).
 *
 * **La mutación que esto pone en rojo:** *quitar el PISO de cualquiera de las dos puertas* —volver a
 * `n <= 0` en `parseBanxicoRate` o a `v > 0` en `validateFxManualOverrideRate`—, **o poner el piso en
 * una sola**. Esa última es la mutación **realista**, porque el arreglo se hace en dos ficheros.
 *
 * ### Son TRES cosas, y la que se olvida es la segunda
 * **(a) La banda**, vector a vector, en las DOS puertas y con el **MISMO veredicto**.
 * **(b) La PARIDAD, asertada como IDENTIDAD** —`parseBanxicoRate(String(v)).ok ===
 * (validateFxManualOverrideRate(v) === null)`— y ⛔ **no como dos copias de la misma lista**: dos
 * listas se pueden actualizar por separado, que es exactamente la divergencia que se quiere impedir.
 * **(c) La CONDUCTA**, que es lo que mide el dinero: `"0.0001"` de Banxico no puede mover el precio.
 *
 * ### Por qué el piso es `1` (y no 5, ni 10)
 * **El peso nunca ha valido más que el dólar.** El par se cotiza en pesos por dólar y ha vivido entre
 * ~3 y ~25. Por debajo de `1` el número **no es el par**: es su **inversa** (≈`0.0526`, el vector más
 * plausible — la fuente publica el par al revés), un error de escala o basura truncada. Y no se
 * aprieta más porque lo que saca al peso de rango es una crisis, que lo hace **más débil** (número
 * más alto): un piso apretado nunca serviría para lo que se le pediría.
 */
describe('FX-24 ⭐⭐ — la banda `[1, 1000]` es UNA, y las dos puertas la aplican igual', () => {
  /** (a) Vectores del contrato. `ok` = lo que las DOS puertas deben decir. */
  const VECTORES: [number, boolean][] = [
    [1e-7, false],
    [0.0001, false],
    [0.05, false], // ⭐ la INVERSA del par: el vector más plausible del hallazgo
    [0.999999, false],
    [0, false],
    [1, true], // ⭐ extremo inferior, CERRADO
    [18.5, true],
    [999.9999, true],
    [1000, true], // extremo superior, CERRADO
    [1000.0001, false],
    [9999, false],
  ];

  describe('(a) la banda, vector a vector, en las DOS puertas', () => {
    it.each(VECTORES)('la puerta TECLEADA veredicta `%s` como ok=%s', (v, ok) => {
      expect(validateFxManualOverrideRate(v) === null).toBe(ok);
    });

    it.each(VECTORES)('la puerta de BANXICO veredicta `%s` como ok=%s', (v, ok) => {
      expect(parseBanxicoRate(String(v)).ok).toBe(ok);
    });

    it('la puerta tecleada acepta ADEMÁS `null` (borra el override) y rechaza -1/NaN/Infinity', () => {
      expect(validateFxManualOverrideRate(null)).toBeNull();
      for (const malo of [-1, NaN, Infinity, -Infinity]) {
        expect(validateFxManualOverrideRate(malo)).not.toBeNull();
      }
    });
  });

  /**
   * ⭐⭐ **(b) LA PARIDAD, Y ES UNA IDENTIDAD.**
   *
   * ⛔ No se comparan dos listas escritas a mano: se compara **una puerta contra la otra**, vector a
   * vector. Ponerle piso a una sola —la mutación realista— la pone roja **de inmediato y en el
   * extremo que se haya olvidado**, sin que nadie tenga que acordarse de actualizar dos sitios.
   *
   * ⚠️ **El MOTIVO puede diferir y eso NO es rojo:** `1e-7` sale `format` (no es expresable en SIE) y
   * `0.05` sale `out_of_band`. **Lo normativo es el VEREDICTO.**
   */
  it('⭐⭐ (b) PARIDAD como IDENTIDAD: ninguna puerta es más permisiva que la otra', () => {
    const universo = [
      ...VECTORES.map(([v]) => v),
      -1, NaN, Infinity, 0.5, 0.9999999, 1.000001, 2, 17, 18, 18.2431, 25, 100, 500, 1001, 1e9,
    ];
    for (const v of universo) {
      expect({ v, ok: parseBanxicoRate(String(v)).ok }).toEqual({
        v,
        ok: validateFxManualOverrideRate(v) === null,
      });
    }
  });

  /**
   * ⭐⭐ **(c) LA CONDUCTA — el mismo patrón que `FX-20(e)`: se mide EL PESO, no el rótulo.**
   *
   * Con la banda sin piso, `"0.0001"` entraba, se escribía la fila y una carta de **USD 100** pasaba
   * de **MX$ 1,879** a **MX$ 0.01** en la siguiente lectura de precio. *No daba error: daba precios.*
   */
  it('⭐⭐ (c) `"0.0001"` de Banxico: `failed/invalid_payload`, NI UNA fila, y el precio NO se mueve', async () => {
    const h = harness({
      settings: { [MODE_KEY]: 'auto', [SettingKey.FX_BUFFER_PCT]: 3 },
      fxRates: [banxicoRow(18.2431)],
      priceRefs: [{ ...usdCardRef(), priceUsdCents: 100_00 }], // USD 100.00
      env: { BANXICO_SIE_TOKEN: 'tok' },
    });
    const antes = await h.referenceMxnCents();
    expect(antes).toBe(expectedMxnCents(100_00, 18.2431, 3)); // ≈ MX$ 1,879

    const spy = jest.spyOn(global, 'fetch').mockImplementation(
      async () =>
        ({ ok: true, json: async () => ({ bmx: { series: [{ datos: [{ dato: '0.0001' }] }] } }) }) as never,
    );
    const res = await h.fx.refreshFromBanxico();
    spy.mockRestore();

    expect([res.outcome, res.reason]).toEqual(['failed', 'invalid_payload']);
    expect(res.fetchedRate).toBeNull();
    // ⛔ Ninguna fila escrita: la tasa anterior se queda EN SU SITIO.
    expect(h.fxRates.filter((r) => r.source === 'banxico')).toHaveLength(1);
    expect((await h.fx.getCurrent()).automatic.rate).toBe(18.2431);
    // ⭐⭐ Y EL DINERO: el precio NO se desploma. Con `0.0001` sería ≈MX$ 0.01.
    expect(await h.referenceMxnCents()).toBe(antes);
    expect(await h.referenceMxnCents()).toBeGreaterThan(100_00);
  });

  /** ⭐ (d) El `message` del `422` NOMBRA LOS DOS EXTREMOS. Hasta v1.63.3 sólo nombraba el techo. */
  it('⭐ (d) el `422` de la puerta tecleada nombra los DOS extremos de la banda', async () => {
    const msg = validateFxManualOverrideRate(0.05);
    expect(msg).not.toBeNull();
    expect(msg).toContain(String(FX_RATE_MIN));
    expect(msg).toContain(String(FX_RATE_MAX));
    expect(msg).toContain(FX_RATE_BAND_TEXT);

    // Y por HTTP, con el código del contrato: `422 VALIDATION_ERROR`, sin escritura parcial.
    const h = harness({ settings: { [MODE_KEY]: 'manual', [RATE_KEY]: 19.0 } });
    await expect(
      h.fxCtrl.setManual({ rate: 0.05 } as never, 'admin-1', 'super_admin' as never),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(h.rawSetting(RATE_KEY)).toBe(19.0); // ⛔ intacto

    await expect(
      h.settingsCtrl.updateSettings({ fxManualOverrideRate: 0.05 }, 'admin-1', 'super_admin' as never),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(h.rawSetting(RATE_KEY)).toBe(19.0);
  });

  /**
   * ⭐ **(e) `1 ≤ FX_FALLBACK_RATE ≤ 1000`.** *Una banda que excluyera la constante que el propio
   * sistema aplica sería un sistema que rechaza lo que él mismo hace regir.*
   */
  it('⭐ (e) el respaldo duro vive DENTRO de la banda', () => {
    expect(isFxRateInBand(FX_FALLBACK_RATE)).toBe(true);
    expect(FX_FALLBACK_RATE).toBeGreaterThanOrEqual(FX_RATE_MIN);
    expect(FX_FALLBACK_RATE).toBeLessThanOrEqual(FX_RATE_MAX);
  });

  /**
   * ⛔⛔ **CONTROL — LA BANDA ES PUERTA DE ESCRITURA, NO DE LECTURA (§M2-F.8, normativo).**
   *
   * Si el piso se colara en `parseManualRate` (la resolución legacy), en un entorno con un valor
   * **sub-piso ya guardado** el modo saltaría de `manual` a `auto` **en el primer `GET` tras el
   * deploy** — el sistema cambiando de conducta por su cuenta, que es lo que `FX-6` existe para poner
   * en rojo. Y la lectura **tampoco se defiende**, a diferencia de la 4.ª fila de §M2-F.1: allí no
   * había número; aquí **lo puso un humano**, e ignorarlo sería un **repreciado sin autor**.
   */
  it('⛔ CONTROL — un `0.5` YA GUARDADO se sigue OBEDECIENDO: la lectura no aplica la banda', async () => {
    const h = harness({
      settings: { [MODE_KEY]: 'legacy', [RATE_KEY]: 0.5, [SettingKey.FX_BUFFER_PCT]: 3 },
      fxRates: [banxicoRow(18.2431)],
      priceRefs: [usdCardRef()],
    });
    const state = await h.fxCtrl.current();
    // ⛔ Rojo si el modo salta a `auto`: sería el deploy repreciando el catálogo solo.
    expect(state.mode).toBe('manual');
    expect(state.modeResolvedFrom).toBe('legacy');
    expect(state.rate).toBe(0.5);
    expect(state.source).toBe('manual');
    expect(state.manual.applied).toBe(true);
    // Y el dinero obedece al número del humano, absurdo y todo — ruidoso por construcción.
    expect(await h.referenceMxnCents()).toBe(expectedMxnCents(1000, 0.5, 3));
    // ⭐ Pero la ESCRITURA sí lo rechaza: se corrige por la puerta normal, no por una migración.
    expect(validateFxManualOverrideRate(0.5)).not.toBeNull();
  });
});

// ── FX-25 ⭐ — `fallbackRate` viaja SIEMPRE, en las CUATRO rutas ──────────────────────────────────

/**
 * ⭐ **`FX-25`** (API_CONTRACT `§M2-F.6` · `§M2-F.3` regla 6 · ARCHITECTURE `§4.43d-bis` · `D-FX-5`).
 *
 * **La mutación que esto pone en rojo:** que `fallbackRate` **no viaje**, que viaje **sólo a veces**
 * (p. ej. sólo con `status:"missing"`), o que **discrepe** del que va en el `422`.
 *
 * ### Por qué existe el campo (y no es cosmético)
 * El diálogo del acuse (`DESIGN_SYSTEM §30.8`) tiene que **nombrar este número ANTES de que el humano
 * toque nada**, y hasta v1.63.3 **sólo existía dentro del `422`** ⇒ la pantalla mandaba un `PUT` sin
 * acuse **sólo para leer el error**. *Un dato que la norma exige enseñar antes de actuar no puede
 * vivir sólo en la respuesta a un acto.*
 *
 * ⭐ **La mitad que se olvida es la (b):** el `422` **sigue llevando su `details` completo**. *«Ya
 * viaja en el DTO»* **no** es razón para adelgazarlo: ese error es **la carrera real** —la fila de
 * Banxico desaparece entre el `GET` y el `PUT`— y *un error de dinero tiene que poder explicarse
 * solo, sin depender de una lectura anterior que puede estar rancia*.
 */
describe('FX-25 ⭐ — el respaldo se publica, y viaja SIEMPRE', () => {
  const conBanxico = () =>
    harness({
      settings: { [MODE_KEY]: 'auto', [SettingKey.FX_BUFFER_PCT]: 3 },
      fxRates: [banxicoRow(18.2431)],
      priceRefs: [usdCardRef()],
      env: { BANXICO_SIE_TOKEN: 'tok' },
    });

  /**
   * (a) **LAS CUATRO RUTAS.** ⛔ No se comprueba sólo el `GET`: el punto de que `projectFxState` sea
   * la única constructora del DTO es que las cuatro salgan iguales, y eso hay que **medirlo**.
   */
  it('⭐ (a) las CUATRO rutas traen `fallbackRate === 18`', async () => {
    const h = conBanxico();

    expect((await h.fxCtrl.current()).fallbackRate).toBe(FX_FALLBACK_RATE);
    expect(
      (await h.fxCtrl.setManual({ rate: 21 } as never, 'admin-1', 'super_admin' as never)).fallbackRate,
    ).toBe(FX_FALLBACK_RATE);
    expect(
      (await h.fxCtrl.setMode({ mode: 'manual' }, 'admin-1', 'super_admin' as never)).fallbackRate,
    ).toBe(FX_FALLBACK_RATE);

    const spy = jest.spyOn(global, 'fetch').mockImplementation(
      async () =>
        ({ ok: true, json: async () => ({ bmx: { series: [{ datos: [{ dato: '18.5000' }] }] } }) }) as never,
    );
    const refrescado = await h.fxCtrl.refresh('admin-1', 'super_admin' as never);
    spy.mockRestore();
    expect(refrescado.fallbackRate).toBe(FX_FALLBACK_RATE);
    // ⭐ y el bloque `refresh` de §M2-F.5 sigue encima, sin haber desplazado nada.
    expect(refrescado.refresh.outcome).toBe('updated');
  });

  /**
   * (a-bis) **EN LOS TRES ESTADOS LEGALES** — *rojo si aparece sólo cuando hace falta*. Un campo que
   * aparece y desaparece obliga a ramificar por presencia **y parece estado, que no lo es**.
   */
  it('⭐ (a-bis) en los TRES estados legales: manual con número, auto fresh, y auto sin fila', async () => {
    const manual = harness({ settings: { [MODE_KEY]: 'manual', [RATE_KEY]: 19.0, [SettingKey.FX_BUFFER_PCT]: 3 }, fxRates: [banxicoRow(18.2431)] });
    const s1 = await manual.fxCtrl.current();
    expect([s1.source, s1.fallbackRate]).toEqual(['manual', FX_FALLBACK_RATE]);

    const auto = conBanxico();
    const s2 = await auto.fxCtrl.current();
    expect([s2.source, s2.automatic.status, s2.fallbackRate]).toEqual(['banxico', 'fresh', FX_FALLBACK_RATE]);

    const sinFila = harness({ settings: { [MODE_KEY]: 'auto', [SettingKey.FX_BUFFER_PCT]: 3 }, fxRates: [] });
    const s3 = await sinFila.fxCtrl.current();
    expect([s3.source, s3.automatic.status, s3.fallbackRate]).toEqual(['fallback', 'missing', FX_FALLBACK_RATE]);
  });

  /**
   * ⭐⭐ **(b) LA IDENTIDAD CON EL ERROR, y el `details` NO se adelgaza.**
   * `details.fallbackRate === (GET /admin/fx).fallbackRate`, siempre y por construcción.
   */
  it('⭐⭐ (b) el `422 FX_NO_AUTOMATIC_RATE` sigue trayendo su `details`, y coincide con el DTO', async () => {
    const h = harness({
      settings: { [MODE_KEY]: 'manual', [RATE_KEY]: 19.0, [SettingKey.FX_BUFFER_PCT]: 3 },
      fxRates: [],
      priceRefs: [usdCardRef()],
    });
    const delDto = (await h.fxCtrl.current()).fallbackRate;

    const err = await h.fxCtrl
      .setMode({ mode: 'auto' }, 'admin-1', 'super_admin' as never)
      .then(() => null, (e) => e as { code: string; details: Record<string, unknown> });

    expect(err).not.toBeNull();
    expect(err?.code).toBe('FX_NO_AUTOMATIC_RATE');
    // ⛔ Rojo si el `422` deja de traer `details` COMPLETO: «ya viaja en el DTO» no es razón.
    expect(err?.details).toEqual({ currentRate: 19.0, fallbackRate: FX_FALLBACK_RATE });
    expect(err?.details.fallbackRate).toBe(delDto);
  });

  /** ⭐ (c) `source === "fallback"` ⟹ `rate === fallbackRate`. El invariante (i), medido. */
  it('⭐ (c) con `source: "fallback"`, `rate === fallbackRate` (y las dos `applied` en false)', async () => {
    const h = harness({ settings: { [MODE_KEY]: 'auto', [SettingKey.FX_BUFFER_PCT]: 3 }, fxRates: [] });
    const s = await h.fxCtrl.current();
    expect(s.source).toBe('fallback');
    expect(s.rate).toBe(s.fallbackRate);
    expect([s.manual.applied, s.automatic.applied]).toEqual([false, false]);
  });

  /**
   * ⛔ **(d) NO ES UN DIAL.** *Publicar un número y permitir editarlo son dos decisiones distintas.*
   * Mismo género que `FX_AUTO_STALE_AFTER_DAYS`: constante de código, no `SettingKey`.
   */
  it('⛔ (d) no es un dial: `PUT /admin/settings { fallbackRate }` es `422` por clave desconocida', async () => {
    const h = harness({ settings: { [MODE_KEY]: 'auto', [SettingKey.FX_BUFFER_PCT]: 3 }, fxRates: [banxicoRow(18.2431)] });
    await expect(
      h.settingsCtrl.updateSettings({ fallbackRate: 20 }, 'admin-1', 'super_admin' as never),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    // Y el DTO de §M10 no lo lleva: no hay por dónde leerlo como si fuera un ajuste.
    expect(Object.keys(await h.settingsCtrl.getSettings())).not.toContain('fallbackRate');
    // El número no se movió.
    expect((await h.fxCtrl.current()).fallbackRate).toBe(FX_FALLBACK_RATE);
  });
});
