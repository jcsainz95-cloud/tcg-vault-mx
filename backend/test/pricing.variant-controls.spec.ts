import { VariantControlsService } from '../src/modules/pricing/variant-controls.service';
import { composeVariantPricing } from '../src/modules/pricing/variant-pricing';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { PrismaClient } from '@prisma/client';
import { DEFAULT_PRICING_CURVE } from '../src/common/pricing-curve';

/**
 * v1.28 (P-18/P-22, §M2 / ARCHITECTURE §4.26a-b) — consola de precios por variante:
 *  - PUT /admin/pricing/variant-controls/:cardId/:finish (vía VariantControlsService.update):
 *    validaciones del contrato (finish/productType/gradeKey, centavos > 0, SEC-A1
 *    FINISH_NOT_AVAILABLE, sealed → 422, bounty solo raw, BOUNTY_PRICE_REQUIRED,
 *    BOUNTY_BELOW_RULE), semántica del PATCH parcial (omitido ≠ null), borrado de fila vacía,
 *    AUDITORÍA before/after y respuesta RESUELTA (VariantPricingDTO).
 *  - composeVariantPricing: proyección sugerido/override/efectivo + source por cara.
 */

const CARD = {
  id: 'card-1',
  rarity: 'Common',
  availableFinishes: ['normal', 'reverse_holo'],
};

// v2.0 (P-48, §4.36.2): UNA curva para los dos ejes. Con mercado $100: compra 40 % = $40 (4000c);
// venta 1.15× = $115 (11500c, ya múltiplo de $5).
const CURVE_BUY_AT_100 = 4000;
const CURVE_SELL_AT_100 = 11500;

function overrideRow(over: Record<string, unknown> = {}) {
  return {
    id: 'vpo-1',
    cardId: 'card-1',
    productType: 'raw',
    gradeKey: 'raw:NM',
    finish: 'normal',
    sellOverrideCents: null,
    buyOverrideCents: null,
    bountyEnabled: false,
    bountyPriceCents: null,
    bountyTargetQty: null,
    bountyAcquiredQty: 0,
    bountyCompletedAt: null,
    updatedBy: null,
    createdAt: new Date('2026-08-20T00:00:00Z'),
    updatedAt: new Date('2026-08-20T00:00:00Z'),
    ...over,
  };
}

function build(opts: { existing?: ReturnType<typeof overrideRow> | null; referenceMxnCents?: number | null; card?: object | null } = {}) {
  const existing = opts.existing ?? null;
  const prisma = {
    card: {
      findUnique: jest.fn(async () => (opts.card === undefined ? CARD : opts.card)),
      // v2.1.1: `createRequest` carga las cartas EN LOTE (mata el N+1 que hacía un
      // `findUnique` por ítem). Delega en el MISMO `findUnique` del fixture (`this`).
      findMany: jest.fn(async function (this: any, args: any) {
        const ids: string[] = args?.where?.id?.in ?? [];
        const rows = await Promise.all(ids.map((id) => this.findUnique({ where: { id } })));
        return rows.filter(Boolean);
      }),
    },
    variantPriceOverride: {
      findUnique: jest.fn(async () => existing),
      upsert: jest.fn(async ({ create, update }: any) =>
        existing ? overrideRow({ ...existing, ...update }) : overrideRow({ ...create, id: 'vpo-new' }),
      ),
      delete: jest.fn(async () => existing),
    },
  } as unknown as PrismaService;
  const pricing = {
    loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
    // v2.1.1 (§4.36.5b): el seam de VENTA devuelve una DECISIÓN (monto + veredicto). El mock usa
    // el CUERPO REAL (`PricingService.prototype`): es puro y no toca `this`, así que el test no
    // puede divergir de producción ni reimplementar la matemática.
    decideSalePrice: jest.fn(PricingService.prototype.decideSalePrice),
    getReference: jest.fn(async () =>
      opts.referenceMxnCents == null
        ? { status: 'pending' }
        : { status: 'priced', referenceMxnCents: opts.referenceMxnCents },
    ),
  } as unknown as PricingService;
  const audit = { log: jest.fn(async () => undefined) } as unknown as AuditService;
  const svc = new VariantControlsService(prisma, pricing, audit);
  return { svc, prisma: prisma as unknown as PrismaClient, pricing, audit };
}

