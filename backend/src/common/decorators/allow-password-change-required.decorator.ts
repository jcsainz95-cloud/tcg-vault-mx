import { SetMetadata } from '@nestjs/common';

export const ALLOW_PASSWORD_CHANGE_REQUIRED_KEY = 'allowPasswordChangeRequired';

/**
 * v1.67 (contrato §1 «Contraseña temporal obligatoria», ARCHITECTURE §4.47.2) — marca un handler
 * como EXENTO del `403 PASSWORD_CHANGE_REQUIRED` que `PasswordChangeRequiredGuard` impone a toda ruta
 * autenticada mientras `User.mustChangePassword = true`.
 *
 * **Allowlist CERRADA (tres rutas, y nada más):**
 * | Ruta                          | Por qué está                                                        | Dónde |
 * |-------------------------------|---------------------------------------------------------------------|-------|
 * | `POST /auth/change-password`  | es la salida                                                        | `auth.controller.ts` |
 * | `POST /auth/logout`           | rendirse siempre se permite                                         | `auth.controller.ts` |
 * | `GET /users/me`               | la pantalla de cambio necesita `hasPassword`/`mustChangePassword`   | `users.controller.ts` (módulo `users`) |
 *
 * ⛔ Ni `PATCH /users/me`, ni `verify-email/resend`, ni direcciones, ni `/orders/claimable`, ni
 * ninguna `/admin/*`. `POST /auth/refresh` no lo necesita: es `@Public()` y el guard no lo ve.
 * Añadir una ruta aquí es un cambio de CONTRATO (pasa por el arquitecto, regla 9).
 *
 * Se aplica por HANDLER (no por clase): en `users/me` el `GET` está exento y el `PATCH` no.
 */
export const AllowPasswordChangeRequired = () => SetMetadata(ALLOW_PASSWORD_CHANGE_REQUIRED_KEY, true);
