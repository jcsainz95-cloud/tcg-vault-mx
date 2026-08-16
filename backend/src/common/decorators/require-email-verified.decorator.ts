import { SetMetadata } from '@nestjs/common';

export const REQUIRE_EMAIL_VERIFIED_KEY = 'requireEmailVerified';

/**
 * Marca una acción SENSIBLE que exige `emailVerified=true` (comprar / retirar / vender).
 * El EmailVerifiedGuard rechaza con 403 EMAIL_NOT_VERIFIED si el usuario no está verificado.
 * Cuentas Google entran verificadas; el staff se siembra verificado. ARCHITECTURE §4.11, §7.
 */
export const RequireEmailVerified = () => SetMetadata(REQUIRE_EMAIL_VERIFIED_KEY, true);
