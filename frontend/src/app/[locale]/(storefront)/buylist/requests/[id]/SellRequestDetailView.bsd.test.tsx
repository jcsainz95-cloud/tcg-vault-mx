import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { SellRequestDetailView } from './SellRequestDetailView';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { setStoredUser } from '@/lib/session';
import type { SellItemDTO, SellRequestDetailDTO, SellOfferPublicDTO } from '@/types/contract';

/**
 * 💰 rev BSD-1 — portal del vendedor (DESIGN_SYSTEM §BSD-UX.4a/4b · contrato §BSD.4.4, BSD-1.1 C-1, BSD-1.4 punto 8).
 *
 * - **UX-BSD-3 (BSD-F7):** `expirada` + `not_continued` ⇒ `closedNotContinued`, insignia «No continuó» NEUTRAL, **cero**
 *   `MX$` en el DOM aunque el servidor mandara montos (peor caso), y ninguna palabra de culpa.
 * - **UX-BSD-4 (BSD-F7):** «Tu guía» existe ⇔ `labelPdfAvailable === true` (⛔ por `offer.trackingNumber`); `404` ⇒
 *   `errorUnavailable` (+ relectura), `502` ⇒ `errorTemporary`.
 */

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/buylist/requests/sr-nc',
  useRouter: () => ({ push: vi.fn() }),
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const CARD = {
  id: 'c-1', externalId: 'x-1', name: 'Charizard VMAX', number: '020/189', rarity: 'Rare Holo', supertype: 'Pokémon',
  subtypes: [], setId: 's-1', setName: 'Darkness Ablaze', setPtcgoCode: null, imageSmallUrl: '', imageLargeUrl: '',
  availableFinishes: ['holofoil' as const],
};
const LINE: SellItemDTO = {
  id: 'a', card: CARD, productType: 'raw', rawCondition: 'NM', finish: 'holofoil', itemStatus: 'cotizada',
  quotedPriceCents: 84000, offerDecision: 'buy', offeredPriceCents: 84000,
};
function offer(over: Partial<SellOfferPublicDTO> = {}): SellOfferPublicDTO {
  return {
    sentAt: '2026-09-21T18:00:00.000Z', grossCents: 84000, shippingFeeCents: 18000, netCents: 66000,
    acceptDeadlineAt: '2026-09-24T18:00:00.000Z', acceptedAt: '2026-09-22T10:00:00.000Z', shipDeadlineAt: null,
    sellerShippedDeclaredAt: null, carrier: null, trackingNumber: null,
    terms: { perLineConditionLabel: 'siempre que llegue en Near Mint', consequence: 'Si una carta no llega en Near Mint no se compra.' },
    lines: [LINE],
    ...over,
  };
}
function detail(over: Partial<SellRequestDetailDTO> = {}): SellRequestDetailDTO {
  return {
    sellRequestId: 'sr-nc', status: 'aceptada', isTerminal: false, quotedTotalCents: 84000, ineRequired: false,
    createdAt: '2026-09-20T14:00:00.000Z', items: [LINE], offer: offer(), ...over,
  };
}
function asSeller() {
  setStoredUser({ id: 'u-1', email: 'ash@example.com', name: 'Ash', role: 'customer', locale: 'es', emailVerified: true });
}

beforeEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  asSeller();
});

