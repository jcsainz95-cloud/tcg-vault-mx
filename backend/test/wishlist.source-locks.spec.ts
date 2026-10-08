/**
 * wishlist.source-locks.spec.ts — rev v1.87.2⟨wishlist⟩ (API_CONTRACT §WSH.4 cabecera, §WSH.7 (b); WSH-T38 y WSH-T39, la
 * parte «candado de fuente»). Propiedad: backend. La conducta la prueban `integration/wishlist-v1-87-2.e2e-spec.ts`; esto
 * vigila la FORMA, para que nadie mueva el pipe estricto al controlador ni reparta el guard opcional por otras rutas.
 *
 *  WSH-T38 — en `modules/wishlist/*.controller.ts` todo `@Body(` es `@Body(new StrictBodyPipe(`; 0 `@Body()` sin pipe;
 *            0 `@UsePipes` (un pipe de controlador ve el cuerpo YA limpiado por el global y no rechaza nada, §84.5 M0).
 *  WSH-T39 — `OptionalSessionGuard` aparece en exactamente UN `@UseGuards` de `src/` y ese handler es `@Public()`.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..', 'src');
const WISHLIST = join(SRC, 'modules', 'wishlist');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

describe('WSH-T38 — candado de fuente: el pipe estricto va en el PARÁMETRO', () => {
  const controllers = readdirSync(WISHLIST)
    .filter((f) => f.endsWith('.controller.ts'))
    .map((f) => ({ file: f, src: readFileSync(join(WISHLIST, f), 'utf8') }));

  it('hay al menos un controlador que leer (si no, el candado no mira nada)', () => {
    expect(controllers.length).toBeGreaterThan(0);
  });

  it('todo `@Body(` es `@Body(new StrictBodyPipe(`; las cuatro rutas con cuerpo lo llevan', () => {
    const all = controllers.flatMap(({ file, src }) => [...src.matchAll(/@Body\(([^\n]*)/g)].map((m) => `${file}: @Body(${m[1]}`));
    const strict = all.filter((l) => /@Body\(new StrictBodyPipe\(/.test(l));
    expect(all.filter((l) => !/@Body\(new StrictBodyPipe\(/.test(l))).toEqual([]);
    // POST /wishlist, PATCH /wishlist/:id, PUT /wishlist/alerts, POST /wishlist/mail-actions (WSH.4). Una ruta con cuerpo
    // nueva sube este número a propósito: quien la añade decide aquí que también es estricta.
    expect(strict).toHaveLength(4);
  });

  it('0 `@Body()` sin pipe y 0 `@UsePipes`', () => {
    for (const { file, src } of controllers) {
      expect({ file, bare: (src.match(/@Body\(\s*\)/g) ?? []).length }).toEqual({ file, bare: 0 });
      expect({ file, usePipes: (src.match(/@UsePipes\b/g) ?? []).length }).toEqual({ file, usePipes: 0 });
    }
  });
});

describe('WSH-T39 — candado de fuente: `OptionalSessionGuard` en una sola ruta, y es `@Public()`', () => {
  /** Las líneas de decoradores (y comentarios entre ellos) que rodean a la línea `i`, hasta la firma del handler. */
  function decoratorBlock(lines: string[], i: number): string[] {
    const isDecoOrComment = (l: string) => /^\s*(@|\/\/|\/\*|\*)/.test(l);
    let a = i;
    while (a > 0 && isDecoOrComment(lines[a - 1])) a -= 1;
    let b = i;
    while (b + 1 < lines.length && isDecoOrComment(lines[b + 1])) b += 1;
    return lines.slice(a, b + 1);
  }

  it('exactamente un `@UseGuards(… OptionalSessionGuard …)` en `src/`, y su bloque de decoradores trae `@Public()`', () => {
    const uses: { file: string; block: string[] }[] = [];
    for (const file of walk(SRC)) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((l, i) => {
        if (/@UseGuards\([^)]*\bOptionalSessionGuard\b/.test(l)) uses.push({ file: file.slice(SRC.length + 1), block: decoratorBlock(lines, i) });
      });
    }
    expect(uses.map((u) => u.file)).toEqual(['modules/catalog/catalog.controller.ts']);
    expect(uses[0].block.some((l) => /^\s*@Public\(\)/.test(l))).toBe(true);
    expect(uses[0].block.some((l) => /@Post\('sealed\/restock-subscriptions'\)/.test(l))).toBe(true);
  });

  it('ningún `@UseGuards` de CLASE lo lleva (solo de método)', () => {
    for (const file of walk(SRC)) {
      const src = readFileSync(file, 'utf8');
      expect({ file, classLevel: /@UseGuards\([^)]*OptionalSessionGuard[^)]*\)\s*\n\s*export class/.test(src) }).toEqual({ file, classLevel: false });
    }
  });
});

// ─────────────────────────────── errata v1.87.3⟨wishlist⟩ (API_CONTRACT §WSH.12) ───────────────────────────────

const TEST = join(__dirname);
const REPO = join(__dirname, '..', '..');
const CATALOG = join(SRC, 'modules', 'catalog');
/** El path de la ruta, armado por partes para que ESTE fichero no cuente como llamador. */
const RESTOCK_ROUTE = ['', 'catalog', 'sealed', 'restock' + '-subscriptions'].join('/');

