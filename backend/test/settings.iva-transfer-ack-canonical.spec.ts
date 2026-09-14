import { join } from 'node:path';
import { SettingsService } from '../src/modules/settings/settings.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { BusinessException } from '../src/common/business.exception';
import { SettingKey } from '../src/modules/settings/settings.constants';
import {
  IVA_TRANSFER_GATE_LOCK_KEY,
  IVA_TRANSFER_SAMPLE_PRICE_CENTS_DEFAULT,
  IVA_TRANSFER_SAMPLE_PRICE_CENTS_MAX,
  ivaTransferPreview,
  validateAckSamplePriceCents,
} from '../src/modules/settings/iva-transfer';
import { StripeFeeConfig } from '../src/common/money';
import { codigoDeFichero } from './helpers/codigo-de-fichero';

/**
 * ⭐⭐ **`REL-A` CERRADA — `D-ACUSE-1`: EL `L` DEL ACUSE LO FIJA EL SERVIDOR, ⛔ NO QUIEN FIRMA.**
 * (`ARCHITECTURE §4.56.1`, `API_CONTRACT §M10-IVA.2` punto 3, candado **`IVA-14`**, criterios
 * **188** / **213**.)
 *
 * ### El defecto, medido EN VIVO por el pentester (dial movido `100 → 50` y restaurado a 100)
 * ```
 * PUT /admin/settings/iva-transfer
 *   { ivaTransferPct: 50, acknowledgement: { samplePriceCents: 1, previewedNetDeltaCents: 0 } }
 * → 200.  El dial SE MOVIÓ.  "Costo mostrado" = MX$0.00.
 *    Costo REAL del mismo movimiento a MX$100: −690 centavos/unidad (~7 % del precio).
 * ```
 * El validador anterior rechazaba **`L = 0`** —y lo decía: *«0 … would turn the acknowledgement into
 * a no-op»*— pero **`L` diminuto hace exactamente lo mismo**: el delta es una diferencia de
 * `round(P/(1+r))`, y para `L` pequeño ese redondeo también da `0`.
 *
 * ⚠️ **Por qué esto pesa más que su severidad «Media».** El acuse existe **porque el dueño lo
 * exigió** (criterio 188/213) para no firmar a ciegas un cambio que mueve **todos** sus precios. Es
 * «Media» porque sólo lo alcanza `super_admin` — **pero `super_admin` es el dueño, o sea justo la
 * persona a la que el acuse protege**. *Un acuse que promete un efecto inexistente es peor que no
 * tener acuse: enseña a firmar.* Aquí prometía **cero** y el efecto real era del **7 %**.
 *
 * ### Qué mide este fichero, en orden
 *  1. **EL DEFECTO, CONSERVADO COMO ARITMÉTICA** — el `0` fabricable sigue existiendo en el
 *     `/preview` (y **tiene que existir**: es una lectura honesta de un `L` diminuto). Lo que se
 *     cierra es que ese `0` **llegue a una escritura**.
 *  2. **EL POC, CERRADO** — el cuerpo exacto del pentester ⇒ `422`, ⛔ sin escribir, ⛔ sin candado.
 *  3. **POR EXCESO Y POR DEFECTO** — `10000` sigue funcionando; **ningún otro valor** pasa, incluida
 *     la batería de bordes que el pentester ya probó contra el `/preview`.
 *  4. **ANTES DE COMPARAR** — el `422` llega antes del candado, de la relectura y del delta.
 *  5. **EL COROLARIO** — ⛔ el eje del `/preview` **no se toca**: explorar es libre.
 *  6. **LO QUE NO SE AÑADIÓ** — ⛔ ninguna comprobación de «delta ≠ 0» en ejecución: con `iva_pct = 0`
 *     el dial **se puede mover** con un acuse de `0`, porque ahí el `0` es **verdad**.
 *  7. ⭐⭐ **`IVA-14` Y SU CANARIO** — bajar la constante pone rojo en **CI**, que es cuándo hay que
 *     enterarse, y no en el dial del dueño.
 *  8. **`D-ACUSE-1` POR AUSENCIA, SOBRE EL CÓDIGO** — la escritura alimenta el preview con la
 *     CONSTANTE, no con el campo del cuerpo. *Rojo el día que alguien reabra la elección al
 *     llamante, aunque el `422` siga en su sitio.*
 *
 * ⚠️⚠️ **REFUTACIÓN MEDIDA, y va aquí porque el contrato afirma lo contrario.** `ARCHITECTURE
 * §4.56.1` y `§M10-IVA.2` escriben que *«con el `L` canónico y `r ≥ 1`, **todo** movimiento de un
 * punto produce delta ≠ 0»*. **Es falso por UN caso**, y es un empate de redondeo real, no un error
 * de implementación: con `r = 1`, `t: 49 → 50` ⇒ `P` pasa de `10049` a `10050` y la base pasa de
 * `9950` a `9950` ⇒ **delta `0`**. Barrido exhaustivo `r ∈ [1,100] × t → t+1` (**10 000**
 * movimientos): **1** cero, y con `r ≥ 2` (**9 900** movimientos) **ninguno**. ⛔ No cambia ni una
 * decisión —`r = 1` con `L = 10 000` es justo el régimen que el propio arquitecto señaló al descartar
 * la cota inferior (*«con `r = 1` hace falta `L ≳ 5 050`»*)— pero el candado se escribe sobre **lo
 * medido**, no sobre la frase: un `IVA-14` redactado como «todos» habría nacido **rojo**, y un
 * candado que nace rojo se desactiva el primer día.
 */

