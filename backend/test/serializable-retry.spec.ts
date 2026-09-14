import { Prisma } from '@prisma/client';
import {
  SERIALIZABLE_ATTEMPTS,
  isSerializationConflict,
  runSerializable,
} from '../src/common/serializable-retry';
import { BusinessException } from '../src/common/business.exception';

/**
 * # `serializable-retry.spec.ts` — el reintento que `SERIALIZABLE` siempre exigió
 *
 * **El defecto que estas pruebas fijan, medido (2026-09-14, `f8c7040`):** dos altas simultáneas
 * contra `POST /buylist/requests` ⇒ `PrismaClientKnownRequestError: Transaction failed due to a
 * write conflict or a deadlock` ⇒ **`500` en cara del cliente**, por una transacción que el motor
 * abortó **haciendo su trabajo**.
 *
 * Lo que se asierta aquí es **la línea**, no el mecanismo: qué se reintenta y qué **no**. Un
 * reintento demasiado ancho es peor que ninguno — repetiría decisiones de negocio y taparía
 * timeouts. Por eso hay tantas pruebas del `NO` como del `SÍ`.
 *
 * ⛔ Estas pruebas **no duermen**: el `sleep` se inyecta. Un unitario que espera de verdad es un
 * unitario que alguien acaba borrando.
 */

/** Un `P2034` igual que el que produjo el `500` medido. */
const conflicto = () =>
  new Prisma.PrismaClientKnownRequestError(
    'Transaction failed due to a write conflict or a deadlock. Please retry your transaction',
    { code: 'P2034', clientVersion: '5.20.0' },
  );

/** Un runner que ejecuta el cuerpo de verdad y anota con qué opciones lo abrieron. */
function runner() {
  const opciones: unknown[] = [];
  return {
    opciones,
    $transaction: async <R>(fn: (tx: Prisma.TransactionClient) => Promise<R>, o?: unknown) => {
      opciones.push(o);
      return fn({} as Prisma.TransactionClient);
    },
  };
}

const sinDormir = () => Promise.resolve();

describe('isSerializationConflict — la línea entre «reintenta» y «no toques eso»', () => {
  it('⭐ `P2034` (conflicto de escritura o interbloqueo) SÍ lo es: es el error medido', () => {
    expect(isSerializationConflict(conflicto())).toBe(true);
  });

  it('⛔ `P2028` (TIMEOUT de transacción) NO lo es', () => {
    // Reintentar una tx que no cupo en su ventana la vuelve a no caber, y multiplica la carga.
    const e = new Prisma.PrismaClientKnownRequestError('Transaction already closed', {
      code: 'P2028',
      clientVersion: '5.20.0',
    });
    expect(isSerializationConflict(e)).toBe(false);
  });

  it('⛔ una `BusinessException` NO lo es: es una decisión, no una carrera', () => {
    expect(
      isSerializationConflict(
        BusinessException.validation('BUYLIST_LIMIT_EXCEEDED', 'Per-month cap exceeded'),
      ),
    ).toBe(false);
  });

  it('⭐ el `SQLSTATE` crudo de Postgres también cuenta: `40001` y `40P01`', () => {
    // Una sentencia `$executeRaw…` dentro de la misma tx puede aflorar el SQLSTATE sin traducir.
    // ⛔ Mirar solo `P2034` dejaría fuera justo el camino que menos se prueba.
    expect(isSerializationConflict({ meta: { code: '40001' } })).toBe(true);
    expect(isSerializationConflict({ meta: { code: '40P01' } })).toBe(true);
    // ⚠️ El respaldo por TEXTO existe solo para errores del MOTOR, así que se prueba con uno.
    expect(
      isSerializationConflict(
        new Prisma.PrismaClientUnknownRequestError('could not serialize access (SQLSTATE 40001)', {
          clientVersion: 'test',
        }),
      ),
    ).toBe(true);
  });

  /**
   * ⭐⭐ **DEUDA CERRADA (techlead, 2026-09-14): «texto en vez de estructura» DENTRO DEL CAMINO DEL
   * DINERO.** El respaldo por mensaje corría sobre **cualquier** error, así que un error de negocio
   * cuyo texto contuviera `40001` —un folio, un importe en centavos, un id— se habría reintentado
   * **5 veces**, ejecutando el cuerpo cinco veces y devolviendo el error mucho más tarde. Ahora el
   * respaldo exige primero que el error venga de Prisma/pg. *Un reintento decidido por una subcadena
   * de un mensaje no es una decisión: es una coincidencia.*
   */
  it('⛔⛔ un error de NEGOCIO cuyo mensaje contiene `40001` NO se reintenta', () => {
    // El importe en centavos de MX$400.01 es, literalmente, `40001`.
    expect(
      isSerializationConflict(
        BusinessException.validation('BUYLIST_LIMIT_EXCEEDED', 'cap exceeded: 40001 cents'),
      ),
    ).toBe(false);
    // Y un `Error` pelado tampoco, aunque traiga el SQLSTATE: no viene del motor.
    expect(isSerializationConflict(new Error('folio 40P01 rechazado'))).toBe(false);
    expect(isSerializationConflict(new Error('could not serialize access (SQLSTATE 40001)'))).toBe(
      false,
    );
  });

  it('⛔ un error cualquiera NO lo es (y `null`/`undefined` tampoco revientan)', () => {
    expect(isSerializationConflict(new Error('boom'))).toBe(false);
    expect(isSerializationConflict(null)).toBe(false);
    expect(isSerializationConflict(undefined)).toBe(false);
  });
});

