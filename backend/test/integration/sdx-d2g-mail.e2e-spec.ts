/**
 * sdx-d2g-mail.e2e-spec.ts — 💰 PS-153 (correo al dueño, criterio 332) con C-24 (cupo por persona) y SDX-I-8 (enlaces), contra
 * Postgres REAL y la app Nest real (API_CONTRACT §19.29.5, §19.30.1 (6), §19.30.7, §19.30.9). Propiedad: backend (D2g).
 *
 * Reloj del módulo manual (una hora fija y lejana), puerto de correo que captura, proveedor = el doble (⛔ nunca la red).
 * Carrera: 10 avisos 🔴 despachados a la vez ⇒ ≤ 5 individuales, **N = 10 rondas**, proporción en el título.
 */
import { SpendAlertKind } from '@prisma/client';
import { SpendAlertsService, SpendFacts } from '../../src/modules/spend-alerts/spend-alerts.service';
import { SpendMailService, hourStartOf } from '../../src/modules/spend-alerts/spend-mail.service';
import { SpendWatchService } from '../../src/modules/spend-alerts/spend-watch.service';
import { CANARY, createSpendWorld, mkSkydropxShipment, neutralizeOtherAlerts, SpendWorld, markOwner } from './helpers/spend-db';

const ORIGIN = 'https://panel.d2g.test';
let w: SpendWorld;
let alerts: SpendAlertsService;
let mailer: SpendMailService;
const savedUrl = process.env.APP_PUBLIC_URL;

beforeAll(async () => {
  process.env.APP_PUBLIC_URL = ORIGIN;
  w = await createSpendWorld();
  alerts = w.h.app.get(SpendAlertsService);
  mailer = w.h.app.get(SpendMailService);
});
afterAll(async () => {
  if (savedUrl === undefined) delete process.env.APP_PUBLIC_URL;
  else process.env.APP_PUBLIC_URL = savedUrl;
  await w?.close();
});

let hourOffset = 0;
/**
 * Cada prueba en su PROPIA hora de reloj (el cupo es por hora): saltos de 1000 h, para que las horas que una prueba avance a
 * mano (la del contenido avanza una por correo) nunca se crucen con las de la siguiente.
 */
async function freshHour(): Promise<Date> {
  hourOffset += 1000;
  const t = new Date(w.start.getTime() + hourOffset * 3600_000);
  w.clock.set(t);
  w.mail.reset();
  await neutralizeOtherAlerts(w.h);
  return t;
}

async function raise(kind: SpendAlertKind, key: string, over: { subjectUserId?: string | null; facts?: SpendFacts; shipmentRequestId?: string; amountCents?: number } = {}) {
  const r = await alerts.raise(
    w.h.prisma,
    { kind, severity: 'immediate', dedupKey: `${key}:${w.run}:${hourOffset}`, subjectUserId: over.subjectUserId ?? null, shipmentRequestId: over.shipmentRequestId, amountCents: over.amountCents, facts: over.facts ?? {} },
    w.clock.now(),
  );
  return r!.id;
}

const statusOf = async (id: string) => (await w.h.prisma.spendAlert.findUniqueOrThrow({ where: { id } })).mailStatus;

describe('PS-153 — destinatarios: SOLO la cuenta del dueño', () => {
  it('un 🔴 sale a la dueña y a nadie más (súper-admin sin correo, heredado con correo sin marca, operador, cliente ⇒ nada)', async () => {
    await freshHour();
    const id = await raise('label_charged_unexplained', 'ag9-dest', { facts: { cause: 'orphan_fuse' } });
    expect(await mailer.dispatchOne(id, w.clock.now())).toBe('sent');
    expect(w.mail.sent.map((m) => m.to)).toEqual([w.owner.email]);
    expect(await statusOf(id)).toBe('sent');
  });

  it('sin dueño ⇒ `no_recipient` (el aviso sigue en el panel), ⛔ ni al heredado con correo', async () => {
    await freshHour();
    await markOwner(w.h, null);
    try {
      const id = await raise('label_charged_unexplained', 'ag9-noowner', { facts: { cause: 'orphan_fuse' } });
      expect(await mailer.dispatchOne(id, w.clock.now())).toBe('no_recipient');
      expect(w.mail.sent).toEqual([]);
      expect(await statusOf(id)).toBe('no_recipient');
    } finally {
      await markOwner(w.h, w.owner.id);
    }
  });
});

