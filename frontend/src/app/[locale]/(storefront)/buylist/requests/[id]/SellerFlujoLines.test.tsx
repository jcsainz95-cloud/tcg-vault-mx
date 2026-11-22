import { describe, it, expect, vi, afterEach } from 'vitest';
import { useState } from 'react';
import { screen, fireEvent, waitFor, act } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as flujo from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { mockSellRequests } from '@/lib/mock/fixtures';
import type { SellItemDTO, SellRequestDetailDTO } from '@/types/contract';
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

  it('Aceptar manda la decisión Y el monto que el vendedor vio (`expectedRevisedPriceCents`)', async () => {
    const spy = vi.spyOn(flujo, 'respondBuylistRevision').mockResolvedValue({} as SellRequestDetailDTO);
    renderWithProviders(<SellerFlujoLines sellRequestId="sr-3020" lines={lines()} />, 'es');
    fireEvent.click(screen.getByTestId('seller-revision-accept-sri-f2c-1'));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('sr-3020', 'sri-f2c-1', 'accept', 110_000));
  });

  it('Rechazar pide confirmación: «Volver» no llama; «Sí, rechazar» manda decline sin monto', async () => {
    const spy = vi.spyOn(flujo, 'respondBuylistRevision').mockResolvedValue({} as SellRequestDetailDTO);
    renderWithProviders(<SellerFlujoLines sellRequestId="sr-3020" lines={lines()} />, 'es');
    fireEvent.click(screen.getByTestId('seller-revision-decline-sri-f2c-1'));
    expect(spy).not.toHaveBeenCalled();
    expect(screen.getByTestId('seller-revision-decline-confirm-sri-f2c-1')).toHaveTextContent('¿Rechazar la propuesta de MX$1,100.00?');
    fireEvent.click(screen.getByTestId('seller-revision-decline-no-sri-f2c-1'));
    expect(screen.queryByTestId('seller-revision-decline-confirm-sri-f2c-1')).not.toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('seller-revision-decline-sri-f2c-1'));
    fireEvent.click(screen.getByTestId('seller-revision-decline-yes-sri-f2c-1'));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('sr-3020', 'sri-f2c-1', 'decline', undefined));
  });

  it('409 REVISION_CHANGED ⇒ recarga la solicitud y explica el monto nuevo (sin mostrar el `message` del servidor)', async () => {
    vi.spyOn(flujo, 'respondBuylistRevision').mockRejectedValue(
      new ApiClientError(409, {
        code: 'REVISION_CHANGED',
        message: 'srv',
        details: { expectedRevisedPriceCents: 110_000, currentRevisedPriceCents: 90_000 },
      }),
    );
    renderWithProviders(<SellerFlujoLines sellRequestId="sr-3020" lines={lines()} />, 'es');
    fireEvent.click(screen.getByTestId('seller-revision-accept-sri-f2c-1'));
    expect(await screen.findByTestId('seller-revision-notice')).toHaveTextContent('ahora es de MX$900.00');
    expect(document.body.textContent).not.toContain('srv');
  });

  it('409 REVISION_ALREADY_RESOLVED ⇒ explica qué pasó, y el aviso sobrevive aunque la tarjeta desaparezca al recargar', async () => {
    vi.spyOn(flujo, 'respondBuylistRevision').mockRejectedValue(new ApiClientError(409, { code: 'REVISION_ALREADY_RESOLVED', message: 'srv' }));
    const l = lines();
    let setLines: (v: SellItemDTO[]) => void = () => {};
    function Harness() {
      const [ls, set] = useState(l);
      setLines = set;
      return <SellerFlujoLines sellRequestId="sr-3020" lines={ls} />;
    }
    renderWithProviders(<Harness />, 'es');
    fireEvent.click(screen.getByTestId('seller-revision-accept-sri-f2c-1'));
    expect(await screen.findByTestId('seller-revision-notice')).toHaveTextContent(F.revision.errors.alreadyResolved);
    // La recarga trae la baja retirada: tarjeta fuera, el aviso se queda.
    act(() => setLines(l.map((x, i) => (i === 0 ? { ...x, revision: { ...x.revision!, state: 'cancelled' as const } } : x))));
    expect(screen.queryByTestId('seller-revision-accept-sri-f2c-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('seller-revision-notice')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('srv');
  });

  it('baja `cancelled` ⇒ «retirada», sin botones', () => {
    const l = lines();
    l[0].revision = { ...l[0].revision!, state: 'cancelled' };
    renderWithProviders(<SellerFlujoLines sellRequestId="sr-3020" lines={l} />, 'es');
    expect(screen.getByTestId('seller-revision-resolved-sri-f2c-1')).toHaveTextContent('Retiramos la propuesta de nuevo precio por Mewtwo');
    expect(screen.queryByTestId('seller-revision-accept-sri-f2c-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('seller-revision-decline-sri-f2c-1')).not.toBeInTheDocument();
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
    const spy = vi.spyOn(flujo, 'chooseBuylistPickup').mockResolvedValue({} as SellRequestDetailDTO);
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
