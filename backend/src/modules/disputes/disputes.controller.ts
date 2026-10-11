import { Body, Controller, Get, HttpCode, Logger, Param, Post, Query, HttpStatus } from '@nestjs/common';
import { IsIn, IsString } from 'class-validator';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DisputesService } from './disputes.service';
import { AuditService } from '../audit/audit.service';
import { BusinessException } from '../../common/business.exception';
import { supportContact } from '../mail/support-contact';

class ResolveDisputeDto {
  @IsIn(['repurchase', 'reject']) resolution!: 'repurchase' | 'reject';
  @IsString() note!: string;
}

@Controller('disputes')
@Roles(Role.customer, Role.vault_operator, Role.super_admin)
export class DisputesController {
  constructor(private readonly disputes: DisputesService) {}

  /**
   * v1.82 · **PNL-1** (`API_CONTRACT §PNL.1`, `HECHOS.md:44`) — **las disputas salieron de la tienda.**
   * Tras la autenticación (sin sesión ⇒ `401` de `JwtAuthGuard`, como siempre) responde **SIEMPRE**
   * `410 DISPUTES_DISCONTINUED { supportContact }`.
   *
   * ⛔ **Sin `@Body()`, y es la mitad del candado.** El `ValidationPipe` global corre sobre los
   * parámetros decorados ANTES del handler: con el DTO de antes, un cuerpo vacío daba `400` y uno bien
   * formado `403`/`422` según la pieza — **un oráculo de qué piezas existen y de quién son**. Sin
   * parámetro no hay nada que validar ni que leer: la respuesta es la misma para cualquier cuerpo
   * (DSC-1/DSC-2). Cero filas `Dispute`, cero bitácora, cero correo.
   *
   * La ruta **se conserva** (no `404`) para que un frontend viejo en caché reciba un código que sabe
   * pintar. Las lecturas de abajo y M8 siguen **en transición** para cerrar las que existan (§PNL.1).
   */
  @Post()
  create(): never {
    throw new BusinessException(
      'DISPUTES_DISCONTINUED',
      HttpStatus.GONE,
      'Disputes are no longer opened from the store; write to support instead',
      { supportContact: supportContact() },
    );
  }

  @Get()
  list(@CurrentUser('id') userId: string) {
    return this.disputes.listMine(userId);
  }

  @Get(':id')
  get(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.disputes.getMine(userId, id);
  }
}

/**
 * M8 — Disputas admin. vault_operator+ (revisión); recompra = super_admin (money-out).
 */
@Controller('admin/disputes')
@Roles(Role.vault_operator, Role.super_admin)
export class AdminDisputesController {
  private readonly logger = new Logger(AdminDisputesController.name);

  constructor(
    private readonly disputes: DisputesService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(
    @Query('status') status?: string,
    @Query('userId') userId?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ) {
    return this.disputes.adminList(
      status,
      Math.max(1, parseInt(page, 10) || 1),
      Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20)),
      userId,
    );
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.disputes.adminGet(id);
  }

  @Post(':id/resolve')
  // v1.68 · §M8: `200`, no el `201` del default de `POST` de Nest — opera sobre una disputa EXISTENTE
  // y no crea nada (misma doctrina que §M5-C / BL-37 para los verbos del ciclo). El contrato lo
  // declara `Res 200`; el cliente ramifica por `res.ok`, así que el impacto en frontend es cero.
  @HttpCode(HttpStatus.OK)
  async resolve(
    @Param('id') id: string,
    @Body() dto: ResolveDisputeDto,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    // Solo `repurchase` es dinero saliente: exige super_admin (auditando el intento).
    if (dto.resolution === 'repurchase' && user.role !== Role.super_admin) {
      await this.audit.log({
        actorUserId: user.id,
        actorRole: user.role,
        action: 'money_out.blocked',
        entityType: 'Dispute',
        entityId: id,
      });
      throw BusinessException.forbidden(
        'MONEY_OUT_FORBIDDEN',
        'Only super_admin may execute a repurchase',
      );
    }
    const res = await this.disputes.resolve(id, dto.resolution, dto.note, user.id);
    // ⚠ SB-D7 — **la auditoría va DESPUÉS del money-out y no puede tumbarlo.** `repurchase` ya
    // reembolsó en Stripe cuando se llega aquí: si el `INSERT` de la bitácora falla (BD saturada,
    // conexión caída), un `await` desnudo convertía un money-out **ya consumado** en un `500`, y el
    // operador —que ve un error— lo reintenta y pide un SEGUNDO reembolso por la misma disputa.
    // Es la misma regla que ya rige en `payments.service.ts:124-140` (auditar el descuadre NUNCA
    // aborta el webhook): **un fallo de auditoría se registra, no se propaga**. La pérdida es una
    // línea de bitácora; la alternativa es un cobro/abono doble.
    await this.audit
      .log({
        actorUserId: user.id,
        actorRole: user.role,
        action: `dispute.${dto.resolution}`,
        entityType: 'Dispute',
        entityId: id,
        after: { note: dto.note },
      })
      .catch((e: unknown) =>
        this.logger.error(
          `No se pudo auditar dispute.${dto.resolution} de la disputa ${id} (actor ${user.id}); ` +
            `la resolución SÍ se consumó: ${(e as Error).message}`,
        ),
      );
    return res;
  }
}
