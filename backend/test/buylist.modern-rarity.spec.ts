import { BuylistService } from '../src/modules/buylist/buylist.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { UsersService } from '../src/modules/users/users.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { ConfigService } from '@nestjs/config';

/**
 * v1.1 — AcquisitionPricer con rarezas modernas (ARCHITECTURE §4.2):
 *  - cualquier rareza por encima de común/reverse → ex_plus (40% de la referencia).
 *  - default ex_plus para rarezas NO listadas (Illustration Rare, Special Illustration Rare,
 *    Full Art, Alternate Art, Trainer Gallery, Character Rare, Radiant, etc.).
 *  - ex_plus se cotiza sola si HAY market price; solo sin dato de mercado → precio_pendiente.
 */

const pii = new PiiCryptoService(new ConfigService({}));

function svcWith(rarityMap: Record<string, string>, referenceMxnCents: number | null): BuylistService {
  const prisma: any = {
    card: { findUnique: jest.fn().mockResolvedValue({ id: 'c1', rarity: 'Illustration Rare' }) },
  };
  const pricing = {
    gradeKeyFor: jest.fn().mockReturnValue('raw:NM'),
    getReference: jest.fn().mockResolvedValue(
      referenceMxnCents == null ? { status: 'pending' } : { status: 'priced', referenceMxnCents },
    ),
    escalatePending: jest.fn(),
  } as unknown as PricingService;
  const settings = { getRaw: jest.fn().mockResolvedValue(rarityMap) } as unknown as SettingsService;
  return new BuylistService(prisma as PrismaService, pricing, settings, {} as UsersService, pii);
}

describe('BuylistService.categoryForRarity — default ex_plus para rarezas modernas', () => {
  it('rareza moderna NO listada → ex_plus (EX o superior por defecto)', async () => {
    const svc = svcWith({ Common: 'comun', Uncommon: 'comun', 'Reverse Holo': 'reverse_holo' }, 12500);
    expect(await svc.categoryForRarity('Illustration Rare')).toBe('ex_plus');
    expect(await svc.categoryForRarity('Special Illustration Rare')).toBe('ex_plus');
    expect(await svc.categoryForRarity('Trainer Gallery Rare Holo')).toBe('ex_plus');
    expect(await svc.categoryForRarity('Radiant Rare')).toBe('ex_plus');
    expect(await svc.categoryForRarity(null)).toBe('ex_plus');
  });

  it('común/reverse solo si la tabla lo dice explícitamente', async () => {
    const svc = svcWith({ Common: 'comun', 'Reverse Holo': 'reverse_holo' }, 12500);
    expect(await svc.categoryForRarity('Common')).toBe('comun');
    expect(await svc.categoryForRarity('Reverse Holo')).toBe('reverse_holo');
  });
});

describe('BuylistService.publicQuote — ex_plus moderna', () => {
  it('rareza moderna CON market price → cotiza sola = 40% de la referencia (NM)', async () => {
    const svc = svcWith({ Common: 'comun' }, 12500);
    const q = await svc.publicQuote('c1', 'raw', 'NM');
    expect(q.category).toBe('ex_plus');
    expect(q.quote.status).toBe('cotizada');
    expect(q.quote.quotedPriceCents).toBe(5000); // 40% de 12500
  });

  it('rareza moderna SIN market data → precio_pendiente (lado adquisición, no al comprador)', async () => {
    const svc = svcWith({ Common: 'comun' }, null);
    const q = await svc.publicQuote('c1', 'raw', 'NM');
    expect(q.category).toBe('ex_plus');
    expect(q.quote.status).toBe('precio_pendiente');
    expect(q.quote.quotedPriceCents).toBeNull();
  });
});
