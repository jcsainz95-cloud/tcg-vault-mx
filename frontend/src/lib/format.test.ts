import { describe, it, expect } from 'vitest';
import { formatMoneyCents, formatDate } from './format';

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
