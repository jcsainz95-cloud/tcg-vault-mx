import { PriceIngestService } from '../src/modules/pricing/price-ingest.service';
import { InventoryPublishPort, VariantPublishRef } from '../src/modules/inventory/inventory-publish.port';
import * as fs from 'fs';
import * as path from 'path';

/**
 * v1.51.19 — **§4.39m.8: el disparador (c) desde `pricing`.**
 *
 * Dos productores, una forma: **el override** (acto puntual, una variante) y **el barrido** (ingesta
 * que puede resolver miles). Lo que se fija aquí:
 *  1. **UNA llamada con el conjunto** — el fan-out de N llamadas **no es una opción del diseño**.
 *  2. **Solo lo que el barrido REALMENTE escribió**, nunca «todas las variantes del set»: *repreciar
 *     algo que no se movió no vuelve publicable a nadie*.
 *  3. **⚠️ El consumidor es una HOJA, nunca `PricingService`**, y **`forwardRef` está prohibido**: el
 *     ciclo `Pricing → PORT → Inventory → Pricing` uniría los dos módulos de dinero.
 *  4. **Best-effort**: un fallo del disparo **no tumba la ingesta ni el override**, y lo que no se
 *     publique **queda en `pending-publish`** — la red.
 */

const SRC = path.join(__dirname, '..', 'src');
const read = (...p: string[]) => fs.readFileSync(path.join(SRC, ...p), 'utf8');

/**
 * ⚠️ Estas guardas miran **CÓDIGO, no prosa**. Sin quitar los comentarios, un fichero que *documenta*
 * «`forwardRef` está prohibido» fallaría el test que verifica que no se usa — y el arreglo obvio
 * (borrar la explicación) sería exactamente al revés de lo que queremos.
 */
