import { describe, it, expect } from 'vitest';
import { formatMoneyCents, formatDate, formatDateTimeMx } from './format';

describe('formatMoneyCents', () => {
  it('converts cents to MXN units with MX$ symbol', () => {
    expect(formatMoneyCents(168520, 'es')).toMatch(/1,685\.20/);
    expect(formatMoneyCents(168520, 'es')).toMatch(/^MX\$/);
  });

  it('never shows raw cents', () => {
    expect(formatMoneyCents(50, 'es')).toMatch(/0\.50/);
  });
});

describe('formatDate', () => {
  it('localises a captured date differently per locale', () => {
    const es = formatDate('2026-08-13', 'es');
    const en = formatDate('2026-08-13', 'en');
    expect(es).toContain('2026');
    expect(en).toContain('2026');
    expect(es).not.toEqual(en);
  });
});

/**
 * §23.4.2 (decisión 6) + criterio 154: el plazo se muestra con FECHA Y HORA explícitas, nunca
 * «en 2 días», y **en la zona de México** — la misma en la que el correo lo imprime.
 */
describe('formatDateTimeMx', () => {
  it('rinde el plazo en America/Mexico_City, no en la zona del navegador', () => {
    // 18:00 UTC = 12:00 en CDMX (UTC-6). Si esto empezara a decir 18:00, la pantalla estaría
    // contradiciendo al correo sobre la MISMA fecha límite.
    expect(formatDateTimeMx('2026-09-03T18:00:00.000Z', 'es')).toContain('12:00');
    expect(formatDateTimeMx('2026-09-03T18:00:00.000Z', 'es')).toContain('3 de septiembre de 2026');
    expect(formatDateTimeMx('2026-09-03T18:00:00.000Z', 'en')).toContain('September 3, 2026');
  });

  it('trae el día de la semana (lo pide §23.4.2) y nunca una duración relativa', () => {
    const out = formatDateTimeMx('2026-09-03T18:00:00.000Z', 'es');
    expect(out).toMatch(/jueves/i);
    expect(out).not.toMatch(/en \d+ días/);
  });

  it('entrada ausente o inválida ⇒ cadena vacía, jamás una fecha inventada', () => {
    expect(formatDateTimeMx(null)).toBe('');
    expect(formatDateTimeMx(undefined)).toBe('');
    expect(formatDateTimeMx('no-es-una-fecha')).toBe('');
  });
});
