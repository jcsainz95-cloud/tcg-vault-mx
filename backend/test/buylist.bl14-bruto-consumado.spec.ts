import { ConfigService } from '@nestjs/config';
import { BuylistService } from '../src/modules/buylist/buylist.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { UsersService } from '../src/modules/users/users.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { brutoConsumado, monthCommittedGrossCents } from '../src/common/buylist-aml';

/**
 * v1.51.5 — **DOS AGUJEROS DE DINERO QUE VAN JUNTOS**, porque el segundo corrompe el campo del que
 * depende el primero.
 *
 * **(a) BL-14** (§9, contrato v1.51.5 §B) — `itemDecision` **no leía `sellRequest.status`**: su
 * `findUnique` seleccionaba solo `userId` y `user`, así que el estado **ni siquiera estaba
 * disponible** para comprobarlo. Un ítem de una solicitud **`pagada`** se re-decidía y
 * `recomputeApprovedTotal` **reescribía `approvedTotalCents` DESPUÉS del SPEI**.
 *
 * **(b) `brutoConsumado`** (ARCHITECTURE §4.39i.4-bis) —
 * `approvedTotalCents ?? offerGrossCents ?? quotedTotalCents ?? 0`, en **tres** sitios. El término
 * central faltaba: con **override al alza (D26)** el cotizado es **menor** que el ofertado, así que
 * el acumulado AML se quedaba **corto** y el vendedor **rebasaba el tope mensual sin que nada lo
 * notara**.
 *
 * La norma (b) **ancla en `approvedTotalCents` porque en un terminal es final** — y sin (a) no lo
 * era. Por eso los dos van en el mismo pase, y por eso están en el mismo archivo de tests.
 */

const pii = new PiiCryptoService(new ConfigService({}));

/** Predicado Prisma de mentira: escalar, `null`, `{not}`, `{in}`, `{notIn}`, `{gte}`. */
function matches(value: unknown, cond: unknown): boolean {
  if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
    const c = cond as Record<string, unknown>;
    if ('in' in c) return (c.in as unknown[]).includes(value);
    if ('notIn' in c) return !(c.notIn as unknown[]).includes(value);
    if ('not' in c) return !matches(value, c.not);
    if ('gte' in c) return (value as Date) >= (c.gte as Date);
    throw new Error(`condición no soportada por el fake: ${JSON.stringify(cond)}`);
  }
  return value === cond;
}

// =============================================================================================
// (a) BL-14 — un ítem de una solicitud PAGADA no se re-decide, y el bruto aprobado NO se mueve
// =============================================================================================

/**
 * Prisma de mentira con la semántica **CONDICIONAL** de `updateMany`. Es deliberado: un mock que
 * devolviera `{count:1}` a ciegas dejaría pasar estos tests **aunque la guarda no existiera**. Aquí
 * el `where` se evalúa contra el estado real —incluida la **relación** `sellRequest`—, que es
 * exactamente donde la norma exige que viva la guarda.
 */
