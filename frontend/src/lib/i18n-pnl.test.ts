import { describe, it, expect } from 'vitest';
import es from '../../messages/es.json';
import en from '../../messages/en.json';
import { get, p66_3Offenders } from './i18n-p66-3.testkit';

/**
 * UX-PNL-6 (`DESIGN_SYSTEM §43.23.3` FS-68): las 7 claves nuevas de `admin.m7.pnl` existen en ES y EN con el texto de
 * §43.23.3, `formula` sigue nombrando a Stripe (§29.4b) y dice «ajustes de paquetería» (criterio 238, literal), y ningún
 * texto de `admin.m7.pnl.*` cita un código «M-n», «AG-n» ni «AV-n» (P66-3).
 */

// P66-3: patrón único en `./i18n-p66-3.testkit` (caza «M-1» con y sin guion; el grep de §43.23.5 no lo cazaba).

const EXPECTED: Record<string, { es: string; en: string }> = {
  // ✏ rev BSD-1 (DESIGN_SYSTEM §BSD-UX.11c): la fórmula gana los dos términos de la tarifa y las guías de vendedores.
  formula: {
    es: 'Ingresos + ingreso por envío − costo de lo vendido + tarifa de envío descontada a vendedores − guías para recibir cartas de vendedores − comisiones Stripe − costo de envío − reembolsos − comisión de plataforma devuelta − compensaciones por carta perdida = ganancia. Los ajustes de paquetería (cargos extra que la paquetería cobra después, contados en el mes en que llegan) y el seguro ya van dentro del costo de envío.',
    en: 'Income + shipping revenue − cost of goods sold + shipping fee deducted from sellers − labels for receiving cards from sellers − Stripe fees − shipping cost − refunds − platform fees refunded − lost-card compensation = profit. Carrier adjustments (extra charges the carrier bills later, counted in the month they arrive) and insurance are already included in shipping cost.',
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
    const offenders = (['es', 'en'] as const).flatMap((l) =>
      p66_3Offenders(l, get(l === 'es' ? es : en, 'admin.m7.pnl') as Record<string, string>),
    );
    expect(offenders).toEqual([]);
  });
});