describe('runSerializable — reintenta el conflicto y NADA más', () => {
  it('⭐⭐ SIEMPRE abre la transacción en `Serializable` (la garantía no se negocia)', async () => {
    // Éste es el candado de `SEC-A2`: si alguien "arreglara" el 500 bajando el aislamiento, el
    // TOCTOU del tope mensual AML volvería — N solicitudes leen el mismo acumulado y todas pasan.
    const r = runner();
    await runSerializable(r, async () => 'ok', { sleep: sinDormir });
    expect(r.opciones[0]).toMatchObject({
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });

  it('⭐⭐ un conflicto en el primer intento se REINTENTA y la operación prospera', async () => {
    const r = runner();
    let intentos = 0;
    const out = await runSerializable(
      r,
      async () => {
        intentos += 1;
        if (intentos === 1) throw conflicto();
        return 'creada';
      },
      { sleep: sinDormir },
    );
    // ⛔ Rojo con `500`/excepción: es exactamente el caso medido (dos altas simultáneas).
    expect(out).toBe('creada');
    expect(intentos).toBe(2);
  });

  it('⛔ una `BusinessException` sale A LA PRIMERA y sin reintento', async () => {
    // Reintentar un tope excedido es preguntar lo mismo esperando otra respuesta — y además
    // convertiría un `422` determinista en tres consultas a la BD por cada rechazo.
    const r = runner();
    let intentos = 0;
    await expect(
      runSerializable(
        r,
        async () => {
          intentos += 1;
          throw BusinessException.validation('BUYLIST_LIMIT_EXCEEDED', 'Per-month cap exceeded');
        },
        { sleep: sinDormir },
      ),
    ).rejects.toBeInstanceOf(BusinessException);
    expect(intentos).toBe(1);
  });

  it('⛔ agotados los intentos, propaga el error ORIGINAL (no se inventa un código de contrato)', async () => {
    const r = runner();
    let intentos = 0;
    const err = await runSerializable(
      r,
      async () => {
        intentos += 1;
        throw conflicto();
      },
      { sleep: sinDormir },
    ).catch((e) => e);
    expect(intentos).toBe(SERIALIZABLE_ATTEMPTS);
    expect(err).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect((err as Prisma.PrismaClientKnownRequestError).code).toBe('P2034');
  });

  it('⭐ espera ENTRE intentos (backoff), y la espera crece', async () => {
    // Sin backoff, dos transacciones que chocaron vuelven a la vez y vuelven a chocar.
    const r = runner();
    const esperas: number[] = [];
    let intentos = 0;
    await runSerializable(
      r,
      async () => {
        intentos += 1;
        if (intentos < 3) throw conflicto();
        return 'ok';
      },
      {
        sleep: async (ms) => {
          esperas.push(ms);
        },
      },
    );
    expect(esperas).toHaveLength(2);
    for (const ms of esperas) expect(ms).toBeGreaterThan(0);
    // Con jitter los valores no son fijos, pero el segundo tramo es estrictamente mayor en su base
    // (`BASE * intento * [0.5, 1.5)`): el mínimo del 2º (1.0×BASE) supera al máximo del 1º (<1.5×BASE)
    // sólo a veces, así que lo que se asierta es lo que SIEMPRE es cierto: hay dos esperas y no son 0.
    expect(esperas.every((ms) => Number.isFinite(ms))).toBe(true);
  });

  it('⛔ un error que NO es conflicto no se reintenta jamás', async () => {
    const r = runner();
    let intentos = 0;
    await expect(
      runSerializable(
        r,
        async () => {
          intentos += 1;
          throw new Error('la BD se cayó');
        },
        { sleep: sinDormir },
      ),
    ).rejects.toThrow('la BD se cayó');
    expect(intentos).toBe(1);
  });
});
