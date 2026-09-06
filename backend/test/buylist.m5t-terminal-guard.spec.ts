import { ConfigService } from '@nestjs/config';
import { SellRequestStatus } from '@prisma/client';
import { BuylistService } from '../src/modules/buylist/buylist.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { UsersService } from '../src/modules/users/users.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { BusinessException } from '../src/common/business.exception';
import { SELL_REQUEST_TERMINAL_STATES } from '../src/common/sell-request-states';

/**
 * `buylist.m5t-terminal-guard.spec.ts` — **INVARIANTE T (API_CONTRACT §M5-T) sobre `receive`/`verify`.**
 * Cierre de la CRÍTICA **P1** (`docs/PENTEST_NOTES.md`), desviación **BL-35**.
 *
 * ### ⚠️⚠️ POR QUÉ ESTE FICHERO TIENE UN PRISMA QUE **EVALÚA EL `where`**, Y NO UN MOCK NORMAL
 * Un doble de Prisma que responde `{ count: 1 }` a cualquier `updateMany` **pasa exactamente igual
 * con la guarda puesta y con la guarda quitada**: lo único que la guarda cambia es el `where`, y un
 * mock que no lo mira no puede verlo. Esta suite ya vio ese fallo (un doble devolviendo `count: 1`
 * sin escribir nada), así que aquí el fake **filtra un universo de filas por el `where` real** —
 * mismo patrón que `buylist.is-payable-live.spec.ts`. *Un test que no puede fallar por la razón por
 * la que el sistema falla no es cobertura: es decoración.*
 *
 * La reproducción **de punta a punta** del PoC (dos SPEI reales sobre la misma solicitud) vive en
 * `test/integration/buylist-cycle.e2e-spec.ts` (14)-(17), contra Postgres real. Lo de aquí es la
 * **forma de la guarda** y su resistencia a mutaciones; lo de allí es **la conducta del sistema**.
 *
 * ### Las mutaciones que esta suite tiene que tumbar
 * | Mutación sobre la guarda | Test que cae |
 * |---|---|
 * | quitar el término de **terminal** | «cada uno de los CUATRO terminales ⇒ 409» |
 * | quitar el término **`closedAt: null`** | «⚠️ la fila de P1: `closedAt` sellado ∧ status VIVO ⇒ 409» |
 * | `count !== 1` → `count < 1` | «un `updateMany` que toca DOS filas también es 409» |
 * | mover la fecha de vuelta al `data` del status | «la fecha NO se re-sella» |
 * | quitar el `paidAt`/`closedAt` del CAS de `paySpei` | «una fila con `paidAt` NO se re-paga» |
 */

const pii = new PiiCryptoService(new ConfigService({}));
const ALL_STATUSES = Object.values(SellRequestStatus);
const LIVE = ALL_STATUSES.filter(
  (s) => !(SELL_REQUEST_TERMINAL_STATES as readonly SellRequestStatus[]).includes(s),
);

type Row = Record<string, any>;

function baseRow(over: Row = {}): Row {
  return {
    id: 'sr-1',
    userId: 'u1',
    status: 'en_transito' as SellRequestStatus,
    closedAt: null,
    paidAt: null,
    receivedAt: null,
    verifiedAt: null,
    speiReference: null,
    quotedTotalCents: 50_000,
    approvedTotalCents: null,
    offerGrossCents: null,
    offerShippingFeeCents: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    items: [],
    user: null,
    ...over,
  };
}

/** Evalúa una condición Prisma escalar / `{in}` / `{notIn}` / `{not}` contra un valor. */
function matches(value: unknown, cond: unknown): boolean {
  if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
    const c = cond as Record<string, unknown>;
    if ('in' in c) return (c.in as unknown[]).includes(value);
    if ('notIn' in c) return !(c.notIn as unknown[]).includes(value);
    if ('not' in c) return c.not === null ? value !== null : value !== c.not;
    throw new Error(`condición no soportada en el where: ${JSON.stringify(cond)}`);
  }
  return value === cond;
}

/**
 * Prisma de mentira con **UNA fila mutable** que **evalúa el `where` de cada `updateMany`** y solo
 * aplica el `data` si la fila casa. `count` es el resultado real de esa evaluación, no una constante.
 */
