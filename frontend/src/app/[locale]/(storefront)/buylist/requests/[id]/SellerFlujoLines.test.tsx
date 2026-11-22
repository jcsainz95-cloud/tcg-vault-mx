import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as flujo from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { mockSellRequests } from '@/lib/mock/fixtures';
import type { SellItemDTO } from '@/types/contract';
import es from '../../../../../../../messages/es.json';
import { SellerFlujoLines } from './SellerFlujoLines';

const F = es.sellerFlujo;
const lines = (): SellItemDTO[] => structuredClone(mockSellRequests.find((r) => r.sellRequestId === 'sr-3020')!.items);

afterEach(() => vi.restoreAllMocks());

describe('SellerFlujoLines · baja de precio (variante A)', () => {
  it('tarjeta con el monto PROPUESTO del servidor, el anterior, el texto de causa (sin código interno) y Aceptar/Rechazar grandes', () => {
    renderWithProviders(<SellerFlujoLines sellRequestId="sr-3020" lines={lines()} />, 'es');
    const card = screen.getByTestId('seller-revision-sri-f2c-1');
    expect(card).toHaveTextContent('Propuesta de nuevo precio para Mewtwo');
    expect(screen.getByTestId('seller-revision-amount-sri-f2c-1').textContent).toBe('MX$1,100.00');
    expect(card).toHaveTextContent('Antes ofrecimos MX$1,450.00');
    expect(card).toHaveTextContent('La carta llegó en una condición distinta a la declarada');
    expect(card.textContent).not.toContain('condition_mismatch');
    expect(screen.getByRole('button', { name: 'Aceptar MX$1,100.00' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rechazar' })).toBeInTheDocument();
  });

  it('Aceptar manda SOLO la decisión (nunca el monto)', async () => {
    const spy = vi.spyOn(flujo, 'respondBuylistRevision').mockResolvedValue({} as SellItemDTO);
    renderWithProviders(<SellerFlujoLines sellRequestId="sr-3020" lines={lines()} />, 'es');
    fireEvent.click(screen.getByTestId('seller-revision-accept-sri-f2c-1'));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('sr-3020', 'sri-f2c-1', 'accept'));
    expect(spy.mock.calls[0]).toHaveLength(3);
  });

  it('Rechazar manda decline; 409 REVISION_ALREADY_RESOLVED y 404 se muestran con su copy', async () => {
    const spy = vi.spyOn(flujo, 'respondBuylistRevision').mockRejectedValue(new ApiClientError(409, { code: 'REVISION_ALREADY_RESOLVED', message: 'srv' }));
    renderWithProviders(<SellerFlujoLines sellRequestId="sr-3020" lines={lines()} />, 'es');
    fireEvent.click(screen.getByTestId('seller-revision-decline-sri-f2c-1'));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('sr-3020', 'sri-f2c-1', 'decline'));
    expect(await screen.findByRole('alert')).toHaveTextContent(F.revision.errors.resolved);
    expect(document.body.textContent).not.toContain('srv');
  });

  it('una baja ya resuelta se lee como nota (sin botones)', () => {
    const l = lines();
    l[0].revision = { ...l[0].revision!, state: 'expired' };
    renderWithProviders(<SellerFlujoLines sellRequestId="sr-3020" lines={l} />, 'es');
    expect(screen.getByTestId('seller-revision-resolved-sri-f2c-1')).toHaveTextContent('venció sin respuesta');
    expect(screen.queryByTestId('seller-revision-accept-sri-f2c-1')).not.toBeInTheDocument();
  });
});

describe('SellerFlujoLines · cómo recoger (§5)', () => {
  it('ofrece en tienda (gratis) o envío a su cargo y manda el método elegido', async () => {
    const spy = vi.spyOn(flujo, 'chooseBuylistPickup').mockResolvedValue({} as SellItemDTO);
    renderWithProviders(<SellerFlujoLines sellRequestId="sr-3020" lines={lines()} />, 'es');
    const card = screen.getByTestId('seller-pickup-sri-f2c-2');
    expect(card).toHaveTextContent('Recoger en tienda (sin costo)');
    expect(card).toHaveTextContent('Que me la envíen (a mi cargo)');
    fireEvent.click(screen.getByTestId('seller-pickup-ship_back-sri-f2c-2'));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('sr-3020', 'sri-f2c-2', 'ship_back'));
  });

  it('409 PICKUP_ALREADY_DONE ⇒ copy propio; «No llegó» (pickup null) no ofrece nada; entregada se lee como hecho', async () => {
    vi.spyOn(flujo, 'chooseBuylistPickup').mockRejectedValue(new ApiClientError(409, { code: 'PICKUP_ALREADY_DONE', message: 'srv' }));
    renderWithProviders(<SellerFlujoLines sellRequestId="sr-3020" lines={lines()} />, 'es');
    fireEvent.click(screen.getByTestId('seller-pickup-in_person-sri-f2c-2'));
    expect(await screen.findByRole('alert')).toHaveTextContent(F.pickup.errors.alreadyDone);

    const l = lines();
    l[1].rejectionCode = 'not_received';
    l[1].pickup = null;
    l[0].revision = null;
    document.body.innerHTML = '';
    const r = renderWithProviders(<SellerFlujoLines sellRequestId="sr-3020" lines={l} />, 'es');
    expect(r.container.querySelector('[data-testid="seller-flujo"]')).toBeNull();

    const d = lines();
    d[1].pickup = { ...d[1].pickup!, method: 'in_person', doneAt: '2026-11-21T10:00:00Z' };
    renderWithProviders(<SellerFlujoLines sellRequestId="sr-3020" lines={d} />, 'es');
    expect(screen.getByTestId('seller-pickup-done-sri-f2c-2')).toHaveTextContent(/Entregada el/);
  });
});
