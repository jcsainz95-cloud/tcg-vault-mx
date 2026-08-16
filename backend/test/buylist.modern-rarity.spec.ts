import { BuylistService } from '../src/modules/buylist/buylist.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { UsersService } from '../src/modules/users/users.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { ConfigService } from '@nestjs/config';
import { BuylistRule } from '../src/common/money';

/**
 * v1.3.1 — AcquisitionPricer por RAREZA OFICIAL (ARCHITECTURE §4.2). El cotizador resuelve el
 * monto por la regla de la rareza real de la carta (`Card.rarity`):
 *  - una rareza SIN regla explícita cae al fallback % (default 40%) → reproduce el ex_plus previo;
 *  - las rarezas modernas (Illustration Rare, Special Illustration Rare, etc.) cotizan como % si
 *    hay referencia, y quedan `precio_pendiente` sólo si falta la referencia;
 *  - una regla `fixed` cotiza siempre (no depende de la referencia).
 */

const pii = new PiiCryptoService(new ConfigService({}));

function svcWith(
  rules: Record<string, BuylistRule>,
  fallbackPct: number,
  referenceMxnCents: number | null,
  cardRarity: string | null = 'Illustration Rare',
): BuylistService {
  const prisma: any = {
    card: { findUnique: jest.fn().mockResolvedValue({ id: 'c1', rarity: cardRarity }) },
  };
  const pricing = {
    gradeKeyFor: jest.fn().mockReturnValue('raw:NM'),
    getReference: jest.fn().mockResolvedValue(
      referenceMxnCents == null ? { status: 'pending' } : { status: 'priced', referenceMxnCents },
    ),
    escalatePending: jest.fn(),
  } as unknown as PricingService;
  const settings = {
    getRaw: jest.fn().mockResolvedValue(rules),
    getNumber: jest.fn().mockResolvedValue(fallbackPct),
  } as unknown as SettingsService;
  return new BuylistService(prisma as PrismaService, pricing, settings, {} as UsersService, pii);
}

describe('BuylistService.publicQuote — rareza moderna via fallback %', () => {
  it('rareza moderna SIN regla explícita, CON referencia → fallback 40% (appliedRule pct, source fallback)', async () => {
    const svc = svcWith({ Common: { mode: 'fixed', value: 50 } }, 40, 12500, 'Illustration Rare');
    const q = await svc.publicQuote('c1', 'raw', 'NM');
    expect(q.rarity).toBe('Illustration Rare');
    expect(q.appliedRule).toEqual({ mode: 'pct', value: 40, source: 'fallback' });
    expect(q.quote.status).toBe('cotizada');
    expect(q.quote.quotedPriceCents).toBe(5000); // 40% de 12500
  });

  it('rareza moderna SIN referencia → precio_pendiente (lado adquisición, nunca al comprador)', async () => {
    const svc = svcWith({ Common: { mode: 'fixed', value: 50 } }, 40, null, 'Special Illustration Rare');
    const q = await svc.publicQuote('c1', 'raw', 'NM');
    expect(q.appliedRule.source).toBe('fallback');
    expect(q.quote.status).toBe('precio_pendiente');
    expect(q.quote.quotedPriceCents).toBeNull();
  });

  it('regla fixed (Common) cotiza SIN necesidad de referencia', async () => {
    const svc = svcWith({ Common: { mode: 'fixed', value: 50 } }, 40, null, 'Common');
    const q = await svc.publicQuote('c1', 'raw', 'NM');
    expect(q.appliedRule).toEqual({ mode: 'fixed', value: 50, source: 'rule' });
    expect(q.quote.status).toBe('cotizada');
    expect(q.quote.quotedPriceCents).toBe(50);
  });

  it('regla pct explícita distinta del fallback (granularidad por rareza)', async () => {
    const svc = svcWith({ 'Secret Rare': { mode: 'pct', value: 35 } }, 40, 20000, 'Secret Rare');
    const q = await svc.publicQuote('c1', 'raw', 'NM');
    expect(q.appliedRule).toEqual({ mode: 'pct', value: 35, source: 'rule' });
    expect(q.quote.quotedPriceCents).toBe(7000); // 35% de 20000
  });
});
