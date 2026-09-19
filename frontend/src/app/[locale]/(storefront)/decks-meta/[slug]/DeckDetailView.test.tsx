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
    legal: true,
    availableQty: 1,
    unitPriceMxnCents: 61500,
    unitInventoryItemIds: ['inv-1'],
    ...over,
  };
}

const legalLine = line({ rawName: 'Dragapult ex', group: 'pokemon', unitInventoryItemIds: ['inv-legal-1', 'inv-legal-2'], quantity: 2, availableQty: 2 });
const soldOutLine = line({ rawName: 'Drakloak', group: 'pokemon', number: '129', quantity: 2, availableQty: 0, unitPriceMxnCents: null, unitInventoryItemIds: [] });
const rotatedLine: MetaDeckLineDTO = {
  rawName: 'Comfey',
  setCode: 'LOR',
  number: '79',
  quantity: 1,
  group: 'pokemon',
  matchStatus: 'matched',
  card: { cardId: 'c-comfey', name: 'Comfey', imageUrl: 'https://img/c.png' },
  legal: false,
  availableQty: 0,
  unitPriceMxnCents: null,
  unitInventoryItemIds: [],
  substitute: {
    cardId: 'c-comfey-svi',
    name: 'Comfey',
    setCode: 'SVI',
    number: '99',
    availableQty: 1,
    unitPriceMxnCents: 4200,
    unitInventoryItemIds: ['inv-sub-1'],
  },
};
const unidentifiedLine: MetaDeckLineDTO = {
  rawName: 'Iono',
  setCode: 'ZZZ',
  number: '999',
  quantity: 3,
  group: 'trainer',
  matchStatus: 'unmatched_set',
  card: null,
  legal: false,
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
  legal: true,
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
    legalityVerifiedAt: '2026-09-14T12:00:00Z',
    groups: {
      pokemon: [{ ...legalLine, group: 'pokemon' }, { ...soldOutLine, group: 'pokemon' }, rotatedLine],
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

describe('DeckDetailView · legalidad visible (legal vs rotado vs agotado vs no identificada)', () => {
  it('marca la verificación de legalidad en Standard con su fecha', async () => {
    mockDetail(detail());
    renderWithProviders(<DeckDetailView slug="dragapult-ex" />, 'es');
    expect(await screen.findByText(/Legal en Standard · verificado/)).toBeInTheDocument();
  });

  it('la línea legal disponible muestra «Legal para jugar», precio y CTA «Agregar»', async () => {
    mockDetail(detail());
    renderWithProviders(<DeckDetailView slug="dragapult-ex" />, 'es');
    expect((await screen.findAllByText('Legal para jugar')).length).toBeGreaterThan(0);
    expect(screen.getByText('MX$615.00')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Agregar' }).length).toBeGreaterThan(0);
  });

  it('la línea agotada muestra «Agotado» y NO ofrece CTA de compra propio', async () => {
    mockDetail({
      ...detail(),
      groups: { pokemon: [{ ...soldOutLine, group: 'pokemon' }], trainer: [], energy: [] },
    });
    renderWithProviders(<DeckDetailView slug="dragapult-ex" />, 'es');
    expect(await screen.findByText('Agotado')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Agregar' })).not.toBeInTheDocument();
  });

  it('la línea rotada muestra «Rotada · no vigente», su nota y NO puede agregarse a jugar', async () => {
    mockDetail({
      ...detail(),
      groups: { pokemon: [rotatedLine], trainer: [], energy: [] },
    });
    renderWithProviders(<DeckDetailView slug="dragapult-ex" />, 'es');
    expect(await screen.findByText('Rotada · no vigente')).toBeInTheDocument();
    expect(screen.getByText(/no se puede agregar para jugar/)).toBeInTheDocument();
    // Sin CTA de compra propio para la rotada (solo el del sustituto legal).
    expect(screen.queryByRole('button', { name: 'Agregar' })).not.toBeInTheDocument();
    // Pero SÍ ofrece el sustituto legal (Fase 3).
    expect(screen.getByText('Sustituto legal disponible')).toBeInTheDocument();
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

  it('la energía básica se marca «siempre legal» sin inventar pieza', async () => {
    mockDetail({
      ...detail(),
      groups: { pokemon: [], trainer: [], energy: [basicEnergyLine] },
    });
    renderWithProviders(<DeckDetailView slug="dragapult-ex" />, 'es');
    expect(await screen.findByText(/Energía básica · siempre legal/)).toBeInTheDocument();
  });
});

describe('DeckDetailView · «agregar de jalón»', () => {
  it('agrega SOLO las piezas disponibles+legales al carrito (ni rotada, ni agotada, ni no identificada)', async () => {
    mockDetail(detail());
    renderWithProviders(<DeckDetailView slug="dragapult-ex" />, 'es');

    const addAll = await screen.findByRole('button', { name: 'Agregar de jalón' });
    fireEvent.click(addAll);

    // Solo las dos piezas de la única línea legal-con-stock; el sustituto NO entra (opt-in).
    expect(JSON.parse(window.localStorage.getItem('tcg.cart')!).ids).toEqual(['inv-legal-1', 'inv-legal-2']);
    // Confirmación por toast.
    expect(screen.getByRole('status')).toHaveTextContent('Agregado al carrito');
  });

  it('sin nada disponible, el botón «de jalón» se deshabilita y muestra el conteo cero', async () => {
    mockDetail({
      ...detail(),
      groups: { pokemon: [{ ...soldOutLine, group: 'pokemon' }, rotatedLine], trainer: [unidentifiedLine], energy: [] },
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