/** Los diales vigentes del fixture canónico: `r = 16`, `0.036` / `300`. */
const FEE: StripeFeeConfig = { stripePct: 0.036, stripeFixedCents: 300, stripeFeeIvaPct: 0.16 };

/** El `L` canónico, por su nombre. Todo este fichero se escribe contra la CONSTANTE, no contra `10000`. */
const L = IVA_TRANSFER_SAMPLE_PRICE_CENTS_DEFAULT;

function harness(seed: Partial<Record<string, unknown>> = {}) {
  const rows = new Map<string, unknown>([
    [SettingKey.IVA_PCT, 16],
    [SettingKey.IVA_TRANSFER_PCT, 100],
    [SettingKey.STRIPE_FEE_PCT, 0.036],
    [SettingKey.STRIPE_FEE_FIXED_CENTS, 300],
    ...Object.entries(seed),
  ]);
  const audited: unknown[] = [];
  const locks: unknown[] = [];

  const client = {
    configSetting: {
      findUnique: jest.fn(async ({ where }: { where: { key: string } }) =>
        rows.has(where.key) ? { key: where.key, valueJson: rows.get(where.key) } : null,
      ),
      upsert: jest.fn(
        async ({ where, create }: { where: { key: string }; create: { valueJson: unknown } }) => {
          rows.set(where.key, create.valueJson);
          return {};
        },
      ),
    },
    auditLog: { create: jest.fn(async ({ data }: { data: unknown }) => audited.push(data)) },
    $executeRaw: jest.fn(async (_q: TemplateStringsArray, ...values: unknown[]) => {
      locks.push(values[0]);
      return 1;
    }),
  };

  // Espeja el ROLLBACK, no solo cuenta llamadas: un doble que ignore la transacción daría verde a
  // una implementación que escribe y luego lanza, que es el defecto `P48-B1(2)` un endpoint más allá.
  const prisma = {
    ...client,
    $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => {
      const snapshot = new Map(rows);
      const snapshotAudit = audited.length;
      try {
        return await cb(client);
      } catch (e) {
        rows.clear();
        for (const [k, v] of snapshot) rows.set(k, v);
        audited.length = snapshotAudit;
        throw e;
      }
    }),
  } as unknown as PrismaService;

  return {
    svc: new SettingsService(prisma),
    rows,
    audited,
    locks,
    dial: () => rows.get(SettingKey.IVA_TRANSFER_PCT),
  };
}

const auditWithin = async (
  tx: { auditLog: { create: (a: unknown) => Promise<unknown> } },
  change: { before: number; after: number },
) => {
  await tx.auditLog.create({ data: { action: 'settings.update', ...change } });
};

/** `netDeltaPerUnitCents` de mover el dial `de → a` con el `L` y la tasa dados. Sale del código REAL. */
function delta(desde: number, hasta: number, ivaRatePct: number, samplePriceCents: number): number {
  return ivaTransferPreview({
    currentPct: desde,
    proposedPct: hasta,
    ivaRatePct,
    samplePriceCents,
    fee: FEE,
  }).netDeltaPerUnitCents;
}

