/**
 * no-lock-attempts.ts — v1.80.9.1 (TD-9, `API_CONTRACT §M6-U.7`): `AdminService` sin `PasswordAttemptsService` ya NO
 * resuelve `lockState:'unavailable'` en el listado ni en la ficha: lanza (error de cableado, SEC-C7-OPT). Los unitarios
 * que construyen el servicio a mano y no miden el candado ajustan su FIXTURE con este doble (⛔ no su aserción):
 * almacén sano y sin candado ⇒ `lockState:'ok'`, `lockedUntil:null`. Propiedad: backend.
 */
import { PasswordAttemptsService } from '../../src/modules/auth/password-attempts.service';

export function noLockAttempts(): PasswordAttemptsService {
  return { lockMsForUser: async () => 0 } as unknown as PasswordAttemptsService;
}