describe('validaciones de identidad de la variante (SEC-A1 + contrato §M2)', () => {
  it('finish inválido → 422 VALIDATION_ERROR', async () => {
    const { svc } = build();
    await expect(svc.update('card-1', 'shiny', {}, 'admin-1')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('productType=sealed → 422 VALIDATION_ERROR (el sellado conserva su cadena H-1)', async () => {
    const { svc } = build();
    await expect(
      svc.update('card-1', 'normal', { productType: 'sealed' }, 'admin-1'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('carta inexistente → 404 NOT_FOUND', async () => {
    const { svc } = build({ card: null });
    await expect(svc.update('nope', 'normal', {}, 'admin-1')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('raw: finish fuera de availableFinishes → 422 FINISH_NOT_AVAILABLE (SEC-A1)', async () => {
    const { svc } = build();
    await expect(
      svc.update('card-1', 'holofoil', { sellOverrideCents: 100 }, 'admin-1'),
    ).rejects.toMatchObject({ code: 'FINISH_NOT_AVAILABLE' });
  });

  it('raw: gradeKey distinto de raw:NM → 422 (canónico buildGradeKey; raw opera solo NM §3.5)', async () => {
    const { svc } = build();
    await expect(
      svc.update('card-1', 'normal', { gradeKey: 'raw:LP' }, 'admin-1'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('graded: finish debe ser normal y gradeKey con forma graded:<company>:<grade>', async () => {
    const { svc } = build();
    await expect(
      svc.update('card-1', 'holofoil', { productType: 'graded', gradeKey: 'graded:PSA:10' }, 'a'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      svc.update('card-1', 'normal', { productType: 'graded' }, 'a'), // sin gradeKey
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      svc.update('card-1', 'normal', { productType: 'graded', gradeKey: 'PSA10' }, 'a'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('graded válido: upsert con la clave graded (sell/buy SÍ aplican en graded)', async () => {
    const { svc, prisma } = build();
    const res = await svc.update(
      'card-1',
      'normal',
      { productType: 'graded', gradeKey: 'graded:PSA:10', sellOverrideCents: 480000 },
      'admin-1',
    );
    expect(res.productType).toBe('graded');
    expect(res.gradeKey).toBe('graded:PSA:10');
    const upsert = (prisma.variantPriceOverride.upsert as unknown as jest.Mock).mock.calls[0][0];
    expect(upsert.create).toMatchObject({
      productType: 'graded',
      gradeKey: 'graded:PSA:10',
      finish: 'normal',
      sellOverrideCents: 480000,
    });
  });
});

describe('validaciones de montos (centavos enteros > 0, moneda operativa MXN)', () => {
  it.each([0, -5, 1.5, '100', NaN])('sellOverrideCents inválido (%p) → 422', async (bad) => {
    const { svc } = build();
    await expect(
      svc.update('card-1', 'normal', { sellOverrideCents: bad }, 'a'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('buyOverrideCents por encima del techo Int32 (BE-27) → 422', async () => {
    const { svc } = build();
    await expect(
      svc.update('card-1', 'normal', { buyOverrideCents: 2_147_483_648 }, 'a'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

describe('PATCH parcial: omitido no toca, null limpia; fila vacía se borra', () => {
  it('setea sell+buy y responde el estado RESUELTO (efectivo=override, source=override)', async () => {
    const { svc, audit } = build({ referenceMxnCents: 10000 });
    const res = await svc.update(
      'card-1',
      'normal',
      { sellOverrideCents: 9900, buyOverrideCents: 300 },
      'admin-1',
    );
    expect(res).toMatchObject({ cardId: 'card-1', productType: 'raw', gradeKey: 'raw:NM', finish: 'normal' });
    expect(res.pricing.sell).toEqual({
      suggestedCents: CURVE_SELL_AT_100, // la CURVA hoy, no el override
      overrideCents: 9900,
      effectiveCents: 9900,
      source: 'override',
      premiumAtFloor: false,
    });
    // v2.0 (criterio 89): el override de compra ($3) queda POR DEBAJO de la curva ($40) y se respeta.
    expect(res.pricing.buy).toEqual({
      suggestedCents: CURVE_BUY_AT_100,
      overrideCents: 300,
      effectiveCents: 300,
      source: 'override',
      premiumAtFloor: false,
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'pricing.variant_controls', actorUserId: 'admin-1' }),
    );
  });

  it('campo omitido conserva el valor persistido; null explícito lo limpia', async () => {
    const existing = overrideRow({ sellOverrideCents: 9900, buyOverrideCents: 300 });
    const { svc, prisma } = build({ existing, referenceMxnCents: 10000 });
    // Solo limpia buy; sell NO viaja en el body → se conserva.
    const res = await svc.update('card-1', 'normal', { buyOverrideCents: null }, 'admin-1');
    const upsert = (prisma.variantPriceOverride.upsert as unknown as jest.Mock).mock.calls[0][0];
    expect(upsert.update).toMatchObject({ sellOverrideCents: 9900, buyOverrideCents: null });
    expect(res.pricing.sell.effectiveCents).toBe(9900);
    expect(res.pricing.buy).toMatchObject({ overrideCents: null, effectiveCents: CURVE_BUY_AT_100, source: 'market' });
  });

  it('quitar el último control BORRA la fila (equivalente observable a "sin fila")', async () => {
    const existing = overrideRow({ sellOverrideCents: 9900 });
    const { svc, prisma } = build({ existing, referenceMxnCents: 10000 });
    const res = await svc.update('card-1', 'normal', { sellOverrideCents: null }, 'admin-1');
    expect(prisma.variantPriceOverride.delete).toHaveBeenCalledWith({ where: { id: 'vpo-1' } });
    expect(prisma.variantPriceOverride.upsert).not.toHaveBeenCalled();
    // Sin fila: todo por la CURVA y SIN bloque bounty.
    expect(res.pricing.sell).toMatchObject({ overrideCents: null, effectiveCents: CURVE_SELL_AT_100, source: 'market' });
    expect('bounty' in res.pricing).toBe(false);
  });

  it('la fila con HISTORIA de bounty (contador > 0) NO se borra al limpiar overrides', async () => {
    const existing = overrideRow({ sellOverrideCents: 9900, bountyAcquiredQty: 2 });
    const { svc, prisma } = build({ existing, referenceMxnCents: 10000 });
    await svc.update('card-1', 'normal', { sellOverrideCents: null }, 'admin-1');
    expect(prisma.variantPriceOverride.delete).not.toHaveBeenCalled();
    expect(prisma.variantPriceOverride.upsert).toHaveBeenCalled();
  });

  it('todo vacío sin fila previa = no-op de persistencia (ni upsert ni delete) + auditado', async () => {
    const { svc, prisma, audit } = build({ referenceMxnCents: 10000 });
    const res = await svc.update('card-1', 'normal', {}, 'admin-1');
    expect(prisma.variantPriceOverride.upsert).not.toHaveBeenCalled();
    expect(prisma.variantPriceOverride.delete).not.toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalled();
    expect(res.pricing.buy.source).toBe('market');
  });
});

describe('bounty (P-22: persistencia + invariantes; vitrina/conteo son de fase posterior)', () => {
  it('bounty solo en raw: objeto bounty con productType=graded → 422', async () => {
    const { svc } = build();
    await expect(
      svc.update(
        'card-1',
        'normal',
        { productType: 'graded', gradeKey: 'graded:PSA:10', bounty: { enabled: true, priceCents: 100 } },
        'a',
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('enabled:true sin priceCents (ni en fila) → 422 BOUNTY_PRICE_REQUIRED', async () => {
    const { svc } = build({ referenceMxnCents: 10000 });
    await expect(
      svc.update('card-1', 'normal', { bounty: { enabled: true } }, 'a'),
    ).rejects.toMatchObject({ code: 'BOUNTY_PRICE_REQUIRED' });
  });

  it('priceCents por DEBAJO de la cotización de la CURVA → 422 BOUNTY_BELOW_RULE', async () => {
    // Curva de compra a mercado $100 = $40: un bounty de $39.99 no es bounty.
    const { svc } = build({ referenceMxnCents: 10000 });
    await expect(
      svc.update('card-1', 'normal', { bounty: { enabled: true, priceCents: CURVE_BUY_AT_100 - 1 } }, 'a'),
    ).rejects.toMatchObject({ code: 'BOUNTY_BELOW_RULE' });
  });

  it('v2.0 ENDURECIDO: priceCents IGUAL a la curva se RECHAZA (`<=`, antes `<`)', async () => {
    // Sin este endurecimiento, un bounty EXACTAMENTE igual a la curva pasaría el alta y sería
    // INVISIBLE en runtime (el predicado exige estrictamente mayor, criterio 91) — incoherencia
    // entre alta y ejecución. Reversible en dato: subir el bounty $0.01.
    const { svc } = build({ referenceMxnCents: 10000 });
    await expect(
      svc.update('card-1', 'normal', { bounty: { enabled: true, priceCents: CURVE_BUY_AT_100 } }, 'a'),
    ).rejects.toMatchObject({
      code: 'BOUNTY_BELOW_RULE',
      details: { curveQuoteCents: CURVE_BUY_AT_100, priceCents: CURVE_BUY_AT_100 },
    });
  });

  it('priceCents ESTRICTAMENTE mayor que la curva se acepta y gana la precedencia #1', async () => {
    const { svc } = build({ referenceMxnCents: 10000 });
    const res = await svc.update(
      'card-1',
      'normal',
      { bounty: { enabled: true, priceCents: CURVE_BUY_AT_100 + 1 } },
      'a',
    );
    expect(res.pricing.buy).toMatchObject({ effectiveCents: CURVE_BUY_AT_100 + 1, source: 'bounty' });
  });

  it('curva PENDING (sin referencia de mercado) → se ACEPTA cualquier precio explícito', async () => {
    // Sin mercado la curva no resuelve ⇒ el bounty explícito manda (es donde más se necesita).
    const { svc } = build({ referenceMxnCents: null, card: { ...CARD, rarity: 'Illustration Rare' } });
    const res = await svc.update('card-1', 'normal', { bounty: { enabled: true, priceCents: 10 } }, 'a');
    expect(res.pricing.buy).toMatchObject({ suggestedCents: null, effectiveCents: 10, source: 'bounty' });
    expect(res.pricing.bounty).toMatchObject({ enabled: true, priceCents: 10 });
  });

  it('targetQty < 1 → 422; null = sin objetivo', async () => {
    const { svc } = build({ referenceMxnCents: 10000 });
    await expect(
      svc.update('card-1', 'normal', { bounty: { enabled: true, priceCents: 100, targetQty: 0 } }, 'a'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    // v2.0: el precio debe superar la curva ($40) o el gate BOUNTY_BELOW_RULE lo rechaza antes.
    const res = await svc.update(
      'card-1',
      'normal',
      { bounty: { enabled: true, priceCents: CURVE_BUY_AT_100 + 100, targetQty: null } },
      'a',
    );
    expect(res.pricing.bounty).toMatchObject({ targetQty: null });
  });

  it('bounty:null APAGA sin borrar el contador (enabled=false, acquiredQty intacto)', async () => {
    const existing = overrideRow({
      bountyEnabled: true,
      bountyPriceCents: 7500,
      bountyTargetQty: 3,
      bountyAcquiredQty: 2,
    });
    const { svc, prisma } = build({ existing, referenceMxnCents: 10000 });
    const res = await svc.update('card-1', 'normal', { bounty: null }, 'admin-1');
    const upsert = (prisma.variantPriceOverride.upsert as unknown as jest.Mock).mock.calls[0][0];
    expect(upsert.update).toMatchObject({
      bountyEnabled: false,
      bountyPriceCents: 7500,
      bountyAcquiredQty: 2,
    });
    // Apagado ⇒ la COMPRA regresa a la regla (el bounty ya no juega).
    expect(res.pricing.buy).toMatchObject({ effectiveCents: CURVE_BUY_AT_100, source: 'market' });
    expect(res.pricing.bounty).toMatchObject({ enabled: false, acquiredQty: 2 });
  });

  it('re-ENCENDER limpia completedAt (re-armado ≠ completado) y conserva el contador', async () => {
    const existing = overrideRow({
      bountyEnabled: false,
      bountyPriceCents: 7500,
      bountyAcquiredQty: 3,
      bountyCompletedAt: new Date('2026-08-19T00:00:00Z'),
    });
    const { svc, prisma } = build({ existing, referenceMxnCents: 10000 });
    await svc.update('card-1', 'normal', { bounty: { enabled: true } }, 'admin-1');
    const upsert = (prisma.variantPriceOverride.upsert as unknown as jest.Mock).mock.calls[0][0];
    expect(upsert.update).toMatchObject({
      bountyEnabled: true,
      bountyCompletedAt: null,
      bountyAcquiredQty: 3,
    });
  });

  it('auditoría lleva before/after con el snapshot de controles', async () => {
    const existing = overrideRow({ buyOverrideCents: 300 });
    const { svc, audit } = build({ existing, referenceMxnCents: 10000 });
    await svc.update('card-1', 'normal', { buyOverrideCents: 400 }, 'admin-1');
    const entry = (audit.log as unknown as jest.Mock).mock.calls[0][0];
    expect(entry.before.controls).toMatchObject({ buyOverrideCents: 300 });
    expect(entry.after.controls).toMatchObject({ buyOverrideCents: 400 });
    expect(entry.entityType).toBe('VariantPriceOverride');
  });
});

describe('composeVariantPricing — proyección del DTO (§DTOs v1.28, actualizado v2.0)', () => {
  it('sin fila: sugerido=efectivo por la CURVA, overrides null, SIN bloque bounty', () => {
    const dto = composeVariantPricing(10000, DEFAULT_PRICING_CURVE, null);
    expect(dto).toEqual({
      buy: { suggestedCents: 4000, overrideCents: null, effectiveCents: 4000, source: 'market', premiumAtFloor: false },
      sell: { suggestedCents: 11500, overrideCents: null, effectiveCents: 11500, source: 'market', premiumAtFloor: false },
    });
  });

  it('no resoluble → null + source=pending (money-safe, nunca 0)', () => {
    const dto = composeVariantPricing(null, DEFAULT_PRICING_CURVE, null);
    expect(dto.buy).toEqual({
      suggestedCents: null,
      overrideCents: null,
      effectiveCents: null,
      source: 'pending',
      premiumAtFloor: false,
    });
    expect(dto.sell).toEqual({
      suggestedCents: null,
      overrideCents: null,
      effectiveCents: null,
      source: 'pending',
      premiumAtFloor: false,
    });
  });

  it('fila completa: bounty gana compra, sellOverride gana venta; sugeridos siguen siendo la regla', () => {
    const row = overrideRow({
      sellOverrideCents: 9900,
      buyOverrideCents: 300,
      bountyEnabled: true,
      bountyPriceCents: 7500,
      bountyTargetQty: 3,
      bountyAcquiredQty: 1,
    }) as never;
    const dto = composeVariantPricing(10000, DEFAULT_PRICING_CURVE, row);
    // Bounty $75 > curva $40 ⇒ EFECTIVO, gana la precedencia #1.
    expect(dto.buy).toEqual({ suggestedCents: 4000, overrideCents: 300, effectiveCents: 7500, source: 'bounty', premiumAtFloor: false });
    expect(dto.sell).toEqual({ suggestedCents: 11500, overrideCents: 9900, effectiveCents: 9900, source: 'override', premiumAtFloor: false });
    expect(dto.bounty).toEqual({
      enabled: true,
      priceCents: 7500,
      targetQty: 3,
      acquiredQty: 1,
      // v2.0 (§4.36.6): la ALERTA DEL BINDER. 7500 > curva 4000 ⇒ efectivo.
      effective: true,
      curveQuoteCents: 4000,
      completedAt: null,
    });
  });
});
