/**
 * # busy-try-again.spec.ts — ⭐⭐ **`§0-T`: EL FALLO TRANSITORIO DEL MOTOR DEJA DE SER UN `500`**
 * (`API_CONTRACT §0-T`, v1.76, NORMATIVO y TRANSVERSAL · `ARCHITECTURE §4.56.2`.)
 *
 * > *Un `500` afirma «se rompió algo». Cuando Postgres aborta una transacción serializable, o una
 * > transacción no cabe en su ventana, ⛔ no se rompió nada y ⛔ no se escribió nada: el motor hizo su
 * > trabajo.* Decirle `500` al cliente describe mal su situación **y** le quita la única acción que
 * > le sirve.
 *
 * ⚠️ **La mitad que más vigila este fichero no es la que traduce: es la que NO traduce.** `§0-T`
 * regla 3 prohíbe el mapeo global de Prisma, y esa prohibición es **más fácil de romper que de
 * cumplir**: añadir `P2002 → 409` parece higiene y cambiaría en silencio la conducta de decenas de
 * rutas que ya tienen su propia semántica de conflicto. Aquí se mide **por exceso**: cinco códigos de
 * Prisma que **tienen que seguir saliendo `500`**.
 */
import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { BusinessException } from '../src/common/business.exception';
import { ErrorCode } from '../src/common/error-codes';

function respuesta() {
  const res: any = {
    statusCode: 0,
    body: undefined as any,
    headers: {} as Record<string, string>,
    setHeader: jest.fn((k: string, v: string) => {
      res.headers[k] = v;
    }),
    status: jest.fn((s: number) => {
      res.statusCode = s;
      return res;
    }),
    json: jest.fn((b: unknown) => {
      res.body = b;
      return res;
    }),
  };
  return res;
}

function lanzar(e: unknown) {
  const res = respuesta();
  const host = {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({}) }),
  } as unknown as ArgumentsHost;
  new AllExceptionsFilter().catch(e, host);
  return res;
}

const prismaError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('boom', { code, clientVersion: 'test' });

describe('⭐⭐ §0-T — los DOS casos transitorios salen `503 BUSY_TRY_AGAIN`', () => {
  it.each([
    ['P2034 (conflicto de escritura / interbloqueo)', prismaError('P2034')],
    ['P2028 (timeout de transacción)', prismaError('P2028')],
    [
      'SQLSTATE crudo 40001 en un error del motor',
      new Prisma.PrismaClientUnknownRequestError('could not serialize access (SQLSTATE 40001)', {
        clientVersion: 'test',
      }),
    ],
  ])('%s ⇒ 503 con la forma exacta del contrato', (_nombre, e) => {
    const res = lanzar(e);
    expect(res.statusCode).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect(res.body).toEqual({
      error: {
        code: ErrorCode.BUSY_TRY_AGAIN,
        message: 'the request could not be completed right now; try again',
        // ⛔ VACÍO, y se asierta con igualdad EXACTA: *un dato que el cliente no puede usar,
        // publicado en el contrato, es una promesa que habrá que sostener.*
        details: {},
      },
    });
    // `Retry-After` es NORMATIVO y en SEGUNDOS. Un 503 sin él invita a martillear.
    expect(res.headers['Retry-After']).toBe('1');
  });

  it('⭐ UN código para los DOS casos: el cliente no puede distinguirlos, porque su remedio es igual', () => {
    // §0-T regla 1: este contrato separa códigos **por remedio**, no por causa interna.
    const agotado = lanzar(prismaError('P2034')).body;
    const timeout = lanzar(prismaError('P2028')).body;
    expect(agotado).toEqual(timeout);
  });
});

describe('⛔⛔ §0-T regla 3 — NADA de mapeo global de Prisma (se mide POR EXCESO)', () => {
  it.each(['P2002', 'P2025', 'P2003', 'P2000', 'P1001'])(
    '`%s` sigue saliendo `500 INTERNAL`, exactamente como antes',
    (code) => {
      const res = lanzar(prismaError(code));
      expect(res.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(res.body.error.code).toBe(ErrorCode.INTERNAL);
      // ⛔ Y sin `Retry-After`: un `500` no promete que reintentar sirva de algo.
      expect(res.headers['Retry-After']).toBeUndefined();
    },
  );

  it('un error cualquiera (no Prisma) sigue saliendo `500 INTERNAL`', () => {
    const res = lanzar(new Error('boom'));
    expect(res.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(res.body.error.code).toBe(ErrorCode.INTERNAL);
  });

  /**
   * ⭐⭐ **`BUSY_TRY_AGAIN` NO sustituye a ningún código de negocio** (§0-T regla 6).
   * *Reintentar una regla de negocio es preguntar lo mismo esperando otra respuesta.* Y el caso
   * malicioso está incluido: un error de negocio cuyo **mensaje** contenga `40001` —MX$400.01 en
   * centavos— tampoco se convierte en un `503`, porque `isSerializationConflict` comprueba primero
   * la **forma** del error y solo después el texto.
   */
  it('⛔ una `BusinessException` sale INTACTA y a la primera — incluso si su mensaje dice `40001`', () => {
    const res = lanzar(
      BusinessException.validation('BUYLIST_LIMIT_EXCEEDED', 'cap exceeded: 40001 cents'),
    );
    expect(res.statusCode).toBe(422);
    expect(res.body.error.code).toBe('BUYLIST_LIMIT_EXCEEDED');
    expect(res.headers['Retry-After']).toBeUndefined();
  });

  it('⛔ y una `HttpException` normal tampoco se toca (el 401 del guard sigue siendo 401)', () => {
    const res = lanzar(new HttpException('Unauthorized', 401));
    expect(res.statusCode).toBe(401);
    expect(res.body.error.code).toBe(ErrorCode.UNAUTHENTICATED);
  });
});

describe('⭐ la distinción entre los dos casos vive en el LOG, y ahí es OBLIGATORIA', () => {
  /**
   * `P2028` señala **un defecto nuestro** (algo sostuvo un candado de fila más allá de su ventana);
   * agotar reintentos bajo carga es **la cola esperable**. El cliente ve lo mismo; nosotros **no**.
   * ⛔ Rojo si el log deja de distinguirlos: sería un defecto propio escondido detrás de la cola.
   */
  it.each([
    ['P2028', 'P2028'],
    ['P2034', 'reintentos-agotados'],
  ])('`%s` se loggea con la etiqueta `%s`', (code, etiqueta) => {
    const filtro = new AllExceptionsFilter();
    const spy = jest
      .spyOn((filtro as unknown as { logger: { error: (m: string) => void } }).logger, 'error')
      .mockImplementation(() => undefined);
    const res = respuesta();
    filtro.catch(prismaError(code), {
      switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({}) }),
    } as unknown as ArgumentsHost);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining(`[${etiqueta}]`));
    spy.mockRestore();
  });
});
