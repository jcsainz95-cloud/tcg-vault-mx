/**
 * 🔒 C-B15 — la versión de Graph de Meta (API_CONTRACT §MKT.H.1 bloque `META-GRAPH-VERSION`, §MKT.H.12; ARCHITECTURE §14.10
 * D-MKT2-10).
 *
 *  1. `META_GRAPH_API_VERSION` = la `version` del bloque del contrato (única fuente en `docs/`).
 *  2. Hoy < `reviewBy`: ese día esta prueba se pone roja sola hasta re-medir la tabla de Marketing API de Meta y mover la
 *     fila (cambio de contrato). Es la caducidad con candado.
 *  3. Con la línea `META-GRAPH-VERIFIED` en BACKEND_NOTES, su versión = la constante; sin ella, MKT-F2-3 sigue abierta en
 *     TECH_DEBT y bloqueando (`BACKEND_ENCENDER_BLOCKERS`).
 * CANARIO: constante `v25.0` ⇒ rojo; `reviewBy` vencido ⇒ rojo; línea verificada con otra versión ⇒ rojo; sin línea y sin el
 * bloqueo ⇒ rojo. Lee `docs/` del árbol ENTERO (copiar solo `backend/` la pone roja por falta de ficheros, no por defecto).
 * Determinista salvo el reloj (a propósito): N=1.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { BACKEND_ENCENDER_BLOCKERS, META_GRAPH_API_VERSION } from '../src/modules/measurement/measurement.config';

const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

/** `{version, reviewBy}` de la única fila de datos entre los marcadores, o `null`. */
function contractGraphVersion(contract: string): { version: string; reviewBy: string } | null {
  const m = contract.match(/<!-- META-GRAPH-VERSION:start -->([\s\S]*?)<!-- META-GRAPH-VERSION:end -->/);
  if (!m) return null;
  const rows = m[1]
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('|') && !/^\|\s*-/.test(l))
    .map((l) => l.split('|').slice(1, -1).map((c) => c.trim().replace(/^`|`$/g, '')))
    .filter((c) => c[0] !== 'version');
  if (rows.length !== 1 || !/^v\d+\.\d+$/.test(rows[0][0]) || !/^\d{4}-\d{2}-\d{2}$/.test(rows[0][1])) return null;
  return { version: rows[0][0], reviewBy: rows[0][1] };
}

/** Versiones de las líneas `META-GRAPH-VERIFIED <versión> · …` de BACKEND_NOTES (formato de §MKT.H.12). */
function verifiedLines(notes: string): string[] {
  return [...notes.matchAll(/^\s*[-*]?\s*`?META-GRAPH-VERIFIED`?\s*[:·]?\s*`?(v\d+\.\d+)`?/gm)].map((m) => m[1]);
}

function fichaState(techDebt: string, id: string): 'open' | 'closed' | 'missing' {
  const row = techDebt.split('\n').find((l) => new RegExp(`^\\|\\s*${id.replace(/-/g, '\\-')}(\\s|\\|)`).test(l));
  if (!row) return 'missing';
  return /✅|CERRADA/.test(row.split('|')[1]) ? 'closed' : 'open';
}

interface Inputs {
  contract: string;
  notes: string;
  techDebt: string;
  constant: string;
  blockerIds: readonly string[];
  today: string; // YYYY-MM-DD (UTC)
}

/** Problemas (vacío = verde). Pura: los canarios le pasan entradas alteradas. */
function graphVersionProblems(i: Inputs): string[] {
  const out: string[] = [];
  const row = contractGraphVersion(i.contract);
  if (!row) return ['no se leyó el bloque META-GRAPH-VERSION del contrato (una sola fila version|reviewBy)'];
  if (i.constant !== row.version) out.push(`META_GRAPH_API_VERSION=${i.constant} ≠ contrato ${row.version}`);
  if (!(i.today < row.reviewBy)) out.push(`reviewBy ${row.reviewBy} vencido (hoy ${i.today}): re-medir la tabla de Marketing API`);
  const verified = verifiedLines(i.notes);
  if (verified.length > 0) {
    for (const v of verified) if (v !== i.constant) out.push(`META-GRAPH-VERIFIED ${v} ≠ constante ${i.constant}`);
  } else {
    if (!i.blockerIds.includes('MKT-F2-3')) out.push('sin META-GRAPH-VERIFIED y MKT-F2-3 fuera de BACKEND_ENCENDER_BLOCKERS');
    if (fichaState(i.techDebt, 'MKT-F2-3') !== 'open') out.push('sin META-GRAPH-VERIFIED y la ficha MKT-F2-3 no está abierta');
  }
  return out;
}

