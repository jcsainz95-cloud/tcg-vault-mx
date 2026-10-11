import { PricingService } from '../src/modules/pricing/pricing.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { FxService } from '../src/modules/pricing/fx.service';

/**
 * 💰 M-75 §PRE.B — `getReferencesBatch` ENVUELVE la lectura con el ÁRBITRO DE MEDIANA (ARCHITECTURE
 * §4.PRE (a)). Prueba a nivel de servicio (mock `$queryRaw`) de que:
 *  - el residuo aplanado `pokemontcg_io` NO corona (lo excluye el árbitro) aunque sea la fila top-ranked;
 *  - con tcgdex + cardmarket frescos, el precio es la MEDIANA en centavos, NO el residuo inflado;
 *  - con UNA sola fuente admitida (solo tcgcsv_singles) ⇒ mediana de una = esa fila = IDÉNTICO a hoy
 *    (invariante de compatibilidad legada);
 *  - el override MANUAL (tier 0) gana ABSOLUTO (el árbitro no lo toca).
 *
 * `{} as SettingsService` ⇒ `loadArbiterDialsSafe` cae al SEED (diales canónicos) — resiliente por
 * diseño (no rompe los mocks posicionales). `{} as FxService` ⇒ `fxSnapshotSafe=null` ⇒ `liveMxnCents`
 * devuelve `priceMxnCents` tal cual (congelado), que es lo que sembramos. Determinista (N=1).
 */
function build() {
  const queryRaw = jest.fn();
  const prisma = { priceReference: { findMany: jest.fn() }, $queryRaw: queryRaw } as unknown as PrismaService;
  const svc = new PricingService(prisma, {} as SettingsService, {} as FxService, {} as any, {} as any, {} as any);
  return { svc, queryRaw };
}

const KEY = { cardId: 'archaludon', productType: 'raw' as const, gradeKey: 'raw:NM', finish: 'holofoil' as const };
const fresh = new Date(); // hoy ⇒ dentro de la ventana de frescura (seed 7 días)
function row(source: string, priceMxnCents: number) {
  return { cardId: 'archaludon', productType: 'raw', gradeKey: 'raw:NM', finish: 'holofoil', priceMxnCents, priceUsdCents: null, isManualOverride: source === 'manual', source, capturedDate: fresh, cardProductId: null };
}

describe('getReferencesBatch — árbitro de mediana (M-75 §PRE.B, DINERO)', () => {
  it('EXCLUYE el residuo pokemontcg_io inflado; publica la MEDIANA de tcgdex+cardmarket (centavos)', async () => {
    const { svc, queryRaw } = build();
    // El bug: el residuo (10221¢ = MX$102) sería top-ranked si coronara. tcgdex 198¢ + cardmarket 202¢.
    queryRaw.mockResolvedValueOnce([row('pokemontcg_io', 10221), row('tcgdex', 198), row('cardmarket', 202)]);
    const res = await svc.getReferencesBatch([KEY]);
    const info = res.get('archaludon|raw|raw:NM|holofoil')!;
    expect(info.status).toBe('priced');
    expect(info.referenceMxnCents).toBe(200); // round((198+202)/2) — NO 10221
    expect(info.referenceMxnCents).toBeLessThan(1000);
    expect(info.source).not.toBe('pokemontcg_io'); // el residuo no es la fuente representativa
  });

  it('INVARIANTE LEGADA: solo tcgcsv_singles ⇒ mediana de una = esa fila (idéntico a hoy)', async () => {
    const { svc, queryRaw } = build();
    queryRaw.mockResolvedValueOnce([row('tcgcsv_singles', 777)]);
    const res = await svc.getReferencesBatch([KEY]);
    const info = res.get('archaludon|raw|raw:NM|holofoil')!;
    expect(info.referenceMxnCents).toBe(777);
    expect(info.source).toBe('tcgcsv_singles');
  });

  it('residuo + tcgcsv (misma familia tcgplayer): el residuo NO vota ⇒ gana tcgcsv, no el inflado', async () => {
    const { svc, queryRaw } = build();
    queryRaw.mockResolvedValueOnce([row('pokemontcg_io', 10221), row('tcgcsv_singles', 185)]);
    const res = await svc.getReferencesBatch([KEY]);
    expect(res.get('archaludon|raw|raw:NM|holofoil')!.referenceMxnCents).toBe(185);
  });

  it('override MANUAL (tier 0) gana ABSOLUTO — el árbitro no lo toca', async () => {
    const { svc, queryRaw } = build();
    // Manual 5000¢ + un tcgdex barato: el manual debe ganar (decisión humana, §4.27f-2).
    queryRaw.mockResolvedValueOnce([row('manual', 5000), row('tcgdex', 198)]);
    const res = await svc.getReferencesBatch([KEY]);
    const info = res.get('archaludon|raw|raw:NM|holofoil')!;
    expect(info.referenceMxnCents).toBe(5000);
    expect(info.source).toBe('manual');
  });
});

describe('promoteRobustReference — candado money-safe (errata E): NUNCA una fila de mercado $0', () => {
  it('priceMxnCents <= 0 ⇒ LANZA (defensa en profundidad del escritor de accept)', async () => {
    const { svc } = build();
    await expect(
      svc.promoteRobustReference({ cardId: 'c1', productType: 'raw', gradeKey: 'raw:NM', finish: 'holofoil', priceMxnCents: 0, source: 'tcgdex' }),
    ).rejects.toThrow(/> 0/);
    await expect(
      svc.promoteRobustReference({ cardId: 'c1', productType: 'raw', gradeKey: 'raw:NM', finish: 'holofoil', priceMxnCents: -5, source: 'tcgdex' }),
    ).rejects.toThrow(/> 0/);
  });
  it('source "manual" ⇒ LANZA (accept no congela)', async () => {
    const { svc } = build();
    await expect(
      svc.promoteRobustReference({ cardId: 'c1', productType: 'raw', gradeKey: 'raw:NM', finish: 'holofoil', priceMxnCents: 200, source: 'manual' }),
    ).rejects.toThrow(/manual/);
  });
});