function walkAll(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walkAll(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** Las claves de un `interface X {…}` o `class X {…}` (una propiedad por línea, decoradores permitidos). */
function keysOf(src: string, decl: RegExp): string[] {
  const m = decl.exec(src);
  if (!m) return [];
  const start = m.index + m[0].length;
  const body = src.slice(start, src.indexOf('\n}', start));
  return [...body.matchAll(/^\s*(?:@[^\n]*?\)\s+)*(\w+)[!?]?\s*:/gm)].map((x) => x[1]).sort();
}

describe('WSH-T42 — candados de fuente del «avísame» (v1.87.3, B-1)', () => {
  it('(a) en `backend/test/**` solo el helper único golpea la ruta; su cuerpo tiene SOLO `email` e `inventoryItemId`', () => {
    const callers = walkAll(TEST)
      .filter((f) => readFileSync(f, 'utf8').includes(RESTOCK_ROUTE))
      .map((f) => f.slice(TEST.length + 1));
    expect(callers).toEqual(['integration/helpers/restock-subscribe.ts']);

    const helper = readFileSync(join(TEST, 'integration', 'helpers', 'restock-subscribe.ts'), 'utf8');
    expect(keysOf(helper, /export interface RestockBody \{/)).toEqual(['email', 'inventoryItemId']);
    const okCall = /export function subscribeRestock\([^)]*\) \{\s*return h\.api\('POST', RESTOCK_PATH, \{ token, json: \{ ([^}]*) \} \}\);/.exec(helper);
    expect(okCall).not.toBeNull();
    expect(okCall![1]).toBe('email: body.email, inventoryItemId: body.inventoryItemId');
    for (const k of ['tcgplayerProductId', 'cardId', 'sealedSubtype', 'sealedCondition']) {
      expect({ k, inHelperCode: helper.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).some((l) => l.includes(k)) }).toEqual({ k, inHelperCode: false });
    }
  });

  it('(a) la vía de «cuerpo que debe rechazarse» solo la usa WSH-T42 (4)', () => {
    const users = walkAll(TEST)
      .filter((f) => !f.endsWith('restock-subscribe.ts') && !f.endsWith('wishlist.source-locks.spec.ts'))
      .filter((f) => /\bpostRestockExpectingRejection\(/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(TEST.length + 1));
    expect(users).toEqual(['integration/wishlist-v1-87-3.e2e-spec.ts']);
  });

  it('(b) paridad pantalla↔servidor: `RestockSubscriptionInput` (frontend) = `RestockSubscriptionDto` (backend) = {email, inventoryItemId}', () => {
    const fe = readFileSync(join(REPO, 'frontend', 'src', 'lib', 'api.ts'), 'utf8');
    const be = readFileSync(join(CATALOG, 'catalog.controller.ts'), 'utf8');
    const feKeys = keysOf(fe, /export interface RestockSubscriptionInput \{/);
    const beKeys = keysOf(be, /class RestockSubscriptionDto \{/);
    expect(feKeys).toEqual(['email', 'inventoryItemId']);
    expect(beKeys).toEqual(['email', 'inventoryItemId']);
  });

  it('(c) el `@Body` de la ruta lleva `StrictBodyPipe(RestockSubscriptionDto)`', () => {
    const src = readFileSync(join(CATALOG, 'catalog.controller.ts'), 'utf8');
    const handler = /subscribeRestock\(([^\n]*)\)\s*\{/.exec(src);
    expect(handler).not.toBeNull();
    expect(handler![1]).toMatch(/@Body\(new StrictBodyPipe\(RestockSubscriptionDto\)\)/);
  });

  it('(d) UNA plantilla de clave de sellado en `modules/catalog/` (`sealedIdentityKey`); `groupKey` la llama', () => {
    const files = walk(CATALOG);
    const count = (re: RegExp) =>
      files.flatMap((f) => [...readFileSync(f, 'utf8').matchAll(re)].map(() => f.slice(CATALOG.length + 1)));
    expect(count(/`p:\$\{/g)).toEqual(['sealed-restock-notify.service.ts']);
    expect(count(/`c:\$\{/g)).toEqual(['sealed-restock-notify.service.ts']);
    const sealed = readFileSync(join(CATALOG, 'sealed-catalog.service.ts'), 'utf8');
    const groupKey = /private groupKey\([^)]*\): string \{([\s\S]*?)\n  \}/.exec(sealed);
    expect(groupKey).not.toBeNull();
    expect(groupKey![1]).toMatch(/return sealedIdentityKey\(/);
  });
});

describe('WSH-T43 — candado de fuente: un solo fragmento «producto de set» (v1.87.3, M-1)', () => {
  it("el literal `'set_base', 'other'` aparece UNA vez en `modules/wishlist/`, en `wishlist-pieces.ts`", () => {
    const hits = walk(WISHLIST).flatMap((f) =>
      [...readFileSync(f, 'utf8').matchAll(/'set_base', 'other'/g)].map(() => f.slice(WISHLIST.length + 1)),
    );
    expect(hits).toEqual(['wishlist-pieces.ts']);
  });

  it('la baja al pagar lee ese fragmento (no una copia): `consumeForSettledOrder` usa `SET_PRODUCT_PREDICATE`', () => {
    const svc = readFileSync(join(WISHLIST, 'wishlist.service.ts'), 'utf8');
    const body = /async consumeForSettledOrder\([\s\S]*?\n  \}\n/.exec(svc);
    expect(body).not.toBeNull();
    expect(body![0]).toMatch(/\bSET_PRODUCT_PREDICATE\b/);
    const pieces = readFileSync(join(WISHLIST, 'wishlist-pieces.ts'), 'utf8');
    expect(pieces).toMatch(/export const SET_PRODUCT_PREDICATE = Prisma\.sql`/);
    expect(pieces).toMatch(/PIECE_PREDICATE = Prisma\.sql`[\s\S]*\$\{SET_PRODUCT_PREDICATE\}/);
  });
});
