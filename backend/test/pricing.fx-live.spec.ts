import { PricingService } from '../src/modules/pricing/pricing.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { FxService } from '../src/modules/pricing/fx.service';
import { computeSealedSalePrice, usdToMxnCents } from '../src/common/money';

/**
 * FX AL VUELO (dinero — crítica). Demuestra que la REFERENCIA DE MERCADO en USD se valúa con la FX
 * VIGENTE al momento de leerla (getReference/getReferencesBatch), no con el priceMxnCents congelado
 * en la ingesta. Cambiar la tasa mueve el precio SIN re-sincronizar. Invariantes money-safe:
 *  - override manual (MXN, priceUsdCents=null) → CONGELADO.
 *  - proveedor nativo en MXN (priceUsdCents=null) → CONGELADO.
 *  - fallo de FX → cae al último priceMxnCents válido (nunca rompe la valuación).
 *  - sellado: mercado×spread se aplica sobre el mercado ya convertido con la FX vigente.
 */

type Ref = {
  cardId: string;
  productType: string;
  gradeKey: string;
  finish: string;
  priceMxnCents: number;
  priceUsdCents: number | null;
  isManualOverride: boolean;
  source: string;
  capturedDate: Date;
};

function build(ref: Ref | null, fx: { rate: number; bufferPct: number } | Error) {
  const findFirst = jest.fn(async () => ref);
  const findMany = jest.fn(async () => (ref ? [ref] : []));
  const prisma = {
    priceReference: { findFirst, findMany },
  } as unknown as PrismaService;
  const getCurrent = jest.fn(async () => {
    if (fx instanceof Error) throw fx;
    return { rate: fx.rate, bufferPct: fx.bufferPct, source: 'manual', effectiveDate: '2026-08-19' };
  });
  const fxSvc = { getCurrent } as unknown as FxService;
  const svc = new PricingService(
    prisma,
    {} as SettingsService,
    fxSvc,
    {} as any,
    {} as any,
    {} as any,
  );
  return { svc, getCurrent };
}

function usdRef(over: Partial<Ref> = {}): Ref {
  return {
    cardId: 'c1',
    productType: 'raw',
    gradeKey: 'raw:NM',
    finish: 'normal',
    priceMxnCents: 18000, // congelado en la ingesta (rate 18)
    priceUsdCents: 1000, // $10.00 USD
    isManualOverride: false,
    source: 'pokemontcg_io',
    capturedDate: new Date('2026-08-19'),
    ...over,
  };
}

describe('FX al vuelo — getReference recalcula el MXN con la tasa vigente', () => {
  it('referencia de MERCADO en USD → se convierte con la FX vigente, NO con el priceMxnCents congelado', async () => {
    const { svc } = build(usdRef(), { rate: 20, bufferPct: 0 });
    const info = await svc.getReference('c1', 'raw' as any, 'raw:NM', 'normal');
    // usdToMxnCents(1000, 20, 0) = 20000 ≠ 18000 congelado.
    expect(info.referenceMxnCents).toBe(usdToMxnCents(1000, 20, 0));
    expect(info.referenceMxnCents).toBe(20000);
  });

  it('cambiar la tasa cambia el MXN valuado SIN re-ingesta (misma fila PriceReference)', async () => {
    const ref = usdRef();
    const cheap = build(ref, { rate: 20, bufferPct: 0 });
    const dear = build(ref, { rate: 25, bufferPct: 10 });
    const a = await cheap.svc.getReference('c1', 'raw' as any, 'raw:NM', 'normal');
    const b = await dear.svc.getReference('c1', 'raw' as any, 'raw:NM', 'normal');
    expect(a.referenceMxnCents).toBe(20000);
    expect(b.referenceMxnCents).toBe(usdToMxnCents(1000, 25, 10)); // 27500
    expect(b.referenceMxnCents).toBe(27500);
    expect(b.referenceMxnCents).not.toBe(a.referenceMxnCents);
  });

  it('override manual (MXN, priceUsdCents=null, isManualOverride=true) → CONGELADO, ignora la FX', async () => {
    const { svc } = build(
      usdRef({ priceUsdCents: null, isManualOverride: true, priceMxnCents: 50000, source: 'manual' }),
      { rate: 25, bufferPct: 10 },
    );
    const info = await svc.getReference('c1', 'raw' as any, 'raw:NM', 'normal');
    expect(info.referenceMxnCents).toBe(50000);
  });

  it('proveedor nativo en MXN (priceUsdCents=null, sin override) → CONGELADO', async () => {
    const { svc } = build(
      usdRef({ priceUsdCents: null, isManualOverride: false, priceMxnCents: 9000 }),
      { rate: 25, bufferPct: 0 },
    );
    const info = await svc.getReference('c1', 'raw' as any, 'raw:NM', 'normal');
    expect(info.referenceMxnCents).toBe(9000);
  });

  it('money-safe: si FX falla, cae al último priceMxnCents válido (no rompe la valuación)', async () => {
    const { svc } = build(usdRef(), new Error('Banxico down'));
    const info = await svc.getReference('c1', 'raw' as any, 'raw:NM', 'normal');
    expect(info.status).toBe('priced');
    expect(info.referenceMxnCents).toBe(18000); // fallback congelado
  });

  it('money-safe: tasa inválida (<=0) → fallback congelado (market > 0 siempre)', async () => {
    const { svc } = build(usdRef(), { rate: 0, bufferPct: 0 });
    const info = await svc.getReference('c1', 'raw' as any, 'raw:NM', 'normal');
    expect(info.referenceMxnCents).toBe(18000);
  });

  it('getReferencesBatch aplica la MISMA FX viva por lote', async () => {
    const { svc } = build(usdRef(), { rate: 20, bufferPct: 0 });
    const map = await svc.getReferencesBatch([
      { cardId: 'c1', productType: 'raw' as any, gradeKey: 'raw:NM', finish: 'normal' as any },
    ]);
    expect(map.get('c1|raw|raw:NM|normal')?.referenceMxnCents).toBe(20000);
  });
});

describe('FX al vuelo — SELLADO: mercado×spread sobre el mercado convertido con la FX vigente', () => {
  it('el spread se aplica al mercado YA convertido con la tasa vigente (no al MXN congelado)', async () => {
    // Referencia de mercado del sellado (TCGCSV = USD). Congelado 9000 (rate 18); USD 500 = $5.00.
    const sealedRef = usdRef({
      productType: 'sealed',
      gradeKey: 'sealed:tcg:12345',
      priceMxnCents: 9000,
      priceUsdCents: 500,
      source: 'tcgcsv',
    });
    const { svc } = build(sealedRef, { rate: 20, bufferPct: 10 });
    const marketInfo = await svc.getReference('c1', 'sealed' as any, 'sealed:tcg:12345', 'normal');
    const liveMarket = usdToMxnCents(500, 20, 10); // 11000, no 9000
    expect(marketInfo.referenceMxnCents).toBe(liveMarket);

    // Autoprecio (mercado × spread) sobre el mercado VIVO.
    const sale = computeSealedSalePrice(null, 'box', liveMarket, { box: 20 }, 0);
    expect(sale.salePriceCents).toBe(Math.round(liveMarket * 1.2)); // 13200
    // Con el MXN congelado (9000) habría dado 10800 — se demuestra la diferencia.
    expect(sale.salePriceCents).not.toBe(Math.round(9000 * 1.2));
  });
});
