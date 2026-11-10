import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { M7View } from './M7View';
import { mockPnl } from '@/lib/mock/fixtures';
import type { PnlDTO } from '@/types/contract';

/** D9 §8.1: «~» y nota solo si `stripeFeeEstimatedOrders > 0`. */
async function withPnl(patch: Partial<PnlDTO>, fn: () => Promise<void>) {
  const previo = { ...mockPnl };
  Object.assign(mockPnl, patch);
  try {
    await fn();
  } finally {
    for (const k of Object.keys(patch)) delete (mockPnl as unknown as Record<string, unknown>)[k];
    Object.assign(mockPnl, previo);
  }
}

describe('D9 · comisión Stripe estimada en Finanzas', () => {
  it('con 0 pedidos estimados no hay «~» ni nota', async () => {
    await withPnl({ stripeFeeEstimatedOrders: 0, stripeFeeEstimatedCents: 0 }, async () => {
      renderWithProviders(<M7View />, 'es');
      await screen.findByTestId('pnl-profit');
      expect(screen.queryByText(/costo estimado/)).toBeNull();
      expect(screen.queryByText(/^~MX\$/)).toBeNull();
    });
  });

  it('plural es: 1 pedido', async () => {
    await withPnl({ stripeFeeEstimatedOrders: 1, stripeFeeEstimatedCents: 1200 }, async () => {
      renderWithProviders(<M7View />, 'es');
      await screen.findByTestId('pnl-profit');
      expect(screen.getByText('Incluye 1 pedido con costo estimado (MX$12.00)')).toBeTruthy();
      expect(screen.getByText(/^~MX\$/)).toBeTruthy();
    });
  });

  it('plural es: 3 pedidos', async () => {
    await withPnl({ stripeFeeEstimatedOrders: 3, stripeFeeEstimatedCents: 3600 }, async () => {
      renderWithProviders(<M7View />, 'es');
      await screen.findByTestId('pnl-profit');
      expect(screen.getByText('Incluye 3 pedidos con costo estimado (MX$36.00)')).toBeTruthy();
    });
  });

  it('en inglés', async () => {
    await withPnl({ stripeFeeEstimatedOrders: 2, stripeFeeEstimatedCents: 2400 }, async () => {
      renderWithProviders(<M7View />, 'en');
      await screen.findByTestId('pnl-profit');
      expect(screen.getByText(/Includes 2 orders with an estimated cost/)).toBeTruthy();
    });
  });

  it('feeIncludedSince con fecha: nota larga es-MX en zona de México (es y en)', async () => {
    await withPnl({ feeIncludedSince: '2026-11-11T03:00:00.000Z' }, async () => {
      renderWithProviders(<M7View />, 'es');
      await screen.findByTestId('pnl-profit');
      expect(screen.getByTestId('pnl-fee-included-since').textContent).toBe(
        'Desde el 10 de noviembre de 2026 la comisión de plataforma va incluida en el precio de cada carta; antes de esa fecha se cobraba aparte.',
      );
    });
  });

  it('feeIncludedSince con fecha, en inglés', async () => {
    await withPnl({ feeIncludedSince: '2026-11-11T03:00:00.000Z' }, async () => {
      renderWithProviders(<M7View />, 'en');
      await screen.findByTestId('pnl-profit');
      expect(screen.getByTestId('pnl-fee-included-since').textContent).toContain('Since November 10, 2026');
    });
  });

  it('feeIncludedSince null o ausente: sin nota', async () => {
    await withPnl({ feeIncludedSince: null }, async () => {
      renderWithProviders(<M7View />, 'es');
      await screen.findByTestId('pnl-profit');
      expect(screen.queryByTestId('pnl-fee-included-since')).toBeNull();
    });
  });

  it('feeIncludedSince ausente: sin nota', async () => {
    await withPnl({}, async () => {
      renderWithProviders(<M7View />, 'es');
      await screen.findByTestId('pnl-profit');
      expect(screen.queryByTestId('pnl-fee-included-since')).toBeNull();
    });
  });
});
