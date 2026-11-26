import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import es from '../../messages/es.json';
import en from '../../messages/en.json';
import * as api from '@/lib/api';
import { renderWithProviders } from '@/test/render';
import { QUERY_DEFAULTS } from '@/components/Providers';
import { CARD_SEARCH_MAX } from '@/lib/card-search';
import type { CatalogFacetsDTO } from '@/types/contract';
import { CatalogView } from '@/app/[locale]/(storefront)/catalog/CatalogView';
import { WishlistSearch } from '@/app/[locale]/(storefront)/account/wishlist/WishlistSearch';
import { useHomeQuoter, HomeQuoterPanel } from '@/app/[locale]/(storefront)/_home/HomeQuoter';
import { AddItemModal } from '@/app/[locale]/(admin)/admin/m1/AddItemModal';
import { AddGradedModal } from '@/app/[locale]/(admin)/admin/m1/AddGradedModal';
import { GradedEstimateCaptureSection } from '@/app/[locale]/(admin)/admin/m2/sections/GradedEstimateCaptureSection';

/**
 * §BUSCADOR-CARTAS (pantallas): el servidor busca por nombre, número y código impreso; la pantalla solo ayuda
 * (marcador), dice qué probar sin resultados y topa el campo a 60 caracteres. No duplica la lógica de búsqueda.
 */
vi.mock('@/lib/role', () => ({
  useRole: () => ({ role: 'super_admin', setRole: () => {}, isSuperAdmin: true, canSwitchRole: false }),
}));
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/catalog',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(window.location.search) }));

const PLACEHOLDER_ES = 'Nombre, número o código impreso (PRE 078)';
const NO_RESULTS_ES = 'No encontramos esa carta. Prueba con el nombre, el número (078) o el código impreso (PRE 078).';
const EMPTY = { data: [], page: 1, pageSize: 20, total: 0 };
const FACETS: CatalogFacetsDTO = {
  rarities: [],
  sets: [],
  productTypes: ['raw'],
  sealedSubtypes: [],
  finishes: ['normal'],
  price: { minCents: 0, maxCents: 1000, currency: 'MXN' },
} as unknown as CatalogFacetsDTO;

beforeEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/es/catalog');
});

describe('textos comunes (es/en con paridad)', () => {
  it('las cuatro claves existen en los dos idiomas y citan PRE 078', () => {
    for (const m of [es, en]) {
      const c = m.common.cardSearch;
      expect(c.placeholder).toContain('PRE 078');
      expect(c.tip).toContain('PRE 078');
      expect(c.lead.length).toBeGreaterThan(5);
    }
    expect(es.common.cardSearch.placeholder).toBe(PLACEHOLDER_ES);
    expect(`${es.common.cardSearch.lead} ${es.common.cardSearch.tip}`).toBe(NO_RESULTS_ES);
    expect(CARD_SEARCH_MAX).toBe(60);
  });
});

describe('Catálogo público', () => {
  function wrap() {
    const client = new QueryClient({ defaultOptions: { queries: { ...QUERY_DEFAULTS, retry: false } } });
    return (
      <QueryClientProvider client={client}>
        <NextIntlClientProvider locale="es" messages={es}>
          <CatalogView />
        </NextIntlClientProvider>
      </QueryClientProvider>
    );
  }
  it('marcador nuevo, tope de 60 y, sin resultados CON búsqueda, la ayuda; sin búsqueda, el texto de siempre', async () => {
    vi.spyOn(api, 'getCatalogFacets').mockResolvedValue(FACETS);
    vi.spyOn(api, 'getCatalog').mockResolvedValue(EMPTY);
    render(wrap());
    expect(await screen.findByText(es.catalog.emptyTitle)).toBeInTheDocument();
    const field = screen.getAllByPlaceholderText(PLACEHOLDER_ES)[0] as HTMLInputElement;
    expect(field).toHaveAttribute('maxLength', '60');
    fireEvent.change(field, { target: { value: 'PRE 078' } });
    expect(await screen.findByText('No encontramos esa carta.')).toBeInTheDocument();
    expect(screen.getByText('Prueba con el nombre, el número (078) o el código impreso (PRE 078).')).toBeInTheDocument();
    expect(screen.queryByText(es.catalog.emptyTitle)).toBeNull();
  });
});

