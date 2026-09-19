import { Role } from '@prisma/client';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { AuditService } from '../audit/audit.service';
import { DecksMetaService } from './decks-meta.service';
import { DecksMetaRefreshService } from './decks-meta-refresh.service';
import { AdminDecksMetaController } from './admin-decks-meta.controller';

/**
 * `GET /admin/decks-meta/preview` (DECKS-META Fase 2, §8) — QA §10 lo marcó SIN cubrir. Es la vía de
 * verificación en prod (el sandbox bloquea el egress): corre el pipeline REAL en DRY-RUN (no escribe
 * nada publicado), está gateado a `vault_operator+` y —tras el fix— AUDITA su egress a un tercero.
 */
describe('AdminDecksMetaController · preview (§8)', () => {
  const user = { id: 'op-1', role: Role.vault_operator };

  function makeController() {
    const refresh = {
      run: jest.fn(async () => ({
        skipped: false as const,
        mode: 'dryrun' as const,
        report: { verdict: 'PUBLISH', applied: false, decks: [{}], persistedCount: 0, publishedSlugs: [] },
      })),
    } as unknown as DecksMetaRefreshService;
    const audit = { log: jest.fn(async () => undefined) } as unknown as AuditService;
    const service = {} as unknown as DecksMetaService;
    const controller = new AdminDecksMetaController(service, refresh, audit);
    return { controller, refresh, audit };
  }

  it('corre en DRY-RUN (fuerza `dryRun:true` ⇒ no escribe nada publicado)', async () => {
    const { controller, refresh } = makeController();
    await controller.preview(user);
    expect(refresh.run).toHaveBeenCalledWith({ dryRun: true });
  });

  it('devuelve el RefreshReport del orquestador', async () => {
    const { controller } = makeController();
    const res = await controller.preview(user);
    expect(res.skipped).toBe(false);
    if (res.skipped) return; // narrowing para TS
    expect(res.report.verdict).toBe('PUBLISH');
    expect(res.report.applied).toBe(false);
  });

  it('AUDITA `jobs.decks_meta_preview.run` (egress real a un tercero) con el actor', async () => {
    const { controller, audit } = makeController();
    await controller.preview(user);
    expect(audit.log).toHaveBeenCalledTimes(1);
    const entry = (audit.log as jest.Mock).mock.calls[0][0];
    expect(entry.action).toBe('jobs.decks_meta_preview.run');
    expect(entry.actorUserId).toBe('op-1');
    expect(entry.actorRole).toBe(Role.vault_operator);
    expect(entry.entityType).toBe('Job');
    expect(entry.entityId).toBe('decks-meta-preview');
    expect(entry.after.mode).toBe('dryrun');
  });

  it('está gateado a `vault_operator+` (vault_operator y super_admin)', () => {
    expect(Reflect.getMetadata(ROLES_KEY, AdminDecksMetaController)).toEqual([
      Role.vault_operator,
      Role.super_admin,
    ]);
  });
});
