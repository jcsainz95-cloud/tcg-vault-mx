// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';

/**
 * TL-CTA-8: `EmailSection.tsx` llevaba un byte NUL literal (el SENTINEL de `split`), y por él git trató el fichero como
 * BINARIO (`git diff --numstat` ⇒ `-\t-`: sin diff legible en revisión). El separador se escribe con escape (`'\u0000'`).
 * Ojo: `grep -cP '\x00' fichero` da 0 sobre un fichero binario aunque el NUL esté (grep no cuenta líneas de binarios sin
 * `-a`); este candado lee los bytes.
 */
const SRC = __dirname;
const EXT = /\.(?:ts|tsx|js|jsx|mjs|css|json)$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (EXT.test(e.name)) out.push(p);
  }
  return out;
}

function filesWithNul(files: string[], read: (p: string) => Buffer = (p) => fs.readFileSync(p)): string[] {
  return files.filter((f) => read(f).includes(0)).map((f) => path.relative(SRC, f));
}

describe('fuentes de texto sin bytes NUL (TL-CTA-8)', () => {
  it('ningún fichero de src/ lleva un NUL literal', () => {
    const files = walk(SRC);
    expect(files.length).toBeGreaterThan(100);
    expect(filesWithNul(files)).toEqual([]);
  });

  it('canario: un NUL en medio del texto SÍ se detecta', () => {
    const bad = Buffer.from("const SENTINEL = '\u0000';\n", 'utf8');
    expect(filesWithNul([path.join(SRC, 'x.tsx')], () => bad)).toEqual(['x.tsx']);
    const ok = Buffer.from("const SENTINEL = '\\u0000';\n", 'utf8');
    expect(filesWithNul([path.join(SRC, 'x.tsx')], () => ok)).toEqual([]);
  });
});
