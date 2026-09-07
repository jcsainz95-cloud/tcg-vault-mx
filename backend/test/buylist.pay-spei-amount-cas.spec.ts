import { BuylistService } from '../src/modules/buylist/buylist.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { UsersService } from '../src/modules/users/users.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { BusinessException } from '../src/common/business.exception';
import { ConfigService } from '@nestjs/config';
// ⚠️ v1.61.1 · B1 — el `where` se afirma EVALUÁNDOLO, no por la forma de sus claves planas.
import { matchesWhere } from './helpers/prisma-where';

/**
 * v1.51.22 · **B-2 — `paySpei` DERIVABA EL IMPORTE DE UNA LECTURA FUERA DE LA TRANSACCIÓN.**
 *
 * ### El hallazgo, medido
 * El `findUnique` de `req` ocurría **antes** del `$transaction`, con **otra ida y vuelta a la BD en
 * medio** (`kycProfile.findUnique` + `adminCycleDials`), y **dentro** de la transacción se usaba ese
 * snapshot para las dos cosas que mueven dinero: el **bruto** que se compara contra el tope AML
 * (`brutoConsumado(req)`) y el **neto** que se deposita (`payoutCents − req.offerShippingFeeCents`).
 *
 * `payableWhere()` **no lo tapaba**: fija `status`, `receivedAt` y `verifiedAt`, y **ninguno se mueve
 * cuando cambia el monto**. Y `itemDecision` es **legal concurrentemente** en `aprobada`/
 * `verificacion` (BL-14 solo frena los TERMINALES) y llama a `recomputeApprovedTotal`, que reescribe
 * `approvedTotalCents`. Si una decisión por-ítem commitea en esa ventana, **el SPEI sale con un bruto
 * superado y el chequeo AML compara contra la cifra vieja**.
 *
 * ### El remedio, y por qué son DOS cosas y no una
 * 1. **Relectura DENTRO de la transacción** (`select` de solo las cuatro columnas de dinero) —
 *    corrige *qué número* se compara contra el tope.
 * 2. **CAS sobre esas cuatro columnas en el `where` del `updateMany`** — garantiza que *ese mismo
 *    número* siga vigente al escribir. Es el hermano exacto del `offerSentAt` que `itemDecision` mete
 *    en el `where` de todas sus escrituras «con el valor que se observó al resolver el monto».
 *
 * ⚠️ **El CAS no es redundante con la relectura ni con `Serializable`:** el SSI de Postgres solo
 * arbitra entre transacciones que TAMBIÉN son `Serializable`, y `itemDecision` no lo es.
 */

const pii = new PiiCryptoService(new ConfigService({}));
const CAP = 300_000; // MX$3,000 al mes

type Row = Record<string, unknown>;

/**
 * Harness con **DOS versiones de la fila**: la que ve la lectura de fuera (`outer`) y la que ve la
 * relectura de dentro (`inner`). Esa diferencia **ES** la ventana del hallazgo; un fake con una sola
 * versión no puede distinguir el código arreglado del roto.
 */
