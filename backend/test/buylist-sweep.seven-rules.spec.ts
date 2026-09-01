import { BuylistSweepJobService } from '../src/jobs/buylist-sweep.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { MailPort } from '../src/modules/mail/mail.port';
import { addBusinessDays, isBusinessDay } from '../src/common/business-days';

/**
 * v1.51 (§4.39j) — **EL BARRIDO: SIETE REGLAS, UN SOLO JOB Y UN SOLO CRON.**
 *
 * Lo que estos tests protegen:
 *  - **D23: el recordatorio sale UNA vez**, no en cada corrida. *Un segundo recordatorio idéntico
 *    destruye la credibilidad del primero.*
 *  - **D14: una oferta de viernes no vence el domingo.**
 *  - **D22: al expirar con guía emitida, la tarea de cancelarla queda encolada** — las dos mitades.
 *  - **El candado de §P.13:** solo se expira si **no hubo NINGUNA** de las dos señales.
 *  - Los tres correos salen **después** del commit (`callOrder`), y su fallo **no revierte** nada.
 */

const NOW = new Date('2026-09-08T14:00:00Z'); // martes

interface Rows {
  ofertada?: Record<string, unknown>[];
  aceptada?: Record<string, unknown>[];
  cotizada?: Record<string, unknown>[];
  verificacion?: Record<string, unknown>[];
  recibida?: Record<string, unknown>[];
}

function build(rows: Rows, opts: { mailFails?: boolean } = {}) {
  const callOrder: string[] = [];
  const state = new Map<string, Record<string, unknown>>();
  for (const list of Object.values(rows)) {
    for (const r of list ?? []) state.set(r.id as string, { ...r });
  }
  const matches = (value: unknown, cond: unknown): boolean => {
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      const c = cond as Record<string, unknown>;
      if ('in' in c) return (c.in as unknown[]).includes(value);
      if ('not' in c && Object.keys(c).length === 1) return !matches(value, c.not);
      let ok = true;
      if ('not' in c) ok = ok && !matches(value, c.not);
      if ('lte' in c) ok = ok && value instanceof Date && value <= (c.lte as Date);
      if ('gt' in c) ok = ok && value instanceof Date && value > (c.gt as Date);
      return ok;
    }
    if (value instanceof Date && cond instanceof Date) return value.getTime() === cond.getTime();
    return value === cond;
  };
  const prisma: any = {
    sellRequest: {
      // Responde por REGLA (según el `status` pedido), no por orden de llamada.
      findMany: jest.fn(async ({ where }: any) => {
        const st = where?.status;
        const key = typeof st === 'string' ? st : (st?.in?.[0] ?? 'otro');
        const candidatos = (rows as Record<string, Record<string, unknown>[]>)[key] ?? [];
        // ⚠️ El fake EVALÚA el `where`: un mock que devolviera todas las filas dejaría pasar los
        // tests aunque los candados (`sellerShippedDeclaredAt: null`, el sello del recordatorio…)
        // no existieran.
        return candidatos
          .map((r) => state.get(r.id as string) as Record<string, unknown>)
          .filter((r) =>
            Object.entries(where).every(([k, cond]) => (k === 'status' ? true : matches(r[k], cond))),
          )
          .map((r) => ({ items: [{ offerDecision: 'buy' }], ...r }));
      }),
      findUnique: jest.fn(async ({ where }: any) => state.get(where.id) ?? null),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const row = state.get(where.id as string);
        if (!row) return { count: 0 };
        const { id: _id, ...rest } = where;
        if (!Object.entries(rest).every(([k, c]) => matches(row[k], c))) return { count: 0 };
        callOrder.push(`update:${where.id}`);
        Object.assign(row, data);
        return { count: 1 };
      }),
      update: jest.fn(async () => {
        throw new Error('el barrido NO transiciona con `update`: la guarda es el updateMany');
      }),
    },
  };
  const settings = { getNumber: jest.fn(async () => 7) } as unknown as SettingsService;
  const mail: MailPort = {
    send: jest.fn(async (m: any) => {
      callOrder.push('mail.send');
      if (opts.mailFails) throw new Error('resend caído');
      return { id: 'm', ...m };
    }),
  };
  const svc = new BuylistSweepJobService(prisma as PrismaService, settings, mail);
  return { svc, state, mail, callOrder, prisma };
}

