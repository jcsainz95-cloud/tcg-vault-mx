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
import { matchesWhere } from './helpers/prisma-where';

/**
 * `buylist.m5s-step-guard.spec.ts` — **INVARIANTE S (API_CONTRACT §M5-S, v1.68): `receive` y `verify`
 * exigen el PASO CORRECTO, no solo «fila viva».** Cierre de **P-58**; hermana de
 * `buylist.m5t-terminal-guard.spec.ts` (T) y `buylist.m5p-received-guard.spec.ts` (P).
 *
 * ### La regla (PROJECT §P.1, pasos 4→5→6; ARCHITECTURE §4.48.1)
 * ```
 * receive : allowedFrom = { en_transito }  idempotentOn = recibida      ⇒ status := recibida,     sella receivedAt (1ª vez)
 * verify  : allowedFrom = { recibida }     idempotentOn = verificacion  ⇒ status := verificacion, sella verifiedAt  (1ª vez)
 * ```
 * Otro estado **vivo** ⇒ `409 INVALID_TRANSITION { verb, from, allowedFrom, idempotentOn }`.
 * Terminal ∨ `closedAt ≠ null` ⇒ `409 CONFLICT { status, closedAt }` (§M5-T, **T gana**). Cero escritura.
 *
 * ### ⚠️ Por qué el Prisma de aquí EVALÚA el `where`
 * La guarda **es** el `where` del `updateMany`; un doble que responde `{count:1}` a ciegas pasa igual
 * con la guarda puesta y quitada. El fake filtra la fila por el `where` real (`matchesWhere`), así
 * que `count` es lo que el motor devolvería. La misma matriz **contra Postgres** vive en
 * `test/integration/buylist-step-guard.e2e-spec.ts`.
 *
 * ### Candados (§M5-S)
 * | Mutación | Test que cae |
 * |---|---|
 * | **m5**: volver a `liveRequestWhere()` (o quitar el término de estado) | la matriz S-1: 5 filas por verbo pasan a `200` |
 * | permitir `verify` desde `en_transito` («arreglar» la cadena) | S-2 invertida: `verify` daría `200` y sellaría `verifiedAt` |
 * | responder `CONFLICT` en vez de `INVALID_TRANSITION` para un vivo | «`details` normativo» |
 * | quitar `closedAt: null` | «la fila de P1 ⇒ `CONFLICT`, no `INVALID_TRANSITION`» |
 */

const pii = new PiiCryptoService(new ConfigService({}));
const ALL_STATUSES = Object.values(SellRequestStatus);
const TERMINAL = SELL_REQUEST_TERMINAL_STATES as readonly SellRequestStatus[];
const LIVE = ALL_STATUSES.filter((s) => !TERMINAL.includes(s));

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

