import { BuylistService } from '../src/modules/buylist/buylist.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { UsersService } from '../src/modules/users/users.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { BusinessException } from '../src/common/business.exception';
import { ConfigService } from '@nestjs/config';

/**
 * AML-1 (v2.1.6, ARCHITECTURE §4.36.6a) — **el tope mensual liga el dinero que SALE**, no solo la
 * estimación de entrada.
 *
 * ### El hueco, y por qué es responsabilidad de este pase
 * El tope se evaluaba sobre la **cotización de intake**, pero el dinero sale en la **aprobación**.
 * Una línea `precio_pendiente` entra al mes consumiendo **$0**; si después el dueño le fija precio y
 * la aprueba, ese monto **sí es dinero que sale** — y nada lo medía.
 *
 * La curva **amplió la población de líneas en `$0`**: trajo dos vías nuevas hacia `precio_pendiente`
 * (sin mercado —el bin NO gana, §4.36.0— y el guardarraíl `premium_at_floor`, §4.36.5). Un control
 * AML no se define solo por su mecanismo de concurrencia: se define por **el universo de montos que
 * mide**, y este cambio movió ese universo.
 *
 * La transacción `Serializable` del intake **no se toca** (sigue siendo correcta para lo suyo); esto
 * **añade** la verificación en la salida, en el seam de money-out que ya existía.
 */

const pii = new PiiCryptoService(new ConfigService({}));
const CAP = 300_000; // MX$3,000 al mes

