import { describe, it, expect } from 'vitest';
import { safeHttpUrl, mailtoHref } from './safe-href';

describe('safeHttpUrl', () => {
  it.each([
    ['https://rastreo.example.com/x?y=1', 'https://rastreo.example.com/x?y=1'],
    ['http://a.mx/', 'http://a.mx/'],
  ])('%s pasa', (raw, out) => expect(safeHttpUrl(raw)).toBe(out));
  it.each(['javascript:alert(1)', 'data:text/html,x', 'JaVaScRiPt:alert(1)', '//evil.com', 'rastreo', '', null, 5])('%s se descarta', (raw) =>
    expect(safeHttpUrl(raw)).toBeNull(),
  );
});

describe('mailtoHref', () => {
  it('conserva @ y codifica el resto', () => {
    expect(mailtoHref('a@b.mx')).toBe('mailto:a@b.mx');
    expect(mailtoHref('a@b.mx?bcc=x@y.z')).toBe('mailto:a@b.mx%3Fbcc%3Dx@y.z');
    expect(mailtoHref('a@b.mx', 'Pedido TCG-1')).toBe('mailto:a@b.mx?subject=Pedido%20TCG-1');
  });
});
