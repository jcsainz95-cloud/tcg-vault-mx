import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import type { AdminShipmentDTO, ShipmentQuoteDTO } from '@/types/contract';
import { CaptureLabelDialog } from './CaptureLabelDialog';
import { PACKAGES, labelFor, quote, rateOf, shipment } from './capture/sdx-test-fixtures';

/**
 * 💰 rev BSD-1 — la ventana «Capturar guía» en **modo entrada** (DESIGN_SYSTEM §BSD-UX.5 · contrato §BSD.3–§BSD.5,
 * BSD-F2/F3/F4). La MISMA ventana (SK1) con `target.sellRequestId`.
 *
 * - **UX-BSD-5 (BSD-F2):** el bloque destino no contiene `input`, `select`, `textarea` ni botón; «Usar este nombre»
 *   rellena el campo y hay **0** `PUT …/address` hasta «Guardar dirección».
 * - **UX-BSD-6 (BSD-F3):** la banda `feeDeducted` = `charged.grossCents`; preseleccionada = `recommendedRateId` aunque
 *   no sea la primera; `recommendedRateId:null` ⇒ ninguna marcada y `noRecommended`.
 * - Errores propios (§BSD-UX.5d), paso 4 (solo «Descargar PDF»), «Capturar a mano» = el de M5 (sin costo).
 */
