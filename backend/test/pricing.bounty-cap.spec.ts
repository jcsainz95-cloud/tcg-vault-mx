import { ConfigService } from '@nestjs/config';
import { BuylistService } from '../src/modules/buylist/buylist.service';
import { AdminBountiesService } from '../src/modules/pricing/admin-bounties.service';
import { composeVariantPricing } from '../src/modules/pricing/variant-pricing';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { UsersService } from '../src/modules/users/users.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { buildGradeKey, tryBuildGradeKey } from '../src/modules/pricing/pricing.types';
import { DEFAULT_PRICING_CURVE, PricingCurve } from '../src/common/pricing-curve';
import { variantKey } from '../src/common/variant-key';

/**
 * v1.80 — TOPE DE PAGO DEL BOUNTY en las superficies de LECTURA (API_CONTRACT §M2-B.11 puntos 3 y 5):
 *  - el composer (`VariantPricingDTO.bounty.payoutCents` / `cappedByMarket`, `buy.effectiveCents`),
 *  - la vitrina pública (`PublicBountyDTO.bountyPriceCents` = lo que se paga, orden por el pago),
 *  - la consola (`price_desc` / `attention_first` ordenan por `payoutCents ?? bountyPriceCents`).
 * Versión SIN infra de BC-8/BC-10; la de Postgres real vive en `test/integration/bounty-cap.e2e-spec.ts`.
 */

/** 20 % plano, bin $1: mercado 10000 ⇒ curva 2000; mercado 2000 ⇒ curva 400; mercado 1000 ⇒ 200. */
const CURVE_20: PricingCurve = {
  ...DEFAULT_PRICING_CURVE,
  buy: { binCents: 100, points: [{ marketCents: 100000, pctBp: 2000 }] },
};

function m30(over: Record<string, unknown> = {}): any {
  return {
    id: 'vpo-1',
    cardId: 'c1',
    productType: 'raw',
    gradeKey: 'raw:NM',
    finish: 'normal',
    sellOverrideCents: null,
    buyOverrideCents: null,
    bountyEnabled: true,
    bountyPriceCents: 1200,
    bountyTargetQty: 2,
    bountyAcquiredQty: 0,
    bountyCompletedAt: null,
    bountyUnpublishedAt: null,
    updatedBy: 'admin-1',
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    ...over,
  };
}

const priced = (cents: number) => ({ status: 'priced', referenceMxnCents: cents }) as any;