function harness(opts: {
  request: Record<string, unknown>;
  // v1.51.22 (B-5): las filas del acumulado llevan LOS TRES términos de `brutoConsumado`. El tipo
  // viejo solo declaraba dos y por eso `offerGrossCents` —el que M-46 añadió— no se podía ejercitar.
  paidThisMonth?: Array<Record<string, unknown>>;
  capOverride?: number | null;
}) {
  const seen: Array<Record<string, unknown>> = [];
  const prisma: Record<string, unknown> = {
    sellRequest: {
      findUnique: jest
        .fn()
        .mockResolvedValueOnce(opts.request)
        .mockResolvedValue({ ...opts.request, status: 'pagada' }),
      findMany: jest.fn(async (args: never) => {
        seen.push((args as { where: Record<string, unknown> }).where);
        return opts.paidThisMonth ?? [];
      }),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    sellRequestItem: { findMany: jest.fn(async () => []) },
    kycProfile: {
      findUnique: jest.fn(async () =>
        opts.capOverride === undefined ? null : { capPerMonthCentsOverride: opts.capOverride },
      ),
    },
  };
  prisma.$transaction = jest.fn(async (cb: (tx: unknown) => unknown) => cb(prisma));

  const svc = new BuylistService(
    prisma as unknown as PrismaService,
    {} as PricingService,
    { getNumber: jest.fn(async () => CAP) } as unknown as SettingsService,
    {} as UsersService,
    pii,
  );
  return { svc, prisma, seen };
}

const APROBADA = (over: Record<string, unknown> = {}) => ({
  id: 'sr-1',
  userId: 'u1',
  status: 'aprobada',
  // ⚠️ v1.57 · §M5-P — «pagable» son TRES términos: sin `receivedAt` esta fila ya no lo es.
  receivedAt: new Date(),
  verifiedAt: new Date(),
  quotedTotalCents: 0,
  // v1.51.22 (B-5): el término CENTRAL de la cascada, explícito. Sin él en la fila base, ninguna
  // prueba de esta suite podía tocarlo.
  offerGrossCents: null,
  offerShippingFeeCents: null,
  approvedTotalCents: null,
  ...over,
});

describe('AML-1 — el pago SPEI re-verifica el tope MENSUAL contra lo aprobado', () => {
  it('EL CASO DEL HUECO: entró en $0 (todo `precio_pendiente`) y sale con monto ⇒ consume tope', async () => {
    // La solicitud cotizó $0 (líneas pendientes) y se aprobó en MX$2,000. Ya se pagaron MX$2,000
    // este mes ⇒ el pago llevaría el mes a MX$4,000 sobre un tope de MX$3,000.
    const h = harness({
      request: APROBADA({ quotedTotalCents: 0, approvedTotalCents: 200_000 }),
      paidThisMonth: [{ approvedTotalCents: 200_000, quotedTotalCents: 0 }],
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

  it('dentro del tope: el pago procede con normalidad', async () => {
    const h = harness({
      request: APROBADA({ approvedTotalCents: 100_000 }),
      paidThisMonth: [{ approvedTotalCents: 100_000, quotedTotalCents: 0 }],
    });
    await h.svc.paySpei('sr-1', 'SPEI-1', 'admin');
    expect((h.prisma.sellRequest as { updateMany: jest.Mock }).updateMany).toHaveBeenCalled();
  });

  it('el borde EXACTO (`== cap`) se permite: el tope es «no más de X», no «menos de X»', async () => {
    const h = harness({
      request: APROBADA({ approvedTotalCents: 100_000 }),
      paidThisMonth: [{ approvedTotalCents: 200_000, quotedTotalCents: 0 }],
    });
    await h.svc.paySpei('sr-1', 'SPEI-1', 'admin');
    expect((h.prisma.sellRequest as { updateMany: jest.Mock }).updateMany).toHaveBeenCalled();
  });

  it('sin cherry-pick (`approvedTotalCents = null`) manda lo COTIZADO', async () => {
    const h = harness({
      request: APROBADA({ quotedTotalCents: 400_000, approvedTotalCents: null }),
    });
    const err = await h.svc.paySpei('sr-1', 'SPEI-1', 'admin').catch((e) => e);
    expect(err.code).toBe('BUYLIST_LIMIT_EXCEEDED');
    expect(err.getResponse()).toMatchObject({ details: { wouldBeCents: 400_000 } });
  });

  it('lo APROBADO manda sobre lo cotizado (es lo que realmente sale)', async () => {
    // Cotizó MX$4,000 pero tras cherry-pick se aprueba MX$1,000: el pago cabe.
    const h = harness({
      request: APROBADA({ quotedTotalCents: 400_000, approvedTotalCents: 100_000 }),
    });
    await h.svc.paySpei('sr-1', 'SPEI-1', 'admin');
    expect((h.prisma.sellRequest as { updateMany: jest.Mock }).updateMany).toHaveBeenCalled();
  });

  it('el acumulado se ancla en `paidAt` (cuándo salió), no en `createdAt` (cuándo entró)', async () => {
    const h = harness({ request: APROBADA({ approvedTotalCents: 1000 }) });
    await h.svc.paySpei('sr-1', 'SPEI-1', 'admin');
    // Una solicitud de diciembre pagada en enero consume tope de ENERO, que es cuando sale el dinero.
    expect(h.seen[0]).toMatchObject({ userId: 'u1' });
    expect(h.seen[0]).toHaveProperty('paidAt');
    expect(h.seen[0]).not.toHaveProperty('createdAt');
  });

  /**
   * ⚠️⚠️ v1.56 · **§M5-T / BL-35 — EL SEGUNDO IMPACTO DE LA CRÍTICA P1, EN UN ASSERT.**
   *
   * El acumulado exigía **`status='pagada'`**, así que durante la reactivación del PoC la fila
   * **salía del acumulado**: cada re-pago se evaluaba contra una cifra **que no incluía el dinero ya
   * entregado**, y el tope mensual se podía rebasar sin que ningún control lo notara.
   *
   * Se afirma la **AUSENCIA** del término, que es lo que la regresión traería de vuelta: un
   * `toMatchObject` con `paidAt` pasaría igual con el `status` puesto. `paidAt >= inicio de mes` ya
   * excluye los `null`, así que quitarlo es un **superconjunto estricto** — cero regresión sobre fila
   * sana, y sobre la fila defectuosa **cuenta el dinero que de verdad salió** (falla cerrado).
   */
  it('⚠️ P1: el acumulado NO exige `status:"pagada"` — una fila revivida NO puede salirse del tope', async () => {
    const h = harness({ request: APROBADA({ approvedTotalCents: 1000 }) });
    await h.svc.paySpei('sr-1', 'SPEI-1', 'admin');
    expect(h.seen[0]).not.toHaveProperty('status');
    expect(Object.keys(h.seen[0]).sort()).toEqual(['paidAt', 'userId']);
  });

  it('el override de KYC del VENDEDOR manda sobre el dial global (mismo criterio que el intake)', async () => {
    const h = harness({
      request: APROBADA({ approvedTotalCents: 400_000 }),
      capOverride: 1_000_000, // este vendedor tiene tope ampliado
    });
    await h.svc.paySpei('sr-1', 'SPEI-1', 'admin');
    expect((h.prisma.sellRequest as { updateMany: jest.Mock }).updateMany).toHaveBeenCalled();
  });

  it('la verificación corre DENTRO de la transacción y bajo `Serializable` (TOCTOU del intake, espejado)', async () => {
    const h = harness({ request: APROBADA({ approvedTotalCents: 1000 }) });
    await h.svc.paySpei('sr-1', 'SPEI-1', 'admin');
    const [, opts] = (h.prisma.$transaction as jest.Mock).mock.calls[0];
    // Sin serializable, dos pay-spei concurrentes del MISMO vendedor leen el mismo acumulado y
    // los dos pasan: el bypass clásico del tope.
    expect(opts).toMatchObject({ isolationLevel: 'Serializable' });
  });

  it('idempotencia intacta: una solicitud YA pagada no re-verifica ni re-liquida', async () => {
    const h = harness({ request: { ...APROBADA(), status: 'pagada' } });
    const res = await h.svc.paySpei('sr-1', 'SPEI-1', 'admin');
    expect(res).toMatchObject({ status: 'pagada' });
    expect((h.prisma.sellRequest as { updateMany: jest.Mock }).updateMany).not.toHaveBeenCalled();
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });
});

// =============================================================================================
/**
 * v1.51.22 · **B-5 — EL BORDE DEL TOPE ANTILAVADO, POR LOS DOS LADOS.**
 *
 * ### El hueco de cobertura, medido
 * Esta suite probaba **MX$4,000** (muy por encima) y **MX$2,000** (muy por debajo) contra un tope de
 * **MX$3,000**, más el borde exacto `== cap` **por el lado que PASA**. Le faltaba **el filo por el
 * lado que RECHAZA**: mutar `> capPerMonth` a `> capPerMonth + 1` dejaba **58/58 verde** en payout y
 * **605/605** en intake. *Un off-by-one en un control antilavado se habría publicado en verde.*
 *
 * ### Por qué entra en este pase aunque el spec sea heredado
 * Esta rama **cambió la cascada que lo alimenta**: `brutoConsumado` pasó de dos términos a **tres**
 * (`approvedTotalCents ?? offerGrossCents ?? quotedTotalCents`, §4.39i.4-bis). El universo de montos
 * que el control mide se movió, así que su borde hay que volver a medirlo — y hay que medirlo **con
 * el término nuevo**, no solo con los dos viejos.
 *
 * ### La regla, escrita como la mata una mutación
 * ```
 * acumulado + enCurso  <  cap   ⇒ PASA
 * acumulado + enCurso  == cap   ⇒ PASA   («no más de X», no «menos de X»)
 * acumulado + enCurso  == cap+1 ⇒ FRENA  ⚠️ el filo que faltaba
 * ```
 * Los tres juntos **fijan la comparación exacta**: `>=` muere en el segundo, `> cap + 1` muere en el
 * tercero, y `<` en el primero.
 */
describe('B-5 — el FILO del tope mensual (un centavo a cada lado)', () => {
  /** `[yaPagado, enCurso, pasa, rótulo]` — el tope es `CAP` = MX$3,000. */
  const FILO: [number, number, boolean, string][] = [
    [200_000, 99_999, true, 'un centavo POR DEBAJO del tope'],
    [200_000, 100_000, true, 'EXACTAMENTE el tope: el borde es INCLUSIVO'],
    [200_000, 100_001, false, '⚠️ UN CENTAVO POR ENCIMA: el filo que faltaba'],
    [0, CAP + 1, false, 'el filo también con el acumulado en cero'],
    [CAP, 1, false, 'y con el acumulado ya EN el tope: un centavo más no cabe'],
  ];

  it.each(FILO)(
    'yaPagado=%i + enCurso=%i ⇒ pasa=%s — %s',
    async (yaPagado, enCurso, pasa) => {
      const h = harness({
        request: APROBADA({ approvedTotalCents: enCurso }),
        paidThisMonth: yaPagado > 0 ? [{ approvedTotalCents: yaPagado, quotedTotalCents: 0 }] : [],
      });
      const updateMany = (h.prisma.sellRequest as { updateMany: jest.Mock }).updateMany;
      if (pasa) {
        await h.svc.paySpei('sr-1', 'SPEI-1', 'admin');
        expect(updateMany).toHaveBeenCalled();
      } else {
        const err = await h.svc.paySpei('sr-1', 'SPEI-1', 'admin').catch((e) => e);
        expect(err).toBeInstanceOf(BusinessException);
        expect(err.code).toBe('BUYLIST_LIMIT_EXCEEDED');
        expect(err.getResponse()).toMatchObject({
          details: { scope: 'per_month_payout', capCents: CAP, wouldBeCents: yaPagado + enCurso },
        });
        // Y lo que de verdad importa: NO salió un peso.
        expect(updateMany).not.toHaveBeenCalled();
      }
    },
  );

  it('⚠️ el filo se mide con el término CENTRAL de la cascada (`offerGrossCents`), en los DOS lados', async () => {
    // Es el término que M-46 añadió y el que el override al alza (D26) hace **mayor** que el cotizado:
    // medir por el cotizado dejaba el acumulado corto y el vendedor rebasaba el tope sin que nada lo
    // notara. Aquí ni el acumulado ni la solicitud en curso tienen `approvedTotalCents`.
    const h = harness({
      request: APROBADA({ approvedTotalCents: null, offerGrossCents: 100_001, quotedTotalCents: 1 }),
      paidThisMonth: [{ approvedTotalCents: null, offerGrossCents: 200_000, quotedTotalCents: 1 }],
    });
    const err = await h.svc.paySpei('sr-1', 'SPEI-1', 'admin').catch((e) => e);
    expect(err.code).toBe('BUYLIST_LIMIT_EXCEEDED');
    // ⚠️ 300_001 y no 2: si alguna de las dos puntas midiera por `quotedTotalCents` el número saldría
    // ridículamente bajo y el pago pasaría.
    expect(err.getResponse()).toMatchObject({ details: { wouldBeCents: 300_001 } });
  });

  it('y el mismo caso UN CENTAVO más abajo SÍ pasa (el filo no es un rechazo genérico)', async () => {
    const h = harness({
      request: APROBADA({ approvedTotalCents: null, offerGrossCents: 100_000, quotedTotalCents: 1 }),
      paidThisMonth: [{ approvedTotalCents: null, offerGrossCents: 200_000, quotedTotalCents: 1 }],
    });
    await h.svc.paySpei('sr-1', 'SPEI-1', 'admin');
    expect((h.prisma.sellRequest as { updateMany: jest.Mock }).updateMany).toHaveBeenCalled();
  });

  it('el filo se mueve con el override de KYC: es el CAP EFECTIVO el que manda, no el dial', async () => {
    // Un override que ampliara el tope pero dejara el filo en el dial global sería un tope que no es
    // el que se le prometió al vendedor.
    const h = harness({
      request: APROBADA({ approvedTotalCents: 1 }),
      paidThisMonth: [{ approvedTotalCents: 1_000_000, quotedTotalCents: 0 }],
      capOverride: 1_000_000,
    });
    const err = await h.svc.paySpei('sr-1', 'SPEI-1', 'admin').catch((e) => e);
    expect(err.code).toBe('BUYLIST_LIMIT_EXCEEDED');
    expect(err.getResponse()).toMatchObject({
      details: { capCents: 1_000_000, wouldBeCents: 1_000_001 },
    });
  });
});
