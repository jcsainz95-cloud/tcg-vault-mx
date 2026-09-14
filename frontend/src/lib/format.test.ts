import { describe, it, expect } from 'vitest';
import { formatMoneyCents, formatSignedMoneyCents, formatDate, formatDateTimeMx } from './format';

describe('formatMoneyCents', () => {
  it('converts cents to MXN units with MX$ symbol', () => {
    expect(formatMoneyCents(168520, 'es')).toMatch(/1,685\.20/);
    expect(formatMoneyCents(168520, 'es')).toMatch(/^MX\$/);
  });

  it('never shows raw cents', () => {
    expect(formatMoneyCents(50, 'es')).toMatch(/0\.50/);
  });

  /**
   * ⭐⭐ **P-98 — EL CANDADO DEL NEGATIVO, y es de dinero, no de tipografía.**
   *
   * La normalización a `MX$` iba anclada en `^`; con el signo delante **no disparaba**, así que
   * en **español** un importe negativo salía como `-$16,855.20` — y `$` a secas, en la tienda de
   * un mexicano, **se lee como dólar**. En inglés no pasaba (`Intl` ya emite `-MX$…`), que es
   * justo lo que lo hacía invisible: el idioma en el que se revisa no era el idioma roto.
   *
   * **Los cuatro casos se asiertan a la vez y como IGUALDAD, no como `toMatch`**: los dos signos
   * × los dos idiomas. Un `toMatch(/MX\$/)` suelto habría pasado con el ancla puesta en tres de
   * los cuatro; la tabla completa es lo que separa «funciona» de «funciona en el caso que probé».
   *
   * ⛔ **Rojo si alguien reintroduce un ancla `^`** en la normalización.
   */
  it('P-98 · conserva el «MX» también en los NEGATIVOS, en los dos idiomas', () => {
    expect(formatMoneyCents(-690, 'es')).toBe('-MX$6.90');
    expect(formatMoneyCents(690, 'es')).toBe('MX$6.90');
    expect(formatMoneyCents(-690, 'en')).toBe('-MX$6.90');
    expect(formatMoneyCents(690, 'en')).toBe('MX$6.90');
  });

  /**
   * Las dos superficies medidas que hoy pueden pasar un negativo a este helper son el P&L
   * (`M7View.tsx`, `pnl.profitCents`) y el KPI de utilidad del tablero
   * (`AdminDashboard.tsx`, `profitPeriodCents`) — ambas en **pérdida**. Se fija aquí la cifra
   * grande, que es la que el dueño mira.
   */
  it('P-98 · una PÉRDIDA del P&L se rotula en pesos mexicanos, no en dólares', () => {
    expect(formatMoneyCents(-1685520, 'es')).toBe('-MX$16,855.20');
    expect(formatMoneyCents(-1685520, 'es')).not.toBe('-$16,855.20');
  });

  it('el cero no lleva signo y sí lleva MX', () => {
    expect(formatMoneyCents(0, 'es')).toBe('MX$0.00');
  });
});

/**
 * `formatSignedMoneyCents` — el delta del dial de traslación del IVA (criterio **188**). Vivía
 * duplicado en `IvaTransferSection.tsx` como rodeo de P-98; arreglado el helper, se unifica.
 */
describe('formatSignedMoneyCents', () => {
  it('usa el menos tipográfico U+2212 y conserva el MX', () => {
    expect(formatSignedMoneyCents(-690, 'es')).toBe('−MX$6.90');
    expect(formatSignedMoneyCents(-690, 'en')).toBe('−MX$6.90');
  });

  it('no antepone «+» a los positivos ni al cero', () => {
    expect(formatSignedMoneyCents(690, 'es')).toBe('MX$6.90');
    expect(formatSignedMoneyCents(0, 'es')).toBe('MX$0.00');
  });

  it('⛔ nunca deja el guion-menos de Intl en la cifra con signo', () => {
    expect(formatSignedMoneyCents(-690, 'es')).not.toContain('-');
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
