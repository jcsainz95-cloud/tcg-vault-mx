import { Controller, HttpCode, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuditService } from '../modules/audit/audit.service';
import { PortfolioSnapshotJobService } from './portfolio-snapshot.service';
import { IneRetentionJobService } from './ine-retention.service';
import { BuylistSweepJobService } from './buylist-sweep.service';
import { DisputeDeadlineJobService } from './dispute-deadline.service';
import { AuthTokenSweepJobService } from './auth-token-sweep.service';
import { SetPriceSyncJobService } from './set-price-sync.service';
import { SetValueSnapshotJobService } from './set-value-snapshot.service';

/**
 * Disparo MANUAL de jobs (super_admin, auditado). Complementa al scheduler BullMQ (BE-5 /
 * v15-D1): price-sync y fx-refresh ya tienen su disparo en M2; aquí quedan
 * `portfolio-snapshot` y los 4 barridos (`ine-retention`, `buylist-sweep`,
 * `dispute-deadline`, `auth-token-sweep`). El scheduler los corre solos cuando hay
 * REDIS_URL; estos endpoints permiten dispararlos a mano (operación/ops).
 */
@Controller('admin/jobs')
@Roles(Role.super_admin)
export class AdminJobsController {
  constructor(
    private readonly portfolioSnapshot: PortfolioSnapshotJobService,
    private readonly ineRetention: IneRetentionJobService,
    private readonly buylistSweep: BuylistSweepJobService,
    private readonly disputeDeadline: DisputeDeadlineJobService,
    private readonly authTokenSweep: AuthTokenSweepJobService,
    private readonly setPriceSync: SetPriceSyncJobService,
    private readonly setValueSnapshot: SetValueSnapshotJobService,
    private readonly audit: AuditService,
  ) {}

  @Post('portfolio-snapshot')
  @HttpCode(200)
  async runPortfolioSnapshot(@CurrentUser() user: { id: string; role: Role }) {
    const snapshotted = await this.portfolioSnapshot.run();
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      // RB-1: taxonomía uniforme `jobs.<name>.run` (antes este job era el único sin sufijo `.run`).
      action: 'jobs.portfolio_snapshot.run',
      // RB-2: entityType/entityId presentes en TODA la auditoría de jobs (paridad con los disparos M2).
      entityType: 'Job',
      entityId: 'portfolio-snapshot',
      after: { snapshotted },
    });
    return { snapshotted };
  }

  @Post('ine-retention')
  @HttpCode(200)
  async runIneRetention(@CurrentUser() user: { id: string; role: Role }) {
    const result = await this.ineRetention.run();
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'jobs.ine_retention.run',
      entityType: 'Job',
      entityId: 'ine-retention',
      after: result,
    });
    return result;
  }

  @Post('buylist-sweep')
  @HttpCode(200)
  async runBuylistSweep(@CurrentUser() user: { id: string; role: Role }) {
    const result = await this.buylistSweep.run();
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'jobs.buylist_sweep.run',
      entityType: 'Job',
      entityId: 'buylist-sweep',
      after: result,
    });
    return result;
  }

  @Post('dispute-deadline')
  @HttpCode(200)
  async runDisputeDeadline(@CurrentUser() user: { id: string; role: Role }) {
    const result = await this.disputeDeadline.run();
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'jobs.dispute_deadline.run',
      entityType: 'Job',
      entityId: 'dispute-deadline',
      after: result,
    });
    return result;
  }

  @Post('auth-token-sweep')
  @HttpCode(200)
  async runAuthTokenSweep(@CurrentUser() user: { id: string; role: Role }) {
    const result = await this.authTokenSweep.run();
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'jobs.auth_token_sweep.run',
      entityType: 'Job',
      entityId: 'auth-token-sweep',
      after: result,
    });
    return result;
  }

  // v1.9-set-chart — siembra manual del primer punto sin esperar al cron: precia el set destacado…
  @Post('set-price-sync')
  @HttpCode(200)
  async runSetPriceSync(@CurrentUser() user: { id: string; role: Role }) {
    const result = await this.setPriceSync.run();
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'jobs.set_price_sync.run',
      entityType: 'Job',
      entityId: 'set-price-sync',
      after: result,
    });
    return result;
  }

  // …y luego captura el snapshot del día (upsert idempotente).
  @Post('set-value-snapshot')
  @HttpCode(200)
  async runSetValueSnapshot(@CurrentUser() user: { id: string; role: Role }) {
    const result = await this.setValueSnapshot.run();
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'jobs.set_value_snapshot.run',
      entityType: 'Job',
      entityId: 'set-value-snapshot',
      after: result,
    });
    return result;
  }
}
