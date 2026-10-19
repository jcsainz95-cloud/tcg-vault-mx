import { describe, expect, it } from 'vitest';
import { privacyNoticeEs, type LegalDocument } from './privacidad.es';
import {
  OLD_NO_MEASUREMENT_SENTENCE,
  formatMeasurementNoticeReport,
  measurementGateProblems,
  measurementNoticeProblems,
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
    expect(measurementGateProblems('on', privacyNoticeEs).length).toBe(3);
    expect(measurementGateProblems('off', privacyNoticeEs)).toEqual([]);
  });

  it('con un aviso que sí declara ⇒ ninguno (build verde)', () => {
    expect(measurementGateProblems('on', declaredNotice())).toEqual([]);
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
    expect(on.length).toBe(base.length + 3);
    expect(on).toContain('measurementDisclosure es null: el aviso no declara la medición');
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
