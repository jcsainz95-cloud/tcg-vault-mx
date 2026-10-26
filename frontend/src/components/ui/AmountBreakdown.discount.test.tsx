import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import type { BreakdownDTO, DiscountAppliedDTO } from '@/types/contract';
import { AmountBreakdown } from './AmountBreakdown';

/**
 * §DSC-UX.2 — la fila del descuento en el desglose. Orden Subtotal → Descuento → Envío (→ Envío gratis) → IVA (informa)
 * → comisión → Total. ⛔ Ninguna cifra sale del front: Subtotal = `merchandiseBeforeDiscountCents`, Descuento =
 * `discountCents`, Envío gratis = `shippingWaivedCents` y el resto, el `breakdown` del servidor tal cual. Importes de
 * ejemplo de la maqueta `docs/mockups/dsc-checkout.html` §3 (comisiones ilustrativas).
 */

const bd = (b: Partial<BreakdownDTO>): BreakdownDTO => ({
  subtotalCents: 0,
  ivaCents: 0,
  ivaRatePct: 16,
  processingFeeCents: 0,
  totalCents: 0,
  currency: 'MXN',
  priceConvention: 'IVA_INCLUSIVE',
  ivaIncluded: true,
  ...b,
});
const rows = () =>
  Array.from(screen.getByTestId('amount-breakdown').querySelectorAll(':scope > div')).map((d) => d.textContent?.replace(/\s+/g, ' ').trim());

describe('AmountBreakdown · §DSC-UX.2', () => {
  it('sin `discount` (criterio 915): las filas de hoy, sin «Descuento»', () => {
    renderWithProviders(<AmountBreakdown breakdown={bd({ subtotalCents: 420000, shippingFeeCents: 0, ivaCents: 57931, processingFeeCents: 15100, totalCents: 435100 })} />);
    expect(rows()).toEqual([
      expect.stringMatching(/^Subtotal\s*MX\$4,200\.00$/),
      expect.stringMatching(/^Envío\s*MX\$0\.00$/),
      expect.stringMatching(/^IVA.*MX\$579\.31$/),
      expect.stringMatching(/^Comisión de plataforma\s*MX\$151\.00$/),
      expect.stringMatching(/^Total a pagar\s*MX\$4,351\.00$/),
    ]);
    expect(screen.queryByTestId('amount-breakdown-discount')).toBeNull();
  });

  it('10 % (SEPT10): Subtotal = S, «Descuento (SEPT10) −MX$420.00» justo debajo, Envío y Total del servidor', () => {
    const discount: DiscountAppliedDTO = { outcome: 'applied', code: 'SEPT10', kind: 'percent', merchandiseBeforeDiscountCents: 420000, discountCents: 42000, shippingWaivedCents: 0 };
    renderWithProviders(
      <AmountBreakdown breakdown={bd({ subtotalCents: 378000, shippingFeeCents: 17500, ivaCents: 54552, processingFeeCents: 14300, totalCents: 409800 })} discount={discount} />,
    );
    const r = rows();
    expect(r[0]).toMatch(/^Subtotal\s*MX\$4,200\.00$/);
    expect(r[1]).toBe('Descuento (SEPT10)−MX$420.00');
    expect(r[2]).toMatch(/^Envío\s*MX\$175\.00$/);
    expect(r.at(-1)).toMatch(/MX\$4,098\.00$/);
    const line = screen.getByTestId('amount-breakdown-discount');
    expect(line.className).toMatch(/border-l-2/);
    expect(within(line).getByText('−MX$420.00').textContent?.charCodeAt(0)).toBe(0x2212); // menos tipográfico
  });

  it('envío gratis (ENVIO25): «Envío» sigue mostrando su tarifa y «Envío gratis (ENVIO25) −MX$175.00» va debajo', () => {
    const discount: DiscountAppliedDTO = { outcome: 'applied', code: 'ENVIO25', kind: 'free_shipping', merchandiseBeforeDiscountCents: 350000, discountCents: 0, shippingWaivedCents: 17500 };
    renderWithProviders(
      <AmountBreakdown breakdown={bd({ subtotalCents: 350000, shippingFeeCents: 0, ivaCents: 48276, processingFeeCents: 12600, totalCents: 362600 })} discount={discount} />,
    );
    const r = rows();
    expect(r[0]).toMatch(/^Subtotal\s*MX\$3,500\.00$/);
    expect(r[1]).toMatch(/^Envío\s*MX\$175\.00$/);
    expect(r[2]).toBe('Envío gratis (ENVIO25)−MX$175.00');
    expect(r.at(-1)).toMatch(/MX\$3,626\.00$/);
  });

  it('retiro gratis (variante A): «Envío del retiro MX$203.00», «Envío gratis (ENVIO25) −MX$203.00», Total MX$0.00', () => {
    const discount: DiscountAppliedDTO = { outcome: 'applied', code: 'ENVIO25', kind: 'free_shipping', merchandiseBeforeDiscountCents: 0, discountCents: 0, shippingWaivedCents: 20300 };
    renderWithProviders(<AmountBreakdown variant="shipment" breakdown={bd({})} discount={discount} />);
    const r = rows();
    expect(r[0]).toMatch(/^Envío del retiro\s*MX\$203\.00$/);
    expect(r[1]).toBe('Envío gratis (ENVIO25)−MX$203.00');
    expect(r.at(-1)).toMatch(/^Total a pagar\s*MX\$0\.00$/);
  });

  it('un código de 20 caracteres no empuja el importe fuera de la fila (rótulo con corte, importe `shrink-0`)', () => {
    const discount: DiscountAppliedDTO = { outcome: 'applied', code: 'ABCDEFGHJKMNPQRSTVWX', kind: 'fixed_amount', merchandiseBeforeDiscountCents: 1000000, discountCents: 99999, shippingWaivedCents: 0 };
    renderWithProviders(<AmountBreakdown breakdown={bd({ subtotalCents: 900001, shippingFeeCents: 0, totalCents: 930000 })} discount={discount} />);
    const line = screen.getByTestId('amount-breakdown-discount');
    expect(line.querySelector('span:last-child')?.className).toMatch(/shrink-0/);
    expect(line.querySelector('span:first-child')?.className).toMatch(/overflow-wrap:anywhere/);
  });
});