function fakeDb(opts: { requestStatus: string; staleStatusForRead?: string; approvedTotalCents: number }) {
  const request: Record<string, unknown> = {
    id: 'sr-1',
    userId: 'u1',
    status: opts.requestStatus,
    approvedTotalCents: opts.approvedTotalCents,
    quotedTotalCents: 50_000,
    offerGrossCents: null,
    adjustmentSentAt: null,
    closedAt: null,
  };
  const item: Record<string, unknown> = {
    id: 'sri-1',
    sellRequestId: 'sr-1',
    itemStatus: 'aprobada',
    quotedPriceCents: 50_000,
    approvedPriceCents: 40_000,
    finish: 'normal',
    rejectedAt: null,
    rejectionReason: null,
  };
  const writes: string[] = [];

  const prisma: any = {
    kycProfile: { findUnique: jest.fn().mockResolvedValue(null) },
    sellRequestItem: {
      findUnique: jest.fn(async (args: any) =>
        args?.include
          ? {
              ...item,
              // `staleStatusForRead` simula la LECTURA VIEJA de una carrera: el pre-check ve un
              // estado vivo, y el motor ve el real.
              sellRequest: {
                userId: 'u1',
                status: opts.staleStatusForRead ?? request.status,
                user: { email: 's@e.mx', name: 'Ash', locale: 'es' },
              },
              card: { name: 'Pidgey', number: '16', set: { name: 'Base Set' } },
            }
          : { ...item },
      ),
      updateMany: jest.fn(async ({ where, data }: any) => {
        // El `where` lleva `{ id, sellRequest: { status: { notIn: [...] } } }`: se evalúa el escalar
        // Y la relación, igual que haría el motor.
        const idOk = matches(item.id, where.id);
        const relOk =
          where.sellRequest == null ||
          Object.entries(where.sellRequest).every(([k, cond]) => matches(request[k], cond));
        if (!idOk || !relOk) return { count: 0 };
        writes.push('item.updateMany');
        Object.assign(item, data);
        return { count: 1 };
      }),
      update: jest.fn(async () => {
        throw new Error('itemDecision NO debe escribir con `update`: la guarda es el updateMany');
      }),
      aggregate: jest.fn(async () => {
        writes.push('aggregate');
        return { _sum: { approvedPriceCents: 999_999 }, _count: { approvedPriceCents: 1 } };
      }),
      count: jest.fn(async () => 1),
    },
    sellRequest: {
      findUnique: jest.fn(async () => ({ ...request })),
      update: jest.fn(async ({ data }: any) => {
        writes.push('sellRequest.update');
        Object.assign(request, data);
        return { ...request };
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const hit = Object.entries(where).every(([k, cond]) => matches(request[k], cond));
        if (!hit) return { count: 0 };
        writes.push('sellRequest.updateMany');
        Object.assign(request, data);
        return { count: 1 };
      }),
    },
    $transaction: jest.fn(async (cb: any) => cb(prisma)),
  };
  const svc = new BuylistService(
    prisma as PrismaService,
    {} as PricingService,
    { getNumber: jest.fn(async () => 100_000_000) } as unknown as SettingsService,
    {} as UsersService,
    pii,
  );
  return { svc, prisma, request, item, writes };
}

