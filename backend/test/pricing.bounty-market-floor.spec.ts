import { VariantControlsService } from '../src/modules/pricing/variant-controls.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { DEFAULT_PRICING_CURVE, PricingCurve } from '../src/common/pricing-curve';

/**
 * `pricing.bounty-market-floor.spec.ts` — **Q1 (§M2-B.8 / ARCHITECTURE §4.36.6): el piso del bounty
 * gana un TOPE DE MERCADO.**
 *
 * El piso efectivo pasa de `> curva` a **`min(curva, mercado)`**, con la asimetría de empate:
 * **empate-con-curva RECHAZADO** (tramo normal, sin cambio) y **empate-con-mercado ACEPTADO** (borde
 * de cartas baratas, `bin ≥ mercado`). Este archivo mide el gate `BOUNTY_BELOW_RULE` del alta
 * (`variant-controls`) — la seam CREAR/EDITAR — con la curva REAL, para que `curveQuoteCents` salga
 * del mismo cuerpo que corre en producción y el test no reimplemente la matemática.
 *
 * Fixture de BORDE (§M2-B.8, renglones `mercado=500, curva=700`): un `binCents` alto hace que la
 * curva de compra la domine el bin (`max(700, 500·0.30)=700`), así que `curva ≥ mercado` — el caso
 * donde hoy el candado obliga a pagar **por encima del mercado** y que Q1 corrige.
 *
 * ⛔ La matemática del veredicto **no se reimplementa aquí**: el gate llama a la MISMA
 * `isBountyEffective` que la cotización, la vitrina y el estado de la consola (coherencia por
 * construcción, §M2-B.8). La tabla pura de los 12 casos vive en `src/common/pricing-curve.spec.ts`.
 */

const CARD = { id: 'card-1', rarity: 'Common', availableFinishes: ['normal', 'reverse_holo'] };

/** Curva con BIN alto: en cartas baratas el bin domina ⇒ `curva ≥ mercado` (el borde de §M2-B.8). */
const CURVE_BIN_700: PricingCurve = {
  ...DEFAULT_PRICING_CURVE,
  buy: { ...DEFAULT_PRICING_CURVE.buy, binCents: 700 },
};

function build(opts: { curve?: PricingCurve; referenceMxnCents?: number | null } = {}) {
  const prisma = {
    card: { findUnique: jest.fn(async () => CARD) },
    variantPriceOverride: {
      findUnique: jest.fn(async () => null),
      upsert: jest.fn(async ({ create }: any) => ({
        id: 'vpo-new',
        sellOverrideCents: null,
        buyOverrideCents: null,
        bountyEnabled: false,
        bountyPriceCents: null,
        bountyTargetQty: null,
        bountyAcquiredQty: 0,
        bountyCompletedAt: null,
        bountyUnpublishedAt: null,
        updatedBy: null,
        updatedAt: new Date('2026-09-19T00:00:00Z'),
        ...create,
      })),
      delete: jest.fn(async () => null),
    },
  } as unknown as PrismaService;
  const pricing = {
    loadPricingCurve: jest.fn(async () => opts.curve ?? CURVE_BIN_700),
    getReference: jest.fn(async () =>
      opts.referenceMxnCents == null
        ? { status: 'pending' }
        : { status: 'priced', referenceMxnCents: opts.referenceMxnCents },
    ),
  } as unknown as PricingService;
  const audit = { log: jest.fn(async () => undefined) } as unknown as AuditService;
  return { svc: new VariantControlsService(prisma, pricing, audit) };
}

const bounty = (priceCents: number) => ({ bounty: { enabled: true, priceCents, targetQty: 2 } });

