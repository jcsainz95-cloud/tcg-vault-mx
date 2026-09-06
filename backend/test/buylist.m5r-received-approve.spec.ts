import { ConfigService } from '@nestjs/config';
import { BuylistService } from '../src/modules/buylist/buylist.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { UsersService } from '../src/modules/users/users.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { MailPort } from '../src/modules/mail/mail.port';

/**
 * `buylist.m5r-received-approve.spec.ts` — **INVARIANTE R (API_CONTRACT §M5-R, v1.58): «NO SE APRUEBA
 * LO QUE NO HA LLEGADO».** Cierre de **BL-39**. *P y R son la misma frase sobre los dos lados del
 * trato: **P** mira el dinero que sale, **R** la mercancía que entra.*
 *
 * ### El defecto que reproduce
 * `convertToInventory` gatea **solo** con `itemStatus === 'aprobada'` —su `findUnique` ni siquiera lee
 * `sellRequest`— y la escalera de `itemDecision` (terminal → ciclo de oferta → cota de precio) **no
 * miraba `receivedAt` en ningún punto** ⇒ una línea de una solicitud **`cotizada`/`ofertada`** se
 * aprobaba y de ahí se convertía en **pieza de inventario vendible que puede no existir físicamente**,
 * con su costo capitalizado en el P&L de M7.
 *
 * ### ⚠️ EL TÉRMINO VA EN `approve`, NO EN LA CONVERSIÓN — y esta suite lo PRUEBA
 * El assert ⭐ de §M5-R.7.2 es el que sostiene la decisión: sobre la línea no aprobada,
 * `convert-to-inventory` sigue respondiendo **`422 ITEM_NOT_APPROVED`** *sin haber ganado ninguna
 * guarda nueva*. **Se hace inalcanzable `aprobada` sin recepción y la guarda única del consumidor
 * vuelve a bastar.** *Una invariante se cierra en el verbo que PRODUCE el estado, no en cada verbo que
 * lo consume; duplicar la guarda duplica la regla, y la copia se desfasa.*
 *
 * ### ⚠️ POR QUÉ EL DOBLE DE PRISMA **EVALÚA EL `where`** DEL `updateMany`
 * El contrato exige que la guarda REAL viva en el `where` con `count === 1`, **no** en un `if` sobre
 * la lectura previa (read-then-write, y esto decide si una carta ajena entra al inventario). Un fake
 * que respondiera `{count: 1}` a todo **pasaría igual con el término puesto y quitado**. Aquí el fake
 * evalúa la relación contra la fila REAL, y el caso `staleReceivedAtForRead` fabrica la carrera:
 * *el pre-check ve una recepción que el motor ya no ve.*
 *
 * ### Las mutaciones que esta suite tiene que tumbar
 * | Mutación | Test que cae |
 * |---|---|
 * | borrar el término del **pre-check** (`assertRequestReceived`) | «⚠️ el PoC: `approve` sobre una solicitud NUNCA RECIBIDA» |
 * | borrar el término del **`where`** (la guarda real) | «⚠️ LA CARRERA: el pre-check ve la recepción y el MOTOR no» |
 * | mover el peldaño **antes** de `ITEM_NOT_OFFERED` | «precedencia · `ITEM_NOT_OFFERED` gana» |
 * | mover el peldaño **después** de `OFFER_PRICE_IMMUTABLE` | «precedencia · `REQUEST_NOT_RECEIVED` gana a `OFFER_PRICE_IMMUTABLE`» |
 * | extender el término a **`reject`** | «`reject` pre-recepción sigue dando `200`» |
 * | extender el término a **`adjust`** | «`adjust` fuera del ciclo no lo gana» |
 * | limitarlo al **ciclo** (no aplicarlo fuera) | «FUERA del ciclo también aplica» |
 * | añadir la **segunda guarda** a `convert-to-inventory` | «⭐ la conversión NO gana una segunda guarda» |
 * | una guarda que **nunca apruebe** (el falso verde) | «⭐ EL CAMINO FELIZ: `receive` → `approve` → `convert`» |
 */

