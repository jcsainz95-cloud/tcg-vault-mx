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
function fakeDb(opts: {
  requestStatus: string;
  staleStatusForRead?: string;
  approvedTotalCents: number;
  /** v1.51.20 · BL-27: fila DEL CICLO (`offerSentAt IS NOT NULL`). Por defecto, pre-ciclo. */
  offerSentAt?: Date | null;
  /** El monto ofertado de la línea, que es lo que `approve` fija server-side dentro del ciclo. */
  offeredPriceCents?: number | null;
}) {
  const request: Record<string, unknown> = {
    id: 'sr-1',
    userId: 'u1',
    status: opts.requestStatus,
    // ⚠️ v1.58 · §M5-R (BL-39): la constancia de RECEPCIÓN. El eje que mide esta suite es la guarda de
    // TERMINAL y `brutoConsumado`; sin este dato las decisiones por-ítem rebotarían antes de llegar a
    // su sujeto. El eje de la recepción tiene su propia suite.
    receivedAt: new Date('2026-09-02T00:00:00Z'),
    approvedTotalCents: opts.approvedTotalCents,
    quotedTotalCents: 50_000,
    offerGrossCents: null,
    adjustmentSentAt: null,
    closedAt: null,
    // ⚠️ v1.51.20 · BL-27 — el SEGUNDO eje de la guarda. `null` = solicitud PRE-ciclo (la cohorte
    // legacy, donde `adjust` y `approvedPriceCents` siguen siendo legales).
    offerSentAt: opts.offerSentAt ?? null,
  };
  const item: Record<string, unknown> = {
    id: 'sri-1',
    sellRequestId: 'sr-1',
    itemStatus: 'aprobada',
    quotedPriceCents: 50_000,
    approvedPriceCents: 40_000,
    offeredPriceCents: opts.offeredPriceCents ?? null,
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
                // BL-27: el discriminador del ciclo entra al `select` de producción, así que el
                // fake tiene que emitirlo o el pre-check leería `undefined`.
                offerSentAt: request.offerSentAt,
                // ⚠️ v1.58 · §M5-R (BL-39): la constancia de RECEPCIÓN entra al mismo `select` — y por
                // la misma razón: sin emitirla, el pre-check leería `undefined` y `approve` rebotaría
                // antes de llegar al eje que esta suite mide.
                receivedAt: request.receivedAt,
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
    // ⚠️ v1.57 · §M5-P — «pagable» son TRES términos: sin `receivedAt` esta fila ya no lo es.
    receivedAt: new Date('2026-08-01T12:00:00Z'),
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
    //
    // ⚠️⚠️ v1.61 · §M5-V.2 — **LA FILA PAGADA CONSERVA `approvedTotalCents = null` Y LA EN CURSO NO,
    // y ésa es exactamente la frontera que V dibuja.** El término 2 de la cascada
    // (`offerGrossCents`) **sigue vivo para la COHORTE HISTÓRICA** —las filas que se pagaron antes de
    // V, que es lo que este `paidThisMonth` representa— y **deja de ser alcanzable en el instante del
    // pago**: V-a exige bruto aprobado para pagar. *La cascada pasa de regla viva a compatibilidad
    // histórica; no se retira.*
    const { svc } = fakePayDb({
      req: { approvedTotalCents: 90_000, offerGrossCents: 90_000, quotedTotalCents: 50_000 },
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
    // v1.61 · §M5-V (V-a): la fila EN CURSO lleva bruto aprobado también en la cohorte pre-M-46 —
    // allí `respond(accept)` aprueba en bloque y el recompute lo puebla. La fila **ya pagada** del
    // mes se queda en el término 3 (`quotedTotalCents`), que es la cohorte que V no repara.
    const { svc } = fakePayDb({
      req: { approvedTotalCents: 60_000, offerGrossCents: null, quotedTotalCents: 60_000 },
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

describe('(b) sitio (c): `payoutNetCents` se sella con el bruto CONSUMADO', () => {
  it('se sella en la MISMA transacción que `pagada`, con la cascada y el envío congelado', async () => {
    const { svc, updates } = fakePayDb({
      req: {
        // v1.61 · §M5-V: post-V el término que manda es SIEMPRE el aprobado. Se dejan los tres
        // poblados y **DISTINTOS entre sí** para que la aserción discrimine cuál se usó.
        approvedTotalCents: 90_000,
        offerGrossCents: 80_000,
        quotedTotalCents: 50_000,
        offerShippingFeeCents: 18_000,
      },
    });
    await svc.paySpei('sr-1', 'SPEI-1', 'admin');
    const data = updates[0].data;
    expect(data.status).toBe('pagada');
    // 90_000 − 18_000. Si el término que manda fuera el ofertado saldría 62_000, y si fuera el
    // cotizado, 32_000: los tres números son distintos a propósito.
    expect(data.payoutNetCents).toBe(72_000);
    // Sellado junto al terminal, no en una segunda escritura que una caída pueda perder.
    expect(data.paidAt).toBeInstanceOf(Date);
    expect(data.closedAt).toBeInstanceOf(Date);
  });

  it('⚠️⚠️ v1.61 · §M5-V (V-a) — con el aprobado en `null` NO SE PAGA NADA (antes se pagaba lo ofertado)', async () => {
    // **La premisa de este caso se INVIRTIÓ, y el cambio ES el hallazgo.** Decía: *«con el aprobado
    // en `null` no se paga MX$0, se paga lo ofertado»*. Eso era cierto y era el agujero: con
    // cherry-pick y TODAS las líneas `buy` rechazadas, la auto-transición a `rechazada` no dispara
    // —la `skip` cuenta como no-rechazada— y la solicitud pagaba **la oferta íntegra por CERO
    // cartas** (medido en vivo, `BACKEND_NOTES` §0.45.1: `payoutNetCents = 32000` sobre 0 cartas).
    // Ahora **no sale un peso**.
    //
    // ⚠️⚠️ **v1.61.1 · `B1` — CORRECCIÓN DE UN COMENTARIO FALSO.** Aquí decía: *«Quitar V-a de
    // `payableWhere()` pone esto rojo con un 200 y `payoutNetCents = 72_000`»*. **No era cierto**, y
    // la mentira importa porque era la única cobertura que el lado `where` de V-a decía tener:
    //   · este caso monta `req.approvedTotalCents = null`, así que **muere en el pre-check**
    //     `isPayableSellRequest(req)` — **antes** de abrir la transacción y de que exista un `where`;
    //   · y `fakePayDb` responde `{ count: 1 }` a cualquier `updateMany` **sin mirar el `where`**,
    //     así que ningún caso de este fichero puede ponerse rojo por un término de la guarda.
    // **Medido** (v1.61.1): quitar V-a de `payableWhere()` deja este fichero ENTERO en verde; lo que
    // sí lo pone rojo es quitar V-a del **predicado** (`isPayableSellRequest`), que es el lector que
    // este caso ejercita. *Un comentario que documenta una mutación que no mata nada es peor que no
    // tener comentario: hace que nadie vuelva a mirar.*
    // ⇒ El lado `where` (y su composición, que es donde vivía `B1`) se prueba en
    // `test/buylist.pay-spei-where-composition.spec.ts`, con un fake que **sí** evalúa el `where`.
    const { svc, updates } = fakePayDb({
      req: { approvedTotalCents: null, offerGrossCents: 90_000, offerShippingFeeCents: 18_000 },
    });
    await expect(svc.paySpei('sr-1', 'SPEI-1', 'admin')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(updates).toHaveLength(0);
  });

  it('⚠️ y el aprobado de CERO SÍ se paga: es el DEPÓSITO DE CERO de D40, no una ausencia', async () => {
    // ⛔ El error obvio de implementación de V-a es escribir `> 0` en vez de `IS NOT NULL`. Este caso
    // y el de arriba son **el par que lo distingue**: `null` = «nadie decidió nada» ⇒ 422;
    // `0` = «se decidió y salió cero» ⇒ 200 y la solicitud se cierra.
    const { svc, updates } = fakePayDb({
      req: { approvedTotalCents: 0, offerGrossCents: 90_000, offerShippingFeeCents: 18_000 },
    });
    await svc.paySpei('sr-1', 'SPEI-1', 'admin');
    expect(updates[0].data.status).toBe('pagada');
    expect(updates[0].data.payoutNetCents).toBe(0);
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
