import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { DeckDetailView } from './DeckDetailView';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import type { DeckMetaDetailResponse, MetaDeckLineDTO } from '@/types/contract';

// El CTA «En el carrito» navega con el router de next-intl; se mockea para espiarlo (igual que CardDetailView.test).
const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push }),
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

function line(over: Partial<MetaDeckLineDTO> & Pick<MetaDeckLineDTO, 'rawName' | 'group'>): MetaDeckLineDTO {
  return {
    setCode: 'TWM',
    number: '130',
    quantity: 1,
    matchStatus: 'matched',
    card: { cardId: `c-${over.rawName}`, name: over.rawName, imageUrl: 'https://img/x.png' },
    availableQty: 1,
    unitPriceMxnCents: 61500,
    unitInventoryItemIds: ['inv-1'],
    ...over,
  };
}

// SUP-LEG (trust-source): ya NO hay legalidad. Una línea es DISPONIBLE (casada+stock), «no la
// tenemos» (casada sin stock) o «no identificada» (matchStatus≠matched). No existe «rotada».
const availableLine = line({ rawName: 'Dragapult ex', group: 'pokemon', unitInventoryItemIds: ['inv-legal-1', 'inv-legal-2'], quantity: 2, availableQty: 2 });
const soldOutLine = line({
  rawName: 'Drakloak',
  group: 'pokemon',
  number: '129',
  quantity: 2,
  availableQty: 0,
  unitPriceMxnCents: null,
  unitInventoryItemIds: [],
  substitute: {
    cardId: 'c-drakloak-svi',
    name: 'Drakloak',
    setCode: 'SVI',
    number: '99',
    availableQty: 1,
    unitPriceMxnCents: 4200,
    unitInventoryItemIds: ['inv-sub-1'],
  },
});
const unidentifiedLine: MetaDeckLineDTO = {
  rawName: 'Iono',
  setCode: 'ZZZ',
  number: '999',
  quantity: 3,
  group: 'trainer',
  matchStatus: 'unmatched_set',
  card: null,
  availableQty: 0,
  unitPriceMxnCents: null,
  unitInventoryItemIds: [],
};
const basicEnergyLine: MetaDeckLineDTO = {
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
};

function detail(over: Partial<DeckMetaDetailResponse> = {}): DeckMetaDetailResponse {
  return {
    slug: 'dragapult-ex',
    name: 'Dragapult ex',
    rank: 1,
    sharePct: 12.4,
    source: 'Datos de Limitless TCG',
    groups: {
      pokemon: [{ ...availableLine, group: 'pokemon' }, { ...soldOutLine, group: 'pokemon' }],
      trainer: [unidentifiedLine],
      energy: [basicEnergyLine],
    },
    ...over,
  };
}

function mockDetail(d: DeckMetaDetailResponse) {
  vi.spyOn(api, 'getDeckMeta').mockResolvedValue(d);
}

beforeEach(() => {
  vi.restoreAllMocks();
  push.mockClear();
  window.localStorage.clear();
});

