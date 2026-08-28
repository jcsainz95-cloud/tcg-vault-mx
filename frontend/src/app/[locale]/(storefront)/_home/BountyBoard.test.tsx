import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { BountyBoard } from './BountyBoard';
import * as api from '@/lib/api';
import type { PublicBountyDTO } from '@/types/contract';

// La tarjeta usa <Link> de next-intl; se mockea a un <a> plano para aislar la vista.
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn() }),
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

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

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('BountyBoard (home) · vitrina «Top Bounties» con imagen', () => {
  it('renderiza tarjetas con IMAGEN de la carta, título «Top Bounties» y precio «Pagamos»', async () => {
    vi.spyOn(api, 'getPublicBounties').mockResolvedValue({ data: [BOUNTY] });
    renderWithProviders(<BountyBoard />, 'es');

    // La imagen de la carta se muestra (patrón de tarjeta, no tabla).
    const img = await screen.findByAltText('Pikachu ex');
    expect(img).toHaveAttribute('src', 'https://img.example/104.png');

    expect(screen.getByText('Top Bounties')).toBeInTheDocument();
    expect(screen.getByText('Pagamos')).toBeInTheDocument();
    expect(screen.getByText('MX$2,500.00')).toBeInTheDocument();
    // Ya no es tabla: no debe haber semántica de tabla ni encabezados de columna.
    expect(screen.queryByRole('table')).toBeNull();
    // Cada tarjeta enlaza a la buylist.
    expect(screen.getByRole('link', { name: /Pikachu ex/ })).toHaveAttribute('href', '/buylist');
  });

  it('NUNCA revela la cantidad restante/buscada en la home (no reintroducir remainingQty/targetQty)', async () => {
    vi.spyOn(api, 'getPublicBounties').mockResolvedValue({ data: [BOUNTY] });
    renderWithProviders(<BountyBoard />, 'es');

    await screen.findByText('MX$2,500.00');
    expect(screen.queryByText(/Quedan/)).toBeNull();
    expect(screen.queryByText(/Buscadas/)).toBeNull();
    expect(screen.queryByText(/^2$/)).toBeNull();
    expect(screen.queryByText(/^3$/)).toBeNull();
  });

  it('sin bounties activos la sección NO se renderiza (nunca un shelf vacío)', async () => {
    const spy = vi.spyOn(api, 'getPublicBounties').mockResolvedValue({ data: [] });
    renderWithProviders(<BountyBoard />, 'es');

    await waitFor(() => expect(spy).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText('Top Bounties')).toBeNull());
  });

  it('en error el shelf se OCULTA (vitrina, no bloquea la home)', async () => {
    const spy = vi.spyOn(api, 'getPublicBounties').mockRejectedValue(new Error('boom'));
    renderWithProviders(<BountyBoard />, 'es');

    await waitFor(() => expect(spy).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText('Top Bounties')).toBeNull());
  });
});
