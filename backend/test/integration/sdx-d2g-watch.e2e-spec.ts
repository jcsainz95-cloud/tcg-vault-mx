/**
 * sdx-d2g-watch.e2e-spec.ts — 💰 los dos jobs de D2g llamados por `run()` (su registro en `jobs/` es la costura C1, §19.32.9),
 * contra Postgres REAL con el reloj del módulo inyectado y el DOBLE del proveedor (⛔ nunca la red). Propiedad: backend (D2g).
 *
 *  - PS-160 (d) / C-20 (b): paso (0) de `spend-watch` — el dueño cambia A→B→A→B (por SQL) ⇒ TRES AG-21 🔴 (G4, §19.33.7: la llave
 *    lleva el instante), cada uno con correo a A y a B; corrida sin cambio ⇒ nada; sin dueño ⇒ AG-21 `no_owner` y `error` en el log.
 *  - PS-147 (b): AG-8 (b) — cancelación sin cifra: día 2 nada, día 3 🔴 UNA vez (sellado); reembolso entero ⇒ nada.
 *  - PS-149: AG-10 — día 2 nada; día 3 🟡; tras salir ⇒ `resolvedAt`; guía cancelada ⇒ resuelto.
 *  - PS-146 (parte D2g): el saldo por la lectura CACHEADA de `spend-watch` ⇒ `observeBalance` (AG-7), una llamada por 5 min.
 *  - PS-154: el resumen de las 08:00 MX — con avisos ⇒ un correo; sin avisos ⇒ ninguno; dos corridas el mismo día ⇒ uno; un aviso
 *    a las 23:30 MX entra en ESE día; las cifras = `GET …/summary` del mismo día.
 */
import { Logger } from '@nestjs/common';
import { SpendAlertsService } from '../../src/modules/spend-alerts/spend-alerts.service';
import { SpendWatchService } from '../../src/modules/spend-alerts/spend-watch.service';
import { SpendDigestService } from '../../src/modules/spend-alerts/spend-digest.service';
import { ProviderBalanceService } from '../../src/modules/spend-alerts/provider-balance.service';
import { createSpendWorld, markOwner, mkSkydropxShipment, neutralizeOtherAlerts, SpendWorld } from './helpers/spend-db';

const DAY = 86400_000;
let w: SpendWorld;
let watch: SpendWatchService;
let digest: SpendDigestService;
let alerts: SpendAlertsService;
let savedProvider: { valueJson: unknown; updatedBy: string | null } | null = null;

beforeAll(async () => {
  w = await createSpendWorld();
  watch = w.h.app.get(SpendWatchService);
  digest = w.h.app.get(SpendDigestService);
  alerts = w.h.app.get(SpendAlertsService);
  const row = await w.h.prisma.configSetting.findUnique({ where: { key: 'shipping_provider' } });
  savedProvider = row ? { valueJson: row.valueJson, updatedBy: row.updatedBy } : null;
  await w.h.prisma.spendOwnerWatch.deleteMany({});
});
afterAll(async () => {
  if (w) {
    await w.h.prisma.configSetting.deleteMany({ where: { key: 'shipping_provider' } });
    if (savedProvider) await w.h.prisma.configSetting.create({ data: { key: 'shipping_provider', valueJson: savedProvider.valueJson as object, updatedBy: savedProvider.updatedBy } });
    await w.h.prisma.spendOwnerWatch.deleteMany({});
  }
  await w?.close();
});

async function provider(v: 'skydropx' | 'off') {
  await w.h.prisma.configSetting.upsert({ where: { key: 'shipping_provider' }, create: { key: 'shipping_provider', valueJson: v }, update: { valueJson: v } });
}

