import { Body, Controller, Ip, Patch } from '@nestjs/common';
import { SIGNUP_DAY_THROTTLER, SIGNUP_THROTTLER, SignupThrottle } from '../../common/throttle/signup-throttle';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthService } from '../auth/auth.service';
import { CorrectEmailDto } from '../auth/dto/auth.dto';
import { UsersService } from './users.service';

/**
 * v1.117⟨cuenta-correo⟩ (API_CONTRACT §CTA.4, P-CTA-2 provisional) — `PATCH /users/me/email`: quien tecleó mal su correo
 * en el carrito lo corrige desde «Mi cuenta» mientras la cuenta siga `setupPending` y sin verificar. La regla (tope,
 * escritura condicional, anulación de tokens, reenvío) vive en `AuthService.correctEmail`; la respuesta es la forma de
 * `GET /users/me`. Controlador aparte de `UsersController` para no cambiar su constructor (lo construyen pruebas a mano).
 */
@Controller('users/me')
@Roles(Role.customer)
export class MeEmailController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
  ) {}

  // v1.117.2 (D-CTA-13, PT-CTA-3): el `409` es un oráculo de existencia ⇒ gasta el MISMO presupuesto que el alta: `signup`
  // (5/min/IP, compartido con `register` y `email-only`) y `signup-day` (30/24 h/IP, compartido con `email-only`), en toda
  // petición sea cual sea el resultado. Reemplazan al `default` por ruta (queda el global). Cada `409` pasa por la telemetría.
  @SignupThrottle(SIGNUP_THROTTLER, SIGNUP_DAY_THROTTLER)
  @Patch('email')
  async correctEmail(@CurrentUser('id') userId: string, @Body() dto: CorrectEmailDto, @Ip() ip: string) {
    await this.auth.correctEmail(userId, dto.email, ip);
    return this.users.me(userId);
  }
}
