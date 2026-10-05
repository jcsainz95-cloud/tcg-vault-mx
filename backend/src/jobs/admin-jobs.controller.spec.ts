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

/**
 * ⭐ D2d (API_CONTRACT §M4-SHIP.19.10) — los tres disparos de Skydropx: súper-admin (de la clase), `200`, pasan `shipmentId`
 * tal cual al sondeo, AUDITAN `jobs.<name>.run` y, sin el servicio (construcción a mano), responden `404` en vez de `500`.
 */
describe('AdminJobsController · jobs de Skydropx (D2d)', () => {
  const user = { id: 'sa-1', role: Role.super_admin };
  const stub = {} as never;
  function make() {
    const poll = { run: jest.fn(async () => ({ polled: 1, events: 0, applied: 0, errors: 0 })) };
    const proc = { run: jest.fn(async () => ({ processing: { checked: 0, errors: 0 } })) };
    const charges = { run: jest.fn(async () => ({ seen: 2, inserted: 1, duplicates: 1, unmatched: 0, unreadable: 0, chargedAtFallback: 0 })) };
    const audit = { log: jest.fn(async () => undefined) } as unknown as AuditService;
    const controller = new AdminJobsController(
      stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, audit, poll as never, proc as never, charges as never,
    );
    return { controller, poll, proc, charges, audit };
  }

  it('`shipment-tracking-poll {shipmentId}` pasa el id; audita con el resultado', async () => {
    const { controller, poll, audit } = make();
    const res = await controller.runShipmentTrackingPoll({ shipmentId: 'abc' }, user);
    expect(poll.run).toHaveBeenCalledWith({ shipmentId: 'abc' });
    expect(res.polled).toBe(1);
    const entry = (audit.log as jest.Mock).mock.calls[0][0];
    expect(entry).toEqual(expect.objectContaining({ action: 'jobs.shipment_tracking_poll.run', entityType: 'Job', entityId: 'shipment-tracking-poll', actorUserId: 'sa-1' }));
    expect(entry.after).toEqual(expect.objectContaining({ shipmentId: 'abc', polled: 1 }));
  });

  it('`shipment-label-processing` y `shipment-extra-charges` corren y auditan', async () => {
    const { controller, proc, charges, audit } = make();
    await controller.runShipmentLabelProcessing(user);
    await controller.runShipmentExtraCharges(user);
    expect(proc.run).toHaveBeenCalledTimes(1);
    expect(charges.run).toHaveBeenCalledTimes(1);
    expect((audit.log as jest.Mock).mock.calls.map((c) => c[0].action)).toEqual(['jobs.shipment_label_processing.run', 'jobs.shipment_extra_charges.run']);
  });

  it('responden 200 (como los barridos) y, sin el servicio, 404 (⛔ nunca un 500)', async () => {
    for (const m of ['runShipmentTrackingPoll', 'runShipmentLabelProcessing', 'runShipmentExtraCharges'] as const) {
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, AdminJobsController.prototype[m])).toBe(200);
    }
    const audit = { log: jest.fn() } as unknown as AuditService;
    const bare = new AdminJobsController(stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, audit);
    await expect(bare.runShipmentLabelProcessing(user)).rejects.toMatchObject({ status: 404 });
  });
});

