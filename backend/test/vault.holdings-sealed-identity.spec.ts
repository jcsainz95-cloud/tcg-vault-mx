import { VaultService } from '../src/modules/vault/vault.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { DEFAULT_PRICING_CURVE } from '../src/common/pricing-curve';

/**
 * v1.42 (BLOQ-2a, §4.34a) — `GET /vault/holdings` pinta el SELLADO con su identidad real (mata «Tropius»
 * en «Mis piezas»). Para productType='sealed' el holding gana `sealedProductId`/`sealedProductName`/
 * `sealedImageUrl`/`sealedSubtype`/`sealedCondition`, resueltos server-side por la cascada (snapshot
 * por-pieza → Card ancla). Ausentes en raw/graded. Display-only: `referenceValue`/portafolio intactos.
 */
describe('VaultService.holdings — identidad de sellado (BLOQ-2a)', () => {
  const cardAncla = {
    id: 'c1',
    externalId: 'x1',
    name: 'Tropius', // carta ancla del set (NO debe pintarse para el sellado)
    number: '1',
    rarity: 'Common',
    supertype: 'Pokémon',
    subtypes: null,
    setId: 's1',
    imageSmallUrl: 'http://img/tropius.png',
    imageLargeUrl: 'http://img/tropius-l.png',
    availableFinishes: ['normal'],
    set: { name: 'Obsidian Flames' },
  };

  function makeService(items: any[]) {
    const prisma: any = {
      inventoryItem: { findMany: jest.fn().mockResolvedValue(items) },
      shipmentItem: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const pricing = {
      loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
      // v2.1.1 (§4.36.5b): el seam de VENTA devuelve una DECISIÓN (monto + veredicto). El mock usa
      // el CUERPO REAL (`PricingService.prototype`): es puro y no toca `this`, así que el test no
      // puede divergir de producción ni reimplementar la matemática.
      decideSalePrice: jest.fn(PricingService.prototype.decideSalePrice),
      gradeKeyFor: jest.fn().mockReturnValue('sealed:tcg:42'),
      getReference: jest
        .fn()
        .mockResolvedValue({ status: 'priced', referenceMxnCents: 92681, capturedDate: '2026-08-13' }),
      getPricedRawFinishesBatch: jest.fn(async () => new Map()),
    } as unknown as PricingService;
    return { svc: new VaultService(prisma as PrismaService, pricing), prisma };
  }

  const sealedItem = (over: Record<string, unknown> = {}) => ({
    id: 'i-sealed',
    folio: 'INV-000456',
    cardId: 'c1',
    productType: 'sealed',
    rawCondition: null,
    finish: 'normal',
    gradingCompany: null,
    gradeValue: null,
    ownershipStatus: 'settled',
    status: 'in_custody',
    sealedProductId: 'sp_1',
    sealedProductName: 'Obsidian Flames Elite Trainer Box',
    sealedImageUrl: 'http://img/etb.jpg',
    sealedSubtype: 'etb',
    sealedCondition: 'mint',
    card: cardAncla,
    ...over,
  });

  it('un holding sellado pinta el ETB (nombre e imagen), NO la carta ancla Tropius', async () => {
    const { svc } = makeService([sealedItem()]);
    const res = await svc.holdings('u1');
    const h = res.data[0] as any;
    expect(h.productType).toBe('sealed');
    expect(h.sealedProductId).toBe('sp_1');
    expect(h.sealedProductName).toBe('Obsidian Flames Elite Trainer Box');
    expect(h.sealedProductName).not.toBe('Tropius');
    expect(h.sealedImageUrl).toBe('http://img/etb.jpg');
    expect(h.sealedSubtype).toBe('etb');
    expect(h.sealedCondition).toBe('mint');
    // `card` se conserva (pertenencia al set + fallback).
    expect(h.card.name).toBe('Tropius');
    // Money-safe: la valuación no cambia (el sellado entra por su referencia).
    expect(res.portfolio.totalValueMxnCents).toBe(92681);
  });

  it('sellado legacy sin snapshot → cascada cae a Card.name/imagen ancla (nunca null en el nombre)', async () => {
    const { svc } = makeService([
      sealedItem({ sealedProductId: null, sealedProductName: null, sealedImageUrl: null }),
    ]);
    const h = (await svc.holdings('u1')).data[0] as any;
    expect(h.sealedProductId).toBeNull();
    expect(h.sealedProductName).toBe('Tropius'); // fallback Card.name (NOT NULL)
    expect(h.sealedImageUrl).toBe('http://img/tropius.png'); // fallback Card.imageSmallUrl
  });

  it('un holding RAW NO trae los campos de sellado (ausentes)', async () => {
    const { svc } = makeService([
      {
        id: 'i-raw',
        folio: 'INV-000001',
        cardId: 'c1',
        productType: 'raw',
        rawCondition: 'NM',
        finish: 'normal',
        gradingCompany: null,
        gradeValue: null,
        ownershipStatus: 'settled',
        status: 'in_custody',
        // aun si la fila trajera columnas de sellado, no se emiten para raw:
        sealedProductId: null,
        sealedProductName: null,
        card: cardAncla,
      },
    ]);
    const h = (await svc.holdings('u1')).data[0] as any;
    expect(h.productType).toBe('raw');
    expect('sealedProductId' in h).toBe(false);
    expect('sealedProductName' in h).toBe(false);
    expect('sealedImageUrl' in h).toBe(false);
    expect('sealedSubtype' in h).toBe(false);
    expect('sealedCondition' in h).toBe(false);
  });
});