function harness(row: Row, opts: { extraRows?: number } = {}) {
  const state: Row = { ...row };
  const writes: { where: Row; data: Row }[] = [];

  const evalWhere = (where: Row): boolean =>
    Object.entries(where).every(([k, cond]) => matches(state[k], cond));

  const prisma: any = {
    sellRequest: {
      findUnique: jest.fn(async () => ({ ...state })),
      findMany: jest.fn(async () => []),
      updateMany: jest.fn(async ({ where, data }: { where: Row; data: Row }) => {
        writes.push({ where, data });
        if (!evalWhere(where)) return { count: 0 };
        Object.assign(state, data);
        // `extraRows` simula un `where` DEMASIADO ANCHO que toca más de una fila: es lo que el
        // patrón `count === 1` (y no `count >= 1`) existe para rechazar.
        return { count: 1 + (opts.extraRows ?? 0) };
      }),
    },
    sellRequestItem: {
      updateMany: jest.fn(async () => ({ count: 0 })),
      findMany: jest.fn(async () => []),
      aggregate: jest.fn(async () => ({
        _sum: { approvedPriceCents: null },
        _count: { approvedPriceCents: 0 },
      })),
    },
    kycProfile: { findUnique: jest.fn(async () => null) },
  };
  prisma.$transaction = jest.fn(async (cb: (tx: unknown) => unknown) => cb(prisma));

  const svc = new BuylistService(
    prisma as unknown as PrismaService,
    {} as PricingService,
    { getNumber: jest.fn(async () => 100_000_000) } as unknown as SettingsService,
    {} as UsersService,
    pii,
  );
  return { svc, prisma, state, writes };
}

/** La escritura que MUEVE EL ESTADO (no el sellado de fecha, que va en su propio `updateMany`). */
const statusWrite = (writes: { where: Row; data: Row }[]) => writes.find((w) => 'status' in w.data);
/** El sellado de fecha, que es un `updateMany` aparte con la fecha en el `where`. */
const dateWrite = (writes: { where: Row; data: Row }[], f: string) => writes.find((w) => f in w.data);

