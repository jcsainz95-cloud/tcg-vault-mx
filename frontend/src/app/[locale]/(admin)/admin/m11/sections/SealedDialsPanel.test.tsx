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

describe('SealedDialsPanel · diales de precio del sellado (§diseño §1.iv/§3/§9)', () => {
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

  it('M11-ingest-button-off: con el dial off el botón «Traer precios ahora» está DESHABILITADO y dice por qué', async () => {
    withSource('off');
    const ingest = vi.spyOn(api, 'triggerSealedPriceIngest');
    renderWithProviders(<SealedDialsPanel />, 'es');

    const btn = await screen.findByRole('button', { name: /Traer precios ahora/ });
    expect(btn).toBeDisabled();
    expect(screen.getByText(/La fuente automática está apagada/)).toBeInTheDocument();
    fireEvent.click(btn);
    expect(ingest).not.toHaveBeenCalled();
  });

  it('con el dial on, «Traer precios ahora» dispara la ingesta y al encolar muestra «Ingesta completada»', async () => {
    withSource('tcgcsv');
    const ingest = vi
      .spyOn(api, 'triggerSealedPriceIngest')
      .mockResolvedValue({ job: 'sealed-price-ingest', enqueued: true, jobId: 'j1' });
    renderWithProviders(<SealedDialsPanel />, 'es');

    fireEvent.click(await screen.findByRole('button', { name: /Traer precios ahora/ }));
    await waitFor(() => expect(ingest).toHaveBeenCalled());
    expect(await screen.findByText(/Ingesta completada/)).toBeInTheDocument();
  });

  it('estado SEALED_PRICE_SOURCE_OFF de la respuesta: muestra el aviso money-safe (no error)', async () => {
    withSource('tcgcsv');
    vi.spyOn(api, 'triggerSealedPriceIngest').mockResolvedValue({
      job: 'sealed-price-ingest',
      enqueued: false,
      reason: 'SEALED_PRICE_SOURCE_OFF',
    });
    renderWithProviders(<SealedDialsPanel />, 'es');
    fireEvent.click(await screen.findByRole('button', { name: /Traer precios ahora/ }));
    expect(await screen.findByText(/SEALED_PRICE_SOURCE_OFF/)).toBeInTheDocument();
  });

  it('estado en curso (single-flight): enqueued=false sin reason muestra «ya hay una ingesta en curso»', async () => {
    withSource('tcgcsv');
    vi.spyOn(api, 'triggerSealedPriceIngest').mockResolvedValue({
      job: 'sealed-price-ingest',
      enqueued: false,
    });
    renderWithProviders(<SealedDialsPanel />, 'es');
    fireEvent.click(await screen.findByRole('button', { name: /Traer precios ahora/ }));
    expect(await screen.findByText(/Ya hay una ingesta en curso/)).toBeInTheDocument();
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
