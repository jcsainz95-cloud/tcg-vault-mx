import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { M7View } from './M7View';
import { mockPnl } from '@/lib/mock/fixtures';
import { formatMoneyCents } from '@/lib/format';
import type { PnlDTO } from '@/types/contract';

/**
 * 💰 F-3 — `API_CONTRACT §M4-SHIP.19.36.1` (a)(b)(c) y `DESIGN_SYSTEM §43.23.6` UX-PNL-1…5.
 *
 * El estado de resultados de M7 pinta **ocho** renglones con signo (la fórmula entera) y, bajo «Costo de envío», los
 * «Incluye…» de ajustes de paquetería y seguro **sin** signo (ya están dentro del costo de envío). La ganancia es
 * SIEMPRE `profitCents` del servidor: ⛔ la pantalla no suma ni recalcula (GAS-4).
 *
 * Las pruebas suman por atributo (`data-sign`) y monto (`pnl-amount`), no adivinando el texto.
 */

/** «MX$12,500.00» / «-MX$3.00» ⇒ centavos. `formatMoneyCents` siempre pinta dos decimales. */
function cents(text: string | null): number {
  const t = text ?? '';
  const digits = Number(t.replace(/[^0-9]/g, ''));
  return /[-−]/.test(t) ? -digits : digits;
}

const ES_LINES = [
  'Ingresos (ventas)',
  'Ingreso por envío (cobrado)',
  'Costo de lo vendido',
  // ✏ rev BSD-1 (§BSD-UX.11a): los dos renglones de la tarifa y las guías de vendedores, justo debajo del costo de compras.
  'Tarifa de envío descontada a vendedores',
  'Guías para recibir cartas de vendedores',
  'Comisiones Stripe',
  'Costo de envío (paquetería, neto)',
  'Reembolsos (mercancía y envío, sin IVA)',
  'Comisión de plataforma devuelta',
  'Compensaciones por carta perdida',
];
const ES_SIGNS = ['+', '+', '−', '+', '−', '−', '−', '−', '−', '−'];

/** Altera el fixture compartido solo durante `fn` (mismo patrón que la prueba de `shippingCostMissingCount`). */
async function withPnl(patch: Partial<PnlDTO>, fn: () => Promise<void>) {
  const previo = { ...mockPnl };
  Object.assign(mockPnl, patch);
  try {
    await fn();
  } finally {
    Object.assign(mockPnl, previo);
  }
}

async function renderPnl(locale: 'es' | 'en' = 'es') {
  renderWithProviders(<M7View />, locale);
  return screen.findByTestId('pnl-profit');
}

describe('F-3 · el fixture `mockPnl` (N-PNL-1, §19.36.1)', () => {
  it('los cinco campos nuevos ≠ 0, ajustes y seguro < costo de envío, y profitCents cuadra con la fórmula', () => {
    expect(mockPnl.shippingAdjustmentsCents).toBeGreaterThan(0);
    expect(mockPnl.shippingInsuranceCents).toBeGreaterThan(0);
    expect(mockPnl.refundsCents).toBeGreaterThan(0);
    expect(mockPnl.refundedFeesCents).toBeGreaterThan(0);
    expect(mockPnl.compensationsCents).toBeGreaterThan(0);
    expect(mockPnl.shippingAdjustmentsCents).toBeLessThan(mockPnl.shippingCostCents);
    expect(mockPnl.shippingInsuranceCents).toBeLessThan(mockPnl.shippingCostCents);
    expect(mockPnl.shippingAdjustmentsCents + mockPnl.shippingInsuranceCents).toBeLessThan(mockPnl.shippingCostCents);
    expect(mockPnl.profitCents).toBe(
      mockPnl.incomeCents + mockPnl.shippingRevenueCents - mockPnl.cogsCents +
        mockPnl.buylistShippingFeeRetainedCents - mockPnl.buylistGuideCostCents - mockPnl.stripeFeesCents -
        mockPnl.shippingCostCents - mockPnl.refundsCents - mockPnl.refundedFeesCents - mockPnl.compensationsCents,
    );
  });
});

