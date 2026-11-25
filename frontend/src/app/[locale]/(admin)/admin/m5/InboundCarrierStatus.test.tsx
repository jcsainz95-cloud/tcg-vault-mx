import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import type { AdminBuylistDTO } from '@/types/contract';
import { InboundCarrierStatus } from './InboundCarrierStatus';
import { BuylistShipmentActions } from './BuylistShipmentActions';
import { SellerCarrierLine } from '@/app/[locale]/(storefront)/buylist/requests/[id]/SellerCarrierLine';

function req(over: Partial<AdminBuylistDTO> = {}): AdminBuylistDTO {
  return {
    id: 'sr-1', userId: 'u', status: 'aceptada', isTerminal: false, isPayable: false, isRejectable: false,
    quotedTotalCents: 90000, createdAt: '2026-11-01T14:00:00Z', items: [], ...over,
  };
}

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { vi.useRealTimers(); });

describe('InboundCarrierStatus', () => {
  it('ausente: no pinta nada', () => {
    const { container } = renderWithProviders(<InboundCarrierStatus req={req()} />);
    expect(container.textContent).toBe('');
  });
  it('en camino con fecha estimada y hora de actualización', () => {
    renderWithProviders(
      <InboundCarrierStatus
        req={req({ inboundCarrier: { status: 'in_transit', statusAt: '2026-11-25T16:00:00Z', estimatedDeliveryAt: '2026-11-30T18:00:00Z' } })}
      />,
    );
    expect(screen.getByTestId('m5-inbound-carrier-line').textContent).toMatch(/^En camino · llega lun 30 nov$/);
    expect(screen.getByText(/Actualizado/)).toBeTruthy();
  });
  it('entregado e incidencia', () => {
    const a = renderWithProviders(<InboundCarrierStatus req={req({ inboundCarrier: { status: 'delivered' } })} />);
    expect(screen.getByText('Entregado')).toBeTruthy();
    expect(screen.getByText(/Falta recibirlo/)).toBeTruthy();
    a.unmount();
    renderWithProviders(<InboundCarrierStatus req={req({ inboundCarrier: { status: 'exception' } })} />);
    expect(screen.getByText('Incidencia')).toBeTruthy();
  });
  it('en tránsito por el sistema lo dice; por una persona no', () => {
    const a = renderWithProviders(
      <InboundCarrierStatus req={req({ status: 'en_transito', shipmentConfirmedBy: 'system:carrier' })} />,
    );
    expect(screen.getByText('Marcado en tránsito automáticamente por la paquetería')).toBeTruthy();
    a.unmount();
    const b = renderWithProviders(<InboundCarrierStatus req={req({ status: 'en_transito', shipmentConfirmedBy: 'admin:1' })} />);
    expect(b.container.textContent).toBe('');
  });
});

describe('Plazo vencido sin confirmar', () => {
  const NOW = new Date('2026-11-25T18:00:00Z');
  it('muestra aviso y botón; confirmar llama al servidor', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    const spy = vi.spyOn(api, 'confirmBuylistShipment').mockResolvedValue({} as never);
    renderWithProviders(<BuylistShipmentActions request={req({ shipDeadlineAt: '2026-11-24T18:00:00Z' })} />);
    expect(screen.getByTestId('m5-overdue-notice').textContent).toBe(
      'El plazo venció. Si el paquete ya viene en camino, pulsa Confirmar envío; si no, mañana se cierra sola.',
    );
    expect(screen.getByTestId('m5-overdue-confirm').textContent).toBe('Confirmar envío');
    fireEvent.click(screen.getByTestId('m5-overdue-confirm'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar que llegó' }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
  });
  it('sin aviso si no venció, si ya está confirmado o si ya es en tránsito', () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    const a = renderWithProviders(<BuylistShipmentActions request={req({ shipDeadlineAt: '2026-11-30T18:00:00Z' })} />);
    expect(screen.queryByTestId('m5-overdue-notice')).toBeNull();
    a.unmount();
    renderWithProviders(
      <BuylistShipmentActions request={req({ shipDeadlineAt: '2026-11-24T18:00:00Z', shipmentConfirmedAt: '2026-11-23T10:00:00Z' })} />,
    );
    expect(screen.queryByTestId('m5-overdue-notice')).toBeNull();
    expect(screen.queryByText(/Vence/)).toBeNull();
  });
  it('409 NOT_ACCEPTED al confirmar es éxito silencioso', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    vi.spyOn(api, 'confirmBuylistShipment').mockRejectedValue(new ApiClientError(409, { code: 'NOT_ACCEPTED', message: 'x' } as never));
    renderWithProviders(<BuylistShipmentActions request={req({ shipDeadlineAt: '2026-11-24T18:00:00Z' })} />);
    fireEvent.click(screen.getByTestId('m5-overdue-confirm'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar que llegó' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('Vista del vendedor', () => {
  it('ausente: nada; presente: línea en llano con fecha', () => {
    const a = renderWithProviders(<SellerCarrierLine data={{}} />);
    expect(a.container.textContent).toBe('');
    a.unmount();
    renderWithProviders(
      <SellerCarrierLine data={{ inboundCarrier: { status: 'last_mile', estimatedDeliveryAt: '2026-11-30T18:00:00Z' } }} />,
    );
    expect(screen.getByText('Tu paquete va en camino · llega aprox. lun 30 nov')).toBeTruthy();
  });
});
