/**
 * 🔒 C-B15 — la versión de Graph de Meta (API_CONTRACT §MKT.H.1 bloque `META-GRAPH-VERSION`, §MKT.H.12; ARCHITECTURE §14.10
 * D-MKT2-10).
 *
 *  1. `META_GRAPH_API_VERSION` = la `version` del bloque del contrato (única fuente en `docs/`).
 *  2. Hoy < `reviewBy`: ese día esta prueba se pone roja sola hasta re-medir la tabla de Marketing API de Meta y mover la
 *     fila (cambio de contrato). Es la caducidad con candado.
 *  3. Con la línea `META-GRAPH-VERIFIED` en BACKEND_NOTES (`versión · fecha · fbtraceId · id de AuditLog · fila de HECHOS`), su
 *     versión = la constante, lleva fecha y los cinco campos, la ficha MKT-F2-3 está ✅ y MKT-F2-3 NO está en
 *     `BACKEND_ENCENDER_BLOCKERS`; sin ella, MKT-F2-3 sigue abierta en TECH_DEBT y bloqueando. Cerrada el 2026-10-27.
 * CANARIO: constante `v25.0` ⇒ rojo; `reviewBy` vencido ⇒ rojo; línea verificada con otra versión ⇒ rojo; línea + ficha
 * reabierta ⇒ rojo; línea + bloqueo de vuelta ⇒ rojo; línea sin fecha/campos ⇒ rojo; sin línea y sin el bloqueo ⇒ rojo. Lee `docs/` del árbol ENTERO (copiar solo `backend/` la pone roja por falta de ficheros, no por defecto).
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

/** Líneas `META-GRAPH-VERIFIED <versión> · <fecha> · <fbtraceId> · <id de AuditLog> · <fila de HECHOS>` (§MKT.H.12). */
function verifiedLines(notes: string): { version: string; fields: string[] }[] {
  return [...notes.matchAll(/^\s*[-*]?\s*`?META-GRAPH-VERIFIED`?\s*[:·]?\s*`?(v\d+\.\d+)`?(.*)$/gm)].map((m) => ({
    version: m[1],
    fields: m[2].split('·').map((f) => f.trim()).filter(Boolean),
  }));
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
    for (const v of verified) {
      if (v.version !== i.constant) out.push(`META-GRAPH-VERIFIED ${v.version} ≠ constante ${i.constant}`);
      if (v.fields.length < 4 || !/^\d{4}-\d{2}-\d{2}$/.test(v.fields[0]) || !v.fields.some((f) => /HECHOS/.test(f)))
        out.push(`META-GRAPH-VERIFIED ${v.version} sin fecha, fbtraceId, id de AuditLog o fila de HECHOS`);
    }
    if (i.blockerIds.includes('MKT-F2-3')) out.push('META-GRAPH-VERIFIED y MKT-F2-3 sigue en BACKEND_ENCENDER_BLOCKERS');
    if (fichaState(i.techDebt, 'MKT-F2-3') !== 'closed') out.push('META-GRAPH-VERIFIED y la ficha MKT-F2-3 no está cerrada');
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

  it('la cadena «v21.0» ya no vive en el bloqueo de encendido; si MKT-F2-3 vuelve a la lista, nombra la versión fijada', () => {
    expect(BACKEND_ENCENDER_BLOCKERS.map((b) => b.what).join('\n')).not.toContain('v21.0');
    const entry = BACKEND_ENCENDER_BLOCKERS.find((b) => b.id === 'MKT-F2-3');
    if (entry) expect(entry.what).toContain(`'${META_GRAPH_API_VERSION}'`);
  });
  it('MKT-F2-3 cerrada (2026-10-27): hay línea META-GRAPH-VERIFIED con la constante, ficha ✅ y fuera de la lista', () => {
    expect(verifiedLines(real.notes).map((v) => v.version)).toEqual([META_GRAPH_API_VERSION]);
    expect(fichaState(real.techDebt, 'MKT-F2-3')).toBe('closed');
    expect(real.blockerIds).not.toContain('MKT-F2-3');
  });

  it('CANARIO: constante v25.0 ⇒ rojo (y la línea verificada deja de valer: cambiar la versión la quita y reabre la ficha)', () => {
    expect(graphVersionProblems({ ...real, constant: 'v25.0' })).toEqual([
      expect.stringMatching(/^META_GRAPH_API_VERSION=v25\.0 ≠ contrato /),
      `META-GRAPH-VERIFIED ${META_GRAPH_API_VERSION} ≠ constante v25.0`,
    ]);
  });
  it('CANARIO: el día de reviewBy ⇒ rojo', () => {
    const { reviewBy } = contractGraphVersion(real.contract)!;
    expect(graphVersionProblems({ ...real, today: reviewBy })).toEqual([expect.stringMatching(/^reviewBy .* vencido/)]);
  });
  // Variantes del árbol real para los canarios: sin la línea verificada, con la ficha reabierta.
  const unverified = real.notes.replace(/^.*META-GRAPH-VERIFIED.*$\n?/gm, '');
  const reopened = real.techDebt.replace(/^\|\s*MKT-F2-3 ✅\s*\|/m, '| MKT-F2-3 |');

  it('CANARIO: línea verificada con otra versión ⇒ rojo; con la misma ⇒ verde', () => {
    const other = `${real.notes}\n- META-GRAPH-VERIFIED v24.0 · 2026-11-01 · Afbtrace · audit-id · HECHOS 2026-11-01\n`;
    expect(graphVersionProblems({ ...real, notes: other })).toEqual([expect.stringMatching(/^META-GRAPH-VERIFIED v24\.0 ≠ /)]);
    const same = `${unverified}\n- META-GRAPH-VERIFIED ${META_GRAPH_API_VERSION} · 2026-11-01 · Afbtrace · audit-id · HECHOS 2026-11-01\n`;
    expect(graphVersionProblems({ ...real, notes: same })).toEqual([]);
  });
  it('CANARIO: línea verificada + ficha reabierta ⇒ rojo; + MKT-F2-3 de vuelta en la lista ⇒ rojo', () => {
    expect(reopened).not.toBe(real.techDebt);
    expect(graphVersionProblems({ ...real, techDebt: reopened })).toEqual([expect.stringMatching(/ficha MKT-F2-3 no está cerrada/)]);
    expect(graphVersionProblems({ ...real, blockerIds: ['MKT-F2-3'] })).toEqual([expect.stringMatching(/MKT-F2-3 sigue en BACKEND_ENCENDER_BLOCKERS/)]);
  });
  it('CANARIO: línea verificada sin fecha ni campos ⇒ rojo', () => {
    const bare = `${unverified}\n- META-GRAPH-VERIFIED ${META_GRAPH_API_VERSION}\n`;
    expect(graphVersionProblems({ ...real, notes: bare })).toEqual([expect.stringMatching(/sin fecha, fbtraceId/)]);
  });
  it('CANARIO: sin línea verificada y sin el bloqueo / con la ficha cerrada ⇒ rojo', () => {
    expect(unverified).not.toBe(real.notes);
    expect(graphVersionProblems({ ...real, notes: unverified, techDebt: reopened, blockerIds: [] })).toEqual([expect.stringMatching(/MKT-F2-3 fuera de BACKEND_ENCENDER_BLOCKERS/)]);
    expect(graphVersionProblems({ ...real, notes: unverified, blockerIds: ['MKT-F2-3'] })).toEqual([expect.stringMatching(/ficha MKT-F2-3 no está abierta/)]);
    expect(graphVersionProblems({ ...real, notes: unverified, techDebt: reopened, blockerIds: ['MKT-F2-3'] })).toEqual([]);
  });
  it('CANARIO: bloque ausente o con dos filas ⇒ rojo', () => {
    expect(graphVersionProblems({ ...real, contract: real.contract.replace('<!-- META-GRAPH-VERSION:start -->', '') })).toEqual([expect.stringMatching(/^no se leyó/)]);
    const two = real.contract.replace('<!-- META-GRAPH-VERSION:end -->', '| `v25.0` | `2027-02-23` |\n<!-- META-GRAPH-VERSION:end -->');
    expect(graphVersionProblems({ ...real, contract: two })).toEqual([expect.stringMatching(/^no se leyó/)]);
  });
});
