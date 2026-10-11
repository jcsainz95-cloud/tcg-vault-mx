import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/render';
import { photo } from '@/test/accessories.testkit';
import type { DeckEnergyBundleDTO, MetaDeckGroupsDTO, MetaDeckLineDTO } from '@/types/contract';

/**
 * AC-F6 / AC-UX-7 (`API_CONTRACT §AC.8`, `DESIGN_SYSTEM §AC-UX.8`): energías ligadas por línea y el recuadro
 * del paquete. «Agregar de jalón» agrega exactamente lo de hoy y ⛔ nunca el paquete; el botón del paquete
 * va apagado hasta que todas las piezas del jalón están en el carrito; nada viene marcado.
 */
const { session } = vi.hoisted(() => ({
  session: { current: { user: null as null | { id: string }, isAuthenticated: false, ready: true } },
}));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('@/lib/session', async (orig) => ({
  ...(await orig<typeof import('@/lib/session')>()),
  useSession: () => session.current,
}));

import { DeckAvailability } from './DeckAvailability';

const fireLine: MetaDeckLineDTO = {
  rawName: 'Basic Fire Energy',
  setCode: '',
  number: '',
  quantity: 8,
  group: 'energy',
  matchStatus: 'unmatched_basic_energy',
  card: null,
  availableQty: 0,
  unitPriceMxnCents: null,
  unitInventoryItemIds: [],
  basicEnergy: { energyType: 'fire', accessoryId: 'acc-fire', unitPriceCents: 500, soldOut: false, photo: photo('acc-fire') },
};
const waterLine: MetaDeckLineDTO = { ...fireLine, rawName: 'Basic Water Energy', quantity: 4, basicEnergy: null };

const groups: MetaDeckGroupsDTO = {
  pokemon: [
    {
      rawName: 'Dragapult ex',
      setCode: 'TWM',
      number: '130',
      quantity: 2,
      group: 'pokemon',
      matchStatus: 'matched',
      card: { cardId: 'c1', name: 'Dragapult ex', imageUrl: 'https://img/x.png' },
      availableQty: 2,
      unitPriceMxnCents: 61500,
      unitInventoryItemIds: ['inv-a', 'inv-b'],
    },
  ],
  trainer: [],
  energy: [fireLine, waterLine],
};

const offered: DeckEnergyBundleDTO = {
  offered: true,
  reason: null,
  priceCents: 2000,
  looseTotalCents: 6000,
  energies: [
    { energyType: 'fire', quantity: 8, accessoryId: 'acc-fire' },
    { energyType: 'water', quantity: 4, accessoryId: 'acc-water' },
  ],
  pullToken: 'pull-token-1',
};

function render(energyBundle?: DeckEnergyBundleDTO) {
  return renderWithProviders(
    <DeckAvailability groups={groups} deck={{ slug: 'dragapult-ex', name: 'Dragapult ex' }} energyBundle={energyBundle} />,
    'es',
  );
}
const cart = () => JSON.parse(window.localStorage.getItem('tcg.cart') ?? '{"ids":[],"accessories":[],"deckPulls":[]}');

beforeEach(() => {
  window.localStorage.clear();
  session.current = { user: null, isAuthenticated: false, ready: true };
});

describe('AC-F6 · energías ligadas', () => {
  it('línea con basicEnergy: foto, «Energía Fuego», DISPONIBLE, «c/u» y «Agregar ×8» que suma 8', async () => {
    const user = userEvent.setup();
    render(offered);
    const row = screen.getByTestId('deck-energy-fire');
    expect(within(row).getByText('Energía Fuego')).toBeInTheDocument();
    expect(within(row).getByText('Disponible')).toBeInTheDocument();
    expect(within(row).getByText(/5\.00 c\/u/)).toBeInTheDocument();
    expect(within(row).getByRole('img')).toHaveAttribute('src', photo('acc-fire').thumbUrl);
    await user.click(within(row).getByRole('button', { name: 'Agregar 8 Energía Fuego al carrito' }));
    expect(cart().accessories).toEqual([{ id: 'acc-fire', qty: 8 }]);
  });

  it('línea con basicEnergy: null se pinta como hoy (criterio 734)', () => {
    render(offered);
    expect(screen.queryByTestId('deck-energy-water')).toBeNull();
    expect(screen.getByText('Basic Water Energy')).toBeInTheDocument();
  });
});

