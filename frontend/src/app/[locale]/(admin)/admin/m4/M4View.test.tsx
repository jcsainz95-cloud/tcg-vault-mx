import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { M4View } from './M4View';
import * as api from '@/lib/api';
import type { PreparationItemDTO, PreparationOrderDTO } from '@/types/contract';

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

  it('monta «Pedidos a preparar» (GET /admin/shipments/picking-list) y ya NO la lista plana de piezas', async () => {
    const spy = vi.spyOn(api, 'getAdminPreparationQueue');
    renderWithProviders(<M4View />, 'es');

    expect(await screen.findByRole('heading', { name: 'Pedidos a preparar' })).toBeInTheDocument();
    // Sin `?destination` la cola trae las DOS cubetas (CA #8).
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ destination: undefined }));
    // El renombrado es de cara al operador: la palabra «picking» no se le enseña.
    expect(screen.queryByText(/picking/i)).not.toBeInTheDocument();
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
          // Suelto deprecado (v1.67.1) + snapshot canónico con el MISMO valor (invariante del contrato).
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
    // S3-ENVIO-DIR: la calle/número del destino SÍ se pinta (el operador no puede enviar sin verla).
    expect(parties).toHaveTextContent('Calle Calle Falsa 123');
    // Sin `customer` en el DTO: «—» (nunca omitido en silencio), y el enlace a la ficha por id.
    expect(parties).toHaveTextContent('Cliente — · —');
    expect(within(parties).getByRole('link', { name: 'Ver ficha' })).toHaveAttribute(
      'href',
      expect.stringContaining('/admin/m6?user=u-777'),
    );
    expect(screen.queryByText('u-777')).not.toBeInTheDocument();
    expect(parties).not.toHaveTextContent('SIN DESTINATARIO');
  });

  it('v1.67.1 (D-CTA-9): el destinatario sale del SNAPSHOT aunque el suelto deprecado no venga; y si SOLO viene el suelto (legado), se tolera', async () => {
    vi.spyOn(api, 'getAdminShipments').mockResolvedValue({
      data: [
        {
          id: 'shp-9003',
          userId: 'u-779',
          ...base,
          addressSnapshot: { recipientName: 'Brock Harrison', line1: 'x', city: 'Pewter', state: 'KAN', postalCode: '10000', country: 'MX', phone: '5550000001' },
        },
        {
          id: 'shp-9004',
          userId: 'u-780',
          ...base,
          // Fila legado: solo la proyección suelta (sin snapshot). Se tolera, después del snapshot.
          recipientName: 'Erika Celadon',
          addressSnapshot: null,
        },
        {
          id: 'shp-9005',
          userId: 'u-781',
          ...base,
          // Si ambos vienen, gana el snapshot (canónico), no el suelto.
          recipientName: 'VIEJO',
          addressSnapshot: { recipientName: 'Sabrina Saffron', line1: 'y', city: 'Saffron', state: 'KAN', postalCode: '10001', country: 'MX', phone: '5550000002' },
        },
      ],
      page: 1,
      pageSize: 20,
      total: 3,
    });
    renderWithProviders(<M4View />, 'es');
    expect(await screen.findByTestId('shipment-parties-shp-9003')).toHaveTextContent('Para Brock Harrison');
    expect(screen.getByTestId('shipment-parties-shp-9004')).toHaveTextContent('Para Erika Celadon');
    const both = screen.getByTestId('shipment-parties-shp-9005');
    expect(both).toHaveTextContent('Para Sabrina Saffron');
    expect(both).not.toHaveTextContent('VIEJO');
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
    // S3-ENVIO-DIR: sin snapshot la calle también es «—», nunca omitida en silencio.
    expect(parties).toHaveTextContent('Calle —');
    expect(screen.queryByText('u-777')).not.toBeInTheDocument();
  });

  it('S3-ENVIO-DIR: pinta calle+número, línea 2 y colonia (line1, line2, neighborhood) unidas', async () => {
    vi.spyOn(api, 'getAdminShipments').mockResolvedValue({
      data: [
        {
          id: 'shp-9010',
          userId: 'u-800',
          ...base,
          addressSnapshot: {
            recipientName: 'Ash Ketchum',
            line1: 'Av. Insurgentes Sur 1234',
            line2: 'Depto 5B',
            neighborhood: 'Del Valle',
            city: 'Ciudad de México',
            state: 'CDMX',
            postalCode: '03100',
            country: 'MX',
            phone: '5551239876',
          },
        } as never,
      ],
      page: 1,
      pageSize: 20,
      total: 1,
    });
    renderWithProviders(<M4View />, 'es');

    const parties = await screen.findByTestId('shipment-parties-shp-9010');
    expect(parties).toHaveTextContent('Calle Av. Insurgentes Sur 1234, Depto 5B, Del Valle');
  });
});