describe('Q1 · §M2-B.8 — BORDE `curva ≥ mercado` (mercado=500, curva=700): el tope de mercado', () => {
  it('⭐ KILLER — empate CON EL MERCADO se ACEPTA: bounty=500 (=mercado) ⇒ 200, basis "bounty", paga 500', async () => {
    const { svc } = build({ referenceMxnCents: 500 });
    const res = await svc.update('card-1', 'normal', bounty(500), 'admin-1');
    expect(res.pricing.buy).toMatchObject({ effectiveCents: 500, source: 'bounty' });
    expect(res.pricing.bounty).toMatchObject({ enabled: true, priceCents: 500, effective: true });
  });

  it('bounty entre mercado y bin (500 ≤ 650 < 700) se ACEPTA — paga su propio monto, bajo el bin', async () => {
    const { svc } = build({ referenceMxnCents: 500 });
    const res = await svc.update('card-1', 'normal', bounty(650), 'admin-1');
    expect(res.pricing.buy).toMatchObject({ effectiveCents: 650, source: 'bounty' });
  });

  it('below-market RECHAZADO: bounty=499 (< mercado y < curva) ⇒ 422 BOUNTY_BELOW_RULE', async () => {
    const { svc } = build({ referenceMxnCents: 500 });
    await expect(svc.update('card-1', 'normal', bounty(499), 'admin-1')).rejects.toMatchObject({
      code: 'BOUNTY_BELOW_RULE',
    });
  });

  it('el `details` del 422 lleva `curveQuoteCents` Y `marketMxnCents` (coherencia diagnóstica, §M2-B.8)', async () => {
    const { svc } = build({ referenceMxnCents: 500 });
    await expect(svc.update('card-1', 'normal', bounty(499), 'admin-1')).rejects.toMatchObject({
      code: 'BOUNTY_BELOW_RULE',
      details: { curveQuoteCents: 700, marketMxnCents: 500, priceCents: 499 },
    });
  });

  it('bounty estrictamente > curva (701) sigue aceptándose (tramo `> curva`, invariante)', async () => {
    const { svc } = build({ referenceMxnCents: 500 });
    const res = await svc.update('card-1', 'normal', bounty(701), 'admin-1');
    expect(res.pricing.buy).toMatchObject({ effectiveCents: 701, source: 'bounty' });
  });

  it('🐤 CANARIO DEL DUEÑO — con `curva ≥ mercado` SIEMPRE existe un bounty aceptado `≤ mercado` (bounty=mercado)', async () => {
    // La garantía Q1: el candado NUNCA obliga a pagar por encima del mercado. Antes de Q1 este alta
    // se RECHAZABA (500 ≤ curva 700), forzando `> 700 > mercado`. Debe aceptarse.
    const { svc } = build({ referenceMxnCents: 500 });
    await expect(svc.update('card-1', 'normal', bounty(500), 'admin-1')).resolves.toMatchObject({
      pricing: { bounty: { effective: true } },
    });
  });
});

describe('Q1 · §M2-B.8 — TRAMO NORMAL `curva < mercado` (cartas caras): empate-curva RECHAZADO (sin cambio)', () => {
  // Mercado $100 con la curva REAL: compra 40 % = $40 (4000c). curva < mercado.
  it('empate CON LA CURVA se RECHAZA: bounty=4000 (=curva, < mercado 10000) ⇒ 422 BOUNTY_BELOW_RULE', async () => {
    const { svc } = build({ curve: DEFAULT_PRICING_CURVE, referenceMxnCents: 10000 });
    await expect(svc.update('card-1', 'normal', bounty(4000), 'admin-1')).rejects.toMatchObject({
      code: 'BOUNTY_BELOW_RULE',
      details: { curveQuoteCents: 4000, marketMxnCents: 10000 },
    });
  });

  it('bounty > curva (4001) se acepta, tramo normal intacto', async () => {
    const { svc } = build({ curve: DEFAULT_PRICING_CURVE, referenceMxnCents: 10000 });
    const res = await svc.update('card-1', 'normal', bounty(4001), 'admin-1');
    expect(res.pricing.buy).toMatchObject({ effectiveCents: 4001, source: 'bounty' });
  });
});

describe('Q1 · §M2-B.8 — mercado PENDING (curva null) se mantiene ACEPTAR', () => {
  it('sin referencia de mercado el bounty explícito manda (cualquier > 0)', async () => {
    const { svc } = build({ referenceMxnCents: null });
    const res = await svc.update('card-1', 'normal', bounty(10), 'admin-1');
    expect(res.pricing.bounty).toMatchObject({ enabled: true, priceCents: 10, effective: true });
  });
});