describe('PS-153 — el freno: 5 por hora + el lote «y N más»', () => {
  it('6 avisos 🔴 de sistema en una hora ⇒ 5 correos; al cerrar la hora, 1 de lote con UNA línea', async () => {
    const t = await freshHour();
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) ids.push(await raise('label_charged_unexplained', `ag9-six-${i}`, { facts: { cause: 'orphan_fuse' } }));
    const res = await mailer.dispatchPending(w.clock.now());
    expect(res.outcomes.sent).toBe(5);
    expect(res.outcomes.batched).toBe(1);
    expect(w.mail.sent).toHaveLength(5);
    const batched = await w.h.prisma.spendAlert.findMany({ where: { id: { in: ids }, mailStatus: 'batched' } });
    expect(batched).toHaveLength(1);
    expect(batched[0].batchHour?.toISOString()).toBe(hourStartOf(t).toISOString());
    // Hora sin cerrar ⇒ el lote espera.
    expect((await mailer.sendBatches(w.clock.now())).batches).toBe(0);
    w.clock.advance(3600_000);
    const b = await mailer.sendBatches(w.clock.now());
    expect(b).toEqual({ batches: 1, alerts: 1 });
    expect(w.mail.sent).toHaveLength(6);
    expect(w.mail.sent[5].subject).toMatch(/^1 aviso de gasto más entre las \d\d:\d\d y las \d\d:\d\d$/);
    expect(await statusOf(batched[0].id)).toBe('batch_sent');
    // El de lote no cuenta en el tope de la hora siguiente: un 🔴 nuevo sale individual.
    const next = await raise('label_charged_unexplained', 'ag9-next', { facts: { cause: 'orphan_fuse' } });
    expect(await mailer.dispatchOne(next, w.clock.now())).toBe('sent');
  });

  it('el mismo `dedupKey` dos veces ⇒ UN correo (la repetición sube `occurrenceCount`)', async () => {
    await freshHour();
    const a = await raise('label_charged_unexplained', 'ag9-same', { facts: { cause: 'orphan_fuse' } });
    await mailer.dispatchPending(w.clock.now());
    const b = await raise('label_charged_unexplained', 'ag9-same', { facts: { cause: 'orphan_fuse' } });
    expect(b).toBe(a);
    await mailer.dispatchPending(w.clock.now());
    expect(w.mail.sent).toHaveLength(1);
    expect((await w.h.prisma.spendAlert.findUniqueOrThrow({ where: { id: a } })).occurrenceCount).toBe(2);
  });

  it('fallo del puerto ⇒ el aviso sigue, `failed` con `mailAttempts` 1, y el reintento lo manda; 3 fallos ⇒ ya no se reintenta', async () => {
    await freshHour();
    const id = await raise('label_charged_unexplained', 'ag9-fail', { facts: { cause: 'orphan_fuse' } });
    w.mail.failNext = 1;
    expect(await mailer.dispatchOne(id, w.clock.now())).toBe('failed');
    let row = await w.h.prisma.spendAlert.findUniqueOrThrow({ where: { id } });
    expect([row.mailStatus, row.mailAttempts]).toEqual(['failed', 1]);
    await mailer.dispatchPending(w.clock.now());
    row = await w.h.prisma.spendAlert.findUniqueOrThrow({ where: { id } });
    expect(row.mailStatus).toBe('sent');
    expect(w.mail.sent).toHaveLength(1);

    const id2 = await raise('label_charged_unexplained', 'ag9-fail3', { facts: { cause: 'orphan_fuse' } });
    w.mail.failNext = 10;
    for (let i = 0; i < 5; i++) await mailer.dispatchPending(w.clock.now());
    row = await w.h.prisma.spendAlert.findUniqueOrThrow({ where: { id: id2 } });
    expect([row.mailStatus, row.mailAttempts]).toEqual(['failed', 3]);
  });

  it('`sending` de más de 10 min ⇒ `failed_unknown`, ⛔ sin reenvío', async () => {
    await freshHour();
    const id = await raise('label_charged_unexplained', 'ag9-stale', { facts: { cause: 'orphan_fuse' } });
    await alerts.mailTransition(w.h.prisma, id, ['pending'], { mailStatus: 'sending', mailedAt: w.clock.now() });
    w.clock.advance(11 * 60_000);
    const r = await mailer.dispatchPending(w.clock.now());
    expect(r.staleUnknown).toBeGreaterThanOrEqual(1);
    expect(await statusOf(id)).toBe('failed_unknown');
    await mailer.dispatchPending(w.clock.now());
    expect(w.mail.sent).toHaveLength(0);
  });
});

