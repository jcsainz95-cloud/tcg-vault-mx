import { ConfigService } from '@nestjs/config';
import { BuylistService } from '../src/modules/buylist/buylist.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { UsersService } from '../src/modules/users/users.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { MailPort } from '../src/modules/mail/mail.port';
import {
  BUYLIST_REJECT_RETURN_WINDOW_DAYS,
  BUYLIST_REJECT_ABANDON_WINDOW_DAYS,
  rejectDeadlines,
} from '../src/modules/buylist/buylist-reject.constants';

const pii = new PiiCryptoService(new ConfigService({}));

const DAY_MS = 24 * 3600 * 1000;

/**
 * v1.18-buylist-rejects (API_CONTRACT §M5, ARCHITECTURE §4.18) — semántica COMPLETA de
 * `decision:"reject"` en `itemDecision`:
 *  - `reason` OBLIGATORIO (3–500 chars) → VALIDATION_ERROR (400) si falta/whitespace.
 *  - BL-1: reject ⇒ approvedPriceCents=null + recompute que EXCLUYE `rechazada` (invariante:
 *    un ítem rechazado JAMÁS suma en approvedTotalCents, ni tras approve→reject).
 *  - Persiste `rejectedAt` (ancla ÚNICA de plazos) y `rejectionReason`.
 *  - Idempotencia: re-reject sobre `rechazada` = no-op (sin update, sin correo).
 *  - Correo al vendedor best-effort POST-commit: se envía tras persistir; su fallo NO revienta.
 */

function buildMail(overrides?: Partial<MailPort>): MailPort {
  return { send: jest.fn().mockResolvedValue({ id: 'mail-1' }), ...overrides } as MailPort;
}

function buildSettings(): SettingsService {
  return {
    getNumber: jest.fn(async (key: string) =>
      key === 'buylist_cap_per_request_cents' ? 300_000 : 0,
    ),
  } as unknown as SettingsService;
}

function build(itemOverrides: Record<string, unknown> = {}, mail: MailPort | undefined = buildMail()) {
  const item = {
    id: 'sri-1',
    sellRequestId: 'sr-1',
    itemStatus: 'verificacion',
    quotedPriceCents: 5000,
    approvedPriceCents: null,
    finish: 'normal',
    rejectedAt: null,
    rejectionReason: null,
    sellRequest: {
      userId: 'u1',
      // v1.51.5 · BL-14: el `include` ahora trae el ESTADO de la solicitud — sin él la guarda de
      // terminal no podría comprobarse. `verificacion` = viva, el escenario de estos tests.
      status: 'verificacion',
      user: { email: 'seller@example.com', name: 'Ash', locale: 'es' },
    },
    card: { name: 'Pidgey', number: '16', set: { name: 'Base Set' } },
    ...itemOverrides,
  };
  const callOrder: string[] = [];
  // v1.51.5 · BL-14: la escritura del ítem pasa a `updateMany` + `count === 1`, con la guarda de
  // terminal EN EL `where`; el servicio ya no usa el valor de retorno de un `update`, sino que
  // RELEE. El fixture aplica el `data` sobre la fila viva para que la relectura vea lo escrito.
  const live: any = { ...item };
  const prisma: any = {
    sellRequestItem: {
      findUnique: jest.fn(async (args: any) => (args?.include ? item : { ...live })),
      updateMany: jest.fn(async ({ data }: any) => {
        callOrder.push('item.update');
        Object.assign(live, data);
        return { count: 1 };
      }),
      update: jest.fn(async ({ data }: any) => {
        callOrder.push('item.update');
        return { id: item.id, ...data };
      }),
      aggregate: jest.fn(async () => {
        callOrder.push('aggregate');
        return { _sum: { approvedPriceCents: null }, _count: { approvedPriceCents: 0 } };
      }),
      // v1.24-buylist-request-reject: la auto-transición cuenta ítems no-rechazados restantes.
      // Default 1 (≥1 ítem vivo) ⇒ NO auto-rechaza, para que estos tests item-céntricos no
      // disparen la transición de la solicitud (cubierta en buylist.request-reject.spec.ts).
      count: jest.fn(async () => 1),
    },
    sellRequest: {
      update: jest.fn(async () => {
        callOrder.push('sellRequest.update');
        return {};
      }),
      // v1.24-buylist-request-reject: guarda atómica «no pisar terminal» de la auto-transición.
      updateMany: jest.fn(async () => {
        callOrder.push('sellRequest.updateMany');
        return { count: 1 };
      }),
    },
    kycProfile: { findUnique: jest.fn().mockResolvedValue(null) },
    // v1.24 (endurecimiento §4.18f): la auto-transición corre count+updateMany en un $transaction
    // Serializable; el mock ejecuta el callback con `prisma` como `tx` (`$transaction:(fn)=>fn(tx)`).
    $transaction: jest.fn(async (cb: any, _opts?: any) => cb(prisma)),
  };
  if (mail) {
    const origSend = mail.send as jest.Mock;
    (mail as any).send = jest.fn(async (msg: any) => {
      callOrder.push('mail.send');
      return origSend(msg);
    });
  }
  const svc = new BuylistService(
    prisma as PrismaService,
    {} as PricingService,
    buildSettings(),
    {} as UsersService,
    pii,
    mail,
  );
  return { svc, prisma, mail, callOrder };
}

