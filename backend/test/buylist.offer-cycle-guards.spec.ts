import { ConfigService } from '@nestjs/config';
import { BuylistService } from '../src/modules/buylist/buylist.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { UsersService } from '../src/modules/users/users.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';

/**
 * v1.51.20 · **BL-27** — **EN EL CICLO DE OFERTA NO EXISTE NI REPRECIAR NI AJUSTAR.**
 * API_CONTRACT §M5 (`PATCH /admin/buylist/items/:itemId/decision`), criterios 119/124/150.
 *
 * ### El agujero, medido contra BD real antes de este pase
 * La guarda de **terminal** (BL-14) aterrizó sola: `ADJUST_NOT_ALLOWED_IN_OFFER_CYCLE` quedó
 * cableada **únicamente en `respond`** y **`OFFER_PRICE_IMMUTABLE` no existía en el código**. Sobre
 * una oferta **ya ACEPTADA** (bruto MX$635, neto MX$455):
 * ```
 * PATCH …/decision {"decision":"adjust","approvedPriceCents":9900}  → 200 OK
 * pay-spei → pagada | og 63500 | onet 45500 | apr 9900 | pay 0
 * ```
 * **El vendedor aceptó MX$500 por una carta que llegó NM y cobró MX$0.** *La aritmética del pago era
 * correcta; lo que faltaba era la guarda que impide reescribir un precio ya vinculante.*
 *
 * ### Qué fija este archivo, y qué NO
 * Aquí se fijan **las cuatro ramas y su precedencia** con un Prisma de mentira que evalúa el `where`
 * de verdad —incluida la relación—, para que un `updateMany` que ignorara la guarda **no pueda pasar
 * estos tests**. Lo que este archivo **no** puede demostrar es que el endpoint responda esos códigos
 * por HTTP con los guards y el pipe puestos: eso vive en
 * `test/integration/buylist-cycle.e2e-spec.ts`, y es donde QA encontró el defecto. *Los dos hacen
 * falta y ninguno sustituye al otro.*
 */

const pii = new PiiCryptoService(new ConfigService({}));

/** Predicado Prisma de mentira: escalar, `null`, `{not}`, `{in}`, `{notIn}`. */
function matches(value: unknown, cond: unknown): boolean {
  if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
    const c = cond as Record<string, unknown>;
    if ('in' in c) return (c.in as unknown[]).includes(value);
    if ('notIn' in c) return !(c.notIn as unknown[]).includes(value);
    if ('not' in c) return !matches(value, c.not);
    throw new Error(`condición no soportada por el fake: ${JSON.stringify(cond)}`);
  }
  return value === cond;
}

/**
 * Prisma de mentira con la semántica **CONDICIONAL** de `updateMany`. Es deliberado: un mock que
 * devolviera `{count:1}` a ciegas dejaría pasar estos tests **aunque la guarda no existiera**.
 *
 * `staleOfferSentAtForRead` simula la CARRERA que la guarda del motor existe para cerrar: el
 * pre-check lee una solicitud **pre-ciclo** y, entre la lectura y la escritura, **se emite la
 * oferta**. La lectura del `include` miente; la fila real, no.
 */
function fakeDb(opts: {
  status?: string;
  offerSentAt?: Date | null;
  staleOfferSentAtForRead?: Date | null;
  itemStatus?: string;
  offeredPriceCents?: number | null;
  quotedPriceCents?: number | null;
  /**
   * v1.51.20 — **qué decidimos sobre ESTA línea al ofertar.** `'buy'` por defecto (la línea del
   * camino feliz); `'skip'` y `null` son los dos casos de `422 ITEM_NOT_OFFERED`.
   */
  offerDecision?: 'buy' | 'skip' | null;
}) {
  const request: Record<string, unknown> = {
    id: 'sr-1',
    userId: 'u1',
    status: opts.status ?? 'verificacion',
    approvedTotalCents: null,
    quotedTotalCents: 50_000,
    adjustmentSentAt: null,
    closedAt: null,
    offerSentAt: opts.offerSentAt ?? null,
  };
  const item: Record<string, unknown> = {
    id: 'sri-1',
    sellRequestId: 'sr-1',
    itemStatus: opts.itemStatus ?? 'verificacion',
    quotedPriceCents: opts.quotedPriceCents ?? 50_000,
    offeredPriceCents: opts.offeredPriceCents ?? null,
    offerDecision: opts.offerDecision === undefined ? 'buy' : opts.offerDecision,
    approvedPriceCents: null,
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
              sellRequest: {
                userId: 'u1',
                status: request.status,
                // La lectura VIEJA de la carrera, cuando el caso la pide.
                offerSentAt:
                  opts.staleOfferSentAtForRead !== undefined
                    ? opts.staleOfferSentAtForRead
                    : request.offerSentAt,
                user: { email: 's@e.mx', name: 'Ash', locale: 'es' },
              },
              card: { name: 'Pidgey', number: '16', set: { name: 'Base Set' } },
            }
          : { ...item },
      ),
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
      update: jest.fn(async () => {
        throw new Error('itemDecision NO debe escribir con `update`: la guarda es el updateMany');
      }),
      aggregate: jest.fn(async () => ({
        _sum: { approvedPriceCents: item.approvedPriceCents },
        _count: { approvedPriceCents: item.approvedPriceCents == null ? 0 : 1 },
      })),
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