// =================================================================================================
// 1 · EL DEFECTO, CONSERVADO COMO ARITMÉTICA
// =================================================================================================
describe('⭐⭐ `REL-A` — el `0` fabricable EXISTE, y por eso el `L` del acuse no puede elegirlo quien firma', () => {
  it('⭐⭐ el PoC, en aritmética: a `L = 1` mover el dial `100 → 50` «cuesta» **0**; a `L` canónico, **−690**', () => {
    // *La cifra que el acuse prometía y la que el dueño pagaba, lado a lado.* Los dos números salen
    // de la MISMA función; lo único que cambia es el `L` — que es exactamente por qué el `L` no
    // puede viajar en la petición que firma.
    expect(delta(100, 50, 16, 1)).toBe(0);
    expect(delta(100, 50, 16, L)).toBe(-690);
  });

  it('el umbral que midió el pentester (`50 → 0`): `L ∈ {1,2,5,10} ⇒ 0`; `30 ⇒ −2`; `100 ⇒ −7`; canónico ⇒ `−689`', () => {
    // Su PoC partía del dial ya en 50. Se reproduce contra el código real, no contra su transcripción.
    for (const l of [1, 2, 5, 10]) expect(delta(50, 0, 16, l)).toBe(0);
    expect(delta(50, 0, 16, 30)).toBe(-2);
    expect(delta(50, 0, 16, 100)).toBe(-7);
    expect(delta(50, 0, 16, L)).toBe(-689);
  });

  it('⚠️ y DESDE 100 el conjunto trivializador es OTRO (`{1,2,3}`), que es por qué una cota no sirve', () => {
    // *El conjunto que vuelve trivial el acuse depende del MOVIMIENTO*, no solo del `L`: desde 100 a
    // 50 basta `L ≤ 3`. Cualquier cota inferior fijada contra un movimiento concreto deja fuera los
    // demás — y encima se rompe sola al mover `iva_pct` (ver `§4.56.1`, decisión 1).
    for (const l of [1, 2, 3]) expect(delta(100, 50, 16, l)).toBe(0);
    expect(delta(100, 50, 16, 4)).toBe(-1);
  });

  it('⭐ y con `r = 1` haría falta `L ≳ 5 050` para un punto — la aritmética que descarta la cota', () => {
    // La cifra del arquitecto, medida: con la tasa al 1 % un movimiento de UN punto sobre `L = 5000`
    // todavía redondea a 0, y sobre `L = 5100` ya no. *Una cota elegida contra el `r` de hoy se
    // rompe sola el día que se mueva `iva_pct`, y se rompe en silencio.*
    expect(delta(100, 99, 1, 5_000)).toBe(0);
    expect(delta(100, 99, 1, 5_100)).not.toBe(0);
  });
});

// =================================================================================================
// 2 · EL POC, CERRADO
// =================================================================================================
describe('⭐⭐ el cuerpo EXACTO del pentester ⇒ `422`, ⛔ sin escribir y ⛔ sin tomar el candado', () => {
  /** El body literal de `PENTEST_NOTES · REL-A`. */
  const POC = { ivaTransferPct: 50, acknowledgement: { samplePriceCents: 1, previewedNetDeltaCents: 0 } };

  it('⭐⭐ `422 VALIDATION_ERROR` con `field: acknowledgement.samplePriceCents`, y el dial sigue en 100', async () => {
    const h = harness();
    const err: BusinessException = await h.svc
      .setIvaTransferPct(POC, 'super-admin', auditWithin)
      .catch((e) => e);
    expect(err).toBeInstanceOf(BusinessException);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.getStatus()).toBe(422);
    expect(err.details).toMatchObject({ field: 'acknowledgement.samplePriceCents' });
    // ⛔ NI SE MOVIÓ NI SE AUDITÓ. La fila es el hecho; el código de estado es solo cómo se cuenta.
    expect(h.dial()).toBe(100);
    expect(h.audited).toHaveLength(0);
  });

  it('⭐ el `message` NOMBRA el valor canónico (un rechazo que no lo dice enseña a probar valores)', async () => {
    const h = harness();
    const err: BusinessException = await h.svc.setIvaTransferPct(POC, 'u1', auditWithin).catch((e) => e);
    expect(err.message).toContain(String(L));
    expect(err.message).toContain('acknowledgement.samplePriceCents');
  });

  it('⭐⭐ ⛔ NI SE TOMA EL CANDADO: el rechazo es ANTES de la transacción, no dentro', async () => {
    // *Un rechazo que ocurriera después de la comparación ya habría corrido la aritmética con el `L`
    // que eligió el llamante* — y, sobre Postgres, habría cogido `pg_advisory_xact_lock` para nada.
    const h = harness();
    await h.svc.setIvaTransferPct(POC, 'u1', auditWithin).catch(() => undefined);
    expect(h.locks).toEqual([]);
    expect(h.locks).not.toContain(IVA_TRANSFER_GATE_LOCK_KEY);
  });

  it('⭐ el ataque N=25 veces seguidas: 25 rechazos, 0 escrituras, 0 entradas de bitácora', async () => {
    // Una sola tirada no distingue «el candado sirve» de «el estado inicial ya era ése».
    const h = harness();
    let rechazos = 0;
    for (let i = 0; i < 25; i++) {
      const err = await h.svc.setIvaTransferPct(POC, 'u1', auditWithin).catch((e) => e);
      if (err instanceof BusinessException && err.getStatus() === 422) rechazos++;
    }
    expect(rechazos).toBe(25);
    expect(h.dial()).toBe(100);
    expect(h.audited).toHaveLength(0);
  });
});

