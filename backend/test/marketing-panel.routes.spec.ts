/**
 * 🔒 CANDADO — metadatos de ruta de la pantalla del panel y del acceso del analista (API_CONTRACT §MKT.G.9 (2);
 * D-MKT-AUTZ, D-MKT-PANEL-3). Lee el GRAFO REAL de rutas registradas en `AppModule` (no una lista a mano).
 *
 *  - `GET admin/marketing/panel` y `GET admin/marketing/periods`: `@RequirePermission(marketing_read)` y ⛔ no
 *    `@Public()` ⇒ el token opaco no es JWT ⇒ 401; sesión sin permiso ⇒ 403.
 *  - Las tres de `admin/marketing/tokens`: `@Roles(super_admin)` (solo), ⛔ no `@Public()`, ⛔ no se conforman con
 *    `marketing_read` (leer y emitir credencial no son el mismo poder).
 *  - `MarketingApiTokenGuard` montado SOLO en `GET admin/marketing/aggregates` (en todo el grafo).
 *  - `Cache-Control: no-store` declarado en panel, periods y POST tokens.
 */
import { RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, HEADERS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { Permission, Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PERMISSION_KEY } from '../src/common/decorators/require-permission.decorator';
import { IS_PUBLIC_KEY } from '../src/common/decorators/public.decorator';
import { ROLES_KEY } from '../src/common/decorators/roles.decorator';
import { MarketingApiTokenGuard } from '../src/modules/marketing/marketing-token.guard';

interface Ruta {
  controller: new (...args: any[]) => unknown;
  handlerFn: object;
  path: string;
  method: RequestMethod;
}

const unir = (base: string, sufijo: string): string =>
  [base, sufijo].filter((p) => p !== '' && p !== '/').join('/').replace(/\/+/g, '/');

function effective<T>(key: string, r: Ruta): T | undefined {
  const onHandler = Reflect.getMetadata(key, r.handlerFn) as T | undefined;
  if (onHandler !== undefined) return onHandler;
  return Reflect.getMetadata(key, r.controller) as T | undefined;
}

const guardsOf = (r: Ruta): unknown[] => [
  ...((Reflect.getMetadata(GUARDS_METADATA, r.controller) as unknown[] | undefined) ?? []),
  ...((Reflect.getMetadata(GUARDS_METADATA, r.handlerFn) as unknown[] | undefined) ?? []),
];

const noStore = (r: Ruta): boolean =>
  ((Reflect.getMetadata(HEADERS_METADATA, r.handlerFn) as { name: string; value: string }[] | undefined) ?? []).some(
    (h) => h.name.toLowerCase() === 'cache-control' && h.value === 'no-store',
  );

describe('§MKT.G.9 (2) — metadatos de ruta: panel, periods, tokens', () => {
  const OLD_ENV = process.env;
  let rutas: Ruta[];
  const find = (method: RequestMethod, path: string): Ruta => {
    const r = rutas.find((x) => x.method === method && x.path === path);
    if (!r) throw new Error(`ruta ausente: ${RequestMethod[method]} ${path}`);
    return r;
  };

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

  it.each([['admin/marketing/panel'], ['admin/marketing/periods']])('GET %s: marketing_read, ⛔ no @Public, ⛔ sin @Roles, no-store', (path) => {
    const r = find(RequestMethod.GET, path);
    expect(effective<Permission>(PERMISSION_KEY, r)).toBe(Permission.marketing_read);
    expect(effective<boolean>(IS_PUBLIC_KEY, r)).not.toBe(true);
    expect(effective<Role[]>(ROLES_KEY, r)).toBeUndefined();
    expect(noStore(r)).toBe(true);
  });

  it.each([
    [RequestMethod.GET, 'admin/marketing/tokens'],
    [RequestMethod.POST, 'admin/marketing/tokens'],
    [RequestMethod.POST, 'admin/marketing/tokens/:id/revoke'],
  ])('%s %s: @Roles(super_admin) y nada más, ⛔ no @Public, ⛔ no marketing_read', (method, path) => {
    const r = find(method as RequestMethod, path);
    expect(effective<Role[]>(ROLES_KEY, r)).toEqual([Role.super_admin]);
    expect(effective<boolean>(IS_PUBLIC_KEY, r)).not.toBe(true);
    // marketing_read NO basta para emitir/revocar (D-MKT-PANEL-3): la ruta no lo declara como alternativa.
    expect(effective<Permission>(PERMISSION_KEY, r)).toBeUndefined();
  });

  it('las rutas de tokens son exactamente GET, POST y POST …/:id/revoke (sin DELETE: la fila se queda)', () => {
    const t = rutas
      .filter((r) => r.path.startsWith('admin/marketing/tokens'))
      .map((r) => `${RequestMethod[r.method]} ${r.path}`)
      .sort();
    expect(t).toEqual(['GET admin/marketing/tokens', 'POST admin/marketing/tokens', 'POST admin/marketing/tokens/:id/revoke'].sort());
  });

  it('POST admin/marketing/tokens declara Cache-Control: no-store (el claro viaja ahí)', () => {
    expect(noStore(find(RequestMethod.POST, 'admin/marketing/tokens'))).toBe(true);
  });

  it('MarketingApiTokenGuard está montado SOLO en GET admin/marketing/aggregates (en todo el grafo)', () => {
    const con = rutas.filter((r) => guardsOf(r).includes(MarketingApiTokenGuard)).map((r) => `${RequestMethod[r.method]} ${r.path}`);
    expect(con).toEqual(['GET admin/marketing/aggregates']);
  });
});
