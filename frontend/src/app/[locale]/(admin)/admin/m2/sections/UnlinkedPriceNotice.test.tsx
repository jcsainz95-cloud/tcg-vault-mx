import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import type { UnlinkedPriceReport } from '@/types/contract';
import { UnlinkedPriceNotice } from './UnlinkedPriceNotice';

const REPORT: UnlinkedPriceReport = {
  totalCards: 12,
  sets: [
    { setId: 'sv1', name: 'Scarlet', unlinked: 9, total: 100, collisions: 2, omittedProducts: null },
    { setId: 'sv2', name: 'Violet', unlinked: 3, total: 50, collisions: null, omittedProducts: 1 },
  ],
};

beforeEach(() => vi.restoreAllMocks());

describe('UnlinkedPriceNotice', () => {
  it('ausente o 0 cartas: no pinta nada', () => {
    const a = renderWithProviders(<UnlinkedPriceNotice report={undefined} />);
    expect(a.container.textContent).toBe('');
    const b = renderWithProviders(<UnlinkedPriceNotice report={{ totalCards: 0, sets: [] }} />);
    expect(b.container.textContent).toBe('');
  });

  it('presente: total, lista por set, colisiones y omitidos solo si no son null', () => {
    renderWithProviders(<UnlinkedPriceNotice report={REPORT} />);
    expect(screen.getByText(/12 cartas sin precio ligado/)).toBeTruthy();
    expect(screen.getByText(/9 de 100 sin ligar · 2 coincidencias dudosas/)).toBeTruthy();
    expect(screen.queryByText(/9 de 100 sin ligar.*omitidos/)).toBeNull();
    expect(screen.getByText(/3 de 50 sin ligar · 1 omitidos/)).toBeTruthy();
  });

  it('reintento ok: llama sync {setId, force:true} y avisa', async () => {
    const spy = vi.spyOn(api, 'syncCatalog').mockResolvedValue({} as never);
    renderWithProviders(<UnlinkedPriceNotice report={REPORT} />);
    fireEvent.click(screen.getByRole('button', { name: /Reintentar enlace de Scarlet/ }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ setId: 'sv1', force: true }));
    expect(await screen.findByText(/Enlace reintentado en Scarlet/)).toBeTruthy();
  });

  it('reintento con error: muestra alerta', async () => {
    vi.spyOn(api, 'syncCatalog').mockRejectedValue(new Error('boom'));
    renderWithProviders(<UnlinkedPriceNotice report={REPORT} />);
    fireEvent.click(screen.getByRole('button', { name: /Reintentar enlace de Violet/ }));
    expect(await screen.findByText(/No se pudo reintentar el enlace de Violet/)).toBeTruthy();
  });
});
