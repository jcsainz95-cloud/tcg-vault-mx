import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, within, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { mockSettings } from '@/lib/mock/fixtures';
import { SealedDialsPanel } from './SealedDialsPanel';

function withSource(source: 'off' | 'tcgcsv') {
  vi.spyOn(api, 'getSettings').mockResolvedValue({ ...mockSettings, sealedPriceSource: source });
  vi.spyOn(api, 'getSealedSpreads').mockResolvedValue({ spreadPctBySubtype: {}, fallbackPct: 15 });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('SealedDialsPanel · Ajustes avanzados (§diseño §5)', () => {
  it('presenta las tres subsecciones rotuladas con su línea de para-qué-sirve', async () => {
    withSource('off');
    renderWithProviders(<SealedDialsPanel />, 'es');
    expect(await screen.findByText('Fuente automática de mercado')).toBeInTheDocument();
    expect(screen.getByText('Cómo se calculan los precios')).toBeInTheDocument();
    expect(screen.getByText('Márgenes de venta')).toBeInTheDocument();
    // La línea de propósito (canario del rediseño): sin ella, la subsección vuelve a ser un dial mudo.
    expect(screen.getByText(/Normalmente no lo tocas/)).toBeInTheDocument();
  });

  it('el botón «Traer precios ahora» YA NO vive aquí (subió a la capa 2)', async () => {
    withSource('tcgcsv');
    renderWithProviders(<SealedDialsPanel />, 'es');
    await screen.findByText('Fuente automática de mercado');
    expect(screen.queryByRole('button', { name: /Traer precios ahora/ })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Actualizar precios de la colección/ }),
    ).not.toBeInTheDocument();
  });

  it('el interruptor maestro pide CONFIRMACIÓN antes de encender, y encender manda sealedPriceSource:tcgcsv', async () => {
    withSource('off');
    const put = vi.spyOn(api, 'updateSettings').mockResolvedValue(mockSettings);
    renderWithProviders(<SealedDialsPanel />, 'es');

    fireEvent.click(await screen.findByRole('button', { name: /Encender la fuente automática/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Es una decisión de dinero/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: /Encender la fuente automática/ }));
    await waitFor(() => expect(put).toHaveBeenCalledWith({ sealedPriceSource: 'tcgcsv' }));
  });

  it('M11-master-preserves-override (I-7): el copy de APAGAR dice que los precios manuales NO se apagan', async () => {
    withSource('tcgcsv');
    const put = vi.spyOn(api, 'updateSettings').mockResolvedValue(mockSettings);
    renderWithProviders(<SealedDialsPanel />, 'es');

    fireEvent.click(await screen.findByRole('button', { name: /Apagar la fuente automática/ }));
    const dialog = await screen.findByRole('dialog');
    // La invariante crítica: apagar el maestro NO borra los overrides manuales.
    expect(
      within(dialog).getByText(/precios manuales y los overrides ya fijados NO se apagan/i),
    ).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: /Apagar la fuente automática/ }));
    await waitFor(() => expect(put).toHaveBeenCalledWith({ sealedPriceSource: 'off' }));
  });

  it('guarda un dial de settings por PUT parcial (solo la clave tocada)', async () => {
    withSource('off');
    const put = vi.spyOn(api, 'updateSettings').mockResolvedValue(mockSettings);
    renderWithProviders(<SealedDialsPanel />, 'es');

    const trend = (await screen.findByLabelText(/Tendencia de valor del sellado/)) as HTMLSelectElement;
    fireEvent.change(trend, { target: { value: 'on' } });
    fireEvent.click(screen.getByRole('button', { name: /Guardar 1 cambio/ }));
    await waitFor(() => expect(put).toHaveBeenCalledWith({ sealedValueTrend: 'on' }));
  });
});
