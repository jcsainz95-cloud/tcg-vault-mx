import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { VariantControlsService } from '../src/modules/pricing/variant-controls.service';
import { PricingController } from '../src/modules/pricing/pricing.controller';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { DEFAULT_PRICING_CURVE } from '../src/common/pricing-curve';

/**
 * `pricing.delete-bounty.spec.ts` — **Q2 (§M2-B.9 / ARCHITECTURE §4.36.6b): `DELETE …/bounty`.**
 *
 * El servidor **ramifica por historia**: sin compra ⇒ **borra**; con compra ⇒ **despublica**
 * (`bountyUnpublishedAt=now()`, estado `despublicada`). Cubre **B-17** (la rama), **B-20** (verbo
 * dedicado + no toca sell/buy) y **B-21** (INV-BOUNTY-COST: la tx del DELETE NO toca `InventoryItem`).
 */

const CARD = { id: 'card-1', rarity: 'Common', availableFinishes: ['normal', 'reverse_holo'] };

function overrideRow(over: Record<string, unknown> = {}) {
  return {
    id: 'vpo-1',
    cardId: 'card-1',
    productType: 'raw',
    gradeKey: 'raw:NM',
    finish: 'normal',
    sellOverrideCents: null,
    buyOverrideCents: null,
    bountyEnabled: true,
    bountyPriceCents: 7500,
    bountyTargetQty: 3,
    bountyAcquiredQty: 0,
    bountyCompletedAt: null,
    bountyUnpublishedAt: null,
    updatedBy: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-01T00:00:00Z'),
    ...over,
  };
}

/** Espía de `InventoryItem`: si el borrado tocara el inventario, alguno de estos se llamaría (B-21). */
function inventorySpy() {
  return {
    update: jest.fn(),
    updateMany: jest.fn(),
    create: jest.fn(),
    createMany: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
    upsert: jest.fn(),
  };
}

function build(opts: { existing?: ReturnType<typeof overrideRow> | null; card?: object | null; referenceMxnCents?: number | null } = {}) {
  const existing = opts.existing === undefined ? overrideRow() : opts.existing;
  const inventory = inventorySpy();
  const txClient: any = {
    variantPriceOverride: {
      update: jest.fn(async ({ data }: any) => ({ ...existing, ...data })),
      delete: jest.fn(async () => existing),
    },
    auditLog: { create: jest.fn(async ({ data }: any) => data) },
    inventoryItem: inventory,
  };
  const prisma = {
    card: { findUnique: jest.fn(async () => (opts.card === undefined ? CARD : opts.card)) },
    variantPriceOverride: { findUnique: jest.fn(async () => existing) },
    inventoryItem: inventory,
    $transaction: jest.fn(async (cb: any) => cb(txClient)),
  } as unknown as PrismaService;
  const pricing = {
    loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
    getReference: jest.fn(async () =>
      (opts.referenceMxnCents ?? 10000) == null
        ? { status: 'pending' }
        : { status: 'priced', referenceMxnCents: opts.referenceMxnCents ?? 10000 },
    ),
  } as unknown as PricingService;
  const audit = new AuditService(prisma); // usa `tx.auditLog.create` cuando se le pasa el tx
  const svc = new VariantControlsService(prisma, pricing, audit);
  return { svc, prisma, txClient, inventory };
}

