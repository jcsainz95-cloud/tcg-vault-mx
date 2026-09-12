import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AllowPasswordChangeRequired } from '../../common/decorators/allow-password-change-required.decorator';
import { BusinessException } from '../../common/business.exception';
import { UsersService } from './users.service';
import {
  AddressDto,
  BillingProfileDto,
  UpdateAddressDto,
  UpdateKycDto,
  UpdateMeDto,
} from './dto/users.dto';

@Controller('users/me')
@Roles(Role.customer, Role.vault_operator, Role.super_admin)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /**
   * v1.67 — en la allowlist CERRADA del `PasswordChangeRequiredGuard` (contrato §1): la pantalla de
   * cambio necesita `hasPassword`/`mustChangePassword` y la hidratación de sesión del front lo llama.
   * Se aplica por HANDLER: el `PATCH` de abajo NO está exento (un usuario con temporal no edita su
   * perfil hasta cambiarla — decisión del dueño 2026-09-11).
   */
  @Get()
  @AllowPasswordChangeRequired()
  me(@CurrentUser('id') userId: string) {
    return this.users.me(userId);
  }

  @Patch()
  updateMe(@CurrentUser('id') userId: string, @Body() dto: UpdateMeDto) {
    return this.users.updateMe(userId, dto);
  }

  @Get('addresses')
  listAddresses(@CurrentUser('id') userId: string) {
    return this.users.listAddresses(userId);
  }

  @Post('addresses')
  @HttpCode(201)
  createAddress(@CurrentUser('id') userId: string, @Body() dto: AddressDto) {
    return this.users.createAddress(userId, dto);
  }

  @Patch('addresses/:id')
  updateAddress(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateAddressDto,
  ) {
    return this.users.updateAddress(userId, id, dto);
  }

  @Delete('addresses/:id')
  @HttpCode(204)
  deleteAddress(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.users.deleteAddress(userId, id);
  }

  @Get('billing-profile')
  getBilling(@CurrentUser('id') userId: string) {
    return this.users.getBillingProfile(userId);
  }

  @Put('billing-profile')
  putBilling(@CurrentUser('id') userId: string, @Body() dto: BillingProfileDto) {
    return this.users.putBillingProfile(userId, dto);
  }

  /**
   * ⭐ v1.69 (P-78, §M6-K.5 / §1) — **`?quotedTotalCents=N` ⇒ `ineRequiredForTotal: boolean`.**
   *
   * Sustituye la comparación que hoy vive en el navegador (`useSellRequirements.ts`, §M5-I.6): el
   * front **ya no compara, pregunta**, y lo que recibe es un **veredicto, no un dial**. Sin el
   * parámetro, la respuesta no trae la clave.
   *
   * **Entero ≥ 0.** ⚠️ El contrato declara la forma del parámetro pero **no dicta el código de una
   * entrada mal formada**; se resuelve con `422 VALIDATION_ERROR` + `details.field`, que es el
   * patrón del repo para una query inválida (`AdminService.range`). ⛔ **No se ignora en silencio**:
   * omitir la clave ante `?quotedTotalCents=abc` haría que el cotizador concluyera «no hace falta
   * INE» por un error de tecleo, y el vendedor se estrellaría contra el `422 INE_REQUIRED` al
   * enviar. Anotado como pregunta al arquitecto en `BACKEND_NOTES`.
   */
  @Get('kyc')
  getKyc(
    @CurrentUser('id') userId: string,
    @Query('quotedTotalCents') quotedTotalCents?: string,
  ) {
    if (quotedTotalCents === undefined) return this.users.getKyc(userId);
    // Se valida la CADENA, no el `Number`: `Number('')` es `0` y `Number(' 12 ')` es `12`, así que
    // un parámetro vacío o con basura alrededor pasaría por «cero» y el cotizador concluiría «no
    // hace falta INE» a partir de un valor que nadie escribió. `^\d+$` deja pasar exactamente los
    // enteros ≥ 0 que el contrato declara.
    const parsed = /^\d+$/.test(quotedTotalCents) ? Number(quotedTotalCents) : NaN;
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
      throw BusinessException.validation(
        'VALIDATION_ERROR',
        'quotedTotalCents must be an integer >= 0',
        { field: 'quotedTotalCents' },
      );
    }
    return this.users.getKyc(userId, parsed);
  }

  @Put('kyc')
  putKyc(@CurrentUser('id') userId: string, @Body() dto: UpdateKycDto) {
    return this.users.putKyc(userId, dto);
  }
}
