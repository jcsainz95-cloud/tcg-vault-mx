import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { mockSettings } from '@/lib/mock/fixtures';
import es from '../../../../../../../messages/es.json';
import en from '../../../../../../../messages/en.json';
import { ShipV3Section, SHIP_V3_DIAL_KEYS } from './ShipV3Section';
import type { SettingsDTO } from '@/types/contract';

const S = es.admin.m10.shipV3;
const settings = (over: Partial<SettingsDTO> = {}): SettingsDTO => ({
  ...mockSettings,
  shipV3Enabled: 'off',
  shipSkydropxMaxPerMin: 60,
  shipCacheTtlS: 21600,
  ...over,
});

beforeEach(() => vi.restoreAllMocks());

describe('§ENV3 · interruptor del envío por código postal en M10', () => {
  it('muestra título, ayuda y estado actual (apagado) y los dos diales con sus valores', async () => {
    vi.spyOn(api, 'getSettings').mockResolvedValue(settings());
    renderWithProviders(<ShipV3Section />, 'es');
    const section = await screen.findByTestId('m10-ship-v3');
    expect(await within(section).findByText('Envío calculado por código postal (FedEx Overnight + MX$20)')).toBeInTheDocument();
    expect(within(section).getByText('Apagado: se cobra la tarifa fija de arriba.')).toBeInTheDocument();
    expect(within(section).getByTestId('ship-v3-state')).toHaveTextContent('Ahora: apagado');
    expect(within(section).getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    expect((within(section).getByLabelText(S.labels.shipSkydropxMaxPerMin) as HTMLInputElement).value).toBe('60');
    expect((within(section).getByLabelText(S.labels.shipCacheTtlS) as HTMLInputElement).value).toBe('21600');
    expect(SHIP_V3_DIAL_KEYS).toEqual(['shipV3Enabled', 'shipSkydropxMaxPerMin', 'shipCacheTtlS']);
  });

  it('encender PIDE confirmación y solo al confirmar manda shipV3Enabled:on; cancelar no manda nada', async () => {
    vi.spyOn(api, 'getSettings').mockResolvedValue(settings());
    const put = vi.spyOn(api, 'updateSettings').mockResolvedValue(settings({ shipV3Enabled: 'on' }));
    renderWithProviders(<ShipV3Section />, 'es');
    const toggle = await screen.findByTestId('ship-v3-toggle');
    fireEvent.click(toggle);
    expect(await screen.findByTestId('ship-v3-confirm')).toHaveTextContent('¿Encender el envío por código postal?');
    expect(put).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByTestId('ship-v3-confirm')).getByRole('button', { name: es.common.cancel }));
    expect(screen.queryByTestId('ship-v3-confirm')).toBeNull();
    expect(put).not.toHaveBeenCalled();
    fireEvent.click(toggle);
    fireEvent.click(await screen.findByTestId('ship-v3-confirm-yes'));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0][0]).toEqual({ shipV3Enabled: 'on' });
  });

  it('encendido: lo dice y APAGAR manda off sin confirmación', async () => {
    vi.spyOn(api, 'getSettings').mockResolvedValue(settings({ shipV3Enabled: 'on' }));
    const put = vi.spyOn(api, 'updateSettings').mockResolvedValue(settings());
    renderWithProviders(<ShipV3Section />, 'es');
    expect(await screen.findByTestId('ship-v3-state')).toHaveTextContent('Ahora: encendido');
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByTestId('ship-v3-toggle'));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0][0]).toEqual({ shipV3Enabled: 'off' });
    expect(screen.queryByTestId('ship-v3-confirm')).toBeNull();
  });

  it('diales: valida el rango antes de enviar, manda solo lo tocado y muestra el 422 del servidor', async () => {
    vi.spyOn(api, 'getSettings').mockResolvedValue(settings());
    const put = vi
      .spyOn(api, 'updateSettings')
      .mockRejectedValueOnce(new ApiClientError(422, { code: 'VALIDATION_ERROR', message: 'x', details: { errors: { shipCacheTtlS: 'range' } } }))
      .mockResolvedValue(settings({ shipSkydropxMaxPerMin: 90 }));
    renderWithProviders(<ShipV3Section />, 'es');
    const rate = (await screen.findByLabelText(S.labels.shipSkydropxMaxPerMin)) as HTMLInputElement;
    const ttl = screen.getByLabelText(S.labels.shipCacheTtlS) as HTMLInputElement;
    const save = screen.getByTestId('m10-ship-v3-save');
    expect(save).toBeDisabled();
    fireEvent.change(rate, { target: { value: '601' } });
    expect(save).toBeDisabled();
    expect(screen.getByText('Escribe un entero de 1 a 600.')).toBeInTheDocument();
    fireEvent.change(rate, { target: { value: '90' } });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0][0]).toEqual({ shipSkydropxMaxPerMin: 90 });
    fireEvent.change(ttl, { target: { value: '120' } });
    fireEvent.click(screen.getByTestId('m10-ship-v3-save'));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(2));
  });

  it('servidor sin el interruptor ⇒ aviso, sin controles; y los textos existen en inglés', async () => {
    const old = settings();
    delete old.shipV3Enabled;
    vi.spyOn(api, 'getSettings').mockResolvedValue(old);
    renderWithProviders(<ShipV3Section />, 'es');
    expect(await screen.findByText(S.unavailable)).toBeInTheDocument();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(Object.keys(en.admin.m10.shipV3).sort()).toEqual(Object.keys(es.admin.m10.shipV3).sort());
    expect(en.admin.m10.shipV3.switchLabel).toBe('Shipping calculated by postal code (FedEx Overnight + MX$20)');
  });
});