describe('PS-160 (d) / C-20 (b) — `spend-watch` paso (0): la marca del dueño', () => {
  it('primera corrida con dueña ⇒ fila, sin aviso; A→B→A→B por SQL ⇒ TRES AG-21 🔴 (G4), cada uno a A y a B; corrida sin cambio ⇒ nada', async () => {
    // ⚠️ v1.80.12.14 (§19.33.7 G4): cada cambio de la marca es un hecho NUEVO ⇒ `dedupKey` = `ag21:<anterior>:<actual>:<instante>`
    // con el `now` ISO de la corrida que lo detecta. Antes (`ag21:<anterior>:<actual>`) el segundo A→B se fundía con el primero.
    await neutralizeOtherAlerts(w.h);
    w.mail.reset();
    const r0 = await watch.run(w.clock.now());
    expect(r0.owner).toEqual({ ownerUserId: w.owner.id, changed: false, alertId: null });
    const A = w.owner;
    const B = w.w; // súper-admin con correo; el cambio solo se hace «desde el servidor» (aquí, SQL como `set-owner.ts`).
    const steps: Array<[typeof A, typeof A]> = [[A, B], [B, A], [A, B]];
    try {
      const seen: Array<{ id: string; at: Date; prev: typeof A; curr: typeof A; mailed: Array<string | null> }> = [];
      for (const [prev, curr] of steps) {
        w.clock.advance(60_000); // corridas distintas, instantes distintos (en producción, 5 min)
        await markOwner(w.h, curr.id);
        const at = w.clock.now();
        const sentBefore = w.mail.sent.length;
        const r = await watch.run(at);
        expect(r.owner.changed).toBe(true);
        seen.push({ id: r.owner.alertId!, at, prev, curr, mailed: w.mail.sent.slice(sentBefore).map((m) => m.to) });
      }
      // Primero la conducta (G4): TRES avisos distintos, cada uno visto una vez. Con la llave sin instante el tercero (A→B otra
      // vez) se funde con el primero ⇒ 2 ids y `occurrenceCount` 2.
      expect(new Set(seen.map((x) => x.id)).size).toBe(3);
      for (const x of seen) {
        const a = await w.h.prisma.spendAlert.findUniqueOrThrow({ where: { id: x.id } });
        expect(a).toMatchObject({ kind: 'owner_account_changed', severity: 'immediate', mailStatus: 'sent', occurrenceCount: 1 });
        expect(a.facts).toEqual({ cause: 'changed', previousOwner: { userId: x.prev.id, name: x.prev.name }, currentOwner: { userId: x.curr.id, name: x.curr.name } });
        // Individual (⛔ nunca al lote): un correo a la cuenta anterior y uno a la actual, en la corrida que lo detecta.
        expect(x.mailed.sort()).toEqual([A.email, B.email].sort());
        // La forma de la llave (§19.33.7 G4): `ag21:<anterior>:<actual>:<instante ISO de la corrida>`.
        expect(a.dedupKey).toBe(`ag21:${x.prev.id}:${x.curr.id}:${x.at.toISOString()}`);
      }
      for (const m of w.mail.sent) expect(`${m.subject}${m.text}`).not.toMatch(/@e2e\.local/);
      const n = w.mail.sent.length;
      expect(n).toBe(6);
      // La misma situación, otra corrida, sin cambio ⇒ nada (sigue «a lo sumo una vez por cambio»).
      w.clock.advance(60_000);
      const r2 = await watch.run(w.clock.now());
      expect(r2.owner).toEqual({ ownerUserId: B.id, changed: false, alertId: null });
      expect(w.mail.sent).toHaveLength(n);
    } finally {
      await markOwner(w.h, w.owner.id);
      w.clock.advance(60_000);
      await watch.run(w.clock.now()); // vuelve a A (otro AG-21, el de vuelta)
    }
  });

  it('sin dueño ⇒ AG-21 `no_owner` (correo a la cuenta anterior, que sigue con correo y activa) y `error` NO_OWNER_ACCOUNT en el log', async () => {
    await neutralizeOtherAlerts(w.h);
    w.mail.reset();
    const errors: string[] = [];
    const spy = jest.spyOn(Logger.prototype, 'error').mockImplementation((msg: unknown) => {
      errors.push(String(msg));
    });
    await markOwner(w.h, null);
    try {
      const r = await watch.run(w.clock.now());
      expect(r.owner.changed).toBe(true);
      const a = await w.h.prisma.spendAlert.findUniqueOrThrow({ where: { id: r.owner.alertId! } });
      expect(a.facts).toMatchObject({ cause: 'no_owner', currentOwner: null, previousOwner: { userId: w.owner.id } });
      expect(errors.some((e) => e.includes('NO_OWNER_ACCOUNT'))).toBe(true);
      expect(w.mail.sent.map((m) => m.to)).toEqual([w.owner.email]);
    } finally {
      spy.mockRestore();
      await markOwner(w.h, w.owner.id);
      await watch.run(w.clock.now());
    }
  });
});