const pii = new PiiCryptoService(new ConfigService({}));

const RECIBIDA = new Date('2026-09-02T00:00:00Z');

type Row = Record<string, any>;

interface Opts {
  /** `receivedAt` de la solicitud padre. `null` = nunca la recibimos. */
  receivedAt?: Date | null;
  /** `null` = cohorte legacy (fuera del ciclo de oferta). */
  offerSentAt?: Date | null;
  status?: string;
  itemStatus?: string;
  offerDecision?: 'buy' | 'skip' | null;
  offeredPriceCents?: number | null;
  /**
   * ⚠️ La CARRERA: lo que el **pre-check** lee, distinto de lo que el **motor** ve. Con una fecha
   * aquí y `receivedAt: null` en la fila, el `if` pasa y solo el `where` puede parar la escritura.
   */
  staleReceivedAtForRead?: Date | null;
}

function fakeDb(opts: Opts = {}) {
  const request: Row = {
    id: 'sr-1',
    userId: 'u1',
    status: opts.status ?? 'ofertada',
    receivedAt: opts.receivedAt === undefined ? null : opts.receivedAt,
    offerSentAt: opts.offerSentAt === undefined ? new Date('2026-09-01T00:00:00Z') : opts.offerSentAt,
    approvedTotalCents: null,
    quotedTotalCents: 50_000,
    adjustmentSentAt: null,
    closedAt: null,
  };
  const item: Row = {
    id: 'sri-1',
    sellRequestId: 'sr-1',
    cardId: 'card-1',
    productType: 'raw',
    rawCondition: 'NM',
    finish: 'normal',
    itemStatus: opts.itemStatus ?? 'verificacion',
    quotedPriceCents: 30_000,
    approvedPriceCents: null,
    offerDecision: opts.offerDecision === undefined ? 'buy' : opts.offerDecision,
    offeredPriceCents: opts.offeredPriceCents === undefined ? 40_000 : opts.offeredPriceCents,
    inventoryItemId: null,
    rejectedAt: null,
    rejectionReason: null,
  };
  const writes: string[] = [];

  const matches = (value: unknown, cond: unknown): boolean => {
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      const c = cond as Row;
      if ('in' in c) return (c.in as unknown[]).includes(value);
      if ('notIn' in c) return !(c.notIn as unknown[]).includes(value);
      if ('not' in c) return c.not === null ? value != null : value !== c.not;
      throw new Error(`condición no soportada: ${JSON.stringify(cond)}`);
    }
    if (value instanceof Date && cond instanceof Date) return value.getTime() === cond.getTime();
    return value === cond;
  };

  const prisma: any = {
    kycProfile: { findUnique: jest.fn().mockResolvedValue(null) },
    sellRequestItem: {
      findUnique: jest.fn(async (args: any) =>
        args?.include?.sellRequest
          ? {
              ...item,
              sellRequest: {
                userId: 'u1',
                status: request.status,
                offerSentAt: request.offerSentAt,
                // ⚠️ La lectura del PRE-CHECK. Con `staleReceivedAtForRead` miente respecto de la fila
                // real, que es lo que fabrica la carrera.
                receivedAt:
                  opts.staleReceivedAtForRead !== undefined
                    ? opts.staleReceivedAtForRead
                    : request.receivedAt,
                user: { email: 's@e.mx', name: 'Ash', locale: 'es' },
              },
              card: { name: 'Pidgey', number: '16', set: { name: 'Base Set' } },
            }
          : { ...item, card: { id: 'card-1', name: 'Pidgey' } },
      ),
      // ⚠️ Evalúa el `where` DE VERDAD: el escalar y **la relación** contra la fila real. Es lo único
      // que distingue «la guarda está en el motor» de «la guarda es un `if`».
      updateMany: jest.fn(async ({ where, data }: any) => {
        const idOk = matches(item.id, where.id);
        const relOk =
          where.sellRequest == null ||
          Object.entries(where.sellRequest).every(([k, cond]) => matches(request[k], cond));
        if (!idOk || !relOk) return { count: 0 };
        writes.push('item.updateMany');
        Object.assign(item, data);
        return { count: 1 };
      }),
      // `itemDecision` NO puede escribir con `update` (su guarda es el `where` del `updateMany`); la
      // CONVERSIÓN sí, y es legítimo — su exclusión la da el índice único de `InventoryItem`. El fake
      // distingue por el `data`, no por el verbo, para no dejar pasar la mutación que importa.
      update: jest.fn(async ({ data }: any) => {
        if (data?.itemStatus !== 'convertida_inventario') {
          throw new Error('itemDecision NO debe escribir con `update`: la guarda es el updateMany');
        }
        writes.push('item.update(convert)');
        Object.assign(item, data);
        return { ...item };
      }),
      aggregate: jest.fn(async () => ({
        _sum: { approvedPriceCents: item.approvedPriceCents },
        _count: { approvedPriceCents: item.approvedPriceCents == null ? 0 : 1 },
      })),
      count: jest.fn(async () => 1),
    },
    sellRequest: {
      findUnique: jest.fn(async () => ({ ...request })),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const { id: _id, ...rest } = where;
        if (!Object.entries(rest).every(([k, cond]) => matches(request[k], cond))) {
          return { count: 0 };
        }
        writes.push('request.updateMany');
        Object.assign(request, data);
        return { count: 1 };
      }),
    },
    inventoryItem: {
      create: jest.fn(async ({ data }: any) => {
        writes.push('inventoryItem.create');
        return { id: 'inv-1', ...data };
      }),
      findUnique: jest.fn(async () => null),
      update: jest.fn(async () => ({})),
    },
    inventoryMovement: { create: jest.fn(async () => ({})) },
    nextFolio: jest.fn(async () => 'F-0001'),
    $transaction: jest.fn(async (cb: any) => (typeof cb === 'function' ? cb(prisma) : cb)),
  };
  const settings = { getNumber: jest.fn(async () => 300000) };
  const mail: MailPort = { send: jest.fn(async () => ({ id: 'm1' })) };
  const svc = new BuylistService(
    prisma as PrismaService,
    {} as PricingService,
    settings as unknown as SettingsService,
    {} as UsersService,
    pii,
    mail,
  );
  return { svc, prisma, request, item, writes, mail };
}

