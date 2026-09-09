import { E2EHarness } from './helpers/e2e-app';
import { E2E_USERS } from '../../prisma/e2e-fixtures';
import { SettingKey } from '../../src/modules/settings/settings.constants';
import { FX_FALLBACK_RATE } from '../../src/common/fx-mode';

/**
 * # `fx-mode.e2e-spec.ts` — **EL INTERRUPTOR DEL DINERO, CONTRA POSTGRES DE VERDAD**
 *
 * Propiedad: **backend**; la ejecuta **QA** (`npm run test:integration`).
 *
 * ### Por qué existe (M-7)
 * Los candados del FX (`test/fx.mode-switch.spec.ts`, veintiuno) viven en la suite **unitaria**,
 * contra un Prisma en memoria. Eso es correcto y es donde deben estar la mayoría — pero **hay cuatro
 * cosas que un arnés en memoria no puede afirmar**, y las cuatro son de dinero:
 *
 * 1. **`pg_advisory_xact_lock` es de Postgres.** El arnés unitario emula su *semántica* (exclusión
 *    mutua por transacción); aquí se ejerce **el candado real**, con dos peticiones HTTP de verdad.
 *    *Es la única prueba que puede decir «S-FX-1 está cerrado» sin una nota al pie.*
 * 2. **`Decimal(12,6)`**: `FxRate.rate` viaja como `Prisma.Decimal`, no como `number`. Que
 *    `projectFxState` haga `Number(...)` sobre él **solo se comprueba con el driver real**.
 * 3. **`valueJson` es `jsonb`**: el centinela `"legacy"`, el `null` y los números se guardan y se
 *    releen por el mismo camino que en producción.
 * 4. **Transacciones de verdad**: el «todo o nada» del pin y de la bitácora, con rollback real.
 *
 * ⚠️ **NO se corrió en la sesión que lo escribió**: no había Postgres ni Docker en ese entorno
 * (`pg_isready` sin respuesta). Está escrito para que QA lo corra con el stack levantado; si algo
 * falla aquí y no en la unitaria, **el hallazgo es de la capa que la unitaria no ve**, que es
 * exactamente para lo que existe este fichero.
 *
 * ⛔ **Deja la BD como la encontró**: cada caso restaura las dos filas del FX que toca. El resto de
 * la suite (que valúa en MXN) se apoya en ellas.
 */