vi.mock('@/lib/role', () => ({
  useRole: () => ({ role: 'vault_operator', setRole: () => {}, isSuperAdmin: false, canSwitchRole: false }),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const SR = 'sr-777';
const IN_ID = 'shp-in-1';
const TARGET = { id: IN_ID, ref: SR, folio: 'ENV-000099', carrier: null, trackingNumber: null, sellRequestId: SR };

function inbound(over: Partial<AdminShipmentDTO> = {}): AdminShipmentDTO {
  const base = shipment({
    id: IN_ID,
    kind: 'buylist_inbound',
    orderId: null,
    orderNumber: undefined,
    status: 'solicitado',
    preparedAt: null,
    addressSnapshot: {
      line1: 'Calle Roble 12',
      neighborhood: 'Centro',
      city: 'Guadalajara',
      state: 'Jalisco',
      postalCode: '44100',
      country: 'MX',
      phone: '3312345678',
    },
    address: { complete: false, version: 1, corrected: null, missing: ['recipientName'] },
    inbound: {
      sellRequestId: SR,
      sellerName: 'Ana Vendedora',
      offerShippingFeeCents: 18000,
      offerGrossCents: 150000,
      destination: { name: 'TCG Hunt', street1: 'Av. Periférico Sur 4249', postalCode: '14210', state: 'Ciudad de México', city: 'Tlalpan', neighborhood: 'Jardines de la Montaña' },
    },
  });
  return { ...base, ...over };
}
function complete(): AdminShipmentDTO {
  const s = inbound();
  return { ...s, addressSnapshot: { ...s.addressSnapshot!, recipientName: 'Ana Vendedora' }, address: { complete: true, version: 2, corrected: null, missing: [] } };
}
/** Cotización de entrada: banda = tarifa del vendedor; recomendada = FedEx (la TERCERA visible, no la primera). */
function inboundQuote(over: Partial<ShipmentQuoteDTO> = {}): ShipmentQuoteDTO {
  const q = quote();
  return {
    ...q,
    charged: { grossCents: 18000, netCents: 18000 },
    insurance: { ...q.insurance, insuredValueCents: 150000 },
    rates: q.rates.map((r) => ({ ...r, recommended: r.rateId === 'rate-fedex' })),
    recommendedRateId: 'rate-fedex',
    ...over,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'listShippingPackages').mockResolvedValue(PACKAGES);
  vi.spyOn(api, 'getPostalCode').mockImplementation(async (cp: string) => {
    if (cp === '44100') return { postalCode: cp, state: 'Jalisco', municipality: 'Guadalajara', neighborhoods: ['Centro', 'Americana'], source: 'local' };
    throw new ApiClientError(404, { code: 'POSTAL_CODE_UNKNOWN', message: 'x', details: { postalCode: cp } });
  });
});

function open(s: AdminShipmentDTO, q: ShipmentQuoteDTO = inboundQuote()) {
  vi.spyOn(api, 'getAdminShipment').mockResolvedValue(s);
  const quoteSpy = vi.spyOn(api, 'quoteShipment').mockResolvedValue(q);
  const put = vi.spyOn(api, 'correctShipmentAddress');
  const onSaved = vi.fn();
  renderWithProviders(<CaptureLabelDialog target={TARGET} onClose={() => {}} onSaved={onSaved} />, 'es');
  return { quoteSpy, put, onSaved };
}

describe('§BSD-UX.5 · título y referencia', () => {
  it('«Guía del vendedor a la tienda» y «Solicitud de venta {id} · Envío {folio}»', async () => {
    open(complete());
    expect(await screen.findByRole('dialog', { name: 'Guía del vendedor a la tienda' })).toBeInTheDocument();
    expect(screen.getByTestId('sdx-dialog-ref')).toHaveTextContent(`Solicitud de venta ${SR} · Envío ENV-000099`);
  });
});

describe('UX-BSD-5 (BSD-F2) · origen editable, destino de solo lectura', () => {
  it('el destino es texto: ni `input`, ni `select`, ni `textarea`, ni botón; con sus datos y su nota', async () => {
    open(complete());
    const dest = await screen.findByTestId('sdx-inbound-destination');
    expect(dest.querySelectorAll('input, select, textarea, button')).toHaveLength(0);
    expect(dest).toHaveTextContent('Llega a · la tienda');
    expect(dest).toHaveTextContent('TCG Hunt');
    expect(dest).toHaveTextContent('14210');
    expect(dest).toHaveTextContent('Es la dirección de la tienda en «Configuración › Envíos». Esta guía siempre llega ahí: no se cambia aquí.');
    // El origen, en modo leer, rotula «Quién envía».
    const origin = screen.getByTestId('sdx-inbound-origin');
    expect(origin).toHaveTextContent('Sale de · el vendedor');
    expect(origin).toHaveTextContent('Quién envía');
  });

  it('sin `recipientName`: abre corrigiendo; el destino sigue sin controles; la sugerencia NO guarda sola', async () => {
    const { put } = open(inbound());
    const field = await screen.findByLabelText('Quién envía');
    expect(field).toHaveValue('');
    expect(screen.getByTestId('sdx-inbound-destination').querySelectorAll('input, select, textarea, button')).toHaveLength(0);
    expect(screen.getByTestId('sdx-inbound-suggestion')).toHaveTextContent('Sugerencia: Ana Vendedora (el nombre de su cuenta).');
    expect(screen.getByText(/Esto corrige solo el origen de esta guía/)).toBeInTheDocument();
    expect(screen.getByText(/esta corrección se sustituye por la suya/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Usar este nombre' }));
    expect(screen.getByLabelText('Quién envía')).toHaveValue('Ana Vendedora');
    expect(screen.getByLabelText('Quién envía')).toHaveFocus();
    // BX7: el nombre sugerido NO se escribe solo.
    expect(put).not.toHaveBeenCalled();
    // Con el campo lleno, la sugerencia desaparece.
    expect(screen.queryByTestId('sdx-inbound-suggestion')).toBeNull();
    put.mockResolvedValue({ outcome: 'corrected', shipment: complete() });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar dirección' }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0][0]).toBe(IN_ID);
    expect(put.mock.calls[0][1]).toMatchObject({ recipientName: 'Ana Vendedora', expectedAddressVersion: 1 });
    // ⛔ Ningún cuerpo lleva destino (I-BSD-5).
    expect(Object.keys(put.mock.calls[0][1])).not.toEqual(expect.arrayContaining(['to']));
  });

  it('`400 VALIDATION_ERROR {field:recipientName}` ⇒ «Escribe quién envía.»', async () => {
    const { put } = open(inbound());
    await screen.findByLabelText('Quién envía');
    put.mockRejectedValue(new ApiClientError(400, { code: 'VALIDATION_ERROR', message: 'x', details: { field: 'recipientName' } }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar dirección' }));
    expect(await screen.findByText('Escribe quién envía.')).toBeInTheDocument();
  });
});

describe('UX-BSD-6 (BSD-F3) · la banda de tarifa y la recomendada del servidor', () => {
  it('banda = `charged.grossCents`; preseleccionada la recomendada aunque no sea la primera; textos de entrada', async () => {
    const q = inboundQuote();
    open(complete(), q);
    fireEvent.click(await screen.findByRole('button', { name: 'Ver opciones de envío' }));
    await screen.findByRole('group', { name: 'Elige una paquetería' });
    expect(screen.getByTestId('sdx-inbound-fee')).toHaveTextContent('Se le descuenta al vendedor: MX$180.00 (la tarifa fija de su oferta).');
    expect(screen.getByText('Lo que va en la caja vale MX$1,500.00: lo que le vamos a pagar por las cartas.')).toBeInTheDocument();
    // ⛔ «Cobrado al cliente» no existe en entrada.
    expect(screen.queryByText(/Cobrado al cliente/)).toBeNull();
    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    expect(radios[0].checked).toBe(false);
    expect(screen.getByRole('radio', { name: 'FedEx · Express Saver' })).toBeChecked();
    expect(screen.getAllByText(/Entrega en la tienda/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Ofrece recolección \(no se agenda: el vendedor lo lleva a sucursal\)/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Sin recolección: el vendedor lo lleva a una sucursal de 99minutos/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ver también 1 opción que no entrega en la tienda/ })).toBeInTheDocument();
    expect(rateOf(q, 'rate-fedex')).toBeTruthy();
  });

  it('`recommendedRateId: null` ⇒ ninguna marcada y la frase `noRecommended`', async () => {
    open(complete(), inboundQuote({ recommendedRateId: null, rates: quote().rates.map((r) => ({ ...r, recommended: false })) }));
    fireEvent.click(await screen.findByRole('button', { name: 'Ver opciones de envío' }));
    await screen.findByRole('group', { name: 'Elige una paquetería' });
    for (const r of screen.getAllByRole('radio') as HTMLInputElement[]) expect(r.checked).toBe(false);
    expect(screen.getByTestId('sdx-inbound-no-recommended')).toHaveTextContent(
      'Ninguna opción entrega en la tienda. Elige una sabiendo que habrá que ir a recogerla, o captura la guía a mano.',
    );
  });
});

describe('§BSD-UX.5d · errores propios del modo entrada', () => {
  it('`422 SHIPMENT_ADDRESS_INCOMPLETE {missing:[recipientName]}` ⇒ su frase y vuelve al paso 1 con el foco en «Quién envía»', async () => {
    open(complete());
    vi.spyOn(api, 'quoteShipment').mockRejectedValue(
      new ApiClientError(422, { code: 'SHIPMENT_ADDRESS_INCOMPLETE', message: 'x', details: { missing: ['recipientName'] } }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Ver opciones de envío' }));
    expect(
      await screen.findByText('Falta quién envía y Skydropx no cotiza sin ese dato. Escríbelo (puedes usar el nombre de su cuenta) y guarda. No se cotizó nada.'),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Quién envía')).toHaveFocus());
  });

  it("`409 SHIPPING_PROVIDER_NOT_CONFIGURED {missing:['origin_snapshot']}` ⇒ la dirección de la tienda falta; «Capturar a mano» primaria", async () => {
    open(complete());
    vi.spyOn(api, 'quoteShipment').mockRejectedValue(
      new ApiClientError(409, { code: 'SHIPPING_PROVIDER_NOT_CONFIGURED', message: 'x', details: { missing: ['origin_snapshot'] } }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Ver opciones de envío' }));
    expect(await screen.findByText(/Falta la dirección de la tienda en «Configuración › Envíos», y es el destino de esta guía/)).toBeInTheDocument();
  });

  it('`409 GUIDE_NOT_ALLOWED {reason:status}` ⇒ «ya no está aceptada (estado de la SOLICITUD)»', async () => {
    open(complete());
    vi.spyOn(api, 'quoteShipment').mockRejectedValue(
      new ApiClientError(409, { code: 'GUIDE_NOT_ALLOWED', message: 'x', details: { status: 'expirada', reason: 'status' } }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Ver opciones de envío' }));
    expect(await screen.findByText('Esta solicitud ya no está aceptada (Expirada). No se abrió ni se cobró nada.')).toBeInTheDocument();
  });

  it('`400 VALIDATION_ERROR {reason:destination_not_editable}` ⇒ el canario de BSD-B6 visto desde la pantalla', async () => {
    open(complete());
    vi.spyOn(api, 'quoteShipment').mockRejectedValue(
      new ApiClientError(400, { code: 'VALIDATION_ERROR', message: 'x', details: { field: 'to', reason: 'destination_not_editable' } }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Ver opciones de envío' }));
    expect(await screen.findByText(/El servidor rechazó la petición porque llevaba un destino/)).toBeInTheDocument();
  });
});

describe('§BSD-UX.5c · pasos 3 y 4 en entrada', () => {
  it('confirmación de margen negativo con su texto; tras comprar: solo «Descargar PDF» y «Le mandamos al vendedor…»', async () => {
    const q = inboundQuote({
      rates: inboundQuote().rates.map((r) => (r.rateId === 'rate-fedex' ? { ...r, marginCents: -3552 } : r)),
    });
    open(complete(), q);
    fireEvent.click(await screen.findByRole('button', { name: 'Ver opciones de envío' }));
    await screen.findByRole('group', { name: 'Elige una paquetería' });
    fireEvent.click(screen.getByRole('button', { name: /^Continuar con/ }));
    await screen.findByText('Paso 3 de 4 · Comprar');
    expect(
      screen.getByText('Margen negativo: −MX$35.52. Esta guía cuesta más que la tarifa que se le descuenta al vendedor. Si compras, lo confirmas.'),
    ).toBeInTheDocument();
    const rate = rateOf(q, 'rate-fedex');
    const buy = vi.spyOn(api, 'purchaseShipmentLabel').mockResolvedValue({
      outcome: 'labeled',
      shipment: { ...complete(), status: 'guia', labelSource: 'skydropx' },
      label: labelFor(rate),
    });
    fireEvent.click(screen.getByRole('button', { name: /^Comprar guía/ }));
    await screen.findByTestId('sdx-labeled');
    expect(buy).toHaveBeenCalledTimes(1);
    expect(buy.mock.calls[0][1]).toMatchObject({ confirmNegativeMargin: true });
    expect(screen.queryByRole('button', { name: 'Imprimir etiqueta' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Descargar PDF' })).toBeInTheDocument();
    expect(screen.getByText('Le mandamos al vendedor su guía en PDF; desde ahora corre su plazo para enviarla.')).toBeInTheDocument();
  });
});

describe('§BSD-UX.5c · «Capturar a mano» en entrada = el de M5', () => {
  it('sin campo de costo; manda `POST /admin/buylist/:id/guide`; ⛔ la ruta de M4', async () => {
    open(complete());
    const capture = vi.spyOn(api, 'captureBuylistGuide').mockResolvedValue({} as never);
    const m4 = vi.spyOn(api, 'saveShipmentTracking');
    fireEvent.click(await screen.findByRole('button', { name: 'Capturar a mano' }));
    expect(screen.getByText('Para una guía que ya compraste en el panel de Skydropx o con otra paquetería. Al vendedor le llega por correo igual que hoy.')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Costo/)).toBeNull();
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Paquetería'), { target: { value: 'DHL' } });
    fireEvent.change(within(dialog).getByLabelText('Número de guía'), { target: { value: 'DHL123' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar guía' }));
    await waitFor(() => expect(capture).toHaveBeenCalledWith(SR, { carrier: 'DHL', trackingNumber: 'DHL123' }));
    expect(m4).not.toHaveBeenCalled();
  });
});