// =============================================================================================
describe('§M5-R — `approve` exige constancia de recepción', () => {
  it('⚠️ el PoC: `approve` sobre una solicitud NUNCA RECIBIDA ⇒ `422 REQUEST_NOT_RECEIVED`, cero escritura', async () => {
    const { svc, request, item, writes, prisma } = fakeDb({ status: 'ofertada', receivedAt: null });
    await expect(svc.itemDecision('sri-1', 'approve')).rejects.toMatchObject({
      code: 'REQUEST_NOT_RECEIVED',
      // Nombra la SOLICITUD, no la línea: el remedio es `POST …/receive`.
      details: { sellRequestId: 'sr-1', status: 'ofertada' },
    });
    expect(item.itemStatus).toBe('verificacion');
    expect(item.approvedPriceCents).toBeNull();
    expect(request.approvedTotalCents).toBeNull();
    expect(writes).toEqual([]);
    // El pre-check corta ANTES de intentar la escritura (ver el gemelo fuera del ciclo).
    expect(prisma.sellRequestItem.updateMany).not.toHaveBeenCalled();
  });

  it('⚠️ LA CARRERA: el pre-check ve la recepción y el MOTOR no ⇒ no se escribe un solo campo', async () => {
    // ⭐ Éste es el test que muere si el término sale del `where` y se queda solo en el `if`.
    const { svc, item, writes } = fakeDb({
      receivedAt: null,
      staleReceivedAtForRead: RECIBIDA,
    });
    await expect(svc.itemDecision('sri-1', 'approve')).rejects.toMatchObject({
      code: 'REQUEST_NOT_RECEIVED',
      details: { sellRequestId: 'sr-1' },
    });
    expect(item.itemStatus).toBe('verificacion');
    expect(item.approvedPriceCents).toBeNull();
    expect(writes).toEqual([]);
  });

  it('FUERA del ciclo también aplica: no es una regla del ciclo, es sobre mercancía física', async () => {
    const { svc, item, prisma } = fakeDb({ offerSentAt: null, receivedAt: null, offerDecision: null });
    await expect(svc.itemDecision('sri-1', 'approve', 25_000)).rejects.toMatchObject({
      code: 'REQUEST_NOT_RECEIVED',
    });
    expect(item.approvedPriceCents).toBeNull();
    // ⚠️ Y **el PRE-CHECK corta antes de intentar la escritura**. Sin este assert, quitar el
    // pre-check del camino fuera-de-ciclo pasaría inadvertido: el `where` del `updateMany` daría el
    // mismo `422` por la vía de la carrera. *La guarda del motor es la que protege; el pre-check es
    // el que no gasta un intento de escritura que ya sabemos que va a fallar* — y **las dos tienen
    // que existir**, que es justo lo que §M5-P asevera por el lado del pago.
    expect(prisma.sellRequestItem.updateMany).not.toHaveBeenCalled();
  });

  it('cohorte LEGACY (`offerSentAt IS NULL`) con `receivedAt` sellado ⇒ `approve` funciona igual que hoy', async () => {
    const { svc, item } = fakeDb({ offerSentAt: null, receivedAt: RECIBIDA, offerDecision: null });
    const res: any = await svc.itemDecision('sri-1', 'approve', 25_000);
    expect(res).toMatchObject({ itemStatus: 'aprobada', approvedPriceCents: 25_000 });
    expect(item.itemStatus).toBe('aprobada');
  });
});

