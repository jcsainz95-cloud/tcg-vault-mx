import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import { AmountBreakdown } from './AmountBreakdown';
import type { BreakdownDTO } from '@/types/contract';

const breakdown: BreakdownDTO = {
  subtotalCents: 140800,
  ivaCents: 22528,
  ivaRatePct: 16,
  processingFeeCents: 5192,
  totalCents: 168520,
  currency: 'MXN',
};

describe('AmountBreakdown', () => {
  it('renders subtotal, itemized IVA line, processing fee and total (ES)', () => {
    renderWithIntl(<AmountBreakdown breakdown={breakdown} />, 'es');

    // El desglose distingue las cuatro líneas del contrato (BreakdownDTO).
    expect(screen.getByText('Subtotal')).toBeInTheDocument();
    expect(screen.getByText('IVA 16%')).toBeInTheDocument();
    expect(screen.getByText('Costo de procesamiento')).toBeInTheDocument();
    expect(screen.getByText('Total a pagar')).toBeInTheDocument();

    // Total formateado en MXN a partir de centavos (168520 → MX$1,685.20).
    expect(screen.getByText(/1,685\.20/)).toBeInTheDocument();
  });

  it('labels the subtotal line as shipping in shipment variant (EN)', () => {
    renderWithIntl(<AmountBreakdown breakdown={breakdown} variant="shipment" />, 'en');
    expect(screen.getByText('Shipping')).toBeInTheDocument();
    expect(screen.getByText('VAT 16%')).toBeInTheDocument();
  });
});