/**
 * **«Pedidos a preparar»** — contrato **§M4-PREP** v1.78 · `PROJECT.md` §«Pedidos a preparar»
 * (aprobado 2026-09-15), criterios **CA #6, #8, #9, #11**.
 *
 * La cola deja de ser una lista PLANA de piezas ordenada por ubicación y pasa a ser **una tarjeta
 * por PEDIDO**. Lo que estos candados fijan es justo lo que el operador no puede permitirse leer
 * mal: de quién es el paquete, a dónde va, qué cartas lleva, dónde están y cuánto lleva esperando.
 */
describe('M4View · Pedidos a preparar (§M4-PREP)', () => {
  /** Pedido base; cada prueba sobrescribe lo suyo. */
  const order = (over: Partial<PreparationOrderDTO> = {}): PreparationOrderDTO => ({
    shipmentId: 'shp-a',
    orderId: 'ord-a',
    orderNumber: 'TCG-000999',
    destination: 'ship',
    requestedAt: '2026-09-01T10:00:00Z',
    customer: { lastName: 'Oak', fullName: 'Samuel Oak' },
    items: [item()],
    ...over,
  });

  const item = (over: Partial<PreparationItemDTO> = {}): PreparationItemDTO => ({
    shipmentItemId: 'sit-a',
    inventoryItemId: 'inv-a',
    folio: 'INV-000900',
    quantity: 1,
    card: {
      name: 'Pikachu',
      setName: 'Base Set',
      finish: 'holofoil',
      conditionLabel: 'PSA 9',
      imageSmallUrl: 'https://images.pokemontcg.io/base1/58.png',
      ...(over.card ?? {}),
    },
    currentLocation: { kind: 'assigned', label: 'C01-F01-S01' },
    ...over,
  });

  function serve(orders: PreparationOrderDTO[]) {
    return vi
      .spyOn(api, 'getAdminPreparationQueue')
      .mockImplementation(async ({ destination } = {}) =>
        orders.filter((o) => !destination || o.destination === destination),
      );
  }

  it('AGRUPA por pedido: una tarjeta por pedido, con SUS cartas dentro (no una fila por pieza)', async () => {
    serve([
      order({ shipmentId: 'shp-a', items: [item({ shipmentItemId: 'sit-a1' }), item({ shipmentItemId: 'sit-a2', folio: 'INV-000901' })] }),
      order({ shipmentId: 'shp-b', orderNumber: 'TCG-000998', requestedAt: '2026-09-02T10:00:00Z', items: [item({ shipmentItemId: 'sit-b1', folio: 'INV-000902' })] }),
    ]);
    renderWithProviders(<M4View />, 'es');

    const cardA = await screen.findByTestId('prep-order-shp-a');
    const cardB = screen.getByTestId('prep-order-shp-b');
    // Las dos piezas del pedido A viven DENTRO de su tarjeta; la de B, dentro de la suya.
    expect(within(cardA).getByTestId('prep-item-sit-a1')).toBeInTheDocument();
    expect(within(cardA).getByTestId('prep-item-sit-a2')).toBeInTheDocument();
    expect(within(cardA).queryByTestId('prep-item-sit-b1')).not.toBeInTheDocument();
    expect(within(cardB).getByTestId('prep-item-sit-b1')).toBeInTheDocument();
    expect(within(cardA).getByText('2 cartas')).toBeInTheDocument();
    expect(within(cardB).getByText('1 carta')).toBeInTheDocument();
  });

  it('CA #9 — lo más viejo PRIMERO, aunque la respuesta venga desordenada', async () => {
    serve([
      order({ shipmentId: 'shp-nuevo', requestedAt: '2026-09-20T10:00:00Z' }),
      order({ shipmentId: 'shp-viejo', requestedAt: '2026-08-01T10:00:00Z' }),
      order({ shipmentId: 'shp-medio', requestedAt: '2026-09-05T10:00:00Z' }),
    ]);
    renderWithProviders(<M4View />, 'es');

    await screen.findByTestId('prep-order-shp-viejo');
    const ids = screen.getAllByTestId(/^prep-order-/).map((n) => n.getAttribute('data-testid'));
    expect(ids).toEqual(['prep-order-shp-viejo', 'prep-order-shp-medio', 'prep-order-shp-nuevo']);
  });

  it('la ANTIGÜEDAD se lee de un vistazo («hace 3 días»), con la fecha absoluta al lado y en <time>', async () => {
    // Relativa al reloj real: 3 días y 1 hora ⇒ «hace 3 días» sin depender del momento de la corrida.
    const iso = new Date(Date.now() - (3 * 24 + 1) * 3_600_000).toISOString();
    serve([order({ shipmentId: 'shp-age', requestedAt: iso })]);
    renderWithProviders(<M4View />, 'es');

    const card = await screen.findByTestId('prep-order-shp-age');
    expect(within(card).getByText('hace 3 días')).toBeInTheDocument();
    // La relativa nunca SUSTITUYE al dato: el ISO exacto queda en el <time dateTime>.
    expect(card.querySelector('time')).toHaveAttribute('dateTime', iso);
    expect(within(card).getByText(/Solicitado/)).toBeInTheDocument();
  });

  it('RETIRO DE BÓVEDA (`orderNumber` null): se dice que es un retiro, no queda un hueco', async () => {
    serve([
      order({ shipmentId: 'shp-retiro', orderId: null, orderNumber: null, requestedAt: '2026-08-01T10:00:00Z' }),
      order({ shipmentId: 'shp-orden', orderNumber: 'TCG-000123' }),
    ]);
    renderWithProviders(<M4View />, 'es');

    const retiro = await screen.findByTestId('prep-order-shp-retiro');
    expect(within(retiro).getByText('Retiro de bóveda')).toBeInTheDocument();
    // La referencia estable SIEMPRE está, tenga orden o no.
    expect(within(retiro).getByText('shp-retiro')).toBeInTheDocument();
    expect(retiro).not.toHaveTextContent('null');
    // El pedido con orden sí enseña su folio.
    expect(within(screen.getByTestId('prep-order-shp-orden')).getByText('TCG-000123')).toBeInTheDocument();
  });

  it('el DESTINO del pedido se ve de un vistazo (bóveda / envío), y es del PEDIDO', async () => {
    serve([
      order({ shipmentId: 'shp-envio', destination: 'ship', requestedAt: '2026-08-01T10:00:00Z' }),
      order({ shipmentId: 'shp-boveda', destination: 'vault' }),
    ]);
    renderWithProviders(<M4View />, 'es');

    expect(within(await screen.findByTestId('prep-order-shp-envio')).getByText('Para enviar')).toBeInTheDocument();
    expect(within(screen.getByTestId('prep-order-shp-boveda')).getByText('Para bóveda')).toBeInTheDocument();
  });

  it('CLIENTE: el APELLIDO va destacado junto al nombre completo (archivero alfabético)', async () => {
    serve([order({ shipmentId: 'shp-cli', customer: { lastName: 'Waterflower', fullName: 'Misty Waterflower' } })]);
    renderWithProviders(<M4View />, 'es');

    const who = within(await screen.findByTestId('prep-order-shp-cli')).getByTestId('prep-customer-shp-cli');
    expect(within(who).getByText('Waterflower')).toBeInTheDocument();
    expect(who).toHaveTextContent('Misty Waterflower');
  });

  it('`lastName` NULL (§6.A: el apellido es derivado y frágil): degrada con elegancia — nunca «null»', async () => {
    serve([order({ shipmentId: 'shp-sinap', customer: { lastName: null, fullName: 'Misty' } })]);
    renderWithProviders(<M4View />, 'es');

    const who = within(await screen.findByTestId('prep-order-shp-sinap')).getByTestId('prep-customer-shp-sinap');
    expect(who).toHaveTextContent('Apellido no identificado');
    expect(who).toHaveTextContent('Misty');
    expect(who).not.toHaveTextContent('null');
    expect(who).not.toHaveTextContent('undefined');
  });

  it('CA #6 — dirección COMPLETA CON LA CALLE en destino envío; `line2`/`neighborhood`/`recipientName` null no pintan huecos', async () => {
    serve([
      order({
        shipmentId: 'shp-dir',
        requestedAt: '2026-08-01T10:00:00Z',
        shipTo: {
          recipientName: 'Ash Ketchum',
          line1: 'Av. Insurgentes Sur 1234',
          line2: 'Depto 5B',
          neighborhood: 'Del Valle',
          city: 'Ciudad de México',
          state: 'CDMX',
          postalCode: '03100',
          country: 'MX',
          phone: '5551239876',
        },
      }),
      order({
        shipmentId: 'shp-dir-legado',
        // Snapshot de ocho campos anterior a v1.67: sin destinatario, sin línea 2, sin colonia.
        shipTo: {
          recipientName: null,
          line1: 'Calle Falsa 123',
          line2: null,
          neighborhood: null,
          city: 'Guadalajara',
          state: 'JAL',
          postalCode: '44100',
          country: 'MX',
          phone: '3331234567',
        },
      }),
    ]);
    renderWithProviders(<M4View />, 'es');

    const full = await screen.findByTestId('prep-address-shp-dir');
    expect(full).toHaveTextContent('Av. Insurgentes Sur 1234, Depto 5B, Del Valle');
    expect(full).toHaveTextContent('Ciudad de México, CDMX · CP 03100 · MX');
    expect(full).toHaveTextContent('Tel 5551239876');
    expect(full).toHaveTextContent('Para Ash Ketchum');

    const legacy = screen.getByTestId('prep-address-shp-dir-legado');
    // La CALLE sola, sin comas colgando de los campos nullable, y sin línea «Para» vacía.
    expect(legacy).toHaveTextContent('Calle Falsa 123');
    expect(legacy).not.toHaveTextContent('Calle Falsa 123,');
    expect(legacy).not.toHaveTextContent('Para');
    expect(legacy).not.toHaveTextContent('null');
  });

  it('destino BÓVEDA: no se pinta bloque de dirección (no hay envío que direccionar)', async () => {
    serve([order({ shipmentId: 'shp-bov', destination: 'vault', shipTo: undefined })]);
    renderWithProviders(<M4View />, 'es');

    await screen.findByTestId('prep-order-shp-bov');
    expect(screen.queryByTestId('prep-address-shp-bov')).not.toBeInTheDocument();
  });

  it('CARTA: nombre, SET prominente, acabado, condición TAL CUAL viene del back, folio y miniatura', async () => {
    serve([
      order({
        shipmentId: 'shp-carta',
        items: [
          item({
            shipmentItemId: 'sit-graded',
            folio: 'INV-000101',
            card: {
              name: 'Charizard',
              setName: 'Base Set',
              finish: 'holofoil',
              conditionLabel: 'PSA 9',
              imageSmallUrl: 'https://images.pokemontcg.io/base1/4.png',
            },
          }),
        ],
      }),
    ]);
    renderWithProviders(<M4View />, 'es');

    const li = await screen.findByTestId('prep-item-sit-graded');
    expect(within(li).getByText('Charizard')).toBeInTheDocument();
    expect(within(li).getByText('Base Set')).toBeInTheDocument();
    // ⛔ La condición NO se recompone en el front: se pinta el `conditionLabel` del contrato.
    expect(within(li).getByText('PSA 9')).toBeInTheDocument();
    expect(within(li).getByText('INV-000101')).toBeInTheDocument();
    expect(within(li).getByRole('img', { name: 'Charizard' })).toHaveAttribute(
      'src',
      'https://images.pokemontcg.io/base1/4.png',
    );
  });

  it('`imageSmallUrl` NULL: queda el pozo de papel (sin <img>), y el resto de la carta se lee igual', async () => {
    serve([
      order({
        shipmentId: 'shp-sinfoto',
        items: [
          item({ shipmentItemId: 'sit-conf', card: { name: 'Zapdos', setName: 'Base Set', finish: 'normal', conditionLabel: 'NM', imageSmallUrl: 'https://images.pokemontcg.io/base1/16.png' } }),
          item({ shipmentItemId: 'sit-sinf', folio: 'INV-000108', currentLocation: { kind: 'assigned', label: 'C99-F99-S99' }, card: { name: 'Machamp', setName: 'Base Set', finish: 'reverse_holo', conditionLabel: 'LP', imageSmallUrl: null } }),
        ],
      }),
    ]);
    renderWithProviders(<M4View />, 'es');

    const sinFoto = await screen.findByTestId('prep-item-sit-sinf');
    expect(within(sinFoto).queryByRole('img')).not.toBeInTheDocument();
    expect(within(sinFoto).getByText('Machamp')).toBeInTheDocument();
    expect(within(sinFoto).getByText('LP')).toBeInTheDocument();
    // La que SÍ tiene foto la pinta: el vacío es del dato, no de la vista.
    expect(within(screen.getByTestId('prep-item-sit-conf')).getByRole('img', { name: 'Zapdos' })).toBeInTheDocument();
  });

  it('CA #11 — UBICACIÓN: `assigned` pinta su etiqueta; `unassigned` pinta copy legible y ⛔ JAMÁS «UNASSIGNED»', async () => {
    serve([
      order({
        shipmentId: 'shp-ubi',
        items: [
          item({ shipmentItemId: 'sit-sin', currentLocation: { kind: 'unassigned' } }),
          item({ shipmentItemId: 'sit-con', currentLocation: { kind: 'assigned', label: 'C03-F02-S15' } }),
        ],
      }),
    ]);
    renderWithProviders(<M4View />, 'es');

    const card = await screen.findByTestId('prep-order-shp-ubi');
    expect(within(screen.getByTestId('prep-item-sit-con')).getByText('C03-F02-S15')).toBeInTheDocument();
    expect(within(screen.getByTestId('prep-item-sit-sin')).getByText('Sin ubicar')).toBeInTheDocument();
    expect(card).not.toHaveTextContent('UNASSIGNED');
    // Las asignadas van primero (se camina la bóveda en orden); las sin ubicar, al final.
    const ids = within(card).getAllByTestId(/^prep-item-/).map((n) => n.getAttribute('data-testid'));
    expect(ids).toEqual(['prep-item-sit-con', 'prep-item-sit-sin']);
  });

  it('CA #8 — las DOS CUBETAS: ambas / solo envío / solo bóveda re-consultan con ?destination', async () => {
    const spy = serve([
      order({ shipmentId: 'shp-envio', destination: 'ship', requestedAt: '2026-08-01T10:00:00Z' }),
      order({ shipmentId: 'shp-boveda', destination: 'vault' }),
    ]);
    renderWithProviders(<M4View />, 'es');

    // Ambas cubetas por defecto (sin `?destination`).
    await screen.findByTestId('prep-order-shp-envio');
    expect(screen.getByTestId('prep-order-shp-boveda')).toBeInTheDocument();
    expect(spy).toHaveBeenCalledWith({ destination: undefined });

    fireEvent.click(screen.getByRole('button', { name: 'Solo envío' }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ destination: 'ship' }));
    await waitFor(() => expect(screen.queryByTestId('prep-order-shp-boveda')).not.toBeInTheDocument());
    expect(screen.getByTestId('prep-order-shp-envio')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Solo envío' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Solo bóveda' }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ destination: 'vault' }));
    expect(await screen.findByTestId('prep-order-shp-boveda')).toBeInTheDocument();
    expect(screen.queryByTestId('prep-order-shp-envio')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Ambas' }));
    await waitFor(() => expect(screen.getByTestId('prep-order-shp-envio')).toBeInTheDocument());
  });

  /**
   * ⚠️⚠️ **PR-1 (§35.14 A-4) — EL VACÍO DE BÓVEDA NO PUEDE TRANQUILIZAR SOBRE LO QUE NADIE MIDIÓ.**
   *
   * Hecho medido (arquitecto, §M4-PREP): las órdenes `fulfillmentMode='vault'` no generan
   * `ShipmentRequest` **y no existe artefacto** que diga si una compra a bóveda está pendiente de
   * colocar. ⇒ el sistema **no sabe** si hay trabajo físico esperando. La versión anterior de este
   * copy decía *«No hay nada pendiente ni nada roto»*: acertaba en *nada roto* y **afirmaba sin
   * base** en *nada pendiente*, que es el error más caro de un vacío en una superficie de
   * operación — deja trabajo físico sin hacer **con el operador tranquilo**.
   *
   * El candado mide la **ausencia de la afirmación**, no la presencia de una redacción: así sigue
   * mordiendo si alguien reescribe el copy y vuelve a colar la promesa.
   */
  it('PR-1 · cubeta BÓVEDA vacía: explica la ausencia y ⛔ NO afirma «nada pendiente»', async () => {
    serve([order({ shipmentId: 'shp-envio', destination: 'ship' })]);
    const { container } = renderWithProviders(<M4View />, 'es');

    await screen.findByTestId('prep-order-shp-envio');
    fireEvent.click(screen.getByRole('button', { name: 'Solo bóveda' }));

    expect((await screen.findAllByText('Esta cubeta todavía no se alimenta.')).length).toBe(2);
    expect(screen.getByText(/no lleva ese registro/i)).toBeInTheDocument();
    // ⛔ PR-1: ni la afirmación, ni una promesa de versión futura, ni alarma.
    expect(container.textContent).not.toMatch(/nada pendiente/i);
    expect(container.textContent).not.toMatch(/empezará a llenarse/i);
    expect(screen.queryByText('Nada que preparar por ahora.')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('PR-1 (EN) · el mismo candado en inglés: ni «nothing is pending» ni «nothing is broken»', async () => {
    serve([order({ shipmentId: 'shp-envio', destination: 'ship' })]);
    const { container } = renderWithProviders(<M4View />, 'en');

    await screen.findByTestId('prep-order-shp-envio');
    fireEvent.click(screen.getByRole('button', { name: 'Vault only' }));

    expect((await screen.findAllByText("This bucket isn't fed yet.")).length).toBe(2);
    expect(container.textContent).not.toMatch(/nothing is pending/i);
    expect(container.textContent).not.toMatch(/nothing is broken/i);
  });

  /**
   * **P-2 (§35.9) — una superficie que promete actualizarse sola tiene que actualizarse sola.**
   * El copy de los vacíos prometía que «los nuevos aparecen aquí solos» mientras el cliente global
   * fija `refetchOnWindowFocus:false`. Se arregló la conducta (no el copy), pero el candado vigila
   * **la promesa**: si alguien la devuelve sin devolver el refresco, esto se pone rojo.
   */
  it('P-2 · ningún vacío promete una actualización automática que la consulta no haga', async () => {
    serve([]);
    const { container } = renderWithProviders(<M4View />, 'es');

    await screen.findAllByText('Nada que preparar por ahora.');
    expect(container.textContent).not.toMatch(/aparecen aquí solos/i);
  });

  it('cola COMPLETAMENTE vacía (ambas cubetas): estado vacío general, no error', async () => {
    serve([]);
    renderWithProviders(<M4View />, 'es');

    // El título vive en DOS sitios a propósito (PR-2): la región viva y el `EmptyState`.
    expect((await screen.findAllByText('Nada que preparar por ahora.')).length).toBe(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  /**
   * **PR-2 (§35.10) — la región viva está SIEMPRE montada.** Una región `role="status"` que se monta
   * **junto con** su contenido no se anuncia de forma fiable: al cambiar a una cubeta vacía el
   * operador no oía nada. El candado exige que el MISMO nodo exista antes y después y que su texto
   * cambie — no basta con que aparezca una región nueva.
   */
  it('PR-2 · cambiar a una cubeta vacía ANUNCIA: la región viva ya estaba montada y cambia de texto', async () => {
    serve([order({ shipmentId: 'shp-envio', destination: 'ship' })]);
    renderWithProviders(<M4View />, 'es');

    // La región existe desde el primer render (vacía mientras carga: ⛔ no se anuncia lo que
    // todavía no se sabe) y se RELLENA cuando llegan los datos, sin remontarse.
    const live = await screen.findByTestId('prep-live-region');
    expect(live).toHaveAttribute('role', 'status');
    await waitFor(() => expect(live).toHaveTextContent('1 pedido'));

    fireEvent.click(screen.getByRole('button', { name: 'Solo bóveda' }));

    await waitFor(() => expect(live).toHaveTextContent('Esta cubeta todavía no se alimenta.'));
    // El MISMO nodo: si se remontara, el anuncio no sería fiable.
    expect(screen.getByTestId('prep-live-region')).toBe(live);
  });

  /**
   * **PR-3 (§35.4) — lo que ordena la lista tiene que leerse primero.** La ubicación es el criterio
   * de orden de las cartas y era el dato menos visible: último renglón, mono 11px, `muted`, detrás
   * del folio. ⚠️ **No era contraste** (cumple AA): era jerarquía. El candado mide el **orden en el
   * DOM**, que es lo que sobrevive a un cambio de clases de Tailwind.
   */
  it('PR-3 · la UBICACIÓN se renderiza ANTES que el folio, y no en el tono de lo secundario', async () => {
    serve([
      order({
        shipmentId: 'shp-ord',
        items: [item({ shipmentItemId: 'sit-ord', folio: 'INV-000777', currentLocation: { kind: 'assigned', label: 'C03-F02-S15' } })],
      }),
    ]);
    renderWithProviders(<M4View />, 'es');

    const li = await screen.findByTestId('prep-item-sit-ord');
    const loc = within(li).getByText('C03-F02-S15');
    const folio = within(li).getByText('INV-000777');
    // `DOCUMENT_POSITION_FOLLOWING` = el folio va DESPUÉS de la ubicación en el documento.
    expect(loc.compareDocumentPosition(folio) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(loc.className).not.toContain('text-muted');
    expect(loc.className).toContain('text-sm');

    /*
     * ⚠️ **Y el orden VISUAL, que el orden del DOM no garantiza.** Lo cazó un canario: mutar el
     * bloque de ubicación con un `order-last` de Tailwind lo manda al final **en pantalla** y deja
     * el DOM intacto ⇒ la aserción de arriba seguía verde con el defecto puesto. La columna de
     * ubicación es el **primer hijo** de la fila y ⛔ **ninguna utilidad `order-*` la mueve**.
     */
    const column = within(li).getByTestId('prep-location-sit-ord');
    expect(li.firstElementChild).toBe(column);
    for (const node of [li, column]) {
      expect(node.className).not.toMatch(/(^|\s)(sm:|md:|lg:)?order-(first|last|none|\d+)(\s|$)/);
    }
  });

  it('PR-3 · «Sin ubicar» conserva el bermellón y va al MISMO tamaño que una ubicación real', async () => {
    serve([
      order({
        shipmentId: 'shp-sinubi',
        items: [item({ shipmentItemId: 'sit-nada', currentLocation: { kind: 'unassigned' } })],
      }),
    ]);
    renderWithProviders(<M4View />, 'es');

    const li = await screen.findByTestId('prep-item-sit-nada');
    const label = within(li).getByText('Sin ubicar');
    expect(label.className).toContain('text-accent');
    expect(label.className).toContain('text-sm'); // ⛔ no es una nota al pie de 11px
  });

  /**
   * **PR-4 (§35.5) — esta dirección se TRANSCRIBE a mano** (no hay impresión de etiquetas), así que
   * ningún valor puede heredar el tono de lo secundario: la diferencia entre `muted` y `text-text`
   * aquí es la probabilidad de equivocar un CP. Los RÓTULOS sí van en muted — el valor pesa más que
   * su etiqueta.
   */
  it('PR-4 · ningún VALOR de la dirección hereda `text-muted` (y los rótulos sí lo llevan)', async () => {
    serve([
      order({
        shipmentId: 'shp-dir4',
        shipTo: {
          recipientName: 'Ash Ketchum',
          line1: 'Av. Insurgentes Sur 1234',
          line2: null,
          neighborhood: null,
          city: 'Ciudad de México',
          state: 'CDMX',
          postalCode: '03100',
          country: 'MX',
          phone: '5551239876',
        },
      }),
    ]);
    renderWithProviders(<M4View />, 'es');

    const block = await screen.findByTestId('prep-address-shp-dir4');
    // El contenedor no tiñe de muted a sus hijos.
    expect(block.className).not.toContain('text-muted');
    expect(block.className).toContain('text-text');
    for (const value of ['Av. Insurgentes Sur 1234', 'Ash Ketchum', '03100', '5551239876']) {
      const node = within(block).getByText(value);
      expect(node.className).not.toContain('text-muted');
      expect(node.closest('.text-muted')).toBeNull();
    }
    // Los RÓTULOS sí: se leen una vez en la vida, el valor cada vez.
    expect(within(block).getByText('CP').className).toContain('text-muted');
    expect(within(block).getByText('Tel').className).toContain('text-muted');
  });

  it('P-4b · el NOMBRE COMPLETO no es secundario: es con lo que se caza un apellido derivado mal', async () => {
    // «último token» sobre un nombre mexicano normal entrega el apellido MATERNO (§35.6): el
    // archivero lo espera en la S de «Sainz» y el sistema propone la O de «Ortega».
    serve([order({ shipmentId: 'shp-ap', customer: { lastName: 'Ortega', fullName: 'Juan Carlos Sainz Ortega' } })]);
    renderWithProviders(<M4View />, 'es');

    const who = await screen.findByTestId('prep-customer-shp-ap');
    const full = within(who).getByText('Juan Carlos Sainz Ortega');
    expect(full.className).not.toContain('text-muted');
    expect(full.className).toContain('text-text');
  });

  /**
   * **PR-5 (§35.3) — una fecha ilegible deja «—» en LAS DOS líneas.** `formatAge` devuelve `''` y la
   * línea de antigüedad quedaba **en blanco** mientras la de abajo sí caía a «—». Y ese pedido es
   * justo el que el orden manda **al final**: el más sospechoso se quedaba sin nada que leer.
   */
  it('PR-5 · `requestedAt` ilegible ⇒ «—» en las dos líneas, y el pedido AL FINAL de la cola', async () => {
    serve([
      order({ shipmentId: 'shp-rota', requestedAt: 'no-es-una-fecha' }),
      order({ shipmentId: 'shp-viejo', requestedAt: '2026-08-01T10:00:00Z' }),
      order({ shipmentId: 'shp-nuevo', requestedAt: '2026-09-20T10:00:00Z' }),
    ]);
    renderWithProviders(<M4View />, 'es');

    const rota = await screen.findByTestId('prep-order-shp-rota');
    // Las DOS líneas de tiempo dicen «—»: ni la antigüedad ni la fecha quedan en blanco.
    expect(within(rota).getAllByText('—')).toHaveLength(2);
    expect(within(rota).getByText(/Solicitado/)).toHaveTextContent('Solicitado —');
    const ids = screen.getAllByTestId(/^prep-order-/).map((n) => n.getAttribute('data-testid'));
    expect(ids[ids.length - 1]).toBe('prep-order-shp-rota');
  });

  /**
   * **PR-6 (§35.9) — al recuperar el foco, la cola se vuelve a pedir.** Sin esto, un operador con la
   * pestaña abierta en el mostrador mira una lista muerta toda la tarde. El precedente es
   * `hooks/usePendings.ts:38`, que ya hace la misma excepción al `refetchOnWindowFocus:false` global.
   */
  it('PR-6 · volver a la ventana RE-PIDE la cola (contador ≥ 2)', async () => {
    const spy = serve([order({ shipmentId: 'shp-focus' })]);
    renderWithProviders(<M4View />, 'es');
    await screen.findByTestId('prep-order-shp-focus');
    expect(spy).toHaveBeenCalledTimes(1);

    /*
     * ⚠️ **DOS cosas que, mal hechas, dan un candado VACUO** (verde porque no mide):
     * 1. TanStack Query v5 escucha **`visibilitychange` en `window`** —⛔ no el `focus` de
     *    `window`, que retiró en v5, y ⛔ tampoco en `document`, que es donde uno lo busca—
     *    (`@tanstack/query-core@5.101.4`, `focusManager.js:12`). Con el evento equivocado, o
     *    despachado en el nodo equivocado, esto pasaría sin medir nada.
     * 2. El gestor solo reacciona a la **TRANSICIÓN** oculto→visible. En jsdom el documento nace
     *    visible, así que hay que pasar por `hidden` primero: disparar `visibilitychange` sobre un
     *    documento que ya estaba visible no cambia el estado y **no dispara nada**.
     */
    const setVisibility = (value: 'hidden' | 'visible') => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value });
      window.dispatchEvent(new Event('visibilitychange'));
    };
    setVisibility('hidden');
    setVisibility('visible');

    await waitFor(() => expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2));
    /*
     * ⚠️ **Lo que este candado NO mide, dicho aquí para que nadie lea de más su verde:** el cliente
     * de pruebas (`test/render.tsx`) **no fija `staleTime`**, así que la consulta nace obsoleta y
     * el foco siempre la re-pide. En producción el `staleTime: 30_000` global la hace fresca
     * durante 30 s, y volver a la ventana dentro de esa ventana **no re-pide** — que es la conducta
     * que §35.9 quiere. PR-6 verifica **el cableado**, ⛔ no la ventana de frescura.
     */
  });

  /**
   * §M4-PREP **v1.78.1** — `customer.fullName` es `string | null`. ⛔ El candado NO fija el «—»
   * actual: el contrato obliga a una **ausencia con nombre** y la redacción es de ux-ui, así que
   * fijar el guion **protegería en CI justo lo que el contrato prohíbe**. Se mide lo que es cierto
   * con cualquier redacción: no se imprime `null`, y la ausencia es **distinguible**.
   */
  it('v1.78.1 · `fullName` null: la ausencia es distinguible y ⛔ nunca se imprime «null»', async () => {
    serve([order({ shipmentId: 'shp-sinnombre', customer: { lastName: null, fullName: null } })]);
    renderWithProviders(<M4View />, 'es');

    const who = await screen.findByTestId('prep-customer-shp-sinnombre');
    expect(who).not.toHaveTextContent('null');
    expect(who).not.toHaveTextContent('undefined');
    // Rama de ausencia presente (su COPY lo decide ux-ui; aquí solo se exige que exista).
    expect(within(who).getByTestId('prep-fullname-missing-shp-sinnombre')).toBeInTheDocument();
    // `fullName === null ⇒ lastName === null` por construcción (el apellido se deriva del nombre).
    expect(who).toHaveTextContent('Apellido no identificado');
  });

  it('v1.78.1 · la cadena vacía (servidor no conforme) se lee como AUSENCIA, no como nombre vacío', async () => {
    // ⛔ El contrato PROHÍBE `""` como marca de ausencia; si llega igual, la lectura segura es
    // tratarla como ausente — nunca pintar un hueco invisible.
    serve([order({ shipmentId: 'shp-vacio', customer: { lastName: null, fullName: '   ' } })]);
    renderWithProviders(<M4View />, 'es');

    const who = await screen.findByTestId('prep-customer-shp-vacio');
    expect(within(who).getByTestId('prep-fullname-missing-shp-vacio')).toBeInTheDocument();
  });

  it('P-5 · el verde del sistema NO se gasta en un destino: los dos badges van en la misma tinta', async () => {
    serve([
      order({ shipmentId: 'shp-e', destination: 'ship', requestedAt: '2026-08-01T10:00:00Z' }),
      order({ shipmentId: 'shp-b', destination: 'vault' }),
    ]);
    renderWithProviders(<M4View />, 'es');

    const envio = within(await screen.findByTestId('prep-order-shp-e')).getByText('Para enviar');
    const boveda = within(screen.getByTestId('prep-order-shp-b')).getByText('Para bóveda');
    // §2.4: el color nunca es el portador del significado — lo porta la palabra.
    expect(boveda.className).not.toContain('text-success');
    expect(boveda.className).toBe(envio.className);
  });

  it('P-9 · cada tarjeta tiene nombre accesible (el folio, o «Retiro de bóveda» cuando no hay orden)', async () => {
    serve([
      order({ shipmentId: 'shp-conf', orderNumber: 'TCG-000123', requestedAt: '2026-08-01T10:00:00Z' }),
      order({ shipmentId: 'shp-ret', orderId: null, orderNumber: null }),
    ]);
    renderWithProviders(<M4View />, 'es');

    await screen.findByTestId('prep-order-shp-conf');
    expect(screen.getByRole('article', { name: 'TCG-000123' })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Retiro de bóveda' })).toBeInTheDocument();
  });

  /**
   * **P-10 (§35.13)** — esta ruta hospeda una pantalla de **administración** (la cola de envíos, sin
   * paginar) y una de **ejecución física** (esta, que se usa de pie). Manda la que se usa de pie: el
   * operador que entra a preparar no puede tener que hacer scroll por una lista que no es la suya.
   */
  it('P-10 · «Pedidos a preparar» se monta ARRIBA de la cola de envíos', async () => {
    renderWithProviders(<M4View />, 'es');

    const prep = await screen.findByRole('heading', { name: 'Pedidos a preparar' });
    const cola = screen.getByRole('heading', { name: 'Cola de envíos de clientes' });
    expect(prep.compareDocumentPosition(cola) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('ERROR de la cola: banner con «Reintentar» que vuelve a consultar (§8.1)', async () => {
    const spy = vi
      .spyOn(api, 'getAdminPreparationQueue')
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce([order({ shipmentId: 'shp-ok' })]);
    renderWithProviders(<M4View />, 'es');

    const alerts = await screen.findAllByRole('alert');
    expect(alerts.length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole('button', { name: 'Reintentar' })[0]);

    expect(await screen.findByTestId('prep-order-shp-ok')).toBeInTheDocument();
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