describe('itemDecision(reject) — reason obligatorio (400 VALIDATION_ERROR)', () => {
  it.each([undefined, '', '  ', 'ab'])('rechaza reason inválido/faltante (%j)', async (reason) => {
    const { svc, prisma, mail } = build();
    await expect(svc.itemDecision('sri-1', 'reject', undefined, reason as any)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(prisma.sellRequestItem.updateMany).not.toHaveBeenCalled();
    expect((mail as any).send).not.toHaveBeenCalled();
  });

  it('rechaza reason > 500 chars', async () => {
    const { svc, prisma } = build();
    await expect(
      svc.itemDecision('sri-1', 'reject', undefined, 'x'.repeat(501)),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(prisma.sellRequestItem.updateMany).not.toHaveBeenCalled();
  });

  it('para approve el reason se IGNORA (no se exige ni se persiste)', async () => {
    const { svc, prisma } = build();
    const res = await svc.itemDecision('sri-1', 'approve', 5000, 'motivo que sobra');
    expect(res).toMatchObject({ itemStatus: 'aprobada', approvedPriceCents: 5000 });
    const data = prisma.sellRequestItem.updateMany.mock.calls[0][0].data;
    expect(data.rejectionReason).toBeUndefined();
  });
});

describe('itemDecision(reject) — efectos persistidos (BL-1 + rejectedAt)', () => {
  it('fija itemStatus=rechazada, rejectedAt, rejectionReason y ANULA approvedPriceCents', async () => {
    // approve→reject: el ítem ya tenía monto aprobado (el caso del monto fantasma BL-1).
    const { svc, prisma } = build({ itemStatus: 'aprobada', approvedPriceCents: 5000 });
    const res: any = await svc.itemDecision('sri-1', 'reject', undefined, 'no es NM: whitening');
    // v1.51.5 · BL-14: el `where` lleva la GUARDA de terminal además del id — es la exclusión del
    // motor, no un `if` sobre la lectura previa (que una carrera invalida).
    expect(prisma.sellRequestItem.updateMany).toHaveBeenCalledWith({
      where: { id: 'sri-1', sellRequest: { status: { notIn: expect.arrayContaining(['pagada']) } } },
      data: {
        itemStatus: 'rechazada',
        approvedPriceCents: null,
        rejectedAt: expect.any(Date),
        rejectionReason: 'no es NM: whitening',
      },
    });
    expect(res.itemStatus).toBe('rechazada');
    expect(res.approvedPriceCents).toBeNull();
    expect(res.rejectedAt).toBeInstanceOf(Date);
  });

  it('BL-1 defensa en profundidad: el recompute EXCLUYE itemStatus=rechazada y re-persiste el total', async () => {
    const { svc, prisma } = build({ itemStatus: 'aprobada', approvedPriceCents: 5000 });
    await svc.itemDecision('sri-1', 'reject', undefined, 'no es NM: edge nicks');
    expect(prisma.sellRequestItem.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          sellRequestId: 'sr-1',
          approvedPriceCents: { not: null },
          itemStatus: { not: 'rechazada' },
        },
      }),
    );
    // Y el total derivado (null: ningún otro ítem aprobado) se escribe en la solicitud.
    expect(prisma.sellRequest.update).toHaveBeenCalledWith({
      where: { id: 'sr-1' },
      data: { approvedTotalCents: null },
    });
  });

  it('el recompute de approve/adjust también excluye rechazada (invariante sobrevive a otras rutas)', async () => {
    const { svc, prisma } = build();
    await svc.itemDecision('sri-1', 'approve', 5000);
    expect(prisma.sellRequestItem.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ itemStatus: { not: 'rechazada' } }),
      }),
    );
  });

  it('el reason se persiste con trim (whitespace de orillas fuera)', async () => {
    const { svc, prisma } = build();
    await svc.itemDecision('sri-1', 'reject', undefined, '  no es NM: bent corner  ');
    const data = prisma.sellRequestItem.updateMany.mock.calls[0][0].data;
    expect(data.rejectionReason).toBe('no es NM: bent corner');
  });

  it('re-decidir approve sobre un ítem antes rechazado LIMPIA rejectedAt/rejectionReason', async () => {
    const { svc, prisma } = build({
      itemStatus: 'rechazada',
      rejectedAt: new Date('2026-08-01T00:00:00Z'),
      rejectionReason: 'no es NM',
    });
    await svc.itemDecision('sri-1', 'approve', 5000);
    const data = prisma.sellRequestItem.updateMany.mock.calls[0][0].data;
    expect(data.rejectedAt).toBeNull();
    expect(data.rejectionReason).toBeNull();
  });
});

