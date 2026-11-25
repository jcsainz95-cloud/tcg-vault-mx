import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import type { AdminBuylistDTO } from '@/types/contract';
import { InboundCarrierStatus } from './InboundCarrierStatus';
import { AcceptedRequestPanel } from './AcceptedRequestPanel';
import { ShipDeadlineNotice, isShipDeadlinePassed } from './BuylistShipmentActions';
import { useState } from 'react';
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
  it('ausente: solo el respaldo «Sin rastreo automático»', () => {
    const { container } = renderWithProviders(<InboundCarrierStatus req={req()} />);
    expect(container.textContent).toBe('Sin rastreo automático');
  });
  it('en camino con fecha estimada y hora de actualización', () => {
    renderWithProviders(
      <InboundCarrierStatus
        req={req({ inboundCarrier: { status: 'in_transit', statusAt: '2026-11-25T16:00:00Z', estimatedDeliveryAt: '2026-11-30T18:00:00Z' } })}
      />,
    );
    expect(screen.getByTestId('m5-inbound-carrier-line').textContent).toBe('En camino');
    expect(screen.queryByText(/llega/)).toBeNull();
    expect(screen.getByText(/Actualizado/)).toBeTruthy();
  });
  it('entregado e incidencia', () => {
    const a = renderWithProviders(<InboundCarrierStatus req={req({ inboundCarrier: { status: 'delivered' } })} />);
    expect(screen.getByText('Entregado')).toBeTruthy();
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
    expect(b.container.textContent).not.toMatch(/automáticamente/);
  });
});

describe('Plazo vencido sin confirmar', () => {
  const NOW = new Date('2026-11-25T18:00:00Z');
  // Mismo cableado que `M5View`: el aviso va ARRIBA de la tarjeta y su botón sube el `confirmTick` del panel.
  function Card({ r }: { r: AdminBuylistDTO }) {
    const [tick, setTick] = useState(0);
    return (
      <div data-testid="card">
        {isShipDeadlinePassed(r) && <ShipDeadlineNotice onConfirm={() => setTick((n) => n + 1)} />}
        <AcceptedRequestPanel req={r} onNotice={() => {}} confirmTick={tick} />
      </div>
    );
  }
  const panel = (over: Partial<AdminBuylistDTO> = {}) => {
    const r = req({ shipDeadlineAt: '2026-11-24T18:00:00Z', ...over });
    vi.spyOn(api, 'getAdminBuylistRequest').mockResolvedValue(r as never);
    return renderWithProviders(<Card r={r} />);
  };
  it('aviso y botón ARRIBA de la ficha; confirmar abre el diálogo y llama al servidor', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    const spy = vi.spyOn(api, 'confirmBuylistShipment').mockResolvedValue({} as never);
    panel();
    // Primer hijo de la tarjeta = el aviso, antes de la ficha (sin desplazarse).
    const first = screen.getByTestId('card').firstElementChild;
    expect(first?.contains(screen.getByTestId('m5-overdue-notice'))).toBe(true);
    expect(first?.contains(screen.getByTestId('m5-overdue-confirm'))).toBe(true);
    expect(screen.getByTestId('m5-overdue-notice').textContent).toBe(
      'El plazo venció. Si el paquete ya viene en camino, pulsa Confirmar envío; si no, mañana se cierra sola.',
    );
    expect(screen.getByTestId('m5-overdue-confirm').textContent).toBe('Confirmar envío');
    fireEvent.click(screen.getByTestId('m5-overdue-confirm'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar envío' }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
  });
  it('sin aviso si no venció o si ya está confirmado', () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    const a = panel({ shipDeadlineAt: '2026-11-30T18:00:00Z' });
    expect(screen.queryByTestId('m5-overdue-notice')).toBeNull();
    a.unmount();
    panel({ shipmentConfirmedAt: '2026-11-23T10:00:00Z' });
    expect(screen.queryByTestId('m5-overdue-notice')).toBeNull();
    expect(screen.queryByText(/Vence/)).toBeNull();
  });
  it('409 NOT_ACCEPTED al confirmar es éxito silencioso', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    vi.spyOn(api, 'confirmBuylistShipment').mockRejectedValue(new ApiClientError(409, { code: 'NOT_ACCEPTED', message: 'x' } as never));
    panel();
    fireEvent.click(screen.getByTestId('m5-overdue-confirm'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar envío' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('Notas y respaldo de la cinta', () => {
  it('stalledDays: aviso corto en la ficha; null o ausente: nada', () => {
    const a = renderWithProviders(
      <InboundCarrierStatus mode="notes" req={req({ status: 'en_transito', inboundCarrier: { status: 'in_transit', stalledDays: 12 } })} />,
    );
    expect(screen.getByTestId('m5-stalled').textContent).toBe('Lleva 12 días sin movimiento de la paquetería');
    a.unmount();
    const b = renderWithProviders(
      <InboundCarrierStatus mode="notes" req={req({ status: 'en_transito', inboundCarrier: { status: 'in_transit', stalledDays: null } })} />,
    );
    expect(b.container.textContent).toBe('');
  });
  it('modo notes: entregado y devuelto se pintan también con la solicitud en_transito', () => {
    const a = renderWithProviders(
      <InboundCarrierStatus mode="notes" req={req({ status: 'en_transito', inboundCarrier: { status: 'delivered' } })} />,
    );
    expect(screen.getByText('La paquetería lo entregó. Falta recibirlo.')).toBeTruthy();
    a.unmount();
    renderWithProviders(
      <InboundCarrierStatus mode="notes" req={req({ status: 'en_transito', inboundCarrier: { status: 'in_return' } })} />,
    );
    expect(screen.getByText('Va de regreso al vendedor.')).toBeTruthy();
  });
  it('sin escaneo: guía nuestra ⇒ «Aún sin movimiento»; guía del vendedor o rastreo caído ⇒ «Sin rastreo automático»', () => {
    const ours = { id: 's', folio: null, carrier: 'DHL', trackingNumber: '1' } as never;
    const a = renderWithProviders(<InboundCarrierStatus req={req({ inboundShipment: ours })} />);
    expect(screen.getByText('Aún sin movimiento de la paquetería')).toBeTruthy();
    a.unmount();
    const b = renderWithProviders(<InboundCarrierStatus req={req()} />);
    expect(screen.getByText('Sin rastreo automático')).toBeTruthy();
    b.unmount();
    renderWithProviders(<InboundCarrierStatus req={req({ inboundShipment: ours, inboundCarrier: { status: null, pollError: true } })} />);
    expect(screen.getByText('Sin rastreo automático')).toBeTruthy();
    expect(screen.queryByText('Aún sin movimiento de la paquetería')).toBeNull();
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
    expect(screen.getByText('Tu paquete va en camino')).toBeTruthy();
    expect(screen.queryByText(/llega/)).toBeNull();
  });
  it('incidencia: texto en llano, sin «te escribiremos»', () => {
    renderWithProviders(<SellerCarrierLine data={{ inboundCarrier: { status: 'exception' } }} />);
    expect(
      screen.getByText('La paquetería reportó un problema con tu paquete. Lo estamos revisando; el avance se verá aquí.'),
    ).toBeTruthy();
  });
});
