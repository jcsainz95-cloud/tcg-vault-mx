import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { HttpStatus } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Allow, IsBoolean, IsInt, IsOptional, Min } from 'class-validator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { BusinessException } from '../../common/business.exception';
import { ErrorCode } from '../../common/error-codes';
import { AuditService } from '../audit/audit.service';
import { SealedMappingService } from './sealed-mapping.service';
import { TcgcsvSealedBulkProvider } from './providers/tcgcsv-sealed.provider';

/**
 * PUT /admin/pricing/sealed/items/:itemId/mapping (API_CONTRACT §M2).
 * `tcgplayerProductId` es REQUERIDO en el body pero admite `null` (desmapear); la distinción
 * ausente-vs-null y los rangos finos (entero positivo, groupId obligatorio con productId) los
 * valida el servicio (class-validator no distingue bien `null` de ausente).
 */
class SealedMappingDto {
  // @Allow: el ValidationPipe global corre con whitelist:true y quitaría un campo sin
  // decorador; la validación FINA (entero positivo | null, 422) vive en el servicio.
  @Allow() tcgplayerProductId!: number | null;
  @IsOptional() @IsInt() @Min(1) tcgplayerGroupId?: number;
  @IsOptional() @IsBoolean() applyToSiblings?: boolean;
}

/**
 * M2 — Referencia de mercado del SELLADO vía TCGCSV (v1.19-sealed-tcgcsv, super_admin).
 * API_CONTRACT §M2 (subsección TCGCSV) / ARCHITECTURE §4.19b-c.
 *
 * - Explorador de grupos/productos = **proxy read-only server-side** (el navegador nunca
 *   habla con tcgcsv.com; host fijo anti-SSRF y categoría Pokémon=3 viven en el provider).
 * - La curación funciona AUNQUE el dial `sealedPriceSource` esté `off` (mapear no mueve
 *   precios); solo el explorador llama a tcgcsv.com.
 */
@Controller('admin/pricing/sealed')
@Roles(Role.super_admin)
export class SealedPricingController {
  constructor(
    private readonly mapping: SealedMappingService,
    private readonly provider: TcgcsvSealedBulkProvider,
    private readonly audit: AuditService,
  ) {}

  /** Cola de curación: items sealed SIN mapeo (consulta derivada; lo más viejo primero). */
  @Get('unmapped')
  unmapped(@Query('page') page = '1', @Query('pageSize') pageSize = '20') {
    return this.mapping.listUnmapped(
      Math.max(1, parseInt(page, 10) || 1),
      Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20)),
    );
  }

  /** Explorador de grupos TCGCSV (proxy read-only). `?q=` filtra por nombre. */
  @Get('tcgcsv/groups')
  async groups(@Query('q') q?: string) {
    try {
      const groups = await this.provider.listGroups();
      const needle = q?.trim().toLowerCase();
      const data = needle
        ? groups.filter((g) => g.name.toLowerCase().includes(needle))
        : groups;
      return { data };
    } catch (e) {
      throw new BusinessException(
        ErrorCode.UPSTREAM_ERROR,
        HttpStatus.BAD_GATEWAY,
        `TCGCSV upstream error: ${(e as Error).message}`,
      );
    }
  }

  /**
   * Productos SELLADOS del grupo (proxy read-only; filtra singles por heurística de
   * `extendedData`). `:groupId` DEBE ser entero positivo → si no, 400 VALIDATION_ERROR
   * (nunca se interpola un string del cliente en el path remoto).
   */
  @Get('tcgcsv/groups/:groupId/products')
  async products(@Param('groupId') groupIdRaw: string, @Query('q') q?: string) {
    if (!/^\d+$/.test(groupIdRaw) || parseInt(groupIdRaw, 10) <= 0) {
      throw BusinessException.badRequest(
        'VALIDATION_ERROR',
        'groupId must be a positive integer',
      );
    }
    const groupId = parseInt(groupIdRaw, 10);
    try {
      const products = await this.provider.listSealedProducts(groupId);
      const needle = q?.trim().toLowerCase();
      const data = needle
        ? products.filter(
            (p) =>
              p.name.toLowerCase().includes(needle) ||
              (p.cleanName ?? '').toLowerCase().includes(needle),
          )
        : products;
      return { data };
    } catch (e) {
      throw new BusinessException(
        ErrorCode.UPSTREAM_ERROR,
        HttpStatus.BAD_GATEWAY,
        `TCGCSV upstream error: ${(e as Error).message}`,
      );
    }
  }

  /**
   * Asigna/actualiza/quita el mapeo de UN item (con `applyToSiblings` opcional). Auditado
   * con before/after (`pricing.sealed_mapping.update`). NO valida contra TCGCSV (la curación
   * funciona sin red al remoto). El response NO incluye `before` (solo el AuditLog).
   */
  @Put('items/:itemId/mapping')
  async updateMapping(
    @Param('itemId') itemId: string,
    @Body() dto: SealedMappingDto,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    // REQUERIDO en el body: ausente (undefined) ≠ null (desmapear explícito).
    if (dto.tcgplayerProductId === undefined) {
      throw BusinessException.validation(
        'VALIDATION_ERROR',
        'tcgplayerProductId is required (number to map, null to unmap)',
      );
    }
    const { before, ...result } = await this.mapping.updateMapping(itemId, {
      tcgplayerProductId: dto.tcgplayerProductId,
      tcgplayerGroupId: dto.tcgplayerGroupId,
      applyToSiblings: dto.applyToSiblings,
    });
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'pricing.sealed_mapping.update',
      entityType: 'InventoryItem',
      entityId: itemId,
      before,
      after: {
        tcgplayerProductId: result.tcgplayerProductId,
        tcgplayerGroupId: result.tcgplayerGroupId,
        siblingsUpdated: result.siblingsUpdated,
      },
    });
    return result;
  }
}