describe('AC-UX-7 · el recuadro del paquete', () => {
  it('«Agregar de jalón» mete las piezas de hoy y un deckPull SIN paquete; nada viene marcado', async () => {
    const user = userEvent.setup();
    render(offered);
    const box = screen.getByTestId('deck-energy-bundle');
    expect(within(box).queryByRole('checkbox')).toBeNull();
    expect(within(box).queryByRole('switch')).toBeNull();
    expect(within(box).getByText(/Las 12 energías de este deck por .*20\.00/)).toBeInTheDocument();
    expect(within(box).getByText('Fuego ×8 · Agua ×4')).toBeInTheDocument();
    expect(within(box).getByText(/Sueltas costarían .*60\.00\./)).toBeInTheDocument();

    const addBundle = within(box).getByRole('button', { name: 'Agregar paquete' });
    expect(addBundle).toBeDisabled();
    expect(addBundle).toHaveAccessibleDescription(/Primero agrega el deck con «Agregar de jalón»/);

    await user.click(screen.getByRole('button', { name: /de jalón/i }));
    expect(cart().ids).toEqual(['inv-a', 'inv-b']);
    expect(cart().accessories).toEqual([]);
    expect(cart().deckPulls).toEqual([
      { token: 'pull-token-1', slug: 'dragapult-ex', withEnergyBundle: false, deckName: 'Dragapult ex' },
    ]);

    // Ya con el deck completo, el paquete se puede agregar.
    expect(addBundle).not.toBeDisabled();
    await user.click(addBundle);
    expect(cart().deckPulls[0].withEnergyBundle).toBe(true);
    expect(within(box).getByRole('button', { name: /En el carrito/ })).toBeInTheDocument();
    // Con el paquete, la energía suelta ya no se ofrece encima.
    expect(within(screen.getByTestId('deck-energy-fire')).getByText('Va en tu paquete de energías.')).toBeInTheDocument();

    await user.click(within(box).getByRole('button', { name: 'Quitar paquete' }));
    expect(cart().deckPulls[0].withEnergyBundle).toBe(false);
  });

  it('insufficient_stock ⇒ una línea; not_offered / no_basic_energy ⇒ nada', () => {
    const { unmount } = render({ ...offered, offered: false, reason: 'insufficient_stock' });
    expect(
      screen.getByText('Paquete de energías no disponible: no tenemos todas las que pide este deck. Abajo ves cuáles nos quedan para agregarlas sueltas.'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('deck-energy-bundle')).toBeNull();
    unmount();
    render({ ...offered, offered: false, reason: 'not_offered' });
    expect(screen.queryByTestId('deck-energy-bundle')).toBeNull();
    expect(screen.queryByText(/Paquete de energías/)).toBeNull();
  });

  it('«Pegar lista» (sin energyBundle) no pinta recuadro pero sí las energías ligadas', () => {
    renderWithProviders(<DeckAvailability groups={groups} />, 'es');
    expect(screen.queryByTestId('deck-energy-bundle')).toBeNull();
    expect(screen.getByTestId('deck-energy-fire')).toBeInTheDocument();
  });
});

describe('AC-UX-4 · ficha del deck con sesión', () => {
  it('precios visibles; en vez de los botones, el aviso una vez por bloque', () => {
    session.current = { user: { id: 'u' }, isAuthenticated: true, ready: true };
    render(offered);
    expect(screen.queryByRole('button', { name: /Agregar 8 Energía/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Agregar paquete' })).toBeNull();
    expect(screen.getByText(/5\.00 c\/u/)).toBeInTheDocument();
    expect(
      screen.getAllByText('Los accesorios se compran con envío a domicilio. Pronto también desde tu cuenta.'),
    ).toHaveLength(2);
  });
});
