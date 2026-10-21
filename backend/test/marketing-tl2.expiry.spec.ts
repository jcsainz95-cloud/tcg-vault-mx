/**
 * ⏰🔒 CANDADO DE CADUCIDAD — MKT-TL2 (residuo aceptado con dueño + caducidad + candado; SECURITY_NOTES, rechazo sobre
 * `bfd91ab2`, «Vía alternativa»). Dueño: backend. Caducidad: **2026-11-30** (00:00 CDMX).
 *
 * QUÉ HACE: con el RELOJ REAL, a partir del 2026-11-30 esta prueba sale ROJA mientras la ficha MKT-TL2 de `docs/TECH_DEBT.md`
 * siga abierta. Antes de esa fecha, verde.
 *
 * CÓMO SE APAGA (lo único que la apaga): cerrar MKT-TL2 de verdad —
 *   1. escribir la prueba 3 de API_CONTRACT §MKT.H.14 (`test/marketing-cross-table.audit.spec.ts`: auditor de cruces por
 *      ecuaciones, `MARKETING_EQUATIONS`, `exposedCells`, `enforceFamily`, R2 por (tabla, clave, parte), R3b y R4);
 *   2. dejar verdes las pruebas 1 (`marketing-populations.registry.spec.ts`) y 3;
 *   3. marcar la fila de MKT-TL2 del índice de `docs/TECH_DEBT.md` como `MKT-TL2 ✅` (o «CERRADA») con el sha.
 * ⛔ Borrar la fila NO la apaga (rojo: «la ficha no existe»). ⛔ La fecha vive AQUÍ, no en el documento: moverla exige un
 * veredicto nuevo de seguridad (`docs/SECURITY_NOTES.md`), no una edición.
 */
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

/** 2026-11-30 00:00 en CDMX (UTC−6). */
export const MKT_TL2_DEADLINE = new Date('2026-11-30T06:00:00.000Z');
const TECH_DEBT = resolve(__dirname, '../../docs/TECH_DEBT.md');
const AUDIT_SPEC = resolve(__dirname, 'marketing-cross-table.audit.spec.ts');

type TL2State = 'open' | 'closed' | 'missing';

/** Estado de la ficha en el ÍNDICE tabular de TECH_DEBT: la fila cuya primera celda es `MKT-TL2` (con o sin ✅). */
export function tl2State(techDebt: string): TL2State {
  const row = techDebt.split('\n').find((l) => /^\|\s*MKT-TL2(\s|\s*✅|\s*\||$)/.test(l) && !/^\|\s*MKT-TL2[a-z0-9]/i.test(l));
  if (!row) return 'missing';
  const id = row.split('|')[1];
  return /✅|CERRADA/.test(id) ? 'closed' : 'open';
}

/** `null` = verde; si no, el motivo en palabras. Pura: el reloj y los textos entran como argumentos (canario abajo). */
export function tl2ExpiryProblem(now: Date, techDebt: string, auditSpecExists: boolean): string | null {
  const state = tl2State(techDebt);
  if (state === 'missing') {
    return 'La ficha MKT-TL2 no está en el índice de docs/TECH_DEBT.md. No se borra: se cierra (fila «MKT-TL2 ✅» con su comprobación).';
  }
  if (state === 'closed') {
    return auditSpecExists
      ? null
      : 'MKT-TL2 figura cerrada pero no existe test/marketing-cross-table.audit.spec.ts (prueba 3 de API_CONTRACT §MKT.H.14). Sin la prueba 3 no está cerrada.';
  }
  if (now.getTime() < MKT_TL2_DEADLINE.getTime()) return null;
  return (
    'MKT-TL2 venció el 2026-11-30 y sigue abierta (docs/TECH_DEBT.md). Para apagar esta prueba: escribe la prueba 3 de ' +
    'API_CONTRACT §MKT.H.14 (test/marketing-cross-table.audit.spec.ts), déjala verde junto a la prueba 1 ' +
    '(test/marketing-populations.registry.spec.ts) y marca la fila del índice como «MKT-TL2 ✅» con el sha. ' +
    'No muevas la fecha: la puso seguridad; cambiarla exige su veredicto en docs/SECURITY_NOTES.md.'
  );
}

describe('MKT-TL2 · caducidad 2026-11-30 (reloj real)', () => {
  it('HOY: si la ficha MKT-TL2 sigue abierta a partir del 2026-11-30, rojo (el mensaje dice qué hacer)', () => {
    const problem = tl2ExpiryProblem(new Date(), readFileSync(TECH_DEBT, 'utf8'), existsSync(AUDIT_SPEC));
    expect(problem).toBeNull();
  });
});

describe('CANARIO · el candado muerde', () => {
  const doc = readFileSync(TECH_DEBT, 'utf8');
  const closedDoc = doc.replace(/^\|\s*MKT-TL2\s*\|/m, '| MKT-TL2 ✅ |');
  const day = (iso: string) => new Date(iso);

  it('la ficha REAL está abierta hoy y el candado la encuentra (si no, el resto no prueba nada)', () => {
    expect(tl2State(doc)).toBe('open');
  });
  it('ficha abierta: 29-nov 23:59 CDMX ⇒ verde; 30-nov 00:00 CDMX ⇒ rojo; 2027 ⇒ rojo', () => {
    expect(tl2ExpiryProblem(day('2026-11-30T05:59:59.000Z'), doc, false)).toBeNull();
    expect(tl2ExpiryProblem(day('2026-11-30T06:00:00.000Z'), doc, false)).toMatch(/^MKT-TL2 venció el 2026-11-30/);
    expect(tl2ExpiryProblem(day('2027-03-01T12:00:00.000Z'), doc, false)).toMatch(/escribe la prueba 3/);
  });
  it('ficha cerrada con la prueba 3 escrita ⇒ verde aunque haya vencido; cerrada SIN prueba 3 ⇒ rojo', () => {
    expect(tl2State(closedDoc)).toBe('closed');
    expect(tl2ExpiryProblem(day('2027-03-01T12:00:00.000Z'), closedDoc, true)).toBeNull();
    expect(tl2ExpiryProblem(day('2026-10-19T12:00:00.000Z'), closedDoc, false)).toMatch(/no existe test\/marketing-cross-table/);
  });
  it('borrar la fila no la apaga ⇒ rojo en cualquier fecha', () => {
    const removed = doc.replace(/^\|\s*MKT-TL2\s*\|.*\n/m, '');
    expect(tl2State(removed)).toBe('missing');
    expect(tl2ExpiryProblem(day('2026-10-19T12:00:00.000Z'), removed, false)).toMatch(/No se borra/);
  });
});
