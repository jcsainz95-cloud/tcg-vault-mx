import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { BuylistService } from '../src/modules/buylist/buylist.service';
import {
  INVENTORY_POSITION_PORT,
  InventoryPositionPort,
} from '../src/modules/inventory/inventory-position.port';
import {
  INVENTORY_PUBLISH_PORT,
  InventoryPublishPort,
} from '../src/modules/inventory/inventory-publish.port';
import { PriceIngestService } from '../src/modules/pricing/price-ingest.service';

/**
 * Smoke test del grafo de DI: compila AppModule completo (todos los módulos,
 * controllers y guards) sin conectar a la base de datos. Detecta providers
 * faltantes, ciclos y errores de wiring.
 */
describe('AppModule (DI graph)', () => {
  const OLD_ENV = process.env;

  beforeAll(() => {
    process.env = {
      ...OLD_ENV,
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db?schema=public',
      JWT_ACCESS_SECRET: 'test_access',
      JWT_REFRESH_SECRET: 'test_refresh',
      NODE_ENV: 'test',
    };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('compiles the full module graph', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({ $connect: jest.fn(), $disconnect: jest.fn() })
      .compile();
    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });

  /**
   * v1.51 (M-46, ARCHITECTURE §4.39f) — **el puerto de posición TIENE que estar cableado.**
   *
   * El `@Optional()` del `@Inject` existe solo para que los tests unitarios que construyen
   * `BuylistService` a mano no truenen; en runtime su ausencia es un **defecto de arranque**: la mesa
   * de decisión respondería `positionUnavailable` en TODAS las líneas y el operador compraría a
   * ciegas — que es exactamente el problema que este ciclo vino a resolver. Como el `@Optional()`
   * hace que el fallo sea **silencioso**, la única forma de detectarlo es aseverar el wiring aquí.
   */
  it('`INVENTORY_POSITION_PORT` está provisto y `buylist` lo recibe (no es best-effort)', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({ $connect: jest.fn(), $disconnect: jest.fn() })
      .compile();
    const port = moduleRef.get<InventoryPositionPort>(INVENTORY_POSITION_PORT, { strict: false });
    expect(port).toBeDefined();
    expect(typeof port.onHandCountsFor).toBe('function');
    // Y el consumidor lo tiene inyectado de verdad (un token provisto que nadie recibe no sirve).
    const buylist = moduleRef.get(BuylistService, { strict: false });
    expect((buylist as unknown as { inventoryPosition?: unknown }).inventoryPosition).toBe(port);
    await moduleRef.close();
  });

  /**
   * ⚠️ v1.51.20 · **R2** (BL-25, ARCHITECTURE §4.39m.5) — **el puerto de PUBLICACIÓN también tiene
   * que estar cableado, y sin este test su ausencia era INVISIBLE.**
   *
   * El de posición ya tenía su aserción; éste no. Y la asimetría importaba: los **tres** consumidores
   * del puerto de publicación lo inyectan con `@Optional()` **y capturan el error**, así que sacar
   * `InventoryPublishModule` del grafo **compilaba, pasaba el smoke de DI de arriba y pasaba la suite
   * entera** — con la **auto-publicación apagada en silencio** y un `logger.warn` como único síntoma.
   *
   * Y el silencio no es benigno: el puerto es best-effort **solo porque `pending-publish` es la red**
   * (§4.39m.5). Con el puerto ausente **todas** las piezas convertidas caen a esa cola, que es
   * precisamente el defecto INV-P1 que la fase 8 vino a cerrar — *comprar bien y dejar la carta en
   * una caja sin precio es comprar mal*.
   *
   * Se asevera **el token Y los dos consumidores**: un token provisto que nadie recibe no dispara
   * nada. `pricing.controller` queda fuera a propósito —los controllers no se resuelven por clase con
   * `moduleRef.get`— y su cableado lo cubre el smoke del grafo completo.
   */
  it('`INVENTORY_PUBLISH_PORT` está provisto y sus consumidores lo reciben (el `@Optional()` lo hace mudo)', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({ $connect: jest.fn(), $disconnect: jest.fn() })
      .compile();
    const port = moduleRef.get<InventoryPublishPort>(INVENTORY_PUBLISH_PORT, { strict: false });
    expect(port).toBeDefined();
    // ⚠️ Las DOS entradas del puerto: `reevaluateVariantsForPublication` es la del disparador (c), y
    // es la que un `useExisting` sin `implements` podía perder sin que nada fallara.
    expect(typeof port.reevaluateForPublication).toBe('function');
    expect(typeof port.reevaluateVariantsForPublication).toBe('function');
    // Consumidor (a) — `buylist`, al convertir a inventario.
    const buylist = moduleRef.get(BuylistService, { strict: false });
    expect((buylist as unknown as { inventoryPublish?: unknown }).inventoryPublish).toBe(port);
    // Consumidor (c) — el barrido de precios, cuando el precio se vuelve resoluble.
    const ingest = moduleRef.get(PriceIngestService, { strict: false });
    expect((ingest as unknown as { inventoryPublish?: unknown }).inventoryPublish).toBe(port);
    await moduleRef.close();
  });
});
