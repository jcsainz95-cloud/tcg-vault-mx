import { ConfigService } from '@nestjs/config';
import { Prisma, SellRequestStatus } from '@prisma/client';
import { BuylistService, TransactionOnlyClient } from '../src/modules/buylist/buylist.service';
import { AdminBuylistController } from '../src/modules/buylist/admin-buylist.controller';
import { AuditService } from '../src/modules/audit/audit.service';
import { Role } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { UsersService } from '../src/modules/users/users.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { BusinessException } from '../src/common/business.exception';
import {
  isPayableSellRequest,
  SELL_REQUEST_PAYABLE_STATES,
} from '../src/common/sell-request-states';
// ⚠️ v1.61.1 · B1 — el evaluador es COMPARTIDO y entiende `AND`/`OR`/`NOT`. El local de esta suite
// no sabía leer un fragmento conjugado, y por eso el `where` de `pay-spei` sólo se podía aseverar
// aquí por la FORMA de sus claves planas — que es exactamente por donde se coló B1.
import { matchesCond, matchesWhere } from './helpers/prisma-where';

/**
 * `buylist.m5p-received-guard.spec.ts` — **INVARIANTE P (API_CONTRACT §M5-P, v1.57): «NO SE PAGA LO
 * QUE NO HA LLEGADO».** Cierre de **BL-35 eje 2**; hermana de `buylist.m5t-terminal-guard.spec.ts`.
 *
 * ### El defecto que reproduce, medido en vivo por DOS roles independientes
 * `isPayable` tenía **dos** términos (`status ∈ PAYABLE ∧ verifiedAt IS NOT NULL`) y **`verify` es el
 * único verbo que escribe `verifiedAt`** ⇒ alcanzarlo **desde cualquier estado vivo** volvía pagable
 * la solicitud. Seguridad liquidó **SPEI real por MX$320** sobre una `ofertada` (`acceptedAt=null`,
 * `receivedAt=null`) tras un `verify` de `vault_operator`; QA lo reprodujo desde una `cotizada`
 * recién creada (`QA-BL35-EJE2`). **`PROJECT.md:1107` (b)** lo prohíbe en negrita: *«el pago se
 * realiza DESPUÉS de que recibimos y verificamos la carta»*.
 *
 * ### ⚠️⚠️ POR QUÉ ESTE FICHERO TIENE UN PRISMA QUE **EVALÚA EL `where`**
 * Un doble que responde `{ count: 1 }` a cualquier `updateMany` **pasa igual con la guarda puesta y
 * con la guarda quitada**: lo único que la guarda cambia es el `where`. Aquí el fake **filtra la fila
 * por el `where` real**, y `count` es el resultado de esa evaluación. *Un test que no puede fallar
 * por la razón por la que el sistema falla no es cobertura: es decoración.*
 *
 * ### Las mutaciones que esta suite tiene que tumbar
 * El término se escribe en **DOS** sitios (el cuerpo y su traducción a `where`) y lo leen **CUATRO**:
 * pre-check, CAS, proyección y el **backstop de carrera**. *Que dos de los cuatro hereden en vez de
 * ser sitios más que tocar es la señal de que la forma es la correcta.*
 *
 * | Mutación | Test que cae |
 * |---|---|
 * | quitar `receivedAt` de **`isPayableSellRequest`** (el cuerpo) | «el PoC de eje 2 … ⇒ 422 y CERO escritura» |
 * | quitar `receivedAt` de **`payableWhere()`** (la traducción) | «⚠️ LA CARRERA …» |
 * | regresar **la proyección** a la fórmula de dos términos | `buylist.is-payable-live.spec.ts` › «la tabla de verdad COMPLETA» |
 * | que el **backstop de carrera** deje de heredar | «⚠️ LA CARRERA …» (el `code` esperado cambia a `CONFLICT`) |
 * | borrar cualquiera de los pre-checks de `paySpei` | «no abre la transacción SERIALIZABLE» |
 * | una guarda que **nunca pague** (el falso verde) | «EL CAMINO FELIZ COMPLETO — `receive` → `verify` → `pay-spei`» |
 */

const pii = new PiiCryptoService(new ConfigService({}));

type Row = Record<string, any>;

