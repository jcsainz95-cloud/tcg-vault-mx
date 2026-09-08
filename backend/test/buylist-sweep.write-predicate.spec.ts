import { BuylistSweepJobService } from '../src/jobs/buylist-sweep.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { MailPort } from '../src/modules/mail/mail.port';

/**
 * v1.51.22 · **B-1 — LA ESCRITURA DEL BARRIDO LLEVA EL PREDICADO DE SU LECTURA.**
 *
 * ### El hallazgo, dicho sin rodeos
 * `closeWithGuideTask` escribía con `updateMany({ where: { id, closedAt: null }, … })` **y nada
 * más**: ni `status`, ni `sellerShippedDeclaredAt`, ni `shipmentConfirmedAt`. El docblock de la
 * regla 2 **afirmaba** que `sellerShippedDeclaredAt IS NULL` «está en el where» — y lo estaba, pero
 * en el del `findMany`, no en el de la escritura. Las reglas 5 y 6 igual.
 *
 * **La asimetría era el síntoma:** la regla 7, en el mismo fichero y en el mismo pase, **sí**
 * reafirmaba `status: 'cotizada'` en su propio `where`.
 *
 * ### El caso alcanzable que esto cierra (regla 2, y es el que cuesta dinero)
 * El job lee a las 08:00:00. El vendedor pulsa «ya lo mandé» a las 08:00:00.5 — `declareShipped`
 * **no toca `status` ni `closedAt`** (escribe solo `sellerShippedDeclaredAt`) y **no tiene guarda de
 * plazo a propósito**. El job escribe a las 08:00:01 y su `where` de dos términos **sigue
 * casando**. Resultado: `expirada`/`not_shipped`, **terminal**, `closedAt` sellado, correo de «no
 * procederemos» y tarea de cancelar la guía — **sobre un paquete que va físicamente en el correo**.
 * Y `expirada` **no está en `payableWhere()`**: a esa persona ya no se le puede pagar ni revivir la
 * solicitud.
 *
 * ### Los dos ejes que se prueban, y por qué hacen falta LOS DOS
 * 1. **PARIDAD ESTRUCTURAL** — cada término del `where` de la lectura aparece, idéntico, en el
 *    `where` de la escritura. Es lo que ataja al siguiente que añada un candado al `findMany` y se
 *    olvide de la otra mitad: el test cae sin que nadie tenga que imaginar la carrera.
 * 2. **COMPORTAMIENTO EN LA CARRERA** — la fila se mueve ENTRE la lectura y la escritura y el
 *    barrido **no escribe, no manda correo y no cuenta**. Es el patrón `count === 1` que el sello del
 *    recordatorio ya usaba, aplicado donde no había llegado.
 */

const NOW = new Date('2026-09-08T14:00:00Z'); // martes

type Row = Record<string, unknown>;

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

/**
 * `afterRead` es el corazón del harness: se dispara **entre** el `findMany` y el `updateMany` y
 * muta la fila, que es exactamente donde vive la ventana. Sin él, un fake que devuelve y escribe
 * sobre el mismo snapshot **no puede** distinguir la versión débil de la fuerte.
 */
function build(rows: Row[], opts: { afterRead?: (state: Map<string, Row>) => void } = {}) {
  const state = new Map<string, Row>();
  for (const r of rows) state.set(r.id as string, { ...r });
  const reads: { where: Record<string, unknown> }[] = [];
  const writes: { where: Record<string, unknown>; data: Record<string, unknown> }[] = [];
  let fired = false;

  const prisma: any = {
    sellRequest: {
      findMany: jest.fn(async ({ where }: any) => {
        reads.push({ where });
        const out = [...state.values()]
          .filter((r) => Object.entries(where).every(([k, cond]) => matches(r[k], cond)))
          .map((r) => ({ items: [{ offerDecision: 'buy' }], ...r }));
        // La carrera se dispara UNA vez, y después de que la lectura ya devolvió su snapshot.
        if (out.length > 0 && !fired && opts.afterRead) {
          fired = true;
          opts.afterRead(state);
        }
        return out;
      }),
      findUnique: jest.fn(async ({ where }: any) => state.get(where.id as string) ?? null),
      updateMany: jest.fn(async ({ where, data }: any) => {
        writes.push({ where, data });
        const row = state.get(where.id as string);
        if (!row) return { count: 0 };
        const { id: _id, ...rest } = where;
        if (!Object.entries(rest).every(([k, c]) => matches(row[k], c))) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }),
      update: jest.fn(async () => {
        throw new Error('el barrido NO transiciona con `update`: la guarda es el updateMany');
      }),
    },
  };
  const settings = {
    getNumber: jest.fn(async () => 7),
    getString: jest.fn(async () => 'on'), // B-4: la regla 7 encendida a propósito.
  } as unknown as SettingsService;
  const mail: MailPort = { send: jest.fn(async (m: any) => ({ id: 'm', ...m })) };
  const svc = new BuylistSweepJobService(prisma as PrismaService, settings, mail);
  return { svc, state, reads, writes, mail };
}