// =================================================================================================
// 3 · POR EXCESO Y POR DEFECTO
// =================================================================================================
describe('⭐ POR EXCESO: el `L` canónico sigue abriendo la puerta (⛔ esto no es una amputación)', () => {
  it('`{ samplePriceCents: 10000, previewedNetDeltaCents: −690 }` escribe, audita y devuelve el preview', async () => {
    const h = harness();
    const res = await h.svc.setIvaTransferPct(
      { ivaTransferPct: 50, acknowledgement: { samplePriceCents: L, previewedNetDeltaCents: -690 } },
      'u1',
      auditWithin,
    );
    expect(res.ivaTransferPct).toBe(50);
    expect(res.preview.samplePriceCents).toBe(L);
    expect(res.preview.netDeltaPerUnitCents).toBe(-690);
    expect(h.dial()).toBe(50);
    expect(h.audited).toHaveLength(1);
  });

  it('⭐ y el `409 IVA_TRANSFER_ACK_STALE` sigue vivo: con el `L` canónico y un delta falso, `409`', async () => {
    // *El `422` nuevo NO se comió al `409`.* Si lo hubiera hecho, la puerta habría cambiado de
    // significado en silencio: dejaría de comprobar la CIFRA para comprobar solo el `L`.
    const h = harness();
    const err: BusinessException = await h.svc
      .setIvaTransferPct(
        { ivaTransferPct: 50, acknowledgement: { samplePriceCents: L, previewedNetDeltaCents: 0 } },
        'u1',
        auditWithin,
      )
      .catch((e) => e);
    expect(err.code).toBe('IVA_TRANSFER_ACK_STALE');
    expect(err.getStatus()).toBe(409);
    expect(err.details).toEqual({ expectedNetDeltaCents: -690 });
    expect(h.dial()).toBe(100);
  });

  it.each([
    ['literal decimal', 10000],
    ['notación científica', 1e4],
    ['hexadecimal', 0x2710],
    ['separadores de millar', 10_000],
  ])('⭐ %s: es EL MISMO NÚMERO ⇒ se acepta (⛔ no se compara la forma escrita, se compara el valor)', (_n, v) => {
    // *El acuse vive en JSON: `1e4` y `10000` llegan como el mismo `number`.* Rechazarlos por su
    // forma sería inventar una regla que el transporte no puede sostener.
    expect(validateAckSamplePriceCents(v)).toBeNull();
  });
});

