import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { MONEY_REF_WHERE } from '../src/modules/pricing/pricing.service';

/**
 * pricing.money-ref-lock.spec.ts — **SEC-M43-3: «seguro por defecto» deja de ser una convención.**
 * ARCHITECTURE §4.38(l.4.13) (dictamen: *el arquitecto ACEPTA la corrección; la frase de (l.4.4)A es
 * falsa a nivel de mecanismo*) · `SECURITY_NOTES.md` §5.3 · condición **C6**.
 *
 * ## El defecto que cierra
 * §4.38(l.4.4)A afirmaba que «un lector nuevo que se olvide del predicado **hereda el comportamiento
 * seguro**». **En Prisma eso es falso:** un `where` sin `refKind` **INCLUYE** las dos naturalezas — el
 * default real es el **inseguro**. Lo que (l.4.4)A describe es la **norma**, y hoy quien la sostiene es
 * la revisión humana, no el tipo. Una norma sin candado se erosiona: los 8 archivos que tocan la tabla
 * están revisados **hoy**, y M-43 sigue cerrado exactamente mientras cada autor futuro lea el
 * comentario correcto.
 *
 * ## El mecanismo (mismo patrón que el candado `no-raw-entity` que ya existe en el repo)
 * Todo call-site de `priceReference.find*` en `src/` **o** lleva `MONEY_REF_WHERE` en su propia
 * sentencia, **o** lleva la marca `MONEY-REF-EXEMPT: <motivo>` en las líneas previas. La lista blanca
 * deja de ser un párrafo de un `.md` y pasa a ser **una frase que alguien tuvo que escribir en el
 * código**, al lado de la query, donde se lee cuando se copia y pega.
 *
 * ## Qué NO hace, dicho para que nadie lo sobre-lea
 * No demuestra que el predicado sea *correcto* para esa query — eso lo demuestran
 * `pricing.money-ref-kind.spec.ts` (comportamiento) y el E2E de INV-D inverso (de punta a punta). Este
 * archivo cierra la **CLASE**: que aparezca un lector nuevo **sin decisión declarada**.
 */
describe('SEC-M43-3 — candado estructural: ningún lector de `PriceReference` se olvida sin decirlo', () => {
  const SRC = join(__dirname, '..', 'src');

  /** Operaciones de LECTURA que devuelven candidatas. Las de escritura tienen su propia regla. */
  const READ_OPS = ['findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany'];

  /** Marca de exención EXPLÍCITA, con motivo, en las 5 líneas previas al call-site (o en la propia). */
  const EXEMPT = 'MONEY-REF-EXEMPT';

  function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = join(dir, e.name);
      if (e.isDirectory()) return walk(full);
      return e.isFile() && e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts') ? [full] : [];
    });
  }

  /** Texto de la sentencia desde el call-site hasta que los paréntesis se equilibran (máx 40 líneas). */
  function statementFrom(lines: string[], start: number): string {
    let depth = 0;
    let out = '';
    for (let i = start; i < Math.min(start + 40, lines.length); i++) {
      out += lines[i] + '\n';
      for (const ch of lines[i]) {
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
      }
      if (depth <= 0) break;
    }
    return out;
  }

  const RE = new RegExp(`\\bpriceReference\\.(?:${READ_OPS.join('|')})\\s*\\(`);

  function callSites(): { file: string; line: number; text: string; exempt: boolean; money: boolean }[] {
    const out: { file: string; line: number; text: string; exempt: boolean; money: boolean }[] = [];
    for (const f of walk(SRC)) {
      const lines = readFileSync(f, 'utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (!RE.test(lines[i])) continue;
        const stmt = statementFrom(lines, i);
        out.push({
          file: `${f.replace(SRC, 'src')}:${i + 1}`,
          line: i + 1,
          text: lines[i].trim().slice(0, 100),
          exempt: lines.slice(Math.max(0, i - 5), i + 1).join('\n').includes(EXEMPT),
          money: stmt.includes('MONEY_REF_WHERE'),
        });
      }
    }
    return out;
  }

  it('el predicado sigue siendo EXCLUSIÓN por naturaleza (si esto cambia, el candado no significa nada)', () => {
    expect(MONEY_REF_WHERE).toEqual({ refKind: 'market' });
  });

  it('cero lectores de `PriceReference` sin `MONEY_REF_WHERE` ni exención razonada', () => {
    const infractores = callSites()
      .filter((c) => !c.money && !c.exempt)
      .map((c) => `${c.file} :: ${c.text}`);
    // Si este test se pone rojo con una query NUEVA: la pregunta no es «¿cómo lo callo?», es **¿esta
    // lectura puede terminar en un monto que alguien cobre, ofrezca o valúe?** Si sí ⇒ `MONEY_REF_WHERE`
    // por `AND`. Si no ⇒ `MONEY-REF-EXEMPT: <motivo>` encima, y el motivo se lee en la revisión.
    expect(infractores).toEqual([]);
  });

  /**
   * El barrido solo vale si el patrón que vigila EXISTE. Sin esto, un refactor que cambiara el acceso
   * a datos (repositorios, otro nombre de modelo) dejaría el regex midiendo el vacío y el candado
   * pasaría verde para siempre — el fallo tautológico que ya mordió al candado de enums.
   */
  it('el barrido no es vacío: encuentra lectores de las DOS clases (con predicado y exentos)', () => {
    const sites = callSites();
    expect(sites.length).toBeGreaterThanOrEqual(15);
    expect(sites.filter((c) => c.money).length).toBeGreaterThan(0);
    expect(sites.filter((c) => c.exempt).length).toBeGreaterThan(0);
  });

  /**
   * La exención es **por call-site**, no por archivo: `pricing.service.ts` tiene las dos clases a la
   * vez (los seams de dinero llevan el predicado; los del gancho, del historial y de los escritores van
   * exentos con motivo). Marcar el archivo entero habría vuelto el candado inútil justo donde importa.
   */
  it('las superficies INCLUSIVAS declaradas en (l.4.4)B están todas marcadas, y solo ellas', () => {
    const exentos = callSites().filter((c) => c.exempt).map((c) => c.file.split(':')[0]);
    for (const esperado of [
      'src/modules/pricing/pricing.service.ts', // gancho, historial y escritores
      'src/modules/catalog/catalog.service.ts', // conjunto motor de `/review`
      'src/modules/catalog/graded-estimates.controller.ts', // el `DELETE` (where MÁS estricto)
      'src/modules/catalog/card-product-resolver.service.ts', // clave del upsert de un escritor
    ]) {
      expect(exentos).toContain(esperado);
    }
  });
});