describe('DeckDetailView · disponibilidad (disponible vs no la tenemos vs no identificada)', () => {
  it('NO pinta ningún sello de legalidad (SUP-LEG: se confía en la fuente)', async () => {
    mockDetail(detail());
    renderWithProviders(<DeckDetailView slug="dragapult-ex" />, 'es');
    // Espera a que cargue.
    await screen.findByText('MX$615.00');
    expect(screen.queryByText(/Legal en Standard/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Rotada/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Legal para jugar/)).not.toBeInTheDocument();
  });

  it('la línea casada con stock se ofrece «Disponible» con precio y CTA «Agregar», sin importar marca', async () => {
    mockDetail(detail());
    renderWithProviders(<DeckDetailView slug="dragapult-ex" />, 'es');
    expect((await screen.findAllByText('Disponible')).length).toBeGreaterThan(0);
    expect(screen.getByText('MX$615.00')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Agregar' }).length).toBeGreaterThan(0);
  });

  it('la línea sin stock muestra «No la tenemos» y NO ofrece CTA de compra propio', async () => {
    mockDetail({
      ...detail(),
      groups: { pokemon: [{ ...soldOutLine, substitute: undefined, group: 'pokemon' }], trainer: [], energy: [] },
    });
    renderWithProviders(<DeckDetailView slug="dragapult-ex" />, 'es');
    expect(await screen.findByText('No la tenemos')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Agregar' })).not.toBeInTheDocument();
  });

  it('la línea no identificada muestra «No identificada» y su nota (sin inventar carta/precio)', async () => {
    mockDetail({
      ...detail(),
      groups: { pokemon: [], trainer: [unidentifiedLine], energy: [] },
    });
    renderWithProviders(<DeckDetailView slug="dragapult-ex" />, 'es');
    expect(await screen.findByText('No identificada')).toBeInTheDocument();
    expect(screen.getByText(/No encontramos esta carta/)).toBeInTheDocument();
  });

  it('la energía básica se marca «Energía básica» sin inventar pieza', async () => {
    mockDetail({
      ...detail(),
      groups: { pokemon: [], trainer: [], energy: [basicEnergyLine] },
    });
    renderWithProviders(<DeckDetailView slug="dragapult-ex" />, 'es');
    expect(await screen.findByText('Energía básica')).toBeInTheDocument();
  });
});

describe('DeckDetailView · «agregar de jalón»', () => {
  it('agrega SOLO las piezas disponibles al carrito (ni sin stock, ni no identificada, ni sustituto)', async () => {
    mockDetail(detail());
    renderWithProviders(<DeckDetailView slug="dragapult-ex" />, 'es');

    const addAll = await screen.findByRole('button', { name: 'Agregar de jalón' });
    fireEvent.click(addAll);

    // Solo las dos piezas de la única línea casada-con-stock; el sustituto NO entra (opt-in).
    expect(JSON.parse(window.localStorage.getItem('tcg.cart')!).ids).toEqual(['inv-legal-1', 'inv-legal-2']);
    expect(screen.getByRole('status')).toHaveTextContent('Agregado al carrito');
  });

  it('sin nada disponible, el botón «de jalón» se deshabilita y muestra el conteo cero', async () => {
    mockDetail({
      ...detail(),
      groups: { pokemon: [{ ...soldOutLine, substitute: undefined, group: 'pokemon' }], trainer: [unidentifiedLine], energy: [] },
    });
    renderWithProviders(<DeckDetailView slug="dragapult-ex" />, 'es');
    const addAll = await screen.findByRole('button', { name: 'Agregar de jalón' });
    expect(addAll).toBeDisabled();
    expect(screen.getByText('Nada disponible para agregar')).toBeInTheDocument();
  });

  it('la CTA por línea agrega una pieza y, al completar el stock, cambia a «En el carrito» (→ /checkout)', async () => {
    mockDetail({
      ...detail(),
      groups: { pokemon: [{ ...line({ rawName: 'Dragapult ex', group: 'pokemon', quantity: 1, availableQty: 1, unitInventoryItemIds: ['inv-1'] }), group: 'pokemon' }], trainer: [], energy: [] },
    });
    renderWithProviders(<DeckDetailView slug="dragapult-ex" />, 'es');

    fireEvent.click(await screen.findByRole('button', { name: 'Agregar' }));
    const inCart = await screen.findByRole('button', { name: 'En el carrito' });
    expect(JSON.parse(window.localStorage.getItem('tcg.cart')!).ids).toEqual(['inv-1']);
    fireEvent.click(inCart);
    expect(push).toHaveBeenCalledWith('/checkout');
  });
});

describe('DeckDetailView · estados de carga y error', () => {
  it('404 DECK_NOT_FOUND muestra el error del contrato con reintento', async () => {
    vi.spyOn(api, 'getDeckMeta').mockRejectedValue(
      new ApiClientError(404, { code: 'DECK_NOT_FOUND', message: 'not found' }),
    );
    renderWithProviders(<DeckDetailView slug="fantasma" />, 'es');
    expect(await screen.findByText(/No encontramos ese deck/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });
});