describe('⛔ POR DEFECTO: ningún otro valor pasa — incluidos los bordes que el pentester probó', () => {
  // La batería del `/preview` (`PENTEST_NOTES · REL-E`) más los vecinos del canónico. Ahí daban
  // `400` limpio sobre la query; aquí tienen que dar `422` sobre el cuerpo (§0-Q punto 2: *«es
  // query, no cuerpo»*; ⛔ no se «armoniza»).
  const RECHAZADOS: Array<[string, unknown]> = [
    ['el `1` del PoC', 1],
    ['el `0` que el validador viejo SÍ paraba', 0],
    ['negativo', -1],
    ['el umbral de redondeo `10`', 10],
    ['`30` (delta −2: «poquito» no es «el canónico»)', 30],
    ['un vecino por debajo', 9_999],
    ['un vecino por arriba', 10_001],
    ['un `L` grande y plausible', 50_000],
    ['el tope del `/preview`', IVA_TRANSFER_SAMPLE_PRICE_CENTS_MAX],
    ['justo por encima del tope', IVA_TRANSFER_SAMPLE_PRICE_CENTS_MAX + 1],
    ['el `2e9` que hacía lanzar a `grossUpTotal`', 2_000_000_000],
    ['decimal', 1.5],
    ['el canónico con medio centavo', 10_000.5],
    ['el canónico como CADENA', '10000'],
    ['científica como CADENA', '1e4'],
    ['Infinity', Infinity],
    ['-Infinity', -Infinity],
    ['NaN', NaN],
    ['null', null],
    ['booleano', true],
    ['objeto', {}],
    ['array', []],
    ['el canónico envuelto en un array', [10_000]],
    ['`Number` boxeado', new Number(10_000)],
    ['`MAX_SAFE_INTEGER` (el techo del entero exacto en JS)', Number.MAX_SAFE_INTEGER],
  ];

  it.each(RECHAZADOS)('⛔ %s ⇒ el validador lo rechaza', (_n, v) => {
    expect(validateAckSamplePriceCents(v)).not.toBeNull();
  });

  it.each(RECHAZADOS)('⛔ %s ⇒ `422`, dial en 100, sin bitácora y SIN candado', async (_n, v) => {
    const h = harness();
    const err: BusinessException = await h.svc
      .setIvaTransferPct(
        { ivaTransferPct: 50, acknowledgement: { samplePriceCents: v, previewedNetDeltaCents: 0 } },
        'u1',
        auditWithin,
      )
      .catch((e) => e);
    expect(err).toBeInstanceOf(BusinessException);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.getStatus()).toBe(422);
    expect(err.details).toMatchObject({ field: 'acknowledgement.samplePriceCents' });
    expect(h.dial()).toBe(100);
    expect(h.audited).toHaveLength(0);
    expect(h.locks).toEqual([]);
  });

  it('⛔ `samplePriceCents: undefined` sigue siendo ACUSE A MEDIAS ⇒ `IVA_TRANSFER_ACK_REQUIRED`', async () => {
    // *La ausencia y la mentira no son el mismo error, y el contrato les da códigos distintos.* Este
    // camino NO cambia con `D-ACUSE-1`: un acuse a medias es la ausencia de acuse.
    const h = harness();
    const err: BusinessException = await h.svc
      .setIvaTransferPct(
        { ivaTransferPct: 50, acknowledgement: { previewedNetDeltaCents: -690 } },
        'u1',
        auditWithin,
      )
      .catch((e) => e);
    expect(err.code).toBe('IVA_TRANSFER_ACK_REQUIRED');
    expect(h.dial()).toBe(100);
  });
});

// =================================================================================================
// 4 · ANTES DE COMPARAR
// =================================================================================================
describe('⭐⭐ el `422` llega ANTES de comparar el delta (⛔ no después, y la diferencia se ve)', () => {
  it('⭐⭐ con un `L` no canónico y el delta CANÓNICO correcto (`−690`) ⇒ `422`, ⛔ no `200`', async () => {
    // Es el caso que distingue «se valida antes» de «se valida después»: la cifra confirmada es la
    // que el servidor recalcularía al `L` canónico, así que una implementación que comparara primero
    // y validara después **escribiría**.
    const h = harness();
    const err: BusinessException = await h.svc
      .setIvaTransferPct(
        { ivaTransferPct: 50, acknowledgement: { samplePriceCents: 50_000, previewedNetDeltaCents: -690 } },
        'u1',
        auditWithin,
      )
      .catch((e) => e);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.code).not.toBe('IVA_TRANSFER_ACK_STALE');
    expect(h.dial()).toBe(100);
  });

  it('⭐ y con un `L` no canónico y SU PROPIO delta correcto (`−3448` a `L = 50 000`) ⇒ `422`', async () => {
    // Antes de `D-ACUSE-1` esto era un **`200`**: el acuse se validaba «contra SU `samplePriceCents`».
    // Ese era el agujero entero, y `L = 50 000` solo era su versión respetable.
    const h = harness();
    expect(delta(100, 50, 16, 50_000)).toBe(-3_448);
    const err: BusinessException = await h.svc
      .setIvaTransferPct(
        { ivaTransferPct: 50, acknowledgement: { samplePriceCents: 50_000, previewedNetDeltaCents: -3_448 } },
        'u1',
        auditWithin,
      )
      .catch((e) => e);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(h.dial()).toBe(100);
  });

  it('⛔ el `L` del cuerpo tampoco decide el `expectedNetDeltaCents` que viaja en el `409`', async () => {
    // Un `409` cuyo `expected` se hubiera calculado con el `L` del llamante le estaría **dictando la
    // cifra a reintentar** desde su propio argumento: el acuse se cerraría solo.
    const h = harness();
    const err: BusinessException = await h.svc
      .setIvaTransferPct(
        { ivaTransferPct: 0, acknowledgement: { samplePriceCents: L, previewedNetDeltaCents: -1 } },
        'u1',
        auditWithin,
      )
      .catch((e) => e);
    expect(err.code).toBe('IVA_TRANSFER_ACK_STALE');
    expect(err.details).toEqual({ expectedNetDeltaCents: delta(100, 0, 16, L) });
    expect(err.details).toEqual({ expectedNetDeltaCents: -1_379 });
  });
});