const RECIBIDA = new Date('2026-09-02T00:00:00Z');
const VERIFICADA = new Date('2026-09-03T00:00:00Z');
/** Todo lo que NO es pagable: el complemento se deriva de la constante, no se enumera a mano. */
const ALL_NO_PAGABLES = Object.values(SellRequestStatus).filter(
  (s) => !(SELL_REQUEST_PAYABLE_STATES as readonly SellRequestStatus[]).includes(s),
);

function baseRow(over: Row = {}): Row {
  return {
    id: 'sr-1',
    userId: 'u1',
    status: 'verificacion' as SellRequestStatus,
    closedAt: null,
    paidAt: null,
    receivedAt: RECIBIDA,
    verifiedAt: VERIFICADA,
    speiReference: null,
    paidBy: null,
    quotedTotalCents: 50_000,
    approvedTotalCents: 40_000,
    offerGrossCents: null,
    offerShippingFeeCents: null,
    payoutNetCents: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    items: [],
    user: null,
    ...over,
  };
}


/**
 * Prisma de mentira con **UNA fila mutable** que **evalúa el `where`** de cada `updateMany`.
 *
 * `staleFirstRead` existe para una sola cosa y es la que prueba la guarda **sola**: hace que **la
 * PRIMERA lectura** (la del pre-check) vea una fila distinta de la que el `updateMany` va a tocar.
 * Eso es literalmente una **carrera** — la fila cambió entre la lectura y la escritura — y es el
 * único modo de comprobar que el término del `where` frena por sí mismo, sin que el pre-check lo tape.
 *
 * ⚠️ **Solo la PRIMERA**, y el detalle no es cosmético: en una carrera real las lecturas posteriores
 * (la del `fresh` dentro de la tx y la del backstop del `!paid`) ven **el estado nuevo**. Un
 * `readView` pegado a todas las lecturas haría que el backstop también viera la fila vieja y
 * respondiera *«el monto cambió»* — un falso verde que escondería justo el lector que hay que probar.
 */
