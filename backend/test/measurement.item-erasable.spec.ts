/**
 * TL-MKT2b-b — `src/modules/measurement/measurement-item.ts` se EJECUTA sin compilar: la prueba cruzada del frontend
 * (`frontend/src/lib/measurement/item.cross.test.ts`, C-F8 × C-B10) lo importa en un proceso `node` que solo le quita los
 * tipos (Node ≥ 22.18, «strip types»). Eso impone dos reglas al fichero, escritas en su cabecera y cobradas AQUÍ, en el
 * jest del backend (antes solo se ponía rojo el vitest del frontend, que no corre quien toca el backend):
 *   1. solo sintaxis que se borra: sin `enum`, `namespace`/`module`, propiedades de parámetro, `import x = require`,
 *      `export =` ni decoradores;
 *   2. ningún import de valor: solo `import type …` (un `import { type X }` deja un `import {} from` que Node SÍ resuelve).
 * Dos candados: (a) el AST del fichero (TypeScript) rechaza 1 y 2 con mensaje claro; (b) el fichero corre de verdad en
 * `node --experimental-strip-types` y da lo mismo que la versión compilada por ts-jest.
 * Canarios: añadir `enum E { A }` o `import { ITEM_ID_PREFIX as X } from './measurement-bodies'` ⇒ rojo.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as ts from 'typescript';
import { measurementItemOf, parseMeasurementItemId } from '../src/modules/measurement/measurement-item';

const FILE = join(__dirname, '..', 'src', 'modules', 'measurement', 'measurement-item.ts');

/** Lo que impide ejecutar el fichero quitándole solo los tipos. Vacío ⇒ cumple. */
function nonErasable(source: string): string[] {
  const sf = ts.createSourceFile(FILE, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out: string[] = [];
  const at = (n: ts.Node, what: string) => out.push(`línea ${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}: ${what}`);
  const visit = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) && !n.importClause?.isTypeOnly) at(n, 'import de valor (solo `import type`)');
    else if (ts.isExportDeclaration(n) && n.moduleSpecifier && !n.isTypeOnly) at(n, 're-export de valor (solo `export type … from`)');
    else if (ts.isImportEqualsDeclaration(n)) at(n, '`import x = …`');
    else if (ts.isExportAssignment(n) && n.isExportEquals) at(n, '`export =`');
    else if (ts.isEnumDeclaration(n)) at(n, '`enum`');
    else if (ts.isModuleDeclaration(n)) at(n, '`namespace`/`module`');
    else if (ts.isParameter(n) && ts.getModifiers(n)?.some((m) => m.kind !== ts.SyntaxKind.ConstKeyword)) at(n, 'propiedad de parámetro');
    else if (ts.isDecorator(n)) at(n, 'decorador');
    else if (ts.isCallExpression(n) && (n.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(n.expression) && n.expression.text === 'require')))
      at(n, 'import dinámico / require');
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

const CASES: unknown[] = [
  { productType: 'raw', cardId: 'sv3-1', name: 'Charizard', setName: 'Obsidian Flames' },
  { productType: 'graded', cardId: 'sv3-1', name: null },
  { productType: 'sealed', sealedProductId: 'sp-9', cardId: 'sv3-1', name: 'ETB' },
  { productType: 'sealed', sealedProductId: '', cardId: 'sv3-1', name: 'ETB' },
  { productType: 'sealed', name: 'x' },
  { productType: 'raw', name: 'x' },
  { kind: 'accessory', accessoryId: 'acc-1', name: 'Sleeves' },
  { kind: 'accessory', metaDeckId: 'md-2', name: 'Deck' },
  { kind: 'accessory', name: 'nada' },
];
const IDS = ['c_sv3-1', 's_sp-9', 'sc_sv3-1', 'a_x', 'c_', 'zz'];

const RUNNER =
  "const m = await import(process.env.ITEM_URL); const i = JSON.parse(process.env.ITEM_IN); process.stdout.write(JSON.stringify(" +
  '{ items: i.cases.map((f) => m.measurementItemOf(f)), ids: i.ids.map((s) => m.parseMeasurementItemId(s)) }));';

describe('TL-MKT2b-b · measurement-item.ts se ejecuta quitándole solo los tipos (lo exige la prueba cruzada del frontend)', () => {
  it('(a) AST: solo `import type` y solo sintaxis que se borra', () => {
    expect(nonErasable(readFileSync(FILE, 'utf8'))).toEqual([]);
  });

  it('(a) el detector muerde: enum, import de valor, `import { type X }`, namespace y propiedad de parámetro', () => {
    expect(nonErasable("enum E { A }\nimport { X } from './x';\nimport { type Y } from './y';\nnamespace N {}\nclass C { constructor(private a: number) {} }")).toHaveLength(5);
    expect(nonErasable("import type { X } from './x';\nexport type { Y } from './y';\nconst f = (a: number): number => a;")).toEqual([]);
  });

  it('(b) `node --experimental-strip-types` lo ejecuta y da lo mismo que la versión compilada', () => {
    const r = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', '--input-type=module', '-e', RUNNER], {
      env: { ...process.env, ITEM_URL: pathToFileURL(FILE).href, ITEM_IN: JSON.stringify({ cases: CASES, ids: IDS }) },
      encoding: 'utf8',
      timeout: 60_000,
    });
    if (r.status !== 0) throw new Error(`node no pudo ejecutar measurement-item.ts quitándole los tipos (rc ${r.status}): ${r.stderr}`);
    expect(JSON.parse(r.stdout)).toEqual({
      items: CASES.map((f) => measurementItemOf(f as never)),
      ids: IDS.map((s) => parseMeasurementItemId(s)),
    });
  });
});