describe('C-24 / SDX-Z-6 — como mucho 2 correos inmediatos por persona y hora', () => {
  it('5 AG-1 🔴 del mismo operador en 10 min y luego AG-9 `orphan_fuse` ⇒ 2 individuales + el AG-9 individual; 3 al lote', async () => {
    await freshHour();
    const ag1: string[] = [];
    for (let i = 0; i < 5; i++) {
      ag1.push(await raise('label_after_address_fix', `ag1-c24-${i}`, { subjectUserId: w.op.id, facts: { changedKeys: ['line1'], carrierName: 'DHL', chargedCents: 15000 } }));
      await mailer.dispatchPending(w.clock.now());
      w.clock.advance(2 * 60_000);
    }
    const fuse = await raise('label_charged_unexplained', 'ag9-c24-fuse', { facts: { cause: 'orphan_fuse' } });
    await mailer.dispatchPending(w.clock.now());
    const rows = await w.h.prisma.spendAlert.findMany({ where: { id: { in: [...ag1, fuse] } } });
    const by = (s: string) => rows.filter((r) => r.mailStatus === s).map((r) => r.id);
    expect(by('sent').sort()).toEqual([ag1[0], ag1[1], fuse].sort());
    expect(by('batched').sort()).toEqual(ag1.slice(2).sort());
    expect(w.mail.sent).toHaveLength(3);
  });

  it('control: con 5 de SISTEMA en la hora, el 6.º de sistema sí cae al lote (el AG-9 de arriba salió por el cupo POR PERSONA, no por suerte)', async () => {
    await freshHour();
    for (let i = 0; i < 5; i++) await raise('label_charged_unexplained', `ag9-ctl-${i}`, { facts: { cause: 'orphan_fuse' } });
    await mailer.dispatchPending(w.clock.now());
    const sixth = await raise('label_charged_unexplained', 'ag9-ctl-6', { facts: { cause: 'orphan_fuse' } });
    expect(await mailer.dispatchOne(sixth, w.clock.now())).toBe('batched');
  });
});

describe('AG-21 nunca va al lote y va también a la cuenta ANTERIOR (§19.30.1 (6))', () => {
  it('con el cupo de la hora lleno, AG-21 sale individual a la dueña y a la anterior (con correo y activa)', async () => {
    await freshHour();
    for (let i = 0; i < 5; i++) await raise('label_charged_unexplained', `ag9-fill-${i}`, { facts: { cause: 'orphan_fuse' } });
    await mailer.dispatchPending(w.clock.now());
    expect(w.mail.sent).toHaveLength(5);
    const id = await raise('owner_account_changed', 'ag21-cap', {
      facts: { cause: 'changed', previousOwner: { userId: w.w.id, name: w.w.name }, currentOwner: { userId: w.owner.id, name: w.owner.name } } as unknown as SpendFacts,
    });
    expect(await mailer.dispatchOne(id, w.clock.now())).toBe('sent');
    const to = w.mail.sent.slice(5).map((m) => m.to).sort();
    expect(to).toEqual([w.owner.email, w.w.email].sort());
    const prevMail = w.mail.sent.slice(5).find((m) => m.to === w.w.email)!;
    expect(prevMail.text).toMatch(/era la de la cuenta del dueño de TCG HUNT hasta este cambio/);
  });
});