// =================================================================================================
describe('§M5-T · `receive`/`verify` — la guarda lleva LOS DOS términos, en el motor', () => {
  for (const verb of ['receive', 'verify'] as const) {
    const destino = verb === 'receive' ? 'recibida' : 'verificacion';
    const fecha = verb === 'receive' ? 'receivedAt' : 'verifiedAt';

    describe(`${verb} → ${destino}`, () => {
      it.each(SELL_REQUEST_TERMINAL_STATES.map((s) => [s]))(
        'terminal `%s` ⇒ 409 CONFLICT y CERO escritura',
        async (status) => {
          // Fila terminal COHERENTE (con su `closedAt` sellado, como la deja toda transición terminal).
          const h = harness(baseRow({ status, closedAt: new Date('2026-09-05T00:00:00Z') }));
          const err = await h.svc[verb]('sr-1').catch((e) => e);
          expect(err).toBeInstanceOf(BusinessException);
          expect(err.code).toBe('CONFLICT');
          // El estado NO se movió: el fake aplicó el `where` de verdad.
          expect(h.state.status).toBe(status);
          expect(h.state[fecha]).toBeNull();
          // «Cero escritura» incluye los ÍTEMS: su `updateMany` va DESPUÉS de la guarda, a propósito.
          expect(h.prisma.sellRequestItem.updateMany).not.toHaveBeenCalled();
        },
      );

      /**
       * ⚠️⚠️ **EL CASO QUE P1 FABRICÓ, Y EL ÚNICO QUE DISTINGUE UN GUARD DE DOS TÉRMINOS DE UNO.**
       * Si alguien le quita `closedAt: null` a la guarda, TODOS los tests de arriba siguen verdes
       * (esos estados ya los excluye el término de terminal) y **solo cae éste**.
       */
      it('⚠️ `closedAt` SELLADO con status VIVO (la fila de P1) ⇒ 409, no se transiciona', async () => {
        const h = harness(
          baseRow({ status: 'verificacion', closedAt: new Date('2026-09-05T00:00:00Z') }),
        );
        const err = await h.svc[verb]('sr-1').catch((e) => e);
        expect(err).toBeInstanceOf(BusinessException);
        expect(err.code).toBe('CONFLICT');
        expect(h.state.status).toBe('verificacion');
        expect(h.state[fecha]).toBeNull();
      });

      it('el `409` lleva `details: { status, closedAt }` — los DOS, como manda §M5-T', async () => {
        const cerrado = new Date('2026-09-05T00:00:00Z');
        const h = harness(baseRow({ status: 'pagada', closedAt: cerrado }));
        const err = await h.svc[verb]('sr-1').catch((e) => e);
        expect(err.getResponse()).toMatchObject({
          code: 'CONFLICT',
          details: { status: 'pagada', closedAt: cerrado },
        });
      });

      it.each(LIVE.map((s) => [s]))('desde el estado VIVO `%s` sí transiciona (exclusión, no matriz)', async (status) => {
        // §M5-T punto 2: el guardado es POR EXCLUSIÓN. Se prohíbe transicionar lo CERRADO; **no** se
        // enumera desde qué estados es legal cada verbo. Si alguien cablea una matriz de
        // predecesores «deducida del camino feliz», este `each` cae en los estados que dejó fuera —
        // y con él la cohorte legacy (`offerSentAt IS NULL`), que llega a `recibida`/`verificacion`
        // sin pasar por `en_transito`.
        const h = harness(baseRow({ status }));
        await h.svc[verb]('sr-1');
        expect(h.state.status).toBe(destino);
      });

      it('la guarda va en el `where` del `updateMany`, con LOS DOS términos y desde la constante', async () => {
        const h = harness(baseRow());
        await h.svc[verb]('sr-1');
        expect(statusWrite(h.writes)!.where).toEqual({
          id: 'sr-1',
          status: { notIn: [...SELL_REQUEST_TERMINAL_STATES] },
          closedAt: null,
        });
      });

      // -------------------------------------------------------------------------------------
      // IDEMPOTENCIA (§M5 `receive`/`verify`, punto 3)
      // -------------------------------------------------------------------------------------
      it('la fecha se sella en su PROPIO `updateMany`, con la fecha en el `where` (no un `if`)', async () => {
        // *«La fecha entra al `data` solo si aún es `null`, no un `if` de aplicación que una carrera
        // pueda saltar»* — con `[fecha]: null` en el `where`, dos llamadas concurrentes compiten en
        // el motor y solo una sella; con un `if` sobre una lectura previa, las dos leen `null` y las
        // dos escriben.
        const h = harness(baseRow());
        await h.svc[verb]('sr-1');
        expect(dateWrite(h.writes, fecha)!.where).toEqual({ id: 'sr-1', [fecha]: null });
        // Y NO viaja en el `data` de la transición: si volviera ahí, cada POST la movería.
        expect(statusWrite(h.writes)!.data).toEqual({ status: destino });
      });

      it(`⚠️ repetir sobre una ya \`${destino}\` ⇒ NO re-sella \`${fecha}\` (dos relojes reales)`, async () => {
        // `receivedAt` ancla el ABANDONO a 30 días del barrido y las dos fechas entran al `max(...)`
        // de la PURGA DEL INE: re-sellarlas pospone una transición terminal y una obligación de
        // retención de PII. *Un reintento de red no puede correr un plazo legal.*
        const sellada = new Date('2026-09-02T00:00:00Z');
        const h = harness(baseRow({ status: destino, [fecha]: sellada }));
        await h.svc[verb]('sr-1');
        expect(h.state.status).toBe(destino); // 200 idempotente, no 409: sigue VIVA.
        expect(h.state[fecha]).toEqual(sellada);
      });

      it('⚠️ T GANA SOBRE LA IDEMPOTENCIA: `status` = destino pero CERRADA ⇒ 409, no 200', async () => {
        const h = harness(
          baseRow({ status: destino, closedAt: new Date('2026-09-05T00:00:00Z') }),
        );
        await expect(h.svc[verb]('sr-1')).rejects.toMatchObject({ code: 'CONFLICT' });
      });

      it('⚠️ `count` DISTINTO DE 1 (no «al menos 1»): dos filas tocadas ⇒ 409 y no se responde', async () => {
        // Mutación clásica: `count !== 1` → `count < 1`. Un `where` que toca dos filas es un `where`
        // roto, y en una superficie que precede al dinero eso no puede responder `200`.
        const h = harness(baseRow(), { extraRows: 1 });
        await expect(h.svc[verb]('sr-1')).rejects.toMatchObject({ code: 'CONFLICT' });
      });
    });
  }
});

