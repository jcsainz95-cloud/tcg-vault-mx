#!/usr/bin/env bash
#
# check-e2e-must-run.sh — un spec E2E que CONSUME su semilla tiene que haberse
# EJECUTADO y PASADO en su único intento; un salto o un «flaky» es ROJO · devops
# =============================================================================
# DE DÓNDE VIENE (P-REL-3, release s5, 2026-09-29)
# ---------------------------------------------------------------------------
# `frontend/e2e/m4-ship-spei-real.spec.ts` conduce la cubeta SPEI contra el stack
# real y CONSUME las dos filas sembradas (`e2e:mr-pay` → paid, `e2e:mr-cancel` →
# cancelled). Sin fila `pending`, sus casos se SALTAN (`skipIfSeedMissing`). Eso
# abre dos caminos por los que el gate sale verde sin haber medido nada:
#
#   1. SIN SEMILLA → `skipped` → Playwright rc=0.
#   2. REINTENTO SOBRE FILAS YA CONSUMIDAS. `frontend/playwright.config.ts` pone
#      `retries: isCI ? 2 : 0`. Si el caso falla DESPUÉS de consumir su fila, el
#      reintento no encuentra fila `pending`, se salta, y Playwright computa el
#      caso como `flaky` (`computeTestCaseOutcome`: 1 unexpected + 1 skipped ⇒
#      flaky) ⇒ rc=0. MEDIDO 2026-09-29 con @playwright/test 1.56.0 sobre un
#      proyecto sintético (consume y falla, retries=2): resultados
#      `["failed","skipped"]`, estado `flaky`, rc=0. O sea: un ROJO real del
#      producto se publica como VERDE. Y el reporter `not-measured.ts` tampoco lo
#      ve: filtra por `outcome() === 'skipped'` y aquí el outcome es `flaky`.
#
# El workflow corre ese spec con `--retries=0` (cierra el camino 2 en origen) y
# este script lo comprueba DESPUÉS sobre el reporte JSON de Playwright (cierra el
# camino 1, y vuelve a cerrar el 2 si alguien quita el `--retries=0`).
#
# QUÉ EXIGE, por cada spec pedido con --spec:
#   · que aparezca en el reporte con AL MENOS --min casos (0 casos = el filtro
#     `@real`/la lista de specs lo dejó fuera: no midió nada);
#   · que CADA caso tenga estado final `expected` y EXACTAMENTE un resultado,
#     `passed`. Cualquier `skipped`, `flaky`, `unexpected`, reintento o
#     resultado extra es rojo.
#
# Uso:
#   ./scripts/check-e2e-must-run.sh --report R.json --spec m4-ship-spei-real.spec.ts [--min 2]
#   (--spec se puede repetir; se compara contra el `file` del reporte, que es
#    relativo al testDir `frontend/e2e`)
# rc: 0 todo ejecutado y pasado · 1 algo no midió o no pasó · 2 no concluyente
#     (sin reporte, JSON roto, sin node). En CI el 2 también es ROJO.
# Canario: scripts/check-e2e-must-run-canary.sh
# =============================================================================
set -uo pipefail
REPORT=""; MIN=1; SPECS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --report) REPORT="${2:-}"; shift 2 ;;
    --spec)   SPECS+=("${2:-}"); shift 2 ;;
    --min)    MIN="${2:-}"; shift 2 ;;
    *) echo "::error::argumento desconocido: $1"; exit 2 ;;
  esac
done
[ -n "$REPORT" ] && [ "${#SPECS[@]}" -gt 0 ] || { echo "::error::uso: $0 --report R.json --spec F [--spec G] [--min N]"; exit 2; }
case "$MIN" in ''|*[!0-9]*) echo "::error::--min debe ser entero ≥1"; exit 2 ;; esac
[ "$MIN" -ge 1 ] || { echo "::error::--min 0 sería un gate que acepta no medir nada"; exit 2; }
command -v node >/dev/null 2>&1 || { echo "::error::no hay node para leer el reporte. NO concluyente."; exit 2; }
[ -s "$REPORT" ] || { echo "::error title=E2E debe-correr::no existe (o está vacío) el reporte $REPORT: el spec no llegó a correr o el reporter JSON no se cableó. NO concluyente = ROJO."; exit 2; }

MIN="$MIN" node - "$REPORT" "${SPECS[@]}" <<'NODE'
const fs = require('fs');
const [report, ...specs] = process.argv.slice(2);
const min = Number(process.env.MIN);
let r;
try { r = JSON.parse(fs.readFileSync(report, 'utf8')); }
catch (e) { console.log(`::error title=E2E debe-correr::reporte ilegible (${e.message}). NO concluyente = ROJO.`); process.exit(2); }
if (!r || !Array.isArray(r.suites)) { console.log('::error title=E2E debe-correr::el JSON no tiene forma de reporte Playwright (sin `suites`). NO concluyente = ROJO.'); process.exit(2); }

const cases = []; // {file, title, status, results[]}
(function walk(suites, path) {
  for (const s of suites || []) {
    const p = s.title ? [...path, s.title] : path;
    for (const sp of s.specs || []) {
      for (const t of sp.tests || []) {
        cases.push({ file: sp.file || s.file || '', line: sp.line, title: [...p, sp.title].join(' > '),
          status: t.status, results: (t.results || []).map((x) => x.status) });
      }
    }
    walk(s.suites, p);
  }
})(r.suites, []);

let bad = 0;
for (const spec of specs) {
  const mine = cases.filter((c) => c.file === spec || c.file.endsWith('/' + spec));
  if (mine.length < min) {
    bad++;
    console.log(`::error title=E2E debe-correr::${spec}: ${mine.length} caso(s) en el reporte, se exigen ≥${min}. El spec no se seleccionó (lista de specs, filtro @real) o no existe: esta corrida NO lo midió.`);
    continue;
  }
  for (const c of mine) {
    const ok = c.status === 'expected' && c.results.length === 1 && c.results[0] === 'passed';
    if (ok) { console.log(`  ✔ ${c.file}:${c.line}  ${c.title}`); continue; }
    bad++;
    let why = `estado ${c.status}, intentos ${JSON.stringify(c.results)}`;
    if (c.results.includes('skipped') && c.results.length > 1) why += ' — FALLÓ y el REINTENTO se saltó sobre filas ya consumidas (Playwright lo llama flaky y sale rc=0)';
    else if (c.status === 'skipped') why += ' — SE SALTÓ: falta la semilla (¿se sembró antes? ¿otro paso ya consumió las filas?)';
    else if (c.results.length > 1) why += ' — hubo reintento: un spec que consume su semilla no se puede reintentar';
    console.log(`::error title=E2E debe-correr::${c.file}:${c.line} ${c.title}: ${why}`);
  }
}
if (bad) { console.log(`\n✗ ${bad} problema(s): el spec que consume su semilla NO quedó medido en esta corrida.`); process.exit(1); }
console.log('\n✓ Todos los casos exigidos se EJECUTARON y PASARON en su único intento.');
NODE
