import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { StandardLegalityControl } from './StandardLegalityControl';
import * as api from '@/lib/api';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('StandardLegalityControl · ventana de legalidad', () => {
  it('renderiza el editor con la nota del hueco de lectura y los campos vacíos', () => {
    renderWithProviders(<StandardLegalityControl />, 'es');

    expect(screen.getByText('Ventana de legalidad')).toBeInTheDocument();
    // El estado arranca «desconocido» (no hay GET): nota explícita en llano.
    expect(
      screen.getByText(
        'Por ahora no se puede leer la ventana guardada desde aquí; lo que ves refleja el último guardado de esta sesión. Al guardar, defines la ventana completa.',
      ),
    ).toBeInTheDocument();
    // Los dos campos, vacíos.
    expect(screen.getByText('Sin marcas: casi todo caería como «rotada».')).toBeInTheDocument();
    expect(screen.getByText('Sin cartas baneadas.')).toBeInTheDocument();
  });

  it('agrega una marca como ficha y la guarda con el PUT (patch completo)', async () => {
    const put = vi
      .spyOn(api, 'updateStandardLegality')
      .mockResolvedValue({ activeMarks: ['H'], banlistCardIds: [] });
    renderWithProviders(<StandardLegalityControl />, 'es');

    const marksInput = screen.getByLabelText('Marcas vigentes');
    fireEvent.change(marksInput, { target: { value: 'H' } });
    fireEvent.keyDown(marksInput, { key: 'Enter' });

    // La ficha aparece.
    expect(screen.getByText('H')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Guardar ventana' }));

    await waitFor(() =>
      expect(put).toHaveBeenCalledWith({ activeMarks: ['H'], banlistCardIds: [] }),
    );
    expect(await screen.findByText('Ventana de legalidad guardada.')).toBeInTheDocument();
  });

  it('deduplica y quita fichas', () => {
    renderWithProviders(<StandardLegalityControl />, 'es');
    const marksInput = screen.getByLabelText('Marcas vigentes');

    // Coma agrega varias de una; el duplicado no entra dos veces.
    fireEvent.change(marksInput, { target: { value: 'G, H, G' } });
    fireEvent.keyDown(marksInput, { key: 'Enter' });
    expect(screen.getAllByText('G')).toHaveLength(1);
    expect(screen.getByText('H')).toBeInTheDocument();

    // Quitar la ficha «H».
    fireEvent.click(screen.getByRole('button', { name: 'Quitar H' }));
    expect(screen.queryByText('H')).not.toBeInTheDocument();
  });
});
