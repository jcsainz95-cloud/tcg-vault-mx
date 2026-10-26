import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { privacyNoticeEs, type LegalDocument } from './privacidad.es';
import {
  OLD_NO_MEASUREMENT_SENTENCE,
  formatMeasurementNoticeReport,
  ENCENDER_BLOCKERS,
  measurementGateProblems,
  measurementNoticeProblems,
  type EncenderBlocker,
} from './measurement-gate';
import { legalPublishProblems } from './publish-check';
import { MEASUREMENT_DISCLOSURE } from './measurement-disclosure';

const clone = (d: LegalDocument): LegalDocument => JSON.parse(JSON.stringify(d));

/**
 * Aviso SINTÉTICO que sí declara la medición. ⛔ No es texto legal: es la fixture mínima que nombra
 * lo que la puerta exige. El texto real lo trae el abogado.
 */
function declaredNotice(): LegalDocument {
  const doc = clone(privacyNoticeEs);
  doc.measurementDisclosure = { version: 'mkt2-test-1', approvedByOwnerOn: '2026-11-01', legalReviewOn: '2026-10-30' };
  const cookies = doc.sections.find((s) => s.id === 'cookies')!;
  cookies.blocks = [
    {
      type: 'p',
      text: 'FIXTURE: Google Analytics y Meta; cookies _fbp, _fbc, th_first_utm y th_consent; retención de 14 meses.',
    },
  ];
  return doc;
}

/** C-D1 (API_CONTRACT §MKT.H.11, ARCHITECTURE §14.1) — encender exige el aviso nuevo. */
describe('C-D1 · puerta del aviso de medición', () => {
  it('HOY el aviso no declara la medición (measurementDisclosure null y frase vieja)', () => {
    expect(MEASUREMENT_DISCLOSURE).toBeNull();
    expect(privacyNoticeEs.measurementDisclosure).toBeNull();
    const problems = measurementNoticeProblems(privacyNoticeEs);
    expect(problems).toContain('measurementDisclosure es null: el aviso no declara la medición');
    expect(problems).toContain(`el aviso aún dice «${OLD_NO_MEASUREMENT_SENTENCE}»`);
    expect(problems.find((p) => p.startsWith('el aviso no nombra:'))).toBe(
      'el aviso no nombra: Google Analytics, Meta, _fbp, _fbc, th_first_utm, th_consent, retención de 14 meses',
    );
  });

  it('con on y el aviso actual ⇒ problemas (build rojo); con off ⇒ ninguno', () => {
    expect(measurementGateProblems('on', privacyNoticeEs, []).length).toBe(3);
    expect(measurementGateProblems('off', privacyNoticeEs, [])).toEqual([]);
  });

  it('con un aviso que sí declara ⇒ ninguno (build verde)', () => {
    expect(measurementGateProblems('on', declaredNotice(), [])).toEqual([]);
  });

  it('la frase vieja detecta también con negrita (`**…**`) como está en privacidad.es.ts', () => {
    const doc = declaredNotice();
    doc.sections[0].blocks.push({ type: 'p', text: '**No usamos cookies de publicidad ni de analítica.**' });
    expect(measurementNoticeProblems(doc)).toEqual([`el aviso aún dice «${OLD_NO_MEASUREMENT_SENTENCE}»`]);
  });

  it('nombra lo que falta, uno por uno', () => {
    const doc = declaredNotice();
    doc.sections.find((s) => s.id === 'cookies')!.blocks = [{ type: 'p', text: 'Google Analytics, _fbp, th_consent.' }];
    expect(measurementNoticeProblems(doc)).toEqual(['el aviso no nombra: Meta, _fbc, th_first_utm, retención de 14 meses']);
  });

  it('MKT.H.13 · el aviso sin apartado `cookies` ⇒ problema (ahí va el botón «Preferencias de cookies»)', () => {
    const doc = declaredNotice();
    const cookies = doc.sections.find((s) => s.id === 'cookies')!;
    doc.sections = doc.sections.filter((s) => s.id !== 'cookies');
    doc.sections[0].blocks.push(...cookies.blocks); // el texto sigue nombrando todo, solo falta el apartado
    expect(measurementNoticeProblems(doc)).toEqual(['el aviso no tiene apartado `cookies` (ahí va «Preferencias de cookies»)']);
  });

  it('measurementDisclosure con forma inválida ⇒ problema', () => {
    const doc = declaredNotice();
    doc.measurementDisclosure = { version: 'con espacio', approvedByOwnerOn: 'ayer', legalReviewOn: '2026-10-30' };
    expect(measurementNoticeProblems(doc)).toEqual(['measurementDisclosure mal formado: version, approvedByOwnerOn']);
  });

  it('legalPublishProblems: el tercer argumento suma los problemas solo con on', () => {
    const input = {
      doc: privacyNoticeEs,
      messages: { es: { common: { footer: { legalEntity: 'X' } } }, en: { common: { footer: { legalEntity: 'X' } } } },
      siteSources: {},
    };
    const base = legalPublishProblems('provisional', input);
    expect(legalPublishProblems('provisional', input, { measurement: 'off' })).toEqual(base);
    const on = legalPublishProblems('provisional', input, { measurement: 'on' });
    expect(on.length).toBe(base.length + 3 + ENCENDER_BLOCKERS.length);
    expect(on).toContain('measurementDisclosure es null: el aviso no declara la medición');
  });
});