describe('F-3 · M7 estado de resultados (§43.23)', () => {
  it('UX-PNL-1 (a) ✏ UX-BSD-11: diez renglones con signo, en orden, y Σ(signo × monto) = ganancia pintada = profitCents', async () => {
    const profit = await renderPnl();
    const lines = screen.getAllByTestId('pnl-line');
    expect(lines).toHaveLength(10);
    lines.forEach((line, i) => {
      expect(line).toHaveTextContent(ES_LINES[i]);
      expect(line.getAttribute('data-sign')).toBe(ES_SIGNS[i]);
    });
    const suma = lines.reduce((acc, line) => {
      const monto = cents(within(line).getByTestId('pnl-amount').textContent);
      return acc + (line.getAttribute('data-sign') === '+' ? monto : -monto);
    }, 0);
    expect(cents(profit.textContent)).toBe(mockPnl.profitCents);
    expect(suma).toBe(cents(profit.textContent));
    // Los tres renglones nuevos llevan su cifra del servidor, tal cual.
    expect(within(lines[7]).getByTestId('pnl-amount')).toHaveTextContent(formatMoneyCents(mockPnl.refundsCents, 'es'));
    expect(within(lines[8]).getByTestId('pnl-amount')).toHaveTextContent(formatMoneyCents(mockPnl.refundedFeesCents, 'es'));
    expect(within(lines[9]).getByTestId('pnl-amount')).toHaveTextContent(formatMoneyCents(mockPnl.compensationsCents, 'es'));
    // UX-BSD-11: el 4.º `+` = tarifa descontada, el 5.º `−` = guías, con la cifra del servidor tal cual.
    expect(within(lines[3]).getByTestId('pnl-amount')).toHaveTextContent(formatMoneyCents(mockPnl.buylistShippingFeeRetainedCents, 'es'));
    expect(within(lines[4]).getByTestId('pnl-amount')).toHaveTextContent(formatMoneyCents(mockPnl.buylistGuideCostCents, 'es'));
  });

  it('UX-PNL-2 (b): los «Incluye…» con su monto, sin signo, sin rojo, entre «Costo de envío» y «Reembolsos»', async () => {
    await renderPnl();
    const included = screen.getAllByTestId('pnl-included');
    expect(included).toHaveLength(2);
    expect(included[0]).toHaveTextContent('Incluye ajustes de paquetería');
    expect(within(included[0]).getByTestId('pnl-amount')).toHaveTextContent(formatMoneyCents(mockPnl.shippingAdjustmentsCents, 'es'));
    expect(included[1]).toHaveTextContent('Incluye seguro del envío');
    expect(within(included[1]).getByTestId('pnl-amount')).toHaveTextContent(formatMoneyCents(mockPnl.shippingInsuranceCents, 'es'));
    for (const el of included) {
      expect(el.hasAttribute('data-sign')).toBe(false);
      expect(el.textContent).not.toMatch(/[+−=·]/);
      expect(el.querySelector('.text-danger')).toBeNull();
      expect(el.className).not.toMatch(/text-danger/);
    }
    const lines = screen.getAllByTestId('pnl-line');
    const shippingCost = lines[6];
    const refunds = lines[7];
    for (const el of included) {
      expect(shippingCost.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(el.compareDocumentPosition(refunds) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('UX-PNL-2 (b): con ajustes y seguro en 0 no aparece ningún «Incluye…»', async () => {
    await withPnl({ shippingAdjustmentsCents: 0, shippingInsuranceCents: 0 }, async () => {
      await renderPnl();
      expect(screen.queryAllByTestId('pnl-included')).toHaveLength(0);
      expect(screen.queryByText(/Incluye/)).toBeNull();
    });
  });

  it('UX-PNL-2 (b): con un sub-renglón en 0 y el otro > 0, solo se pinta el segundo', async () => {
    await withPnl({ shippingAdjustmentsCents: 0 }, async () => {
      await renderPnl();
      const included = screen.getAllByTestId('pnl-included');
      expect(included).toHaveLength(1);
      expect(included[0]).toHaveTextContent('Incluye seguro del envío');
      expect(screen.queryByText('Incluye ajustes de paquetería')).toBeNull();
    });
  });

  it('UX-PNL-3 (c): la ganancia pintada es profitCents aunque un renglón ya no cuadre (no recalcula)', async () => {
    await withPnl({ refundsCents: mockPnl.refundsCents + 77_700 }, async () => {
      const profit = await renderPnl();
      expect(profit).toHaveTextContent(formatMoneyCents(mockPnl.profitCents, 'es'));
      expect(cents(profit.textContent)).toBe(mockPnl.profitCents);
    });
  });

  it('UX-PNL-4: con los tres nuevos en 0, los tres renglones siguen con MX$0.00', async () => {
    await withPnl({ refundsCents: 0, refundedFeesCents: 0, compensationsCents: 0 }, async () => {
      await renderPnl();
      const lines = screen.getAllByTestId('pnl-line');
      expect(lines).toHaveLength(10);
      for (const i of [7, 8, 9]) {
        expect(lines[i]).toHaveTextContent(ES_LINES[i]);
        expect(within(lines[i]).getByTestId('pnl-amount')).toHaveTextContent(formatMoneyCents(0, 'es'));
      }
    });
  });

  it.each([
    ['es', 'suma', 'resta'],
    ['en', 'adds', 'subtracts'],
  ] as const)('UX-PNL-5 (%s): cada renglón dice «%s»/«%s» en sr-only antes del rótulo; los «Incluye…» no', async (locale, adds, subtracts) => {
    await renderPnl(locale);
    for (const line of screen.getAllByTestId('pnl-line')) {
      const sr = line.querySelector('.sr-only');
      expect(sr).not.toBeNull();
      expect(sr!.textContent).toBe(line.getAttribute('data-sign') === '+' ? adds : subtracts);
      // «antes del rótulo»: el texto audible del renglón (sin lo aria-hidden) empieza por el signo dicho.
      const clone = line.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
      expect(clone.textContent!.trim().startsWith(sr!.textContent!)).toBe(true);
    }
    for (const el of screen.getAllByTestId('pnl-included')) {
      expect(el.querySelector('.sr-only')).toBeNull();
      expect(el.textContent).not.toMatch(new RegExp(`\\b(${adds}|${subtracts})\\b`));
    }
  });
});
