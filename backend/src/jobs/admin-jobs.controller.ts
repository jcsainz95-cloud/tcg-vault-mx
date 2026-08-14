import { Controller, HttpCode, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuditService } from '../modules/audit/audit.service';
import { PortfolioSnapshotJobService } from './portfolio-snapshot.service';

/**
 * Disparo MANUAL de jobs (super_admin, auditado). Complementa al scheduler BullMQ (BE-5):
 * price-sync y fx-refresh ya tienen su disparo en M2; aquí queda el `portfolio-snapshot`.
 */
@Controller('admin/jobs')
@Roles(Role.super_admin)
export class AdminJobsController {
  constructor(
    private readonly portfolioSnapshot: PortfolioSnapshotJobService,
    private readonly audit: AuditService,
  ) {}

  @Post('portfolio-snapshot')
  @HttpCode(200)
  async runPortfolioSnapshot(@CurrentUser() user: { id: string; role: Role }) {
    const snapshotted = await this.portfolioSnapshot.run();
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'jobs.portfolio_snapshot',
      after: { snapshotted },
    });
    return { snapshotted };
  }
}
