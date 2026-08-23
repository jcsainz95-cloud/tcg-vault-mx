import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { useHomeQuoter, HomeQuoterPanel } from './HomeQuoter';
import * as api from '@/lib/api';
import type { CardDTO } from '@/types/contract';

// HomeQuoter usa <Link> de next-intl (affordance «ver más»); se mockea para aislar la vista.
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn() }),
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

function card(id: string, name: string, number: string): CardDTO {
  return {
    id,
    externalId: `ext-${id}`,
    name,
    number,
    rarity: 'Rare Holo',
    supertype: 'Pokémon',
    subtypes: [],
    setId: 's-1',
    setName: 'Set One',
    imageSmallUrl: `https://img/${id}-s.png`,
    imageLargeUrl: `https://img/${id}-l.png`,
    availableFinishes: ['normal'],
  };
}

/** Arnés: el estado del cotizador está izado; se monta el panel con ese estado. */
function Harness() {
  const state = useHomeQuoter();
  return <HomeQuoterPanel state={state} />;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('HomeQuoter · P-41 pageSize + affordance «ver más»', () => {
  it('la búsqueda del home pide pageSize: 20 (no 5) para surtir todas las variantes de un nombre', async () => {
    const spy = vi
      .spyOn(api, 'searchBuylistCards')
      .mockResolvedValue({ data: [card('c1', 'Tropius', '1')], total: 1, page: 1, pageSize: 20 });
    renderWithProviders(<Harness />, 'es');

    fireEvent.change(screen.getByLabelText('Busca una carta para cotizar'), {
      target: { value: 'Tropius' },
    });

    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ q: 'Tropius', pageSize: 20 }));
  });

  it('con resultados, ofrece el affordance «ver más» que lleva al cotizador completo (/buylist)', async () => {
    vi.spyOn(api, 'searchBuylistCards').mockResolvedValue({
      data: [card('c1', 'Tropius', '1'), card('c2', 'Tropius', '2')],
      total: 2,
      page: 1,
      pageSize: 20,
    });
    renderWithProviders(<Harness />, 'es');

    fireEvent.change(screen.getByLabelText('Busca una carta para cotizar'), {
      target: { value: 'Tropius' },
    });

    const more = await screen.findByRole('link', { name: 'Ver más en el cotizador' });
    expect(more).toHaveAttribute('href', '/buylist');
  });
});