describe('BL-27 — `itemDecision` en el CICLO DE OFERTA (§M5, criterios 119/124/150)', () => {
  const OFFER_SENT = new Date('2026-02-01T10:00:00Z');

  it('`approvedPriceCents` en el body ⇒ 422 OFFER_PRICE_IMMUTABLE, y NO escribe NADA', async () => {
    const { svc, item, writes } = fakeDb({ offerSentAt: OFFER_SENT, offeredPriceCents: 63_500 });
    await expect(svc.itemDecision('sri-1', 'approve', 9_900)).rejects.toMatchObject({
      code: 'OFFER_PRICE_IMMUTABLE',
      // `details` accionable: el ítem y **la cifra vinculante**, para que quien lea el error sepa
      // cuál es el número que manda sin tener que ir a buscarlo.
      details: { itemId: 'sri-1', offeredPriceCents: 63_500 },
    });
    // La comprobación que importa no es el código: es que el dinero no se movió.
    expect(item.approvedPriceCents).toBeNull();
    expect(writes).toEqual([]);
  });

  it('`adjust` ⇒ 409 ADJUST_NOT_ALLOWED_IN_OFFER_CYCLE, y el ítem NO queda `ajustada`', async () => {
    const { svc, item, request, writes } = fakeDb({ offerSentAt: OFFER_SENT, offeredPriceCents: 63_500 });
    await expect(svc.itemDecision('sri-1', 'adjust')).rejects.toMatchObject({
      code: 'ADJUST_NOT_ALLOWED_IN_OFFER_CYCLE',
      details: { status: 'verificacion' },
    });
    // Criterio 150 **por lo negativo**: el ítem `ajustada` no se usa en NINGUNA parte del ciclo.
    expect(item.itemStatus).not.toBe('ajustada');
    // Y el plazo de 7 días tampoco se disparó (era el efecto suelto que BL-14 ya había separado).
    expect(request.adjustmentSentAt).toBeNull();
    expect(writes).toEqual([]);
  });

  it('`approve` SIN monto fija SERVER-SIDE el precio OFERTADO, no el cotizado', async () => {
    // El cotizado y el ofertado difieren a propósito: si el código tomara el equivocado, este test
    // lo dice. Es el caso del override al alza (D26), donde ofertado > cotizado.
    const { svc, item } = fakeDb({
      offerSentAt: OFFER_SENT,
      offeredPriceCents: 63_500,
      quotedPriceCents: 50_000,
    });
    const res: any = await svc.itemDecision('sri-1', 'approve');
    expect(res.itemStatus).toBe('aprobada');
    expect(res.approvedPriceCents).toBe(63_500);
    expect(item.approvedPriceCents).toBe(63_500);
  });

  it('FUERA del ciclo (`offerSentAt IS NULL`) la vía de ajuste sigue viva: la cohorte legacy la necesita', async () => {
    // §4.39b.3: apagar la salida el día que se apaga la entrada dejaría a un vendedor con un ajuste
    // vivo y **sin forma de aceptar un dinero que ya le propusimos**.
    const { svc, item, request } = fakeDb({ offerSentAt: null });
    const res: any = await svc.itemDecision('sri-1', 'adjust', 30_000);
    expect(res.itemStatus).toBe('ajustada');
    expect(item.approvedPriceCents).toBe(30_000);
    expect(request.adjustmentSentAt).not.toBeNull();
  });

  it('FUERA del ciclo, `approve` con monto explícito sigue aceptándose (sin cambios)', async () => {
    const { svc, item } = fakeDb({ offerSentAt: null });
    const res: any = await svc.itemDecision('sri-1', 'approve', 45_000);
    expect(res.approvedPriceCents).toBe(45_000);
    expect(item.approvedPriceCents).toBe(45_000);
  });

  it('`reject` SÍ existe en el ciclo, y NO lo gatea el eje (D30: es el rechazo PARCIAL)', async () => {
    const { svc, item } = fakeDb({ offerSentAt: OFFER_SENT, offeredPriceCents: 63_500 });
    const res: any = await svc.itemDecision('sri-1', 'reject', undefined, 'no es NM: whitening');
    expect(res.itemStatus).toBe('rechazada');
    // *Al rechazar una carta no baja el precio: baja el número de líneas compradas.*
    expect(item.approvedPriceCents).toBeNull();
    expect(item.rejectionReason).toBe('no es NM: whitening');
  });

  it('⚠️ PRECEDENCIA v1.51.20: `adjust` CON monto ⇒ gana el `409` del VERBO, no el `422` del CAMPO', async () => {
    // Escalada 3, resuelta por el arquitecto **al revés de lo que implementé primero**. Criterio: *de
    // lo que anula el ACTO ENTERO a lo que objeta un CAMPO*. Con el `422` delante, el operador lee
    // «ese campo no se toca» ⇒ lo quita y reintenta ⇒ **choca igual con el `409`**. Dos errores para
    // una causa, y el primero apunta al remedio equivocado.
    const { svc, item, request, writes } = fakeDb({ offerSentAt: OFFER_SENT, offeredPriceCents: 63_500 });
    await expect(svc.itemDecision('sri-1', 'adjust', 9_900)).rejects.toMatchObject({
      code: 'ADJUST_NOT_ALLOWED_IN_OFFER_CYCLE',
      details: { status: 'verificacion' },
    });
    expect(item.itemStatus).not.toBe('ajustada');
    expect(request.adjustmentSentAt).toBeNull();
    expect(writes).toEqual([]);
  });

  it('⚠️ PRECEDENCIA: sobre una TERMINAL gana `409 NO_LIVE_ADJUSTMENT`, aunque las dos apliquen', async () => {
    // *Una solicitud cerrada no se discute por el monto: no se toca.* El contrato lo fija explícito.
    const { svc, writes } = fakeDb({
      status: 'pagada',
      offerSentAt: OFFER_SENT,
      offeredPriceCents: 63_500,
    });
    await expect(svc.itemDecision('sri-1', 'adjust', 9_900)).rejects.toMatchObject({
      code: 'NO_LIVE_ADJUSTMENT',
      details: { status: 'pagada' },
    });
    expect(writes).toEqual([]);
  });

  describe('⚠️ v1.51.20 — `approve` sobre una línea que NO COMPRAMOS (escalada 2)', () => {
    // El dictamen del arquitecto en una frase: con el `?? 0` la línea quedaba **`aprobada`**, que es
    // (1) el ÚNICO estado que `convert-to-inventory` admite ⇒ **una carta que nunca compramos entraba
    // al inventario VENDIBLE con costo 0** (100 % de margen sobre mercancía ajena), y (2) el estado
    // que la **saca de §H** ⇒ el reloj de devolución del vendedor **no arrancaba nunca**.
    // *Aquí ni siquiera falta un dato: la línea NO SE COMPRÓ, y el número correcto no es `0` — es que
    // la operación no exista.*

    it('línea `skip` ⇒ 422 ITEM_NOT_OFFERED, y NO llega a `aprobada`', async () => {
      const { svc, item, writes } = fakeDb({
        offerSentAt: OFFER_SENT,
        offerDecision: 'skip',
        offeredPriceCents: null, // `skip` NUNCA lleva monto (§11, por diseño)
      });
      await expect(svc.itemDecision('sri-1', 'approve')).rejects.toMatchObject({
        code: 'ITEM_NOT_OFFERED',
        details: { itemId: 'sri-1', offerDecision: 'skip' },
      });
      // ⚠️ LA aserción que justifica el código: `aprobada` es la puerta de la conversión.
      expect(item.itemStatus).not.toBe('aprobada');
      expect(item.approvedPriceCents).toBeNull();
      expect(writes).toEqual([]);
    });

    it('línea SIN decisión (`null`) en una oferta ya emitida ⇒ 422 ITEM_NOT_OFFERED', async () => {
      const { svc, item, writes } = fakeDb({
        offerSentAt: OFFER_SENT,
        offerDecision: null,
        offeredPriceCents: null,
      });
      await expect(svc.itemDecision('sri-1', 'approve')).rejects.toMatchObject({
        code: 'ITEM_NOT_OFFERED',
        details: { itemId: 'sri-1', offerDecision: null },
      });
      expect(item.itemStatus).not.toBe('aprobada');
      expect(writes).toEqual([]);
    });

    it('la vía CORRECTA sobre una `skip` es `reject` con motivo — y sigue funcionando', async () => {
      // *El remedio no es aprobarla más barata.* `reject` ancla `rejectedAt`, que es el ancla ÚNICA
      // de los plazos 7d/30d de §H y lo que dispara el correo por carta.
      const { svc, item } = fakeDb({
        offerSentAt: OFFER_SENT,
        offerDecision: 'skip',
        offeredPriceCents: null,
      });
      const res: any = await svc.itemDecision('sri-1', 'reject', undefined, 'llegó sin haber sido ofertada');
      expect(res.itemStatus).toBe('rechazada');
      expect(item.rejectedAt).not.toBeNull();
    });

    it('línea `buy` SIN `offeredPriceCents` ⇒ 500 OFFERED_PRICE_MISSING (backstop, no culpa del operador)', async () => {
      // Viola el invariante que la emisión garantiza SIN EXCEPCIÓN. Es `500` a propósito: el operador
      // no lo causó y no puede resolverlo. **Si dispara, se arregla el bug — no se paga un `0`.**
      const { svc, item, writes } = fakeDb({
        offerSentAt: OFFER_SENT,
        offerDecision: 'buy',
        offeredPriceCents: null,
      });
      await expect(svc.itemDecision('sri-1', 'approve')).rejects.toMatchObject({
        code: 'OFFERED_PRICE_MISSING',
        details: { itemId: 'sri-1' },
      });
      expect(item.approvedPriceCents).toBeNull();
      expect(writes).toEqual([]);
    });
  });

  it('⚠️ `OFFER_PRICE_IMMUTABLE` es regla del CUERPO, no del VERBO ⇒ aplica también con `reject`', async () => {
    // Precisión del arquitecto que evita una cuarta escalada. No contradice que `reject` siga siendo
    // legal a los dos lados del eje: **lo que se rechaza es el CUERPO, no el verbo**.
    // *Aceptar-e-ignorar un campo de dinero entrena al integrador a mandarlo, y el día que el verbo
    // cambie empieza a tener efecto.*
    const { svc, item, writes } = fakeDb({ offerSentAt: OFFER_SENT, offeredPriceCents: 63_500 });
    await expect(
      svc.itemDecision('sri-1', 'reject', 9_900, 'no es NM: whitening'),
    ).rejects.toMatchObject({
      code: 'OFFER_PRICE_IMMUTABLE',
      details: { itemId: 'sri-1', offeredPriceCents: 63_500 },
    });
    expect(item.itemStatus).not.toBe('rechazada');
    expect(writes).toEqual([]);
  });

  describe('la guarda del MOTOR: un `if` sobre la lectura previa no basta (TOCTOU)', () => {
    it('si la oferta se emite ENTRE la lectura y la escritura, `adjust` NO prospera', async () => {
      // El pre-check ve `offerSentAt: null` (lectura vieja) y deja pasar; la fila REAL ya está en el
      // ciclo, así que el `where` no casa y `count !== 1`. Sin la guarda en el `where`, este `adjust`
      // habría escrito sobre una oferta vinculante.
      const { svc, item, request, writes } = fakeDb({
        offerSentAt: OFFER_SENT,
        staleOfferSentAtForRead: null,
      });
      await expect(svc.itemDecision('sri-1', 'adjust', 9_900)).rejects.toMatchObject({
        code: 'ADJUST_NOT_ALLOWED_IN_OFFER_CYCLE',
      });
      expect(item.itemStatus).not.toBe('ajustada');
      expect(request.adjustmentSentAt).toBeNull();
      expect(writes).toEqual([]);
    });

    it('si la oferta se emite ENTRE la lectura y la escritura, `approve` con monto tampoco escribe', async () => {
      const { svc, item, writes } = fakeDb({
        offerSentAt: OFFER_SENT,
        staleOfferSentAtForRead: null,
      });
      await expect(svc.itemDecision('sri-1', 'approve', 9_900)).rejects.toMatchObject({
        code: 'OFFER_PRICE_IMMUTABLE',
      });
      expect(item.approvedPriceCents).toBeNull();
      expect(writes).toEqual([]);
    });
  });
});