/** C-D1 (v1.106, ARCHITECTURE §14.1 D-MKT2-0c) — los bloqueos de encendido viven en la puerta, no en una nota. */
describe('C-D1 · ENCENDER_BLOCKERS', () => {
  const ONE: EncenderBlocker = { id: 'X1', what: 'algo sin cerrar', owner: 'backend', closedBy: 'backend/test/x.spec.ts' };

  it('aviso válido + un bloqueo ⇒ rojo, con el problema que nombra id, dueño y qué', () => {
    expect(measurementGateProblems('on', declaredNotice(), [ONE])).toEqual(['bloqueo de encendido abierto: X1 (backend) — algo sin cerrar']);
  });

  it('con off la lista no cuenta', () => {
    expect(measurementGateProblems('off', declaredNotice(), [ONE])).toEqual([]);
  });

  // TL-MKT2b-f (2026-10-19): la lista ya no está vacía. Muerde si se vacía o si sale una entrada sin su cierre.
  // MKT-F2-4 salió el 2026-10-26 con su ficha cerrada (backend); la paridad SEC-MKT-2 de abajo exige que siga fuera.
  it('por defecto usa ENCENDER_BLOCKERS: MKT-F2-3 (backend) ⇒ con on y aviso válido, rojo por ese', () => {
    expect(ENCENDER_BLOCKERS.map((b) => `${b.id}:${b.owner}`)).toEqual(['MKT-F2-3:backend']);
    const problems = measurementGateProblems('on', declaredNotice());
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^bloqueo de encendido abierto: MKT-F2-3 \(backend\) — /);
  });

  it('TL-MKT2b-f · con off la puerta sigue verde (aviso de hoy y aviso declarado), aunque haya bloqueos', () => {
    expect(ENCENDER_BLOCKERS.length).toBeGreaterThan(0);
    expect(measurementGateProblems('off', privacyNoticeEs)).toEqual([]);
    expect(measurementGateProblems('off', declaredNotice())).toEqual([]);
  });

  it('canario: con DOS bloqueos inyectados la puerta da dos problemas, en orden', () => {
    const TWO: EncenderBlocker[] = [ONE, { ...ONE, id: 'X2', owner: 'devops', what: 'otra cosa abierta' }];
    expect(measurementGateProblems('on', declaredNotice(), TWO)).toEqual([
      'bloqueo de encendido abierto: X1 (backend) — algo sin cerrar',
      'bloqueo de encendido abierto: X2 (devops) — otra cosa abierta',
    ]);
  });

  it('cada entrada tiene id único, qué, dueño válido y la prueba que la cierra', () => {
    const ids = ENCENDER_BLOCKERS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const b of ENCENDER_BLOCKERS) {
      expect(b.what.length).toBeGreaterThan(10);
      expect(['backend', 'frontend', 'devops']).toContain(b.owner);
      expect(b.closedBy).toMatch(/\S/);
    }
  });

  it('D4, R4 y D2 salieron (13cf3653) y MKT-TL2 (86ee9bdb): sus pruebas de cierre están en la cabecera de ENCENDER_BLOCKERS', () => {
    for (const id of ['D4', 'R4', 'D2', 'MKT-TL2']) expect(ENCENDER_BLOCKERS.map((b) => b.id)).not.toContain(id);
  });
});

