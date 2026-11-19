import { Body, Controller, HttpCode, Logger, Param, Post } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WithdrawalReturnService } from './withdrawal-return.service';
import { ShipmentsService } from './shipments.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SpendAlertsService } from '../spend-alerts/spend-alerts.service';
import { SpendMailService } from '../spend-alerts/spend-mail.service';

class ReturnReceivedDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

/** §RETIRO-SALIDA punto 3 — aislado (ver `WithdrawalReturnService`). Staff (operador o súper-admin), idempotente. */
@Controller('admin/shipments')
@Roles(Role.vault_operator, Role.super_admin)
export class WithdrawalReturnController {
  private readonly logger = new Logger(WithdrawalReturnController.name);

  constructor(
    private readonly returns: WithdrawalReturnService,
    private readonly shipments: ShipmentsService,
    private readonly prisma: PrismaService,
    private readonly spendAlerts: SpendAlertsService,
    private readonly spendMail: SpendMailService,
  ) {}

  @Post(':id/return-received')
  @HttpCode(200)
  async returnReceived(@Param('id') id: string, @Body() body: ReturnReceivedDto, @CurrentUser() user: { id: string; role: Role }) {
    await this.shipments.assertOutboundRoute(id);
    const r = await this.returns.returnReceived(id, user, body?.note);
    if (r.won) {
      // AG-29 (RS-2): POST-COMMIT, best-effort, solo el ganador; `raise` es no-op si quien confirma es el dueño (PERSON_ALERT_KINDS).
      // Un fallo se registra y ⛔ no revierte la devolución. ⛔ Sin datos del cliente.
      try {
        const res = await this.spendAlerts.raise(
          this.prisma,
          {
            kind: 'return_received_by_non_owner',
            severity: 'immediate',
            dedupKey: `ag29:${id}`,
            subjectUserId: user.id,
            shipmentRequestId: id,
            orderId: null,
            amountCents: null,
            facts: { folio: r.row.folio ?? null, actorUserId: user.id, restored: r.restored, returnedAt: r.row.returnedAt ? r.row.returnedAt.toISOString() : null },
          },
          new Date(),
        );
        if (res?.created) await this.spendMail.dispatchImmediate(res.id);
      } catch (e) {
        this.logger.error(`AG-29 (${id}) no se pudo registrar: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return { shipment: this.shipments.toAdminRow(r.row), restored: r.restored, skipped: r.skipped, won: r.won };
  }
}
