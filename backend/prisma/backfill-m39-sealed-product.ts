/**
 * Backfill M-39 (v1.39-sealed-product-module, P-38 · ARCHITECTURE §4.34e pasos 7-8) — money-safe.
 *
 * Corre DESPUÉS de aplicar la migración `20260823120000_m39_sealed_product` (el paso 6 —siembra de
 * `SealedSetGroup(set_main)` desde `CardSet.tcgcsvGroupId`— ya lo hizo la migración en SQL). Aquí:
 *  - PASO 7 (cura del ETB→Tropius): deriva `SealedProduct` de los items sellados YA MAPEADOS y liga su
 *    `InventoryItem.sealedProductId` a la presentación REAL («ETB …»), no a la carta Tropius.
 *  - PASO 8: los sellados SIN MAPEO (tcgplayerProductId null) quedan `sealedProductId=null` + reporte de
 *    reconciliación (cero adivinación; nunca inventa precio).
 *
 * IDEMPOTENTE: puede correrse varias veces sin efectos dobles (upsert + solo liga items sin FK). No
 * corre en la migración misma porque `ALTER TYPE ADD VALUE` no puede USARSE en su propia transacción y
 * la derivación necesita la heurística `inferSealedSubtype`. Uso: `ts-node prisma/backfill-m39-sealed-product.ts`.
 */
import { PrismaClient } from '@prisma/client';
import { SealedProductService } from '../src/modules/inventory/sealed-product.service';

async function main() {
  const prisma = new PrismaClient();
  // El backfill NO usa el provider TCGCSV ni FxService (no fabrica precio); se pasan stubs.
  const svc = new SealedProductService(prisma as never, {} as never, {} as never);
  try {
    const report = await svc.backfillFromInventory();
    // eslint-disable-next-line no-console
    console.log(
      `M-39 backfill OK: ${report.productsCreated} SealedProduct creados, ${report.itemsLinked} piezas ` +
        `ligadas (ETB→Tropius curado), ${report.unmappedItems.length} piezas SIN MAPEO quedan null.`,
    );
    if (report.unmappedItems.length > 0) {
      // eslint-disable-next-line no-console
      console.log(
        'Reconciliación (re-curar con el nuevo flujo sync → seleccionar SealedProduct → re-mapear):\n' +
          report.unmappedItems.map((u) => `  - folio ${u.folio} (cardId ${u.cardId})`).join('\n'),
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('M-39 backfill FALLÓ:', e);
  process.exit(1);
});