// =================================================================================================
describe('§M5-T · `pay-spei` — la SEGUNDA red: `paidAt IS NULL` ∧ `closedAt IS NULL` en el CAS', () => {
  const PAGABLE = (over: Row = {}) =>
    baseRow({ status: 'verificacion', verifiedAt: new Date('2026-09-03T00:00:00Z'), ...over });

  it('el `where` del `updateMany` afirma `paidAt: null` y `closedAt: null`', async () => {
    const h = harness(PAGABLE({ approvedTotalCents: 40_000 }));
    await h.svc.paySpei('sr-1', 'SPEI-1', 'admin');
    expect(statusWrite(h.writes)!.where).toMatchObject({ paidAt: null, closedAt: null });
  });

  it('⚠️ LA HUELLA DE UN ROLLBACK: `paidAt` poblado con status VIVO ⇒ 409, NO el 200 idempotente', async () => {
    // *La idempotencia existe para absorber un reintento, no para normalizar una incoherencia.*
    // Devolverle la primera liquidación en un `200` escondería justo lo que P1 enseñó a buscar.
    const pagado = new Date('2026-09-04T00:00:00Z');
    const h = harness(PAGABLE({ paidAt: pagado, speiReference: 'SPEI-PRIMERA' }));
    const err = await h.svc.paySpei('sr-1', 'SPEI-SEGUNDA', 'admin').catch((e) => e);
    expect(err).toBeInstanceOf(BusinessException);
    expect(err.getResponse()).toMatchObject({
      code: 'CONFLICT',
      details: { status: 'verificacion', paidAt: pagado },
    });
    // Y no salió un peso: la referencia sigue siendo la PRIMERA.
    expect(h.state.speiReference).toBe('SPEI-PRIMERA');
    expect(h.state.paidAt).toEqual(pagado);
  });

  it('⚠️ `closedAt` sellado con status VIVO ⇒ 409 con `details.closedAt`, y no paga', async () => {
    const cerrado = new Date('2026-09-04T00:00:00Z');
    const h = harness(PAGABLE({ closedAt: cerrado }));
    const err = await h.svc.paySpei('sr-1', 'SPEI-1', 'admin').catch((e) => e);
    expect(err.getResponse()).toMatchObject({
      code: 'CONFLICT',
      details: { status: 'verificacion', closedAt: cerrado },
    });
    expect(h.state.speiReference).toBeNull();
  });

  it('el reintento normal sobre una `pagada` SIGUE siendo `200` idempotente (conducta intacta)', async () => {
    const h = harness(
      PAGABLE({ status: 'pagada', paidAt: new Date(), speiReference: 'SPEI-PRIMERA' }),
    );
    const res: any = await h.svc.paySpei('sr-1', 'SPEI-SEGUNDA', 'admin');
    expect(res.status).toBe('pagada');
    expect(h.state.speiReference).toBe('SPEI-PRIMERA');
  });

  it('el camino feliz no se rompe: una fila pagable de verdad SÍ liquida', async () => {
    // La red nueva solo puede rechazar filas que ya cobraron o ya cerraron; en una fila legítimamente
    // pagable `paidAt`/`closedAt` son `null` POR CONSTRUCCIÓN (un solo escritor de `paidAt` en todo
    // el backend, en el mismo `data` que `status:'pagada'`). Si esto cae, la guarda es demasiado ancha.
    const h = harness(PAGABLE({ approvedTotalCents: 40_000 }));
    await h.svc.paySpei('sr-1', 'SPEI-OK', 'admin');
    expect(h.state.status).toBe('pagada');
    expect(h.state.speiReference).toBe('SPEI-OK');
    expect(h.state.payoutNetCents).toBe(40_000);
  });
});
