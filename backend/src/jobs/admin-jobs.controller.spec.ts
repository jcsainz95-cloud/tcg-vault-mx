import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Role } from '@prisma/client';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { AuditService } from '../modules/audit/audit.service';
import { DecksMetaRefreshService } from '../modules/decks-meta/decks-meta-refresh.service';
import { AdminJobsController } from './admin-jobs.controller';

/**
 * `POST /admin/jobs/decks-meta-refresh` (DECKS-META Fase 2, §7) — QA §10 lo marcó SIN cubrir. El
 * disparo manual: (a) es super_admin, (b) pasa `dryRun` al orquestador TAL CUAL, (c) responde 202,
 * (d) AUDITA `jobs.decks_meta_refresh.run` (mismo patrón que los demás `POST /admin/jobs/*`).
 */
describe('AdminJobsController · decks-meta-refresh (§7)', () => {
  const user = { id: 'sa-1', role: Role.super_admin };

  function makeController() {
    const refresh = {
      run: jest.fn(async () => ({
        skipped: false as const,
        mode: 'dryrun' as const,
        report: { verdict: 'PUBLISH', applied: false, decks: [{}, {}], publishedSlugs: [] },
      })),
    } as unknown as DecksMetaRefreshService;
    const audit = { log: jest.fn(async () => undefined) } as unknown as AuditService;
    const stub = {} as never;
    const controller = new AdminJobsController(
      stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, refresh, audit,
    );
    return { controller, refresh, audit };
  }

  it('pasa `dryRun:true` al orquestador tal cual', async () => {
    const { controller, refresh } = makeController();
    await controller.runDecksMetaRefresh({ dryRun: true }, user);
    expect(refresh.run).toHaveBeenCalledWith({ dryRun: true });
  });

  it('sin `dryRun` en el body, respeta el dial (pasa `dryRun:undefined`)', async () => {
    const { controller, refresh } = makeController();
    await controller.runDecksMetaRefresh({}, user);
    expect(refresh.run).toHaveBeenCalledWith({ dryRun: undefined });
  });

  it('devuelve el resultado del orquestador', async () => {
    const { controller } = makeController();
    const res = await controller.runDecksMetaRefresh({ dryRun: true }, user);
    expect(res.skipped).toBe(false);
  });

  it('AUDITA `jobs.decks_meta_refresh.run` con actor y detalle del reporte', async () => {
    const { controller, audit } = makeController();
    await controller.runDecksMetaRefresh({ dryRun: true }, user);
    expect(audit.log).toHaveBeenCalledTimes(1);
    const entry = (audit.log as jest.Mock).mock.calls[0][0];
    expect(entry.action).toBe('jobs.decks_meta_refresh.run');
    expect(entry.actorUserId).toBe('sa-1');
    expect(entry.actorRole).toBe(Role.super_admin);
    expect(entry.entityType).toBe('Job');
    expect(entry.entityId).toBe('decks-meta-refresh');
    expect(entry.after.mode).toBe('dryrun');
    expect(entry.after.verdict).toBe('PUBLISH');
  });

  it('el disparo responde 202 y el controller es super_admin', () => {
    const code = Reflect.getMetadata(HTTP_CODE_METADATA, AdminJobsController.prototype.runDecksMetaRefresh);
    expect(code).toBe(202);
    expect(Reflect.getMetadata(ROLES_KEY, AdminJobsController)).toEqual([Role.super_admin]);
  });
});