describe('itemDecision(reject) — idempotencia', () => {
  it('reject sobre un ítem YA rechazada = no-op: sin update, sin recompute, sin correo', async () => {
    const rejectedAt = new Date('2026-08-10T12:00:00Z');
    const { svc, prisma, mail } = build({
      itemStatus: 'rechazada',
      rejectedAt,
      rejectionReason: 'no es NM: original',
    });
    const res: any = await svc.itemDecision('sri-1', 'reject', undefined, 'otro motivo');
    // Devuelve el estado actual SIN re-fijar rejectedAt ni pisar el motivo original.
    expect(res.itemStatus).toBe('rechazada');
    expect(res.rejectedAt).toBe(rejectedAt);
    expect(res.rejectionReason).toBe('no es NM: original');
    expect(prisma.sellRequestItem.updateMany).not.toHaveBeenCalled();
    expect(prisma.sellRequestItem.aggregate).not.toHaveBeenCalled();
    expect((mail as any).send).not.toHaveBeenCalled();
    // No filtra las relaciones internas del include en la respuesta.
    expect(res.sellRequest).toBeUndefined();
    expect(res.card).toBeUndefined();
  });

  it('la idempotencia NO exige reason (no-op aunque falte)', async () => {
    const { svc, prisma } = build({ itemStatus: 'rechazada', rejectedAt: new Date() });
    const res: any = await svc.itemDecision('sri-1', 'reject');
    expect(res.itemStatus).toBe('rechazada');
    expect(prisma.sellRequestItem.updateMany).not.toHaveBeenCalled();
  });
});

