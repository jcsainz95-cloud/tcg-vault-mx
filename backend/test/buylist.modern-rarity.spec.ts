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
): { svc: BuylistService; escalatePending: jest.Mock } {
  const prisma: any = {
    card: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'c1',
        rarity: cardRarity,
        // v1.6-finish: acabados disponibles para poder cotizar en holofoil en los tests.
        availableFinishes: ['normal', 'reverse_holo', 'holofoil', 'first_edition_holofoil'],
      }),
    },
  };
  const escalatePending = jest.fn().mockResolvedValue(undefined);
  const pricing = {
    gradeKeyFor: jest.fn().mockReturnValue('raw:NM'),
    getReference: jest.fn().mockResolvedValue(
      referenceMxnCents == null ? { status: 'pending' } : { status: 'priced', referenceMxnCents },
    ),
    escalatePending,
    // v1.28 (P-18): controles por variante — sin filas M-30 por default (comportamiento previo).
    getVariantOverridesBatch: jest.fn(async () => new Map()),
    getVariantOverride: jest.fn(async () => null),
  } as unknown as PricingService;
  const settings = {
    getRaw: jest.fn().mockResolvedValue(rules),
    getNumber: jest.fn().mockResolvedValue(fallbackPct),
  } as unknown as SettingsService;
  const svc = new BuylistService(prisma as PrismaService, pricing, settings, {} as UsersService, pii);
  return { svc, escalatePending };
}

describe('BuylistService.publicQuote — rareza moderna via fallback %', () => {
  it('rareza moderna SIN regla explícita, CON referencia → fallback 40% (appliedRule pct, source fallback)', async () => {
    const { svc } = svcWith({ Common: { mode: 'fixed', value: 50 } }, 40, 12500, 'Illustration Rare');
    const q = await svc.publicQuote('c1', 'raw', 'NM');
    expect(q.rarity).toBe('Illustration Rare');
    expect(q.appliedRule).toEqual({ mode: 'pct', value: 40, source: 'fallback' });
    expect(q.quote.status).toBe('cotizada');
    expect(q.quote.quotedPriceCents).toBe(5000); // 40% de 12500
  });

  it('rareza moderna SIN referencia → precio_pendiente (lado adquisición, nunca al comprador)', async () => {
    const { svc } = svcWith({ Common: { mode: 'fixed', value: 50 } }, 40, null, 'Special Illustration Rare');
    const q = await svc.publicQuote('c1', 'raw', 'NM');
    expect(q.appliedRule.source).toBe('fallback');
    expect(q.quote.status).toBe('precio_pendiente');
    expect(q.quote.quotedPriceCents).toBeNull();
  });

  it('regla fixed (Common) cotiza SIN necesidad de referencia', async () => {
    const { svc } = svcWith({ Common: { mode: 'fixed', value: 50 } }, 40, null, 'Common');
    const q = await svc.publicQuote('c1', 'raw', 'NM');
    expect(q.appliedRule).toEqual({ mode: 'fixed', value: 50, source: 'rule' });
    expect(q.quote.status).toBe('cotizada');
    expect(q.quote.quotedPriceCents).toBe(50);
  });

  it('regla pct explícita distinta del fallback (granularidad por rareza)', async () => {
    const { svc } = svcWith({ 'Secret Rare': { mode: 'pct', value: 35 } }, 40, 20000, 'Secret Rare');
    const q = await svc.publicQuote('c1', 'raw', 'NM');
    expect(q.appliedRule).toEqual({ mode: 'pct', value: 35, source: 'rule' });
    expect(q.quote.quotedPriceCents).toBe(7000); // 35% de 20000
  });
});

/**
 * Fase 0.1 — bug de dinero: raras VALIOSAS en holofoil NO deben cotizar al bin fijo barato de bulk.
 * Antes, una rareza premium sin "holo" en el string (Illustration/Ultra/Double Rare, etc.) resolvía
 * a `['Holo']` y, con una regla "Holo" fija barata configurada, una chase de miles de pesos cotizaba
 * a ese precio de bulk. Ahora la rareza real va primero y las premium NUNCA incluyen "Holo".
 */
