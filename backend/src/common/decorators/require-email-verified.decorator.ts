import { SetMetadata } from '@nestjs/common';

export const REQUIRE_EMAIL_VERIFIED_KEY = 'requireEmailVerified';

/**
 * v1.117 (API_CONTRACT §CTA.5): el metadato pasa de booleano a MODO.
 *  - `'verified'` (por defecto): la cuenta necesita correo (`403 ACCOUNT_WITHOUT_EMAIL`, STF-28) **y** verificado
 *    (`403 EMAIL_NOT_VERIFIED`). Retirar, vender y reclamar (`POST /shipments`, `POST /buylist/requests`,
 *    `GET /orders/claimable`, `POST /orders/claim`).
 *  - `'present'`: solo exige que la cuenta TENGA correo (`ACCOUNT_WITHOUT_EMAIL`); no mira `emailVerified`. Comprar
 *    (`POST /checkout/session`, D-CTA-2: pagar con tu tarjeta a tu bóveda no entrega nada ajeno).
 * El bloqueo lo aplica SIEMPRE `EmailVerifiedGuard`. ARCHITECTURE §4.11, §7, §16.
 */
export type EmailRequirement = 'present' | 'verified';

export const RequireEmailVerified = (mode: EmailRequirement = 'verified') => SetMetadata(REQUIRE_EMAIL_VERIFIED_KEY, mode);
