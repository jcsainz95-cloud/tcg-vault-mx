import { UsersService } from '../../src/modules/users/users.service';

/**
 * ⭐ **v1.70 (`C15`/`C17`) — el doble de `UsersService` para los specs de buylist que pasan keys de
 * INE sin estar probando la compuerta de identidad.**
 *
 * ### Por qué existe
 * `BuylistService.createRequest` ya no escribe las keys del INE por su cuenta: llama a
 * `UsersService.buildIneSubmission`, que es **la única rutina de escritura** de los dos caminos
 * (`C17`) y donde vive la compuerta de `C15` (la key tiene que salir de un presign de ESE usuario y
 * su objeto tiene que existir). Los specs que construían el servicio con `{} as UsersService` y
 * pasaban `{front:'k-front', back:'k-back'}` **para esquivar el `422 INE_REQUIRED`** ya no pueden:
 * ese `{}` no tiene el método.
 *
 * ⛔ **Este doble NO relaja la compuerta del producto**: reemplaza al colaborador entero en specs que
 * miden **otra cosa** (precio, acabado, línea de producto). La compuerta se mide donde le toca —
 * `test/uploads.ine-key-gate.spec.ts` y `test/users.kyc-cycle.spec.ts`—, con la key de verdad.
 *
 * ⚠️ Y devuelve **lo mismo** que la rutina real para unas keys válidas: `data` con las dos columnas
 * y el estado a `pending` (§M6-K.4.1 / A6). Un doble que devolviera `{}` escondería la mitad del
 * cambio que `C17` introduce.
 */
export function usersServiceDouble(
  overrides: Partial<Record<'buildIneSubmission' | 'purgeSupersededIneObjects', unknown>> = {},
): UsersService {
  return {
    buildIneSubmission: jest.fn(
      async (_userId: string, keys: { front?: string | null; back?: string | null }) => ({
        data: {
          ...(keys.front ? { ineFrontKey: keys.front } : {}),
          ...(keys.back ? { ineBackKey: keys.back } : {}),
          ...(keys.front || keys.back
            ? { kycStatus: 'pending', rejectionReason: null, reviewedAt: null, reviewedBy: null }
            : {}),
        },
        supersededKeys: [] as string[],
      }),
    ),
    purgeSupersededIneObjects: jest.fn(async () => undefined),
    ...overrides,
  } as unknown as UsersService;
}
