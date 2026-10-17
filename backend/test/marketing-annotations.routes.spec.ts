/**
 * 🔒 CANDADO — AUTZ de las rutas de anotaciones (h1, API_CONTRACT §MKT.E, DECISIÓN D-MKT-AUTZ;
 * ARCHITECTURE §13.4.6). Se lee el GRAFO REAL de rutas registradas en `AppModule` (no una lista a mano).
 *
 * La propiedad que fija, y por qué sostiene el 401/403 del contrato:
 *  1. TODA ruta bajo `admin/marketing/annotations` exige `@RequirePermission(marketing_read)` ⇒ una
 *     **sesión** admin SIN el permiso ⇒ **403** (`PermissionGuard`).
 *  2. NINGUNA de esas rutas es `@Public()` ⇒ el `JwtAuthGuard` global corre. El token opaco
 *     `marketing-reader` NO es JWT ⇒ se rechaza como **401** (no 403): el token no alcanza estas rutas.
 *  3. Contraste: `GET admin/marketing/aggregates` SÍ es `@Public()` (lo reautentica el token) — es la
 *     ÚNICA ruta del admin donde el token vale (D-MKT-AUTZ).
 *  4. El CRUD expone exactamente GET/POST/PATCH/DELETE y ningún otro verbo.
 */
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { Permission } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PERMISSION_KEY } from '../src/common/decorators/require-permission.decorator';
import { IS_PUBLIC_KEY } from '../src/common/decorators/public.decorator';

interface Ruta {
  controller: new (...args: any[]) => unknown;
  controllerName: string;
  handler: string;
  handlerFn: object;
  path: string;
  method: RequestMethod;
}

function unir(base: string, sufijo: string): string {
  return [base, sufijo].filter((p) => p !== '' && p !== '/').join('/').replace(/\/+/g, '/');
}

const PREFIJO = 'admin/marketing/annotations';

/** Resuelve el metadato como lo hace `getAllAndOverride`: primero el handler, si no, la clase. */
function effective<T>(key: string, r: Ruta): T | undefined {
  const onHandler = Reflect.getMetadata(key, r.handlerFn) as T | undefined;
  if (onHandler !== undefined) return onHandler;
  return Reflect.getMetadata(key, r.controller) as T | undefined;
}

describe('§MKT.E · D-MKT-AUTZ — AUTZ de las rutas de anotaciones', () => {
  const OLD_ENV = process.env;
  let rutas: Ruta[];

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
      for (const wrapper of mod.controllers.values()) if (wrapper.metatype) clases.push(wrapper.metatype);
    }

    rutas = [];
    for (const clase of clases) {
      const base = (Reflect.getMetadata(PATH_METADATA, clase) as string | undefined) ?? '';
      const proto = clase.prototype as Record<string, object>;
      for (const handler of Object.getOwnPropertyNames(proto)) {
        if (handler === 'constructor') continue;
        const sufijo = Reflect.getMetadata(PATH_METADATA, proto[handler]) as string | undefined;
        if (sufijo === undefined) continue;
        rutas.push({
          controller: clase,
          controllerName: clase.name,
          handler,
          handlerFn: proto[handler],
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

  it('el barrido ve el grafo REAL y encuentra las rutas de anotaciones', () => {
    expect(rutas.length).toBeGreaterThan(100);
    expect(rutas.some((r) => r.path.startsWith(PREFIJO))).toBe(true);
  });

  it('TODA ruta de anotaciones exige `marketing_read` (⇒ sesión sin permiso = 403)', () => {
    const anot = rutas.filter((r) => r.path.startsWith(PREFIJO));
    expect(anot.length).toBeGreaterThanOrEqual(4);
    for (const r of anot) {
      expect(effective<Permission>(PERMISSION_KEY, r)).toBe(Permission.marketing_read);
    }
  });

  it('⛔ NINGUNA ruta de anotaciones es `@Public()` (⇒ token opaco = 401 por JwtAuthGuard)', () => {
    const publicas = rutas.filter((r) => r.path.startsWith(PREFIJO) && effective<boolean>(IS_PUBLIC_KEY, r) === true);
    expect(publicas.map((r) => `${r.method} ${r.path}`)).toEqual([]);
  });

  it('el CRUD expone exactamente GET/POST/PATCH/DELETE', () => {
    const metodos = rutas.filter((r) => r.path.startsWith(PREFIJO)).map((r) => r.method).sort();
    expect(metodos).toEqual(
      [RequestMethod.GET, RequestMethod.POST, RequestMethod.PATCH, RequestMethod.DELETE].sort(),
    );
  });

  it('contraste: `admin/marketing/aggregates` SÍ es `@Public()` (única ruta del token, D-MKT-AUTZ)', () => {
    const agg = rutas.find((r) => r.path === 'admin/marketing/aggregates');
    expect(agg).toBeDefined();
    expect(effective<boolean>(IS_PUBLIC_KEY, agg!)).toBe(true);
    // Y NO exige el permiso de sesión (lo gobierna el guard de token).
    expect(effective<Permission>(PERMISSION_KEY, agg!)).toBeUndefined();
  });
});
