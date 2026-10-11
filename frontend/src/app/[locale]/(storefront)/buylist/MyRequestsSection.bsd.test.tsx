import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { MyRequestsSection } from './MyRequestsSection';
import * as api from '@/lib/api';
import type { SellItemDTO, SellRequestDTO } from '@/types/contract';

/**
 * 💰 rev BSD-1 — el renglón de «Ventas» (DESIGN_SYSTEM §BSD-UX.4a/4b punto 2 · BSD-1.1 C-1 · BSD-1.4 punto 8).
 * - UX-BSD-4: el enlace «Descargar guía (PDF)» ⇔ `labelPdfAvailable === true` (viaja en la LISTA).
 * - UX-BSD-3 (lista): `not_continued` con montos `null` ⇒ ni «MX$0.00» ni «pendiente»; insignia «No continuó».
 */
vi.mock('@/i18n/navigation', () => ({
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
const LINE: SellItemDTO = { id: 'a', card: CARD, productType: 'raw', rawCondition: 'NM', finish: 'holofoil', itemStatus: 'cotizada', quotedPriceCents: 84000 };
function row(over: Partial<SellRequestDTO>): SellRequestDTO {
  return { sellRequestId: 'sr-1', status: 'aceptada', isTerminal: false, quotedTotalCents: 84000, ineRequired: false, items: [LINE], ...over };
}

beforeEach(() => vi.restoreAllMocks());

describe('UX-BSD-4 · el enlace de descarga del renglón de «Ventas»', () => {
  it('existe ⇔ `labelPdfAvailable === true`; el clic va por el proxy del vendedor', async () => {
    const pdf = vi.spyOn(api, 'fetchSellRequestLabelPdf').mockResolvedValue({ blob: new Blob(['%PDF']), filename: null });
    vi.spyOn(api, 'getSellRequests').mockResolvedValue([
      row({ sellRequestId: 'sr-yes', labelPdfAvailable: true }),
      row({ sellRequestId: 'sr-no', labelPdfAvailable: false }),
      row({ sellRequestId: 'sr-old' }),
    ]);
    renderWithProviders(<MyRequestsSection ready isAuthenticated />);
    const link = await screen.findByTestId('seller-label-link-sr-yes');
    expect(link).toHaveTextContent('Descargar guía (PDF)');
    expect(screen.queryByTestId('seller-label-link-sr-no')).toBeNull();
    expect(screen.queryByTestId('seller-label-link-sr-old')).toBeNull();
    fireEvent.click(link);
    await waitFor(() => expect(pdf).toHaveBeenCalledWith('sr-yes'));
  });
});

describe('UX-BSD-3 (lista) · `not_continued` sin dinero', () => {
  it('montos `null` del servidor ⇒ ni «MX$» ni «pendiente»; insignia «No continuó»', async () => {
    vi.spyOn(api, 'getSellRequests').mockResolvedValue([
      row({
        sellRequestId: 'sr-nc', status: 'expirada', isTerminal: true, expiredReason: 'not_continued', labelPdfAvailable: false,
        quotedTotalCents: null as unknown as number, items: [{ ...LINE, quotedPriceCents: null as unknown as number }],
      }),
    ]);
    renderWithProviders(<MyRequestsSection ready isAuthenticated />);
    const badge = await screen.findByText('No continuó');
    const card = badge.closest('div.border-t') as HTMLElement;
    expect(within(card).queryByText(/MX\$/)).toBeNull();
    expect(card.textContent).not.toMatch(/MX\$|pendiente/i);
  });
});
