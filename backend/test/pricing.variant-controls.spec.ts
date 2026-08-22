import { VariantControlsService } from '../src/modules/pricing/variant-controls.service';
import { composeVariantPricing } from '../src/modules/pricing/variant-pricing';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { PrismaClient } from '@prisma/client';

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

// v1.29 (§4.28d): PriceRuleSet de dos ejes (Common → rarityRules).
const BUY = {
  rules: { rarityRules: { Common: { mode: 'fixed' as const, value: 50 } }, finishRules: {}, fallbackPct: 40 },
  fallbackPct: 40,
};
const SELL = {
  rules: { rarityRules: { Common: { mode: 'fixed' as const, value: 500 } }, finishRules: {}, fallbackPct: 15 },
  fallbackPct: 15,
};

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
    card: { findUnique: jest.fn(async () => (opts.card === undefined ? CARD : opts.card)) },
    variantPriceOverride: {
      findUnique: jest.fn(async () => existing),
      upsert: jest.fn(async ({ create, update }: any) =>
        existing ? overrideRow({ ...existing, ...update }) : overrideRow({ ...create, id: 'vpo-new' }),
      ),
      delete: jest.fn(async () => existing),
    },
  } as unknown as PrismaService;
  const pricing = {
    loadBuylistRules: jest.fn(async () => BUY),
    loadSalesRules: jest.fn(async () => SELL),
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
      suggestedCents: 500, // la regla HOY (fixed 500), no el override
      overrideCents: 9900,
      effectiveCents: 9900,
      source: 'override',
    });
    expect(res.pricing.buy).toEqual({
      suggestedCents: 50,
      overrideCents: 300,
      effectiveCents: 300,
      source: 'override',
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
    expect(res.pricing.buy).toMatchObject({ overrideCents: null, effectiveCents: 50, source: 'rule' });
  });

  it('quitar el último control BORRA la fila (equivalente observable a "sin fila")', async () => {
    const existing = overrideRow({ sellOverrideCents: 9900 });
    const { svc, prisma } = build({ existing, referenceMxnCents: 10000 });
    const res = await svc.update('card-1', 'normal', { sellOverrideCents: null }, 'admin-1');
    expect(prisma.variantPriceOverride.delete).toHaveBeenCalledWith({ where: { id: 'vpo-1' } });
    expect(prisma.variantPriceOverride.upsert).not.toHaveBeenCalled();
    // Sin fila: todo por regla y SIN bloque bounty.
    expect(res.pricing.sell).toMatchObject({ overrideCents: null, effectiveCents: 500, source: 'rule' });
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
    expect(res.pricing.buy.source).toBe('rule');
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

  it('priceCents por DEBAJO del sugerido por regla (resoluble) → 422 BOUNTY_BELOW_RULE', async () => {
    // Regla Common fixed 50: un bounty de 49 no es bounty.
    const { svc } = build({ referenceMxnCents: 10000 });
    await expect(
      svc.update('card-1', 'normal', { bounty: { enabled: true, priceCents: 49 } }, 'a'),
    ).rejects.toMatchObject({ code: 'BOUNTY_BELOW_RULE' });
  });

  it('priceCents IGUAL al sugerido se acepta (la regla es `<`, no `<=`)', async () => {
    const { svc } = build({ referenceMxnCents: 10000 });
    const res = await svc.update('card-1', 'normal', { bounty: { enabled: true, priceCents: 50 } }, 'a');
    expect(res.pricing.buy).toMatchObject({ effectiveCents: 50, source: 'bounty' });
  });

  it('sugerido PENDING (pct sin referencia) → se ACEPTA cualquier precio explícito', async () => {
    // Sin regla para la rareza ⇒ fallback pct sin referencia ⇒ sugerido null.
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
    const res = await svc.update(
      'card-1',
      'normal',
      { bounty: { enabled: true, priceCents: 100, targetQty: null } },
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
    expect(res.pricing.buy).toMatchObject({ effectiveCents: 50, source: 'rule' });
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

describe('composeVariantPricing — proyección del DTO (§DTOs v1.28)', () => {
  const rules = { buy: BUY, sell: SELL };

  it('sin fila: sugerido=efectivo por regla, overrides null, SIN bloque bounty', () => {
    const dto = composeVariantPricing('Common', 'normal', 10000, rules, null);
    expect(dto).toEqual({
      buy: { suggestedCents: 50, overrideCents: null, effectiveCents: 50, source: 'rule' },
      sell: { suggestedCents: 500, overrideCents: null, effectiveCents: 500, source: 'rule' },
    });
  });

  it('no resoluble → null + source=pending (money-safe, nunca 0)', () => {
    const dto = composeVariantPricing('Illustration Rare', 'holofoil', null, rules, null);
    expect(dto.buy).toEqual({
      suggestedCents: null,
      overrideCents: null,
      effectiveCents: null,
      source: 'pending',
    });
    expect(dto.sell).toEqual({
      suggestedCents: null,
      overrideCents: null,
      effectiveCents: null,
      source: 'pending',
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
    const dto = composeVariantPricing('Common', 'normal', 10000, rules, row);
    expect(dto.buy).toEqual({ suggestedCents: 50, overrideCents: 300, effectiveCents: 7500, source: 'bounty' });
    expect(dto.sell).toEqual({ suggestedCents: 500, overrideCents: 9900, effectiveCents: 9900, source: 'override' });
    expect(dto.bounty).toEqual({
      enabled: true,
      priceCents: 7500,
      targetQty: 3,
      acquiredQty: 1,
      completedAt: null,
    });
  });
});