/*
 * SEC-MKT-2 (seguridad, info, 2026-10-22) — paridad ENCENDER_BLOCKERS ↔ docs/TECH_DEBT.md. Antes, quitar una entrada
 * (y su línea de la prueba de arriba) desbloqueaba `on` con la ficha ABIERTA. Ahora:
 *  1. toda entrada de la lista tiene su fila en el índice de TECH_DEBT y esa fila está ABIERTA (cerrada ⇒ la entrada sale);
 *  2. toda ficha del REGISTRO que siga ABIERTA está en la lista (quitar la entrada con la ficha abierta ⇒ rojo);
 *  3. toda entrada está en el REGISTRO (una entrada nueva se registra aquí al entrar, y queda vigilada por 2).
 * El registro es el censo de las entradas que han existido CON ficha de ese id. D4, R4 y D2 salieron en `13cf3653`,
 * antes de esta paridad y sin fila propia en TECH_DEBT (ver la prueba de arriba). MKT-TL2 salió en `86ee9bdb` con su ficha
 * cerrada (✅): sigue en el registro, y la paridad exige que esté cerrada y fuera de la lista. ⛔ Borrar un id del registro para
 * quitar su entrada es debilitar el candado: la ficha se cierra en TECH_DEBT (su dueño) y entonces sale de la lista.
 * Formato del índice (medido 2026-10-23): fila `| ID | Qué | Dueño | Medido el | Comprobación |`; cerrada = `✅` en la
 * celda ID o «Qué» que empieza por «CERRADA»; si no, abierta.
 */
const ENCENDER_REGISTRY = ['MKT-F2-3', 'MKT-F2-4', 'MKT-TL2'] as const;
const TECH_DEBT_PATH = join(__dirname, '..', '..', '..', '..', 'docs', 'TECH_DEBT.md');

type FichaState = 'open' | 'closed' | 'missing' | 'duplicated';

/** Estado de la ficha `id` en el índice tabular de TECH_DEBT (por la PRIMERA celda de cada fila). */
function fichaState(md: string, id: string): FichaState {
  const rows = md
    .split('\n')
    .filter((l) => l.startsWith('|'))
    .map((l) => l.split('|').map((c) => c.trim()))
    .filter((cells) => cells.length >= 4)
    .filter((cells) => cells[1].replace(/✅/g, '').replace(/\(.*\)/g, '').trim() === id);
  if (rows.length === 0) return 'missing';
  if (rows.length > 1) return 'duplicated';
  const [, idCell, what] = rows[0];
  return idCell.includes('✅') || /^CERRADA\b/.test(what) ? 'closed' : 'open';
}

function encenderParityProblems(
  blockers: readonly Pick<EncenderBlocker, 'id'>[],
  md: string,
  registry: readonly string[],
): string[] {
  const listed = new Set(blockers.map((b) => b.id));
  const out: string[] = [];
  for (const b of blockers) {
    if (!registry.includes(b.id)) out.push(`${b.id}: en ENCENDER_BLOCKERS pero no en ENCENDER_REGISTRY`);
    const st = fichaState(md, b.id);
    if (st !== 'open') out.push(`${b.id}: en ENCENDER_BLOCKERS con ficha ${st} en TECH_DEBT`);
  }
  for (const id of registry) {
    const st = fichaState(md, id);
    if (st === 'missing' || st === 'duplicated') out.push(`${id}: ficha ${st} en TECH_DEBT (el registro no puede mirar al vacío)`);
    if (st === 'open' && !listed.has(id)) out.push(`${id}: ficha ABIERTA en TECH_DEBT pero fuera de ENCENDER_BLOCKERS`);
  }
  return out;
}