describe('DELETE …/bounty — B-17: la rama la decide la HISTORIA de compra, no el cliente', () => {
  it('RAMA A · sin historia (acquiredQty=0, completedAt=null), sin otros overrides ⇒ BORRA la fila', async () => {
    const { svc, txClient } = build({ existing: overrideRow({ bountyAcquiredQty: 0, bountyCompletedAt: null }) });
    const res = await svc.deleteBounty('card-1', 'normal', 'admin-1');
    expect(txClient.variantPriceOverride.delete).toHaveBeenCalledWith({ where: { id: 'vpo-1' } });
    expect(txClient.variantPriceOverride.update).not.toHaveBeenCalled();
    // Sin fila ⇒ el DTO no trae bloque bounty.
    expect('bounty' in res.pricing).toBe(false);
    // AuditLog `bounty.deleted` con la pre-imagen.
    const audit = txClient.auditLog.create.mock.calls[0][0].data;
    expect(audit.action).toBe('bounty.deleted');
    expect(audit.before.controls).toMatchObject({ bountyPriceCents: 7500 });
    expect(audit.after.controls).toBeNull();
  });

  it('RAMA A · sin historia pero CON otros overrides ⇒ limpia el bounty y CONSERVA la fila (sell/buy intactos, B-20)', async () => {
    const { svc, txClient } = build({
      existing: overrideRow({ sellOverrideCents: 9900, buyOverrideCents: 300, bountyAcquiredQty: 0 }),
    });
    const res = await svc.deleteBounty('card-1', 'normal', 'admin-1');
    expect(txClient.variantPriceOverride.delete).not.toHaveBeenCalled();
    const data = txClient.variantPriceOverride.update.mock.calls[0][0].data;
    // ⛔ B-20: el DELETE NO toca sell/buy — esas claves NO viajan en el `data` del update.
    expect(data).not.toHaveProperty('sellOverrideCents');
    expect(data).not.toHaveProperty('buyOverrideCents');
    expect(data).toMatchObject({ bountyEnabled: false, bountyPriceCents: null, bountyUnpublishedAt: null });
    // El override de venta sobrevive en el estado resuelto.
    expect(res.pricing.sell).toMatchObject({ overrideCents: 9900, source: 'override' });
    expect(txClient.auditLog.create.mock.calls[0][0].data.action).toBe('bounty.deleted');
  });

  it('RAMA B · con historia (acquiredQty>0) ⇒ DESPUBLICA: conserva precio/contador, sella unpublishedAt', async () => {
    const { svc, txClient } = build({ existing: overrideRow({ bountyAcquiredQty: 2, bountyPriceCents: 7500, bountyTargetQty: 3 }) });
    const res = await svc.deleteBounty('card-1', 'normal', 'admin-1');
    expect(txClient.variantPriceOverride.delete).not.toHaveBeenCalled();
    const data = txClient.variantPriceOverride.update.mock.calls[0][0].data;
    expect(data.bountyEnabled).toBe(false);
    expect(data.bountyUnpublishedAt).toBeInstanceOf(Date);
    // ⛔ NO reinicia el contador ni pisa el precio (no está en el `data`): la historia se conserva.
    expect(data).not.toHaveProperty('bountyAcquiredQty');
    expect(data).not.toHaveProperty('bountyPriceCents');
    // ⛔ B-20: tampoco toca sell/buy.
    expect(data).not.toHaveProperty('sellOverrideCents');
    expect(data).not.toHaveProperty('buyOverrideCents');
    // El DTO conserva el registro (enabled=false pero priceCents/acquiredQty intactos).
    expect(res.pricing.bounty).toMatchObject({ enabled: false, priceCents: 7500, acquiredQty: 2 });
    expect(txClient.auditLog.create.mock.calls[0][0].data.action).toBe('bounty.unpublished');
  });

  it('RAMA B · completedAt != null (sin acquiredQty) TAMBIÉN despublica (la historia incluye el completado)', async () => {
    const { svc, txClient } = build({
      existing: overrideRow({ bountyEnabled: false, bountyAcquiredQty: 0, bountyCompletedAt: new Date('2026-09-05T00:00:00Z') }),
    });
    await svc.deleteBounty('card-1', 'normal', 'admin-1');
    expect(txClient.variantPriceOverride.update).toHaveBeenCalled();
    expect(txClient.variantPriceOverride.delete).not.toHaveBeenCalled();
    expect(txClient.auditLog.create.mock.calls[0][0].data.action).toBe('bounty.unpublished');
  });

  it('B-17 ⭐ dos fixtures IDÉNTICOS salvo acquiredQty: uno BORRA, el otro DESPUBLICA', async () => {
    const a = build({ existing: overrideRow({ bountyAcquiredQty: 0 }) });
    const b = build({ existing: overrideRow({ bountyAcquiredQty: 1 }) });
    await a.svc.deleteBounty('card-1', 'normal', 'admin-1');
    await b.svc.deleteBounty('card-1', 'normal', 'admin-1');
    expect(a.txClient.variantPriceOverride.delete).toHaveBeenCalled();
    expect(a.txClient.auditLog.create.mock.calls[0][0].data.action).toBe('bounty.deleted');
    expect(b.txClient.variantPriceOverride.delete).not.toHaveBeenCalled();
    expect(b.txClient.variantPriceOverride.update.mock.calls[0][0].data.bountyUnpublishedAt).toBeInstanceOf(Date);
    expect(b.txClient.auditLog.create.mock.calls[0][0].data.action).toBe('bounty.unpublished');
  });
});