const code = (...p: string[]) =>
  read(...p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

// =============================================================================================
describe('⚠️⚠️ (1) el consumidor es una HOJA del grafo — nunca `PricingService`', () => {
  it('`PricingService` NO inyecta el puerto (cerraría Pricing → PORT → Inventory → Pricing)', () => {
    expect(code('modules', 'pricing', 'pricing.service.ts')).not.toContain('INVENTORY_PUBLISH_PORT');
  });

  it('⛔ y `forwardRef` NO aparece en ninguno de los dos lados del puerto', () => {
    // *Un ciclo que se «arregla» con `forwardRef` sigue siendo un ciclo*, y aquí uniría los DOS
    // módulos de dinero justo por la frontera que el puerto existe para mantener abierta.
    for (const f of [
      ['modules', 'pricing', 'pricing.service.ts'],
      ['modules', 'pricing', 'pricing.controller.ts'],
      ['modules', 'pricing', 'price-ingest.service.ts'],
      ['modules', 'inventory', 'inventory.service.ts'],
      ['modules', 'inventory', 'inventory-publish.module.ts'],
      ['modules', 'inventory', 'inventory.module.ts'],
    ]) {
      expect(code(...f)).not.toContain('forwardRef');
    }
  });

  it('los consumidores son el HANDLER del override y el SERVICIO de ingesta, y nadie los inyecta', () => {
    expect(code('modules', 'pricing', 'pricing.controller.ts')).toContain('INVENTORY_PUBLISH_PORT');
    expect(code('modules', 'pricing', 'price-ingest.service.ts')).toContain('INVENTORY_PUBLISH_PORT');
    // `PricingController` es una hoja por construcción (nadie inyecta un controller). Y nada de lo
    // que `inventory` depende depende de `PriceIngestService`:
    expect(code('modules', 'inventory', 'inventory.service.ts')).not.toContain('PriceIngestService');
  });

  it('⚠️ `pricing` NO importa `InventoryModule`: solo el token @Global (§4.39f)', () => {
    for (const f of [
      ['modules', 'pricing', 'pricing.controller.ts'],
      ['modules', 'pricing', 'price-ingest.service.ts'],
      ['modules', 'pricing', 'pricing.module.ts'],
    ]) {
      expect(code(...f)).not.toMatch(/from '\.\.\/inventory\/inventory\.module'/);
      expect(code(...f)).not.toContain('InventoryService');
    }
  });
});

// =============================================================================================
describe('⚠️ (2) el barrido dispara UNA vez, con lo que REALMENTE escribió', () => {
  /** Doble mínimo: se ejercita `ingestSinglesForSet` a través de su colaborador de escritura. */
  function build() {
    const seen: VariantPublishRef[][] = [];
    const port: InventoryPublishPort = {
      reevaluateForPublication: jest.fn(async () => []),
      reevaluateVariantsForPublication: jest.fn(async (v: VariantPublishRef[]) => {
        seen.push(v);
        return [];
      }),
    };
    return { port, seen };
  }

  /** Invoca el helper privado con el mapa que construye el barrido. */
  async function fire(port: InventoryPublishPort, variants: VariantPublishRef[]) {
    const svc = Object.create(PriceIngestService.prototype) as PriceIngestService;
    Object.assign(svc, { inventoryPublish: port, logger: { log: jest.fn(), warn: jest.fn() } });
    const map = new Map(variants.map((v) => [`${v.cardId}|${v.finish}`, v]));
    await (svc as unknown as {
      triggerPublishForVariants(m: Map<string, VariantPublishRef>): Promise<void>;
    }).triggerPublishForVariants(map);
  }

  const v = (cardId: string, finish = 'normal') =>
    ({ cardId, productType: 'raw' as const, gradeKey: 'raw:NM', finish: finish as 'normal' });

  it('⚠️ N variantes ⇒ UNA llamada, no N (el fan-out no es una opción del diseño)', async () => {
    const { port, seen } = build();
    await fire(port, [v('c1'), v('c2'), v('c3')]);
    expect(port.reevaluateVariantsForPublication).toHaveBeenCalledTimes(1);
    expect(seen[0]).toHaveLength(3);
  });

  it('conjunto vacío ⇒ NO se llama al puerto', async () => {
    const { port } = build();
    await fire(port, []);
    expect(port.reevaluateVariantsForPublication).not.toHaveBeenCalled();
  });

  it('⚠️ si el puerto LANZA, la ingesta no se entera: los precios ya se persistieron', async () => {
    const port: InventoryPublishPort = {
      reevaluateForPublication: jest.fn(async () => []),
      reevaluateVariantsForPublication: jest.fn(async () => {
        throw new Error('inventory caído');
      }),
    };
    await expect(fire(port, [v('c1')])).resolves.toBeUndefined();
  });

  it('sin puerto cableado tampoco truena', async () => {
    const svc = Object.create(PriceIngestService.prototype) as PriceIngestService;
    Object.assign(svc, { inventoryPublish: undefined, logger: { log: jest.fn(), warn: jest.fn() } });
    await expect(
      (svc as unknown as { triggerPublishForVariants(m: Map<string, VariantPublishRef>): Promise<void> })
        .triggerPublishForVariants(new Map([['k', v('c1')]])),
    ).resolves.toBeUndefined();
  });
});

// =============================================================================================
describe('⚠️⚠️ (3) los DOS sentidos del barrido tienen alcances DISTINTOS, y a propósito', () => {
  const src = read('modules', 'pricing', 'price-ingest.service.ts');

  it('`reconcilePublishedPrices` (lo `listed` que se degrada) barre EL SET COMPLETO', () => {
    // Ahí *la ausencia es la señal*: el acabado que el proveedor DEJÓ de reportar.
    const body = src.slice(src.indexOf('private async reconcilePublishedPrices('));
    expect(body).toContain("status: 'listed'");
  });

  it('el disparo (lo `in_stock` que se vuelve publicable) pasa SOLO lo escrito', () => {
    // *Repreciar algo que no se movió no vuelve publicable a nadie*, y el candidato tiene que quedar
    // acotado por la ENTRADA, no por el catálogo.
    expect(src).toContain('triggerPublishForVariants(writtenVariants)');
    expect(src).toContain('rawVariantWritten(writtenVariants');
  });

  it('⚠️ y los DOS caminos de ingesta disparan: no media regla en uno y media en otro', () => {
    // `ingestSinglesForSet` (PRIMARIO tcgcsv) e `ingestForSet` (legacy PPT/pokemontcg.io).
    expect(src.split('triggerPublishForVariants(writtenVariants)')).toHaveLength(3);
    expect(src.split('rawVariantWritten(writtenVariants').length).toBeGreaterThanOrEqual(3);
  });

  it('⚠️ el `cardProductId` se OMITE en el disparo, y está dicho por qué', () => {
    // `BulkPriceRow.cardProductId` es el uuid de `CardProduct`; `InventoryItem.cardProductId` es el
    // `tcgplayerProductId` (Int). Pasar el uuid sería un **no-op silencioso que parece funcionar**.
    const body = src.slice(src.indexOf('private static rawVariantWritten('));
    expect(src.slice(0, src.indexOf('private static rawVariantWritten('))).toContain(
      'tcgplayerProductId',
    );
    expect(body.slice(0, body.indexOf('\n  }\n'))).not.toContain('cardProductId');
  });
});

// =============================================================================================
describe('⚠️ (4) el override dispara su variante, y su fallo no lo revierte', () => {
  const ctrl = read('modules', 'pricing', 'pricing.controller.ts');

  it('el disparo va DESPUÉS de escribir y auditar: el override es el hecho', () => {
    const i = ctrl.indexOf('await this.triggerPublishForVariant(');
    expect(i).toBeGreaterThan(ctrl.indexOf("action: 'pricing.override'"));
  });

  it('pasa la variante del propio override (carta, tipo, gradeKey y acabado)', () => {
    const body = ctrl.slice(ctrl.indexOf('await this.triggerPublishForVariant('));
    const call = body.slice(0, body.indexOf('});'));
    for (const k of ['cardId: dto.cardId', 'productType: dto.productType', 'gradeKey: dto.gradeKey']) {
      expect(call).toContain(k);
    }
    expect(call).toContain("finish: dto.finish ?? 'normal'");
  });

  it('⚠️ y NO pasa ni precio ni estado destino: es un disparo, no una orden', () => {
    const body = ctrl.slice(ctrl.indexOf('await this.triggerPublishForVariant('));
    const call = body.slice(0, body.indexOf('});'));
    expect(call).not.toMatch(/priceMxnCents|status|listed/);
  });

  it('el helper traga la excepción: el override ya está escrito y auditado', () => {
    const body = ctrl.slice(ctrl.indexOf('private async triggerPublishForVariant('));
    const fn = body.slice(0, body.indexOf('\n  }\n'));
    expect(fn).toContain('catch');
    expect(fn).not.toMatch(/throw\s/);
  });
});
