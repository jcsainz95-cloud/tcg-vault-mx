import { OrdersService } from './orders.service';
import { PricingService } from '../pricing/pricing.service';
import { DEFAULT_PRICING_CURVE } from '../../common/pricing-curve';

/**
 * BE-26 (money-safety) — `salePriceOf` rechaza un precio de venta <= 0 (no solo `== null`): una
 * regla `fixed:0` producía `priceCents === 0` y creaba una línea a $0. El catálogo ya exige
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
    loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
    // v2.1.1 (§4.36.5b): el seam de VENTA devuelve una DECISIÓN (monto + veredicto). El mock usa
    // el CUERPO REAL (`PricingService.prototype`): es puro y no toca `this`, así que el test no
    // puede divergir de producción ni reimplementar la matemática.
    decideSalePrice: jest.fn(PricingService.prototype.decideSalePrice),
    gradeKeyFor: jest.fn().mockReturnValue('raw:NM'),
    getReference: jest.fn().mockResolvedValue({ status: 'priced', referenceMxnCents: 1000 }),
    // v1.28 (P-18): sin fila M-30 por default (comportamiento previo).
    getVariantOverride: jest.fn().mockResolvedValue(null),
  };

  it('salePriceCents === 0 → lanza PRICE_PENDING (no crea línea a $0)', async () => {
    const svc = build({
      ...baseline,
      computeSalePriceForItem: jest.fn().mockResolvedValue({ priceCents: 0, basis: 'market' }),
    } as any);
    await expect((svc as any).salePriceOf(rawItem)).rejects.toMatchObject({ code: 'PRICE_PENDING' });
  });

  it('salePriceCents negativo → lanza PRICE_PENDING', async () => {
    const svc = build({
      ...baseline,
      computeSalePriceForItem: jest.fn().mockResolvedValue({ priceCents: -5, basis: 'market' }),
    } as any);
    await expect((svc as any).salePriceOf(rawItem)).rejects.toMatchObject({ code: 'PRICE_PENDING' });
  });

  it('salePriceCents === null → lanza PRICE_PENDING (comportamiento previo intacto)', async () => {
    const svc = build({
      ...baseline,
      computeSalePriceForItem: jest.fn().mockResolvedValue({ priceCents: null, basis: 'pending' }),
    } as any);
    await expect((svc as any).salePriceOf(rawItem)).rejects.toMatchObject({ code: 'PRICE_PENDING' });
  });

  it('salePriceCents positivo → OK (devuelve el precio)', async () => {
    const svc = build({
      ...baseline,
      computeSalePriceForItem: jest.fn().mockResolvedValue({ priceCents: 500, basis: 'market' }),
    } as any);
    await expect((svc as any).salePriceOf(rawItem)).resolves.toBe(500);
  });

  it('override listPriceCents > 0 gana sin tocar el pricing (regresión del guard existente)', async () => {
    const svc = build({ ...baseline, computeSalePriceForItem: jest.fn() } as any);
    await expect((svc as any).salePriceOf({ ...rawItem, listPriceCents: 700 })).resolves.toBe(700);
  });
});
