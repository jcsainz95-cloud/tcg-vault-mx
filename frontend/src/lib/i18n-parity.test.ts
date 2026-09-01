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

describe('i18n catalogs', () => {
  it('ES and EN have identical key sets (no missing translations)', () => {
    const esKeys = keyPaths(es).sort();
    const enKeys = keyPaths(en).sort();
    expect(esKeys).toEqual(enKeys);
  });
});

describe('status-map ↔ i18n coverage', () => {
  const enums: Record<string, string[]> = {
    ownership: ['pending', 'settled'],
    order: ['pending', 'settled', 'failed', 'refunded', 'chargeback'],
    shipment: ['solicitado', 'picking', 'guia', 'enviado', 'entregado', 'cancelado'],
    // ⚠️ v1.51 (M-46): los ONCE valores del enum del contrato. Un estado sin rótulo se pintaba
    // con la clave i18n cruda en pantalla; esta lista es lo que impide que vuelva a pasar.
    sellRequest: [
      'cotizada',
      'ofertada',
      'aceptada',
      'en_transito',
      'recibida',
      'verificacion',
      'aprobada',
      'pagada',
      'rechazada',
      'abandonada',
      'expirada',
    ],
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

  // DESIGN_SYSTEM §23.1d: `expirada` resuelve por `expiredReason`, y los DOS motivos necesitan
  // rótulo propio en los dos catálogos (son copys distintos, no matices del mismo).
  it('los dos motivos de `expirada` resuelven a specs distintas con rótulo en ambos idiomas', () => {
    const esFlat = new Set(keyPaths(es));
    const enFlat = new Set(keyPaths(en));
    const specs = ['no_offer', 'not_shipped'].map((reason) =>
      getBadgeSpec('sellRequest', 'expirada', reason),
    );
    for (const spec of specs) {
      expect(esFlat.has(spec.i18nKey), `ES missing ${spec.i18nKey}`).toBe(true);
      expect(enFlat.has(spec.i18nKey), `EN missing ${spec.i18nKey}`).toBe(true);
    }
    // Motivos opuestos ⇒ specs distintas: si alguien colapsara el mapeo, esto lo caza.
    expect(specs[0].i18nKey).not.toBe(specs[1].i18nKey);
    expect(specs[0].tone).not.toBe(specs[1].tone);
    // Y el fallback (motivo ausente) NUNCA es el acusatorio.
    expect(getBadgeSpec('sellRequest', 'expirada').tone).toBe('neutral');
    expect(getBadgeSpec('sellRequest', 'expirada', null).tone).toBe('neutral');
  });
});
