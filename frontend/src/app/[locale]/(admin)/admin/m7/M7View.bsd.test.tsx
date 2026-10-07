import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { M7View } from './M7View';
import * as api from '@/lib/api';
import { mockPnl } from '@/lib/mock/fixtures';
import { formatMoneyCents } from '@/lib/format';
import type { PnlDTO } from '@/types/contract';

/**
 * 💰 rev BSD-1 — M7: la tarifa descontada y las guías para recibir cartas (DESIGN_SYSTEM §BSD-UX.11, contrato §BSD.16).
 * UX-BSD-11 (diez renglones, orden y signo, Σ = profitCents, los dos en 0 siguen), UX-BSD-12 (el margen NO es renglón),
 * UX-BSD-13 (el margen es el del servidor; negativo con su frase), UX-BSD-14 (aviso de costos faltantes ⇔ > 0, sin enlace),
 * UX-BSD-15 (cuándo existe el bloque del margen).
 */
function cents(text: string | null): number {
  const t = text ?? '';
  const digits = Number(t.replace(/[^0-9]/g, ''));
  return /[-−]/.test(t) ? -digits : digits;
}
function pnl(over: Partial<PnlDTO>): PnlDTO {
  const base = { ...mockPnl, ...over };
  // La ganancia la manda el servidor: aquí la fixture la arma con la fórmula para que la Σ de lo pintado cuadre.
  base.profitCents =
    base.incomeCents + base.shippingRevenueCents - base.cogsCents + base.buylistShippingFeeRetainedCents - base.buylistGuideCostCents -
    base.stripeFeesCents - base.shippingCostCents - base.refundsCents - base.refundedFeesCents - base.compensationsCents;
  return base;
}
async function renderWith(p: PnlDTO) {
  vi.spyOn(api, 'getPnl').mockResolvedValue(p);
  renderWithProviders(<M7View />, 'es');
  return screen.findByTestId('pnl-profit');
}

beforeEach(() => vi.restoreAllMocks());

describe('UX-BSD-11 · diez renglones con signo', () => {
  it('4.º `+` = tarifa descontada, 5.º `−` = guías; Σ(signo × monto) = profitCents', async () => {
    const p = pnl({ buylistShippingFeeRetainedCents: 54_000, buylistGuideCostCents: 49_517, buylistGuideMarginCents: 4_483 });
    const profit = await renderWith(p);
    const lines = screen.getAllByTestId('pnl-line');
    expect(lines).toHaveLength(10);
    expect(lines[3]).toHaveTextContent('Tarifa de envío descontada a vendedores');
    expect(lines[3].getAttribute('data-sign')).toBe('+');
    expect(within(lines[3]).getByTestId('pnl-amount')).toHaveTextContent(formatMoneyCents(54_000, 'es'));
    expect(lines[4]).toHaveTextContent('Guías para recibir cartas de vendedores');
    expect(lines[4].getAttribute('data-sign')).toBe('−');
    expect(within(lines[4]).getByTestId('pnl-amount')).toHaveTextContent(formatMoneyCents(49_517, 'es'));
    const suma = lines.reduce((acc, l) => {
      const m = cents(within(l).getByTestId('pnl-amount').textContent);
      return acc + (l.getAttribute('data-sign') === '+' ? m : -m);
    }, 0);
    expect(suma).toBe(p.profitCents);
    expect(cents(profit.textContent)).toBe(p.profitCents);
  });

  it('con los dos en 0 siguen los dos renglones con MX$0.00', async () => {
    await renderWith(pnl({ buylistShippingFeeRetainedCents: 0, buylistGuideCostCents: 0, buylistGuideMarginCents: 0, buylistGuideCostMissingCount: 0 }));
    const lines = screen.getAllByTestId('pnl-line');
    expect(lines).toHaveLength(10);
    expect(within(lines[3]).getByTestId('pnl-amount')).toHaveTextContent(formatMoneyCents(0, 'es'));
    expect(within(lines[4]).getByTestId('pnl-amount')).toHaveTextContent(formatMoneyCents(0, 'es'));
  });
});

