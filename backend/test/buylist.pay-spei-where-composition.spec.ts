import { ConfigService } from '@nestjs/config';
import { SellRequestStatus } from '@prisma/client';
import { BuylistService } from '../src/modules/buylist/buylist.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { UsersService } from '../src/modules/users/users.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { BusinessException } from '../src/common/business.exception';
import { isPayableSellRequest } from '../src/common/sell-request-states';
import {
  Row,
  clavesDeFragmentos,
  clavesPlanas,
  matchesWhere,
} from './helpers/prisma-where';

/**
 * `buylist.pay-spei-where-composition.spec.ts` — **v1.61.1 · `B1`: EL `where` QUE DE VERDAD SE LE
 * PASA A `updateMany`.** Propiedad: backend. `API_CONTRACT` §M5-V (V-a) · §M5-T · §M5-P · B-2.
 *
 * ### El defecto, y por qué ninguna prueba lo vio
 * El `where` del `updateMany` que mueve el dinero se componía así:
 *
 * ```js
 * where: {
 *   id,
 *   ...this.payableWhere(),                       // aporta `approvedTotalCents: { not: null }` ← V-a
 *   paidAt: null, closedAt: null,
 *   approvedTotalCents: fresh.approvedTotalCents, // ⇐ clave POSTERIOR: PISA a la del spread
 *   …
 * }
 * ```
 *
 * En un objeto literal de JavaScript **la clave posterior gana sobre el spread**, así que V-a **no
 * llegaba al motor**. Y el caso malo no es teórico: si `fresh.approvedTotalCents` es `null`, el
 * `where` compuesto queda `approvedTotalCents IS NULL` — casa **exactamente la fila que V-a existe
 * para rechazar** ⇒ `count === 1` y se paga `max(0, offerGross − fee)` **por CERO cartas**. Es
 * `BL-45` reentrando por la ventana B-2 (entre el pre-check y la relectura corre
 * `itemDecision(reject)`, que **no es `Serializable`**, así que el SSI no arbitra).
 *
 * ### Y lo que lo volvió invisible
 * El **assert 9** de §M5-V.8 cruza el predicado con **`payableWhere()` AISLADA**, donde el término
 * sí está: verde con la guarda ausente del `where` real. *Una prueba que mira el ayudante no puede
 * ver lo que la composición tira.* **Por eso esta suite no toca `payableWhere()`: captura el objeto
 * que el servicio le pasó a `updateMany` y lo evalúa como lo evaluaría el motor.**
 *
 * ### La mutación que esta suite tiene que tumbar
 * | Mutación | Test que cae |
 * |---|---|
 * | quitar V-a del **`where`** (dejando el predicado intacto) | «B1 · LA VENTANA …» **y** «la MUTACIÓN, ejecutada …» |
 * | volver a componer con **spread** en vez de `AND` | «⛔ ninguna clave plana …» + las dos de arriba |
 * | escribir V-a como `{ gt: 0 }` | «el DEPÓSITO DE CERO de D40 …» |
 * | perder `paidAt`/`closedAt` (§M5-T) o una columna del CAS (B-2) | «cada término … frena por sí solo» |
 * | una guarda que **nunca pague** (el falso verde) | «el camino feliz …» |
 */

const pii = new PiiCryptoService(new ConfigService({}));

const RECIBIDA = new Date('2026-09-02T00:00:00Z');
const VERIFICADA = new Date('2026-09-03T00:00:00Z');

/** Fila **completa**: el evaluador lanza si el `where` afirma sobre una columna que no está. */
function baseRow(over: Row = {}): Row {
  return {
    id: 'sr-1',
    userId: 'u1',
    status: 'verificacion' as SellRequestStatus,
    receivedAt: RECIBIDA,
    verifiedAt: VERIFICADA,
    paidAt: null,
    closedAt: null,
    speiReference: null,
    paidBy: null,
    payoutNetCents: null,
    approvedTotalCents: 40_000,
    offerGrossCents: 90_000,
    quotedTotalCents: 50_000,
    offerShippingFeeCents: 18_000,
    offerSentAt: new Date('2026-09-01T00:00:00Z'),
    createdAt: new Date('2026-09-01T00:00:00Z'),
    items: [],
    user: null,
    ...over,
  };
}

