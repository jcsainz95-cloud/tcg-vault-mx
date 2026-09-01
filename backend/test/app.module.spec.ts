import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { BuylistService } from '../src/modules/buylist/buylist.service';
import {
  INVENTORY_POSITION_PORT,
  InventoryPositionPort,
} from '../src/modules/inventory/inventory-position.port';

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
});