describe('C-B15 · versión de Graph de Meta = bloque del contrato, con caducidad', () => {
  const real: Inputs = {
    contract: read('docs/API_CONTRACT.md'),
    notes: read('docs/BACKEND_NOTES.md'),
    techDebt: read('docs/TECH_DEBT.md'),
    constant: META_GRAPH_API_VERSION,
    blockerIds: BACKEND_ENCENDER_BLOCKERS.map((b) => b.id),
    today: new Date().toISOString().slice(0, 10),
  };

  it('hoy: verde', () => {
    expect(contractGraphVersion(real.contract)).toEqual({ version: META_GRAPH_API_VERSION, reviewBy: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    expect(graphVersionProblems(real)).toEqual([]);
  });

  it('la cadena «v21.0» ya no vive en el bloqueo de encendido ni en el código de medición', () => {
    expect(BACKEND_ENCENDER_BLOCKERS.map((b) => b.what).join('\n')).not.toContain('v21.0');
    expect(BACKEND_ENCENDER_BLOCKERS.find((b) => b.id === 'MKT-F2-3')?.what).toContain(`'${META_GRAPH_API_VERSION}'`);
  });

  it('CANARIO: constante v25.0 ⇒ rojo', () => {
    expect(graphVersionProblems({ ...real, constant: 'v25.0' })).toEqual([expect.stringMatching(/^META_GRAPH_API_VERSION=v25\.0 ≠ contrato /)]);
  });
  it('CANARIO: el día de reviewBy ⇒ rojo', () => {
    const { reviewBy } = contractGraphVersion(real.contract)!;
    expect(graphVersionProblems({ ...real, today: reviewBy })).toEqual([expect.stringMatching(/^reviewBy .* vencido/)]);
  });
  it('CANARIO: línea verificada con otra versión ⇒ rojo; con la misma ⇒ verde aunque MKT-F2-3 salga', () => {
    const other = `${real.notes}\n- META-GRAPH-VERIFIED v24.0 · 2026-11-01 · Afbtrace · audit-id · HECHOS 2026-11-01\n`;
    expect(graphVersionProblems({ ...real, notes: other })).toEqual([expect.stringMatching(/^META-GRAPH-VERIFIED v24\.0 ≠ /)]);
    const same = `${real.notes}\n- META-GRAPH-VERIFIED ${META_GRAPH_API_VERSION} · 2026-11-01 · Afbtrace · audit-id · HECHOS 2026-11-01\n`;
    const closed = real.techDebt.replace(/^\|\s*MKT-F2-3\s*\|/m, '| MKT-F2-3 ✅ |');
    expect(graphVersionProblems({ ...real, notes: same, techDebt: closed, blockerIds: [] })).toEqual([]);
  });
  it('CANARIO: sin línea verificada y sin el bloqueo / con la ficha cerrada ⇒ rojo', () => {
    expect(graphVersionProblems({ ...real, blockerIds: [] })).toEqual([expect.stringMatching(/MKT-F2-3 fuera de BACKEND_ENCENDER_BLOCKERS/)]);
    const closed = real.techDebt.replace(/^\|\s*MKT-F2-3\s*\|/m, '| MKT-F2-3 ✅ |');
    expect(closed).not.toBe(real.techDebt);
    expect(graphVersionProblems({ ...real, techDebt: closed })).toEqual([expect.stringMatching(/ficha MKT-F2-3 no está abierta/)]);
  });
  it('CANARIO: bloque ausente o con dos filas ⇒ rojo', () => {
    expect(graphVersionProblems({ ...real, contract: real.contract.replace('<!-- META-GRAPH-VERSION:start -->', '') })).toEqual([expect.stringMatching(/^no se leyó/)]);
    const two = real.contract.replace('<!-- META-GRAPH-VERSION:end -->', '| `v25.0` | `2027-02-23` |\n<!-- META-GRAPH-VERSION:end -->');
    expect(graphVersionProblems({ ...real, contract: two })).toEqual([expect.stringMatching(/^no se leyó/)]);
  });
});
