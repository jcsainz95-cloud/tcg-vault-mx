import { Body, Controller, Ip, Patch } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
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

  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Patch('email')
  async correctEmail(@CurrentUser('id') userId: string, @Body() dto: CorrectEmailDto, @Ip() ip: string) {
    await this.auth.correctEmail(userId, dto.email, ip);
    return this.users.me(userId);
  }
}
