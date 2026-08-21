import { OrdersService } from './orders.service';
import { PricingService } from '../pricing/pricing.service';

/**
 * BE-26 (money-safety) — `salePriceOf` rechaza un precio de venta <= 0 (no solo `== null`): una
 * regla `fixed:0` producía `salePriceCents === 0` y creaba una línea a $0. El catálogo ya exige
 * `> 0` para publicar; aquí se alinea la ruta de Compra (session) con `PRICE_PENDING`.
 */
function build(pricingOver: Partial<PricingService>) {
  const pricing = pricingOver as unknown as PricingService;
  const svc = new OrdersService({} as never, pricing, {} as never, {} as never, {} as never);
  return svc;
}

const rawItem = {
  id: 'it-1',
  folio: 'F-001',
  productType: 'raw',
  finish: 'normal',
  cardId: 'card-1',
  listPriceCents: null,
  card: { rarity: 'Common' },
} as any;

describe('BE-26 — salePriceOf rechaza precio <= 0', () => {
  const baseline = {
    gradeKeyFor: jest.fn().mockReturnValue('raw:NM'),
    getReference: jest.fn().mockResolvedValue({ status: 'priced', referenceMxnCents: 1000 }),
  };

  it('salePriceCents === 0 → lanza PRICE_PENDING (no crea línea a $0)', async () => {
    const svc = build({
      ...baseline,
      computeSalePriceForItem: jest.fn().mockResolvedValue({ salePriceCents: 0, status: 'priced' }),
    } as any);
    await expect((svc as any).salePriceOf(rawItem)).rejects.toMatchObject({ code: 'PRICE_PENDING' });
  });

  it('salePriceCents negativo → lanza PRICE_PENDING', async () => {
    const svc = build({
      ...baseline,
      computeSalePriceForItem: jest.fn().mockResolvedValue({ salePriceCents: -5, status: 'priced' }),
    } as any);
    await expect((svc as any).salePriceOf(rawItem)).rejects.toMatchObject({ code: 'PRICE_PENDING' });
  });

  it('salePriceCents === null → lanza PRICE_PENDING (comportamiento previo intacto)', async () => {
    const svc = build({
      ...baseline,
      computeSalePriceForItem: jest.fn().mockResolvedValue({ salePriceCents: null, status: 'pending' }),
    } as any);
    await expect((svc as any).salePriceOf(rawItem)).rejects.toMatchObject({ code: 'PRICE_PENDING' });
  });

  it('salePriceCents positivo → OK (devuelve el precio)', async () => {
    const svc = build({
      ...baseline,
      computeSalePriceForItem: jest.fn().mockResolvedValue({ salePriceCents: 500, status: 'priced' }),
    } as any);
    await expect((svc as any).salePriceOf(rawItem)).resolves.toBe(500);
  });

  it('override listPriceCents > 0 gana sin tocar el pricing (regresión del guard existente)', async () => {
    const svc = build({ ...baseline, computeSalePriceForItem: jest.fn() } as any);
    await expect((svc as any).salePriceOf({ ...rawItem, listPriceCents: 700 })).resolves.toBe(700);
  });
});