describe('Lista de deseos', () => {
  it('marcador, tope y «sin resultados» con ayuda', async () => {
    vi.spyOn(api, 'searchBuylistCards').mockResolvedValue({ data: [], page: 1, pageSize: 8, total: 0 });
    renderWithProviders(<WishlistSearch />, 'es');
    const field = screen.getByPlaceholderText(PLACEHOLDER_ES);
    expect(field).toHaveAttribute('maxLength', '60');
    fireEvent.change(field, { target: { value: 'PRE 078' } });
    expect(await screen.findByText(NO_RESULTS_ES, undefined, { timeout: 2000 })).toBeInTheDocument();
  });
});

describe('Cotizador del inicio', () => {
  it('marcador, tope y «sin resultados» con ayuda (en EN también)', async () => {
    vi.spyOn(api, 'searchBuylistCards').mockResolvedValue({ data: [], page: 1, pageSize: 20, total: 0 });
    function Harness() {
      const state = useHomeQuoter();
      return <HomeQuoterPanel state={state} surface="hero" />;
    }
    renderWithProviders(<Harness />, 'en');
    const field = screen.getByPlaceholderText('Name, number or printed code (PRE 078)');
    expect(field).toHaveAttribute('maxLength', '60');
    fireEvent.change(field, { target: { value: 'PRE 078' } });
    expect(
      await screen.findByText("We couldn't find that card. Try the name, the number (078) or the printed code (PRE 078).", undefined, { timeout: 2000 }),
    ).toBeInTheDocument();
  });
});

describe('Alta M1 (AddItemModal) y alta gradeada', () => {
  it('AddItemModal: marcador, tope y sin resultados; el filtro por set sigue ahí', async () => {
    vi.spyOn(api, 'searchBuylistCards').mockResolvedValue({ data: [], page: 1, pageSize: 50, total: 0 });
    renderWithProviders(<AddItemModal onClose={() => {}} onToast={() => {}} />, 'es');
    const field = await screen.findByPlaceholderText(PLACEHOLDER_ES);
    expect(field).toHaveAttribute('maxLength', '60');
    expect(screen.getByRole('combobox', { name: /set/i })).toBeInTheDocument();
    fireEvent.change(field, { target: { value: 'PRE 078' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(await screen.findByText(NO_RESULTS_ES)).toBeInTheDocument();
  });

  it('AddGradedModal: marcador, tope y «sin resultados» (antes no decía nada)', async () => {
    vi.spyOn(api, 'searchBuylistCards').mockResolvedValue({ data: [], page: 1, pageSize: 20, total: 0 });
    renderWithProviders(<AddGradedModal open onClose={() => {}} />, 'es');
    const field = await screen.findByPlaceholderText(PLACEHOLDER_ES);
    expect(field).toHaveAttribute('maxLength', '60');
    fireEvent.change(field, { target: { value: 'PRE 078' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(await screen.findByTestId('graded-search-empty')).toHaveTextContent(NO_RESULTS_ES);
  });

  it('captura de estimados graduados (M2): marcador, tope y sin resultados', async () => {
    vi.spyOn(api, 'searchBuylistCards').mockResolvedValue({ data: [], page: 1, pageSize: 8, total: 0 });
    renderWithProviders(<GradedEstimateCaptureSection />, 'es');
    const field = await screen.findByPlaceholderText(PLACEHOLDER_ES);
    expect(field).toHaveAttribute('maxLength', '60');
    fireEvent.change(field, { target: { value: 'PRE 078' } });
    await waitFor(() => expect(screen.getByText(NO_RESULTS_ES)).toBeInTheDocument(), { timeout: 3000 });
  });
});
