import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * v1.82 · **DSC-8** (`API_CONTRACT §PNL.8`, `D-PNL-2`) — **un solo lector del buzón de soporte.**
 *
 * Barre `backend/src` y exige **cero lecturas** de `SUPPORT_EMAIL` / `DISPUTE_EVIDENCE_CONTACT` fuera de
 * `modules/mail/support-contact.ts` (y de los `*.spec.ts`, que fijan la env para probar la cascada).
 * Hasta v1.81 había dos cascadas distintas (`disputes.constants.ts`, `guest-checkout.constants.ts`
 * frente a `buylist-mail.templates.ts`, `mail-shell.ts`); copiar la cascada a otro sitio pone esto rojo.
 *
 * ### Sobre el texto CRUDO, no sobre el texto sin comentarios — a propósito
 * El limpiador de comentarios se queda ciego a trozos en `mail-shell.ts` (31 aperturas fantasma,
 * `test/helpers/codigo-de-fichero.ts`), justo uno de los cuatro ficheros vigilados. Leyendo crudo el
 * único error posible es un **rojo de más** (un comentario que escriba la lectura literal), nunca un
 * verde por ceguera. Los comentarios de este pase nombran las variables **sin** la forma de lectura.
 *
 * Formas que cuentan como lectura: `process.env.X`, `process.env['X']` / `["X"]`, y la clave entre
 * comillas simples o dobles (`config.get('X')`, `const { 'X': v } = process.env`).
 */
const SRC = join(__dirname, '..', 'src');
const RESOLVER = join('modules', 'mail', 'support-contact.ts');
const NAMES = '(?:SUPPORT_EMAIL|DISPUTE_EVIDENCE_CONTACT)';
const READS = [
  new RegExp(`process\\.env\\s*\\.\\s*${NAMES}\\b`, 'g'),
  new RegExp(`process\\.env\\s*\\[\\s*['"\`]${NAMES}['"\`]\\s*\\]`, 'g'),
  new RegExp(`['"]${NAMES}['"]`, 'g'),
  new RegExp(`\\{[^}]*\\b${NAMES}\\b[^}]*\\}\\s*=\\s*process\\.env`, 'g'),
];

function lecturas(texto: string): string[] {
  return READS.flatMap((re) => texto.match(re) ?? []);
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('DSC-8 · `SUPPORT_EMAIL`/`DISPUTE_EVIDENCE_CONTACT` solo se leen en `mail/support-contact.ts`', () => {
  it('canario: el detector SÍ ve las formas de lectura que existían antes de v1.82', () => {
    expect(lecturas('envOr(process.env.SUPPORT_EMAIL, x)')).toHaveLength(1);
    expect(lecturas('envOr(\n  process.env.DISPUTE_EVIDENCE_CONTACT,\n  d)')).toHaveLength(1);
    expect(lecturas("process.env['SUPPORT_EMAIL']")).toHaveLength(2); // forma de corchete + clave entre comillas
    expect(lecturas("config.get('DISPUTE_EVIDENCE_CONTACT')")).toHaveLength(1);
    expect(lecturas('const { SUPPORT_EMAIL } = process.env;')).toHaveLength(1);
    // …y NO ve el nombre suelto en prosa (los comentarios lo nombran entre acentos graves).
    expect(lecturas('// leía solo `DISPUTE_EVIDENCE_CONTACT`')).toHaveLength(0);
  });

  it('el barrido no es vacuo: encuentra el resolutor y sus lecturas, y recorre los cuatro lectores de antes', () => {
    const files = walk(SRC).map((f) => relative(SRC, f));
    expect(files).toContain(RESOLVER);
    expect(lecturas(readFileSync(join(SRC, RESOLVER), 'utf8')).length).toBeGreaterThanOrEqual(2);
    for (const f of [
      ['modules', 'orders', 'guest-checkout.constants.ts'],
      ['modules', 'buylist', 'buylist-mail.templates.ts'],
      ['modules', 'buylist', 'mail-shell.ts'],
      ['modules', 'disputes', 'disputes.service.ts'],
    ]) {
      expect(files).toContain(f.join(sep));
    }
  });

  it('0 lecturas fuera del resolutor (y de los specs)', () => {
    const fuera = walk(SRC)
      .filter((f) => !f.endsWith('.spec.ts') && relative(SRC, f) !== RESOLVER)
      .flatMap((f) => lecturas(readFileSync(f, 'utf8')).map((m) => `${relative(SRC, f)}: ${m}`));
    expect(fuera).toEqual([]);
  });

  it('los lectores de antes IMPORTAN el resolutor (no basta con que dejen de leer la env)', () => {
    for (const f of [
      ['modules', 'orders', 'guest-checkout.service.ts'],
      ['modules', 'buylist', 'buylist-mail.templates.ts'],
      ['modules', 'buylist', 'mail-shell.ts'],
      ['modules', 'disputes', 'disputes.service.ts'],
      ['modules', 'disputes', 'mail', 'dispute-notice.templates.ts'],
      ['modules', 'disputes', 'disputes.controller.ts'],
      ['modules', 'orders', 'support-contact.controller.ts'],
    ]) {
      const src = readFileSync(join(SRC, ...f), 'utf8');
      const imports = /import \{[^}]*\bsupportContact\b[^}]*\} from '[^']*\/support-contact'/.test(src);
      expect({ f: f.join('/'), imports }).toEqual({ f: f.join('/'), imports: true });
    }
  });
});
