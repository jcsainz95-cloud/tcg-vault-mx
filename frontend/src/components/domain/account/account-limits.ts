/*
 * Cotas de los formularios de cuenta, en UN sitio (techlead TL-CTA-7). Sin `'use client'`: son constantes.
 */

/** Política vigente del contrato §1 (`MIN_PASSWORD_LENGTH`): reset, cambio, alta de contraseña y account-setup. */
export const MIN_PASSWORD = 8;

/** Cota de `name` (§CTA.4: trim, 1..120, la de `PATCH /users/me`): account-setup y alta de contraseña. */
export const MAX_NAME = 120;