function harness(opts: {
  outer: Row;
  /** Lo que la relectura DENTRO de la tx encuentra. Por defecto, lo mismo que fuera. */
  inner?: Row;
  paidThisMonth?: Array<Row>;
  /** Fuerza `count: 0` en la transición (CAS fallido / carrera de estado). */
  writeWins?: boolean;
  /** Fila que ve el re-`findUnique` posterior a un `count: 0`. */
  afterFailure?: Row;
}) {
  const writes: { where: Row; data: Row }[] = [];
  const inner = opts.inner ?? opts.outer;
  let calls = 0;
  const prisma: Record<string, unknown> = {
    sellRequest: {
      findUnique: jest.fn(async ({ select }: { select?: Row }) => {
        // La relectura de dinero es la ÚNICA que va con `select`: se distingue por su forma, no por
        // el orden de llamada (un mock posicional se rompe en cuanto se añade una query).
        if (select) return inner;
        calls += 1;
        if (calls === 1) return opts.outer; // la de fuera de la transacción
        return opts.afterFailure ?? { ...opts.outer, status: 'pagada' };
      }),
      findMany: jest.fn(async () => opts.paidThisMonth ?? []),
      updateMany: jest.fn(async ({ where, data }: { where: Row; data: Row }) => {
        writes.push({ where, data });
        return { count: opts.writeWins === false ? 0 : 1 };
      }),
    },
    sellRequestItem: { findMany: jest.fn(async () => []) },
    kycProfile: { findUnique: jest.fn(async () => null) },
  };
  prisma.$transaction = jest.fn(async (cb: (tx: unknown) => unknown) => cb(prisma));

  const svc = new BuylistService(
    prisma as unknown as PrismaService,
    {} as PricingService,
    { getNumber: jest.fn(async () => CAP) } as unknown as SettingsService,
    {} as UsersService,
    pii,
  );
  return { svc, prisma, writes };
}

const PAGABLE = (over: Row = {}): Row => ({
  id: 'sr-1',
  userId: 'u1',
  status: 'aprobada',
  // ⚠️ v1.56 · §M5-T — las dos columnas de la SEGUNDA red. Van en el fixture porque el `where` las
  // afirma: sin ellas, evaluarlo sobre esta fila daría `false` por la razón equivocada.
  paidAt: null,
  closedAt: null,
  // ⚠️ v1.57 · §M5-P — «pagable» son TRES términos: sin `receivedAt` esta fila ya no lo es, y esta
  // suite dejaría de probar el CAS del importe (todo caería antes, en la guarda de recepción).
  receivedAt: new Date(),
  verifiedAt: new Date(),
  quotedTotalCents: 100_000,
  offerGrossCents: null,
  approvedTotalCents: null,
  offerShippingFeeCents: null,
  ...over,
});

// =============================================================================================
describe('B-2 — el importe se relee DENTRO de la transacción', () => {
  it('⚠️⚠️ EL HUECO: `itemDecision` sube el aprobado en la ventana ⇒ el tope AML mide la cifra NUEVA', async () => {
    // Fuera: MX$1,000 (cabe de sobra bajo el tope de MX$3,000). Dentro: MX$4,000, porque una decisión
    // por-ítem commiteó entre las dos. Con el snapshot viejo el SPEI salía y el control no lo veía.
    const h = harness({
      outer: PAGABLE({ approvedTotalCents: 100_000 }),
      inner: PAGABLE({ approvedTotalCents: 400_000 }),
    });
    const err = await h.svc.paySpei('sr-1', 'SPEI-1', 'admin').catch((e) => e);
    expect(err).toBeInstanceOf(BusinessException);
    expect(err.code).toBe('BUYLIST_LIMIT_EXCEEDED');
    expect(err.getResponse()).toMatchObject({
      details: { scope: 'per_month_payout', capCents: CAP, wouldBeCents: 400_000 },
    });
    // Y NO liquidó: la transición ni se intentó.
    expect((h.prisma.sellRequest as { updateMany: jest.Mock }).updateMany).not.toHaveBeenCalled();
  });

  it('la simétrica: el aprobado BAJA en la ventana ⇒ se paga la cifra nueva, no la vieja', async () => {
    // El error no es solo «de más»: pagar el bruto viejo cuando el operador acaba de rechazar líneas
    // le entregaría al vendedor dinero por cartas que NO se compraron.
    const h = harness({
      outer: PAGABLE({ approvedTotalCents: 200_000 }),
      inner: PAGABLE({ approvedTotalCents: 50_000 }),
    });
    await h.svc.paySpei('sr-1', 'SPEI-1', 'admin');
    expect(h.writes[0].data).toMatchObject({ payoutNetCents: 50_000 });
  });

  it('⚠️ el NETO usa la tarifa RELEÍDA: los dos términos de la resta salen de la MISMA lectura', async () => {
    // Mezclar un bruto releído con un envío viejo produce un neto que no corresponde a ninguna
    // versión de la fila.
    const h = harness({
      outer: PAGABLE({ approvedTotalCents: 100_000, offerShippingFeeCents: 0 }),
      inner: PAGABLE({ approvedTotalCents: 100_000, offerShippingFeeCents: 18_000 }),
    });
    await h.svc.paySpei('sr-1', 'SPEI-1', 'admin');
    expect(h.writes[0].data).toMatchObject({ payoutNetCents: 82_000 });
  });

  it('el importe sale de la RELECTURA, no de la lectura de fuera de la transacción', async () => {
    // ⚠️ v1.61 · §M5-V.2 — este caso medía la cascada **con `approvedTotalCents = null` en las dos
    // puntas**, y eso ya no es alcanzable: V-a exige bruto aprobado para pagar. Lo que el caso
    // protege —*el número que sale es el de DENTRO de la transacción*— se mide igual, y ahora sobre
    // el término que post-V manda siempre. Los tres montos van **distintos entre sí** para que la
    // aserción discrimine cuál se usó.
    const h = harness({
      outer: PAGABLE({ approvedTotalCents: 100_000, quotedTotalCents: 140_000, offerGrossCents: 130_000 }),
      inner: PAGABLE({ approvedTotalCents: 250_000, quotedTotalCents: 140_000, offerGrossCents: 130_000 }),
    });
    await h.svc.paySpei('sr-1', 'SPEI-1', 'admin');
    expect(h.writes[0].data).toMatchObject({ payoutNetCents: 250_000 });
  });
});

