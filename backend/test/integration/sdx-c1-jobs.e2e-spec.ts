/**
 * sdx-c1-jobs.e2e-spec.ts — 💰 C1 (API_CONTRACT §M4-SHIP.19.33.9, PS-172 (c)): los jobs de D2g cableados en la app REAL.
 * Postgres real, `AppModule` entero (el arnés de D2g: reloj del módulo manual, correo que captura, proveedor = el doble; ⛔ nunca
 * la red, ⛔ ninguna compra: PS-99). Propiedad: backend.
 *
 *  - El planificador RECIBE `SpendWatchService` y `SpendDigestService` del `SpendAlertsModule` real (el mismo control de cableado
 *    que `sdx-d2d-charges` para los jobs de Skydropx): sin esto, en producción los dos crons no se programan.
 *  - O-4, el ciclo entero: un 🔴 sembrado en `pending` ⇒ `POST /admin/jobs/spend-watch` (súper-admin) ⇒ el aviso queda `sent`
 *    y la dueña recibe el correo; el disparo audita `jobs.spend_watch.run`. Un operador ⇒ `403`.
 *  - `POST /admin/jobs/spend-digest`: `{day:'2026-13-01'}` ⇒ `400 VALIDATION_ERROR {field:'day'}` por HTTP (el `ValidationPipe`
 *    global con `whitelist` NO se come el campo); `{day}` válido ⇒ `200` con el resultado de `run`, auditado.
 */
import { SchedulerService } from '../../src/jobs/scheduler.service';
import { SpendAlertsService } from '../../src/modules/spend-alerts/spend-alerts.service';
import { SpendWatchService } from '../../src/modules/spend-alerts/spend-watch.service';
import { SpendDigestService } from '../../src/modules/spend-alerts/spend-digest.service';
import { createSpendWorld, neutralizeOtherAlerts, SpendWorld } from './helpers/spend-db';

let w: SpendWorld;

beforeAll(async () => {
  w = await createSpendWorld();
  // La marca observada la dejan otras suites con SU dueña: sin fila, la primera corrida la inserta con la de ésta y no avisa.
  await w.h.prisma.spendOwnerWatch.deleteMany({});
});
afterAll(async () => {
  if (w) await w.h.prisma.spendOwnerWatch.deleteMany({});
  await w?.close();
});

