import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { M7View } from './M7View';
import { mockPnl } from '@/lib/mock/fixtures';
import { formatMoneyCents } from '@/lib/format';
import type { PnlDTO, PnlStatementDTO } from '@/types/contract';

/**
 * 💰 §M10-IVA.8-bis (C) — el estado de resultados con SUBTOTALES, ADITIVO a `GET /admin/finance/pnl`.
 *
 * El objeto `statement` llega del servidor derivado por construcción (`netResultCents ≡ profitCents`). La pantalla
 * pinta sus subtotales TAL CUAL (⛔ no re-suma, GAS-4) y el bloque IVA aparte, rotulado y **sin restarse** (es memo
 * fiscal). Si `statement` no viene (backend sin fusionar), el P&L degrada a la lista plana sin romperse.
 */

function cents(text: string | null): number {
  const t = text ?? '';
  const digits = Number(t.replace(/[^0-9]/g, ''));
  return /[-−]/.test(t) ? -digits : digits;
}

// Derivado por construcción de `mockPnl` (idéntico álgebra que el servidor; ivaNet < ebitda a propósito).
const STATEMENT: PnlStatementDTO = {
  totalRevenueCents: mockPnl.incomeCents + mockPnl.shippingRevenueCents,
  cogsCents: mockPnl.cogsCents,
  grossMarginCents: mockPnl.incomeCents + mockPnl.shippingRevenueCents - mockPnl.cogsCents,
  operatingExpenses: {
    stripeFeesCents: mockPnl.stripeFeesCents,
    shippingCostCents: mockPnl.shippingCostCents,
    refundsCents: mockPnl.refundsCents,
    refundedFeesCents: mockPnl.refundedFeesCents,
    compensationsCents: mockPnl.compensationsCents,
    buylistGuideCostCents: mockPnl.buylistGuideCostCents,
    buylistShippingFeeRetainedCents: mockPnl.buylistShippingFeeRetainedCents,
    totalCents:
      mockPnl.stripeFeesCents +
      mockPnl.shippingCostCents +
      mockPnl.refundsCents +
      mockPnl.refundedFeesCents +
      mockPnl.compensationsCents +
      mockPnl.buylistGuideCostCents -
      mockPnl.buylistShippingFeeRetainedCents,
  },
  ebitdaCents: mockPnl.profitCents,
  iva: { ivaCollectedCents: 200_000, ivaRefundedCents: 5_600, ivaNetCents: 194_400 },
  netResultCents: mockPnl.profitCents,
};

async function withPnl(patch: Partial<PnlDTO>, fn: () => Promise<void>) {
  const previo = { ...mockPnl };
  Object.assign(mockPnl, patch);
  try {
    await fn();
  } finally {
    Object.assign(mockPnl, previo);
    delete (mockPnl as Partial<PnlDTO>).statement;
  }
}

describe('§M10-IVA.8-bis (C) · estado de resultados con subtotales', () => {
  it('pinta Total ingresos, Margen bruto, Gastos de operación y EBITDA con la cifra del servidor', async () => {
    await withPnl({ statement: STATEMENT }, async () => {
      renderWithProviders(<M7View />, 'es');
      const block = await screen.findByTestId('pnl-statement');
      const amounts = within(block).getAllByTestId('pnl-subtotal-amount').map((n) => cents(n.textContent));
      expect(amounts).toEqual([
        STATEMENT.totalRevenueCents,
        STATEMENT.grossMarginCents,
        STATEMENT.operatingExpenses.totalCents,
        STATEMENT.ebitdaCents,
      ]);
      expect(within(block).getByText('Total ingresos')).toBeInTheDocument();
      expect(within(block).getByText('Margen bruto')).toBeInTheDocument();
      expect(within(block).getByText('Gastos de operación')).toBeInTheDocument();
      expect(within(block).getByText('EBITDA')).toBeInTheDocument();
    });
  });

  it('⛔⛔ el IVA es un MEMO rotulado y NO se resta: el resultado neto sigue siendo profitCents', async () => {
    await withPnl({ statement: STATEMENT }, async () => {
      renderWithProviders(<M7View />, 'es');
      const memo = await screen.findByTestId('pnl-iva-memo');
      expect(memo).toHaveTextContent('IVA por enterar al SAT — informativo, no es un gasto del negocio');
      expect(cents(within(memo).getByTestId('pnl-iva-net').textContent)).toBe(STATEMENT.iva.ivaNetCents);
      // La ganancia pintada es el resultado neto = profitCents; ⛔ no 530448 − 194400.
      const profit = screen.getByTestId('pnl-profit');
      expect(cents(profit.textContent)).toBe(mockPnl.profitCents);
      expect(cents(profit.textContent)).toBe(STATEMENT.netResultCents);
      expect(screen.getByText('Resultado neto')).toBeInTheDocument();
    });
  });

  it('degrada con gracia: sin `statement` no hay subtotales ni memo, y el rótulo vuelve a «Ganancia del periodo»', async () => {
    renderWithProviders(<M7View />, 'es');
    await screen.findByTestId('pnl-profit');
    expect(screen.queryByTestId('pnl-statement')).toBeNull();
    expect(screen.queryByTestId('pnl-iva-memo')).toBeNull();
    expect(screen.getByText('Ganancia del periodo')).toBeInTheDocument();
    // La ganancia plana sigue intacta.
    expect(cents(screen.getByTestId('pnl-profit').textContent)).toBe(mockPnl.profitCents);
    // No deja residuo del formato de dinero en el memo que ya no existe.
    expect(screen.queryByText(formatMoneyCents(STATEMENT.iva.ivaNetCents, 'es'))).toBeNull();
  });
});