describe('SEC-MKT-2 · paridad ENCENDER_BLOCKERS ↔ TECH_DEBT', () => {
  const md = readFileSync(TECH_DEBT_PATH, 'utf8');

  it('hoy: cada entrada con su ficha abierta y cada ficha abierta del registro en la lista', () => {
    expect(encenderParityProblems(ENCENDER_BLOCKERS, md, ENCENDER_REGISTRY)).toEqual([]);
  });

  it('el parser lee el índice real: MKT-F2-3 abierta, MKT-F2-4, MKT-TL2 y MKT-TD1 cerradas (✅), TL-MKT2b-f cerrada («CERRADA ·»)', () => {
    expect(fichaState(md, 'MKT-F2-3')).toBe('open');
    expect(fichaState(md, 'MKT-F2-4')).toBe('closed');
    expect(fichaState(md, 'MKT-TL2')).toBe('closed');
    expect(fichaState(md, 'MKT-TD1')).toBe('closed');
    expect(fichaState(md, 'TL-MKT2b-f')).toBe('closed');
    expect(fichaState(md, 'NO-EXISTE-0')).toBe('missing');
  });

  // Canario sobre el índice REAL: el defecto de SEC-MKT-2 (quitar una entrada de la lista con la ficha abierta) muerde.
  it('canario: sin la entrada MKT-F2-3 (ficha abierta) ⇒ rojo', () => {
    const without = ENCENDER_BLOCKERS.filter((b) => b.id !== 'MKT-F2-3');
    expect(encenderParityProblems(without, md, ENCENDER_REGISTRY)).toEqual([
      'MKT-F2-3: ficha ABIERTA en TECH_DEBT pero fuera de ENCENDER_BLOCKERS',
    ]);
  });

  // Canario sobre el índice REAL: devolver MKT-F2-4 (ficha cerrada el 2026-10-26) a la lista ⇒ rojo.
  it('canario: con la entrada MKT-F2-4 de vuelta (ficha cerrada) ⇒ rojo', () => {
    const back = [...ENCENDER_BLOCKERS, { id: 'MKT-F2-4' }];
    expect(encenderParityProblems(back, md, ENCENDER_REGISTRY)).toEqual(['MKT-F2-4: en ENCENDER_BLOCKERS con ficha closed en TECH_DEBT']);
  });

  // Canario sobre el índice REAL: devolver MKT-TL2 (ficha cerrada en 86ee9bdb) a la lista ⇒ rojo.
  it('canario: con la entrada MKT-TL2 de vuelta (ficha cerrada) ⇒ rojo', () => {
    const back = [...ENCENDER_BLOCKERS, { id: 'MKT-TL2' }];
    expect(encenderParityProblems(back, md, ENCENDER_REGISTRY)).toEqual(['MKT-TL2: en ENCENDER_BLOCKERS con ficha closed en TECH_DEBT']);
  });

  it('canario (sintético): ficha cerrada con la entrada viva, entrada sin registrar y ficha desaparecida ⇒ rojo', () => {
    const syn = ['| ID | Qué | Dueño | Medido el | Cierre |', '|---|---|---|---|---|', '| A1 ✅ | x | backend | d | c |', '| B2 | CERRADA · y | backend | d | c |', '| C3 | abierta | backend | d | c |'].join('\n');
    expect(encenderParityProblems([{ id: 'A1' }, { id: 'B2' }, { id: 'C3' }], syn, ['A1', 'B2', 'C3'])).toEqual([
      'A1: en ENCENDER_BLOCKERS con ficha closed en TECH_DEBT',
      'B2: en ENCENDER_BLOCKERS con ficha closed en TECH_DEBT',
    ]);
    expect(encenderParityProblems([{ id: 'C3' }, { id: 'Z9' }], syn, ['C3'])).toEqual([
      'Z9: en ENCENDER_BLOCKERS pero no en ENCENDER_REGISTRY',
      'Z9: en ENCENDER_BLOCKERS con ficha missing en TECH_DEBT',
    ]);
    expect(encenderParityProblems([], syn, ['D4'])).toEqual(['D4: ficha missing en TECH_DEBT (el registro no puede mirar al vacío)']);
    // Ficha cerrada y fuera de la lista ⇒ verde (así sale una entrada).
    expect(encenderParityProblems([{ id: 'C3' }], syn, ['A1', 'C3'])).toEqual([]);
  });
});

/** C-F17 (DESIGN_SYSTEM MKT2-UX.15) — rótulo del build. */
describe('C-F17 · rótulo MEASUREMENT_NOTICE_*', () => {
  it('con N problemas: primera línea greppable, cada problema, «NO se publica» y las dos salidas', () => {
    const problems = measurementNoticeProblems(privacyNoticeEs);
    const lines = formatMeasurementNoticeReport('on', problems, null);
    expect(lines[0]).toBe(`MEASUREMENT_NOTICE_REQUIRED mode=on problems=${problems.length}`);
    const text = lines.join('\n');
    expect(text).toContain('NO se publica');
    for (const p of problems) expect(text).toContain(`  - ${p}`);
    expect(text).toContain('(a) publica el aviso revisado');
    expect(text).toContain('(b) pon NEXT_PUBLIC_MEASUREMENT_MODE=off');
    expect(text).toContain('El sitio en línea no cambia con este build.');
  });

  it('sin problemas: una sola línea con la versión; con off: una sola línea mode=off', () => {
    expect(formatMeasurementNoticeReport('on', [], 'v9')).toEqual(['MEASUREMENT_NOTICE_OK mode=on version=v9']);
    expect(formatMeasurementNoticeReport('off', ['lo que sea'], null)).toEqual(['MEASUREMENT_NOTICE_OK mode=off']);
  });

  it('ninguna línea contiene un ID ni un secreto', () => {
    const lines = formatMeasurementNoticeReport('on', measurementNoticeProblems(privacyNoticeEs), null).join('\n');
    expect(lines).not.toMatch(/G-[A-Z0-9]{4,}|\b\d{10,20}\b|GA4_|META_|api_secret|access_token/);
  });
});
