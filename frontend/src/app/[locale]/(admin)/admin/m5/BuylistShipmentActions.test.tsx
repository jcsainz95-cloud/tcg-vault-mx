import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { BuylistShipmentActions } from './BuylistShipmentActions';
import * as api from '@/lib/api';
import type { AdminBuylistDTO } from '@/types/contract';

function request(over: Partial<AdminBuylistDTO> = {}): AdminBuylistDTO {
  return {
    id: 'sr-1',
    userId: 'u-777',
    status: 'aceptada',
    isTerminal: false,
    isPayable: false,
    quotedTotalCents: 90000,
    createdAt: '2026-08-28T14:00:00Z',
    items: [],
    ...over,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('Guía y confirmación — dos actos, y la separación ES el diseño', () => {
  /**
   * ⚠️ El matiz que sostiene todo el tramo: **capturar la guía NO mueve el estado**. Solo arranca
   * el reloj del vendedor — y arranca **con la entrega de la guía, no con la aceptación**, porque
   * sería injusto correrle el reloj mientras espera una etiqueta que depende de NOSOTROS.
   */
  it('capturar la guía NO confirma nada: son dos llamadas distintas', async () => {
    const guideSpy = vi.spyOn(api, 'captureBuylistGuide').mockResolvedValue({
      sellRequestId: 'sr-1',
      status: 'aceptada',
      shipmentCarrier: 'Estafeta',
      shipmentTrackingNumber: '7712345678',
      guideSentAt: '2026-09-01T18:00:00.000Z',
      shipDeadlineAt: '2026-09-04T18:00:00.000Z',
    });
    const confirmSpy = vi.spyOn(api, 'confirmBuylistShipment');
    renderWithProviders(<BuylistShipmentActions request={request()} />, 'es');

    fireEvent.change(screen.getByLabelText('Paquetería'), { target: { value: 'Estafeta' } });
    fireEvent.change(screen.getByLabelText('Número de guía'), { target: { value: '7712345678' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar la guía' }));

    await waitFor(() =>
      expect(guideSpy).toHaveBeenCalledWith('sr-1', {
        carrier: 'Estafeta',
        trackingNumber: '7712345678',
      }),
    );
    // La otra mitad NO se dispara sola: confirmar es un acto aparte.
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('sin guía dice que el plazo del vendedor NO ha arrancado (en vez de dejar un hueco)', () => {
    renderWithProviders(<BuylistShipmentActions request={request()} />, 'es');
    expect(
      screen.getByText('Sin guía todavía: el plazo del vendedor no ha arrancado.'),
    ).toBeInTheDocument();
  });

  it('el botón dice CORREGIR cuando ya hay guía: re-capturar es arreglar un typo', () => {
    renderWithProviders(
      <BuylistShipmentActions
        request={request({
          guideSentAt: '2026-09-01T18:00:00.000Z',
          shipmentCarrier: 'Estafeta',
          shipmentTrackingNumber: '7712345678',
          shipDeadlineAt: '2026-09-04T18:00:00.000Z',
        })}
      />,
      'es',
    );
    expect(screen.getByRole('button', { name: 'Corregir la guía' })).toBeInTheDocument();
    expect(screen.getByText(/Plazo de envío:/)).toBeInTheDocument();
  });

  /**
   * ⚠️ El «ya lo mandé» del vendedor **no mueve nada**: detiene SU reloj. Se pinta como renglón
   * informativo y **nunca como badge** — un segundo badge invitaría a leerlo como estado y a
   * contarlo como inventario en camino, que es exactamente lo prohibido.
   */
  it('el «ya lo mandé» se pinta como renglón, no como estado, y dice que no movió nada', () => {
    renderWithProviders(
      <BuylistShipmentActions
        request={request({ sellerShippedDeclaredAt: '2026-08-31T18:00:00.000Z' })}
      />,
      'es',
    );
    const box = screen.getByTestId('seller-declared');
    expect(box).toHaveTextContent('El vendedor dijo que lo mandó el');
    expect(box).toHaveTextContent('la solicitud sigue igual y no suma a «en camino»');
    // No hay badge de estado dentro del renglón.
    expect(within(box).queryByText('EN TRÁNSITO')).not.toBeInTheDocument();
  });

  it('confirmar es lo ÚNICO que mueve a «en tránsito», y lo dice antes de pulsarlo', async () => {
    const spy = vi.spyOn(api, 'confirmBuylistShipment').mockResolvedValue({
      sellRequestId: 'sr-1',
      status: 'en_transito',
      shipmentConfirmedAt: '2026-09-01T19:00:00.000Z',
      shipmentConfirmedBy: 'admin@tcghunt.mx',
      guideActualCostCents: null,
    });
    renderWithProviders(<BuylistShipmentActions request={request()} />, 'es');

    expect(
      screen.getByText(/Confirmar es lo único que mueve la solicitud a «en tránsito»/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar que llegó' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar que llegó' }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('sr-1', {}));
    expect(await screen.findByText(/Envío confirmado/)).toBeInTheDocument();
  });

  /**
   * ⚠️ La frontera money-safe, dicha en la pantalla donde alguien podría creer lo contrario: el
   * costo real de la etiqueta **no entra jamás** en lo que se le deposita al vendedor.
   */
  it('el costo real viaja como insumo de REPORTE, y la pantalla lo dice', async () => {
    const spy = vi.spyOn(api, 'confirmBuylistShipment').mockResolvedValue({
      sellRequestId: 'sr-1',
      status: 'en_transito',
      shipmentConfirmedAt: '2026-09-01T19:00:00.000Z',
      shipmentConfirmedBy: 'admin@tcghunt.mx',
      guideActualCostCents: 21500,
    });
    renderWithProviders(<BuylistShipmentActions request={request()} />, 'es');
    expect(
      screen.getByText(/No cambia lo que se le deposita al vendedor/),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Costo real de la etiqueta (opcional)'), {
      target: { value: '215' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar que llegó' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar que llegó' }));
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith('sr-1', { guideActualCostCents: 21500 }),
    );
  });

  /** `guideSentAt` no es precondición: negar la confirmación no devuelve el paquete. */
  it('sin guía capturada AVISA en el diálogo pero deja confirmar igual', async () => {
    vi.spyOn(api, 'confirmBuylistShipment').mockResolvedValue({
      sellRequestId: 'sr-1',
      status: 'en_transito',
      shipmentConfirmedAt: '2026-09-01T19:00:00.000Z',
      shipmentConfirmedBy: 'admin@tcghunt.mx',
      guideActualCostCents: null,
    });
    renderWithProviders(<BuylistShipmentActions request={request()} />, 'es');
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar que llegó' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('No hay guía capturada para esta solicitud.');
    expect(within(dialog).getByRole('button', { name: 'Confirmar que llegó' })).toBeEnabled();
  });

  it('EN: existe entera en inglés (paridad)', () => {
    renderWithProviders(<BuylistShipmentActions request={request()} />, 'en');
    expect(screen.getByRole('button', { name: 'Save the label' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm it shipped' })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/admin\.m5\.shipment/);
  });
});