describe('⚠️ (a) BL-14 — `itemDecision` sobre una solicitud TERMINAL', () => {
  it.each([['pagada'], ['rechazada'], ['abandonada'], ['expirada']])(
    'sobre `%s` ⇒ 409 NO_LIVE_ADJUSTMENT y el bruto aprobado NO se mueve',
    async (estado) => {
      const { svc, request, writes } = fakeDb({ requestStatus: estado, approvedTotalCents: 40_000 });

      // ⚠️ EL MONTO, ANTES. Un test que solo mirara el código de error pasaría igual si la escritura
      // ocurriera antes del throw — que es exactamente el bug.
      expect(request.approvedTotalCents).toBe(40_000);

      await expect(
        svc.itemDecision('sri-1', 'approve', 45_000),
      ).rejects.toMatchObject({ code: 'NO_LIVE_ADJUSTMENT', details: { status: estado } });

      // ⚠️ EL MONTO, DESPUÉS. Idéntico: el SPEI ya salió contra esta cifra.
      expect(request.approvedTotalCents).toBe(40_000);
      // Y no se escribió NADA: ni el ítem, ni el recompute, ni la solicitud.
      expect(writes).toEqual([]);
    },
  );

  it('la guarda NO es un `if` sobre la lectura: con una lectura VIEJA, el MOTOR la para (TOCTOU)', async () => {
    // El pre-check ve `verificacion` (la lectura ganó la carrera con el pago); el estado REAL es
    // `pagada`. Si la guarda viviera solo en el `if`, aquí se reescribiría el monto.
    const { svc, request, writes } = fakeDb({
      requestStatus: 'pagada',
      staleStatusForRead: 'verificacion',
      approvedTotalCents: 40_000,
    });
    expect(request.approvedTotalCents).toBe(40_000);

    await expect(svc.itemDecision('sri-1', 'approve', 45_000)).rejects.toMatchObject({
      code: 'NO_LIVE_ADJUSTMENT',
      // `details.status` se RELEE: dice el estado real contra el que se chocó, no el que teníamos.
      details: { status: 'pagada' },
    });

    expect(request.approvedTotalCents).toBe(40_000);
    expect(writes).toEqual([]);
  });

  it('`reject` sobre una terminal tampoco pasa — ni siquiera por la puerta de la idempotencia', async () => {
    // El pre-check va ANTES del `return` idempotente del ítem ya `rechazada`: sobre una solicitud
    // cerrada, un `200` silencioso diría que la operación está disponible. No lo está.
    const { svc, item, request, writes } = fakeDb({
      requestStatus: 'pagada',
      approvedTotalCents: 40_000,
    });
    item.itemStatus = 'rechazada';
    await expect(
      svc.itemDecision('sri-1', 'reject', undefined, 'no es NM: whitening en el reverso'),
    ).rejects.toMatchObject({ code: 'NO_LIVE_ADJUSTMENT', details: { status: 'pagada' } });
    expect(request.approvedTotalCents).toBe(40_000);
    expect(writes).toEqual([]);
  });

  it('`adjust` sobre una terminal NO deja puesto el plazo de 7 días', async () => {
    // Antes, `adjustmentSentAt` se escribía PRIMERO y SUELTO: sobre una solicitud cerrada quedaba
    // puesto aunque la decisión no prosperara, y el barrido lo vería como un ajuste vivo.
    const { svc, request } = fakeDb({ requestStatus: 'pagada', approvedTotalCents: 40_000 });
    await expect(svc.itemDecision('sri-1', 'adjust', 45_000)).rejects.toMatchObject({
      code: 'NO_LIVE_ADJUSTMENT',
    });
    expect(request.adjustmentSentAt).toBeNull();
  });

  it('el flujo LEGÍTIMO no se rompe: sobre una solicitud viva, la decisión pasa y recalcula', async () => {
    const { svc, request, item, writes } = fakeDb({
      requestStatus: 'verificacion',
      approvedTotalCents: 40_000,
    });
    const res: any = await svc.itemDecision('sri-1', 'approve', 45_000);
    expect(res).toMatchObject({ itemStatus: 'aprobada', approvedPriceCents: 45_000 });
    expect(item.approvedPriceCents).toBe(45_000);
    // El recompute SÍ corrió y persistió el derivado (aquí, el `_sum` del fixture).
    expect(writes).toContain('aggregate');
    expect(request.approvedTotalCents).toBe(999_999);
  });
});

// =============================================================================================
// (b) `brutoConsumado` — §4.39i.4-bis
// =============================================================================================

describe('(b) `brutoConsumado` — la cascada de TRES términos', () => {
  it('el aprobado manda cuando existe', () => {
    expect(
      brutoConsumado({ approvedTotalCents: 40_000, offerGrossCents: 90_000, quotedTotalCents: 50_000 }),
    ).toBe(40_000);
  });

  it('⚠️ sin aprobado manda el OFERTADO — el término que faltaba', () => {
    expect(
      brutoConsumado({ approvedTotalCents: null, offerGrossCents: 90_000, quotedTotalCents: 50_000 }),
    ).toBe(90_000);
  });

  it('fila pre-M-46 (`offerGrossCents IS NULL`) ⇒ el cotizado: CERO REGRESIÓN', () => {
    expect(
      brutoConsumado({ approvedTotalCents: null, offerGrossCents: null, quotedTotalCents: 50_000 }),
    ).toBe(50_000);
  });

  it('sin ninguna de las tres ⇒ 0 (no `undefined`, no `NaN`)', () => {
    expect(
      brutoConsumado({ approvedTotalCents: null, offerGrossCents: null, quotedTotalCents: null }),
    ).toBe(0);
  });

  it('⚠️ un aprobado de CERO NO cae al ofertado: `0` es una decisión, no una ausencia', () => {
    // Rechazo total tras la verificación (D17): el bruto aprobado ES 0 y se paga 0, no lo ofertado.
    expect(
      brutoConsumado({ approvedTotalCents: 0, offerGrossCents: 90_000, quotedTotalCents: 50_000 }),
    ).toBe(0);
  });
});