describe('composer — VariantPricingDTO.bounty.payoutCents / cappedByMarket (§M2-B.11 punto 5)', () => {
  it('bounty 1200 / mercado 1000 ⇒ paga 1000, topado; `priceCents` sigue siendo lo configurado', () => {
    const dto = composeVariantPricing(priced(1000), CURVE_20, m30({ bountyPriceCents: 1200 }));
    expect(dto.bounty).toMatchObject({ priceCents: 1200, effective: true, payoutCents: 1000, cappedByMarket: true });
    expect(dto.buy).toMatchObject({ source: 'bounty', effectiveCents: 1000 });
  });

  it('bounty < mercado ⇒ paga el bounty, NO topado', () => {
    const dto = composeVariantPricing(priced(1000), CURVE_20, m30({ bountyPriceCents: 800 }));
    expect(dto.bounty).toMatchObject({ payoutCents: 800, cappedByMarket: false });
    expect(dto.buy.effectiveCents).toBe(800);
  });

  it('empate bounty == mercado ⇒ paga ese número, `cappedByMarket = false`', () => {
    const dto = composeVariantPricing(priced(1000), CURVE_20, m30({ bountyPriceCents: 1000 }));
    expect(dto.bounty).toMatchObject({ payoutCents: 1000, cappedByMarket: false });
  });

  it('sin mercado ⇒ paga el bounty completo; mercado 0 (degenerado) ⇒ igual', () => {
    for (const ref of [null, { status: 'pending' } as any, priced(0)]) {
      const dto = composeVariantPricing(ref, CURVE_20, m30({ bountyPriceCents: 5000 }));
      expect(dto.bounty).toMatchObject({ effective: true, payoutCents: 5000, cappedByMarket: false });
      expect(dto.buy.effectiveCents).toBe(5000);
    }
  });

  it('bounty NO efectivo (rebasado) ⇒ `payoutCents: null`, `cappedByMarket: false`', () => {
    // mercado 10000 ⇒ curva 2000; bounty 1500 < curva y < mercado ⇒ rebasado.
    const dto = composeVariantPricing(priced(10000), CURVE_20, m30({ bountyPriceCents: 1500 }));
    expect(dto.bounty).toMatchObject({ effective: false, payoutCents: null, cappedByMarket: false });
    expect(dto.buy.source).toBe('market');
  });

  it('bounty apagado ⇒ no paga: `payoutCents: null`', () => {
    const dto = composeVariantPricing(priced(1000), CURVE_20, m30({ bountyEnabled: false, bountyPriceCents: 1200 }));
    expect(dto.bounty).toMatchObject({ effective: false, payoutCents: null, cappedByMarket: false });
  });

  it('para TODA fila efectiva, `payoutCents === buy.effectiveCents` (una sola cifra, dos lecturas)', () => {
    for (const [market, b] of [
      [1000, 1200],
      [1000, 800],
      [500, 650],
      [10000, 30000],
    ]) {
      const dto = composeVariantPricing(priced(market), CURVE_20, m30({ bountyPriceCents: b }));
      expect(dto.buy.source).toBe('bounty');
      expect(dto.bounty!.payoutCents).toBe(dto.buy.effectiveCents);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Vitrina pública (sin infra).
// ---------------------------------------------------------------------------------------------

const pii = new PiiCryptoService(new ConfigService({}));

function buylistOf(rows: any[], markets: Record<string, number>, curve: PricingCurve) {
  const findMany = jest.fn(async () => rows);
  const svc = new BuylistService(
    { variantPriceOverride: { findMany } } as unknown as PrismaService,
    {
      gradeKeyFor: (i: any) => buildGradeKey(i),
      tryGradeKeyFor: (i: any) => tryBuildGradeKey(i),
      loadPricingCurve: jest.fn(async () => curve),
      getReferencesBatch: jest.fn(async (keys: any[]) => {
        const m = new Map<string, any>();
        for (const k of keys) if (markets[k.cardId] != null) m.set(variantKey(k), priced(markets[k.cardId]));
        return m;
      }),
    } as unknown as PricingService,
    { getNumber: jest.fn(async () => 100_000_000) } as unknown as SettingsService,
    {} as UsersService,
    pii,
  );
  return svc;
}

const showcaseRow = (cardId: string, bountyPriceCents: number) => ({
  ...m30({ id: `vpo-${cardId}`, cardId, bountyPriceCents }),
  card: { name: `Carta ${cardId}`, number: '1', rarity: 'Rare', imageSmallUrl: null, set: { name: 'Set' } },
});

describe('vitrina — `bountyPriceCents` publicado ES lo que se paga (§M2-B.11 punto 5, criterio 91)', () => {
  it('bounty 1200 / mercado 1000 ⇒ la vitrina publica 1000 (el configurado NO sale)', async () => {
    const svc = buylistOf([showcaseRow('c1', 1200)], { c1: 1000 }, CURVE_20);
    const { data } = await svc.publicBounties();
    expect(data).toHaveLength(1);
    expect(data[0].bountyPriceCents).toBe(1000);
    // Ningún campo delata el tope (misma forma del DTO).
    expect(Object.keys(data[0]).sort()).toEqual(
      ['cardId', 'bountyPriceCents', 'finish', 'name', 'number', 'rarity', 'remainingQty', 'setName', 'targetQty'].sort(),
    );
    expect(JSON.stringify(data)).not.toContain('1200');
  });

  it('sin mercado ⇒ publica el bounty completo', async () => {
    const svc = buylistOf([showcaseRow('c1', 5000)], {}, CURVE_20);
    expect((await svc.publicBounties()).data[0].bountyPriceCents).toBe(5000);
  });

  it('BC-10 — ordena por LO QUE SE PAGA: A (5000/mercado 2000 ⇒ 2000) va DESPUÉS de B (3000/mercado 10000 ⇒ 3000)', async () => {
    // El query llega ordenado por lo CONFIGURADO (A antes que B): la vitrina debe re-ordenar.
    const svc = buylistOf([showcaseRow('A', 5000), showcaseRow('B', 3000)], { A: 2000, B: 10000 }, CURVE_20);
    const { data } = await svc.publicBounties();
    expect(data.map((d) => [d.cardId, d.bountyPriceCents])).toEqual([
      ['B', 3000],
      ['A', 2000],
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// Consola — orden por `payoutCents ?? bountyPriceCents`.
// ---------------------------------------------------------------------------------------------

function consoleOf(rows: any[], markets: Record<string, number>, curve: PricingCurve) {
  const withCards = rows.map((r) => ({
    ...r,
    card: {
      id: r.cardId,
      setId: 'set-1',
      name: `Carta ${r.cardId}`,
      number: r.cardId,
      rarity: 'Rare',
      rarityCanonical: 'rara',
      imageSmallUrl: null,
      set: { id: 'set-1', name: 'Set' },
    },
  }));
  const prisma = { variantPriceOverride: { findMany: jest.fn(async () => withCards) } } as unknown as PrismaService;
  const pricing = {
    loadPricingCurve: jest.fn(async () => curve),
    getReferencesBatch: jest.fn(async (keys: any[]) => {
      const m = new Map<string, any>();
      for (const k of keys) if (markets[k.cardId] != null) m.set(variantKey(k), priced(markets[k.cardId]));
      return m;
    }),
  } as unknown as PricingService;
  return new AdminBountiesService(prisma, pricing);
}

describe('consola — orden por lo que se paga (espejo exacto de la vitrina)', () => {
  const rows = [m30({ id: 'vpo-A', cardId: 'A', bountyPriceCents: 5000 }), m30({ id: 'vpo-B', cardId: 'B', bountyPriceCents: 3000 })];
  const markets = { A: 2000, B: 10000 };

  it.each(['price_desc', 'attention_first'] as const)('`%s` ⇒ B (paga 3000) antes que A (paga 2000)', async (sort) => {
    const svc = consoleOf(rows, markets, CURVE_20);
    const res = await svc.list({ page: 1, pageSize: 20, sort });
    expect(res.data.map((d) => d.cardId)).toEqual(['B', 'A']);
    const a = res.data.find((d) => d.cardId === 'A')!;
    expect(a.state).toBe('activa'); // ⛔ el tope NO cambia `state`
    expect(a.pricing.bounty).toMatchObject({ priceCents: 5000, payoutCents: 2000, cappedByMarket: true });
    expect(res.counts.activa).toBe(2);
  });

  it('una fila que NO paga ordena por lo configurado (`payoutCents ?? bountyPriceCents`)', async () => {
    // C: bounty 2500 con mercado 20000 ⇒ curva 4000 ⇒ rebasado (no paga) ⇒ llave 2500, entre B y A.
    const svc = consoleOf([...rows, m30({ id: 'vpo-C', cardId: 'C', bountyPriceCents: 2500 })], { ...markets, C: 20000 }, CURVE_20);
    const res = await svc.list({ page: 1, pageSize: 20, sort: 'price_desc' });
    expect(res.data.map((d) => d.cardId)).toEqual(['B', 'C', 'A']);
  });
});
