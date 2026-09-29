import { PricingService } from '../src/modules/pricing/pricing.service';

/**
 * v1.80.2.2 — **D-4 (techlead, Baja, 2026-09-29)**: `PricingService.sealedSourceOnFor(items)` es el
 * ÚNICO sitio donde vive «el dial del sellado, UNA lectura por petición y solo si hay sellado que
 * gatear». Antes estaba copiado seis veces en los lectores de patrimonio de SK-5 (`admin.service.ts`
 * ×3, `vault.service.ts` ×2, `admin-vaults.service.ts` ×1) y `/vault/sealed` lo leía siempre. El
 * candado de forma (los lectores no llaman a `loadSealedSpreads` a mano) vive en VK-6
 * (`pricing.valuation-callers-census.spec.ts`); aquí se fija la CONDUCTA del helper.
 */
function pricingWith(sourceOn: boolean) {
  const loadSealedSpreads = jest.fn(async () => ({ spreadPctBySubtype: {}, fallbackPct: 25, sourceOn }));
  const svc = { loadSealedSpreads, sealedSourceOnFor: PricingService.prototype.sealedSourceOnFor } as unknown as PricingService;
  return { svc, loadSealedSpreads };
}

describe('PricingService.sealedSourceOnFor — el dial del sellado, una vez y solo si hace falta (D-4)', () => {
  it('sin sellado en el lote ⇒ `false` SIN leer ConfigSetting (cero llamadas a loadSealedSpreads)', async () => {
    const { svc, loadSealedSpreads } = pricingWith(true);
    await expect(svc.sealedSourceOnFor([{ productType: 'raw' }, { productType: 'graded' }])).resolves.toBe(false);
    await expect(svc.sealedSourceOnFor([])).resolves.toBe(false);
    expect(loadSealedSpreads).not.toHaveBeenCalled();
  });

  it.each([true, false])('con sellado en el lote ⇒ el `sourceOn` del dial (%p), leído UNA vez', async (dial) => {
    const { svc, loadSealedSpreads } = pricingWith(dial);
    const items = [{ productType: 'raw' as const }, { productType: 'sealed' as const }, { productType: 'sealed' as const }];
    await expect(svc.sealedSourceOnFor(items)).resolves.toBe(dial);
    expect(loadSealedSpreads).toHaveBeenCalledTimes(1);
  });

  it('el helper existe en el prototipo real (no solo en el doble)', () => {
    expect(typeof PricingService.prototype.sealedSourceOnFor).toBe('function');
  });
});