describe('PS-153 / GAS-2 — ⛔ ningún dato del cliente; SDX-I-8 — enlaces solo a páginas del panel', () => {
  it('cada tipo con disparador, ligado a un envío con dirección CANARIA, renderizado y despachado: cero nombre/calle/CP/teléfono/CLABE/correo del cliente; todo enlace `appUrl(admin/…)`, sin `/api/`, sin `?`, sin token', async () => {
    await freshHour();
    const s = await mkSkydropxShipment(w);
    const facts: Partial<Record<SpendAlertKind, SpendFacts>> = {
      label_after_address_fix: { changedKeys: ['line1', 'postalCode', 'recipientName'], carrierName: 'DHL', chargedCents: 15000, correctionAt: 'x', revisionCount: 1 },
      label_cap_warning: { usedCents: 200000, capCents: 250000, pct: 80 },
      label_cap_blocked: { shipmentId: s.shipmentId, priceCents: 15000, usedCents: 240000, capCents: 250000 },
      label_reissue_loop: { cancelledCount: 2, unrecoveredCents: 500, unknownRefunds: 1, actors: [w.op.name], triggers: ['shipment_cancels'] },
      label_charge_drift: { quotedCents: 15000, chargedCents: 17500, diffCents: 2500 },
      carrier_extra_charge: { kind: 'overweight', carrierName: 'DHL', amountCents: 9000 },
      provider_balance_low: { balanceCents: 40000, thresholdCents: 100000 },
      cancel_refund_missing: { chargedCents: 15000, refundedCents: null, unrefundedCents: null, cancelKind: 'reissue' },
      label_charged_unexplained: { cause: 'charged_not_found', expectedChargeCents: 15000, providerReference: 'ENV-000045-01' },
      label_not_shipped: { daysSincePurchase: 3, chargedCents: 15000, carrierName: 'DHL' },
      parcel_returned: { status: 'in_return', carrierName: 'DHL', chargedCents: 15000 },
      parcel_problem: { status: 'exception', carrierName: 'DHL' },
      label_costly_choice: { marginCents: -300, priceCents: 15000, recommendedPriceCents: 12000, overRecommendedCents: 3000 },
      staff_control_by_non_owner: { act: 'staff_created', target: { userId: w.op.id, name: w.op.name, role: 'vault_operator' }, keys: null } as unknown as SpendFacts,
    };
    const ids: string[] = [];
    for (const [kind, f] of Object.entries(facts) as [SpendAlertKind, SpendFacts][]) {
      const person = ['label_after_address_fix', 'label_cap_warning', 'label_cap_blocked', 'label_costly_choice', 'staff_control_by_non_owner'].includes(kind);
      ids.push(await raise(kind, `canary-${kind}`, { subjectUserId: person ? w.op.id : null, shipmentRequestId: s.shipmentId, amountCents: 15000, facts: f }));
    }
    // Sin cupo de hora: se despacha uno por hora de reloj (el contenido es lo que se mide aquí).
    for (const id of ids) {
      w.clock.advance(3600_000);
      expect(await mailer.dispatchOne(id, w.clock.now())).toBe('sent');
    }
    expect(w.mail.sent).toHaveLength(ids.length);
    const forbidden = [CANARY.name, CANARY.line1, CANARY.postalCode, CANARY.phone, CANARY.clabe, CANARY.email, w.customer.email!, w.customer.name];
    for (const m of w.mail.sent) {
      const all = `${m.subject}\n${m.html}\n${m.text}`;
      for (const c of forbidden) expect({ subject: m.subject, leaks: all.includes(c) ? c : null }).toEqual({ subject: m.subject, leaks: null });
      const hrefs = [...m.html.matchAll(/href="([^"]*)"/g)].map((x) => x[1].replace(/&amp;/g, '&'));
      const textUrls = [...m.text.matchAll(/https?:\/\/\S+/g)].map((x) => x[0]);
      expect(hrefs.length).toBeGreaterThan(0);
      for (const u of [...hrefs, ...textUrls]) {
        expect(u.startsWith(`${ORIGIN}/es/admin/`)).toBe(true);
        expect(u).not.toMatch(/\/api\//);
        expect(u).not.toMatch(/[?#]|token/i);
      }
      // El folio del envío sí viaja (es nuestro, no del cliente) — salvo AG-22, que es sobre una CUENTA (sin envío en el correo).
      if (!m.subject.startsWith('Cambios de otro súper-admin')) expect(all).toContain(s.folio);
    }
  });
});

describe('PS-153 — CARRERA: 10 avisos 🔴 despachados a la vez ⇒ ≤ 5 individuales (N = 10 rondas)', () => {
  it('proporción de rondas con ≤ 5 individuales y exactamente 5 + 5 al lote: esperado 10/10', async () => {
    const N = 10;
    let ok = 0;
    const detail: string[] = [];
    for (let round = 0; round < N; round++) {
      await freshHour();
      const ids: string[] = [];
      for (let i = 0; i < 10; i++) ids.push(await raise('label_charged_unexplained', `race-${round}-${i}`, { facts: { cause: 'orphan_fuse' } }));
      const outcomes = await Promise.all(ids.map((id) => mailer.dispatchOne(id, w.clock.now())));
      const sent = outcomes.filter((o) => o === 'sent').length;
      const batched = outcomes.filter((o) => o === 'batched').length;
      detail.push(`${sent}+${batched}`);
      if (sent === 5 && batched === 5 && w.mail.sent.length === 5) ok += 1;
    }
    // eslint-disable-next-line no-console
    console.log(`PS-153 carrera: ${ok}/${N} rondas con 5 individuales + 5 al lote [${detail.join(' ')}] (autor: backend D2g)`);
    expect(ok).toBe(N);
  });
});

describe('`spend-watch` paso (1)–(2) recoge lo que el disparador dejó `pending` (outbox)', () => {
  it('un 🔴 levantado sin despachar sale en la corrida de `spend-watch`; su lote, en la de la hora siguiente', async () => {
    await freshHour();
    const watch = w.h.app.get(SpendWatchService);
    // Asienta el paso (0) (la fila de `SpendOwnerWatch` puede venir de otra suite: su AG-21 ocuparía un hueco de la hora).
    await watch.run(w.clock.now());
    await freshHour();
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) ids.push(await raise('label_charged_unexplained', `watch-${i}`, { facts: { cause: 'orphan_fuse' } }));
    const r1 = await watch.run(w.clock.now());
    expect(r1.mail.sent).toBe(5);
    expect(r1.mail.batched).toBe(1);
    w.clock.advance(3600_000);
    const r2 = await watch.run(w.clock.now());
    expect(r2.batches).toEqual({ batches: 1, alerts: 1 });
  });
});
