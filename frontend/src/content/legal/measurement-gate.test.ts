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
  it('por defecto usa ENCENDER_BLOCKERS: MKT-F2-3, MKT-F2-4 y MKT-TL2 (backend) ⇒ con on y aviso válido, rojo por esos tres', () => {
    expect(ENCENDER_BLOCKERS.map((b) => `${b.id}:${b.owner}`)).toEqual(['MKT-F2-3:backend', 'MKT-F2-4:backend', 'MKT-TL2:backend']);
    const problems = measurementGateProblems('on', declaredNotice());
    expect(problems).toHaveLength(3);
    expect(problems[0]).toMatch(/^bloqueo de encendido abierto: MKT-F2-3 \(backend\) — /);
    expect(problems[1]).toMatch(/^bloqueo de encendido abierto: MKT-F2-4 \(backend\) — /);
    expect(problems[2]).toMatch(/^bloqueo de encendido abierto: MKT-TL2 \(backend\) — /);
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

  it('D4, R4 y D2 salieron (13cf3653): sus pruebas de cierre están en la cabecera de ENCENDER_BLOCKERS', () => {
    for (const id of ['D4', 'R4', 'D2']) expect(ENCENDER_BLOCKERS.map((b) => b.id)).not.toContain(id);
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
