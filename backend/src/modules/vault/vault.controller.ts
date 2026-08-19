import { Controller, Get, Param, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { VaultService } from './vault.service';
import { MasterSetService } from '../inventory/master-set.service';

@Controller('vault')
@Roles(Role.customer, Role.vault_operator, Role.super_admin)
export class VaultController {
  constructor(
    private readonly vault: VaultService,
    private readonly masterSets: MasterSetService,
  ) {}

  @Get('holdings')
  holdings(@CurrentUser('id') userId: string) {
    return this.vault.holdings(userId);
  }

  // v1.1 — gráfica de tendencia del portafolio (rangos 5d|15d|1m|3m|6m|1y|ytd|all).
  @Get('portfolio/history')
  portfolioHistory(@CurrentUser('id') userId: string, @Query('range') range = '1m') {
    return this.vault.portfolioHistory(userId, range);
  }

  /**
   * v1.20-master-set-everywhere (§3, vista (iii)) — "Mi bóveda como master set": índice con SOLO
   * los sets donde el usuario tiene ≥1 pieza. El userId es SIEMPRE el autenticado (jamás del
   * request, §4.20a). `owner` SIN email; sin ubicaciones/costos/folios; lectura pura.
   */
  @Get('master-sets')
  myMasterSets(
    @CurrentUser('id') userId: string,
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
      {}, // vista (iii): owner sin email; el índice no resuelve buyable (solo el binder)
    );
  }

  /**
   * v1.20 (§3) — binder de MI bóveda para CUALQUIER set del catálogo (las variantes sin piezas son
   * mis faltantes) + `buyable` por variante faltante (pieza `listed` más barata de plataforma, o
   * null). SIN compra dentro del binder: el CTA lleva a la ficha/checkout normal.
   */
  @Get('master-sets/:setId')
  myMasterSetBinder(@CurrentUser('id') userId: string, @Param('setId') setId: string) {
    return this.masterSets.binder(
      setId,
      { kind: 'user_vault', userId },
      { includeBuyable: true }, // SOLO esta vista puebla buyable (§4.20d)
    );
  }

  /**
   * v1.23-sealed-sales (§3) — pestaña «Sellado» de MI bóveda: piezas selladas agrupadas por
   * producto+condición con valor de mercado. Sin `owner` (es la vista del propio cliente).
   */
  @Get('sealed')
  sealed(
    @CurrentUser('id') userId: string,
    @Query('sealedSubtype') sealedSubtype?: string,
    @Query('condition') condition?: string,
    @Query('sort') sort?: string,
  ) {
    return this.vault.sealedTab(userId, { sealedSubtype, condition, sort });
  }

  @Get('holdings/:inventoryItemId')
  detail(@CurrentUser('id') userId: string, @Param('inventoryItemId') id: string) {
    return this.vault.holdingDetail(userId, id);
  }
}
