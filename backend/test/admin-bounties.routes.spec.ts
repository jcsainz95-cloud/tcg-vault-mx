import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ROLES_KEY } from '../src/common/decorators/roles.decorator';
import { AdminBountiesController } from '../src/modules/pricing/admin-bounties.controller';

/**
 * `admin-bounties.routes.spec.ts` — **B-7 y B-13(a) de `API_CONTRACT §M2-B.6`: el INVENTARIO DE
 * RUTAS de la consola de bounties.**
 *
 * ### Qué mutación mata
 * *Añadir una ruta mutadora bajo `admin/pricing/bounties`.* La pantalla **edita**, pero reusando
 * `PUT /admin/pricing/variant-controls/:cardId/:finish` (§M2-B.2): **cero superficie de escritura
 * nueva**. Y la prohibición que este candado sostiene es la de la **acción de alcance de conjunto**
 * —`/bulk`, `?ids=`, «aplicar a los seleccionados», «apagar los N rebasados»—, que llegaría
 * *«por comodidad»* porque **una lista invita al multi-select**.
 *
 * ### Por qué mira el GRAFO ENTERO y no solo esta clase
 * Un `POST` masivo no tiene por qué nacer en este controller: puede aparecer en cualquier otro con
 * el prefijo `admin/pricing/bounties`. Un test que solo mirase `AdminBountiesController` daría verde
 * mientras la ruta prohibida existe dos archivos más allá. Se leen los decoradores REALES de todos
 * los controllers registrados en `AppModule`, no una lista escrita a mano.
 */

/** Verbos de escritura: cualquiera de ellos bajo el prefijo de la consola pone el test en rojo. */
const VERBOS_DE_ESCRITURA = [
  RequestMethod.POST,
  RequestMethod.PUT,
  RequestMethod.PATCH,
  RequestMethod.DELETE,
];

const PREFIJO = 'admin/pricing/bounties';

interface Ruta {
  controller: string;
  handler: string;
  path: string;
  method: RequestMethod;
}

/** Une el path del controller con el del handler, normalizando las barras. */
function unir(base: string, sufijo: string): string {
  return [base, sufijo].filter((p) => p !== '' && p !== '/').join('/').replace(/\/+/g, '/');
}

describe('§M2-B.6 · B-7/B-13(a) — bajo `admin/pricing/bounties` NO existe ningún verbo de escritura', () => {
  const OLD_ENV = process.env;
  let rutas: Ruta[];
  let controllers: number;

  beforeAll(async () => {
    process.env = {
      ...OLD_ENV,
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db?schema=public',
      JWT_ACCESS_SECRET: 'test_access',
      JWT_REFRESH_SECRET: 'test_refresh',
      NODE_ENV: 'test',
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({ $connect: jest.fn(), $disconnect: jest.fn() })
      .compile();

    const clases: (new (...args: any[]) => unknown)[] = [];
    for (const mod of (moduleRef as any).container.getModules().values()) {
      for (const wrapper of mod.controllers.values()) {
        if (wrapper.metatype) clases.push(wrapper.metatype);
      }
    }
    controllers = clases.length;

    rutas = [];
    for (const clase of clases) {
      const base = (Reflect.getMetadata(PATH_METADATA, clase) as string | undefined) ?? '';
      const proto = clase.prototype as Record<string, object>;
      for (const handler of Object.getOwnPropertyNames(proto)) {
        if (handler === 'constructor') continue;
        const sufijo = Reflect.getMetadata(PATH_METADATA, proto[handler]) as string | undefined;
        if (sufijo === undefined) continue;
        rutas.push({
          controller: clase.name,
          handler,
          path: unir(base, sufijo),
          method: Reflect.getMetadata(METHOD_METADATA, proto[handler]) as RequestMethod,
        });
      }
    }
    await moduleRef.close();
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('el barrido ve el grafo REAL (si esto baja, el candado dejó de mirar la app)', () => {
    expect(controllers).toBeGreaterThan(10);
    expect(rutas.length).toBeGreaterThan(100);
    expect(rutas.some((r) => r.controller === AdminBountiesController.name)).toBe(true);
  });

  it('⛔ ninguna ruta de escritura bajo el prefijo de la consola (ni `/bulk`, ni `?ids=`, ni «apagar los N»)', () => {
    const prohibidas = rutas.filter(
      (r) => r.path.startsWith(PREFIJO) && VERBOS_DE_ESCRITURA.includes(r.method),
    );
    expect(prohibidas).toEqual([]);
  });

  it('el controller de §M2-B.1 expone SOLO `@Get`, y al menos uno', () => {
    const propias = rutas.filter((r) => r.controller === AdminBountiesController.name);
    expect(propias.length).toBeGreaterThanOrEqual(1);
    expect(propias.every((r) => r.method === RequestMethod.GET)).toBe(true);
  });

  it('la lectura consolidada es `super_admin`, no `vault_operator+` (agregar cambia el activo)', () => {
    // El binder expone `pricing.bounty` de UN set a `vault_operator+`; la lista de todo lo que el
    // negocio paga por encima de su tarifa es la estrategia de compra en una pantalla (§M2-B.1).
    expect(Reflect.getMetadata(ROLES_KEY, AdminBountiesController)).toEqual([Role.super_admin]);
  });
});