// =============================================================================================
describe('§M5-R.3 — SOLO `approve`', () => {
  it('`reject` pre-recepción sigue dando `200` — es el residual nombrado, y es correcto que pase', async () => {
    // `reject` es la dirección SEGURA: quita el monto, cierra solicitudes y desatasca filas.
    // Gatearlo dejaría filas sin salida — daño real a cambio de ninguno evitado.
    const { svc, item } = fakeDb({ receivedAt: null });
    const res: any = await svc.itemDecision('sri-1', 'reject', undefined, 'no llegó nunca');
    expect(res.itemStatus).toBe('rechazada');
    expect(item.approvedPriceCents).toBeNull();
  });

  it('`adjust` fuera del ciclo NO lo gana (cohorte legacy, no se retro-edita)', async () => {
    const { svc, item } = fakeDb({ offerSentAt: null, receivedAt: null, offerDecision: null });
    const res: any = await svc.itemDecision('sri-1', 'adjust', 25_000);
    expect(res).toMatchObject({ itemStatus: 'ajustada', approvedPriceCents: 25_000 });
    expect(item.itemStatus).toBe('ajustada');
  });

  it('`adjust` DENTRO del ciclo sigue dando `409 ADJUST_NOT_ALLOWED_IN_OFFER_CYCLE` (gana al de R)', async () => {
    const { svc } = fakeDb({ receivedAt: null });
    await expect(svc.itemDecision('sri-1', 'adjust', 25_000)).rejects.toMatchObject({
      code: 'ADJUST_NOT_ALLOWED_IN_OFFER_CYCLE',
    });
  });
});