describe('PS-147 (b) — AG-8 (b): la cancelación sin cifra de reembolso avisa al día 3, una vez', () => {
  it('día 2 nada; día 3 🔴 y sellado; otra corrida ⇒ nada; reembolso entero conocido ⇒ nunca', async () => {
    await provider('skydropx');
    const t0 = w.clock.now();
    const unknown = await mkSkydropxShipment(w);
    const known = await mkSkydropxShipment(w);
    await w.h.prisma.shipmentPaidLabel.update({ where: { id: unknown.paidLabelId }, data: { cancelledAt: t0, cancelKind: 'auto_close' } });
    await w.h.prisma.shipmentPaidLabel.update({ where: { id: known.paidLabelId }, data: { cancelledAt: t0, cancelKind: 'auto_close', unrefundedCents: 0 } });
    w.clock.set(new Date(t0.getTime() + 2 * DAY));
    await watch.run(w.clock.now());
    expect(await w.h.prisma.spendAlert.findUnique({ where: { dedupKey: `ag8:${unknown.paidLabelId}` } })).toBeNull();
    w.clock.set(new Date(t0.getTime() + 3 * DAY));
    await watch.run(w.clock.now());
    const a = await w.h.prisma.spendAlert.findUniqueOrThrow({ where: { dedupKey: `ag8:${unknown.paidLabelId}` } });
    expect(a).toMatchObject({ kind: 'cancel_refund_missing', severity: 'immediate', amountCents: 15000, shipmentRequestId: unknown.shipmentId, occurrenceCount: 1 });
    expect(a.facts).toEqual({ chargedCents: 15000, refundedCents: null, unrefundedCents: null, cancelKind: 'auto_close' });
    expect((await w.h.prisma.shipmentPaidLabel.findUniqueOrThrow({ where: { id: unknown.paidLabelId } })).refundAlertedAt).not.toBeNull();
    await watch.run(w.clock.now());
    expect((await w.h.prisma.spendAlert.findUniqueOrThrow({ where: { id: a.id } })).occurrenceCount).toBe(1);
    expect(await w.h.prisma.spendAlert.findUnique({ where: { dedupKey: `ag8:${known.paidLabelId}` } })).toBeNull();
    w.clock.set(t0);
  });
});

describe('PS-149 — AG-10: la guía comprada que no sale', () => {
  it('día 2 nada; día 3 🟡; tras salir ⇒ resuelto; con la guía cancelada ⇒ resuelto', async () => {
    await provider('skydropx');
    const t0 = w.clock.now();
    const a = await mkSkydropxShipment(w, { labelPurchasedAt: t0 });
    const b = await mkSkydropxShipment(w, { labelPurchasedAt: t0, carrierStatus: 'created' });
    w.clock.set(new Date(t0.getTime() + 2 * DAY + 3600_000));
    await watch.run(w.clock.now());
    expect(await w.h.prisma.spendAlert.findUnique({ where: { dedupKey: `ag10:${a.paidLabelId}` } })).toBeNull();
    w.clock.set(new Date(t0.getTime() + 3 * DAY + 60_000));
    await watch.run(w.clock.now());
    const ra = await w.h.prisma.spendAlert.findUniqueOrThrow({ where: { dedupKey: `ag10:${a.paidLabelId}` } });
    const rb = await w.h.prisma.spendAlert.findUniqueOrThrow({ where: { dedupKey: `ag10:${b.paidLabelId}` } });
    expect(ra).toMatchObject({ kind: 'label_not_shipped', severity: 'digest', resolvedAt: null, mailStatus: 'not_applicable' });
    expect(ra.facts).toEqual({ daysSincePurchase: 3, chargedCents: 15000, carrierName: 'DHL' });
    // Otra corrida sin cambios ⇒ ni aviso nuevo ni repetición.
    await watch.run(w.clock.now());
    expect((await w.h.prisma.spendAlert.findUniqueOrThrow({ where: { id: ra.id } })).occurrenceCount).toBe(1);
    // A salió (en tránsito); la guía de B se canceló.
    await w.h.prisma.shipmentRequest.update({ where: { id: a.shipmentId }, data: { carrierStatus: 'in_transit', carrierStatusAt: w.clock.now() } });
    await w.h.prisma.shipmentPaidLabel.update({ where: { id: b.paidLabelId }, data: { cancelledAt: w.clock.now(), cancelKind: 'auto_close', unrefundedCents: 0 } });
    const r = await watch.run(w.clock.now());
    expect(r.ag10.resolved).toBeGreaterThanOrEqual(2);
    expect((await w.h.prisma.spendAlert.findUniqueOrThrow({ where: { id: ra.id } })).resolvedAt).not.toBeNull();
    expect((await w.h.prisma.spendAlert.findUniqueOrThrow({ where: { id: rb.id } })).resolvedAt).not.toBeNull();
    w.clock.set(t0);
  });
});