/** `paySpei` de mentira: una solicitud en curso + N solicitudes pagadas del mes. */
function fakePayDb(opts: {
  req: Record<string, unknown>;
  paidThisMonth?: Record<string, unknown>[];
  capPerMonth?: number;
}) {
  const request: Record<string, unknown> = {
    id: 'sr-1',
    userId: 'u1',
    status: 'aprobada',
    verifiedAt: new Date('2026-08-02T00:00:00Z'),
    approvedTotalCents: null,
    offerGrossCents: null,
    quotedTotalCents: 0,
    offerShippingFeeCents: null,
    ...opts.req,
  };
  const updates: any[] = [];
  const prisma: any = {
    kycProfile: { findUnique: jest.fn().mockResolvedValue(null) },
    sellRequest: {
      findUnique: jest.fn(async () => ({ ...request })),
      findMany: jest.fn(async () => opts.paidThisMonth ?? []),
      updateMany: jest.fn(async (args: any) => {
        updates.push(args);
        Object.assign(request, args.data);
        return { count: 1 };
      }),
    },
    sellRequestItem: { findMany: jest.fn(async () => []) },
    $transaction: jest.fn(async (cb: any, _opts?: any) => cb(prisma)),
  };
  const svc = new BuylistService(
    prisma as PrismaService,
    {} as PricingService,
    { getNumber: jest.fn(async () => opts.capPerMonth ?? 100_000_000) } as unknown as SettingsService,
    {} as UsersService,
    pii,
  );
  return { svc, prisma, request, updates };
}

describe('(b) sitios (a) y (b): el acumulado del mes y el término EN CURSO, con el MISMO cuerpo', () => {
  it('⚠️ OVERRIDE AL ALZA — el acumulado mide el OFERTADO, no el cotizado (el caso que subcontaba)', async () => {
    // Cotizado $500, ofertado $900 (override al alza, D26). Tope $1,000.
    // Con la cascada VIEJA acumularía 50,000 + 50,000 = 100,000 ⇒ NO frena y el vendedor rebasa.
    // Con `brutoConsumado`: 90,000 (pagada) + 90,000 (en curso) = 180,000 > 100,000 ⇒ FRENA.
    const { svc } = fakePayDb({
      req: { approvedTotalCents: null, offerGrossCents: 90_000, quotedTotalCents: 50_000 },
      paidThisMonth: [
        { approvedTotalCents: null, offerGrossCents: 90_000, quotedTotalCents: 50_000 },
      ],
      capPerMonth: 100_000,
    });
    await expect(svc.paySpei('sr-1', 'SPEI-1', 'admin')).rejects.toMatchObject({
      code: 'BUYLIST_LIMIT_EXCEEDED',
      details: { scope: 'per_month_payout', wouldBeCents: 180_000 },
    });
  });

  it('el acumulado LEE `offerGrossCents` (sin él en el `select`, la cascada no podría aplicarse)', async () => {
    const { svc, prisma } = fakePayDb({
      req: { approvedTotalCents: 10_000, quotedTotalCents: 10_000 },
    });
    await svc.paySpei('sr-1', 'SPEI-1', 'admin');
    const select = prisma.sellRequest.findMany.mock.calls[0][0].select;
    expect(select).toMatchObject({
      approvedTotalCents: true,
      offerGrossCents: true,
      quotedTotalCents: true,
    });
  });

  it('fila pre-M-46: mismo comportamiento que antes (cero regresión)', async () => {
    const { svc } = fakePayDb({
      req: { approvedTotalCents: null, offerGrossCents: null, quotedTotalCents: 60_000 },
      paidThisMonth: [
        { approvedTotalCents: null, offerGrossCents: null, quotedTotalCents: 50_000 },
      ],
      capPerMonth: 100_000,
    });
    await expect(svc.paySpei('sr-1', 'SPEI-1', 'admin')).rejects.toMatchObject({
      details: { wouldBeCents: 110_000 },
    });
  });
});