function harness(row: Row, opts: { staleFirstRead?: Row } = {}) {
  const state: Row = { ...row };
  const writes: { where: Row; data: Row }[] = [];
  let reads = 0;
  const evalWhere = (where: Row): boolean => matchesWhere(state, where);

  const prisma: any = {
    sellRequest: {
      findUnique: jest.fn(async () => ({
        ...state,
        ...(reads++ === 0 ? (opts.staleFirstRead ?? {}) : {}),
      })),
      findMany: jest.fn(async () => []),
      updateMany: jest.fn(async ({ where, data }: { where: Row; data: Row }) => {
        writes.push({ where, data });
        if (!evalWhere(where)) return { count: 0 };
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

/** La escritura que MUEVE EL ESTADO (no el sellado de fecha, que va en su propio `updateMany`). */
const statusWrite = (writes: { where: Row; data: Row }[]) => writes.find((w) => 'status' in w.data);

// =================================================================================================
describe('⚠️⚠️ §M5-P · BL-35 eje 2 — el PoC: pagar mercancía que NUNCA LLEGÓ', () => {
  /**
   * La fila **exacta** que el PoC dejó en BD: `verify` la puso en un estado pagable y le selló
   * `verifiedAt`, pero **`receive` nunca corrió** ⇒ `receivedAt IS NULL`. Sobre ésta salieron MX$320.
   */
  const NUNCA_RECIBIDA = (over: Row = {}) => baseRow({ receivedAt: null, ...over });

  it.each(SELL_REQUEST_PAYABLE_STATES.map((s) => [s]))(
    'estado pagable `%s` + `verifiedAt` sellado + `receivedAt` NULO ⇒ 422 y CERO escritura',
    async (status) => {
      const h = harness(NUNCA_RECIBIDA({ status }));
      const err = await h.svc.paySpei('sr-1', 'SPEI-EJE2-NEVER-ARRIVED-001', 'admin').catch((e) => e);
      expect(err).toBeInstanceOf(BusinessException);
      expect(err.getResponse()).toMatchObject({
        code: 'VALIDATION_ERROR',
        message: 'Payment allowed only after receipt/verification and approval',
      });
      // Y lo que de verdad importa: **no salió un peso**.
      expect(h.state.status).toBe(status);
      expect(h.state.speiReference).toBeNull();
      expect(h.state.paidAt).toBeNull();
      expect(h.writes).toHaveLength(0);
    },
  );

  it('⚠️ LA CARRERA: si la recepción NO está al escribir, la GUARDA sola lo frena (sin el pre-check)', async () => {
    // El pre-check lee una fila **con** `receivedAt` (pasa), y la fila real **no lo tiene**. Es la
    // única forma de comprobar que `payableWhere()` frena por sí mismo: si alguien quita el término
    // del `where` y lo deja solo en el predicado, ESTE test paga y cae.
    const h = harness(NUNCA_RECIBIDA(), { staleFirstRead: { receivedAt: RECIBIDA } });
    const err = await h.svc.paySpei('sr-1', 'SPEI-CARRERA', 'admin').catch((e) => e);
    expect(err).toBeInstanceOf(BusinessException);
    // El pre-check pasó ⇒ se abrió la transacción y el `updateMany` corrió… y no casó ninguna fila.
    expect(statusWrite(h.writes)).toBeDefined();
    // ⚠️ v1.61.1 · **B1** — esto era `toMatchObject({ receivedAt: { not: null } })`, y una forma de
    // claves planas **no prueba que el término llegue al motor**: el `where` se compone de
    // fragmentos, y un fragmento se puede perder sin que su clave desaparezca del objeto. Se afirma
    // EVALUANDO el `where` que corrió: esta fila (sin recepción) no casa, y la misma fila CON
    // recepción sí — o sea, `receivedAt` es lo único que la rechaza.
    expect(matchesWhere(h.state, statusWrite(h.writes)!.where)).toBe(false);
    expect(matchesWhere({ ...h.state, receivedAt: RECIBIDA }, statusWrite(h.writes)!.where)).toBe(true);
    expect(h.state.status).toBe('verificacion');
    expect(h.state.speiReference).toBeNull();
    expect(h.state.paidAt).toBeNull();
    // ⚠️⚠️ **LECTOR 4 — EL BACKSTOP DE CARRERA HEREDA, y este assert es la prueba.** La rama del
    // `!paid` decide entre *«el monto se movió, vuelve a mirarlo»* y *«no es pagable»* invocando
    // `isPayableSellRequest(current)`. Si el término NO hubiera entrado por el cuerpo compartido,
    // esta fila parecería pagable y el súper-admin oiría **«el monto cambió; revísalo antes de
    // pagar»** — que lo manda a revisar lo único que está bien y lo empuja a reintentar el pago.
    expect(err.getResponse()).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Payment allowed only after receipt/verification and approval',
    });
  });

  it('el `where` del `updateMany` afirma LOS TRES términos, no dos — Y SE COMPRUEBA EVALUÁNDOLO', async () => {
    // ⚠️⚠️ v1.61.1 · **B1 — POR QUÉ ESTE TEST YA NO MIRA LA FORMA.** Antes hacía
    // `toMatchObject({ status, receivedAt, verifiedAt })` sobre las claves planas del `where`. Eso
    // pasa igual **aunque un fragmento se haya perdido en la composición**, que es literalmente lo
    // que ocurrió con V-a (`approvedTotalCents: { not: null }`): la clave seguía en el objeto, pero
    // con el valor del CAS, porque *en un objeto literal la clave posterior gana sobre el spread*.
    // Ahora se afirma lo que el motor haría: mover UN término ⇒ la fila deja de casar.
    // ⚠️ El eje `approvedTotalCents` (V-a) **no se puede medir aquí sin máscara** —el CAS de B-2 lo
    // taparía— y por eso vive en `buylist.pay-spei-where-composition.spec.ts`, con el `where` de una
    // corrida en la que el CAS vale `null`.
    const h = harness(baseRow());
    await h.svc.paySpei('sr-1', 'SPEI-OK', 'admin');
    const w = statusWrite(h.writes)!.where;
    const fila = baseRow({ status: 'verificacion' });
    expect(matchesWhere(fila, w)).toBe(true);
    for (const status of ALL_NO_PAGABLES) {
      expect({ status, casa: matchesWhere(baseRow({ status }), w) }).toEqual({ status, casa: false });
    }
    expect(matchesWhere(baseRow({ receivedAt: null }), w)).toBe(false);
    expect(matchesWhere(baseRow({ verifiedAt: null }), w)).toBe(false);
  });

  it('el camino feliz NO se rompe: recibida + verificada SÍ liquida', async () => {
    // Si esto cae, el término es demasiado ancho. Medido antes de ponerlo: `receivedAt` lo escribe
    // **un solo sitio** (`receive` → `sealOnceTx`), ninguna ruta lo limpia, y en BD local las únicas
    // filas con `verifiedAt ∧ receivedAt IS NULL` son **exactamente los dos PoC**.
    const h = harness(baseRow());
    const res: any = await h.svc.paySpei('sr-1', 'SPEI-OK', 'admin');
    expect(res.status).toBe('pagada');
    expect(h.state.speiReference).toBe('SPEI-OK');
    expect(h.state.payoutNetCents).toBe(40_000);
  });

  it('⚠️⚠️ EL CAMINO FELIZ COMPLETO — `receive` → `verify` → `pay-spei` **PAGA** (§M5-P assert 4)', async () => {
    // *Sin este assert, los tres anteriores los pasa igual un endpoint que no paga NUNCA.* Se
    // encadenan los tres verbos sobre la MISMA fila del harness (que evalúa cada `where` de verdad),
    // arrancando desde `en_transito` sin ninguna fecha sellada — el estado en que la mesa recibe un
    // paquete de verdad.
    const h = harness(
      baseRow({ status: 'en_transito', receivedAt: null, verifiedAt: null, approvedTotalCents: 40_000 }),
    );
    await h.svc.receive('sr-1');
    expect(h.state.status).toBe('recibida');
    expect(h.state.receivedAt).toBeInstanceOf(Date);

    await h.svc.verify('sr-1');
    expect(h.state.status).toBe('verificacion');
    expect(h.state.verifiedAt).toBeInstanceOf(Date);

    const res: any = await h.svc.paySpei('sr-1', 'SPEI-CAMINO-FELIZ', 'admin');
    expect(res.status).toBe('pagada');
    expect(res.isPayable).toBe(false); // ya es terminal: la señal deja de ofrecer el botón
    expect(h.state.speiReference).toBe('SPEI-CAMINO-FELIZ');
    expect(h.state.payoutNetCents).toBe(40_000);
  });

  it('⚠️ y sin el `receive`, la MISMA cadena NO paga: `verify` solo ya no basta', async () => {
    // El contraste que le da valor al assert de arriba: idéntica fila, idéntico `verify`, y lo único
    // que falta es el paso que declara que el paquete llegó.
    const h = harness(
      baseRow({ status: 'en_transito', receivedAt: null, verifiedAt: null, approvedTotalCents: 40_000 }),
    );
    await h.svc.verify('sr-1');
    expect(h.state.status).toBe('verificacion');
    await expect(h.svc.paySpei('sr-1', 'SPEI-NO', 'admin')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(h.state.paidAt).toBeNull();
  });

  it('⚠️ NO se exige `acceptedAt` (cuarto término): rompería la cohorte pre-M-46', async () => {
    // Los dos PoC también tenían `acceptedAt = null`, y **aun así el cuarto término no se añade**:
    // la cohorte legacy (`offerSentAt IS NULL`) alcanza `recibida`/`verificacion` sin aceptación
    // registrada — es la misma que `brutoConsumado` contempla con su rama `quotedTotalCents`— y ese
    // término la dejaría **impagable**. El contrato lo dice explícito (v1.57 §C): no se inventa la
    // matriz de predecesores. *Se cierra la salida de dinero, no el eje entero.*
    // ⚠️ v1.61 · §M5-V — la fila legacy lleva bruto **aprobado** (V-a aplica a TODA fila, sin versión
    // legacy: *sin nada aprobado no hay nada que pagar, en ningún régimen*). Lo que este caso mide
    // sigue siendo lo mismo: que **`acceptedAt` no es término** y la cohorte pre-M-46 se paga.
    const h = harness(
      baseRow({
        acceptedAt: null,
        offerSentAt: null,
        approvedTotalCents: 30_000,
        quotedTotalCents: 30_000,
      }),
    );
    const res: any = await h.svc.paySpei('sr-1', 'SPEI-LEGACY', 'admin');
    expect(res.status).toBe('pagada');
    expect(h.state.payoutNetCents).toBe(30_000);
  });
});

// =================================================================================================
describe('§M5-P · el aviso de la UI y la guarda del motor NO pueden discrepar (TRES lectores, UNA regla)', () => {
  const ALL = Object.values(SellRequestStatus);

  // ⚠️⚠️ v1.61 · §M5-V.8 assert 9 — el barrido gana el CUARTO eje: `approvedTotalCents ∈ {null, 0, n}`.
  // Los tres valores son necesarios: `null` y `0` son los dos que la implementación ingenua confunde
  // (`> 0` en vez de `!= null`), y `n` es el control.
  it('`isPayableSellRequest` ≡ `payableWhere()` en TODO el enum × `receivedAt` × `verifiedAt` × `approvedTotalCents`', async () => {
    const svc = harness(baseRow()).svc as unknown as { payableWhere(): Row };
    const w = svc.payableWhere();
    for (const status of ALL) {
      for (const receivedAt of [null, RECIBIDA]) {
        for (const verifiedAt of [null, VERIFICADA]) {
          for (const approvedTotalCents of [null, 0, 50000]) {
            const fila = { status, receivedAt, verifiedAt, approvedTotalCents };
            const porElWhere = Object.entries(w).every(([k, cond]) =>
              matchesCond(fila[k as keyof typeof fila], cond),
            );
            expect({ status, r: !!receivedAt, v: !!verifiedAt, a: approvedTotalCents, porElWhere }).toEqual({
              status,
              r: !!receivedAt,
              v: !!verifiedAt,
              a: approvedTotalCents,
              porElWhere: isPayableSellRequest(fila),
            });
          }
        }
      }
    }
  });

  it('⚠️ `isPayable` GOBIERNA EL BOTÓN DE PAGAR: la señal miente si le falta el término', async () => {
    // Arreglar la guarda y no la señal deja al `super_admin` que autoriza tomando la decisión con
    // información falsa: la pantalla le pintaría «lista para pagar» una carta que nunca llegó.
    // El DTO admin sale de `adminSellRequestDTO`, que **invoca el mismo cuerpo** (§4.39c sitio 10).
    for (const status of SELL_REQUEST_PAYABLE_STATES) {
      expect(
        isPayableSellRequest({ status, receivedAt: null, verifiedAt: VERIFICADA, approvedTotalCents: 50000 }),
      ).toBe(false);
      expect(
        isPayableSellRequest({ status, receivedAt: RECIBIDA, verifiedAt: VERIFICADA, approvedTotalCents: 50000 }),
      ).toBe(true);
    }
  });
});

// =================================================================================================
/**
 * ⚠️ **GUARDA DE TIPOS (BL-25) — no corre en runtime: la comprueba `tsc`, y ése es el punto.**
 * `sealOnceTx` es silenciosa (`count === 0` ⇒ no pasa nada) y eso solo es aceptable si el llamador
 * **mantiene el row lock dentro de la transacción**. Con la firma vieja
 * (`SellRequestReader = Pick<Prisma.TransactionClient,'sellRequest'>`) `sealOnceTx(this.prisma, …)`
 * **compilaba**, anulando en silencio el argumento del propio docstring.
 *
 * ⚠️ Y `Prisma.TransactionClient` **a secas tampoco basta** (medido): es `Omit<PrismaClient, …>`, y
 * un supertipo con miembros de más sigue siendo asignable a un `Omit`. Estas dos líneas fijan la
 * discriminación real: si alguien relaja `TransactionOnlyClient`, **el typecheck cae**.
 */
type NoAsignable<A, B> = A extends B ? never : true;
type SiAsignable<A, B> = A extends B ? true : never;
// (a) `PrismaService` NO puede pasar por un cliente transaccional…
const _prismaNoEsTx: NoAsignable<PrismaService, TransactionOnlyClient> = true;
// (b) …y el cliente transaccional REAL sí, o la firma sería inusable.
const _txSiEsTx: SiAsignable<Prisma.TransactionClient, TransactionOnlyClient> = true;
void _prismaNoEsTx;
void _txSiEsTx;

// =================================================================================================
describe('§M5-P · los pre-checks de `paySpei` NO son decorativos: cada uno ahorra la transacción', () => {
  /**
   * ⚠️ **Hallazgo de QA (pase v1.56):** borró el pre-check de `paidAt` y **las 244 suites siguieron
   * verdes**. No había bug —el CAS produce el mismo `409` con los mismos `details`, así que es un
   * **mutante equivalente en la RESPUESTA**— pero *una capa de defensa en profundidad podía
   * desaparecer sin que nada avisara*.
   *
   * **Lo que sí es observable, y es la razón documentada del pre-check:** no gastar una transacción
   * **SERIALIZABLE** ni una lectura de KYC en una fila que ya sabemos que no se paga. Si alguien
   * borra el pre-check, el rechazo llega igual… **pero después** de abrir la transacción. Eso es lo
   * que estos tests fijan. *Se cubre el efecto que el pre-check tiene, no el que comparte con el CAS.*
   */
  const casos: [string, Row, string][] = [
    ['`paidAt` poblado (huella de rollback)', { paidAt: new Date('2026-09-04T00:00:00Z') }, 'CONFLICT'],
    ['`closedAt` sellado', { closedAt: new Date('2026-09-04T00:00:00Z') }, 'CONFLICT'],
    ['`receivedAt` nulo (v1.57 · eje 2)', { receivedAt: null }, 'VALIDATION_ERROR'],
    ['`verifiedAt` nulo', { verifiedAt: null }, 'VALIDATION_ERROR'],
    ['estado NO pagable', { status: 'en_transito' as SellRequestStatus }, 'VALIDATION_ERROR'],
  ];

  it.each(casos)('%s ⇒ rechaza SIN abrir la transacción SERIALIZABLE ni leer KYC', async (_n, over, code) => {
    const h = harness(baseRow(over));
    const err = await h.svc.paySpei('sr-1', 'SPEI-X', 'admin').catch((e) => e);
    expect(err).toBeInstanceOf(BusinessException);
    expect(err.getResponse()).toMatchObject({ code });
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
    expect(h.prisma.kycProfile.findUnique).not.toHaveBeenCalled();
    expect(h.writes).toHaveLength(0);
  });

  it('el ORDEN de los pre-checks es la norma: `paidAt` gana sobre `closedAt` y sobre el estado', async () => {
    // §M5-T: la huella de un rollback tiene que ser RUIDOSA y distinguible. Con las tres condiciones
    // a la vez, el operador tiene que oír *«esto ya cobró»*, no *«el estado no es pagable»*.
    const paidAt = new Date('2026-09-04T00:00:00Z');
    const h = harness(baseRow({ paidAt, closedAt: paidAt, status: 'en_transito' as SellRequestStatus }));
    const err = await h.svc.paySpei('sr-1', 'SPEI-X', 'admin').catch((e) => e);
    expect(err.getResponse()).toMatchObject({ code: 'CONFLICT', details: { paidAt } });
  });
});

// =================================================================================================
describe('SEC-B1 · `pay-spei` idempotente — la bitácora dice la referencia EFECTIVA, no la intentada', () => {
  /**
   * Medido por seguridad (`docs/SECURITY_NOTES.md` §6, pase v1.56): el 2º `pay-spei` sobre una fila
   * ya `pagada` sale por el corto-circuito idempotente **sin asentar nada**, y aun así se emitía un
   * `AuditLog sellrequest.pay_spei` con la ref del body. **Cero dinero movido**, pero un auditor
   * leería una liquidación que nunca ocurrió. Severidad Baja; el arreglo es de una línea y el
   * riesgo de no hacerlo es que la bitácora de dinero deje de ser reconstruible.
   *
   * ⛔ **El `201`→`200` NO va aquí**: el contrato (v1.57 §E) lo agrupa con otros ocho códigos de
   * éxito en **`BL-37`** y dice literal que **no va en el commit del dinero**. *Se respeta el sitio
   * que el arquitecto le dio, no el que resulta cómodo.*
   */
  function build(devuelve: { speiReference: string | null }) {
    const buylist = { paySpei: jest.fn(async () => devuelve) };
    const audit = { log: jest.fn(async () => undefined) };
    return {
      c: new AdminBuylistController(
        buylist as unknown as BuylistService,
        audit as unknown as AuditService,
      ),
      audit,
    };
  }
  const actor = { id: 'admin-1', role: Role.super_admin };

  it('⚠️ replay idempotente: audita la ref QUE QUEDÓ, y marca la intentada como NO aplicada', async () => {
    const { c, audit } = build({ speiReference: 'SPEI-DOUBLESPEND-777' });
    await c.paySpei('sr-1', { speiReference: 'SPEI-BLUE-VERIFY-999' } as any, actor);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'sellrequest.pay_spei',
        after: {
          speiReference: 'SPEI-DOUBLESPEND-777',
          applied: false,
          attemptedSpeiReference: 'SPEI-BLUE-VERIFY-999',
        },
      }),
    );
  });

  it('el pago que SÍ asienta audita una sola referencia, sin ruido', async () => {
    const { c, audit } = build({ speiReference: 'SPEI-OK' });
    await c.paySpei('sr-1', { speiReference: 'SPEI-OK' } as any, actor);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ after: { speiReference: 'SPEI-OK' } }),
    );
  });
});
