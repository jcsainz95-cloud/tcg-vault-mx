import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as repair from '@/lib/api/catalog-link-repair';
import { ApiClientError } from '@/lib/api-client';
import type { UnlinkedPriceReport } from '@/types/contract';
import { UnlinkedPriceNotice } from './UnlinkedPriceNotice';

const UUID1 = '3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b';
const UUID2 = '8a9b0c1d-2e3f-4a5b-8c6d-7e8f9a0b1c2d';
const REPORT: UnlinkedPriceReport = {
  totalCards: 12,
  sets: [
    { setId: UUID1, name: 'Scarlet', unlinked: 9, total: 100, collisions: 2, omittedProducts: null },
    { setId: UUID2, name: 'Violet', unlinked: 3, total: 50, collisions: null, omittedProducts: 1 },
  ],
  notLinkable: { totalCards: 4, sets: [{ setId: 'x', name: 'Promos Raros', unlinked: 4, reason: 'no_group' }] },
};

beforeEach(() => vi.restoreAllMocks());

describe('UnlinkedPriceNotice', () => {
  it('ausente o 0 cartas: no pinta nada', () => {
    const a = renderWithProviders(<UnlinkedPriceNotice report={undefined} />);
    expect(a.container.textContent).toBe('');
    const b = renderWithProviders(<UnlinkedPriceNotice report={{ totalCards: 0, sets: [] }} />);
    expect(b.container.textContent).toBe('');
  });

  it('presente: título con sets, lista por set, y «no ligables» aparte sin botón', () => {
    renderWithProviders(<UnlinkedPriceNotice report={REPORT} />);
    expect(screen.getByText('12 cartas sin precio ligado en 2 sets')).toBeTruthy();
    expect(screen.getByText(/9 de 100 sin ligar · 2 coincidencias dudosas/)).toBeTruthy();
    expect(screen.getByText(/3 de 50 sin ligar · 1 omitidos/)).toBeTruthy();
    expect(screen.queryByText(/no cambia precios ya cargados/)).toBeNull();
    const nl = screen.getByTestId('unlinked-not-linkable');
    expect(nl.textContent).toMatch(/Promos Raros.*este set no tiene grupo de precios/);
    expect(nl.querySelector('button')).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('reintento ok: llama link-repair con el UUID local y dice cuántas se ligaron', async () => {
    const spy = vi.spyOn(repair, 'repairCatalogLinks').mockResolvedValue({ linked: 5, reason: null });
    renderWithProviders(<UnlinkedPriceNotice report={REPORT} />);
    fireEvent.click(screen.getByRole('button', { name: /Reintentar enlace de Scarlet/ }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith(UUID1));
    expect((await screen.findByTestId('unlinked-result')).textContent).toBe('Se ligaron 5 cartas en Scarlet.');
  });

  it('0 ligadas: dice la verdad con el motivo', async () => {
    vi.spyOn(repair, 'repairCatalogLinks').mockResolvedValue({ linked: 0, reason: 'collisions' });
    renderWithProviders(<UnlinkedPriceNotice report={REPORT} />);
    fireEvent.click(screen.getByRole('button', { name: /Reintentar enlace de Violet/ }));
    expect((await screen.findByTestId('unlinked-result')).textContent).toBe(
      'No se pudo ligar ninguna carta en Violet: hay números repetidos y no se sabe cuál es cuál.',
    );
  });

  it('429: espera unos minutos; otro error: alerta', async () => {
    const spy = vi
      .spyOn(repair, 'repairCatalogLinks')
      .mockRejectedValueOnce(new ApiClientError(429, { code: 'RATE_LIMITED', message: 'x' } as never))
      .mockRejectedValueOnce(new Error('boom'));
    renderWithProviders(<UnlinkedPriceNotice report={REPORT} />);
    fireEvent.click(screen.getByRole('button', { name: /Reintentar enlace de Scarlet/ }));
    expect(await screen.findByText('Espera unos minutos antes de reintentar este set.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Reintentar enlace de Violet/ }));
    expect(await screen.findByText(/No se pudo reintentar el enlace de Violet/)).toBeTruthy();
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe('readLinkRepair', () => {
  it('mapea el motivo dominante', () => {
    expect(repair.readLinkRepair({ linked: 3 })).toEqual({ linked: 3, reason: null });
    expect(repair.readLinkRepair({ linked: 0, notLinkable: 'no_group' }).reason).toBe('noGroup');
    expect(repair.readLinkRepair({ linked: 0, collisions: 1, conflicts: 4 }).reason).toBe('conflicts');
    expect(repair.readLinkRepair({ linked: 0, omitted: [{ reason: 'name_mismatch', count: 2 }] }).reason).toBe('nameMismatch');
  });
});
