import { Body, Controller, Delete, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { VaultPlacementService } from './vault-placement.service';

/**
 * ⭐ `/admin/vault-placements` — API_CONTRACT §M4-VAULT.5 y .10. Operador+.
 *
 * El cuerpo se recibe **sin clase DTO** a propósito: el contrato fija `details` exactos para el `400`
 * (`{field:'status', allowed}` y `{field:'locationId'}`) y la regla de `locationId` depende del estado
 * del pedido (opcional con cero cartas tomadas, v1.79.3) — la valida el servicio. ⛔ El cuerpo nunca
 * lleva actor ni fecha: salen de la sesión (`@CurrentUser()`) y del servidor.
 */
@Controller('admin/vault-placements')
@Roles(Role.vault_operator, Role.super_admin)
export class VaultPlacementsController {
  constructor(private readonly placements: VaultPlacementService) {}

  @Patch(':placementId/prep-items/:placementItemId')
  markItem(
    @Param('placementId') placementId: string,
    @Param('placementItemId') placementItemId: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    return this.placements.markItem(placementId, placementItemId, body, user);
  }

  @Post(':placementId/prepared')
  @HttpCode(200)
  prepare(
    @Param('placementId') placementId: string,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    return this.placements.prepare(placementId, user);
  }

  @Delete(':placementId/prepared')
  @HttpCode(200)
  unprepare(
    @Param('placementId') placementId: string,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    return this.placements.unprepare(placementId, user);
  }

  @Post(':placementId/confirm')
  @HttpCode(200)
  confirm(
    @Param('placementId') placementId: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    return this.placements.confirm(placementId, body, user);
  }
}