describe('UX-BSD-3 · `not_continued` en el portal: sin culpa y sin dinero', () => {
  it('frase espejo de BSD-M1, insignia «No continuó» neutral, cero `MX$` aunque el servidor mande montos', async () => {
    // Peor caso: un servidor que NO redacta (BSD-1.4 punto 8 dice que sí lo hace) — la pantalla oculta igual.
    vi.spyOn(api, 'getSellRequest').mockResolvedValue(
      detail({ status: 'expirada', isTerminal: true, expiredReason: 'not_continued', labelPdfAvailable: false }),
    );
    renderWithProviders(<SellRequestDetailView sellRequestId="sr-nc" />);
    expect(
      await screen.findByText(
        'Tras una revisión adicional, decidimos no continuar con esta venta. La solicitud queda cerrada y no se compró ninguna carta.',
      ),
    ).toBeInTheDocument();
    const badge = screen.getByText('No continuó');
    expect(badge.closest('[class*="danger"]')).toBeNull();
    expect(badge.parentElement?.querySelector('svg')).toBeNull();
    expect(document.body.textContent).not.toMatch(/MX\$/);
    expect(document.body.textContent).not.toMatch(/expir|venc|plazo|no enviaste/i);
    expect(screen.queryByText('Se venció el plazo para enviar tus cartas.')).toBeNull();
    // ⛔ Ni «Tu guía» ni botones de responder la oferta.
    expect(screen.queryByTestId('seller-label-block')).toBeNull();
    expect(screen.queryByTestId('offer-amounts')).toBeNull();
    expect(screen.getByText('Cotizar de nuevo')).toBeInTheDocument();
  });

  it('con montos `null` del servidor (BSD-1.4) tampoco hay «MX$0.00» ni «pendiente»', async () => {
    vi.spyOn(api, 'getSellRequest').mockResolvedValue(
      detail({
        status: 'expirada', isTerminal: true, expiredReason: 'not_continued',
        quotedTotalCents: null as unknown as number,
        items: [{ ...LINE, quotedPriceCents: null as unknown as number, offeredPriceCents: null }],
        offer: null,
      }),
    );
    renderWithProviders(<SellRequestDetailView sellRequestId="sr-nc" />);
    await screen.findByText(/decidimos no continuar con esta venta/);
    expect(document.body.textContent).not.toMatch(/MX\$/);
  });
});

