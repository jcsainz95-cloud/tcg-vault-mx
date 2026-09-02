/**
 * `buylist-create-gate.ts` — utilidades de test para **LA PUERTA de `POST /buylist/requests`**
 * (v1.51.20 · BL-26). Propiedad: backend.
 *
 * ### Por qué existe
 * Desde BL-26 `createRequest` comprueba **tres** cosas antes de cotizar nada: el **celular** del
 * vendedor (D11), su **dirección de origen** (D36/D37) y el **mínimo de compra** (D18). Las tres son
 * lecturas nuevas (`user`, `address`, un dial más), así que **todo** spec unitario que construya un
 * `PrismaService` a mano tiene que proveerlas o el servicio revienta en la primera línea.
 *
 * Se centralizan aquí por la misma razón por la que el código las centraliza: *si cada spec inventa
 * su propio vendedor con su propia dirección, el día que la puerta cambie habrá que editar quince
 * archivos y alguno se quedará atrás.*
 *
 * ⚠️ **Esto NO sustituye a la prueba de la puerta.** Estos mocks la hacen **pasar** para que los
 * specs que prueban OTRA cosa (CLABE, instrumentación, overrides…) sigan probando esa otra cosa.
 * **La puerta se prueba por HTTP contra BD real** en `test/integration/buylist-cycle.e2e-spec.ts`,
 * que es donde un `422` es un `422` de verdad.
 */

/** El `addressId` que los specs pasan a `createRequest`. */
export const GATE_ADDRESS_ID = 'addr-gate-1';
/** El celular del vendedor. Lo único que la puerta 1 mira es que exista y no sea whitespace. */
export const GATE_PHONE = '5512345678';

/**
 * Fragmentos de `PrismaService` que la puerta necesita: `user.findUnique` (celular) y
 * `address.findUnique` (la libreta del propio vendedor).
 *
 * `ownerUserId` **debe** ser el mismo `userId` con el que el spec llama a `createRequest`: la
 * resolución del snapshot compara `address.userId === ownerUserId` y responde
 * `422 PICKUP_ADDRESS_NOT_FOUND` si no coincide (anti-IDOR, misma respuesta que «no existe»).
 */
export function buylistGateMocks(ownerUserId: string) {
  return {
    user: {
      findUnique: jest.fn(async () => ({ id: ownerUserId, phone: GATE_PHONE })),
    },
    address: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        where.id === GATE_ADDRESS_ID
          ? {
              id: GATE_ADDRESS_ID,
              userId: ownerUserId,
              line1: 'Av. Siempre Viva 742',
              line2: null,
              neighborhood: 'Centro',
              city: 'Ciudad de México',
              state: 'CDMX',
              postalCode: '06000',
              country: 'MX',
              phone: GATE_PHONE,
            }
          : null,
      ),
    },
  };
}

/**
 * Envuelve un `getNumber` de mock para que el **mínimo de compra** no gatee.
 *
 * Los specs unitarios cotizan montos pequeños a propósito (una `Common` de MX$16.67 es el caso que
 * mejor ejercita la curva). Con el dial real —MX$500— ninguna de esas solicitudes se crearía, y el
 * spec dejaría de probar la curva para probar la puerta. **El mínimo se prueba donde se decide**:
 * en la integración por HTTP.
 */
export function withMinimumOff(
  getNumber: (key: string) => Promise<number>,
): (key: string) => Promise<number> {
  return async (key: string) =>
    key === 'buylist_minimum_request_cents' ? 0 : getNumber(key);
}