/**
 * Prisma de mentira con **UNA fila mutable** que **evalúa el `where` real** de cada `updateMany`.
 *
 * `staleFirstRead` hace que **solo la PRIMERA lectura** (la del pre-check) vea una fila distinta de
 * la que el `updateMany` va a tocar: eso **es** la ventana B-2 —la fila cambió entre la lectura y la
 * escritura— y es el único modo de comprobar que el `where` frena **por sí mismo**, sin que el
 * pre-check lo tape. Las lecturas posteriores (`fresh` y el backstop del `!paid`) ven el estado
 * nuevo, como en una carrera real.
 */
function harness(row: Row, opts: { staleFirstRead?: Row } = {}) {
  const state: Row = { ...row };
  const writes: { where: Row; data: Row }[] = [];
  let reads = 0;

  const prisma: any = {
    sellRequest: {
      findUnique: jest.fn(async () => ({
        ...state,
        ...(reads++ === 0 ? (opts.staleFirstRead ?? {}) : {}),
      })),
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

/** La escritura que MUEVE EL ESTADO (el único `updateMany` de `paySpei`). */
const statusWrite = (writes: { where: Row; data: Row }[]) => writes.find((w) => 'status' in w.data);

/**
 * **LA MUTACIÓN, COMO FUNCIÓN.** Quita de un `where` ya compuesto el término V-a
 * (`approvedTotalCents: { not: null }`) **sin tocar el CAS** (que es un escalar sobre la misma
 * columna). Es exactamente el borrado que el techlead pide demostrar, ejecutado en proceso sobre el
 * objeto que el servicio produjo — no sobre una copia escrita a mano.
 */
function sinVa(where: Row): Row {
  const esVa = (c: unknown) =>
    c !== null && typeof c === 'object' && !(c instanceof Date) && (c as Row).not === null;
  const limpia = (f: Row): Row =>
    esVa(f.approvedTotalCents)
      ? Object.fromEntries(Object.entries(f).filter(([k]) => k !== 'approvedTotalCents'))
      : f;
  const raiz = limpia(where);
  return where.AND ? { ...raiz, AND: (where.AND as Row[]).map(limpia) } : raiz;
}

// =================================================================================================
describe('⚠️⚠️ B1 — la ventana B-2 con el aprobado en `null`: `BL-45` por la puerta de la carrera', () => {
  /**
   * La fila que la carrera produce, y **es alcanzable**: `recomputeApprovedTotal` escribe `null`
   * cuando ninguna línea tiene `approvedPriceCents`, y su guarda deja pasar `verificacion`. El
   * pre-check ve el aprobado de antes del `reject`; el motor ve el `null`.
   */
  const carrera = () =>
    harness(
      baseRow({ approvedTotalCents: null, offerGrossCents: 90_000, offerShippingFeeCents: 18_000 }),
      { staleFirstRead: { approvedTotalCents: 40_000 } },
    );

  it('B1 · LA VENTANA: el aprobado se vuelve `null` entre el pre-check y la escritura ⇒ NO SALE UN PESO', async () => {
    const h = carrera();
    const err = await h.svc.paySpei('sr-1', 'SPEI-B1-CARRERA', 'admin').catch((e) => e);

    // El pre-check PASÓ (por eso la transacción se abrió y el `updateMany` corrió): lo que frena es
    // el `where`, que es justo lo que hay que probar.
    expect(statusWrite(h.writes)).toBeDefined();
    expect(err).toBeInstanceOf(BusinessException);
    // Y lo único que de verdad importa: la fila **no se movió**.
    expect(h.state.status).toBe('verificacion');
    expect(h.state.paidAt).toBeNull();
    expect(h.state.closedAt).toBeNull();
    expect(h.state.speiReference).toBeNull();
    // 72_000 = 90_000 − 18_000: **el importe que el defecto pagaba por CERO cartas.**
    expect(h.state.payoutNetCents).toBeNull();
  });

  it('⚠️⚠️ la MUTACIÓN, ejecutada sobre el objeto REAL: sin V-a en el `where`, la fila CASA', async () => {
    // *Si quitar la guarda no pone nada rojo, la guarda es código muerto.* Aquí el borrado no se
    // simula con un `where` escrito a mano: se aplica **al objeto que el servicio le pasó a
    // `updateMany`**, y las dos evaluaciones se comparan.
    const h = carrera();
    await h.svc.paySpei('sr-1', 'SPEI-B1-MUT', 'admin').catch(() => undefined);
    const w = statusWrite(h.writes)!.where;
    const mutado = sinVa(w);

    // Control anti-vacuidad: la mutación tiene que haber QUITADO algo. Si `sinVa` fuese un no-op
    // (porque alguien sacó V-a del `where`), este assert lo dice antes que ningún otro.
    expect(JSON.stringify(mutado)).not.toEqual(JSON.stringify(w));
    // Con V-a: la fila NO casa ⇒ `count = 0` ⇒ no se paga.
    expect(matchesWhere(h.state, w)).toBe(false);
    // Sin V-a: la fila SÍ casa ⇒ `count = 1` ⇒ se pagaría. **Ése era el agujero.**
    expect(matchesWhere(h.state, sinVa(w))).toBe(true);
  });

  it('⛔ ninguna clave plana del `where` compuesto pisa una de un fragmento (la regla de B1)', async () => {
    // La causa raíz no fue «faltó un término»: fue **componer con spread**. Un spread no avisa
    // cuando lo pisan; un `AND` no puede pisar. Esta regla es general y no depende de qué términos
    // haya hoy: *los fragmentos compartidos entran por `AND`; lo plano es solo lo que nadie más
    // reclama.*
    const h = harness(baseRow());
    await h.svc.paySpei('sr-1', 'SPEI-FORMA', 'admin');
    const w = statusWrite(h.writes)!.where;
    expect(clavesPlanas(w)).toEqual(['id']);
    expect(clavesPlanas(w).filter((k) => clavesDeFragmentos(w).includes(k))).toEqual([]);
    // Y hay fragmentos de verdad (si alguien los aplanase, lo de arriba pasaría por vacuidad).
    expect(clavesDeFragmentos(w)).toEqual(
      expect.arrayContaining(['status', 'receivedAt', 'verifiedAt', 'approvedTotalCents']),
    );
  });
});

// =================================================================================================
describe('§M5-V.8 assert 9 — la paridad, pero sobre el `where` COMPUESTO (no sobre `payableWhere()`)', () => {
  const ESTADOS = Object.values(SellRequestStatus);

  it('ninguna fila que `isPayableSellRequest` rechaza puede casar el `where` que corrió', async () => {
    // ⚠️ El `where` se captura de la corrida de la **carrera**, donde el CAS del aprobado vale
    // `null`. No es un detalle: con un CAS de `40_000` el propio CAS rechazaría el eje
    // `approvedTotalCents = null` y **taparía a V-a**, que es la forma en que este barrido se
    // volvería verde con la guarda ausente. *El barrido tiene que mirar el eje sin máscara.*
    const h = harness(
      baseRow({ approvedTotalCents: null }),
      { staleFirstRead: { approvedTotalCents: 40_000 } },
    );
    await h.svc.paySpei('sr-1', 'SPEI-ASSERT9', 'admin').catch(() => undefined);
    const w = statusWrite(h.writes)!.where;

    for (const status of ESTADOS) {
      for (const receivedAt of [null, RECIBIDA]) {
        for (const verifiedAt of [null, VERIFICADA]) {
          for (const approvedTotalCents of [null, 0, 50_000]) {
            const fila = baseRow({ status, receivedAt, verifiedAt, approvedTotalCents });
            if (isPayableSellRequest(fila as any)) continue;
            expect({
              status,
              r: !!receivedAt,
              v: !!verifiedAt,
              a: approvedTotalCents,
              casa: matchesWhere(fila, w),
            }).toEqual({
              status,
              r: !!receivedAt,
              v: !!verifiedAt,
              a: approvedTotalCents,
              casa: false,
            });
          }
        }
      }
    }
  });

  it('control anti-vacuidad: el `where` de una corrida normal SÍ casa su fila', async () => {
    // Sin esto, el barrido de arriba lo pasaría un `where` imposible (que no pagara nunca).
    const h = harness(baseRow());
    await h.svc.paySpei('sr-1', 'SPEI-CONTROL', 'admin');
    expect(matchesWhere(baseRow(), statusWrite(h.writes)!.where)).toBe(true);
  });
});

// =================================================================================================
describe('los DEMÁS términos del `where` compuesto siguen enteros (nadie tapa a nadie)', () => {
  /** Captura el `where` de una corrida que SÍ paga, y la fila con la que casó. */
  async function corridaFeliz(over: Row = {}) {
    const h = harness(baseRow(over));
    const res: any = await h.svc.paySpei('sr-1', 'SPEI-OK', 'admin');
    return { h, where: statusWrite(h.writes)!.where, res };
  }

  it('el camino feliz PAGA (sin esto, todo lo demás lo pasa un endpoint que no paga nunca)', async () => {
    const { h, res } = await corridaFeliz();
    expect(res.status).toBe('pagada');
    expect(h.state.speiReference).toBe('SPEI-OK');
    // 40_000 aprobado − 18_000 de envío congelado.
    expect(h.state.payoutNetCents).toBe(22_000);
  });

  it('⚠️ el DEPÓSITO DE CERO de D40 SÍ casa: V-a es `IS NOT NULL`, jamás `> 0`', async () => {
    // El error obvio de implementación de V-a es `{ gt: 0 }`. `approvedTotalCents = 0` **con líneas
    // decididas** es el depósito de cero del criterio 140 y **se paga** (y se cierra); `null` es
    // «nadie decidió nada» y no se paga. Este caso y el de B1 son el par que los distingue.
    const { h, res } = await corridaFeliz({ approvedTotalCents: 0 });
    expect(res.status).toBe('pagada');
    expect(h.state.payoutNetCents).toBe(0);
  });

  it.each([
    ['status (§M5-P/§4.39c)', { status: 'cotizada' as SellRequestStatus }],
    ['receivedAt (§M5-P)', { receivedAt: null }],
    ['verifiedAt (§M5-P)', { verifiedAt: null }],
    ['paidAt (§M5-T · P1)', { paidAt: new Date('2026-09-04T00:00:00Z') }],
    ['closedAt (§M5-T · P1)', { closedAt: new Date('2026-09-04T00:00:00Z') }],
    ['CAS approvedTotalCents (B-2)', { approvedTotalCents: 41_000 }],
    ['CAS offerGrossCents (B-2)', { offerGrossCents: 91_000 }],
    ['CAS quotedTotalCents (B-2)', { quotedTotalCents: 51_000 }],
    ['CAS offerShippingFeeCents (B-2)', { offerShippingFeeCents: 19_000 }],
    ['id', { id: 'otra-sr' }],
  ])('cada término frena por sí solo: mover %s ⇒ el `where` NO casa', async (_nombre, delta) => {
    // Se evalúa **el `where` que corrió** contra una fila que difiere en UNA columna. Que estén los
    // once términos no se afirma por su forma (un `toMatchObject` sobre claves planas dejó pasar B1
    // durante toda una versión): se afirma por lo que el motor haría con ellos.
    const { where } = await corridaFeliz();
    expect(matchesWhere(baseRow(delta), where)).toBe(false);
  });
});
