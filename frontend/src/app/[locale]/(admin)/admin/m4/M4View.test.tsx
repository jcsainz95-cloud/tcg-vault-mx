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

describe('M4View · cambio de estado manual (F4)', () => {
  it('shp-7001 (enviado) ofrece "Marcar entregado" → PATCH status enviado→entregado', async () => {
    const spy = vi
      .spyOn(api, 'updateAdminShipmentStatus')
      .mockResolvedValue({ id: 'shp-7001', status: 'entregado' });
    renderWithProviders(<M4View />, 'es');
    await screen.findByText('shp-7001');

    fireEvent.click(screen.getByRole('button', { name: 'Marcar entregado' }));

    await waitFor(() => expect(spy).toHaveBeenCalledWith('shp-7001', 'entregado'));
    expect(await screen.findByText('Estado actualizado (shp-7001).')).toBeInTheDocument();
  });

  it('cancelar pide confirmación y hace PATCH status →cancelado', async () => {
    const spy = vi
      .spyOn(api, 'updateAdminShipmentStatus')
      .mockResolvedValue({ id: 'shp-7003', status: 'cancelado' });
    renderWithProviders(<M4View />, 'es');
    await screen.findByText('shp-7003');

    // Botones "Cancelar" (ghost) por-envío: shp-7002 (picking) y shp-7003 (solicitado).
    const cancelButtons = screen.getAllByRole('button', { name: 'Cancelar' });
    fireEvent.click(cancelButtons[cancelButtons.length - 1]); // shp-7003

    const dialog = await screen.findByRole('dialog', { name: 'Cancelar envío' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar envío' }));

    await waitFor(() => expect(spy).toHaveBeenCalledWith('shp-7003', 'cancelado'));
  });

  it('no ofrece transiciones manuales en un envío entregado (terminal)', async () => {
    const spy = vi.spyOn(api, 'updateAdminShipmentStatus');
    // Fuerza la cola a un único envío entregado (terminal).
    vi.spyOn(api, 'getAdminShipments').mockResolvedValue({
      data: [
        {
          id: 'shp-done',
          userId: 'u-1',
          status: 'entregado',
          carrier: 'Estafeta',
          trackingNumber: '111',
          requestedAt: '2026-08-10T10:00:00Z',
          items: [{ inventoryItemId: 'inv-1' }],
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
    });
    renderWithProviders(<M4View />, 'es');
    await screen.findByText('shp-done');

    expect(screen.queryByRole('button', { name: 'Marcar entregado' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });
});
