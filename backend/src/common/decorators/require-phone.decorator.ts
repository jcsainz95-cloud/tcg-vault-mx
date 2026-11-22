import { SetMetadata } from '@nestjs/common';

export const REQUIRE_PHONE_KEY = 'requirePhone';

/** §CELULAR: la ruta exige celular MX válido en la cuenta (422 PHONE_REQUIRED). Lo aplica `PhoneRequiredGuard`. */
export const RequirePhone = () => SetMetadata(REQUIRE_PHONE_KEY, true);
