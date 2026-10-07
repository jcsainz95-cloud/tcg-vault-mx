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