// =================================================================================================
// 5 · EL COROLARIO — EXPLORAR ES LIBRE
// =================================================================================================
describe('⭐⭐ ⛔ el eje del `/preview` NO se toca: explorar es libre, acusar es sobre una magnitud fija', () => {
  it.each([1, 2, 10, 200_000, 50_000, IVA_TRANSFER_SAMPLE_PRICE_CENTS_MAX])(
    '`previewIvaTransfer(50, %i)` responde 200 (lectura SIN efectos)',
    async (sample) => {
      const h = harness();
      const pv = await h.svc.previewIvaTransfer(50, sample);
      expect(pv.samplePriceCents).toBe(sample);
      expect(pv.current.ivaTransferPct).toBe(100);
      expect(pv.proposed.ivaTransferPct).toBe(50);
      // ⛔ Y preguntar NO mueve el dial ni deja bitácora.
      expect(h.dial()).toBe(100);
      expect(h.audited).toHaveLength(0);
    },
  );

  it('⭐ «¿y sobre una pieza de MX$2 000?» tiene respuesta, y es −13 793 centavos', async () => {
    // La pregunta que el corolario protege, con su número. *Si el `/preview` perdiera el eje, la
    // norma habría dejado de ser un control para ser una amputación.*
    //
    // ⚠️ **Y el número NO es `20 × −690`.** Escribí `−13 800` de cabeza y la suite lo puso rojo:
    // vale **`−13 793`**. El delta ⛔ no es lineal en `L` porque la base se redondea a centavo en
    // cada posición, así que multiplicar la cifra del criterio 188 por veinte da **7 centavos de
    // más**. *Es la misma clase de error que el acuse existe para impedir —una cifra de dinero
    // derivada de cabeza en vez de calculada por el servidor— y por eso se deja escrita aquí.*
    const h = harness();
    const pv = await h.svc.previewIvaTransfer(50, 200_000);
    expect(pv.netDeltaPerUnitCents).toBe(-13_793);
    expect(pv.netDeltaPerUnitCents).not.toBe(20 * -690);
  });

  it('⭐ el `L = 1` del PoC sigue respondiendo `0` en el `/preview`, y eso es CORRECTO', async () => {
    // *Un `0` leído es una verdad sobre un `L` diminuto; un `0` FIRMADO era una mentira sobre el
    // catálogo entero.* La diferencia no está en la cifra: está en si tiene efectos.
    const h = harness();
    expect((await h.svc.previewIvaTransfer(50, 1)).netDeltaPerUnitCents).toBe(0);
    expect(h.dial()).toBe(100);
  });
});