const base = (over: Record<string, unknown> = {}) => ({
  id: 'sr-1',
  userId: 'u-1',
  user: { name: 'Ash', email: 'ash@e.mx', locale: 'es' },
  status: 'ofertada',
  closedAt: null,
  createdAt: new Date('2026-09-01T00:00:00Z'),
  offerState: 'sent',
  offerAcceptDeadlineAt: null,
  offerAcceptReminderSentAt: null,
  offerNetCents: 72000,
  shipDeadlineAt: null,
  shipReminderSentAt: null,
  sellerShippedDeclaredAt: null,
  shipmentConfirmedAt: null,
  shipmentCarrier: null,
  shipmentTrackingNumber: null,
  guideCancellationPendingAt: null,
  guideCancellationDoneAt: null,
  offerIssueClockStartedAt: null,
  receivedAt: null,
  adjustmentSentAt: null,
  expiredReason: null,
  declinedBy: null,
  ...over,
});

// =============================================================================================
describe('⚠️ D23 — el recordatorio sale UNA VEZ, no en cada corrida', () => {
  // Plazo mañana: la ventana de «falta 1 día hábil» dura más de una corrida del barrido.
  const manana = addBusinessDays(NOW, 1);

  it('dos corridas seguidas ⇒ UN SOLO envío', async () => {
    const { svc, mail, state } = build({
      ofertada: [base({ offerAcceptDeadlineAt: manana })],
    });
    await svc.run(NOW);
    expect(mail.send).toHaveBeenCalledTimes(1);
    // El sello vive en la BD, no en la memoria del job.
    expect(state.get('sr-1')?.offerAcceptReminderSentAt).toBeInstanceOf(Date);

    await svc.run(NOW);
    // ⚠️ Sigue siendo UNO: un segundo recordatorio idéntico destruye la credibilidad del primero.
    expect(mail.send).toHaveBeenCalledTimes(1);
  });

  it('⚠️ y el candado de CONCURRENCIA: si otra corrida gana el sello, NO se manda el correo', async () => {
    // La prueba anterior demuestra el guardado SECUENCIAL (la segunda corrida ya no ve la fila).
    // Ésta demuestra el otro: dos corridas simultáneas leen la fila SIN sellar y las dos llegan al
    // envío — solo la que hace `count === 1` puede mandarlo. Sin el `continue`, el vendedor recibe
    // dos correos idénticos.
    const { svc, mail, prisma } = build({
      ofertada: [base({ offerAcceptDeadlineAt: addBusinessDays(NOW, 1) })],
    });
    // El sello lo gana OTRO: nuestro `updateMany` del recordatorio devuelve 0.
    const real = prisma.sellRequest.updateMany;
    prisma.sellRequest.updateMany = jest.fn(async (args: any) =>
      'offerAcceptReminderSentAt' in (args.data ?? {}) ? { count: 0 } : real(args),
    );
    await svc.run(NOW);
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('el recordatorio de ENVÍO también sale una sola vez, y lleva la guía', async () => {
    const { svc, mail, state } = build({
      aceptada: [
        base({
          status: 'aceptada',
          shipDeadlineAt: manana,
          shipmentCarrier: 'Estafeta',
          shipmentTrackingNumber: 'GUIA-1',
        }),
      ],
    });
    await svc.run(NOW);
    await svc.run(NOW);
    expect(mail.send).toHaveBeenCalledTimes(1);
    expect(state.get('sr-1')?.shipReminderSentAt).toBeInstanceOf(Date);
    const msg = (mail.send as jest.Mock).mock.calls[0][0];
    expect(msg.text).toMatch(/GUIA-1/);
    // §P.13: la salida que evita perder la venta por una demora NUESTRA.
    expect(msg.text).toMatch(/detenemos el reloj/i);
  });

  it('⚠️ el recordatorio repite la CONDICIÓN NM junto a la cifra (R2), y NO re-lista el desglose', async () => {
    const { svc, mail } = build({ ofertada: [base({ offerAcceptDeadlineAt: manana })] });
    await svc.run(NOW);
    const msg = (mail.send as jest.Mock).mock.calls[0][0];
    // Repetir el neto SIN la condición la degrada a letra chica por omisión — lo que D30 impide.
    expect(msg.text).toMatch(/siempre que lleguen en Near Mint/);
    expect(msg.text).toMatch(/SE TE DEPOSITAN/);
    // Y no se re-lista la tabla: un recordatorio que la repite se lee como una OFERTA NUEVA.
    expect(msg.text).not.toMatch(/COMPRAMOS \(/);
  });

  it('a quien ya dijo «ya lo mandé» NO se le recuerda que envíe', async () => {
    const { svc, mail } = build({
      aceptada: [
        base({
          status: 'aceptada',
          shipDeadlineAt: manana,
          sellerShippedDeclaredAt: new Date('2026-09-07T00:00:00Z'),
        }),
      ],
    });
    await svc.run(NOW);
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('con el plazo lejos todavía NO se recuerda', async () => {
    const { svc, mail } = build({
      ofertada: [base({ offerAcceptDeadlineAt: addBusinessDays(NOW, 5) })],
    });
    await svc.run(NOW);
    expect(mail.send).not.toHaveBeenCalled();
  });
});

// =============================================================================================
describe('⚠️ D14 — una oferta de VIERNES no vence el domingo', () => {
  it('viernes + 2 días hábiles cae en día hábil, y el recordatorio se ancla a esa fecha', async () => {
    const viernes = new Date('2026-09-04T18:00:00Z');
    const vence = addBusinessDays(viernes, 2);
    expect(isBusinessDay(vence)).toBe(true);
    // Ni sábado ni domingo de ese fin de semana.
    expect(vence.getTime()).toBeGreaterThan(new Date('2026-09-06T23:59:59Z').getTime());

    // Y el barrido del viernes NO la expira: el plazo todavía no llegó.
    const { svc, state, mail } = build({
      ofertada: [base({ offerAcceptDeadlineAt: vence })],
    });
    await svc.run(viernes);
    expect(state.get('sr-1')?.status).toBe('ofertada');
    expect(mail.send).not.toHaveBeenCalled();
  });
});

// =============================================================================================
describe('Regla 1 — oferta sin respuesta ⇒ `rechazada` + correo 3a', () => {
  it('expira, sella `closedAt` y manda el correo DESPUÉS del commit', async () => {
    const { svc, state, mail, callOrder } = build({
      ofertada: [base({ offerAcceptDeadlineAt: new Date('2026-09-07T00:00:00Z') })],
    });
    const res = await svc.run(NOW);
    expect(res.offersExpired).toBe(1);
    expect(state.get('sr-1')?.status).toBe('rechazada');
    expect(state.get('sr-1')?.closedAt).toEqual(NOW);
    // Post-commit: la escritura ocurre ANTES del envío.
    expect(callOrder.indexOf('mail.send')).toBeGreaterThan(callOrder.indexOf('update:sr-1'));
    const msg = (mail.send as jest.Mock).mock.calls[0][0];
    expect(msg.subject).toMatch(/venci[óo]/i);
    // ⚠️ SIN MONTOS: el monto ya no se va a pagar y mencionarlo solo duele.
    expect(msg.text).not.toMatch(/MX\$/);
  });

  it('el fallo del correo NO revierte la expiración', async () => {
    const { svc, state } = build(
      { ofertada: [base({ offerAcceptDeadlineAt: new Date('2026-09-07T00:00:00Z') })] },
      { mailFails: true },
    );
    await expect(svc.run(NOW)).resolves.toBeDefined();
    expect(state.get('sr-1')?.status).toBe('rechazada');
  });
});

// =============================================================================================
describe('⚠️ Regla 2 — el candado de §P.13 y las dos mitades de D22', () => {
  const vencida = {
    status: 'aceptada',
    shipDeadlineAt: new Date('2026-09-07T00:00:00Z'),
  };

  it('sin ninguna de las dos señales ⇒ `expirada` + `not_shipped` + correo 3b', async () => {
    const { svc, state, mail } = build({ aceptada: [base(vencida)] });
    const res = await svc.run(NOW);
    expect(res.shipmentsExpired).toBe(1);
    expect(state.get('sr-1')).toMatchObject({ status: 'expirada', expiredReason: 'not_shipped' });
    expect((mail.send as jest.Mock).mock.calls[0][0].text).not.toMatch(/MX\$/);
  });

  it('⚠️ con el «ya lo mandé» NO expira: el vendedor cumplió', async () => {
    // El caso que motiva todo el diseño: deposita el día 3, confirmamos el día 4.
    const { svc, state, mail } = build({
      aceptada: [base({ ...vencida, sellerShippedDeclaredAt: new Date('2026-09-06T00:00:00Z') })],
    });
    const res = await svc.run(NOW);
    expect(res.shipmentsExpired).toBe(0);
    expect(state.get('sr-1')?.status).toBe('aceptada');
    expect(state.get('sr-1')?.closedAt).toBeNull();
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('con el envío ya confirmado tampoco expira', async () => {
    const { svc, state } = build({
      aceptada: [base({ ...vencida, shipmentConfirmedAt: new Date('2026-09-06T00:00:00Z') })],
    });
    await svc.run(NOW);
    expect(state.get('sr-1')?.status).toBe('aceptada');
  });

  it('una `aceptada` SIN GUÍA no corre reloj: `shipDeadlineAt` nulo ⇒ no expira', async () => {
    // Correcto: la etiqueta depende de NOSOTROS (§P.13). El pendiente se ve en `awaitingGuide`.
    const { svc, state } = build({
      aceptada: [base({ status: 'aceptada', shipDeadlineAt: null })],
    });
    await svc.run(NOW);
    expect(state.get('sr-1')?.status).toBe('aceptada');
  });

  it('⚠️ D22 — al expirar CON guía emitida, la tarea de cancelarla queda ENCOLADA', async () => {
    const { svc, state } = build({
      aceptada: [
        base({ ...vencida, shipmentCarrier: 'Estafeta', shipmentTrackingNumber: 'GUIA-MUERTA' }),
      ],
    });
    await svc.run(NOW);
    expect(state.get('sr-1')?.status).toBe('expirada');
    // Las dos mitades: que la etiqueta sea cancelable no sirve si nadie avisa.
    expect(state.get('sr-1')?.guideCancellationPendingAt).toEqual(NOW);
    // Y el número NO se borra: es lo que hace la fila trabajable.
    expect(state.get('sr-1')?.shipmentTrackingNumber).toBe('GUIA-MUERTA');
  });

  it('sin guía emitida NO se abre tarea (no hay etiqueta que cancelar)', async () => {
    const { svc, state } = build({ aceptada: [base(vencida)] });
    await svc.run(NOW);
    expect(state.get('sr-1')?.guideCancellationPendingAt).toBeNull();
  });
});

// =============================================================================================
describe('⚠️ Regla 7 (D33/D38) — la solicitud que NADIE ofertó', () => {
  it('7 días hábiles sin oferta ⇒ `expirada`/`no_offer` + CORREO 4, y `declinedBy` queda `null`', async () => {
    const { svc, state, mail } = build({
      cotizada: [base({ status: 'cotizada', offerState: null, createdAt: new Date('2026-08-20T00:00:00Z') })],
    });
    const res = await svc.run(NOW);
    expect(res.notPursued).toBe(1);
    expect(state.get('sr-1')).toMatchObject({ status: 'expirada', expiredReason: 'no_offer' });
    // Lo cerró el barrido, no una persona: es el único discriminador con `decline`.
    expect(state.get('sr-1')?.declinedBy).toBeNull();
    const msg = (mail.send as jest.Mock).mock.calls[0][0];
    expect(msg.text).toMatch(/no vamos a proceder/i);
  });

  it('⚠️ el correo 4 NO dice «venció», no explica, no lleva montos y no habla del tiempo', async () => {
    const { svc, mail } = build({
      cotizada: [base({ status: 'cotizada', offerState: null, createdAt: new Date('2026-08-20T00:00:00Z') })],
    });
    await svc.run(NOW);
    const msg = (mail.send as jest.Mock).mock.calls[0][0];
    // Nada expiró por su culpa: la cerramos nosotros.
    expect(msg.text).not.toMatch(/venci[óo]|vence/i);
    // Ni el porqué, ni el tiempo transcurrido, ni un monto.
    expect(msg.text).not.toMatch(/MX\$/);
    expect(msg.text).not.toMatch(/tras revisar|después de \d|demora/i);
    // Lo que SÍ dice: que no tiene nada que hacer.
    expect(msg.text).toMatch(/no hay nada pendiente de tu parte/i);
  });

  it('⚠️ anula la oferta `pending_authorization` EN LA MISMA escritura', async () => {
    // Sin esto, el súper-admin autorizaría después sobre una solicitud TERMINAL, mandando un correo
    // vinculante a alguien a quien acabamos de escribirle que no procederíamos.
    const { svc, state } = build({
      cotizada: [
        base({
          status: 'cotizada',
          offerState: 'pending_authorization',
          createdAt: new Date('2026-08-20T00:00:00Z'),
        }),
      ],
    });
    await svc.run(NOW);
    expect(state.get('sr-1')).toMatchObject({ status: 'expirada', offerState: 'cancelled' });
    expect(state.get('sr-1')?.offerCancelledAt).toEqual(NOW);
  });

  it('⚠️ D38 — el ancla es `offerIssueClockStartedAt`: cancelar repone los 7 días ÍNTEGROS', async () => {
    // Creada hace mucho, pero el reloj se repuso ayer por una cancelación NUESTRA.
    const { svc, state } = build({
      cotizada: [
        base({
          status: 'cotizada',
          offerState: 'cancelled',
          createdAt: new Date('2026-08-01T00:00:00Z'),
          offerIssueClockStartedAt: new Date('2026-09-07T00:00:00Z'),
        }),
      ],
    });
    const res = await svc.run(NOW);
    // El vendedor NO paga por una corrección nuestra.
    expect(res.notPursued).toBe(0);
    expect(state.get('sr-1')?.status).toBe('cotizada');
  });

  it('fail-closed de calendario: fuera de la tabla de festivos NO caduca (loggea y sigue)', async () => {
    // *Fallar hacia «no vence» es el único lado seguro*: degradar adelantaría vencimientos y
    // expiraría ofertas de gente que sí cumplió.
    const { svc, state } = build({
      cotizada: [base({ status: 'cotizada', offerState: null, createdAt: new Date('2019-01-01T00:00:00Z') })],
    });
    const res = await svc.run(NOW);
    expect(res.notPursued).toBe(0);
    expect(state.get('sr-1')?.status).toBe('cotizada');
  });
});

// =============================================================================================
describe('Reglas 5 y 6 — las legacy (6 RE-ANCLADA en `receivedAt`)', () => {
  it('regla 5 — ajuste sin responder a 7 días ⇒ `rechazada`, sin correo', async () => {
    const { svc, state, mail } = build({
      verificacion: [
        base({
          status: 'verificacion',
          offerState: null,
          adjustmentSentAt: new Date('2026-08-25T00:00:00Z'),
        }),
      ],
    });
    const res = await svc.run(NOW);
    expect(res.rejected).toBe(1);
    expect(state.get('sr-1')?.status).toBe('rechazada');
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('⚠️ regla 6 — el abandono cuelga de `receivedAt`, NO de `createdAt`', async () => {
    // Una `cotizada` viejísima ya NO se abandona (ese hueco lo cierra la regla 7, con carta).
    const antigua = build({
      cotizada: [base({ status: 'cotizada', offerState: null, createdAt: new Date('2026-01-01T00:00:00Z'), receivedAt: null })],
    });
    const r1 = await antigua.svc.run(NOW);
    expect(r1.abandoned).toBe(0);

    // Una `recibida` hace 30+ días SÍ.
    const recibida = build({
      recibida: [base({ status: 'recibida', offerState: null, receivedAt: new Date('2026-07-01T00:00:00Z') })],
    });
    const r2 = await recibida.svc.run(NOW);
    expect(r2.abandoned).toBe(1);
    expect(recibida.state.get('sr-1')?.status).toBe('abandonada');
  });
});

// =============================================================================================
describe('El job es UNO: mismo barrido, mismo cron', () => {
  it('`run()` devuelve las SIETE cifras y no lanza con la base vacía', async () => {
    const { svc, mail } = build({});
    const res = await svc.run(NOW);
    expect(res).toEqual({
      rejected: 0,
      abandoned: 0,
      offersExpired: 0,
      shipmentsExpired: 0,
      remindersSent: 0,
      notPursued: 0,
    });
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('sin `MAIL_PORT` las transiciones IGUAL ocurren (el correo es best-effort)', async () => {
    const prisma: any = {
      sellRequest: {
        findMany: jest.fn(async ({ where }: any) =>
          (typeof where?.status === 'string' ? where.status : where?.status?.in?.[0]) === 'ofertada'
            ? [base({ offerAcceptDeadlineAt: new Date('2026-09-07T00:00:00Z') })]
            : [],
        ),
        findUnique: jest.fn(async () => ({ shipmentTrackingNumber: null, guideCancellationDoneAt: null })),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
    };
    const svc = new BuylistSweepJobService(prisma as PrismaService);
    const res = await svc.run(NOW);
    expect(res.offersExpired).toBe(1);
  });
});
