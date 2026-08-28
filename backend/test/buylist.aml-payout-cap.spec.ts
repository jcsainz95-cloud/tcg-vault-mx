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
  paidThisMonth?: Array<{ approvedTotalCents: number | null; quotedTotalCents: number | null }>;
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
  verifiedAt: new Date(),
  quotedTotalCents: 0,
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
    expect(h.seen[0]).toMatchObject({ userId: 'u1', status: 'pagada' });
    expect(h.seen[0]).toHaveProperty('paidAt');
    expect(h.seen[0]).not.toHaveProperty('createdAt');
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