const base = (over: Row = {}): Row => ({
  id: 'sr-1',
  userId: 'u-1',
  user: { name: 'Ash', email: 'ash@e.mx', locale: 'es' },
  status: 'ofertada',
  closedAt: null,
  createdAt: new Date('2026-09-01T00:00:00Z'),
  offerState: 'sent',
  offerAcceptDeadlineAt: null,
  offerAcceptReminderSentAt: new Date('2026-09-01T00:00:00Z'), // ya recordado: aparta las reglas 3/4
  offerNetCents: 72000,
  shipDeadlineAt: null,
  shipReminderSentAt: new Date('2026-09-01T00:00:00Z'),
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

/** Escenarios base de cada regla que CIERRA una solicitud (las cuatro que escriben terminal). */
const VENCIDA_R1 = base({
  status: 'ofertada',
  offerAcceptDeadlineAt: new Date('2026-09-05T00:00:00Z'),
});
const VENCIDA_R2 = base({
  status: 'aceptada',
  shipDeadlineAt: new Date('2026-09-05T00:00:00Z'),
});
const VENCIDA_R5 = base({
  status: 'verificacion',
  adjustmentSentAt: new Date('2026-08-01T00:00:00Z'),
});
const VENCIDA_R6 = base({
  status: 'recibida',
  receivedAt: new Date('2026-07-01T00:00:00Z'),
});

// =============================================================================================
describe('B-1 (1) — PARIDAD: cada término de la LECTURA está en la ESCRITURA', () => {
  it.each([
    ['regla 1 · `ofertada` sin responder', VENCIDA_R1],
    ['regla 2 · `aceptada` sin enviar', VENCIDA_R2],
    ['regla 5 · ajuste sin responder', VENCIDA_R5],
    ['regla 6 · abandono a 30 días', VENCIDA_R6],
  ])('%s', async (_titulo, fila) => {
    const { svc, reads, writes } = build([fila]);
    await svc.run(NOW);

    const write = writes.find((w) => w.where.id === 'sr-1');
    expect(write).toBeDefined();
    // La lectura que produjo ESTA escritura es la que devolvió la fila. Se localiza por el `status`,
    // que es lo que discrimina las seis consultas del pase.
    const read = reads.find((r) => matches(fila.status, r.where.status));
    expect(read).toBeDefined();

    // ⚠️ EL NÚCLEO: NINGÚN término de la lectura puede faltar en la escritura. Antes de B-1 esto
    // fallaba con `where: { id, closedAt: null }` en las cuatro.
    for (const [k, cond] of Object.entries(read!.where)) {
      expect(write!.where).toHaveProperty(k);
      expect((write!.where as Record<string, unknown>)[k]).toEqual(cond);
    }
    // Y `closedAt: null` sigue estando: la guarda vieja no se sustituyó, se AMPLIÓ.
    expect(write!.where).toMatchObject({ closedAt: null, id: 'sr-1' });
  });

  it('⚠️ la regla 2 lleva LAS DOS señales del §P.13 en la ESCRITURA, POR NOMBRE', async () => {
    // Se asevera por nombre ADEMÁS de por paridad: la paridad seguiría verde si un refactor quitara
    // los dos candados de las DOS mitades a la vez. Aquí se exige que EXISTAN, no solo que coincidan.
    const { svc, writes } = build([VENCIDA_R2]);
    await svc.run(NOW);
    const write = writes.find((w) => w.where.id === 'sr-1');
    expect(write!.where).toMatchObject({
      status: 'aceptada',
      closedAt: null,
      sellerShippedDeclaredAt: null,
      shipmentConfirmedAt: null,
    });
  });
});

// =============================================================================================
describe('B-1 (2) — LA CARRERA: la fila se movió entre la lectura y la escritura', () => {
  it('⚠️⚠️ REGLA 2 — el vendedor declara «ya lo mandé» en la ventana ⇒ NO se expira, NO sale correo', async () => {
    // `declareShipped` escribe SOLO `sellerShippedDeclaredAt`: ni `status` ni `closedAt`. Con el
    // `where` viejo (`{ id, closedAt: null }`) la escritura casaba igual y el paquete que iba en el
    // correo se quedaba sin venta y sin poder cobrarse (`expirada` ∉ `payableWhere()`).
    const { svc, state, mail } = build([VENCIDA_R2], {
      afterRead: (s) => {
        const row = s.get('sr-1')!;
        row.sellerShippedDeclaredAt = new Date('2026-09-08T14:00:00.500Z');
      },
    });
    const res = await svc.run(NOW);

    expect(res.shipmentsExpired).toBe(0);
    expect(state.get('sr-1')?.status).toBe('aceptada');
    expect(state.get('sr-1')?.closedAt).toBeNull();
    expect(state.get('sr-1')?.expiredReason).toBeNull();
    // Ni el correo de «no procederemos» ni la tarea de cancelar una guía viva.
    expect(mail.send).not.toHaveBeenCalled();
    expect(state.get('sr-1')?.guideCancellationPendingAt).toBeNull();
  });

  it('REGLA 2 — el OPERADOR confirma la recepción en la ventana ⇒ tampoco se expira', async () => {
    // La otra mitad del candado de §P.13: *un plazo del vendedor solo puede vencer por algo que
    // dependa del vendedor*.
    const { svc, state, mail } = build([VENCIDA_R2], {
      afterRead: (s) => {
        s.get('sr-1')!.shipmentConfirmedAt = NOW;
      },
    });
    const res = await svc.run(NOW);
    expect(res.shipmentsExpired).toBe(0);
    expect(state.get('sr-1')?.status).toBe('aceptada');
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('REGLA 1 — el vendedor ACEPTA la oferta en la ventana ⇒ no se rechaza', async () => {
    // `accept` mueve `status` a `aceptada` y NO toca `closedAt`.
    const { svc, state, mail } = build([VENCIDA_R1], {
      afterRead: (s) => {
        s.get('sr-1')!.status = 'aceptada';
      },
    });
    const res = await svc.run(NOW);
    expect(res.offersExpired).toBe(0);
    expect(state.get('sr-1')?.status).toBe('aceptada');
    expect(state.get('sr-1')?.closedAt).toBeNull();
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('REGLA 5 — el ajuste se responde en la ventana ⇒ no se rechaza', async () => {
    // ⚠️ Nótese que `aprobada` SIGUE estando en `SELL_REQUEST_LIVE_ADJUSTMENT_STATES`: el término que
    // salva esta fila NO es el `status`, es el **ancla** (`adjustmentSentAt`), que responder limpia.
    // Un `where` de escritura que llevara solo `status` tampoco bastaría; hace falta el predicado
    // ENTERO, que es justo lo que B-1 pide.
    const { svc, state } = build([VENCIDA_R5], {
      afterRead: (s) => {
        const row = s.get('sr-1')!;
        row.status = 'aprobada';
        row.adjustmentSentAt = null;
      },
    });
    const res = await svc.run(NOW);
    expect(res.rejected).toBe(0);
    expect(state.get('sr-1')?.status).toBe('aprobada');
    expect(state.get('sr-1')?.closedAt).toBeNull();
  });

  it('⚠️ REGLA 6 — la solicitud avanza a `en_transito` en la ventana ⇒ no se abandona', async () => {
    // `pagada` sella `closedAt`, así que ESE caso la guarda vieja sí lo frenaba. Lo que no frenaba es
    // cualquier transición que **deje `closedAt` intacto**, y `en_transito` es una: sale del `in` de
    // la regla 6 sin tocar el único término que la escritura miraba.
    const { svc, state } = build([VENCIDA_R6], {
      afterRead: (s) => {
        s.get('sr-1')!.status = 'en_transito';
      },
    });
    const res = await svc.run(NOW);
    expect(res.abandoned).toBe(0);
    expect(state.get('sr-1')?.status).toBe('en_transito');
    expect(state.get('sr-1')?.closedAt).toBeNull();
  });

  it('SIN carrera, las cuatro reglas SÍ cierran: el candado no es un freno permanente', async () => {
    // El contrapositivo, que es lo que impide «arreglar» B-1 devolviendo `count: 0` siempre.
    for (const [fila, campo] of [
      [VENCIDA_R1, 'offersExpired'],
      [VENCIDA_R2, 'shipmentsExpired'],
      [VENCIDA_R5, 'rejected'],
      [VENCIDA_R6, 'abandoned'],
    ] as const) {
      const { svc, state } = build([fila]);
      const res = await svc.run(NOW);
      expect(res[campo]).toBe(1);
      expect(state.get('sr-1')?.closedAt).toEqual(NOW);
    }
  });
});
