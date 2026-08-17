import { CatalogSyncService } from '../src/modules/catalog/catalog-sync.service';
import { CatalogPriceSyncJobService } from '../src/jobs/catalog-price-sync.service';

/**
 * WS-A (v1.14-price-ingest, §4.15g / DEV-5): `catalog-sync` volvió a ser SOLO metadata; el poblado
 * de `PriceReference` (v1.12) se MOVIÓ a `price-ingest` (ver test/price-ingest.*.spec.ts).
 *
 * El job `catalog-price-sync` queda DEPRECADO en su rol de pricing pero SE CONSERVA para importar
 * metadata de sets nuevos vía `syncAll({force:true})`; este test protege esa delegación.
 */
describe('CatalogPriceSyncJobService — invoca el re-sync (metadata) con force:true', () => {
  it('run() delega en CatalogSyncService.syncAll({ force: true }) y devuelve su shape', async () => {
    const syncAll = jest.fn(async () => ({ jobId: 'catalog-sync-all-1', setsQueued: 42, remaining: 0 }));
    const catalogSync = { syncAll } as unknown as CatalogSyncService;
    const job = new CatalogPriceSyncJobService(catalogSync);

    const res = await job.run();
    expect(syncAll).toHaveBeenCalledTimes(1);
    expect(syncAll).toHaveBeenCalledWith({ force: true });
    expect(res).toEqual({ jobId: 'catalog-sync-all-1', setsQueued: 42, remaining: 0 });
  });
});
