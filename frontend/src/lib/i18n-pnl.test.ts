import { describe, it, expect } from 'vitest';
import es from '../../messages/es.json';
import en from '../../messages/en.json';

/**
 * UX-PNL-6 (`DESIGN_SYSTEM §43.23.3` FS-68): las 7 claves nuevas de `admin.m7.pnl` existen en ES y EN con el texto de
 * §43.23.3, `formula` sigue nombrando a Stripe (§29.4b) y dice «ajustes de paquetería» (criterio 238, literal), y ningún
 * texto de `admin.m7.pnl.*` cita un código «M-n», «AG-n» ni «AV-n» (P66-3).
 */

function get(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
}

// El grep de §43.23.5 (`\bM1?[0-9]\b`) NO caza «M-1» (el guion); aquí se acepta el guion opcional, que es el canario de UX-PNL-6.
const CODE = /\b(M-?1?[0-9]|AG-[0-9]+|AV-[0-9]+)\b/;

const EXPECTED: Record<string, { es: string; en: string }> = {
  formula: {
    es: 'Ingresos + ingreso por envío − costo de lo vendido − comisiones Stripe − costo de envío − reembolsos − comisión de plataforma devuelta − compensaciones por carta perdida = ganancia. Los ajustes de paquetería (cargos extra que la paquetería cobra después, contados en el mes en que llegan) y el seguro ya van dentro del costo de envío.',
    en: 'Income + shipping revenue − cost of goods sold − Stripe fees − shipping cost − refunds − platform fees refunded − lost-card compensation = profit. Carrier adjustments (extra charges the carrier bills later, counted in the month they arrive) and insurance are already included in shipping cost.',
  },
  refunds: { es: 'Reembolsos (mercancía y envío, sin IVA)', en: 'Refunds (goods and shipping, excl. VAT)' },
  refundedFees: { es: 'Comisión de plataforma devuelta', en: 'Platform fees refunded' },
  compensations: { es: 'Compensaciones por carta perdida', en: 'Lost-card compensation' },
  shippingAdjustments: { es: 'Incluye ajustes de paquetería', en: 'Includes carrier adjustments' },
  shippingInsurance: { es: 'Incluye seguro del envío', en: 'Includes shipping insurance' },
  signAdds: { es: 'suma', en: 'adds' },
  signSubtracts: { es: 'resta', en: 'subtracts' },
};

describe('UX-PNL-6 · i18n del estado de resultados (§43.23.3)', () => {
  it.each(Object.keys(EXPECTED))('admin.m7.pnl.%s tiene el texto exacto de §43.23.3 en ES y EN', (k) => {
    expect(get(es, `admin.m7.pnl.${k}`)).toBe(EXPECTED[k].es);
    expect(get(en, `admin.m7.pnl.${k}`)).toBe(EXPECTED[k].en);
  });

  it('el objeto `admin.m7.pnl` tiene las mismas claves en ES y EN', () => {
    expect(Object.keys(get(es, 'admin.m7.pnl') as object).sort()).toEqual(Object.keys(get(en, 'admin.m7.pnl') as object).sort());
  });

  it('la fórmula usa el signo − (U+2212), nombra a Stripe y, en ES, dice «ajustes de paquetería»', () => {
    for (const cat of [es, en]) {
      const f = String(get(cat, 'admin.m7.pnl.formula'));
      expect(f).toMatch(/Stripe/);
      expect(f).toContain('−');
      expect(f).not.toMatch(/ - /);
    }
    expect(String(get(es, 'admin.m7.pnl.formula'))).toContain('ajustes de paquetería');
  });

  it('ningún texto de admin.m7.pnl.* nombra un código «M-n», «AG-n» ni «AV-n» (P66-3)', () => {
    const offenders = (['es', 'en'] as const).flatMap((l) => {
      const obj = get(l === 'es' ? es : en, 'admin.m7.pnl') as Record<string, string>;
      return Object.entries(obj).filter(([, v]) => CODE.test(v)).map(([k]) => `${l}:${k}`);
    });
    expect(offenders).toEqual([]);
  });
});
