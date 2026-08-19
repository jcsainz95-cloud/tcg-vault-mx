import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { SealedValueTrend } from './SealedValueTrend';
import { ApiClientError } from '@/lib/api-client';
import { generateSealedValueHistory } from '@/lib/mock/fixtures';
import * as api from '@/lib/api';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('SealedValueTrend · flag ENCENDIDO (hay serie)', () => {
  it('pinta la tendencia con título, valor actual y selector de rangos', async () => {
    vi.spyOn(api, 'getSealedValueHistory').mockResolvedValue(generateSealedValueHistory('1m'));
    renderWithProviders(<SealedValueTrend inventoryItemId="inv-1008" />, 'es');

    // El selector de rangos solo aparece cuando la serie ya cargó (no en el esqueleto).
    expect(await screen.findByRole('group', { name: 'Rango de la tendencia' })).toBeInTheDocument();
    expect(screen.getByText('Tendencia de valor')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1M' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('serie vacía muestra el aviso de «recopilando historial»', async () => {
    vi.spyOn(api, 'getSealedValueHistory').mockResolvedValue({
      set: { id: 'sealed:x', name: 'X' },
      range: '1m',
      points: [],
      change: { direction: 'flat', absMxnCents: 0, pct: null },
    });
    renderWithProviders(<SealedValueTrend inventoryItemId="inv-1008" />, 'es');

    expect(await screen.findByText('Recopilando historial de mercado.')).toBeInTheDocument();
  });
});

describe('SealedValueTrend · flag APAGADO (404 FEATURE_DISABLED)', () => {
  it('se oculta limpio (no renderiza nada) cuando el endpoint responde 404', async () => {
    vi.spyOn(api, 'getSealedValueHistory').mockRejectedValue(
      new ApiClientError(404, { code: 'FEATURE_DISABLED', message: 'off' }),
    );
    const { container } = renderWithProviders(<SealedValueTrend inventoryItemId="inv-1008" />, 'es');

    await waitFor(() => expect(screen.queryByText('Tendencia de valor')).toBeNull());
    expect(container).toBeEmptyDOMElement();
  });

  it('se oculta también con 404 NOT_FOUND (pieza sin serie)', async () => {
    vi.spyOn(api, 'getSealedValueHistory').mockRejectedValue(
      new ApiClientError(404, { code: 'NOT_FOUND', message: 'not mapped' }),
    );
    const { container } = renderWithProviders(<SealedValueTrend inventoryItemId="inv-1008" />, 'es');

    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