describe('PS-146 (D2g) — el saldo por la lectura CACHEADA ⇒ AG-7; con el proveedor `off`, ni una llamada', () => {
  it('saldo bajo el umbral ⇒ `ag7:open` 🔴; cuatro corridas en 5 min ⇒ UNA llamada; `off` ⇒ cero', async () => {
    const bal = w.h.app.get(ProviderBalanceService);
    bal.invalidate();
    await provider('off');
    const calls = () => w.fake.calls.filter((c) => c.op === 'balance').length;
    const c0 = calls();
    await watch.run(w.clock.now());
    expect(calls()).toBe(c0);
    await provider('skydropx');
    await w.h.prisma.spendAlert.updateMany({ where: { dedupKey: 'ag7:open' }, data: { dedupKey: `ag7:closed:test-${w.run}`, resolvedAt: w.clock.now() } });
    w.fake.balanceCents = 40000;
    for (let i = 0; i < 4; i++) {
      await watch.run(w.clock.now());
      w.clock.advance(60_000);
    }
    expect(calls()).toBe(c0 + 1);
    const open = await w.h.prisma.spendAlert.findUniqueOrThrow({ where: { dedupKey: 'ag7:open' } });
    expect(open).toMatchObject({ kind: 'provider_balance_low', severity: 'immediate' });
    expect(open.facts).toMatchObject({ balanceCents: 40000 });
    // Sube el saldo y vence el caché ⇒ se resuelve solo.
    w.fake.balanceCents = 500000;
    w.clock.advance(5 * 60_000);
    await watch.run(w.clock.now());
    expect(await w.h.prisma.spendAlert.findUnique({ where: { dedupKey: 'ag7:open' } })).toBeNull();
    expect((await w.h.prisma.spendAlert.findUniqueOrThrow({ where: { id: open.id } })).resolvedAt).not.toBeNull();
    await provider('off');
  });
});

