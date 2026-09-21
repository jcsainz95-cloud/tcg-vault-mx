import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { StandardLegalityControl } from './StandardLegalityControl';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('StandardLegalityControl · ventana de legalidad', () => {
  it('PRE-CARGA la ventana vigente con el GET y llena los chips', async () => {
    vi.spyOn(api, 'getStandardLegality').mockResolvedValue({
      activeMarks: ['G', 'H'],
      banlistCardIds: ['sv1-1'],
    });
    renderWithProviders(<StandardLegalityControl />, 'es');

    // Los chips salen sembrados por la lectura, sin necesidad de guardar.
    expect(await screen.findByText('G')).toBeInTheDocument();
    expect(screen.getByText('H')).toBeInTheDocument();
    expect(screen.getByText('sv1-1')).toBeInTheDocument();
  });

  it('con la ventana vacía muestra los estados vacíos de ambos campos', async () => {
    vi.spyOn(api, 'getStandardLegality').mockResolvedValue({ activeMarks: [], banlistCardIds: [] });
    renderWithProviders(<StandardLegalityControl />, 'es');

    expect(
      await screen.findByText('Sin marcas: casi todo caería como «rotada».'),
    ).toBeInTheDocument();
    expect(screen.getByText('Sin cartas baneadas.')).toBeInTheDocument();
  });

  it('un fallo del GET muestra el aviso de lectura con reintento', async () => {
    vi.spyOn(api, 'getStandardLegality').mockRejectedValue(
      new ApiClientError(502, { code: 'INTERNAL', message: 'boom' }),
    );
    renderWithProviders(<StandardLegalityControl />, 'es');

    expect(await screen.findByText('No se pudo leer la ventana de legalidad.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('agrega una marca como ficha y la guarda con el PUT (patch completo)', async () => {
    vi.spyOn(api, 'getStandardLegality').mockResolvedValue({ activeMarks: [], banlistCardIds: [] });
    const put = vi
      .spyOn(api, 'updateStandardLegality')
      .mockResolvedValue({ activeMarks: ['H'], banlistCardIds: [] });
    renderWithProviders(<StandardLegalityControl />, 'es');

    // Espera a que la lectura resuelva antes de editar.
    await screen.findByText('Sin marcas: casi todo caería como «rotada».');

    const marksInput = screen.getByLabelText('Marcas vigentes');
    fireEvent.change(marksInput, { target: { value: 'H' } });
    fireEvent.keyDown(marksInput, { key: 'Enter' });

    expect(screen.getByText('H')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Guardar ventana' }));

    await waitFor(() =>
      expect(put).toHaveBeenCalledWith({ activeMarks: ['H'], banlistCardIds: [] }),
    );
    expect(await screen.findByText('Ventana de legalidad guardada.')).toBeInTheDocument();
  });

  it('deduplica y quita fichas', async () => {
    vi.spyOn(api, 'getStandardLegality').mockResolvedValue({ activeMarks: [], banlistCardIds: [] });
    renderWithProviders(<StandardLegalityControl />, 'es');
    await screen.findByText('Sin marcas: casi todo caería como «rotada».');

    const marksInput = screen.getByLabelText('Marcas vigentes');
    fireEvent.change(marksInput, { target: { value: 'G, H, G' } });
    fireEvent.keyDown(marksInput, { key: 'Enter' });
    expect(screen.getAllByText('G')).toHaveLength(1);
    expect(screen.getByText('H')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Quitar H' }));
    expect(screen.queryByText('H')).not.toBeInTheDocument();
  });
});