// =============================================================================================
describe('§M5-R.4 — precedencia dentro de la escalera', () => {
  it('precedencia · `NO_LIVE_ADJUSTMENT` (terminal) gana a `REQUEST_NOT_RECEIVED`', async () => {
    const { svc } = fakeDb({ status: 'pagada', receivedAt: null });
    await expect(svc.itemDecision('sri-1', 'approve')).rejects.toMatchObject({
      code: 'NO_LIVE_ADJUSTMENT',
    });
  });

  it('precedencia · `ITEM_NOT_OFFERED` gana: ninguna recepción arregla una línea que no compramos', async () => {
    const { svc } = fakeDb({ receivedAt: null, offerDecision: 'skip' });
    await expect(svc.itemDecision('sri-1', 'approve')).rejects.toMatchObject({
      code: 'ITEM_NOT_OFFERED',
    });
  });

  it('precedencia · `REQUEST_NOT_RECEIVED` gana a `OFFER_PRICE_IMMUTABLE` (anula el ACTO, no un campo)', async () => {
    const { svc } = fakeDb({ receivedAt: null });
    await expect(svc.itemDecision('sri-1', 'approve', 99_000)).rejects.toMatchObject({
      code: 'REQUEST_NOT_RECEIVED',
    });
  });

  it('precedencia · con la solicitud RECIBIDA, `OFFER_PRICE_IMMUTABLE` vuelve a ser el error', async () => {
    // El contra-control del anterior: sin él, un `REQUEST_NOT_RECEIVED` que se disparara SIEMPRE
    // pasaría el test de precedencia igual de bien.
    const { svc } = fakeDb({ receivedAt: RECIBIDA });
    await expect(svc.itemDecision('sri-1', 'approve', 99_000)).rejects.toMatchObject({
      code: 'OFFER_PRICE_IMMUTABLE',
    });
  });
});

// =============================================================================================
describe('§M5-R.1 — la conversión NO se toca, y por eso basta con una guarda', () => {
  it('⭐ la conversión NO gana una segunda guarda: la línea no aprobada sale por `ITEM_NOT_APPROVED`', async () => {
    // ⭐ Éste es el assert que prueba que la guarda ÚNICA basta. `aprobada` se volvió inalcanzable sin
    // recepción, así que la conversión sigue con su `422 ITEM_NOT_APPROVED` de siempre y su mismo
    // `details.itemStatus`. *Duplicar la guarda duplicaría la regla, y la copia se desfasa.*
    const { svc, prisma } = fakeDb({ receivedAt: null });
    await expect(svc.itemDecision('sri-1', 'approve')).rejects.toMatchObject({
      code: 'REQUEST_NOT_RECEIVED',
    });
    await expect(svc.convertToInventory('sri-1', 'op-1')).rejects.toMatchObject({
      code: 'ITEM_NOT_APPROVED',
      details: { itemStatus: 'verificacion' },
    });
    expect(prisma.inventoryItem.create).not.toHaveBeenCalled();
  });
});

// =============================================================================================
describe('§M5-R.7 — el camino feliz', () => {
  it('⭐ EL CAMINO FELIZ: con la solicitud RECIBIDA, `approve` pasa y la conversión también', async () => {
    // *Sin este assert, todos los anteriores los pasa un endpoint que no aprueba nunca.*
    const { svc, item, prisma } = fakeDb({ receivedAt: RECIBIDA, status: 'verificacion' });
    const res: any = await svc.itemDecision('sri-1', 'approve');
    // Dentro del ciclo el monto es SERVER-SIDE y es el OFERTADO (D2/D9/D30).
    expect(res).toMatchObject({ itemStatus: 'aprobada', approvedPriceCents: 40_000 });
    expect(item.itemStatus).toBe('aprobada');

    const conv: any = await svc.convertToInventory('sri-1', 'op-1');
    expect(conv.inventoryItemId).toBe('inv-1');
    expect(prisma.inventoryItem.create).toHaveBeenCalledTimes(1);
  });
});