describe('DELETE …/bounty — B-21: INV-BOUNTY-COST (NO toca inventario ni P/L)', () => {
  it('RAMA A · la transacción del DELETE NO escribe NADA en `InventoryItem`', async () => {
    const { svc, inventory } = build({ existing: overrideRow({ bountyAcquiredQty: 0 }) });
    await svc.deleteBounty('card-1', 'normal', 'admin-1');
    for (const fn of Object.values(inventory)) expect(fn).not.toHaveBeenCalled();
  });

  it('RAMA B · la transacción del DELETE NO escribe NADA en `InventoryItem` (el costo vive una sola vez)', async () => {
    // Adquirir bajo bounty sella `acquisitionCostCents` en InventoryItem (buylist), NO aquí. Despublicar
    // no puede tocarlo: si algún día se cableara el borrado a inventario, este canario lo gritaría.
    const { svc, inventory, txClient } = build({ existing: overrideRow({ bountyAcquiredQty: 2 }) });
    await svc.deleteBounty('card-1', 'normal', 'admin-1');
    for (const fn of Object.values(inventory)) expect(fn).not.toHaveBeenCalled();
    // La tx SOLO tocó VariantPriceOverride + AuditLog.
    expect(txClient.variantPriceOverride.update).toHaveBeenCalledTimes(1);
    expect(txClient.auditLog.create).toHaveBeenCalledTimes(1);
  });
});

describe('DELETE …/bounty — códigos e idempotencia (§M2-B.9)', () => {
  it('404 BOUNTY_NOT_FOUND: variante SIN bounty en alcance', async () => {
    const { svc } = build({ existing: overrideRow({ bountyEnabled: false, bountyPriceCents: null, bountyTargetQty: null, bountyAcquiredQty: 0, bountyCompletedAt: null, sellOverrideCents: 9900 }) });
    await expect(svc.deleteBounty('card-1', 'normal', 'admin-1')).rejects.toMatchObject({ code: 'BOUNTY_NOT_FOUND' });
  });

  it('404 BOUNTY_NOT_FOUND: no existe fila alguna', async () => {
    const { svc } = build({ existing: null });
    await expect(svc.deleteBounty('card-1', 'normal', 'admin-1')).rejects.toMatchObject({ code: 'BOUNTY_NOT_FOUND' });
  });

  it('404 NOT_FOUND: carta inexistente', async () => {
    const { svc } = build({ card: null });
    await expect(svc.deleteBounty('nope', 'normal', 'admin-1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('422 FINISH_NOT_AVAILABLE: `:finish` fuera de availableFinishes (SEC-A1)', async () => {
    const { svc } = build({});
    await expect(svc.deleteBounty('card-1', 'holofoil', 'admin-1')).rejects.toMatchObject({ code: 'FINISH_NOT_AVAILABLE' });
  });

  it('IDEMPOTENTE rama B: DELETE sobre una fila YA despublicada ⇒ no-op (ni update ni delete), sigue despublicada', async () => {
    const { svc, txClient } = build({ existing: overrideRow({ bountyEnabled: false, bountyAcquiredQty: 2, bountyUnpublishedAt: new Date('2026-09-10T00:00:00Z') }) });
    const res = await svc.deleteBounty('card-1', 'normal', 'admin-1');
    expect(txClient.variantPriceOverride.update).not.toHaveBeenCalled();
    expect(txClient.variantPriceOverride.delete).not.toHaveBeenCalled();
    expect(res.pricing.bounty).toMatchObject({ enabled: false, priceCents: 7500 });
  });
});

describe('DELETE …/bounty — B-20(a): el VERBO es un DELETE dedicado, no `remove:true` en el PUT', () => {
  it('el controller expone `@Delete(variant-controls/:cardId/:finish/bounty)` y va al handler deleteBounty', () => {
    const proto = PricingController.prototype as unknown as Record<string, object>;
    const method = Reflect.getMetadata(METHOD_METADATA, proto.deleteBounty);
    const path = Reflect.getMetadata(PATH_METADATA, proto.deleteBounty);
    expect(method).toBe(RequestMethod.DELETE);
    expect(path).toBe('variant-controls/:cardId/:finish/bounty');
  });
});
