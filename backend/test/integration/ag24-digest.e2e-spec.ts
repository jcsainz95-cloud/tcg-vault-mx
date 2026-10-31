/**
 * ag24-digest.e2e-spec.ts — AG-24 (`psa_cycle_short`, API_CONTRACT §DYN.4.5) queda FUERA del resumen diario de gasto: ni cuenta
 * para enviarlo, ni sale su título o su código en el correo. Postgres real, `AppModule` entero (correo que captura, el arnés de
 * D2g). Propiedad: backend.
 *
 *  1. Un día con SOLO un AG-24 ⇒ `empty`, sin correo (AG-24 no cuenta para mandarlo).
 *  2. Un día con un AG-24 y otro aviso ⇒ UN correo con el otro y sin AG-24 (ni el código ni el título de DYN-UX), `alertCount` 1.
 * Determinista (N=1): días propios y lejanos, reloj explícito.
 */
import { SpendDigestService } from '../../src/modules/spend-alerts/spend-digest.service';
import { spendAlertTitle } from '../../src/modules/spend-alerts/spend-alert-text';
import { createSpendWorld, SpendWorld } from './helpers/spend-db';

let w: SpendWorld;
let digest: SpendDigestService;
const at = (iso: string) => new Date(iso);

beforeAll(async () => {
  w = await createSpendWorld();
  digest = w.h.app.get(SpendDigestService);
});
afterAll(async () => {
  if (w) await w.h.prisma.spendAlert.deleteMany({ where: { dedupKey: { startsWith: `ag24dig:${w.run}:` } } });
  await w?.close();
});

const ag24 = (key: string, when: string) =>
  w.h.prisma.spendAlert.create({
    data: {
      kind: 'psa_cycle_short',
      severity: 'digest',
      dedupKey: `ag24dig:${w.run}:${key}`,
      facts: { reason: 'projected', publishedCards: 1200, cycleDays: 12, dailyCreditCap: 100, capToCoverWeek: 172, setsOverCap: 0 },
      mailStatus: 'not_applicable',
      firstOccurredAt: at(when),
      lastOccurredAt: at(when),
    },
  });

describe('AG-24 fuera del resumen diario (§DYN.4.5)', () => {
  it('un día con SOLO AG-24 ⇒ `empty`, sin correo', async () => {
    const day = '2033-02-03';
    await w.h.prisma.spendDigestRun.deleteMany({ where: { day: new Date(`${day}T00:00:00Z`) } });
    w.mail.reset();
    await ag24('solo', '2033-02-03T18:00:00Z');
    // La corrida del cron de las 08:00 MX del día siguiente (`{day}` solo re-manda un `failed`).
    const r = await digest.run({ now: at('2033-02-04T14:00:00Z') });
    expect(r).toEqual({ day, status: 'empty', alertCount: 0 });
    expect(w.mail.sent).toHaveLength(0);
  });

  it('con AG-24 y otro aviso ⇒ el correo trae el otro y ⛔ nada de AG-24 (código ni título)', async () => {
    const day = '2033-02-05';
    await w.h.prisma.spendDigestRun.deleteMany({ where: { day: new Date(`${day}T00:00:00Z`) } });
    w.mail.reset();
    await ag24('con-otro', '2033-02-05T18:00:00Z');
    await w.h.prisma.spendAlert.create({
      data: {
        kind: 'label_cap_warning',
        severity: 'digest',
        dedupKey: `ag24dig:${w.run}:otro`,
        facts: {},
        mailStatus: 'not_applicable',
        firstOccurredAt: at('2033-02-05T19:00:00Z'),
        lastOccurredAt: at('2033-02-05T19:00:00Z'),
      },
    });
    const r = await digest.run({ now: at('2033-02-06T14:00:00Z') });
    expect(r).toEqual({ day, status: 'sent', alertCount: 1 });
    expect(w.mail.sent).toHaveLength(1);
    const body = `${w.mail.sent[0].subject}\n${w.mail.sent[0].text}\n${w.mail.sent[0].html ?? ''}`;
    expect(body).toContain(spendAlertTitle({ kind: 'label_cap_warning', facts: {} }, 'es'));
    expect(body).not.toContain('AG-24');
    for (const l of ['es', 'en'] as const) expect(body).not.toContain(spendAlertTitle({ kind: 'psa_cycle_short', facts: {} }, l));
  });
});
