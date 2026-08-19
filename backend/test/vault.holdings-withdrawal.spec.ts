import { VaultService } from '../src/modules/vault/vault.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';

/**
 * v1.17 — Ciclo de retiro visible en la bóveda (API_CONTRACT §3):
 *  - HoldingDTO gana `shipmentState`/`activeShipmentId`/`withdrawable`, derivados del join
 *    InventoryItem → ShipmentItem → ShipmentRequest ACTIVO (una sola consulta batch, sin N+1).
 *  - Los items `withdrawn` (entregados) NO se listan ni cuentan en el portafolio.
 *  - Los items con envío activo SÍ se listan, SÍ cuentan, y NO son retirables.
 */
describe('VaultService.holdings — estado de retiro (v1.17)', () => {
  const card = {
    id: 'c1',
    externalId: 'x1',
    name: 'Pikachu',
    number: '58',
    rarity: 'Common',
    supertype: 'Pokémon',
    subtypes: null,
    setId: 's1',
    imageSmallUrl: 'http://img/small.png',
    imageLargeUrl: 'http://img/large.png',
    availableFinishes: ['normal'],
    set: { name: 'Base Set' },
  };

  function makeItem(over: Record<string, unknown>) {
    return {
      id: 'i1',
      folio: 'INV-000001',
      cardId: 'c1',
      productType: 'raw',
      rawCondition: 'NM',
      finish: 'normal',
      gradingCompany: null,
      gradeValue: null,
      ownershipStatus: 'settled',
      status: 'in_custody',
      card,
      ...over,
    };
  }

  function makeService(items: any[], activeShipmentItems: any[]) {
    const prisma: any = {
      inventoryItem: { findMany: jest.fn().mockResolvedValue(items) },
      shipmentItem: { findMany: jest.fn().mockResolvedValue(activeShipmentItems) },
    };
    const pricing = {
      gradeKeyFor: jest.fn().mockReturnValue('raw:NM'),
      getReference: jest
        .fn()
        .mockResolvedValue({ status: 'priced', referenceMxnCents: 12500, capturedDate: '2026-08-13' }),
      // v1.22-2 / N-15: displayFinishes se deriva de este lote (default vacío = sin supresión).
      getPricedRawFinishesBatch: jest.fn(async () => new Map()),
    } as unknown as PricingService;
    const svc = new VaultService(prisma as PrismaService, pricing);
    return { svc, prisma };
  }

  it('la query excluye status=withdrawn (los entregados salen de la bóveda)', async () => {
    const { svc, prisma } = makeService([], []);
    await svc.holdings('u1');
    const where = prisma.inventoryItem.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ ownerType: 'customer', ownerUserId: 'u1' });
    expect(where.status).toEqual({ not: 'withdrawn' });
  });

  it('item sin envío activo → withdrawable=true, shipmentState=null', async () => {
    const { svc } = makeService([makeItem({})], []);
    const res = await svc.holdings('u1');
    expect(res.data[0].shipmentState).toBeNull();
    expect(res.data[0].activeShipmentId).toBeNull();
    expect(res.data[0].withdrawable).toBe(true);
    // Cuenta en el portafolio.
    expect(res.portfolio.totalValueMxnCents).toBe(12500);
  });

  it('item con envío ACTIVO → shipmentState/activeShipmentId, withdrawable=false, pero SÍ cuenta', async () => {
    const { svc } = makeService(
      [makeItem({ id: 'i1' })],
      [{ inventoryItemId: 'i1', shipmentRequestId: 'shp1', shipmentRequest: { status: 'picking' } }],
    );
    const res = await svc.holdings('u1');
    expect(res.data[0].shipmentState).toBe('picking');
    expect(res.data[0].activeShipmentId).toBe('shp1');
    expect(res.data[0].withdrawable).toBe(false);
    // Sigue siendo del cliente hasta la entrega → SÍ cuenta en el portafolio.
    expect(res.portfolio.totalValueMxnCents).toBe(12500);
  });

  it('el join de envíos activos filtra por las 4 etapas activas y hace UNA sola consulta batch', async () => {
    const { svc, prisma } = makeService([makeItem({ id: 'i1' }), makeItem({ id: 'i2' })], []);
    await svc.holdings('u1');
    expect(prisma.shipmentItem.findMany).toHaveBeenCalledTimes(1);
    const where = prisma.shipmentItem.findMany.mock.calls[0][0].where;
    expect(where.inventoryItemId).toEqual({ in: ['i1', 'i2'] });
    expect(where.shipmentRequest.status.in).toEqual(['solicitado', 'picking', 'guia', 'enviado']);
  });

  it('item pending nunca es retirable (aunque no tenga envío)', async () => {
    const { svc } = makeService([makeItem({ ownershipStatus: 'pending' })], []);
    const res = await svc.holdings('u1');
    expect(res.data[0].withdrawable).toBe(false);
  });

  it('item settled pero lost/damaged (sin envío) → withdrawable=false pero SIGUE en la bóveda (v1.17.1 §3)', async () => {
    // read=write: `classifyItems` exige status==='in_custody'; un settled `lost`/`damaged`
    // sigue listándose (solo `withdrawn` se excluye) pero NO es retirable.
    const { svc } = makeService(
      [
        makeItem({ id: 'i1', status: 'lost' }),
        makeItem({ id: 'i2', status: 'damaged' }),
      ],
      [],
    );
    const res = await svc.holdings('u1');
    expect(res.data).toHaveLength(2);
    expect(res.data[0].status).toBe('lost');
    expect(res.data[0].withdrawable).toBe(false);
    expect(res.data[1].status).toBe('damaged');
    expect(res.data[1].withdrawable).toBe(false);
    // Siguen contando en el portafolio (solo `withdrawn` se excluye del total).
    expect(res.portfolio.totalValueMxnCents).toBe(25000);
  });

  it('sin items → no consulta el join (evita query innecesaria)', async () => {
    const { svc, prisma } = makeService([], []);
    await svc.holdings('u1');
    expect(prisma.shipmentItem.findMany).not.toHaveBeenCalled();
  });
});

describe('VaultService.costBasisCents — excluye withdrawn (v1.17)', () => {
  it('agrega solo items no retirados', async () => {
    const prisma: any = {
      inventoryItem: { aggregate: jest.fn().mockResolvedValue({ _sum: { acquisitionCostCents: 400000 } }) },
    };
    const svc = new VaultService(prisma as PrismaService, {} as PricingService);
    const res = await svc.costBasisCents('u1');
    expect(res).toBe(400000);
    const where = prisma.inventoryItem.aggregate.mock.calls[0][0].where;
    expect(where.status).toEqual({ not: 'withdrawn' });
  });
});
