import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import type { MasterSetBinderResponse, MasterSetCardCellDTO, MasterSetSummaryDTO } from '@/types/contract';

vi.mock('@/lib/api', () => ({
  getMasterSetBinder: vi.fn(),
  getAdminVaultMasterSetBinder: vi.fn(),
  getVaultMasterSetBinder: vi.fn(),
  searchBuylistCards: vi.fn(),
  batchQuote: vi.fn(),
  BUYLIST_QUOTE_BATCH_MAX: 50,
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'}>{children}</a>
  ),
}));

import { MasterSetBinder } from './MasterSetBinder';
import { getMasterSetBinder, getVaultMasterSetBinder } from '@/lib/api';

const set: MasterSetSummaryDTO = {
  setId: 'sv08', name: 'Surging Sparks', logoUrl: null, ptcgoCode: null, catalogCardCount: 1,
  distinctCardsOwned: 1, completionPct: 100, totalPieces: 1, catalogVariantCount: 1,
  distinctVariantsOwned: 1, variantCompletionPct: 100,
};
const cell = (id: string, name: string, number: string, covered: boolean): MasterSetCardCellDTO => ({
  cardId: id, number, name, rarity: 'Promo', availableFinishes: ['holofoil'], displayFinishes: ['holofoil'],
  countsByFinish: covered ? [{ finish: 'holofoil', count: 1 }] : [], totalCount: covered ? 1 : 0,
  isSecretRare: false, expectedVariantCount: 1, coveredVariantCount: covered ? 1 : 0,
  variants: [{ finish: 'holofoil', count: covered ? 1 : 0, covered }],
});
const base: MasterSetBinderResponse = {
  set: { id: 'sv08', name: 'Surging Sparks', ptcgoCode: 'SSP' },
  printedTotal: 1, catalogCardCount: 1, cells: [cell('sv08-001', 'Bulbasaur', '001', true)], scope: 'platform',
};

const show = () =>
  renderWithProviders(<MasterSetBinder mode="platform" set={set} onBack={() => {}} onOpenCell={() => {}} />, 'es');

describe('PMS-F3/F4 · apartado «Promos de la colección»', () => {
  beforeEach(() => vi.mocked(getMasterSetBinder).mockReset());

  it('va DESPUÉS del Master Set, con su «x de y» propio; el avance del Master Set no cambia', async () => {
    vi.mocked(getMasterSetBinder).mockResolvedValue({
      ...base,
      collectionPromos: {
        items: [cell('svp-001', 'Pikachu promo', 'SVP 001', true), cell('svp-002', 'Eevee promo', 'SVP 002', false)],
        owned: 1,
        total: 2,
      },
    });
    show();
    const box = await screen.findByTestId('collection-promos');
    expect(within(box).getByRole('heading', { name: 'Promos de la colección' })).toBeInTheDocument();
    expect(within(box).getByTestId('collection-promos-progress').textContent).toBe('1 de 2 promos');
    expect(within(box).getByText(/no cuentan en tu Master Set/)).toBeInTheDocument();
    expect(within(box).getAllByText('Pikachu promo').length).toBeGreaterThan(0);
    // orden en el DOM: Master Set primero, apartado después
    const main = screen.getAllByText('Bulbasaur')[0];
    expect(main.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Master Set intacto: 1/1 variantes · 100 % (las 2 promos no se suman: 1/3 o 2/3 ⇒ rojo)
    expect(screen.getByText('1/1 variantes · 100%')).toBeInTheDocument();
  });

  it('sin sesión (tienda): solo `total` ⇒ «2 promos», sin x de y', async () => {
    vi.mocked(getMasterSetBinder).mockResolvedValue({
      ...base,
      collectionPromos: { items: [cell('svp-001', 'Pikachu promo', 'SVP 001', false)], total: 2 },
    });
    show();
    expect((await screen.findByTestId('collection-promos-progress')).textContent).toBe('2 promos');
  });

  it('ausente o vacío ⇒ no hay apartado', async () => {
    vi.mocked(getMasterSetBinder).mockResolvedValue({ ...base, collectionPromos: { items: [] } });
    show();
    await screen.findAllByText('Bulbasaur');
    expect(screen.queryByTestId('collection-promos')).toBeNull();
  });

  it('EN y bóveda del usuario: mismo apartado', async () => {
    vi.mocked(getVaultMasterSetBinder).mockResolvedValue({
      ...base,
      scope: 'user_vault',
      collectionPromos: { items: [cell('svp-001', 'Pikachu promo', 'SVP 001', true)], owned: 1, total: 1 },
    });
    renderWithProviders(
      <MasterSetBinder mode="user_vault_self" set={set} onBack={() => {}} onOpenCell={() => {}} />,
      'en',
    );
    const box = await screen.findByTestId('collection-promos');
    expect(within(box).getByRole('heading', { name: 'Collection promos' })).toBeInTheDocument();
    expect(within(box).getByTestId('collection-promos-progress').textContent).toBe('1 of 1 promos');
  });

  it('forma MÍNIMA del backend {cardId, number, name, rarity?, imageSmallUrl?} ⇒ sin TypeError; sellos visibles; sin sesión solo «y»', async () => {
    const minimal = [
      { cardId: 'svp-001', number: 'SVP 001', name: 'Pikachu sello', rarity: 'Promo', imageSmallUrl: 'https://img/x.png' },
      { cardId: 'svp-002', number: 'SVP 002', name: 'Eevee sello' },
    ] as unknown as MasterSetCardCellDTO[];
    vi.mocked(getMasterSetBinder).mockResolvedValue({ ...base, collectionPromos: { items: minimal, total: 2 } });
    show();
    const box = await screen.findByTestId('collection-promos');
    expect(within(box).getAllByText('Pikachu sello').length).toBeGreaterThan(0);
    expect(within(box).getAllByText('Eevee sello').length).toBeGreaterThan(0);
    expect(within(box).getByTestId('collection-promos-progress').textContent).toBe('2 promos');
  });
});
