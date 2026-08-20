import { Body, Controller, Get, Headers, Param, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { MoneyOut } from '../../common/decorators/money-out.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { parseAdminListFilters } from '../../common/admin-list-filters';
import { BuylistService } from './buylist.service';
import { AuditService } from '../audit/audit.service';
import {
  ItemDecisionDto,
  PaySpeiDto,
  RejectedItemsQueryDto,
  RejectRequestDto,
} from './dto/buylist.dto';

/**
 * M5 — Buylist admin. vault_operator hasta verificación; super_admin pago SPEI.
 * API_CONTRACT §M5.
 */
@Controller('admin/buylist')
@Roles(Role.vault_operator, Role.super_admin)
export class AdminBuylistController {
  constructor(
    private readonly buylist: BuylistService,
    private readonly audit: AuditService,
  ) {}

  /**
   * v1.25-buylist-orders-pagination (§M5): paginación server-side + filtros para la pestaña
   * «Cerradas». Params NUEVOS (`q`, `from`, `to`, `minCents`, `maxCents`) TODOS opcionales; omitirlos
   * = comportamiento de HOY. `status` pasa a aceptar CSV (`pagada,rechazada,abandonada`). Validación
   * (paginación/fecha/monto/`q`) → 400 VALIDATION_ERROR vía `parseAdminListFilters`; token de `status`
   * inválido → 400 en el servicio (`details.invalidStatus`). `pageSize` default 20 (máx 100).
   */
  @Get()
  list(
    @Query('status') status?: string,
    @Query('userId') userId?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('q') q?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('minCents') minCents?: string,
    @Query('maxCents') maxCents?: string,
  ) {
    const f = parseAdminListFilters({ page, pageSize, q, from, to, minCents, maxCents });
    return this.buylist.adminList(status, f.page, f.pageSize, userId, {
      q: f.q,
      dateRange: f.dateRange,
      centsRange: f.centsRange,
    });
  }

  /**
   * v1.18-buylist-rejects (§M5): pestaña «Rechazadas» — listado paginado TRANSVERSAL de ítems
   * `itemStatus='rechazada'` con seller, carta, motivo y plazos derivados; orden `rejectedAt` desc.
   * Mismo guard de roles que el resto de M5 (vault_operator/super_admin, heredado de la clase).
   * DECLARADO ANTES de `@Get(':id')` para que la ruta literal no la capture el parámetro.
   * Paginación inválida → 400 VALIDATION_ERROR (DTO).
   */
  @Get('rejected-items')
  rejectedItems(@Query() query: RejectedItemsQueryDto) {
    return this.buylist.adminRejectedItems(query.page ?? 1, query.pageSize ?? 20, query.userId);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.buylist.adminGet(id);
  }

  /**
   * Reveal on-demand de la CLABE COMPLETA (18 dígitos) para copiarla a la banca al hacer
   * el SPEI. SOLO `super_admin` (@MoneyOut) y AUDITADO en AuditLog (quién/cuándo/qué
   * solicitud). Es el ÚNICO endpoint que devuelve la CLABE en claro; el resto enmascara.
   * Solicitud de contrato al arquitecto (ver docs/BACKEND_NOTES.md).
   */
  @Get(':id/reveal-clabe')
  @Roles(Role.super_admin)
  @MoneyOut()
  async revealClabe(@Param('id') id: string, @CurrentUser() user: { id: string; role: Role }) {
    const res = await this.buylist.revealClabe(id);
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'buylist.reveal_clabe',
      entityType: 'SellRequest',
      entityId: id,
    });
    return res;
  }

  @Post(':id/receive')
  async receive(@Param('id') id: string, @CurrentUser() user: { id: string; role: Role }) {
    const res = await this.buylist.receive(id);
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'buylist.receive',
      entityType: 'SellRequest',
      entityId: id,
    });
    return res;
  }

  @Post(':id/verify')
  async verify(@Param('id') id: string, @CurrentUser() user: { id: string; role: Role }) {
    const res = await this.buylist.verify(id);
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'buylist.verify',
      entityType: 'SellRequest',
      entityId: id,
    });
    return res;
  }

  /**
   * v1.24-buylist-request-reject (§M5, §4.18g): botón «Rechazar solicitud» — cierre EXPLÍCITO de una
   * solicitud a terminal `rechazada`+`closedAt`. Roles heredados de la clase (vault_operator/
   * super_admin); NO es dinero saliente → SIN @MoneyOut. Auditado `action: 'buylist.reject'` (el
   * `reason?` interno, NO PII, va en `after`). Ruta literal `:id/reject` (POST) sin colisión con las
   * demás. Cierra SÓLO si todos los ítems ya están `rechazada`; si no → 422; terminal distinto → 409.
   * Idempotente: ya `rechazada` → 200 sin re-auditar como cambio (`transitioned=false`).
   */
  @Post(':id/reject')
  async reject(
    @Param('id') id: string,
    @Body() dto: RejectRequestDto,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    const { request, transitioned } = await this.buylist.rejectRequest(id, dto.reason);
    // Idempotencia: no se re-audita como cambio si la solicitud ya estaba `rechazada`.
    if (transitioned) {
      await this.audit.log({
        actorUserId: user.id,
        actorRole: user.role,
        action: 'buylist.reject',
        entityType: 'SellRequest',
        entityId: id,
        // Motivo interno del cierre a nivel solicitud (NO PII); ausente si no se envió.
        after: { reason: dto.reason },
      });
    }
    return request;
  }

  @Patch('items/:itemId/decision')
  async decision(
    @Param('itemId') itemId: string,
    @Body() dto: ItemDecisionDto,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    // v1.18-buylist-rejects: `reason` obligatorio con reject (DTO valida 3–500 → 400); para
    // approve/adjust se ignora (no se persiste ni se audita).
    const res = await this.buylist.itemDecision(
      itemId,
      dto.decision,
      dto.approvedPriceCents,
      dto.reason,
    );
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: `buylist.item.${dto.decision}`,
      entityType: 'SellRequestItem',
      entityId: itemId,
      // El motivo del rechazo va al AuditLog en `after` (§M5); no contiene PII (texto del operador).
      after:
        dto.decision === 'reject'
          ? { reason: dto.reason }
          : { approvedPriceCents: dto.approvedPriceCents },
    });
    return res;
  }

  @Post('items/:itemId/convert-to-inventory')
  async convert(
    @Param('itemId') itemId: string,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    const res = await this.buylist.convertToInventory(itemId, user.id);
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'buylist.convert_to_inventory',
      entityType: 'SellRequestItem',
      entityId: itemId,
      after: res,
    });
    return res;
  }

  @Post(':id/pay-spei')
  @MoneyOut()
  async paySpei(
    @Param('id') id: string,
    @Body() dto: PaySpeiDto,
    @CurrentUser() user: { id: string; role: Role },
    @Headers('idempotency-key') _idempotencyKey?: string,
  ) {
    const res = await this.buylist.paySpei(id, dto.speiReference, user.id);
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'sellrequest.pay_spei',
      entityType: 'SellRequest',
      entityId: id,
      after: { speiReference: dto.speiReference },
    });
    return res;
  }
}
