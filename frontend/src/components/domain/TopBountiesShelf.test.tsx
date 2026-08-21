import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { TopBountiesShelf } from './TopBountiesShelf';
import * as api from '@/lib/api';
import type { PublicBountyDTO } from '@/types/contract';

beforeEach(() => {
  vi.restoreAllMocks();
});

const BOUNTY: PublicBountyDTO = {
  cardId: 'card_abc',
  name: 'Pikachu ex',
  number: '104',
  setName: 'Surging Sparks',
  imageSmallUrl: 'https://img.example/104.png',
  rarity: 'Special Illustration Rare',
  finish: 'holofoil',
  bountyPriceCents: 250_000,
  targetQty: 3,
  remainingQty: 2,
};

describe('TopBountiesShelf (P-22, §16.7c) · vitrina pública de /buylist', () => {
  it('con bounties activos: eyebrow SE BUSCA, precio héroe «Pagamos», QUEDAN N y CTA', async () => {
    vi.spyOn(api, 'getPublicBounties').mockResolvedValue({ data: [BOUNTY] });
    const onQuote = vi.fn();
    renderWithProviders(<TopBountiesShelf onQuote={onQuote} />, 'es');

    // El precio héroe llega con los datos (el encabezado se pinta desde el skeleton).
    expect(await screen.findByText('MX$2,500.00')).toBeInTheDocument();
    expect(screen.getByText('Top Bounties')).toBeInTheDocument();
    expect(screen.getByText('Se busca')).toBeInTheDocument();
    // Mensaje PAY_AFTER_RECEIPT: precio alto no cambia la regla de confianza.
    expect(
      screen.getByText(/El pago se realiza después de recibir y verificar tu carta/),
    ).toBeInTheDocument();
    expect(screen.getByText('Pagamos')).toBeInTheDocument();
    expect(screen.getByText('Quedan 2')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cotizar esta carta' }));
    expect(onQuote).toHaveBeenCalledWith(BOUNTY);
  });

  it('sin objetivo (remainingQty null) NO inventa escasez: no se pinta «Quedan N»', async () => {
    vi.spyOn(api, 'getPublicBounties').mockResolvedValue({
      data: [{ ...BOUNTY, targetQty: null, remainingQty: null }],
    });
    renderWithProviders(<TopBountiesShelf />, 'es');

    await screen.findByText('MX$2,500.00');
    expect(screen.queryByText(/Quedan/)).toBeNull();
  });

  it('sin bounties activos la sección NO se renderiza (nunca un shelf vacío)', async () => {
    const spy = vi.spyOn(api, 'getPublicBounties').mockResolvedValue({ data: [] });
    renderWithProviders(<TopBountiesShelf />, 'es');

    await waitFor(() => expect(spy).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText('Top Bounties')).toBeNull());
  });

  it('en error el shelf se OCULTA (vitrina, no bloquea el flujo de venta)', async () => {
    const spy = vi.spyOn(api, 'getPublicBounties').mockRejectedValue(new Error('boom'));
    renderWithProviders(<TopBountiesShelf />, 'es');

    await waitFor(() => expect(spy).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText('Top Bounties')).toBeNull());
  });
});