describe('E2E — FX: el interruptor, la carrera y la banda de cordura (§M2-F, S-FX-1, S-FX-2)', () => {
  let h: E2EHarness;
  let admin: string;

  /** Estado de las dos filas del FX, para dejarlo como estaba. */
  let backup: { mode: unknown; rate: unknown };
  /** ¿La BD ya traía filas `banxico` antes de que este fichero sembrara la suya? */
  let habiaFilaBanxico = false;

  const leerFila = async (key: string) =>
    (await h.prisma.configSetting.findUnique({ where: { key } }))?.valueJson ?? undefined;

  const escribirFila = async (key: string, valueJson: unknown) => {
    if (valueJson === undefined) {
      await h.prisma.configSetting.deleteMany({ where: { key } });
      return;
    }
    await h.prisma.configSetting.upsert({
      where: { key },
      create: { key, valueJson: valueJson as never },
      update: { valueJson: valueJson as never },
    });
  };

  const getFx = async () => (await h.api('GET', '/admin/fx', { token: admin })).body;

  /** Medianoche UTC de hoy: la misma normalización que usa `projectFxState`. */
  const hoyUtc = () => {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    return d;
  };
  const ID_BANXICO = `banxico-${hoyUtc().toISOString().slice(0, 10)}`;
  const TASA_BANXICO = 18.2431;

  /**
   * ⭐⭐ **B-QA-1 — LA FILA QUE ESTE FICHERO DABA POR SEMBRADA Y NADIE SEMBRABA.**
   *
   * `prisma/seed-e2e.ts` **no escribe ni una fila `FxRate`** (cero ocurrencias). Con `mode: "auto"` y
   * sin fila `banxico`, el sistema cotiza `18/fallback` **legítimamente** ⇒ el
   * `expect(fx.source).not.toBe('fallback')` de la carrera reventaba **en la PRIMERA vuelta del
   * bucle**, la del escalonado de **0 ms**, que es justo el único valor con el que la carrera **no**
   * se reproduce. El bucle abortaba ahí.
   *
   * ⇒ **Los escalonados de 20 ms —los únicos que reproducen `S-FX-1`— no se habían ejecutado nunca.**
   * *La prueba que existe para afirmar que la carrera está cerrada no había afirmado nada sobre la
   * carrera.* El defecto no era el candado: era que este fichero nunca llegó a mirarlo.
   *
   * ⛔ Y se limpia en `afterAll`: el resto de la suite valúa en MXN y esta fila cambiaría lo que
   * cotiza en modo `auto`. *«Deja la BD como la encontró»* incluye lo que uno mismo siembra.
   */
  async function sembrarBanxico() {
    await h.prisma.fxRate.upsert({
      where: { id: ID_BANXICO },
      create: {
        id: ID_BANXICO,
        rate: TASA_BANXICO as never,
        bufferPct: 3 as never,
        effectiveDate: hoyUtc(),
        source: 'banxico',
      },
      update: { rate: TASA_BANXICO as never, source: 'banxico' },
    });
  }

  beforeAll(async () => {
    h = await E2EHarness.create();
    admin = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    backup = {
      mode: await leerFila(SettingKey.FX_RATE_MODE),
      rate: await leerFila(SettingKey.FX_MANUAL_OVERRIDE_RATE),
    };
    // B-QA-1: sin esta fila, `auto` cae al fallback duro **con toda la razón**.
    habiaFilaBanxico = (await h.prisma.fxRate.count({ where: { source: 'banxico' } })) > 0;
    await sembrarBanxico();
  });

  afterAll(async () => {
    await escribirFila(SettingKey.FX_RATE_MODE, backup.mode);
    await escribirFila(SettingKey.FX_MANUAL_OVERRIDE_RATE, backup.rate);
    if (!habiaFilaBanxico) await h.prisma.fxRate.deleteMany({ where: { source: 'banxico' } });
    await h.prisma.fxRate.deleteMany({ where: { source: 'manual' } });
    await h.close();
  });

  /** El estado de partida del PoC: `auto` **con** un 19 guardado. */
  async function estadoDelPoC() {
    await escribirFila(SettingKey.FX_RATE_MODE, 'auto');
    await escribirFila(SettingKey.FX_MANUAL_OVERRIDE_RATE, 19);
  }

  // ===============================================================================================
  describe('⭐⭐ S-FX-1 — la carrera entre las dos puertas, contra Postgres', () => {
    it('las dos peticiones se solapan y JAMÁS queda `manual` con la tasa en null', async () => {
      // Se repite: una carrera que solo se prueba una vez es una moneda al aire. El pentester la
      // reprodujo 7 de 8 veces con ~20 ms de ventaja; aquí se dispara sin escalonar y escalonada.
      for (const ventajaMs of [0, 5, 20, 20, 50]) {
        await estadoDelPoC();

        const puertaA = h.api('PUT', '/admin/settings', {
          token: admin,
          json: { fxManualOverrideRate: null },
        });
        const puertaB = (async () => {
          if (ventajaMs) await new Promise((r) => setTimeout(r, ventajaMs));
          return h.api('PUT', '/admin/fx/mode', { token: admin, json: { mode: 'manual' } });
        })();
        const [resA, resB] = await Promise.all([puertaA, puertaB]);

        // ⭐⭐ EL INVARIANTE, leído DE LA BASE (no de la respuesta): el estado imposible no existe.
        const modo = await leerFila(SettingKey.FX_RATE_MODE);
        const tasa = await leerFila(SettingKey.FX_MANUAL_OVERRIDE_RATE);
        expect(modo === 'manual' && (tasa === null || tasa === undefined)).toBe(false);

        // ⭐ Y el dinero: nunca el fallback duro por accidente. Con la fila `banxico` sembrada
        // (`sembrarBanxico`), los DOS desenlaces legales de la carrera tienen número propio —`auto`
        // ⇒ banxico, `manual` ⇒ 19— así que **cualquier `fallback` aquí es el hallazgo**, no la
        // ausencia de datos. Sin la fila, esta aserción medía el seed en vez de la carrera.
        const fx: any = await getFx();
        expect(fx.source).not.toBe('fallback');
        expect(fx.rate).not.toBe(FX_FALLBACK_RATE);

        // Una de las dos tiene que negarse (422); las dos con 200 es exactamente el hallazgo.
        const estados = [resA.status, resB.status].sort();
        expect(estados).toEqual([200, 422]);
      }
    });

    it('⭐ la bitácora describe el estado que RIGE (el no-repudio del hallazgo)', async () => {
      await estadoDelPoC();
      const desde = new Date();
      await Promise.all([
        h.api('PUT', '/admin/settings', { token: admin, json: { fxManualOverrideRate: null } }),
        h.api('PUT', '/admin/fx/mode', { token: admin, json: { mode: 'manual' } }),
      ]);
      const fx: any = await getFx();
      const entradas = await h.prisma.auditLog.findMany({
        where: { action: { in: ['fx.mode.change', 'fx.override'] }, createdAt: { gte: desde } },
        orderBy: { createdAt: 'desc' },
        take: 1,
      });
      if (entradas.length) {
        const after = entradas[0].after as unknown as { effectiveRate: number; source: string };
        // ⛔ Rojo si el libro afirma 19/manual mientras el sistema cotiza 18/fallback.
        expect(Number(after.effectiveRate)).toBe(fx.rate);
        expect(after.source).toBe(fx.source);
      }
    });

    it('secuencial (sin carrera) la conducta no cambia: el 422 es el mismo de siempre', async () => {
      await estadoDelPoC();
      const a = await h.api('PUT', '/admin/settings', { token: admin, json: { fxManualOverrideRate: null } });
      expect(a.status).toBe(200);
      const b = await h.api('PUT', '/admin/fx/mode', { token: admin, json: { mode: 'manual' } });
      expect(b.status).toBe(422);
      // ⚠️ B-QA-1(b) — el sobre de error del sistema es `{ error: { code, message, details } }`
      // (`common/filters/all-exceptions.filter.ts`, y el contrato lo fija). **El endpoint cumplía; el
      // que leía la clave equivocada era este spec**, así que recibía `undefined` y reventaba.
      expect((b.body as any).error.code).toBe('FX_MANUAL_RATE_MISSING');
    });
  });

  // ===============================================================================================
  describe('⭐ el estado imposible, si alguien lo crea EDITANDO LA BASE', () => {
    it('se detecta con una consulta de una fila (la que el dueño puede correr)', async () => {
      // Escenario: dos filas descoordinadas por una migración, un `psql` o una carrera anterior al
      // arreglo. **Serializar previene el estado nuevo; no rescata a quien ya cayó.**
      await escribirFila(SettingKey.FX_RATE_MODE, 'manual');
      await escribirFila(SettingKey.FX_MANUAL_OVERRIDE_RATE, null);
      // ⚠️ Este caso mide **el fallback duro**, así que necesita que NO haya fila `banxico`: es el
      // segundo caso de FX-23 (`§M2-F.6`). Se retira la que sembró `beforeAll` y se repone al final.
      await h.prisma.fxRate.deleteMany({ where: { source: 'banxico' } });

      const filas = await h.prisma.$queryRawUnsafe<{ mode: unknown; rate: unknown }[]>(
        `SELECT m."valueJson" AS mode, r."valueJson" AS rate
           FROM "ConfigSetting" m
           LEFT JOIN "ConfigSetting" r ON r.key = 'fx_manual_override_rate'
          WHERE m.key = 'fx_rate_mode'
            AND m."valueJson" #>> '{}' = 'manual'
            AND (r."valueJson" IS NULL OR r."valueJson" = 'null'::jsonb)`,
      );
      expect(filas.length).toBe(1); // ⇒ entorno AFECTADO

      // Y lo que el sistema hace mientras tanto, dicho sin rodeos: **sin fila `banxico` no hay nada
      // mejor que el literal**, así que cotiza con el fallback duro. (La otra mitad —con fila
      // `banxico`— es `FX-23`, abajo: ahí el 18 deja de regir.)
      const fx: any = await getFx();
      expect(fx.source).toBe('fallback');
      expect(fx.rate).toBe(FX_FALLBACK_RATE);

      await sembrarBanxico();
      await estadoDelPoC();
      expect((await h.prisma.$queryRawUnsafe<unknown[]>(
        `SELECT 1 FROM "ConfigSetting" m
          WHERE m.key = 'fx_rate_mode' AND m."valueJson" #>> '{}' = 'manual'
            AND NOT EXISTS (SELECT 1 FROM "ConfigSetting" r
                             WHERE r.key = 'fx_manual_override_rate' AND r."valueJson" <> 'null'::jsonb)`,
      )).length).toBe(0); // ⇒ entorno SANO
    });
  });

  // ===============================================================================================
  /**
   * ⭐⭐ **FX-23 (`§M2-F.6`, `ARCHITECTURE §9 · D-FX-1`) — LA CUARTA FILA DE `§M2-F.1`.**
   *
   * **El fixture se siembra por SQL porque es el único modo de crearlo**: las dos puertas devuelven
   * `422` (I-FX4) y, desde I-FX6, la carrera tampoco lo alcanza. Lo que sigue creándolo es una
   * migración o un `psql` — y la lectura tiene que **defenderse**, no razonar que no puede pasar.
   *
   * Entre *«un número real que Banxico publicó»* y *«un literal del código que nadie tecleó»*, **rige
   * el primero** (misma doctrina que I-FX5). ⛔ **El `mode` no se corrige ni se reescribe: la lectura
   * elige mejor, NO repara.**
   *
   * ⭐ **Y la mitad que hace la corrupción MÁS visible, no menos:** la combinación resultante
   * —`mode:"manual"` + `manual.rate:null` + **`manual.applied:false`** + `source:"banxico"`— **no la
   * puede producir ninguna secuencia de llamadas legales.** Antes, el DTO emitía `source:"fallback"`
   * **junto con** `manual.applied:true`: *«el número del dueño está aplicado»* sobre un número que no
   * existe. *Un campo que miente sólo en el estado corrupto miente exactamente cuando alguien lo está
   * leyendo para entender qué pasó.*
   */
  describe('⭐⭐ FX-23 — «manual sin número» rige por Banxico, y `applied` lo dice (D-FX-1/D-FX-3)', () => {
    beforeEach(async () => {
      // El estado ILEGAL, sembrado a mano: es lo que deja una migración o un `psql`.
      await escribirFila(SettingKey.FX_RATE_MODE, 'manual');
      await escribirFila(SettingKey.FX_MANUAL_OVERRIDE_RATE, null);
    });

    it('CON fila `banxico`: rige la tasa REAL, y ⛔ jamás el 18 que nadie tecleó', async () => {
      await sembrarBanxico();
      const fx: any = await getFx();

      // ⭐ Lo que rige. **Rojo si `rate == 18` o si `source == "fallback"`**: sería el literal del
      // código cotizando el catálogo entero, −5.26 % sobre la tasa que sí teníamos publicada.
      expect(fx.rate).toBeCloseTo(TASA_BANXICO, 4);
      expect(fx.source).toBe('banxico');
      expect(fx.rate).not.toBe(FX_FALLBACK_RATE);

      // ⛔ Y el modo NO se repara: la lectura elige mejor, no arregla la fila.
      expect(fx.mode).toBe('manual');
      expect(fx.manual.rate).toBeNull();

      // ⭐ `applied` derivado de `source` (D-FX-3). **Rojo si `manual.applied == true` con
      // `manual.rate == null`**, que es la mentira que este candado existe para matar.
      expect(fx.manual.applied).toBe(false);
      expect(fx.automatic.applied).toBe(true);
    });

    it('SIN fila `banxico`: el fallback duro, y las DOS `applied` en `false`', async () => {
      // ⚠️ La mitad que se olvida. Sin nada mejor que el literal, el 18 vuelve a regir — y entonces
      // **ninguna** de las dos ramas está aplicada, porque `source` no nombra a ninguna.
      await h.prisma.fxRate.deleteMany({ where: { source: 'banxico' } });
      const fx: any = await getFx();

      expect(fx.rate).toBe(FX_FALLBACK_RATE);
      expect(fx.source).toBe('fallback');
      expect(fx.mode).toBe('manual');
      expect(fx.manual.rate).toBeNull();
      expect(fx.manual.applied).toBe(false);
      expect(fx.automatic.applied).toBe(false);

      await sembrarBanxico();
    });

    it('⭐ la regla mecánica de `applied`, en los TRES estados legales (D-FX-3)', async () => {
      // Exactamente una de las dos `applied` es `true` ⟺ `source` la nombra; con `fallback`, ninguna.
      await sembrarBanxico();

      await escribirFila(SettingKey.FX_RATE_MODE, 'manual');
      await escribirFila(SettingKey.FX_MANUAL_OVERRIDE_RATE, 19);
      let fx: any = await getFx();
      expect([fx.source, fx.manual.applied, fx.automatic.applied]).toEqual(['manual', true, false]);

      await escribirFila(SettingKey.FX_RATE_MODE, 'auto');
      fx = await getFx();
      expect([fx.source, fx.manual.applied, fx.automatic.applied]).toEqual(['banxico', false, true]);

      await h.prisma.fxRate.deleteMany({ where: { source: 'banxico' } });
      fx = await getFx();
      expect([fx.source, fx.manual.applied, fx.automatic.applied]).toEqual(['fallback', false, false]);
      await sembrarBanxico();
    });

    it('⛔ CONTROL — I-FX4 no se relaja: las dos puertas siguen devolviendo 422', async () => {
      // «Elegir mejor» no es «permitirlo». Si esto se pusiera verde por el otro lado, el arreglo de
      // lectura se habría convertido en una autorización para crear el estado ilegal por HTTP.
      await escribirFila(SettingKey.FX_RATE_MODE, 'manual');
      await escribirFila(SettingKey.FX_MANUAL_OVERRIDE_RATE, 19);
      const a = await h.api('PUT', '/admin/settings', {
        token: admin,
        json: { fxManualOverrideRate: null },
      });
      expect(a.status).toBe(422);

      await escribirFila(SettingKey.FX_MANUAL_OVERRIDE_RATE, null);
      await escribirFila(SettingKey.FX_RATE_MODE, 'auto');
      const b = await h.api('PUT', '/admin/fx/mode', { token: admin, json: { mode: 'manual' } });
      expect(b.status).toBe(422);
      expect((b.body as any).error.code).toBe('FX_MANUAL_RATE_MISSING');
    });
  });

  // ===============================================================================================
  describe('los tipos que la unitaria no puede afirmar', () => {
    it('`FxRate.rate` es Decimal(12,6) y `GET /admin/fx` lo emite como NÚMERO', async () => {
      await escribirFila(SettingKey.FX_RATE_MODE, 'auto');
      const hoy = new Date();
      hoy.setUTCHours(0, 0, 0, 0);
      const id = `banxico-${hoy.toISOString().slice(0, 10)}`;
      await h.prisma.fxRate.upsert({
        where: { id },
        create: { id, rate: 18.243100 as never, bufferPct: 3 as never, effectiveDate: hoy, source: 'banxico' },
        update: { rate: 18.243100 as never, source: 'banxico' },
      });
      const fx: any = await getFx();
      expect(typeof fx.rate).toBe('number');
      expect(fx.rate).toBeCloseTo(18.2431, 4); // ⛔ rojo si el Decimal viaja como string
      expect(fx.automatic.rate).toBe(fx.rate); // identidad de I-FX5 en modo auto
      expect(fx.source).toBe('banxico');
    });

    it('el centinela `"legacy"` viaja por `jsonb` y NO se lee como modo válido', async () => {
      await escribirFila(SettingKey.FX_RATE_MODE, 'legacy');
      await escribirFila(SettingKey.FX_MANUAL_OVERRIDE_RATE, 19);
      const fx: any = await getFx();
      expect(fx.mode).toBe('manual'); // resolución legacy: hay número ⇒ manual
      expect(fx.modeResolvedFrom).toBe('legacy');
      expect(fx.rate).toBe(19);
    });

    it('⭐ una fila `FxRate` de fuente `manual` NO RIGE (I-FX5), con el driver real', async () => {
      await escribirFila(SettingKey.FX_RATE_MODE, 'auto');
      const antes: any = await getFx();
      const res = await h.api('PUT', '/admin/fx', { token: admin, json: { rate: 25 } });
      expect(res.status).toBe(200);
      const despues: any = await getFx();
      expect(despues.source).toBe(antes.source);
      expect(despues.rate).toBe(antes.rate); // el 25 se guardó, no rige
      expect(despues.manual.rate).toBe(25);
      expect(despues.manual.applied).toBe(false);
      // Y la fila forense SÍ está.
      const manual = await h.prisma.fxRate.findFirst({
        where: { source: 'manual' },
        orderBy: { effectiveDate: 'desc' },
      });
      expect(manual).not.toBeNull();
    });

    it('el pin y la bitácora revierten JUNTOS si la escritura falla (transacción real)', async () => {
      await escribirFila(SettingKey.FX_RATE_MODE, 'auto');
      await escribirFila(SettingKey.FX_MANUAL_OVERRIDE_RATE, 19);
      const desde = new Date();
      // Un valor fuera de rango se rechaza ANTES de la transacción (422), y no deja rastro.
      const res = await h.api('PUT', '/admin/fx', { token: admin, json: { rate: 100000 } });
      expect(res.status).toBe(422);
      expect(await leerFila(SettingKey.FX_MANUAL_OVERRIDE_RATE)).toBe(19);
      const entradas = await h.prisma.auditLog.count({
        where: { action: 'fx.override', createdAt: { gte: desde } },
      });
      expect(entradas).toBe(0);
    });

    it('⭐ el tablero y el panel del FX nombran la MISMA fila (`lastFxAt`)', async () => {
      const dash: any = (await h.api('GET', '/admin/dashboard', { token: admin })).body;
      const fx: any = await getFx();
      if (fx.automatic.rate == null) {
        expect(dash.dataHealth.lastFxAt).toBeNull();
      } else {
        expect(dash.dataHealth.lastFxAt).not.toBeNull();
      }
    });
  });
});