function harness(row: Row) {
  const state: Row = { ...row };
  const writes: { where: Row; data: Row }[] = [];
  const prisma: any = {
    sellRequest: {
      findUnique: jest.fn(async () => ({ ...state })),
      findMany: jest.fn(async () => []),
      updateMany: jest.fn(async ({ where, data }: { where: Row; data: Row }) => {
        writes.push({ where, data });
        if (!matchesWhere(state, where)) return { count: 0 };
        Object.assign(state, data);
        return { count: 1 };
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

/** La tabla normativa de §M5-S, escrita UNA vez para los dos verbos. */
const STEPS = {
  receive: { allowedFrom: ['en_transito'], idempotentOn: 'recibida', fecha: 'receivedAt' },
  verify: { allowedFrom: ['recibida'], idempotentOn: 'verificacion', fecha: 'verifiedAt' },
} as const;

const CERRADO = new Date('2026-09-05T00:00:00Z');
const SELLADA = new Date('2026-09-02T00:00:00Z');

// =================================================================================================
describe('§M5-S · S-1 — la MATRIZ 11 × 2: qué devuelve cada verbo desde cada `SellRequestStatus`', () => {
  for (const verb of ['receive', 'verify'] as const) {
    const step = STEPS[verb];
    describe(`${verb} (allowedFrom ${JSON.stringify(step.allowedFrom)}, idempotentOn '${step.idempotentOn}')`, () => {
      it.each(step.allowedFrom.map((s) => [s]))(
        'desde `%s` (el predecesor) ⇒ transiciona y sella la fecha por primera vez',
        async (status) => {
          const h = harness(baseRow({ status }));
          await h.svc[verb]('sr-1');
          expect(h.state.status).toBe(step.idempotentOn);
          expect(h.state[step.fecha]).toBeInstanceOf(Date);
        },
      );

      it(`desde \`${step.idempotentOn}\` (el destino) ⇒ 200 idempotente y NO re-sella \`${step.fecha}\``, async () => {
        const h = harness(baseRow({ status: step.idempotentOn, [step.fecha]: SELLADA }));
        await h.svc[verb]('sr-1');
        expect(h.state.status).toBe(step.idempotentOn);
        expect(h.state[step.fecha]).toEqual(SELLADA);
      });

      const otrosVivos = LIVE.filter(
        (s) => !(step.allowedFrom as readonly string[]).includes(s) && s !== step.idempotentOn,
      );
      it.each(otrosVivos.map((s) => [s]))(
        'desde el estado VIVO `%s` ⇒ 409 INVALID_TRANSITION con el `details` normativo y CERO escritura',
        async (status) => {
          const h = harness(baseRow({ status }));
          const err = await h.svc[verb]('sr-1').catch((e) => e);
          expect(err).toBeInstanceOf(BusinessException);
          expect(err.getStatus()).toBe(409);
          expect(err.getResponse()).toMatchObject({
            code: 'INVALID_TRANSITION',
            details: {
              verb,
              from: status,
              allowedFrom: [...step.allowedFrom],
              idempotentOn: step.idempotentOn,
            },
          });
          expect(h.state.status).toBe(status);
          expect(h.state[step.fecha]).toBeNull();
          expect(h.prisma.sellRequestItem.updateMany).not.toHaveBeenCalled();
        },
      );

      it.each(TERMINAL.map((s) => [s]))(
        'desde el terminal `%s` ⇒ 409 CONFLICT { status, closedAt } (§M5-T gana), no INVALID_TRANSITION',
        async (status) => {
          const h = harness(baseRow({ status, closedAt: CERRADO }));
          const err = await h.svc[verb]('sr-1').catch((e) => e);
          expect(err).toBeInstanceOf(BusinessException);
          expect(err.getResponse()).toMatchObject({
            code: 'CONFLICT',
            details: { status, closedAt: CERRADO },
          });
          expect(h.state.status).toBe(status);
          expect(h.prisma.sellRequestItem.updateMany).not.toHaveBeenCalled();
        },
      );

      it('⚠️ la fila de P1 (`status` vivo, `closedAt` sellado) ⇒ CONFLICT, no INVALID_TRANSITION', async () => {
        // Es la única fila que distingue una guarda de dos términos de una de uno — y también la
        // que distingue «T gana» de «S lo explica mal»: si el `details` dijera «estás en
        // verificacion, verify solo aplica en recibida», mentiría — lo que la bloquea es el cierre.
        const h = harness(baseRow({ status: 'verificacion', closedAt: CERRADO }));
        const err = await h.svc[verb]('sr-1').catch((e) => e);
        expect(err.getResponse()).toMatchObject({
          code: 'CONFLICT',
          details: { status: 'verificacion', closedAt: CERRADO },
        });
        expect(h.state.status).toBe('verificacion');
      });

      it('⚠️ el destino CERRADO tampoco es idempotente: T gana sobre la idempotencia', async () => {
        const h = harness(baseRow({ status: step.idempotentOn, closedAt: CERRADO, [step.fecha]: SELLADA }));
        await expect(h.svc[verb]('sr-1')).rejects.toMatchObject({ code: 'CONFLICT' });
        expect(h.state[step.fecha]).toEqual(SELLADA);
      });

      it('la guarda es el `where`: `status in [predecesor, destino]` ∧ `closedAt: null`, evaluado', async () => {
        const h = harness(baseRow({ status: step.allowedFrom[0] }));
        await h.svc[verb]('sr-1');
        const w = h.writes.find((x) => 'status' in x.data)!.where;
        expect(w).toEqual({
          id: 'sr-1',
          status: { in: [...step.allowedFrom, step.idempotentOn] },
          closedAt: null,
        });
        // Lo que el motor haría con ese `where`, fila por fila: SOLO los dos admitidos casan.
        for (const s of ALL_STATUSES) {
          const admitido = (step.allowedFrom as readonly string[]).includes(s) || s === step.idempotentOn;
          expect(matchesWhere(baseRow({ status: s }), w)).toBe(admitido);
        }
        expect(matchesWhere(baseRow({ status: step.allowedFrom[0], closedAt: CERRADO }), w)).toBe(false);
      });
    });
  }

  it('la matriz cubre los ONCE estados del enum (si el enum crece, este test lo grita)', () => {
    expect(ALL_STATUSES).toHaveLength(11);
    expect(LIVE).toHaveLength(7);
    expect(TERMINAL).toHaveLength(4);
  });
});

// =================================================================================================
describe('§M5-S · S-2 — la CADENA de la mesa sigue pasando; la INVERTIDA se corta', () => {
  it('directa: `en_transito` → receive → verify ⇒ 200 · 200, `verificacion` con LAS DOS fechas', async () => {
    // Es la cadena real de la bitácora (`receive`→`verify` con 20 ms): cada verbo parte de su
    // predecesor, así que S no la toca. Si esto cae, la guarda es demasiado estrecha.
    const h = harness(baseRow({ status: 'en_transito' }));
    await h.svc.receive('sr-1');
    expect(h.state.status).toBe('recibida');
    await h.svc.verify('sr-1');
    expect(h.state.status).toBe('verificacion');
    expect(h.state.receivedAt).toBeInstanceOf(Date);
    expect(h.state.verifiedAt).toBeInstanceOf(Date);
  });

  it('invertida: `en_transito` → verify → receive ⇒ 409 INVALID_TRANSITION · 200, `recibida` SIN `verifiedAt`', async () => {
    // Hasta v1.67 esta cadena terminaba en `recibida` con `verifiedAt` sellado: un estado que
    // ningún paso del pacto produce y que `isPayable` (`receivedAt ∧ verifiedAt`) leía como legítimo.
    const h = harness(baseRow({ status: 'en_transito' }));
    await expect(h.svc.verify('sr-1')).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
      details: { verb: 'verify', from: 'en_transito', allowedFrom: ['recibida'], idempotentOn: 'verificacion' },
    });
    expect(h.state.status).toBe('en_transito');
    expect(h.state.verifiedAt).toBeNull();
    await h.svc.receive('sr-1');
    expect(h.state.status).toBe('recibida');
    expect(h.state.receivedAt).toBeInstanceOf(Date);
    expect(h.state.verifiedAt).toBeNull();
  });

  it('retroceder no existe: `verify` desde `aprobada` y `receive` desde `verificacion` ⇒ 409, sin cambio', async () => {
    // Hoy no hay verbo del pacto que «reabra» una verificación; si algún día lo hay, será un verbo
    // con nombre, no un efecto lateral de `receive`/`verify`.
    const a = harness(baseRow({ status: 'aprobada', receivedAt: SELLADA, verifiedAt: SELLADA }));
    await expect(a.svc.verify('sr-1')).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    expect(a.state.status).toBe('aprobada');
    const v = harness(baseRow({ status: 'verificacion', receivedAt: SELLADA, verifiedAt: SELLADA }));
    await expect(v.svc.receive('sr-1')).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    expect(v.state.status).toBe('verificacion');
    expect(v.state.receivedAt).toEqual(SELLADA);
  });

  it('el paquete sin `confirm-shipment` (`aceptada`): `receive` ⇒ 409 INVALID_TRANSITION — es un clic, no un agujero', async () => {
    const h = harness(baseRow({ status: 'aceptada' }));
    const err = await h.svc.receive('sr-1').catch((e) => e);
    expect(err.getResponse()).toMatchObject({
      code: 'INVALID_TRANSITION',
      details: { verb: 'receive', from: 'aceptada', allowedFrom: ['en_transito'] },
    });
    expect(h.state.status).toBe('aceptada');
  });
});