describe('itemDecision(reject) — correo al vendedor (best-effort, post-commit)', () => {
  it('envía el correo DESPUÉS de persistir decisión y recompute, al email/idioma del dueño', async () => {
    const { svc, mail, callOrder } = build();
    await svc.itemDecision('sri-1', 'reject', undefined, 'no es NM: whitening');
    expect((mail as any).send).toHaveBeenCalledTimes(1);
    const msg = (mail as any).send.mock.calls[0][0];
    expect(msg.to).toBe('seller@example.com');
    expect(msg.subject).toContain('rechazada'); // locale es
    // Contenido mínimo: carta, motivo. PROHIBIDO: CLABE/montos de otros ítems (no hay fuente aquí).
    expect(msg.html).toContain('Pidgey');
    expect(msg.html).toContain('Base Set');
    expect(msg.text).toContain('no es NM: whitening');
    // Post-commit: update + recompute ANTES del send.
    expect(callOrder.indexOf('mail.send')).toBeGreaterThan(callOrder.indexOf('item.update'));
    expect(callOrder.indexOf('mail.send')).toBeGreaterThan(callOrder.indexOf('aggregate'));
  });

  it('usa la plantilla EN cuando User.locale=en', async () => {
    const { svc, mail } = build({
      sellRequest: {
        userId: 'u1',
        status: 'verificacion',
        user: { email: 'seller@example.com', name: 'Ash', locale: 'en' },
      },
    });
    await svc.itemDecision('sri-1', 'reject', undefined, 'not NM: whitening');
    const msg = (mail as any).send.mock.calls[0][0];
    expect(msg.subject).toBe('A card in your sell request was rejected');
  });

  it('el FALLO del envío NO revierte la decisión ni falla el request (solo se loggea)', async () => {
    const mail = buildMail({ send: jest.fn().mockRejectedValue(new Error('smtp down')) });
    const { svc, prisma } = build({}, mail);
    const res: any = await svc.itemDecision('sri-1', 'reject', undefined, 'no es NM: crease');
    expect(res.itemStatus).toBe('rechazada'); // la decisión quedó persistida
    expect(prisma.sellRequestItem.updateMany).toHaveBeenCalled();
  });

  it('sin MAIL_PORT (tests legacy / arranque parcial) la decisión igual procede', async () => {
    const { svc, prisma } = build({}, undefined);
    const res: any = await svc.itemDecision('sri-1', 'reject', undefined, 'no es NM: scratches');
    expect(res.itemStatus).toBe('rechazada');
    expect(prisma.sellRequestItem.updateMany).toHaveBeenCalled();
  });

  it('el correo NO se envía en approve/adjust', async () => {
    const { svc, mail } = build();
    await svc.itemDecision('sri-1', 'approve', 5000);
    expect((mail as any).send).not.toHaveBeenCalled();
  });
});

describe('rejectDeadlines — plazos derivados 7d/30d (misma familia que buylist-sweep)', () => {
  it('deriva returnDeadlineAt=+7d y abandonDeadlineAt=+30d desde rejectedAt', () => {
    const rejectedAt = new Date('2026-08-17T12:00:00Z');
    const { returnDeadlineAt, abandonDeadlineAt } = rejectDeadlines(rejectedAt);
    expect(BUYLIST_REJECT_RETURN_WINDOW_DAYS).toBe(7);
    expect(BUYLIST_REJECT_ABANDON_WINDOW_DAYS).toBe(30);
    expect(returnDeadlineAt!.getTime()).toBe(rejectedAt.getTime() + 7 * DAY_MS);
    expect(abandonDeadlineAt!.getTime()).toBe(rejectedAt.getTime() + 30 * DAY_MS);
  });

  it('legacy (sin rejectedAt) → ambos null', () => {
    expect(rejectDeadlines(null)).toEqual({ returnDeadlineAt: null, abandonDeadlineAt: null });
    expect(rejectDeadlines(undefined)).toEqual({ returnDeadlineAt: null, abandonDeadlineAt: null });
  });
});
