import { BuylistService } from '../src/modules/buylist/buylist.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { UsersService } from '../src/modules/users/users.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { ConfigService } from '@nestjs/config';

const pii = new PiiCryptoService(new ConfigService({}));

/**
 * BLOQUEANTE (QA) — convert-to-inventory exige itemStatus='aprobada' (PROJECT §H, criterios
 * 3d/16). Una carta `rechazada` (resultado de verificación NO-NM) NUNCA puede convertirse en
 * InventoryItem vendible → 422 ITEM_NOT_APPROVED y NO se crea InventoryItem. Una carta
 * `aprobada` → OK. Idempotencia (item ya convertido) se conserva y NO dispara el 422.
 */
describe('BuylistService.convertToInventory — guardia de aprobación (itemStatus)', () => {
  function build(itemOverrides: Record<string, unknown>) {
    const created: { id: string | null } = { id: null };
    const prisma: any = {
      sellRequestItem: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'sri-1',
          cardId: 'c1',
          productType: 'raw',
          rawCondition: 'NM',
          approvedPriceCents: 5000,
          quotedPriceCents: 5000,
          inventoryItemId: null,
          itemStatus: 'aprobada',
          card: {},
          ...itemOverrides,
        }),
        update: jest.fn(),
        // v1.82.1 · §PNL.10.3: la escritura de la carta es `updateMany` con CAS; `count` lo fija cada prueba.
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      nextFolio: jest.fn(async () => 'INV-000001'),
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
      inventoryItem: {
        create: jest.fn(async ({ data }: any) => {
          created.id = 'inv-1';
          return { id: 'inv-1', folio: data.folio };
        }),
        findFirst: jest.fn(async () => ({ id: created.id })),
      },
      inventoryMovement: { create: jest.fn() },
    };
    const svc = new BuylistService(
      prisma as PrismaService,
      {} as PricingService,
      {} as SettingsService,
      {} as UsersService,
      pii,
    );
    return { svc, prisma, created };
  }

  it('item RECHAZADA (NO-NM) → 422 ITEM_NOT_APPROVED y NO crea InventoryItem', async () => {
    const { svc, prisma } = build({ itemStatus: 'rechazada' });
    await expect(svc.convertToInventory('sri-1', 'actor')).rejects.toMatchObject({
      code: 'ITEM_NOT_APPROVED',
    });
    expect(prisma.inventoryItem.create).not.toHaveBeenCalled();
    expect(prisma.sellRequestItem.update).not.toHaveBeenCalled();
    expect(prisma.sellRequestItem.updateMany).not.toHaveBeenCalled();
  });

  it.each(['cotizada', 'recibida', 'verificacion', 'ajustada', 'precio_pendiente'])(
    'item en estado no aprobado (%s) → 422 y NO crea InventoryItem',
    async (status) => {
      const { svc, prisma } = build({ itemStatus: status });
      await expect(svc.convertToInventory('sri-1', 'actor')).rejects.toMatchObject({
        code: 'ITEM_NOT_APPROVED',
      });
      expect(prisma.inventoryItem.create).not.toHaveBeenCalled();
    },
  );

  it('item APROBADA → crea InventoryItem y marca convertida_inventario', async () => {
    const { svc, prisma, created } = build({ itemStatus: 'aprobada' });
    const res = await svc.convertToInventory('sri-1', 'actor');
    // v1.51.18 (fase 8): la respuesta gana `pendingPublish` (deep-link de M5 a la cola de M1) y
    // `alreadyConverted`. Aquí el puerto NO está cableado (test unitario), así que el degradado
    // honesto es «no sé»: `['location','price']`. **Jamás `[]`**, que significaría «ya está a la
    // venta» y sacaría la pieza de la pantalla que existe para encontrarla.
    expect(res).toEqual({
      inventoryItemId: 'inv-1',
      folio: 'INV-000001',
      alreadyConverted: false,
      pendingPublish: { missing: ['location', 'price'] },
    });
    expect(prisma.inventoryItem.create).toHaveBeenCalledTimes(1);
    expect(created.id).toBe('inv-1');
    // 💰 v1.82.1 · §PNL.10.3 (E-3): la carta se escribe con CAS — `aprobada` ∧ sin pieza — nunca por `id` a secas.
    expect(prisma.sellRequestItem.update).not.toHaveBeenCalled();
    expect(prisma.sellRequestItem.updateMany).toHaveBeenCalledWith({
      where: { id: 'sri-1', itemStatus: 'aprobada', inventoryItemId: null },
      data: { itemStatus: 'convertida_inventario', inventoryItemId: 'inv-1' },
    });
  });

  it('idempotencia: item ya convertido (inventoryItemId set) NO dispara la guardia', async () => {
    // Aunque itemStatus ya sea 'convertida_inventario' (≠ 'aprobada'), el pre-check de
    // idempotencia gana y devuelve el inventoryItemId existente, sin lanzar 422.
    const { svc, prisma } = build({ itemStatus: 'convertida_inventario', inventoryItemId: 'inv-existing' });
    const res = await svc.convertToInventory('sri-1', 'actor');
    expect(res).toEqual({
      inventoryItemId: 'inv-existing',
      alreadyConverted: true,
      pendingPublish: { missing: ['location', 'price'] },
    });
    expect(prisma.inventoryItem.create).not.toHaveBeenCalled();
  });

  it('💰 §PNL.10.3 CAS no casa (un rechazo confirmó entre la lectura y la escritura) ⇒ 409 CONFLICT CONCURRENT_UPDATE, lanzado DENTRO de la tx', async () => {
    const { svc, prisma } = build({ itemStatus: 'aprobada' });
    prisma.sellRequestItem.updateMany.mockResolvedValueOnce({ count: 0 });
    // La relectura (dentro de la tx) ve la carta ya rechazada y sin pieza.
    prisma.sellRequestItem.findUnique
      .mockResolvedValueOnce({ id: 'sri-1', cardId: 'c1', productType: 'raw', rawCondition: 'NM', approvedPriceCents: 5000, quotedPriceCents: 5000, inventoryItemId: null, itemStatus: 'aprobada', card: {} })
      .mockResolvedValueOnce({ itemStatus: 'rechazada', inventoryItemId: null });
    let thrownInsideTx: unknown;
    prisma.$transaction.mockImplementationOnce(async (cb: any) => {
      try {
        return await cb(prisma);
      } catch (e) {
        thrownInsideTx = e;
        throw e;
      }
    });
    await expect(svc.convertToInventory('sri-1', 'actor')).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { itemId: 'sri-1', itemStatus: 'rechazada', reason: 'CONCURRENT_UPDATE' },
    });
    // Lanzar dentro del callback es lo que hace que Prisma deshaga la pieza y su movimiento.
    expect(thrownInsideTx).toBeDefined();
  });

  it('§PNL.10.3 CAS no casa pero la carta YA tiene pieza ⇒ la respuesta idempotente de siempre', async () => {
    const { svc, prisma } = build({ itemStatus: 'aprobada' });
    prisma.sellRequestItem.updateMany.mockResolvedValueOnce({ count: 0 });
    prisma.sellRequestItem.findUnique
      .mockResolvedValueOnce({ id: 'sri-1', cardId: 'c1', productType: 'raw', rawCondition: 'NM', approvedPriceCents: 5000, quotedPriceCents: 5000, inventoryItemId: null, itemStatus: 'aprobada', card: {} })
      .mockResolvedValueOnce({ itemStatus: 'convertida_inventario', inventoryItemId: 'inv-other' });
    await expect(svc.convertToInventory('sri-1', 'actor')).resolves.toEqual({
      inventoryItemId: 'inv-other',
      alreadyConverted: true,
      pendingPublish: { missing: ['location', 'price'] },
    });
  });
});