describe('PS-172 (c) — `spend-watch` / `spend-digest` cableados en el AppModule real', () => {
  it('cableado: el planificador recibe los DOS servicios del SpendAlertsModule real', () => {
    const sched = w.h.app.get(SchedulerService) as unknown as Record<string, unknown>;
    expect(sched.spendWatch).toBeDefined();
    expect(sched.spendWatch).toBe(w.h.app.get(SpendWatchService));
    expect(sched.spendDigest).toBeDefined();
    expect(sched.spendDigest).toBe(w.h.app.get(SpendDigestService));
  });

  it('O-4: un 🔴 `pending` sembrado ⇒ `POST /admin/jobs/spend-watch` lo deja `sent` (correo a la dueña) y audita; operador ⇒ 403', async () => {
    // Una hora propia de la corrida (el cupo de correos es por hora) y nada ajeno en la cola de despacho.
    w.clock.set(new Date(w.start.getTime() + 7 * 3600_000));
    w.mail.reset();
    await neutralizeOtherAlerts(w.h);
    const alerts = w.h.app.get(SpendAlertsService);
    const seeded = await alerts.raise(
      w.h.prisma,
      { kind: 'label_charged_unexplained', severity: 'immediate', dedupKey: `c1-ps172:${w.run}`, facts: { cause: 'orphan_fuse' } },
      w.clock.now(),
    );
    expect(seeded).not.toBeNull();
    expect((await w.h.prisma.spendAlert.findUniqueOrThrow({ where: { id: seeded!.id } })).mailStatus).toBe('pending');

    const denied = await w.h.api('POST', '/admin/jobs/spend-watch', { token: w.op.token, json: {} });
    expect(denied.status).toBe(403);
    expect((await w.h.prisma.spendAlert.findUniqueOrThrow({ where: { id: seeded!.id } })).mailStatus).toBe('pending');

    const res = await w.h.api('POST', '/admin/jobs/spend-watch', { token: w.v.token, json: {} });
    expect(res.status).toBe(200);
    expect(res.body.owner).toEqual(expect.objectContaining({ ownerUserId: w.owner.id }));
    expect(res.body.mail.sent).toBeGreaterThanOrEqual(1);

    const after = await w.h.prisma.spendAlert.findUniqueOrThrow({ where: { id: seeded!.id } });
    expect(after.mailStatus).toBe('sent');
    expect(w.mail.sent.map((m) => m.to)).toEqual([w.owner.email]);

    const log = await w.h.prisma.auditLog.findFirst({ where: { action: 'jobs.spend_watch.run', actorUserId: w.v.id }, orderBy: { createdAt: 'desc' } });
    expect(log).toEqual(expect.objectContaining({ entityType: 'Job', entityId: 'spend-watch' }));
  });

  it('O-4 por el camino del CRON: un 🔴 `pending` sembrado ⇒ el enrutado del planificador (`process({name:\'spend-watch\'})`) lo deja `sent`', async () => {
    // El worker de BullMQ llama a `SchedulerService.process(job)`; aquí se llama igual con el AppModule real (sin Redis bajo
    // NODE_ENV=test). Un `case 'spend-watch'` que falte ⇒ «Job desconocido», `null`, y el aviso se queda `pending`.
    w.clock.set(new Date(w.start.getTime() + 9 * 3600_000));
    w.mail.reset();
    await neutralizeOtherAlerts(w.h);
    const seeded = await w.h.app.get(SpendAlertsService).raise(
      w.h.prisma,
      { kind: 'label_charged_unexplained', severity: 'immediate', dedupKey: `c1-ps172-cron:${w.run}`, facts: { cause: 'orphan_fuse' } },
      w.clock.now(),
    );
    const sched = w.h.app.get(SchedulerService);
    const out = (await sched.process({ name: 'spend-watch' })) as { owner?: { ownerUserId: string | null } } | null;
    expect(out?.owner?.ownerUserId).toBe(w.owner.id);
    expect((await w.h.prisma.spendAlert.findUniqueOrThrow({ where: { id: seeded!.id } })).mailStatus).toBe('sent');
    expect(w.mail.sent.map((m) => m.to)).toEqual([w.owner.email]);
    // Y `spend-digest` por el mismo camino corre `run({})` (ayer en México según el reloj del módulo).
    const d = (await sched.process({ name: 'spend-digest' })) as { day: string; status: string } | null;
    expect(d).not.toBeNull();
    expect(d!.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('`POST /admin/jobs/spend-digest`: `day` mal formado ⇒ 400 {field:day} por HTTP; `day` válido ⇒ 200 auditado; operador ⇒ 403', async () => {
    for (const day of ['2026-13-01', '2026-10-5', 'ayer', 20261005]) {
      const bad = await w.h.api('POST', '/admin/jobs/spend-digest', { token: w.v.token, json: { day } });
      expect(bad.status).toBe(400);
      expect(bad.body.error).toEqual(expect.objectContaining({ code: 'VALIDATION_ERROR', details: { field: 'day' } }));
    }
    expect((await w.h.api('POST', '/admin/jobs/spend-digest', { token: w.op.token, json: {} })).status).toBe(403);
    const day = '2001-01-02'; // un día que nunca corrió: el re-envío manual solo re-manda un `failed` ⇒ `skipped`
    const ok = await w.h.api('POST', '/admin/jobs/spend-digest', { token: w.v.token, json: { day } });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual(expect.objectContaining({ day }));
    const log = await w.h.prisma.auditLog.findFirst({ where: { action: 'jobs.spend_digest.run', actorUserId: w.v.id }, orderBy: { createdAt: 'desc' } });
    expect(log).toEqual(expect.objectContaining({ entityType: 'Job', entityId: 'spend-digest' }));
    expect(w.fake.callsOf('purchase')).toHaveLength(0);
  });
});
