import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, relative } from 'node:path';

/**
 * ─────────────────────────────────────────────────────────────────────────────────────
 * CENSO DE SALTOS **EN TIEMPO DE EJECUCIÓN** — «qué NO midió esta corrida», dicho en voz alta.
 *
 * DE DÓNDE VIENE (hallazgo MENOR de la segunda pasada de QA, 2026-09-14). Dos corridas del
 * MISMO código dieron `55 pasan / 3 fallan / 1 salta` y `50 / 3 / 6`. Los fallos eran estables;
 * lo que bailaba era **cuántos casos llegaban a ejercitarse**. Y nada en el informe distinguía
 * una cara de la otra: las dos decían «3 fallos». Un gate cuya cobertura varía sin que nadie lo
 * note no dice lo que uno cree que dice — y en este proyecto ya mordió literal: el único E2E que
 * vigilaba Disputas se saltaba justo en el caso en que la pantalla fallaba.
 *
 *     ► Una prueba que se salta en silencio se lee como una prueba que pasó.
 *
 * QUÉ **NO** ES ESTO, para no rehacer lo ya hecho. `scripts/check-e2e-skip-census.sh` (devops)
 * ya cuenta las salvaguardas **en el CÓDIGO FUENTE** contra un baseline commiteado, y su canario
 * demuestra que muerde. Eso contesta «¿cuántos sitios PUEDEN saltar?». Es una pregunta estática
 * y no puede contestar la de QA, porque las dos caras —1 y 6— salen del **mismo fuente**: la
 * diferencia está en el ESTADO del stack en el momento de correr.
 *
 *   · censo ESTÁTICO  (`scripts/check-e2e-skip-census.sh`) → ¿cuántas escotillas hay escritas?
 *   · censo DINÁMICO  (esto)                               → ¿cuántas se ABRIERON hoy, y cuáles?
 *
 * Las dos hacen falta y ninguna sustituye a la otra.
 *
 * QUÉ HACE
 *   1. Al final de la corrida imprime **la lista nominal** de casos que no se ejercitaron, con
 *      `fichero:línea` y la RAZÓN, agrupados por clasificación (`mock-only`, `falta dato en el
 *      seed real`, `límite del arnés`, ...). No un número: los nombres.
 *   2. Escribe el mismo censo en JSON (`E2E_NOT_MEASURED_JSON`, default
 *      `test-results/not-measured.json`) para que QA/CI puedan DIFERENCIAR dos corridas en vez
 *      de compararlas de memoria.
 *   3. Opcional y apagado por defecto: `E2E_EXPECT_NOT_MEASURED=<n>` hace que la corrida termine
 *      en **rojo** si el número de casos no medidos no es exactamente `n`. Es el interruptor que
 *      convierte «la cobertura bailó» en una señal, en vez de en una nota al pie que nadie lee.
 *      ⛔ Se deja OPT-IN a propósito: cablear un gate es de devops, no mío. Aquí queda el
 *      instrumento y su contrato de uso.
 *
 * ⚠️ Este reporter **no cambia ningún veredicto por su cuenta** salvo que se le pida con la
 * variable de arriba: un reporter que decide en silencio sería la misma enfermedad que cura.
 * ─────────────────────────────────────────────────────────────────────────────────────
 */

interface NotMeasuredEntry {
  /** `e2e/account.spec.ts:97` — relativo a la raíz de `frontend/`. */
  location: string;
  /** Título completo, incluidos los `describe` que lo contienen. */
  title: string;
  /** Clasificación derivada de la razón (`mock-only`, `falta dato en el seed real`, ...). */
  category: string;
  /** La razón tal cual la escribió el spec, o `'sin razón declarada'`. */
  reason: string;
}

interface NotMeasuredReport {
  runAt: string;
  /** `real` cuando la app bajo prueba habla con el backend real (misma regla que `utils/env.ts`). */
  mode: 'real' | 'mock';
  total: number;
  executed: number;
  notMeasured: number;
  byCategory: Record<string, number>;
  entries: NotMeasuredEntry[];
}

/** Las cuatro cabeceras que escriben los helpers de `e2e/utils/auth.ts`, más el `skip` pelado. */
const CATEGORIES: ReadonlyArray<[prefix: string, label: string]> = [
  ['mock-only (dato de fixture):', 'mock-only (dato de fixture)'],
  ['falta dato en el seed real:', 'falta dato en el seed real'],
  ['límite del arnés:', 'límite del arnés'],
  ['solo-real:', 'solo-real'],
];

function classify(reason: string): string {
  for (const [prefix, label] of CATEGORIES) {
    if (reason.startsWith(prefix)) return label;
  }
  return reason ? 'otro `test.skip` (sin clasificar)' : 'sin razón declarada';
}

