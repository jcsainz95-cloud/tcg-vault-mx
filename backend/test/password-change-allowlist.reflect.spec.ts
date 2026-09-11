import 'reflect-metadata';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ALLOW_PASSWORD_CHANGE_REQUIRED_KEY } from '../src/common/decorators/allow-password-change-required.decorator';

/**
 * v1.67.1 (sugerencia del techlead, gates Stream A) — **la allowlist de `PASSWORD_CHANGE_REQUIRED` es
 * CERRADA y se mide por reflexión sobre TODOS los controladores del árbol**, no por grep ni por
 * memoria. Contrato §1 «Contraseña temporal obligatoria» / decorador `AllowPasswordChangeRequired`:
 * exactamente TRES handlers —`POST /auth/change-password`, `POST /auth/logout`, `GET /users/me`— y
 * ninguna clase entera. Añadir o quitar uno es cambio de CONTRATO (regla 9) y este test lo delata.
 *
 * Cómo mide: recorre `src/**\/*.controller.ts`, carga cada módulo, toma las clases con `@Controller()`
 * (`PATH_METADATA` en la clase), y por cada método del prototipo lee `METHOD_METADATA`/`PATH_METADATA`
 * (los mismos metadatos que Nest usa para enrutar) y la marca del decorador.
 */

const SRC = join(__dirname, '..', 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.controller.ts')) out.push(p);
  }
  return out;
}

function joinPath(...parts: (string | undefined)[]): string {
  const segs = parts
    .filter((p): p is string => typeof p === 'string')
    .flatMap((p) => p.split('/'))
    .filter((s) => s.length > 0);
  return '/' + segs.join('/');
}

type Found = { route: string; file: string; where: 'handler' | 'class' };

function collect(): { found: Found[]; controllers: number; handlers: number } {
  const found: Found[] = [];
  let controllers = 0;
  let handlers = 0;
  for (const file of walk(SRC)) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(file) as Record<string, unknown>;
    for (const exported of Object.values(mod)) {
      if (typeof exported !== 'function') continue;
      const ctrlPath = Reflect.getMetadata(PATH_METADATA, exported) as string | string[] | undefined;
      if (ctrlPath === undefined) continue; // no es un @Controller()
      controllers += 1;
      const rel = relative(SRC, file);
      const basePath = Array.isArray(ctrlPath) ? ctrlPath[0] : ctrlPath;
      if (Reflect.getMetadata(ALLOW_PASSWORD_CHANGE_REQUIRED_KEY, exported) === true) {
        found.push({ route: `* ${joinPath(basePath)}`, file: rel, where: 'class' });
      }
      const proto = (exported as { prototype: Record<string, unknown> }).prototype;
      for (const name of Object.getOwnPropertyNames(proto)) {
        if (name === 'constructor') continue;
        const fn = proto[name];
        if (typeof fn !== 'function') continue;
        const method = Reflect.getMetadata(METHOD_METADATA, fn) as RequestMethod | undefined;
        if (method === undefined) continue; // no es un handler HTTP
        handlers += 1;
        if (Reflect.getMetadata(ALLOW_PASSWORD_CHANGE_REQUIRED_KEY, fn) === true) {
          const sub = Reflect.getMetadata(PATH_METADATA, fn) as string | string[] | undefined;
          const subPath = Array.isArray(sub) ? sub[0] : sub;
          found.push({
            route: `${RequestMethod[method]} ${joinPath(basePath, subPath)}`,
            file: rel,
            where: 'handler',
          });
        }
      }
    }
  }
  return { found, controllers, handlers };
}

describe('@AllowPasswordChangeRequired() — allowlist CERRADA medida por reflexión (v1.67)', () => {
  const { found, controllers, handlers } = collect();

  it('el recorrido ve el árbol entero (sanidad: hay controladores y handlers de sobra)', () => {
    expect(controllers).toBeGreaterThanOrEqual(10);
    expect(handlers).toBeGreaterThanOrEqual(50);
  });

  it('EXACTAMENTE tres handlers: POST /auth/change-password, POST /auth/logout, GET /users/me', () => {
    const routes = found.filter((f) => f.where === 'handler').map((f) => f.route).sort();
    expect(routes).toEqual(['GET /users/me', 'POST /auth/change-password', 'POST /auth/logout']);
  });

  it('ninguna CLASE entera lleva el decorador (se aplica por handler: PATCH /users/me NO está exento)', () => {
    expect(found.filter((f) => f.where === 'class')).toEqual([]);
  });

  it('los tres viven donde dice el decorador: auth.controller.ts ×2 y users.controller.ts ×1', () => {
    const byFile = new Map<string, number>();
    for (const f of found) byFile.set(f.file, (byFile.get(f.file) ?? 0) + 1);
    expect(byFile.get('modules/auth/auth.controller.ts')).toBe(2);
    expect(byFile.get('modules/users/users.controller.ts')).toBe(1);
    expect(byFile.size).toBe(2);
  });
});
