import { Logger } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { SETTING_DEFAULTS, SettingKey } from '../src/modules/settings/settings.constants';

/**
 * §11.0 (v1.50.3-a) — **INVENTARIO DE CONFIGURACIÓN AL ARRANCAR.**
 *
 * ### El problema que resuelve (y que no era un bug de código)
 * `prisma/seed.ts` hace `upsert` con **`update: {}`**, y eso es **correcto**: impide que un deploy pise
 * el ajuste deliberado de un operador. El corolario —que nadie había escrito hasta §11.0— es que
 * **cambiar un seed NO cambia ningún entorno ya sembrado**. Un entorno puede quedarse con el dial viejo
 * **con el código nuevo desplegado y todos los tests en verde**: el E2E del criterio 109 falló
 * exactamente así, y eso no fue un defecto del test sino el test haciendo su trabajo.
 *
 * Esta línea convierte *«¿qué diales tiene REALMENTE producción?»* en un **grep**.
 *
 * ### ⚠️ v1.50.3-b — dejó de ser un extra: es un REQUISITO load-bearing
 * La suite E2E **no puede** usarse como detector de configuración: **escribe** (flip del dial global, un
 * `POST /admin/pricing/override`, un `updateMany` que envejece `capturedDate`) y exige fixtures
 * sintéticos ⇒ nunca se apunta a producción. Descartado el E2E, **esta línea y el `GET` del recurso son
 * los dos únicos detectores del seed rancio**, y los dos son de solo lectura.
 *
 * Que el E2E del criterio 109 fallara con el dial viejo **no era «el test haciendo su trabajo»**: era un
 * test **bajo-especificado** fallando por una razón ajena a lo que verifica. Endurecerlo —fijar el dial
 * antes de asertar— fue correcto, pero **eliminó un detector accidental que nadie había diseñado**. La
 * regla que queda: *un test que **fija** su propia configuración para ser determinista deja, por
 * construcción, de ser un detector de configuración.* Estos tests son el sustituto **diseñado** para eso.
 *
 * ### Por qué `log`/`info` y NO `warn` — es la mitad del diseño
 * Un dial ajustado a propósito **es normal**. Alertar por cada uno es ruido que se aprende a ignorar, y
 * el día que haya un `warn` de verdad nadie lo leerá. Es un **inventario**, no una alarma. La ÚNICA
 * excepción sigue siendo `manualFreshnessDays === null` (I8-bis), que la emite `PricingService` al izar
 * SU config porque desactiva un criterio de `PROJECT.md`.
 *
 * ### Lo que este inventario NO hace
 * **No sobrescribe nada.** §11.0 punto 3: `ConfigSetting` guarda un **valor**, no su **procedencia**,
 * así que «sigue en el seed viejo» y «el operador lo eligió así» son el MISMO dato — y 3, 50 y `null`
 * son elecciones de operador perfectamente plausibles. Informar es todo lo que se puede hacer sin
 * adivinar; sobrescribir es del operador, clave por clave, por el `PUT` de admin (auditado y validado).
 */