describe('BuylistService.publicQuote — Fase 0.1: premium en holofoil no cae a bulk fijo "Holo"', () => {
  // Regla "Holo" fija BARATA de bulk (MX$1.50) — la trampa que las premium deben esquivar.
  const cheapHolo: Record<string, BuylistRule> = { Holo: { mode: 'fixed', value: 150 } };

  it('Illustration Rare + holofoil → NO usa "Holo" fija barata; cae al fallback pct sobre market holofoil', async () => {
    const { svc } = svcWith(cheapHolo, 40, 500000, 'Illustration Rare');
    const q = await svc.publicQuote('c1', 'raw', 'NM', 'holofoil');
    expect(q.appliedRule).toEqual({ mode: 'pct', value: 40, source: 'fallback' });
    expect(q.quote.status).toBe('cotizada');
    expect(q.quote.quotedPriceCents).toBe(200000); // 40% de 5000.00, NO los 1.50 de "Holo"
  });

  it('Ultra Rare + holofoil → usa su regla explícita si existe (nunca la fija barata "Holo")', async () => {
    const { svc } = svcWith(
      { ...cheapHolo, 'Ultra Rare': { mode: 'pct', value: 50 } },
      40,
      300000,
      'Ultra Rare',
    );
    const q = await svc.publicQuote('c1', 'raw', 'NM', 'holofoil');
    expect(q.appliedRule).toEqual({ mode: 'pct', value: 50, source: 'rule' });
    expect(q.quote.quotedPriceCents).toBe(150000); // 50% de 3000.00
  });

  it('Double Rare (= ex) + holofoil SIN referencia → precio_pendiente (fallback pct), NO la fija barata', async () => {
    const { svc } = svcWith(cheapHolo, 40, null, 'Double Rare');
    const q = await svc.publicQuote('c1', 'raw', 'NM', 'holofoil');
    expect(q.appliedRule).toEqual({ mode: 'pct', value: 40, source: 'fallback' });
    expect(q.quote.status).toBe('precio_pendiente');
    expect(q.quote.quotedPriceCents).toBeNull();
  });

  it('Rare Holo VMAX (premium con "holo" en string) + holofoil → NO usa "Holo" fija barata', async () => {
    const { svc } = svcWith(cheapHolo, 40, 800000, 'Rare Holo VMAX');
    const q = await svc.publicQuote('c1', 'raw', 'NM', 'holofoil');
    expect(q.appliedRule).toEqual({ mode: 'pct', value: 40, source: 'fallback' });
    expect(q.quote.quotedPriceCents).toBe(320000); // 40% de 8000.00
  });

  it('Rare Holo (NO premium, bulk) + holofoil SÍ puede usar la regla sintética "Holo"', async () => {
    const { svc } = svcWith(cheapHolo, 40, 500000, 'Rare Holo');
    const q = await svc.publicQuote('c1', 'raw', 'NM', 'holofoil');
    expect(q.appliedRule).toEqual({ mode: 'fixed', value: 150, source: 'rule' });
    expect(q.quote.status).toBe('cotizada');
    expect(q.quote.quotedPriceCents).toBe(150); // bulk holo: MX$1.50 vía "Holo"
  });
});

/**
 * v1.12-catalog-pricing (§4.13b) — `publicQuote` vuelve a READ-ONLY (cierra BE-16, supersede la
 * Fase 0.2). Un endpoint público/anónimo NO debe escribir en la cola de trabajo del dueño: con el
 * catálogo completo ya priceado durante el `catalog-sync` (§4.13a), el quote LEE la referencia y,
 * si el acabado sigue `precio_pendiente`, lo REPORTA sin encolar `PendingPriceEntry`. La escalada
 * queda SOLO en el flujo autenticado `createRequest` (POST /buylist/requests).
 */
describe('BuylistService.publicQuote — v1.12: read-only, NO crea PendingPriceEntry (cierra BE-16)', () => {
  it('precio_pendiente → NO llama escalatePending (endpoint anónimo no escribe la cola)', async () => {
    const { svc, escalatePending } = svcWith({}, 40, null, 'Illustration Rare');
    const q = await svc.publicQuote('c1', 'raw', 'NM', 'holofoil');
    expect(q.quote.status).toBe('precio_pendiente');
    // El quote reporta el pendiente pero NO lo persiste (read-only).
    expect(escalatePending).not.toHaveBeenCalled();
  });

  it('cotizada (con referencia) → tampoco encola pendiente', async () => {
    const { svc, escalatePending } = svcWith({}, 40, 500000, 'Illustration Rare');
    const q = await svc.publicQuote('c1', 'raw', 'NM', 'holofoil');
    expect(q.quote.status).toBe('cotizada');
    expect(escalatePending).not.toHaveBeenCalled();
  });
});
