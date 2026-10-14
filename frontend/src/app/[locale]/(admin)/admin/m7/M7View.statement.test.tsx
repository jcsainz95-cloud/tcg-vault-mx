import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { M7View } from './M7View';
import { mockPnl } from '@/lib/mock/fixtures';
import { formatMoneyCents } from '@/lib/format';
import type { PnlDTO, PnlStatementDTO } from '@/types/contract';

/**
 * 💰 §M10-IVA.8-bis (C), v1.95.2 — el estado de resultados como WATERFALL de e-commerce estándar, ADITIVO a
 * `GET /admin/finance/pnl`.
 *
 * VENTAS → (− Devoluciones y reembolsos) → VENTAS NETAS → (− Costo de venta) → MARGEN BRUTO (contribución) →
 * EBITDA (= margen bruto) → IVA (memo, ⛔ no se resta) → RESULTADO NETO.
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
const returnsTotal = mockPnl.refundsCents + mockPnl.refundedFeesCents + mockPnl.compensationsCents;
const salesCents = mockPnl.incomeCents + mockPnl.shippingRevenueCents;
const netRevenueCents = salesCents - returnsTotal;
const costOfSalesTotal =
  mockPnl.cogsCents +
  mockPnl.stripeFeesCents +
  mockPnl.shippingCostCents +
  mockPnl.buylistGuideCostCents -
  mockPnl.buylistShippingFeeRetainedCents;
const grossMarginCents = netRevenueCents - costOfSalesTotal;

const STATEMENT: PnlStatementDTO = {
  salesCents,
  returnsAndRefunds: {
    refundsCents: mockPnl.refundsCents,
    refundedFeesCents: mockPnl.refundedFeesCents,
    compensationsCents: mockPnl.compensationsCents,
    totalCents: returnsTotal,
  },
  netRevenueCents,
  costOfSales: {
    cogsCents: mockPnl.cogsCents,
    stripeFeesCents: mockPnl.stripeFeesCents,
    shippingCostCents: mockPnl.shippingCostCents,
    buylistGuideCostCents: mockPnl.buylistGuideCostCents,
    buylistShippingFeeRetainedCents: mockPnl.buylistShippingFeeRetainedCents,
    totalCents: costOfSalesTotal,
  },
  grossMarginCents,
  ebitdaCents: grossMarginCents,
  iva: { ivaCollectedCents: 200_000, ivaRefundedCents: 5_600, ivaNetCents: 194_400 },
  netResultCents: grossMarginCents,
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

describe('§M10-IVA.8-bis (C) v1.95.2 · estado de resultados en waterfall', () => {
  it('invariante del fixture: netResult ≡ profitCents (⛔ el cliente no re-suma, lo verifica el servidor)', () => {
    expect(STATEMENT.netResultCents).toBe(mockPnl.profitCents);
    expect(STATEMENT.ebitdaCents).toBe(STATEMENT.grossMarginCents);
  });

  it('pinta los tres grupos en orden: VENTAS, DEVOLUCIONES Y REEMBOLSOS, COSTO DE VENTA', async () => {
    await withPnl({ statement: STATEMENT }, async () => {
      renderWithProviders(<M7View />, 'es');
      const block = await screen.findByTestId('pnl-statement');
      const groups = within(block).getAllByTestId('stmt-group').map((n) => n.textContent);
      expect(groups).toEqual(['Ventas', 'Devoluciones y reembolsos', 'Costo de venta']);
    });
  });

  it('VENTAS: income y shippingRevenue como conceptos (de pnl.data plano) y salesCents como subtotal del grupo', async () => {
    await withPnl({ statement: STATEMENT }, async () => {
      renderWithProviders(<M7View />, 'es');
      const block = await screen.findByTestId('pnl-statement');
      const conceptAmounts = within(block)
        .getAllByTestId('stmt-amount')
        .map((n) => cents(n.textContent));
      // Los dos primeros conceptos del waterfall son los planos de VENTAS.
      expect(conceptAmounts[0]).toBe(mockPnl.incomeCents);
      expect(conceptAmounts[1]).toBe(mockPnl.shippingRevenueCents);
      // El subtotal de VENTAS es salesCents, del JSON (⛔ no recalculado en el cliente).
      const subtotals = within(block)
        .getAllByTestId('pnl-subtotal-amount')
        .map((n) => cents(n.textContent));
      expect(subtotals[0]).toBe(STATEMENT.salesCents);
    });
  });

  it('los subtotales son, en orden, salesCents → netRevenueCents → grossMarginCents → ebitdaCents, todos del JSON', async () => {
    await withPnl({ statement: STATEMENT }, async () => {
      renderWithProviders(<M7View />, 'es');
      const block = await screen.findByTestId('pnl-statement');
      const subtotals = within(block)
        .getAllByTestId('pnl-subtotal-amount')
        .map((n) => cents(n.textContent));
      expect(subtotals).toEqual([
        STATEMENT.salesCents,
        STATEMENT.netRevenueCents,
        STATEMENT.grossMarginCents,
        STATEMENT.ebitdaCents,
      ]);
      expect(within(block).getByText('Ventas netas')).toBeInTheDocument();
      expect(within(block).getByText('Margen bruto')).toBeInTheDocument();
      expect(within(block).getByText('EBITDA')).toBeInTheDocument();
    });
  });

  it('devoluciones (3) y la tarifa retenida se pintan como RESTA explícita (data-sign="−" + sr-only «resta»)', async () => {
    await withPnl({ statement: STATEMENT }, async () => {
      renderWithProviders(<M7View />, 'es');
      const block = await screen.findByTestId('pnl-statement');
      const deducts = within(block).getAllByTestId('stmt-line').filter((n) => n.getAttribute('data-sign') === '−');
      // 3 devoluciones + 1 tarifa retenida (crédito que resta del costo del grupo) = 4.
      expect(deducts).toHaveLength(4);
      const amounts = deducts.map((n) => cents(within(n).getByTestId('stmt-amount').textContent));
      expect(amounts).toEqual([
        mockPnl.refundsCents,
        mockPnl.refundedFeesCents,
        mockPnl.compensationsCents,
        mockPnl.buylistShippingFeeRetainedCents,
      ]);
      // Cada resta OYE «resta» en el sr-only (accesibilidad UX-PNL-5, mismo patrón que la lista plana).
      for (const line of deducts) {
        expect(within(line).getByText('resta')).toBeInTheDocument();
      }
    });
  });

  it('COSTO DE VENTA: cogs, stripe, envío y guías van como conceptos (sin resta); solo la tarifa retenida resta', async () => {
    await withPnl({ statement: STATEMENT }, async () => {
      renderWithProviders(<M7View />, 'es');
      const block = await screen.findByTestId('pnl-statement');
      const costLabels = ['Costo de lo vendido', 'Comisiones Stripe', 'Costo de envío (paquetería, neto)', 'Guías para recibir cartas de vendedores'];
      for (const label of costLabels) {
        const row = within(block).getByText(label).closest('[data-testid="stmt-line"]');
        expect(row).not.toBeNull();
        // No es resta: no lleva data-sign ni «resta» en sr-only.
        expect(row!.getAttribute('data-sign')).toBeNull();
      }
      // La tarifa retenida SÍ es resta.
      const retained = within(block).getByText('Tarifa de envío descontada a vendedores').closest('[data-testid="stmt-line"]');
      expect(retained!.getAttribute('data-sign')).toBe('−');
    });
  });

  it('ayuda honesta: margen de contribución, y que NO incluye gastos fijos (nómina, renta, marketing)', async () => {
    await withPnl({ statement: STATEMENT }, async () => {
      renderWithProviders(<M7View />, 'es');
      const help = await screen.findByTestId('stmt-contribution-help');
      expect(help).toHaveTextContent('margen de contribución');
      expect(help).toHaveTextContent('No incluye gastos fijos (nómina, renta, marketing)');
    });
  });

  it('⛔⛔ el IVA es un MEMO rotulado y NO se resta: el resultado neto sigue siendo profitCents', async () => {
    await withPnl({ statement: STATEMENT }, async () => {
      renderWithProviders(<M7View />, 'es');
      const memo = await screen.findByTestId('pnl-iva-memo');
      expect(memo).toHaveTextContent('IVA por enterar al SAT — informativo, no es un gasto del negocio');
      expect(cents(within(memo).getByTestId('pnl-iva-net').textContent)).toBe(STATEMENT.iva.ivaNetCents);
      // La ganancia pintada es el resultado neto = profitCents = ebitda; ⛔ no ebitda − ivaNet.
      const profit = screen.getByTestId('pnl-profit');
      expect(cents(profit.textContent)).toBe(mockPnl.profitCents);
      expect(cents(profit.textContent)).toBe(STATEMENT.netResultCents);
      expect(screen.getByText('Resultado neto')).toBeInTheDocument();
    });
  });

  it('degrada con gracia: sin `statement` no hay waterfall ni memo, y el rótulo vuelve a «Ganancia del periodo»', async () => {
    renderWithProviders(<M7View />, 'es');
    await screen.findByTestId('pnl-profit');
    expect(screen.queryByTestId('pnl-statement')).toBeNull();
    expect(screen.queryByTestId('pnl-iva-memo')).toBeNull();
    expect(screen.queryByTestId('stmt-group')).toBeNull();
    expect(screen.getByText('Ganancia del periodo')).toBeInTheDocument();
    // La ganancia plana sigue intacta.
    expect(cents(screen.getByTestId('pnl-profit').textContent)).toBe(mockPnl.profitCents);
    // No deja residuo del formato de dinero en el memo que ya no existe.
    expect(screen.queryByText(formatMoneyCents(STATEMENT.iva.ivaNetCents, 'es'))).toBeNull();
  });
});
