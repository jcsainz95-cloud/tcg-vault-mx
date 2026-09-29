/**
 * ⭐ v1.80.7 (§3 `GET /vault/holdings`) — `HoldingDTO.withdrawableReason`: los cinco motivos, EL ORDEN de evaluación y
 * el invariante `withdrawable === (withdrawableReason === null)`, sobre el cuerpo puro (`withdrawableReasonOf`) y sobre
 * `holdings` (el DTO trae la clave siempre y el flag sale del mismo cuerpo).
 */
import { VaultService, withdrawableReasonOf } from '../src/modules/vault/vault.service';
import { withM61Defaults } from './helpers/m61-mock-defaults';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { DEFAULT_PRICING_CURVE } from '../src/common/pricing-curve';

const base = { ownershipStatus: 'settled' as const, status: 'in_custody' as const, hasOpenCase: false, shipmentState: null, originRefunding: false };

describe('withdrawableReasonOf — los cinco motivos y su orden (v1.80.7)', () => {
  it('retirable ⇔ null', () => {
    expect(withdrawableReasonOf(base)).toBeNull();
  });

  it.each([
    ['pending', { ownershipStatus: 'pending' as const }],
    ['replacing', { status: 'lost' as const, hasOpenCase: true }],
    ['replacing', { status: 'damaged' as const, hasOpenCase: true }],
    ['not_in_custody', { status: 'lost' as const }],
    ['not_in_custody', { status: 'withdrawn' as const }],
    ['in_withdrawal', { shipmentState: 'picking' as const }],
    ['origin_refunded', { originRefunding: true }],
  ])('%s', (reason, over) => {
    expect(withdrawableReasonOf({ ...base, ...over })).toBe(reason);
  });

  it('el ORDEN: la primera condición que falla nombra el motivo (pending > replacing/not_in_custody > in_withdrawal > origin_refunded)', () => {
    const all = { ownershipStatus: 'pending' as const, status: 'lost' as const, hasOpenCase: true, shipmentState: 'picking' as const, originRefunding: true };
    expect(withdrawableReasonOf(all)).toBe('pending');
    expect(withdrawableReasonOf({ ...all, ownershipStatus: 'settled' })).toBe('replacing');
    expect(withdrawableReasonOf({ ...all, ownershipStatus: 'settled', hasOpenCase: false })).toBe('not_in_custody');
    expect(withdrawableReasonOf({ ...all, ownershipStatus: 'settled', status: 'in_custody' })).toBe('in_withdrawal');
    expect(withdrawableReasonOf({ ...all, ownershipStatus: 'settled', status: 'in_custody', shipmentState: null })).toBe('origin_refunded');
  });

  it('un caso abierto sin `lost|damaged` NO es `replacing`: el caso solo explica el estado', () => {
    expect(withdrawableReasonOf({ ...base, hasOpenCase: true })).toBeNull();
    expect(withdrawableReasonOf({ ...base, hasOpenCase: true, shipmentState: 'guia' })).toBe('in_withdrawal');
  });
});

describe('VaultService.holdings — `withdrawableReason` viaja siempre y el flag sale del mismo cuerpo', () => {
  const card = { id: 'c1', externalId: 'x1', name: 'Pikachu', number: '58', rarity: 'Common', supertype: 'Pokémon', subtypes: null, setId: 's1', imageSmallUrl: null, imageLargeUrl: null, availableFinishes: ['normal'], set: { name: 'Base Set' } };
  const item = (over: Record<string, unknown>) => ({ id: 'i1', folio: 'INV-1', cardId: 'c1', productType: 'raw', rawCondition: 'NM', finish: 'normal', gradingCompany: null, gradeValue: null, ownershipStatus: 'settled', status: 'in_custody', card, ...over });
  function makeService(items: any[], active: any[], openCases: any[] = []) {
    const prisma: any = {
      inventoryItem: { findMany: jest.fn().mockResolvedValue(items) },
      shipmentItem: { findMany: jest.fn().mockResolvedValue(active) },
      replacementCase: { findMany: jest.fn().mockResolvedValue(openCases) },
    };
    const pricing = {
      loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
      decideSalePrice: jest.fn(PricingService.prototype.decideSalePrice),
      gradeKeyFor: jest.fn().mockReturnValue('raw:NM'),
      tryGradeKeyFor: jest.fn().mockReturnValue('raw:NM'),
      getReference: jest.fn().mockResolvedValue({ status: 'priced', referenceMxnCents: 12500, capturedDate: '2026-08-13' }),
      getPricedRawFinishesBatch: jest.fn(async () => new Map()),
    } as unknown as PricingService;
    return new VaultService(withM61Defaults(prisma) as PrismaService, pricing);
  }

  it.each([
    ['retirable', item({}), [], [], null],
    ['pending', item({ ownershipStatus: 'pending' }), [], [], 'pending'],
    ['replacing', item({ status: 'lost' }), [], [{ originalInventoryItemId: 'i1', missingReason: 'not_found', openedAt: new Date() }], 'replacing'],
    ['not_in_custody', item({ status: 'damaged' }), [], [], 'not_in_custody'],
    ['in_withdrawal', item({}), [{ inventoryItemId: 'i1', shipmentRequestId: 's1', shipmentRequest: { status: 'picking' } }], [], 'in_withdrawal'],
  ])('%s ⇒ `withdrawableReason` y el invariante', async (_n, it_, active, cases, reason) => {
    const res = await makeService([it_], active, cases).holdings('u1');
    expect(res.data[0]).toHaveProperty('withdrawableReason', reason);
    expect(res.data[0].withdrawable).toBe(reason === null);
  });
});