describe('§11.0 — inventario de configuración al arrancar', () => {
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  /** Tabla `ConfigSetting` simulada: solo las filas que se le pasen. */
  function wire(rows: { key: string; valueJson: unknown }[], opts: { falla?: boolean } = {}) {
    const prisma = {
      configSetting: {
        findMany: jest.fn(async () => {
          if (opts.falla) throw new Error('connection refused');
          return rows;
        }),
      },
    } as unknown as PrismaService;
    return new SettingsService(prisma);
  }

  const linea = () => logSpy.mock.calls.map((c) => String(c[0])).find((m) => m.includes('config inventory'));

  it('con TODO en su default: lo dice, y en `log` — no hay nada que alarmar', async () => {
    await wire([
      { key: SettingKey.GRADED_ESTIMATE_MIN_SAMPLE_COUNT, valueJson: 5 },
      { key: SettingKey.GRADED_ESTIMATE_MAX_RAW_MULTIPLE, valueJson: 100 },
    ]).logConfigInventory();
    expect(linea()).toContain('SIN DIVERGENCIAS');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  /**
   * **El caso real de PI-D3**, con los tres valores exactos que un entorno ya sembrado conserva tras el
   * deploy de v1.50.3. Es la línea que habría convertido «el E2E del 109 falla y no sé por qué» en un
   * grep de treinta segundos.
   */
  it('lista las claves que DIFIEREN, con su valor vigente y el default nuevo', async () => {
    await wire([
      { key: SettingKey.GRADED_ESTIMATE_MANUAL_FRESHNESS_DAYS, valueJson: null }, // seed viejo
      { key: SettingKey.GRADED_ESTIMATE_MIN_SAMPLE_COUNT, valueJson: 3 }, // seed viejo
      { key: SettingKey.GRADED_ESTIMATE_MAX_RAW_MULTIPLE, valueJson: 50 }, // seed viejo
      { key: SettingKey.GRADED_ESTIMATE_FRESHNESS_DAYS, valueJson: 30 }, // en default: NO se lista
    ]).logConfigInventory();

    const l = linea()!;
    expect(l).toContain('graded_estimate_manual_freshness_days=null (default 30)');
    expect(l).toContain('graded_estimate_min_sample_count=3 (default 5)');
    expect(l).toContain('graded_estimate_max_raw_multiple=50 (default 100)');
    expect(l).toContain('3 de 4 clave(s) comparables DIFIEREN');
    expect(l).not.toContain('graded_estimate_freshness_days'); // está en su default
  });

  it('es `log`/`info` y NUNCA `warn`: un dial ajustado a propósito es NORMAL, no una alarma', async () => {
    // Si esto se convirtiera en `warn`, cada entorno con un dial afinado emitiría alertas en cada
    // arranque — y el ruido que se aprende a ignorar es peor que el silencio, porque cuando llegue el
    // `warn` que sí importa (`manualFreshnessDays = null`, I8-bis) nadie lo va a leer.
    await wire([{ key: SettingKey.IVA_PCT, valueJson: 0 }]).logConfigInventory();
    expect(linea()).toContain('DIFIEREN');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('una clave AUSENTE de la tabla NO se lista: resuelve al default, así que no difiere', async () => {
    // La distinción importa: «ausente» y «presente con el seed» son estados distintos de la BD pero el
    // MISMO valor efectivo. El inventario habla de valores efectivos.
    await wire([]).logConfigInventory();
    expect(linea()).toContain('SIN DIVERGENCIAS');
  });

  it('una clave SIN default de código (retirada o fuera de banda) se ignora: no hay contra qué comparar', async () => {
    await wire([{ key: 'stripe_fee_iva_pct', valueJson: 0.16 }]).logConfigInventory();
    expect(linea()).toContain('SIN DIVERGENCIAS');
  });

  /**
   * v1.50.3-c (techlead) — **el denominador no puede SOBRE-AFIRMAR.** El mensaje contaba `rows.length`,
   * que incluye las claves sin default de código: decía «las N claves están en su default» sobre filas
   * que el `hasOwnProperty` ni siquiera había mirado. En una línea cuyo único valor es que se pueda
   * confiar en ella, afirmar de más es el peor defecto posible — y el más difícil de notar, porque el
   * mensaje suena bien.
   */
  it('el «SIN DIVERGENCIAS» cuenta las claves COMPARABLES, no las filas de la tabla', async () => {
    await wire([
      { key: SettingKey.GRADED_ESTIMATE_MIN_SAMPLE_COUNT, valueJson: 5 }, // comparable, en default
      { key: 'stripe_fee_iva_pct', valueJson: 0.16 }, // SIN default de código: no se compara
      { key: 'clave_retirada_hace_dos_versiones', valueJson: 'x' }, // ídem
    ]).logConfigInventory();
    const l = linea()!;
    expect(l).toContain('SIN DIVERGENCIAS');
    expect(l).toContain('las 1 clave(s) COMPARABLES');
    expect(l).toContain('de 3 fila(s) en la tabla'); // las otras dos se declaran, no se esconden
    expect(l).not.toContain('las 3 clave(s)'); // <- la sobre-afirmación que se corrigió
  });

  it('un valor grande (la tabla de escalones) se TRUNCA: la línea tiene que seguir siendo greppeable', async () => {
    await wire([
      { key: SettingKey.GRADING_COST_TIERS, valueJson: [{ minValueMxnCents: 0, maxValueMxnCents: null, costMxnCents: 99_999 }] },
    ]).logConfigInventory();
    const l = linea()!;
    expect(l).toContain('grading_cost_tiers=');
    expect(l).toContain('…'); // el default (6 escalones) no cabe entero, y no debe caber
  });

  /**
   * v1.50.3-c (techlead) — **el recorte va ALREDEDOR de la primera diferencia, no por el principio.**
   *
   * `grading_cost_tiers` es el ÚNICO dial que es una tabla: ~420 chars contra un tope de 160. Con un
   * recorte por el principio, una divergencia en el escalón 4 imprimía **dos prefijos IDÉNTICOS** y la
   * línea decía «X difiere de Y» mostrando X == Y: el operador no podía ver qué cambió. Es exactamente
   * el falso negativo de diagnóstico que este inventario existe para no tener, en el único dial donde
   * el recorte muerde.
   */
  it('con la divergencia en un escalón TARDÍO, los dos valores impresos NO son idénticos', async () => {
    const tiers = SETTING_DEFAULTS[SettingKey.GRADING_COST_TIERS] as Record<string, unknown>[];
    expect(tiers.length).toBeGreaterThanOrEqual(4); // la premisa del caso: la divergencia cabe «tarde»
    const cuarto = { ...tiers[3], costMxnCents: 4_242_424 }; // un costo imposible de confundir
    const conCuartoDistinto = tiers.map((t, i) => (i === 3 ? cuarto : t));
    await wire([{ key: SettingKey.GRADING_COST_TIERS, valueJson: conCuartoDistinto }]).logConfigInventory();

    const l = linea()!;
    expect(l).toContain('DIFIEREN');
    // 1) El valor divergente REAL aparece impreso (antes se quedaba fuera del prefijo de 160).
    expect(l).toContain('4242424');
    // 2) Los dos lados impresos difieren entre sí — la aserción que el defecto rompía.
    const m = l.match(/grading_cost_tiers=(.+?) \(default (.+?)\)( \[1ª diferencia en char (\d+)\])?/)!;
    expect(m[1]).not.toBe(m[2]);
    // 3) Y se imprime el ancla para localizarlo en la tabla completa.
    expect(l).toMatch(/\[1ª diferencia en char \d+\]/);
  });

  it('el recorte respeta el tope: la línea sigue siendo una LÍNEA, no un volcado de la tabla', async () => {
    const tiers = SETTING_DEFAULTS[SettingKey.GRADING_COST_TIERS] as Record<string, unknown>[];
    const conCuartoDistinto = tiers.map((t, i) => (i === 3 ? { ...t, costMxnCents: 4_242_424 } : t));
    await wire([{ key: SettingKey.GRADING_COST_TIERS, valueJson: conCuartoDistinto }]).logConfigInventory();
    const m = linea()!.match(/grading_cost_tiers=(.+?) \(default (.+?)\) \[/)!;
    // 160 chars + hasta dos elipsis por lado.
    expect(m[1].length).toBeLessThanOrEqual(162);
    expect(m[2].length).toBeLessThanOrEqual(162);
  });

  it('un valor que CABE entero se imprime entero, sin ventana ni ancla (no se complica lo simple)', async () => {
    await wire([{ key: SettingKey.GRADED_ESTIMATE_MIN_SAMPLE_COUNT, valueJson: 3 }]).logConfigInventory();
    const l = linea()!;
    expect(l).toContain('graded_estimate_min_sample_count=3 (default 5)');
    expect(l).not.toContain('1ª diferencia en char');
  });

  /**
   * **Falso positivo real, encontrado corriendo esto contra la BD de dev.** Postgres guarda `jsonb` y
   * **reordena las claves de los objetos**, así que `grading_cost_tiers` vuelve con el MISMO contenido
   * y otro orden y un `JSON.stringify` crudo lo declaraba «DIFERENTE» en cada arranque.
   *
   * Importa más de lo que parece: un inventario que grita cuando no pasa nada es **ruido que se aprende
   * a ignorar**, o sea justo el modo de fallo que §11.0 quiere evitar al pedir `log` y no `warn`. Un
   * diagnóstico con falsos positivos es tan inútil como el truncate de 800 chars con su falso negativo.
   */
  it('el orden de claves que devuelve `jsonb` NO cuenta como diferencia (falso positivo cerrado)', async () => {
    const [primero] = SETTING_DEFAULTS[SettingKey.GRADING_COST_TIERS] as Record<string, unknown>[];
    const reordenado = (SETTING_DEFAULTS[SettingKey.GRADING_COST_TIERS] as Record<string, unknown>[]).map((t) =>
      // Alfabético: `costMxnCents` primero, que es justo como lo devuelve Postgres.
      Object.fromEntries(Object.keys(t).sort().map((k) => [k, t[k]])),
    );
    expect(JSON.stringify(reordenado[0])).not.toBe(JSON.stringify(primero)); // el orden SÍ cambió
    await wire([{ key: SettingKey.GRADING_COST_TIERS, valueJson: reordenado }]).logConfigInventory();
    expect(linea()).toContain('SIN DIVERGENCIAS');
  });

  it('pero el orden de los ARRAYS SÍ cuenta: en los escalones y en la curva es significativo', async () => {
    const invertido = [...(SETTING_DEFAULTS[SettingKey.GRADING_COST_TIERS] as unknown[])].reverse();
    await wire([{ key: SettingKey.GRADING_COST_TIERS, valueJson: invertido }]).logConfigInventory();
    expect(linea()).toContain('DIFIEREN');
  });

  it('una diferencia REAL de contenido se sigue detectando (no se canonicaliza de más)', async () => {
    const tiers = SETTING_DEFAULTS[SettingKey.GRADING_COST_TIERS] as Record<string, unknown>[];
    const conCostoDistinto = tiers.map((t, i) => (i === 0 ? { ...t, costMxnCents: 1 } : t));
    await wire([{ key: SettingKey.GRADING_COST_TIERS, valueJson: conCostoDistinto }]).logConfigInventory();
    expect(linea()).toContain('DIFIEREN');
  });

  /**
   * §11.0 punto 5 (v1.50.3-b) — **se emite SIEMPRE, también sin divergencias.** Es el punto que hace
   * que la línea sirva como detector: si solo apareciera cuando hay problema, **su ausencia sería
   * ambigua** —«no hay nada que reportar» vs. «esto no corrió»— y «no vi la alerta» pasaría por «está
   * todo bien», que es fallar ABIERTO. Con el «sin divergencias» explícito, la ausencia significa una
   * sola cosa: no se ejecutó.
   */
  it('SIEMPRE emite UNA línea, haya o no divergencias (su ausencia solo puede significar «no corrió»)', async () => {
    await wire([{ key: SettingKey.IVA_PCT, valueJson: SETTING_DEFAULTS[SettingKey.IVA_PCT] }]).logConfigInventory();
    const sinDiff = logSpy.mock.calls.filter((c) => String(c[0]).includes('config inventory'));
    expect(sinDiff).toHaveLength(1);
    expect(String(sinDiff[0][0])).toContain('SIN DIVERGENCIAS');

    logSpy.mockClear();
    await wire([{ key: SettingKey.IVA_PCT, valueJson: 0 }]).logConfigInventory();
    const conDiff = logSpy.mock.calls.filter((c) => String(c[0]).includes('config inventory'));
    expect(conDiff).toHaveLength(1);
    expect(String(conDiff[0][0])).toContain('DIFIEREN');
  });

  /**
   * §11.0 punto 5 — **imprime los DOS valores y el nombre de la clave.** Un «esta clave difiere» sin los
   * números NO es accionable: obligaría al operador a ir a la BD, que es justo el viaje que esta línea
   * existe para evitar.
   */
  it('cada divergencia trae CLAVE + vigente + default: sin los tres números no es accionable', async () => {
    await wire([{ key: SettingKey.GRADED_ESTIMATE_MIN_SAMPLE_COUNT, valueJson: 3 }]).logConfigInventory();
    expect(linea()).toMatch(/graded_estimate_min_sample_count=3 \(default 5\)/);
  });

  it('si la BD falla, lo DICE en voz alta: el silencio se leería como «sin divergencias»', async () => {
    const svc = wire([], { falla: true });
    await svc.logConfigInventory();
    const w = warnSpy.mock.calls.map((c) => String(c[0])).find((m) => m.includes('config inventory'))!;
    expect(w).toContain('NO SE PUDO EMITIR');
    expect(linea()).toBeUndefined(); // y NO se finge un «sin divergencias» que no se pudo comprobar
  });

  it('si la BD falla, el ARRANQUE CONTINÚA: es observabilidad, no negocio', async () => {
    const svc = wire([], { falla: true });
    await expect(svc.onModuleInit()).resolves.toBeUndefined();
    expect(warnSpy.mock.calls.some((c) => String(c[0]).includes('NO SE PUDO EMITIR'))).toBe(true);
  });

  it('`onModuleInit` es quien lo dispara (por eso sale UNA vez, al arrancar, y no por request)', async () => {
    const svc = wire([{ key: SettingKey.GRADED_ESTIMATE_MIN_SAMPLE_COUNT, valueJson: 3 }]);
    await svc.onModuleInit();
    expect(linea()).toContain('graded_estimate_min_sample_count=3');
  });

  /**
   * Guardarraíl de §11.0 punto 3: **el inventario informa, no propaga.** Si alguien "mejorara" esto
   * para que además escribiera el default nuevo, destruiría en silencio exactamente lo que `update: {}`
   * protege — y sería indistinguible de pisar la decisión deliberada de un operador.
   */
  it('NO escribe nada: no hay `upsert`, `update` ni `create` en la ruta del inventario', async () => {
    const upsert = jest.fn();
    const update = jest.fn();
    const create = jest.fn();
    const prisma = {
      configSetting: {
        findMany: jest.fn(async () => [{ key: SettingKey.GRADED_ESTIMATE_MIN_SAMPLE_COUNT, valueJson: 3 }]),
        upsert,
        update,
        create,
      },
    } as unknown as PrismaService;
    await new SettingsService(prisma).logConfigInventory();
    expect(upsert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('los tres seeds corregidos de v1.50.3 son los que el inventario usa como referencia', async () => {
    // Blindaje del propio inventario: si una regresión bajara un default, esta línea empezaría a decir
    // que el entorno CORRECTO es el que difiere. El inventario solo sirve si su referencia es la buena.
    expect(SETTING_DEFAULTS[SettingKey.GRADED_ESTIMATE_MANUAL_FRESHNESS_DAYS]).toBe(30);
    expect(SETTING_DEFAULTS[SettingKey.GRADED_ESTIMATE_MIN_SAMPLE_COUNT]).toBe(5);
    expect(SETTING_DEFAULTS[SettingKey.GRADED_ESTIMATE_MAX_RAW_MULTIPLE]).toBe(100);
  });
});
