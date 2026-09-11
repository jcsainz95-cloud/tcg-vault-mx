import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { M4View } from './M4View';
import * as api from '@/lib/api';

// «Ver ficha» → M6 usa Link de next-intl con href de objeto; en jsdom se aplana a <a href>.
vi.mock('@/i18n/navigation', () => ({
  Link: ({
    href,
    children,
    ...props
  }: {
    href: string | { pathname: string; query?: Record<string, string> };
    children: React.ReactNode;
  }) => {
    const flat =
      typeof href === 'string'
        ? href
        : `${href.pathname}${href.query ? `?${new URLSearchParams(href.query).toString()}` : ''}`;
    return (
      <a href={flat} {...props}>
        {children}
      </a>
    );
  },
}));

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

/**
 * §33.10d / D-CTA-6 (contrato §M4 v1.67): la fila pinta DESTINATARIO + dirección del
 * `addressSnapshot` y el bloque «Cliente», nunca el `userId` crudo. Sin destinatario (retiro
 * anterior a v1.67) lo dice en mono rojo — jamás sustituye con `User.name`.
 */
describe('M4View · destinatario y dirección (F9)', () => {
  const base = {
    status: 'picking' as const,
    carrier: null,
    trackingNumber: null,
    requestedAt: '2026-09-10T09:30:00Z',
    items: [{ inventoryItemId: 'inv-1001' }],
  };

  it('pinta «Para {nombre} · ciudad, estado · CP · Tel» del snapshot y «Cliente … Ver ficha», sin el userId', async () => {
    vi.spyOn(api, 'getAdminShipments').mockResolvedValue({
      data: [
        {
          id: 'shp-9001',
          userId: 'u-777',
          ...base,
          // Campos que el contrato §M4 promete y AdminShipmentDTO aún no tipa (ver AdminShipmentRow).
          recipientName: 'Misty Waterflower',
          addressSnapshot: {
            recipientName: 'Misty Waterflower',
            line1: 'Calle Falsa 123',
            city: 'Guadalajara',
            state: 'JAL',
            postalCode: '44100',
            country: 'MX',
            phone: '3331234567',
          },
        } as never,
      ],
      page: 1,
      pageSize: 20,
      total: 1,
    });
    renderWithProviders(<M4View />, 'es');

    const parties = await screen.findByTestId('shipment-parties-shp-9001');
    expect(parties).toHaveTextContent('Para Misty Waterflower · Guadalajara, JAL · CP 44100 · Tel 3331234567');
    // Sin `customer` en el DTO: «—» (nunca omitido en silencio), y el enlace a la ficha por id.
    expect(parties).toHaveTextContent('Cliente — · —');
    expect(within(parties).getByRole('link', { name: 'Ver ficha' })).toHaveAttribute(
      'href',
      expect.stringContaining('/admin/m6?user=u-777'),
    );
    expect(screen.queryByText('u-777')).not.toBeInTheDocument();
    expect(parties).not.toHaveTextContent('SIN DESTINATARIO');
  });

  it('retiro anterior a v1.67 (snapshot de ocho campos): «SIN DESTINATARIO» en mono rojo, resto igual, sin User.name', async () => {
    vi.spyOn(api, 'getAdminShipments').mockResolvedValue({
      data: [
        {
          id: 'shp-9002',
          userId: 'u-778',
          ...base,
          addressSnapshot: {
            line1: 'Av. Reforma 222',
            city: 'Ciudad de México',
            state: 'CDMX',
            postalCode: '06600',
            country: 'MX',
            phone: '5555123456',
          },
          customer: { id: 'u-778', name: 'jcsainz95', email: 'jcsainz95@example.com' },
        } as never,
      ],
      page: 1,
      pageSize: 20,
      total: 1,
    });
    renderWithProviders(<M4View />, 'es');

    const parties = await screen.findByTestId('shipment-parties-shp-9002');
    const missing = within(parties).getByText('SIN DESTINATARIO (retiro anterior a v1.67)');
    expect(missing.className).toContain('text-accent');
    expect(missing.className).toContain('font-mono');
    expect(parties).toHaveTextContent('Ciudad de México, CDMX · CP 06600 · Tel 5555123456');
    // El nombre del cliente va en SU línea; nunca ocupa el lugar del destinatario.
    expect(parties).toHaveTextContent('Cliente jcsainz95 · jcsainz95@example.com');
    expect(parties).not.toHaveTextContent('Para jcsainz95');
    expect(screen.queryByText('u-778')).not.toBeInTheDocument();
  });

  it('sin snapshot ni destinatario (fixture actual): cada dato ausente es «—» y nunca el userId', async () => {
    renderWithProviders(<M4View />, 'es');
    const parties = await screen.findByTestId('shipment-parties-shp-7001');
    expect(parties).toHaveTextContent('SIN DESTINATARIO');
    expect(parties).toHaveTextContent('—, — · CP — · Tel —');
    expect(screen.queryByText('u-777')).not.toBeInTheDocument();
  });
});
