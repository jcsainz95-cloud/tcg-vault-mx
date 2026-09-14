import { DisputesService } from '../src/modules/disputes/disputes.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { StripeService } from '../src/modules/payments/stripe.service';
import { MailMessage, MailPort } from '../src/modules/mail/mail.port';

/**
 * # §R — `AV-10` (disputa con RECOMPRA) y `AV-11` (RECHAZADA)
 *
 * **Una sola vez sin estrenar columna:** `updateMany` sobre `DISPUTE_RESOLVABLE_STATES` +
 * `count === 1`. ⛔ **No es idempotente a propósito**: resolver dos veces es registrar dos veces un
 * money-out, así que la segunda llamada es `409` — y por tanto **no puede haber un segundo correo**.
 *
 * Y la mitad de `C-AV-10` que toca aquí: con el puerto lanzando, **`resolve` resuelve**.
 */

const USER = { email: 'ash@pallet.mx', locale: 'es', anonymizedAt: null };

function buildHarness(opts: {
  dispute: Record<string, unknown>;
  user?: Record<string, unknown> | null;
  mail?: 'ok' | 'throwing';
}) {
  const sent: MailMessage[] = [];
  const row: Record<string, unknown> = { ...opts.dispute };
  const prisma: any = {
    dispute: {
      findUnique: jest.fn().mockImplementation(async ({ select }: any) => {
        if (select?.user) return { user: opts.user === undefined ? USER : opts.user };
        return { ...row };
      }),
      updateMany: jest.fn().mockImplementation(async ({ where, data }: any) => {
        const permitidos: string[] = where.status?.in ?? [];
        if (!permitidos.includes(row.status as string)) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }),
    },
    orderItem: { findFirst: jest.fn().mockResolvedValue({ unitPriceCents: 42000 }) },
  };
  const mail: MailPort = {
    send: jest.fn().mockImplementation(async (m: MailMessage) => {
      if (opts.mail === 'throwing') throw new Error('resend is down');
      sent.push(m);
      return {};
    }),
  };
  const svc = new DisputesService(prisma as PrismaService, {} as StripeService, mail);
  return { svc, sent, row };
}

const ABIERTA = {
  id: 'dsp-1',
  userId: 'u1',
  inventoryItemId: 'it-1',
  orderItemId: 'oi-1',
  type: 'condition',
  status: 'abierta',
  description: 'llegó doblada',
  resolution: null,
  repurchaseOrderId: null,
  deadlineAt: new Date('2026-09-20T00:00:00Z'),
  createdAt: new Date('2026-09-10T00:00:00Z'),
  resolvedAt: null,
  resolvedBy: null,
};

describe('AV-10 / AV-11 — resolver avisa UNA vez, y solo al resolver', () => {
  it('`repurchase` ⇒ un correo al dueño de la disputa', async () => {
    const { svc, sent } = buildHarness({ dispute: { ...ABIERTA }, mail: 'ok' });
    await svc.resolve('dsp-1', 'repurchase', 'Aceptamos la aclaración', 'sa-1');
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('ash@pallet.mx');
    expect(sent[0].text).toMatch(/recompramos/i);
  });

  it('`reject` ⇒ un correo, con el canal para responder (es la razón por la que el dueño lo pidió)', async () => {
    const { svc, sent } = buildHarness({ dispute: { ...ABIERTA }, mail: 'ok' });
    await svc.resolve('dsp-1', 'reject', 'La carta llegó como se describió', 'sa-1');
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toMatch(/@/); // el buzón de soporte viaja: un «no» sin a dónde contestar es un callejón
  });

  it('⭐ el correo repite `resolution` TAL CUAL lo devuelve `GET /disputes/:id` (criterio 207)', async () => {
    const { svc, sent, row } = buildHarness({ dispute: { ...ABIERTA }, mail: 'ok' });
    await svc.resolve('dsp-1', 'repurchase', 'Aceptamos la aclaración', 'sa-1');
    // El servicio compone el texto con el precio PERSISTIDO del `OrderItem`; el correo no lo
    // recompone ni lo recalcula: repite el mismo string que el cliente ve en su pantalla.
    expect(sent[0].text).toContain(row.resolution as string);
  });

  it('⛔ resolver DOS veces ⇒ `409` y **un solo** correo (no es idempotente a propósito)', async () => {
    const { svc, sent } = buildHarness({ dispute: { ...ABIERTA }, mail: 'ok' });
    await svc.resolve('dsp-1', 'repurchase', 'Aceptamos la aclaración', 'sa-1');
    await expect(svc.resolve('dsp-1', 'reject', 'Nos arrepentimos', 'sa-1')).rejects.toMatchObject({
      status: 409,
    });
    expect(sent).toHaveLength(1);
  });

  it('⛔ `abierta` y `en_revision` NO avisan: solo avisa el acto de RESOLVER', async () => {
    // `PROJECT §R.3`: la abrió él (`abierta`) y no le pide ninguna acción (`en_revision`). No hay
    // ningún camino en este servicio que mande correo fuera de `resolve` — se comprueba por ausencia.
    const { svc, sent } = buildHarness({ dispute: { ...ABIERTA }, mail: 'ok' });
    await svc.listMine('u1').catch(() => undefined);
    expect(sent).toHaveLength(0);
  });

  it('⛔ cuenta ANONIMIZADA ⇒ cero correos (§R.5.a)', async () => {
    const { svc, sent } = buildHarness({
      dispute: { ...ABIERTA },
      user: { ...USER, anonymizedAt: new Date() },
      mail: 'ok',
    });
    await svc.resolve('dsp-1', 'reject', 'No procede', 'sa-1');
    expect(sent).toHaveLength(0);
  });

  it('⭐ C-AV-10 — con el puerto LANZANDO, `resolve` resuelve igual', async () => {
    const { svc, row } = buildHarness({ dispute: { ...ABIERTA }, mail: 'throwing' });
    await expect(svc.resolve('dsp-1', 'repurchase', 'Aceptamos', 'sa-1')).resolves.toBeDefined();
    expect(row.status).toBe('resuelta_recompra');
    expect(row.resolvedAt).toBeInstanceOf(Date);
  });

  it('CANARIO: la guarda de motor muerde — sobre una disputa YA resuelta, `count === 0`', async () => {
    const { svc, sent } = buildHarness({
      dispute: { ...ABIERTA, status: 'resuelta_recompra', resolvedAt: new Date() },
      mail: 'ok',
    });
    await expect(svc.resolve('dsp-1', 'reject', 'Otra vez', 'sa-1')).rejects.toMatchObject({ status: 409 });
    expect(sent).toHaveLength(0); // sin transición no hay aviso: el correo cuelga del HECHO
  });
});
