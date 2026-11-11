/**
 * d9-formula-version.e2e-spec.ts — D9 §8.2 (D9-1/I1) contra Postgres REAL: la versión de la fórmula de `P`
 * (`listing_price_formula_version`) decide si la tienda usa las filas de `ListingPrice` o calcula EN VIVO.
 *  - Sin versión guardada (el despliegue de D9) una fila vieja de 10000 NO se exhibe ni se cobra: manda el cálculo vivo.
 *  - `formulaTick()` recalcula todo una vez, escribe la versión al final y desde entonces manda la fila.
 *  - Un segundo tic con la versión vigente no hace nada. Determinista (N=1 por caso).
 */
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { E2E_FOLIOS } from '../../prisma/e2e-fixtures';
import { SettingsService } from '../../src/modules/settings/settings.service';
import { ListingPriceService, LISTING_PRICE_FORMULA_VERSION_KEY, formulaVersionOf } from '../../src/modules/pricing/listing-price.service';

jest.setTimeout(120_000);

const RUN = Date.now().toString(36);
const ADDRESS = {
  line1: 'Av. Reforma 100', line2: 'Depto 3', neighborhood: 'Juárez', city: 'Ciudad de México', state: 'CDMX',
  postalCode: '06600', country: 'MX', recipientName: 'Invitado D9', phone: '5512345678',
};

describe('D9 §8.2 · recálculo de ListingPrice por versión de fórmula (Postgres real)', () => {
  let h: E2EHarness;
  let svc: ListingPriceService;
  let itemId: string;
  const quote = async () => {
    svc.resetFormulaStaleCache();
    const q = await h.api('POST', '/checkout/guest/quote', { json: { inventoryItemIds: [itemId], shippingAddress: ADDRESS } });
    expect(q.status).toBe(200);
    return q.body.items[0].unitPriceCents as number;
  };

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    svc = h.app.get(ListingPriceService);
    const tpl = await h.prisma.inventoryItem.findUnique({ where: { folio: E2E_FOLIOS.listedCharizard } });
    const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = tpl as never as Record<string, unknown>;
    void _id; void _c; void _u;
    itemId = (await h.prisma.inventoryItem.create({ data: { ...(rest as object), folio: `E2E-D9V-${RUN}`, status: 'listed' } as never })).id;
  });
  afterAll(async () => {
    await h?.close();
  });

  it('sin versión guardada, la fila vieja (10000) no se cobra: manda el cálculo vivo; tras el tic se cobra la fila nueva', async () => {
    await svc.run('manual_price', [itemId]);
    const fresh = await h.prisma.listingPrice.findUniqueOrThrow({ where: { inventoryItemId: itemId } });
    const P = fresh.unitPriceCents!;
    expect(P).toBeGreaterThan(10_000);
    await h.prisma.listingPrice.update({ where: { inventoryItemId: itemId }, data: { unitPriceCents: 10_000 } }); // la fila de ANTES de D9
    await h.prisma.configSetting.deleteMany({ where: { key: LISTING_PRICE_FORMULA_VERSION_KEY } });
    expect(await quote()).toBe(P); // vivo, no 10000

    expect((await svc.formulaTick()).status).toBe('ran');
    const row = await h.prisma.listingPrice.findUniqueOrThrow({ where: { inventoryItemId: itemId } });
    expect(row.unitPriceCents).toBe(P); // recalculada
    const ver = await h.prisma.configSetting.findUniqueOrThrow({ where: { key: LISTING_PRICE_FORMULA_VERSION_KEY } });
    expect((ver.valueJson as { v: string }).v).toBe(formulaVersionOf(await h.app.get(SettingsService).getIvaDials()));
    expect(await quote()).toBe(P);
  });

  it('con la versión vigente manda la FILA (exhibido = cobrado) y un segundo tic no recalcula', async () => {
    await h.prisma.listingPrice.update({ where: { inventoryItemId: itemId }, data: { unitPriceCents: 10_000 } });
    expect(await quote()).toBe(10_000); // la fila manda mientras la versión es la vigente
    expect((await svc.formulaTick()).status).toBe('current');
    expect((await h.prisma.listingPrice.findUniqueOrThrow({ where: { inventoryItemId: itemId } })).unitPriceCents).toBe(10_000); // no se tocó
  });
  const versionRow = () => h.prisma.configSetting.findUnique({ where: { key: LISTING_PRICE_FORMULA_VERSION_KEY } });

  it('D9-6: una corrida FALLIDA no escribe la versión (el siguiente tic reintenta)', async () => {
    await h.prisma.configSetting.deleteMany({ where: { key: LISTING_PRICE_FORMULA_VERSION_KEY } });
    const spy = jest
      .spyOn(svc, 'run')
      .mockResolvedValueOnce({ runId: 'x', trigger: 'dial_change', status: 'failed', scopeItemCount: 1, pricedCount: 0, pendingCount: 0, skippedCount: 0 });
    try {
      expect((await svc.formulaTick()).status).toBe('failed');
    } finally {
      spy.mockRestore();
    }
    expect(await versionRow()).toBeNull();
    expect((await svc.formulaTick()).status).toBe('ran'); // sin el doble, el tic completa y ahora sí escribe
    expect(await versionRow()).not.toBeNull();
  });

  it('D9-6: una pieza SALTADA por SKIP LOCKED (otra transacción la tiene) no deja escribir la versión; al soltarla, el tic repite y la escribe', async () => {
    await h.prisma.configSetting.deleteMany({ where: { key: LISTING_PRICE_FORMULA_VERSION_KEY } });
    await h.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "InventoryItem" WHERE id = ${itemId} FOR UPDATE`;
      expect((await svc.formulaTick()).status).toBe('partial');
      expect(await versionRow()).toBeNull();
    });
    expect((await svc.formulaTick()).status).toBe('ran');
    expect(await versionRow()).not.toBeNull();
  });
  it('isFormulaStale falla CERRADO: si no puede leer la versión, difiere (se calcula P en vivo) y no se queda cacheado', async () => {
    expect((await svc.formulaTick()).status).toMatch(/ran|current/);
    svc.resetFormulaStaleCache();
    expect(await svc.isFormulaStale()).toBe(false); // vigente
    svc.resetFormulaStaleCache();
    const spy = jest.spyOn(h.app.get(SettingsService), 'getIvaDials').mockRejectedValueOnce(new Error('lectura caída'));
    try {
      expect(await svc.isFormulaStale()).toBe(true);
    } finally {
      spy.mockRestore();
    }
    expect(await svc.isFormulaStale()).toBe(false); // la lectura volvió: no quedó el veredicto del fallo
  });
});
