import { Role } from '@prisma/client';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { AuditService } from '../audit/audit.service';
import { DecksMetaService } from './decks-meta.service';
import { DecksMetaRefreshService } from './decks-meta-refresh.service';
import { AdminDecksMetaController } from './admin-decks-meta.controller';
import * as adminControllerModule from './admin-decks-meta.controller';

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

/**
 * DECKS-META Fase 2 — endpoints de CONTROL DEL DIAL. GET (lectura, `vault_operator+`) y PUT
 * (super_admin sólo, auditado old→new): encenderlo dispara egress real + publicación.
 */
describe('AdminDecksMetaController · dial', () => {
  const superUser = { id: 'sa-1', role: Role.super_admin };

  function makeController(over: { setDial?: jest.Mock; loadDialState?: jest.Mock } = {}) {
    const service = {
      loadDialState: over.loadDialState ?? jest.fn(async () => ({ autofetch: 'off', autopublish: false })),
      adminSetDial:
        over.setDial ??
        jest.fn(async () => ({
          before: { autofetch: 'off', autopublish: false },
          after: { autofetch: 'on', autopublish: true },
        })),
    } as unknown as DecksMetaService;
    const refresh = {} as unknown as DecksMetaRefreshService;
    const audit = { log: jest.fn(async () => undefined) } as unknown as AuditService;
    const controller = new AdminDecksMetaController(service, refresh, audit);
    return { controller, service, audit };
  }

  it('GET dial devuelve el estado normalizado actual', async () => {
    const { controller, service } = makeController({
      loadDialState: jest.fn(async () => ({ autofetch: 'dryrun', autopublish: false })),
    });
    const res = await controller.dial();
    expect(res).toEqual({ autofetch: 'dryrun', autopublish: false });
    expect(service.loadDialState).toHaveBeenCalledTimes(1);
  });

  it('GET dial: unset ⇒ off/false (fail-closed vía el servicio)', async () => {
    const { controller } = makeController();
    expect(await controller.dial()).toEqual({ autofetch: 'off', autopublish: false });
  });

  it('PUT dial está gateado a super_admin SÓLO (override a nivel de método)', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, AdminDecksMetaController.prototype.setDial);
    expect(roles).toEqual([Role.super_admin]);
    // …y no incluye a vault_operator (que sí puede leer, pero no escribir).
    expect(roles).not.toContain(Role.vault_operator);
  });

  it('PUT dial escribe vía el servicio y devuelve el estado NUEVO', async () => {
    const setDial = jest.fn(async () => ({
      before: { autofetch: 'off', autopublish: false },
      after: { autofetch: 'on', autopublish: true },
    }));
    const { controller } = makeController({ setDial });
    const res = await controller.setDial({ autofetch: 'on', autopublish: true }, superUser);
    expect(setDial).toHaveBeenCalledWith({ autofetch: 'on', autopublish: true }, 'sa-1');
    expect(res).toEqual({ autofetch: 'on', autopublish: true });
  });

  it('PUT dial AUDITA `decks_meta.dial.set` con old→new y el actor', async () => {
    const { controller, audit } = makeController();
    await controller.setDial({ autofetch: 'on' }, superUser);
    expect(audit.log).toHaveBeenCalledTimes(1);
    const entry = (audit.log as jest.Mock).mock.calls[0][0];
    expect(entry.action).toBe('decks_meta.dial.set');
    expect(entry.actorUserId).toBe('sa-1');
    expect(entry.actorRole).toBe(Role.super_admin);
    expect(entry.before).toEqual({ autofetch: 'off', autopublish: false });
    expect(entry.after).toEqual({ autofetch: 'on', autopublish: true });
  });
});

/**
 * FUENTE-CONFIABLE (SUP-LEG): la rotación de legalidad desapareció. El controller
 * `AdminStandardLegalityController` y las rutas `GET/PUT /admin/config/standard-legality` YA NO
 * existen — Limitless publica sólo listas Standard-legal, así que no re-filtramos por marca/banlist.
 */
describe('AdminStandardLegalityController · retirado (SUP-LEG)', () => {
  it('el controller de rotación de legalidad ya NO se exporta', () => {
    expect((adminControllerModule as Record<string, unknown>).AdminStandardLegalityController).toBeUndefined();
  });
});
