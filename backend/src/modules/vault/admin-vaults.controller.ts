import { Controller, Get, Param, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminVaultsService } from './admin-vaults.service';
import { MasterSetService } from '../inventory/master-set.service';

/**
 * AdminVaultsController (v1.20-master-set-everywhere, §4.20a/§4.20c) — vista (ii): admin viendo
 * bóvedas de clientes. `vault_operator+`. LECTURA PURA (soporte/operación): sin acciones de
 * captura/publicación/ajuste/venta y SIN `buyable` (solo existe en la vista (iii) del cliente).
 * El shape es el MISMO contrato master-set con scope=user_vault y `owner` CON email.
 */
@Controller('admin/vaults')
@Roles(Role.vault_operator, Role.super_admin)
export class AdminVaultsController {
  constructor(
    private readonly adminVaults: AdminVaultsService,
    private readonly masterSets: MasterSetService,
  ) {}

  /** GET /admin/vaults — lista de clientes con bóveda (valuación = misma base del portafolio §3). */
  @Get()
  list(
    @Query('q') q?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('sort') sort = 'value_desc',
  ) {
    return this.adminVaults.list({
      q,
      page: Math.max(1, parseInt(page, 10) || 1),
      pageSize: Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20)),
      sort,
    });
  }

  /** GET /admin/vaults/:userId/master-sets — índice master set de la bóveda del cliente. 404 si no existe. */
  @Get(':userId/master-sets')
  masterSetIndex(
    @Param('userId') userId: string,
    @Query('q') q?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('sort') sort = 'release_desc',
  ) {
    return this.masterSets.index(
      {
        q,
        page: Math.max(1, parseInt(page, 10) || 1),
        pageSize: Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20)),
        sort,
      },
      { kind: 'user_vault', userId },
      { includeOwnerEmail: true }, // vista admin (ii): owner CON email; SIN buyable
    );
  }

  /** GET /admin/vaults/:userId/master-sets/:setId — binder de la bóveda del cliente (read-only). */
  @Get(':userId/master-sets/:setId')
  masterSetBinder(@Param('userId') userId: string, @Param('setId') setId: string) {
    return this.masterSets.binder(
      setId,
      { kind: 'user_vault', userId },
      { includeOwnerEmail: true }, // SIN buyable: vista operativa, no de compra (§4.20d)
    );
  }

  /**
   * v1.23-sealed-sales (§M1) — pestaña «Sellado» de la bóveda de un cliente (hermana admin de
   * GET /vault/sealed). Mismo shape con `owner` (name/email). Lectura pura. 404 si usuario inexistente.
   */
  @Get(':userId/sealed')
  sealed(
    @Param('userId') userId: string,
    @Query('sealedSubtype') sealedSubtype?: string,
    @Query('condition') condition?: string,
    @Query('sort') sort?: string,
  ) {
    return this.adminVaults.sealed(userId, { sealedSubtype, condition, sort });
  }
}