// =================================================================================================
// 6 · LO QUE NO SE AÑADIÓ
// =================================================================================================
describe('⛔ NINGUNA comprobación de «delta ≠ 0» en ejecución: con `iva_pct = 0` el dial NO queda encerrado', () => {
  it('⭐⭐ con la tasa en 0, mover `100 → 50` cuesta `0` **de verdad**, y el acuse de `0` ESCRIBE', async () => {
    // *Un acuse de cero deja de ser un problema en cuanto no se puede fabricar.* Con `r = 0` no hay
    // IVA que trasladar ⇒ mover el dial no cuesta nada, y bloquearlo dejaría el dial **encerrado** en
    // esa configuración: el dueño no podría volver a subirlo sin cambiar antes la tasa.
    const h = harness({ [SettingKey.IVA_PCT]: 0 });
    expect(delta(100, 50, 0, L)).toBe(0);
    const res = await h.svc.setIvaTransferPct(
      { ivaTransferPct: 50, acknowledgement: { samplePriceCents: L, previewedNetDeltaCents: 0 } },
      'u1',
      auditWithin,
    );
    expect(res.ivaTransferPct).toBe(50);
    expect(h.dial()).toBe(50);
    expect(h.audited).toHaveLength(1);
  });

  it('⭐ y el camino de vuelta también: con `r = 0` se puede volver a 100 acusando `0`', async () => {
    const h = harness({ [SettingKey.IVA_PCT]: 0, [SettingKey.IVA_TRANSFER_PCT]: 0 });
    const res = await h.svc.setIvaTransferPct(
      { ivaTransferPct: 100, acknowledgement: { samplePriceCents: L, previewedNetDeltaCents: 0 } },
      'u1',
      auditWithin,
    );
    expect(res.ivaTransferPct).toBe(100);
    expect(h.dial()).toBe(100);
  });
});

// =================================================================================================
// 7 · `IVA-14` Y SU CANARIO
// =================================================================================================

/**
 * Cuenta los movimientos de **un punto** (`t → t+1`) cuyo `netDeltaPerUnitCents` es **0**, barriendo
 * `r ∈ [rMin, 100]` y `t ∈ [0, 99]`. Sale del código REAL (`ivaTransferPreview`), ⛔ no de una
 * reimplementación de la aritmética dentro del test — que es como un candado acaba midiéndose a sí
 * mismo.
 */
function cerosDeUnPunto(samplePriceCents: number, rMin: number): number {
  let ceros = 0;
  for (let r = rMin; r <= 100; r++) {
    for (let t = 0; t < 100; t++) {
      if (delta(t, t + 1, r, samplePriceCents) === 0) ceros++;
    }
  }
  return ceros;
}

describe('⭐⭐ candado `IVA-14` — con el `L` canónico, mover el dial CUESTA, y bajar la constante pone ROJO', () => {
  it('⭐⭐ la constante ESTÁ FIJADA en 10 000 (MX$100.00) — cualquier cambio pasa por aquí', () => {
    // *La mitad tautológica del candado, y hace falta:* es lo que garantiza que nadie la baje «un
    // poquito» por debajo del radar del barrido. El porqué del número lo dan los `it` de abajo.
    expect(IVA_TRANSFER_SAMPLE_PRICE_CENTS_DEFAULT).toBe(10_000);
  });

  it('⭐ las CIFRAS DE CONTROL del contrato: `r=16`, `100 → 99 ⇒ −14`; `100 → 50 ⇒ −690`', () => {
    expect(delta(100, 99, 16, L)).toBe(-14);
    expect(delta(100, 50, 16, L)).toBe(-690);
  });

  it('⭐⭐ con `r ≥ 2`: **9 900** movimientos de un punto y ⛔ **CERO** deltas nulos', () => {
    expect(cerosDeUnPunto(L, 2)).toBe(0);
  });

  it('⚠️ con `r = 1` hay **exactamente UNO**, y es un empate de redondeo REAL (`49 → 50`)', () => {
    // ⚠️ **Aquí es donde este fichero refuta al contrato**, que escribe «`r ≥ 1` ⇒ todos». Se
    // documenta con su aritmética entera para que nadie lo lea como un bug: `P(49) = 10049` y
    // `P(50) = 10050`; las dos bases son `round(P·100/101) = 9950`. *Es el régimen que el propio
    // arquitecto señaló al descartar la cota inferior: con `r = 1` haría falta `L ≳ 5 050`.*
    expect(cerosDeUnPunto(L, 1)).toBe(1);
    expect(delta(49, 50, 1, L)).toBe(0);
    // Y es el ÚNICO de toda la fila `r = 1`: sus 99 vecinos sí cuestan.
    const otros = Array.from({ length: 100 }, (_, t) => t).filter(
      (t) => t !== 49 && delta(t, t + 1, 1, L) === 0,
    );
    expect(otros).toEqual([]);
  });

  it.each([
    // [`L` rebajado, ceros con `r ≥ 1`, ceros con `r ≥ 2`]
    [9_000, 12, 1],
    [5_000, 54, 4],
    [1_000, 551, 461],
    [100, 6_905, 6_806],
    [10, 9_689, 9_589],
    [1, 10_000, 9_900],
  ])(
    '⭐⭐ EL CANARIO — si la constante bajara a %i, el barrido daría %i / %i ceros ⇒ **ROJO**',
    (rebajado, esperadosR1, esperadosR2) => {
      // *Sin canario, el candado no está demostrado.* Esto ejecuta el MISMO barrido con la constante
      // rebajada y comprueba (a) que el número crece, y (b) que el `toBe(0)` del `it` de `r ≥ 2` de
      // arriba **fallaría** con ese valor. Es la mutación, corrida como dato en vez de a mano.
      expect(cerosDeUnPunto(rebajado, 1)).toBe(esperadosR1);
      expect(cerosDeUnPunto(rebajado, 2)).toBe(esperadosR2);
      expect(cerosDeUnPunto(rebajado, 2)).toBeGreaterThan(cerosDeUnPunto(L, 2));
      expect(cerosDeUnPunto(rebajado, 1)).toBeGreaterThan(cerosDeUnPunto(L, 1));
    },
  );

  it('⭐ y en el extremo, `L = 1` vuelve el acuse un NO-OP total: `r ≥ 1` ⇒ los 10 000 movimientos dan 0', () => {
    // Es `REL-A` dicho como número: con el `L` del PoC, **ninguna** posición del dial cuesta nada.
    expect(cerosDeUnPunto(1, 1)).toBe(10_000);
  });
});