/** La razón del salto vive en las anotaciones; las del RESULTADO son las del último intento. */
function skipReason(test: TestCase, result: TestResult | undefined): string {
  const pools = [result?.annotations ?? [], test.annotations ?? []];
  for (const pool of pools) {
    const hit = pool.find((a) => a.type === 'skip' && a.description);
    if (hit?.description) return hit.description;
  }
  return '';
}

const ESC = String.fromCharCode(27);
const bold = (s: string): string => `${ESC}[1m${s}${ESC}[0m`;
const dim = (s: string): string => `${ESC}[2m${s}${ESC}[0m`;

export default class NotMeasuredReporter implements Reporter {
  private rootDir = process.cwd();
  private readonly entries: NotMeasuredEntry[] = [];
  private total = 0;

  onBegin(config: FullConfig, suite: Suite): void {
    this.rootDir = config.rootDir ?? process.cwd();
    this.total = suite.allTests().length;
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    // `outcome()` es el veredicto FINAL del caso (ya contados los reintentos): un caso que se
    // salta en un intento y se reintenta no se cuenta dos veces.
    if (test.outcome() !== 'skipped') return;
    const reason = skipReason(test, result);
    this.entries.push({
      location: `${relative(this.rootDir, test.location.file)}:${test.location.line}`,
      // `titlePath()` = [proyecto, fichero, ...describes, título]. Se cortan los dos primeros: el
      // proyecto no distingue nada aquí y el fichero ya viaja en `location`.
      title: test.titlePath().filter(Boolean).slice(2).join(' > '),
      category: classify(reason),
      reason: reason || 'sin razón declarada',
    });
  }

  async onEnd(result: FullResult): Promise<{ status?: FullResult['status'] } | void> {
    const byCategory: Record<string, number> = {};
    for (const e of this.entries) byCategory[e.category] = (byCategory[e.category] ?? 0) + 1;

    const report: NotMeasuredReport = {
      runAt: new Date().toISOString(),
      mode:
        process.env.E2E_MOCKS !== '1' &&
        (!!process.env.E2E_BASE_URL || process.env.E2E_REAL === '1')
          ? 'real'
          : 'mock',
      total: this.total,
      executed: this.total - this.entries.length,
      notMeasured: this.entries.length,
      byCategory,
      entries: [...this.entries].sort((a, b) => a.location.localeCompare(b.location)),
    };

    const jsonPath = process.env.E2E_NOT_MEASURED_JSON ?? 'test-results/not-measured.json';
    try {
      mkdirSync(dirname(jsonPath), { recursive: true });
      writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    } catch {
      // Un fallo de escritura no puede tumbar la corrida: el bloque de texto se imprime igual.
    }

    this.print(report, jsonPath);

    const expected = process.env.E2E_EXPECT_NOT_MEASURED;
    if (expected !== undefined && expected !== '' && Number(expected) !== report.notMeasured) {
      console.error(
        `\n::error title=cobertura E2E::E2E_EXPECT_NOT_MEASURED=${expected} pero esta corrida dejó ` +
          `${report.notMeasured} caso(s) SIN MEDIR. Un verde con ${report.notMeasured} saltos no es el ` +
          `mismo verde que uno con ${expected}: mira la lista de arriba antes de fusionar.\n`,
      );
      return { status: 'failed' };
    }
    return { status: result.status };
  }

  private print(report: NotMeasuredReport, jsonPath: string): void {
    if (report.notMeasured === 0) {
      console.log(
        `\n${bold(`== Lo que esta corrida NO midió (${report.mode}) ==`)}\n` +
          `  OK 0 de ${report.total}: todos los casos seleccionados se ejercitaron.\n`,
      );
      return;
    }

    const lines: string[] = [
      '',
      bold(`== Lo que esta corrida NO midió (${report.mode}) ==`),
      `  ${report.notMeasured} de ${report.total} caso(s) NO se ejercitaron. ` +
        `Ejecutados: ${report.executed}.`,
      dim(
        '  (un verde con N saltos no es el mismo verde que uno con M: compara este bloque, no solo los fallos)',
      ),
      '',
    ];
    for (const [category, count] of Object.entries(report.byCategory).sort()) {
      lines.push(`  ${bold(`${category} - ${count}`)}`);
      for (const e of report.entries.filter((x) => x.category === category)) {
        lines.push(`    * ${e.location}  ${e.title}`);
        lines.push(dim(`      -> ${e.reason}`));
      }
      lines.push('');
    }
    lines.push(dim(`  censo en JSON: ${jsonPath}`), '');
    console.log(lines.join('\n'));
  }
}