// =============================================================================================
describe('B-2 — el CAS sobre el importe vive en el `where` del motor', () => {
  it('⚠️ las CUATRO columnas de dinero entran al `where`, con el valor de la RELECTURA', async () => {
    const h = harness({
      outer: PAGABLE({ approvedTotalCents: 1_000 }),
      inner: PAGABLE({
        approvedTotalCents: 120_000,
        offerGrossCents: 130_000,
        quotedTotalCents: 140_000,
        offerShippingFeeCents: 18_000,
      }),
    });
    await h.svc.paySpei('sr-1', 'SPEI-1', 'admin');
    const w = h.writes[0].where;
    // ⚠️⚠️ v1.61.1 · **B1 — se afirma el `where` COMPUESTO, evaluándolo.** Esto era un
    // `toMatchObject` sobre claves planas, y eso **no ve un fragmento perdido en la composición**:
    // con el spread, la clave `approvedTotalCents` seguía en el objeto —con el valor del CAS— y V-a
    // no llegaba al motor. Aquí se comprueba la conducta: la fila releída casa, y **mover
    // cualquiera de las cuatro columnas de dinero la descasa**, que es lo que el CAS significa.
    const releida = PAGABLE({
      approvedTotalCents: 120_000,
      offerGrossCents: 130_000,
      quotedTotalCents: 140_000,
      offerShippingFeeCents: 18_000,
    });
    expect(matchesWhere(releida, w)).toBe(true);
    // Los TRES términos de `payableWhere()` siguen ahí: el CAS AMPLÍA la guarda, no la sustituye.
    expect(matchesWhere({ ...releida, status: 'cotizada' }, w)).toBe(false);
    expect(matchesWhere({ ...releida, receivedAt: null }, w)).toBe(false);
    expect(matchesWhere({ ...releida, verifiedAt: null }, w)).toBe(false);
    // Los TRES términos de `brutoConsumado` + la tarifa que produce `payoutNetCents`.
    for (const columna of [
      'approvedTotalCents',
      'offerGrossCents',
      'quotedTotalCents',
      'offerShippingFeeCents',
    ] as const) {
      expect({ columna, casa: matchesWhere({ ...releida, [columna]: 999_999 }, w) }).toEqual({
        columna,
        casa: false,
      });
    }
  });

  it('los `null` viajan como `null` (IS NULL), no se omiten del `where`', async () => {
    // Omitirlos convertiría el CAS en «cualquier valor» justo en la fila pre-M-46, que es donde la
    // cascada cae al término más lejano del dinero real.
    // ⚠️ v1.61 · §M5-V (V-a): `approvedTotalCents` ya **no puede** ser `null` en una fila que se
    // paga, así que el `null` se afirma sobre las DOS columnas del ciclo que sí lo son en la cohorte
    // pre-M-46 — que es justo donde este CAS importa.
    const fila = PAGABLE({ approvedTotalCents: 100_000, quotedTotalCents: 100_000 });
    const h = harness({ outer: fila });
    await h.svc.paySpei('sr-1', 'SPEI-1', 'admin');
    const w = h.writes[0].where;
    expect(matchesWhere(fila, w)).toBe(true);
    // Si el `null` se hubiera omitido del `where`, el CAS de esa columna sería «cualquier valor» y
    // esta fila —con la columna MOVIDA— casaría igual. Evaluado, no supuesto.
    expect(matchesWhere({ ...fila, offerGrossCents: 130_000 }, w)).toBe(false);
    expect(matchesWhere({ ...fila, offerShippingFeeCents: 18_000 }, w)).toBe(false);
  });

  it('⚠️ CAS FALLIDO ⇒ `409 CONFLICT` y NO sale un peso', async () => {
    // La solicitud SIGUE siendo pagable, así que lo que falló no fue la precondición de estado: fue
    // el monto. Decirle al operador «el pago solo se permite tras recepción/verificación» sobre una
    // fila aprobada y verificada lo manda a revisar lo único que sí está bien.
    const h = harness({
      outer: PAGABLE({ approvedTotalCents: 100_000 }),
      writeWins: false,
      afterFailure: PAGABLE({ approvedTotalCents: 250_000 }),
    });
    const err = await h.svc.paySpei('sr-1', 'SPEI-1', 'admin').catch((e) => e);
    expect(err).toBeInstanceOf(BusinessException);
    expect(err.code).toBe('CONFLICT');
    expect(err.getStatus()).toBe(409);
    expect(err.getResponse()).toMatchObject({ details: { status: 'aprobada' } });
  });

  it('el `409` NO se come el `422` de precondición: un estado no pagable sigue diciendo lo suyo', async () => {
    // Los dos fallos son distintos y el operador hace cosas distintas con cada uno.
    const h = harness({
      outer: PAGABLE({ approvedTotalCents: 100_000 }),
      writeWins: false,
      afterFailure: PAGABLE({ status: 'recibida', verifiedAt: null }),
    });
    const err = await h.svc.paySpei('sr-1', 'SPEI-1', 'admin').catch((e) => e);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.getStatus()).toBe(422);
  });

  it('idempotencia intacta: el replay de una solicitud YA pagada sigue devolviendo su estado', async () => {
    const h = harness({ outer: PAGABLE({ status: 'pagada' }) });
    const res = await h.svc.paySpei('sr-1', 'SPEI-1', 'admin');
    expect(res).toMatchObject({ status: 'pagada' });
    expect((h.prisma.sellRequest as { updateMany: jest.Mock }).updateMany).not.toHaveBeenCalled();
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('y la carrera de ESTADO (otro pagó primero) sigue saliendo por la puerta idempotente, no por el 409', async () => {
    const h = harness({
      outer: PAGABLE({ approvedTotalCents: 100_000 }),
      writeWins: false,
      afterFailure: PAGABLE({ status: 'pagada', approvedTotalCents: 100_000 }),
    });
    const res = await h.svc.paySpei('sr-1', 'SPEI-1', 'admin');
    expect(res).toMatchObject({ status: 'pagada' });
  });
});
