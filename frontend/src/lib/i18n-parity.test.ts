import { describe, it, expect } from 'vitest';
import es from '../../messages/es.json';
import en from '../../messages/en.json';
import { getBadgeSpec, type StatusDomain } from './status-map';

function keyPaths(obj: unknown, prefix = ''): string[] {
  if (typeof obj !== 'object' || obj === null) return [prefix];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    keyPaths(v, prefix ? `${prefix}.${k}` : k),
  );
}

function stringEntries(obj: unknown, prefix = ''): [string, string][] {
  if (typeof obj === 'string') return [[prefix, obj]];
  if (typeof obj !== 'object' || obj === null) return [];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    stringEntries(v, prefix ? `${prefix}.${k}` : k),
  );
}

describe('i18n catalogs', () => {
  it('ES and EN have identical key sets (no missing translations)', () => {
    const esKeys = keyPaths(es).sort();
    const enKeys = keyPaths(en).sort();
    expect(esKeys).toEqual(enKeys);
  });

  // The brand is TCG HUNT (common.brand.name). "TCG Vault MX" is the internal
  // project/doc name and must never leak into buyer-facing copy.
  it.each([
    ['es', es],
    ['en', en],
  ])('%s contains no string with the retired "TCG Vault" name', (_locale, catalog) => {
    const offenders = stringEntries(catalog)
      .filter(([, value]) => /tcg\s*vault/i.test(value))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});

describe('status-map ↔ i18n coverage', () => {
  const enums: Record<string, string[]> = {
    ownership: ['pending', 'settled'],
    order: ['pending', 'settled', 'failed', 'refunded', 'chargeback'],
    shipment: ['solicitado', 'picking', 'guia', 'enviado', 'entregado', 'cancelado'],
    sellRequest: ['cotizada', 'recibida', 'verificacion', 'aprobada', 'pagada', 'rechazada', 'abandonada'],
    dispute: ['abierta', 'en_revision', 'resuelta_recompra', 'rechazada'],
  };

  it('every contract enum resolves to a badge spec whose i18n key exists in both locales', () => {
    const esFlat = new Set(keyPaths(es));
    const enFlat = new Set(keyPaths(en));
    for (const [domain, values] of Object.entries(enums)) {
      for (const value of values) {
        const spec = getBadgeSpec(domain as StatusDomain, value);
        expect(esFlat.has(spec.i18nKey), `ES missing ${spec.i18nKey}`).toBe(true);
        expect(enFlat.has(spec.i18nKey), `EN missing ${spec.i18nKey}`).toBe(true);
      }
    }
  });
});