describe('UX-BSD-12/13 · el margen es una nota del servidor', () => {
  it('tarifa 18 000, guía 21 552, margen 1 517 ⇒ MX$15.17 (⛔ −35.52); sin signo ni «suma/resta», fuera de la Σ', async () => {
    await renderWith(pnl({ buylistShippingFeeRetainedCents: 18_000, buylistGuideCostCents: 21_552, buylistGuideMarginCents: 1_517 }));
    const margin = screen.getByTestId('pnl-buylist-margin');
    expect(margin.getAttribute('data-testid')).toBe('pnl-buylist-margin');
    expect(margin.hasAttribute('data-sign')).toBe(false);
    expect(margin.querySelector('[data-testid="pnl-line"], [data-testid="pnl-included"], .sr-only')).toBeNull();
    expect(within(margin).getByTestId('pnl-buylist-margin-amount')).toHaveTextContent('MX$15.17');
    expect(margin.textContent).not.toContain('35.52');
    expect(margin).toHaveTextContent('Margen de las guías de vendedores');
    expect(margin).toHaveTextContent('Lo descontado menos lo que costó la guía, en las solicitudes pagadas en este periodo.');
    expect(within(margin).queryByTestId('pnl-buylist-margin-negative')).toBeNull();
    expect(within(margin).getByTestId('pnl-buylist-margin-amount').className).not.toMatch(/text-danger/);
  });

  it('margen −3 552 ⇒ el número tal cual (con su signo), en `text-danger`, y la frase', async () => {
    await renderWith(pnl({ buylistShippingFeeRetainedCents: 18_000, buylistGuideCostCents: 21_552, buylistGuideMarginCents: -3_552 }));
    const amount = screen.getByTestId('pnl-buylist-margin-amount');
    expect(amount).toHaveTextContent(formatMoneyCents(-3_552, 'es'));
    expect(amount.className).toMatch(/text-danger/);
    expect(screen.getByTestId('pnl-buylist-margin-negative')).toHaveTextContent(
      'En este periodo las guías costaron más de lo que se descontó a los vendedores.',
    );
  });
});

describe('UX-BSD-15 · cuándo existe el bloque del margen', () => {
  it('tarifa 0, margen 0 y contador 0 ⇒ no existe', async () => {
    await renderWith(pnl({ buylistShippingFeeRetainedCents: 0, buylistGuideCostCents: 0, buylistGuideMarginCents: 0, buylistGuideCostMissingCount: 0 }));
    expect(screen.queryByTestId('pnl-buylist-margin')).toBeNull();
  });
  it('tarifa > 0 y margen 0 ⇒ existe y dice MX$0.00', async () => {
    await renderWith(pnl({ buylistShippingFeeRetainedCents: 18_000, buylistGuideCostCents: 18_000, buylistGuideMarginCents: 0 }));
    expect(screen.getByTestId('pnl-buylist-margin-amount')).toHaveTextContent(formatMoneyCents(0, 'es'));
  });
});

describe('UX-BSD-14 · guías hechas a mano sin costo', () => {
  it('0 ⇒ ningún nodo', async () => {
    await renderWith(pnl({ buylistGuideCostMissingCount: 0 }));
    expect(screen.queryByTestId('pnl-buylist-guide-missing')).toBeNull();
  });
  it('2 ⇒ `Banner warning` con `role="status"`, el plural de 2 y cero `<a>`/`button` dentro', async () => {
    await renderWith(pnl({ buylistGuideCostMissingCount: 2 }));
    const box = screen.getByTestId('pnl-buylist-guide-missing');
    expect(within(box).getByRole('status')).toHaveTextContent(/^2 solicitudes pagadas usaron una guía hecha a mano sin costo capturado/);
    expect(box.querySelectorAll('a, button')).toHaveLength(0);
  });
});