describe('PS-154 — el resumen de las 08:00 MX', () => {
  // Un día propio y lejano: 2032-06-14 (MX). 23:30 MX de ese día = 05:30Z del 15.
  const DAY_MX = '2032-06-14';
  const at = (iso: string) => new Date(iso);

  it('sin avisos ⇒ `empty`, sin correo; con avisos ⇒ UN correo; segunda corrida ⇒ nada; 23:30 MX cuenta en ESE día; cifras = `summary`', async () => {
    await w.h.prisma.spendDigestRun.deleteMany({ where: { day: { in: [new Date('2032-06-13T00:00:00Z'), new Date(`${DAY_MX}T00:00:00Z`)] } } });
    // Filas de PRUEBA de corridas anteriores de esta suite (mismo día lejano): fuera, o el conteo del día las sumaría.
    await w.h.prisma.spendAlert.deleteMany({ where: { dedupKey: { startsWith: 'dig:' } } });
    w.mail.reset();
    // Día vacío (el 13): a las 08:00 MX del 14 ⇒ `empty`, sin correo.
    const empty = await digest.run({ now: at('2032-06-14T14:00:00Z') });
    expect(empty).toEqual({ day: '2032-06-13', status: 'empty', alertCount: 0 });
    expect(w.mail.sent).toHaveLength(0);
    // Avisos del 14: uno a las 00:10 MX (06:10Z), uno a las 23:30 MX (05:30Z del 15), y uno a las 00:10 MX del 15 (no cuenta).
    const mk = (key: string, when: string, severity: 'immediate' | 'digest', muted = false) =>
      w.h.prisma.spendAlert.create({
        data: { kind: 'label_charged_unexplained', severity, dedupKey: `dig:${w.run}:${key}`, facts: { cause: 'orphan_fuse' }, mailStatus: 'not_applicable', firstOccurredAt: at(when), lastOccurredAt: at(when), amountCents: 1000, muted },
      });
    await mk('a', '2032-06-14T06:10:00Z', 'immediate');
    await mk('b', '2032-06-15T05:30:00Z', 'digest');
    await mk('c', '2032-06-15T06:10:00Z', 'immediate');
    await mk('m', '2032-06-14T12:00:00Z', 'digest', true);
    const r1 = await digest.run({ now: at('2032-06-15T14:00:00Z') });
    expect(r1).toEqual({ day: DAY_MX, status: 'sent', alertCount: 3 });
    expect(w.mail.sent).toHaveLength(1);
    expect(w.mail.sent[0].to).toBe(w.owner.email);
    expect(w.mail.sent[0].subject).toBe('Resumen de gasto del 14 de junio');
    expect(w.mail.sent[0].text).toMatch(/Además hubo 1 aviso apagado/);
    const r2 = await digest.run({ now: at('2032-06-15T14:05:00Z') });
    expect(r2.status).toBe('skipped');
    expect(w.mail.sent).toHaveLength(1);
    // Cifras = `GET …/summary` del mismo día (un cuerpo).
    const sum = (await w.h.api('GET', `/admin/spend-alerts/summary?from=${DAY_MX}&to=${DAY_MX}`, { token: w.owner.token })).body;
    const ag9 = sum.byKind.find((k: { code: string }) => k.code === 'AG-9');
    expect(ag9).toEqual({ code: 'AG-9', immediate: 1, digest: 1, amountCents: 2000 });
    expect(sum.mutedCount).toBe(1);
    expect(w.mail.sent[0].text).toContain('AG-9 · Cobro sin guía o guía de más · inmediatos 1 · del resumen 1 · MX$20.00');
  });

  it('un `failed` lo re-manda la siguiente corrida del cron (§19.29.7: «si no insertó y su status ≠ failed, no-op») o `{day}`; un día `sent` o nunca corrido, no', async () => {
    const day = '2032-07-01';
    await w.h.prisma.spendDigestRun.deleteMany({ where: { day: { in: [new Date(`${day}T00:00:00Z`), new Date('2032-07-02T00:00:00Z')] } } });
    await w.h.prisma.spendAlert.create({
      data: { kind: 'label_cap_warning', severity: 'digest', dedupKey: `dig:${w.run}:f`, facts: {}, mailStatus: 'not_applicable', firstOccurredAt: at('2032-07-01T18:00:00Z'), lastOccurredAt: at('2032-07-01T18:00:00Z') },
    });
    expect((await digest.run({ day: '2032-07-02' })).status).toBe('skipped'); // nunca corrió
    w.mail.reset();
    w.mail.failNext = 1;
    expect((await digest.run({ now: at('2032-07-02T14:00:00Z') })).status).toBe('failed');
    expect((await digest.run({ day })).status).toBe('sent'); // re-envío manual del `failed`
    expect(w.mail.sent).toHaveLength(1);
    expect((await digest.run({ day })).status).toBe('skipped'); // ya `sent`
    expect((await digest.run({ now: at('2032-07-02T14:05:00Z') })).status).toBe('skipped'); // cron: ya `sent`
    let row = await w.h.prisma.spendDigestRun.findUniqueOrThrow({ where: { day: new Date(`${day}T00:00:00Z`) } });
    expect([row.status, row.attempts]).toEqual(['sent', 2]);
    // Un `failed` también lo recoge la siguiente corrida del CRON el mismo día.
    await w.h.prisma.spendDigestRun.update({ where: { day: new Date(`${day}T00:00:00Z`) }, data: { status: 'failed' } });
    expect((await digest.run({ now: at('2032-07-02T14:10:00Z') })).status).toBe('sent');
    row = await w.h.prisma.spendDigestRun.findUniqueOrThrow({ where: { day: new Date(`${day}T00:00:00Z`) } });
    expect([row.status, row.attempts]).toEqual(['sent', 3]);
    void alerts;
  });
});
