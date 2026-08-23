/**
 * Test unitario del PLANIFICADOR PURO de reset-db-keep-users.
 * No toca ninguna BD: sólo verifica la lista/orden de tablas y las guardas de parsing.
 * Importar el módulo NO ejecuta main() (guardado por require.main === module).
 */
import {
  buildDeletionPlan,
  parseArgs,
  parseDbName,
  OPERATIONAL_ORDER,
  CATALOG_ORDER,
  AUDIT_ORDER,
  LOCATION_ORDER,
  IDENTITY_PRESERVED,
  CONFIG_PRESERVED,
} from './reset-db-keep-users';

describe('reset-db-keep-users · planificador puro', () => {
  it('por defecto sólo borra el balde operativo (ni catálogo, ni audit, ni ubicaciones)', () => {
    const plan = buildDeletionPlan({ wipeCatalog: false, wipeAudit: false, wipeLocations: false });
    expect(plan).toEqual([...OPERATIONAL_ORDER]);
    expect(plan).not.toContain('auditLog');
    expect(plan).not.toContain('cardSet');
    expect(plan).not.toContain('vaultLocation');
  });

  it('NUNCA incluye identidad de usuario ni config crítica', () => {
    const plan = buildDeletionPlan({ wipeCatalog: true, wipeAudit: true, wipeLocations: true });
    for (const preserved of [...IDENTITY_PRESERVED, ...CONFIG_PRESERVED]) {
      expect(plan).not.toContain(preserved);
    }
  });

  it('los flags agregan sus baldes DESPUÉS del operativo (orden FK-seguro)', () => {
    const plan = buildDeletionPlan({ wipeCatalog: true, wipeAudit: true, wipeLocations: true });
    const firstCatalogIdx = plan.indexOf(CATALOG_ORDER[0]);
    const lastOperationalIdx = plan.indexOf(OPERATIONAL_ORDER[OPERATIONAL_ORDER.length - 1]);
    // Todo el operativo va antes del catálogo (los referrers del catálogo son operativos).
    expect(lastOperationalIdx).toBeLessThan(firstCatalogIdx);
    expect(plan).toContain(AUDIT_ORDER[0]);
    expect(plan).toContain(LOCATION_ORDER[0]);
  });

  it('respeta el invariante hijos-antes-que-padres en las cadenas FK clave', () => {
    const plan = buildDeletionPlan({ wipeCatalog: true, wipeAudit: false, wipeLocations: true });
    const before = (child: string, parent: string) =>
      expect(plan.indexOf(child)).toBeLessThan(plan.indexOf(parent));
    // Inventario
    before('inventoryMovement', 'inventoryItem');
    before('inventoryAdjustment', 'inventoryItem');
    before('orderItem', 'inventoryItem');
    before('shipmentItem', 'inventoryItem');
    before('dispute', 'inventoryItem');
    // Órdenes
    before('orderItem', 'order');
    before('orderAccessToken', 'order');
    before('shipmentItem', 'shipmentRequest');
    before('shipmentRequest', 'order');
    // Buylist
    before('sellRequestItem', 'sellRequest');
    // Catálogo
    before('cardProduct', 'card');
    before('priceReference', 'card');
    before('pendingPriceEntry', 'sealedProduct');
    before('sealedProduct', 'cardSet');
    before('sealedSetGroup', 'cardSet');
    before('card', 'cardSet');
    before('setValueSnapshot', 'cardSet');
    before('inventoryItem', 'card'); // pieza referencia a Card (Restrict)
    before('inventoryItem', 'vaultLocation'); // por prolijidad (locationId SetNull)
  });

  it('no tiene duplicados en el plan completo', () => {
    const plan = buildDeletionPlan({ wipeCatalog: true, wipeAudit: true, wipeLocations: true });
    expect(new Set(plan).size).toBe(plan.length);
  });

  it('parseDbName extrae el dbname de una URL postgres', () => {
    expect(parseDbName('postgresql://tcg:pw@localhost:5432/tcg_marketplace?schema=public')).toBe(
      'tcg_marketplace',
    );
    expect(parseDbName('postgres://u:p@host/otra_db')).toBe('otra_db');
    expect(parseDbName('no-es-url')).toBe('');
  });

  it('parseArgs lee el dbname posicional y los flags', () => {
    const cli = parseArgs(['tcg_marketplace', '--execute', '--wipe-catalog']);
    expect(cli.targetDb).toBe('tcg_marketplace');
    expect(cli.execute).toBe(true);
    expect(cli.wipeCatalog).toBe(true);
    expect(cli.wipeAudit).toBe(false);
    expect(cli.wipeLocations).toBe(false);
  });

  it('parseArgs sin posicional deja targetDb null (dispara la guarda b)', () => {
    expect(parseArgs(['--execute']).targetDb).toBeNull();
  });
});
