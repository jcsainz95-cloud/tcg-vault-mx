import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

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
});
