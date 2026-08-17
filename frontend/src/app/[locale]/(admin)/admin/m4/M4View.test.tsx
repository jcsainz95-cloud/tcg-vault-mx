import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { M4View } from './M4View';
import * as api from '@/lib/api';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('M4View · Retiros / envíos (cola admin)', () => {
  it('lista la COLA ADMIN de envíos de clientes (GET /admin/shipments), no los propios', async () => {
    const spy = vi.spyOn(api, 'getAdminShipments');
    const ownSpy = vi.spyOn(api, 'getShipments');
    renderWithProviders(<M4View />, 'es');

    // Los tres envíos de clientes del fixture admin (shp-7002 sale también en picking → findAll).
    expect(await screen.findByText('shp-7001')).toBeInTheDocument();
    expect(screen.getAllByText('shp-7002').length).toBeGreaterThan(0);
    expect(screen.getByText('shp-7003')).toBeInTheDocument();
    expect(spy).toHaveBeenCalled();
    // La vista admin NO consume los envíos del propio admin.
    expect(ownSpy).not.toHaveBeenCalled();
  });

  it('filtra por estado re-consultando con ?status=', async () => {
    const spy = vi.spyOn(api, 'getAdminShipments');
    renderWithProviders(<M4View />, 'es');
    await screen.findByText('shp-7001');

    fireEvent.change(screen.getByLabelText('Filtrar por estado'), { target: { value: 'picking' } });

    await waitFor(() => expect(spy).toHaveBeenCalledWith({ status: 'picking' }));
    expect((await screen.findAllByText('shp-7002')).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.queryByText('shp-7001')).not.toBeInTheDocument());
  });

  it('muestra la lista de picking real (GET /admin/shipments/picking-list) por ubicación', async () => {
    const spy = vi.spyOn(api, 'getAdminPickingList');
    renderWithProviders(<M4View />, 'es');

    // Filas del fixture: folio + ubicación (DataTable pinta tabla + card mobile → findAll).
    expect((await screen.findAllByText('INV-000101')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('C03-F02-S15').length).toBeGreaterThan(0);
    expect(spy).toHaveBeenCalled();
  });

  it('captura de guía: envía carrier + tracking y confirma con el id del envío', async () => {
    const trackSpy = vi.spyOn(api, 'saveShipmentTracking').mockResolvedValue({
      id: 'shp-7002',
      status: 'guia',
      carrier: 'DHL',
      trackingNumber: 'MX123',
      createdAt: '2026-08-13T09:30:00Z',
      items: [],
    });
    renderWithProviders(<M4View />, 'es');
    await screen.findAllByText('shp-7002');

    // shp-7002 (picking) admite captura de guía.
    const captureButtons = screen.getAllByRole('button', { name: 'Capturar guía' });
    fireEvent.click(captureButtons[1]);

    const dialog = await screen.findByRole('dialog', { name: 'Captura de guía' });
    fireEvent.change(within(dialog).getByLabelText('Paquetería'), { target: { value: 'DHL' } });
    fireEvent.change(within(dialog).getByLabelText('Número de guía'), { target: { value: 'MX123' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar guía' }));

    await waitFor(() =>
      expect(trackSpy).toHaveBeenCalledWith('shp-7002', { carrier: 'DHL', trackingNumber: 'MX123' }),
    );
    expect(await screen.findByText('Guía guardada para shp-7002.')).toBeInTheDocument();
  });
});