// =================================================================================================
// 8 · `D-ACUSE-1` POR AUSENCIA, SOBRE EL CÓDIGO
// =================================================================================================
describe('⛔⛔ `D-ACUSE-1` por AUSENCIA: la escritura deriva el `L` de la CONSTANTE, no del cuerpo', () => {
  /**
   * ⭐ Por qué un candado sobre el CÓDIGO además de los de conducta. El `422` garantiza que los dos
   * números son iguales **hoy**; lo que este `it` vigila es **la dirección del dato**. Si mañana
   * alguien relajara el validador (una cota, un rango, un «solo para pruebas») y la escritura
   * siguiera leyendo `ack.samplePriceCents`, `REL-A` volvería entera **sin que ninguna prueba de
   * conducta cambiara de color**, porque las de arriba pasan el canónico. *El candado que detecta
   * que se reabrió la elección al llamante tiene que mirar de dónde sale el número.*
   */
  const codigo = codigoDeFichero(join(__dirname, '../src/modules/settings/settings.service.ts'), [
    'async setIvaTransferPct(',
    'private parseIvaTransferAck(',
  ]);
  const cuerpo = codigo.slice(
    codigo.indexOf('async setIvaTransferPct('),
    codigo.indexOf('private parseIvaTransferAck('),
  );

  it('el recorte no está vacío (control: si el limpiador se comiera la región, esto no mediría nada)', () => {
    expect(cuerpo).toContain('lockIvaTransferGate(tx)');
    expect(cuerpo).toContain('ivaTransferPreview({');
    expect(cuerpo.length).toBeGreaterThan(500);
  });

  it('⭐⭐ el `samplePriceCents` de la escritura sale de `IVA_TRANSFER_SAMPLE_PRICE_CENTS_DEFAULT`', () => {
    expect(cuerpo).toMatch(/const samplePriceCents = IVA_TRANSFER_SAMPLE_PRICE_CENTS_DEFAULT;/);
  });

  it('⛔⛔ y el cuerpo de la escritura ⛔ NO lee `ack.samplePriceCents` en NINGUNA forma', () => {
    // Rojo ante `ack.samplePriceCents`, `ack?.samplePriceCents`, `ack!.samplePriceCents` y
    // `ack['samplePriceCents']`. (Los comentarios ya no cuentan: `codigoDeFichero` los quita.)
    expect(cuerpo).not.toMatch(/ack\s*[?!]?\s*\.\s*samplePriceCents/);
    expect(cuerpo).not.toMatch(/ack\s*[?!]?\s*\[\s*['"`]samplePriceCents/);
  });

  it('⭐ el validador del acuse es el CANÓNICO, no un rango (`parseIvaTransferAck` llama al de clase)', () => {
    expect(codigo).toContain('validateAckSamplePriceCents(obj.samplePriceCents)');
    // ⛔ Y el validador de RANGO del `/preview` no vuelve por esta puerta.
    expect(codigo).not.toContain('validateSamplePriceCents(');
  });
});