describe('(b) sitio (c): `payoutNetCents` queda DEFINIDO cuando el aprobado es `null`', () => {
  it('se sella en la MISMA transacción que `pagada`, con la cascada y el envío congelado', async () => {
    const { svc, updates } = fakePayDb({
      req: {
        approvedTotalCents: null,
        offerGrossCents: 90_000,
        quotedTotalCents: 50_000,
        offerShippingFeeCents: 18_000,
      },
    });
    await svc.paySpei('sr-1', 'SPEI-1', 'admin');
    const data = updates[0].data;
    expect(data.status).toBe('pagada');
    // Se le paga LO OFERTADO menos el envío: literalmente lo que se le prometió (D2).
    expect(data.payoutNetCents).toBe(72_000);
    // Sellado junto al terminal, no en una segunda escritura que una caída pueda perder.
    expect(data.paidAt).toBeInstanceOf(Date);
    expect(data.closedAt).toBeInstanceOf(Date);
  });

  it('⚠️ con el aprobado en `null` NO se paga MX$0 — ése era el caso indefinido', async () => {
    const { svc, updates } = fakePayDb({
      req: { approvedTotalCents: null, offerGrossCents: 90_000, offerShippingFeeCents: 18_000 },
    });
    await svc.paySpei('sr-1', 'SPEI-1', 'admin');
    expect(updates[0].data.payoutNetCents).not.toBe(0);
    expect(updates[0].data.payoutNetCents).toBe(72_000);
  });

  it('el NETO nunca es negativo (invariante 1 / criterio 152): rechazo total ⇒ 0, jamás una deuda', async () => {
    const { svc, updates } = fakePayDb({
      req: { approvedTotalCents: 0, offerGrossCents: 90_000, offerShippingFeeCents: 18_000 },
    });
    await svc.paySpei('sr-1', 'SPEI-1', 'admin');
    expect(updates[0].data.payoutNetCents).toBe(0);
  });

  it('fila pre-M-46 sin tarifa congelada: no se le descuenta un envío que nunca se le anunció', async () => {
    const { svc, updates } = fakePayDb({
      req: { approvedTotalCents: 40_000, offerShippingFeeCents: null },
    });
    await svc.paySpei('sr-1', 'SPEI-1', 'admin');
    expect(updates[0].data.payoutNetCents).toBe(40_000);
  });
});

describe('⚠️ (b) LO QUE ESTA NORMA NO TOCA: el acumulado de COMPROMISO VIVO sigue en DOS términos', () => {
  const reader = (rows: Record<string, unknown>[]) =>
    ({ sellRequest: { findMany: jest.fn(async () => rows) } }) as never;

  it('`monthCommittedGrossCents` mide `offerGrossCents ?? quotedTotalCents` — y NO el aprobado', async () => {
    // En una solicitud VIVA el aprobado es PARCIAL: sube desde `null` conforme se deciden líneas.
    // Si liderara aquí, el acumulado AML BAJARÍA mientras la operación avanza — el bypass exacto
    // que el invariante 4 describe. Por eso son DOS cascadas y no se unifican.
    const total = await monthCommittedGrossCents(
      reader([{ offerGrossCents: 90_000, quotedTotalCents: 50_000 }]),
      'u1',
    );
    expect(total).toBe(90_000);
  });

  it('no LEE `approvedTotalCents` siquiera: el `select` no lo pide', async () => {
    const db = reader([]);
    await monthCommittedGrossCents(db, 'u1');
    const select = (db as any).sellRequest.findMany.mock.calls[0][0].select;
    expect(select).toEqual({ offerGrossCents: true, quotedTotalCents: true });
    expect(select).not.toHaveProperty('approvedTotalCents');
  });
});
