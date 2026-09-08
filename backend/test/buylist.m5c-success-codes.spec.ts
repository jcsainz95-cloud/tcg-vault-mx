import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { AdminBuylistController } from '../src/modules/buylist/admin-buylist.controller';

/**
 * `buylist.m5c-success-codes.spec.ts` — **§M5-C (contrato v1.57, `BL-37`): los códigos de éxito del
 * ciclo de buylist.**
 *
 * ### La norma, en una línea
 * En el ciclo de buylist, **`201` es exclusivamente del endpoint que CREA una `SellRequest`**
 * (`POST /buylist/requests`, §6). **Todo verbo que opera sobre una solicitud EXISTENTE responde
 * `200`**, tenga o no rama idempotente.
 *
 * ### Por qué existe este guard y no basta con haber puesto los nueve decoradores
 * El defecto **no era un código mal escrito: era un código NO escrito.** Un `@Post` sin `@HttpCode`
 * hereda el `201` del framework **en silencio**, así que la divergencia no se ve en el diff, no la
 * ve el compilador y solo aparece disparando el endpoint. Nueve endpoints la acumularon durante
 * versiones; **el décimo la heredaría igual.** *Un default del framework que contradice al contrato
 * necesita un test, no un recordatorio.*
 *
 * ⚠️ **El caso que lo vuelve obligatorio y no estético es `pay-spei`:** la tabla de §M5 declara
 * **`200` idempotente** cuando `status === 'pagada'`, y el código respondía `201`. **Eso no era un
 * código sin declarar: era una tabla NORMATIVA que el código contradecía.**
 *
 * ### La ÚNICA excepción, y va nombrada (si no, este test es una lista negra que se pudre)
 * `POST :id/offer` fija su código **por resultado** (`200` sale la oferta · `202` queda pendiente de
 * autorización) usando `@Res`. Un `@HttpCode` estático **mentiría en la mitad de los casos**.
 */
describe('§M5-C · BL-37 — todo `POST` del ciclo que opera sobre una solicitud existente responde 200', () => {
  const proto = AdminBuylistController.prototype as unknown as Record<string, object>;

  /** Las rutas del controller, leídas de los decoradores REALES (no de una lista a mano). */
  const rutas = Object.getOwnPropertyNames(proto)
    .filter((m) => m !== 'constructor')
    .map((m) => ({
      handler: m,
      path: Reflect.getMetadata(PATH_METADATA, proto[m]) as string | undefined,
      method: Reflect.getMetadata(METHOD_METADATA, proto[m]) as RequestMethod | undefined,
      code: Reflect.getMetadata(HTTP_CODE_METADATA, proto[m]) as number | undefined,
    }))
    .filter((r) => r.path !== undefined);

  /**
   * ⚠️ **Se declara por NOMBRE y con su razón.** Una excepción anónima («todos menos éste») es la
   * puerta por la que entra la siguiente: dentro de un año nadie sabría si `offer` está fuera porque
   * es dinámico o porque a alguien se le olvidó.
   */
  const DINAMICO_POR_RESULTADO = new Set(['offer']);

  it('el barrido encuentra los POST del ciclo (si esto baja, el guard dejó de mirar el controller)', () => {
    const posts = rutas.filter((r) => r.method === RequestMethod.POST);
    // Nueve alineados en v1.57 + `receive`/`verify` (ya alineados en v1.56) + el dinámico.
    expect(posts.length).toBeGreaterThanOrEqual(12);
  });

  it.each(
    rutas
      .filter((r) => r.method === RequestMethod.POST && !DINAMICO_POR_RESULTADO.has(r.handler))
      .map((r) => [r.handler, r.path, r.code] as const),
  )('`POST %s` (%s) ⇒ @HttpCode(200), no el 201 del framework', (_h, _p, code) => {
    expect(code).toBe(200);
  });

  it('⚠️ la ÚNICA excepción es `POST :id/offer`, y es por RESULTADO (200 | 202), no por olvido', () => {
    const offer = rutas.find((r) => r.handler === 'offer')!;
    expect(offer.path).toBe(':id/offer');
    // No lleva `@HttpCode` **a propósito**: lo fija por `@Res` según salga la oferta o quede
    // pendiente de autorización. Si algún día ganara uno estático, mentiría en la mitad de los casos.
    expect(offer.code).toBeUndefined();
  });

  it('los `PATCH` no entran a la norma: el framework ya les da 200', () => {
    // Se afirma para que nadie «complete» la lista añadiéndoles un `@HttpCode` redundante.
    const patches = rutas.filter((r) => r.method === RequestMethod.PATCH);
    expect(patches.length).toBeGreaterThan(0);
    for (const p of patches) expect(p.code).toBeUndefined();
  });
});