describe('UX-BSD-4 · «Tu guía» ⇔ `labelPdfAvailable`', () => {
  it('`labelPdfAvailable: true` ⇒ bloque con paquetería, número y botón; la descarga va por el proxy del vendedor', async () => {
    const pdf = vi.spyOn(api, 'fetchSellRequestLabelPdf').mockResolvedValue({ blob: new Blob(['%PDF']), filename: 'guia-sr-nc.pdf' });
    vi.spyOn(api, 'getSellRequest').mockResolvedValue(
      detail({ labelPdfAvailable: true, offer: offer({ carrier: 'Paquetexpress', trackingNumber: 'PQX123' }) }),
    );
    renderWithProviders(<SellRequestDetailView sellRequestId="sr-nc" />);
    const block = await screen.findByTestId('seller-label-block');
    expect(block).toHaveTextContent('Tu guía');
    expect(block).toHaveTextContent('Ya pagamos tu guía con Paquetexpress. Imprímela, pégala en tu paquete y llévalo a una sucursal de Paquetexpress.');
    expect(block).toHaveTextContent('Número de guía: PQX123');
    expect(block).toHaveTextContent('También va adjunta en el correo que te mandamos.');
    fireEvent.click(screen.getByRole('button', { name: 'Descargar mi guía (PDF)' }));
    await waitFor(() => expect(pdf).toHaveBeenCalledWith('sr-nc'));
  });

  it('`labelPdfAvailable: false` con número de guía (guía MANUAL) ⇒ NO hay bloque (⛔ decidir por `trackingNumber`)', async () => {
    vi.spyOn(api, 'getSellRequest').mockResolvedValue(
      detail({ labelPdfAvailable: false, offer: offer({ carrier: 'DHL', trackingNumber: 'DHL999' }) }),
    );
    renderWithProviders(<SellRequestDetailView sellRequestId="sr-nc" />);
    await waitFor(() => expect(screen.getAllByText(/Charizard VMAX/).length).toBeGreaterThan(0));
    expect(screen.queryByTestId('seller-label-block')).toBeNull();
    expect(screen.queryByText('Descargar mi guía (PDF)')).toBeNull();
  });

  it('sin `carrier` ⇒ el cuerpo genérico', async () => {
    vi.spyOn(api, 'getSellRequest').mockResolvedValue(detail({ labelPdfAvailable: true }));
    renderWithProviders(<SellRequestDetailView sellRequestId="sr-nc" />);
    expect(await screen.findByTestId('seller-label-block')).toHaveTextContent(
      'Ya pagamos tu guía. Imprímela, pégala en tu paquete y llévalo a una sucursal de la paquetería que dice la guía.',
    );
  });

  it.each([
    ['404 LABEL_NOT_AVAILABLE', new ApiClientError(404, { code: 'LABEL_NOT_AVAILABLE', message: 'x' }), 'Esta guía ya no está disponible para descargar. Si la cambiamos, te mandamos la nueva por correo.', true],
    ['404 NOT_FOUND (mismo texto, sin oráculo)', new ApiClientError(404, { code: 'NOT_FOUND', message: 'x' }), 'Esta guía ya no está disponible para descargar. Si la cambiamos, te mandamos la nueva por correo.', true],
    ['502 SHIPPING_PROVIDER_ERROR', new ApiClientError(502, { code: 'SHIPPING_PROVIDER_ERROR', message: 'x' }), 'No pudimos traer tu guía en este momento. Vuelve a intentarlo en unos minutos; también va adjunta en el correo que te mandamos.', false],
    ['409 SHIPPING_PROVIDER_NOT_CONFIGURED', new ApiClientError(409, { code: 'SHIPPING_PROVIDER_NOT_CONFIGURED', message: 'x' }), 'No pudimos traer tu guía en este momento. Vuelve a intentarlo en unos minutos; también va adjunta en el correo que te mandamos.', false],
    ['red', new TypeError('Failed to fetch'), 'No pudimos traer tu guía en este momento. Vuelve a intentarlo en unos minutos; también va adjunta en el correo que te mandamos.', false],
  ] as const)('%s ⇒ su frase en `role="alert"` y el botón vuelve a estar activo', async (_n, err, text, rereads) => {
    vi.spyOn(api, 'fetchSellRequestLabelPdf').mockRejectedValue(err);
    const get = vi.spyOn(api, 'getSellRequest').mockResolvedValue(detail({ labelPdfAvailable: true }));
    renderWithProviders(<SellRequestDetailView sellRequestId="sr-nc" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Descargar mi guía (PDF)' }));
    const alert = await screen.findByTestId('seller-label-error');
    expect(alert).toHaveAttribute('role', 'alert');
    expect(alert).toHaveTextContent(text);
    expect(screen.getByRole('button', { name: 'Descargar mi guía (PDF)' })).toBeEnabled();
    if (rereads) await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    else expect(get).toHaveBeenCalledTimes(1);
  });
});

describe('M-2 (gate QA) · en un cierre SIN guía no se habla de la guía', () => {
  const PICKUP = { line1: 'Calle 1', neighborhood: 'Centro', city: 'Guadalajara', state: 'Jalisco', postalCode: '44100', country: 'MX' as const, phone: '3300000000', capturedAt: '2026-09-20T14:00:00.000Z' };
  it.each(['not_continued', 'no_offer'] as const)('`%s` ⇒ ni el bloque de la dirección de origen ni «va impresa en la guía»', async (reason) => {
    vi.spyOn(api, 'getSellRequest').mockResolvedValue(
      detail({ status: 'expirada', isTerminal: true, expiredReason: reason, labelPdfAvailable: false, offer: null, pickupAddress: PICKUP }),
    );
    renderWithProviders(<SellRequestDetailView sellRequestId="sr-nc" />);
    await screen.findByText('Cotizar de nuevo');
    expect(screen.queryByTestId('seller-pickup-address')).toBeNull();
    expect(document.body.textContent).not.toMatch(/impresa en la guía/);
  });
  it('CONTROL · `aceptada` sí la muestra con su frase', async () => {
    vi.spyOn(api, 'getSellRequest').mockResolvedValue(detail({ pickupAddress: PICKUP }));
    renderWithProviders(<SellRequestDetailView sellRequestId="sr-nc" />);
    expect(await screen.findByTestId('seller-pickup-address')).toHaveTextContent('impresa en la guía');
  });
});
