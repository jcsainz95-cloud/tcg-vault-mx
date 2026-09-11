import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { setStoredUser } from '@/lib/session';
import type { CardDTO, UserDTO } from '@/types/contract';
// ⚠️ El spy HACE DE SERVIDOR: `isTerminal` es **server-derived** (contrato §6 · v1.51). Se
// proyecta con la MISMA función que el mock en vez de escribir el booleano a mano.
import { mockSellRequestDTO as srv } from '@/lib/mock/fixtures';
import { OrdersView } from './OrdersView';

// `?tab=` lo decide cada test (vi.hoisted: la fábrica de vi.mock se iza al top del módulo).
const { search } = vi.hoisted(() => ({ search: { tab: null as string | null } }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: (k: string) => (k === 'tab' ? search.tab : null) }),
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

/** Sesión de cliente verificada (la ruta /orders es privada; el gating lo hace el guard). */
function asVerifiedCustomer(overrides: Partial<UserDTO> = {}) {
  setStoredUser({
    id: 'u-777',
    email: 'ash@example.com',
    name: 'Ash Ketchum',
    role: 'customer',
    locale: 'es',
    emailVerified: true,
    ...overrides,
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
  search.tab = null;
  asVerifiedCustomer();
  // El aviso de reclamables es null con `[]` (§33.9); estos tests no lo ejercitan.
  vi.spyOn(api, 'getClaimableOrders').mockResolvedValue([]);
});

/**
 * §33.3 (Stream A): «Compras y ventas» = UNA página, DOS pestañas que son ENLACES (cambian la URL).
 * No llevan `role="tablist"` (§33.15.9): la activa se marca con `aria-current="page"`.
 */
describe('OrdersView · pestañas-enlace Compras / Ventas', () => {
  it('sin ?tab= la pestaña activa es «Compras» y se pinta la tabla de pedidos', async () => {
    renderWithProviders(<OrdersView />, 'es');

    expect(screen.getByRole('heading', { level: 1, name: 'Compras y ventas' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Compras y ventas' });
    expect(nav.querySelector('[role="tablist"]')).toBeNull();
    const purchases = screen.getByRole('link', { name: 'Compras' });
    const sales = screen.getByRole('link', { name: 'Ventas' });
    expect(purchases).toHaveAttribute('aria-current', 'page');
    expect(purchases).toHaveAttribute('href', '/orders');
    expect(sales).not.toHaveAttribute('aria-current');
    expect(sales).toHaveAttribute('href', '/orders?tab=ventas');

    // La tabla de compras (fixture) y el copy «Pedido», no «Orden».
    expect((await screen.findAllByText('ord-9001')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Pedido').length).toBeGreaterThan(0);
    expect(screen.queryByText('Mis solicitudes')).not.toBeInTheDocument();
  });

  it('con ?tab=ventas la activa es «Ventas» y se monta «Mis solicitudes» (sin consultar pedidos)', async () => {
    search.tab = 'ventas';
    const ordersSpy = vi.spyOn(api, 'getOrders');
    vi.spyOn(api, 'getSellRequests').mockResolvedValue([]);
    renderWithProviders(<OrdersView />, 'es');

    expect(screen.getByRole('link', { name: 'Ventas' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Compras' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('heading', { level: 2, name: 'Mis solicitudes' })).toBeInTheDocument();
    // Vacío de ventas con su CTA («Cotizar mis cartas» → /buylist).
    expect(await screen.findByText('Aún no tienes solicitudes de venta.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Cotizar mis cartas' })).toHaveAttribute('href', '/buylist');
    expect(ordersSpy).not.toHaveBeenCalled();
  });

  it('un ?tab= desconocido cae en «Compras»', () => {
    search.tab = 'loquesea';
    renderWithProviders(<OrdersView />, 'es');
    expect(screen.getByRole('link', { name: 'Compras' })).toHaveAttribute('aria-current', 'page');
  });

  it('vacío de compras: «Aún no tienes compras.» + CTA «Explorar el catálogo» → /catalog', async () => {
    vi.spyOn(api, 'getOrders').mockResolvedValue({ data: [], page: 1, pageSize: 20, total: 0 });
    renderWithProviders(<OrdersView />, 'es');

    expect(await screen.findByText('Aún no tienes compras.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Explorar el catálogo' })).toHaveAttribute('href', '/catalog');
  });
});

/**
 * «Mis solicitudes» se MUDÓ aquí desde /buylist tal cual (§33.3): estos tests venían de
 * `BuylistView.test.tsx` y ahora montan `OrdersView` con `?tab=ventas`.
 */
describe('OrdersView · Ventas = Mis solicitudes', () => {
  beforeEach(() => {
    search.tab = 'ventas';
  });

  it('un item sin precio muestra "Precio pendiente" (no MX$0.00) y una nota explica el total', async () => {
    const card: CardDTO = {
      id: 'c-zapdos',
      externalId: 'base1-16',
      name: 'Zapdos',
      number: '16',
      rarity: 'Rare Holo',
      supertype: 'Pokémon',
      subtypes: [],
      setId: 'base1',
      setName: 'Base Set',
      imageSmallUrl: 'https://images.pokemontcg.io/base1/16.png',
      imageLargeUrl: 'https://images.pokemontcg.io/base1/16_hires.png',
      availableFinishes: ['normal'],
    };
    vi.spyOn(api, 'getSellRequests').mockResolvedValue([
      srv({
        sellRequestId: 'sr-pend-1',
        status: 'cotizada',
        quotedTotalCents: 0,
        ineRequired: false,
        items: [
          {
            id: 'sri-1',
            card,
            productType: 'raw',
            rawCondition: 'NM',
            finish: 'normal',
            rarity: 'Rare Holo',
            itemStatus: 'precio_pendiente',
          },
        ],
        createdAt: '2026-08-17T10:00:00Z',
      }),
    ]);
    renderWithProviders(<OrdersView />, 'es');

    expect(await screen.findByText('sr-pend-1')).toBeInTheDocument();
    expect(screen.getAllByText('Precio pendiente').length).toBeGreaterThan(0);
    expect(
      screen.getByText('El total mostrado no incluye las cartas con precio pendiente.'),
    ).toBeInTheDocument();
  });
});

/**
 * F5 · Responder ajuste de venta. El bloque de aceptar/rechazar aparece SOLO cuando hay ítems
 * `ajustada` (item-level), y "Aceptar" llama a respondSellRequest(id,'accept').
 */
describe('OrdersView · Ventas · responder ajuste (F5)', () => {
  const adjustedCard: CardDTO = {
    id: 'c-charizard',
    externalId: 'base1-4',
    name: 'Charizard',
    number: '4',
    rarity: 'Rare Holo',
    supertype: 'Pokémon',
    subtypes: [],
    setId: 'base1',
    setName: 'Base Set',
    imageSmallUrl: 'https://images.pokemontcg.io/base1/4.png',
    imageLargeUrl: 'https://images.pokemontcg.io/base1/4_hires.png',
    availableFinishes: ['holofoil'],
  };

  beforeEach(() => {
    search.tab = 'ventas';
  });

  function withAdjustedRequest() {
    vi.spyOn(api, 'getSellRequests').mockResolvedValue([
      srv({
        sellRequestId: 'sr-adj-1',
        status: 'verificacion',
        quotedTotalCents: 60000,
        ineRequired: false,
        createdAt: '2026-08-15T10:00:00Z',
        items: [
          {
            id: 'sri-adj-1',
            card: adjustedCard,
            productType: 'raw',
            rawCondition: 'NM',
            finish: 'holofoil',
            rarity: 'Rare Holo',
            quotedPriceCents: 60000,
            approvedPriceCents: 45000,
            itemStatus: 'ajustada',
          },
        ],
      }),
    ]);
  }

  it('el bloque de ajuste aparece solo con ítems `ajustada` y muestra el precio ajustado', async () => {
    withAdjustedRequest();
    renderWithProviders(<OrdersView />, 'es');

    expect(await screen.findByText('sr-adj-1')).toBeInTheDocument();
    expect(screen.getByText('Ajuste de precio propuesto')).toBeInTheDocument();
    expect(screen.getByText('Aceptar ajuste')).toBeInTheDocument();
    expect(screen.getByText('Rechazar')).toBeInTheDocument();
  });

  it('el bloque NO aparece cuando ningún ítem está `ajustada`', async () => {
    vi.spyOn(api, 'getSellRequests').mockResolvedValue([
      srv({
        sellRequestId: 'sr-plain-1',
        status: 'verificacion',
        quotedTotalCents: 50000,
        ineRequired: false,
        createdAt: '2026-08-15T10:00:00Z',
        items: [
          {
            id: 'sri-1',
            card: adjustedCard,
            productType: 'raw',
            rawCondition: 'NM',
            finish: 'holofoil',
            rarity: 'Rare Holo',
            quotedPriceCents: 50000,
            itemStatus: 'verificacion',
          },
        ],
      }),
    ]);
    renderWithProviders(<OrdersView />, 'es');

    expect(await screen.findByText('sr-plain-1')).toBeInTheDocument();
    expect(screen.queryByText('Ajuste de precio propuesto')).not.toBeInTheDocument();
  });

  it('"Aceptar ajuste" llama respondSellRequest(id, "accept")', async () => {
    withAdjustedRequest();
    const spy = vi
      .spyOn(api, 'respondSellRequest')
      .mockResolvedValue({ id: 'sr-adj-1', status: 'aprobada' });
    renderWithProviders(<OrdersView />, 'es');

    fireEvent.click(await screen.findByRole('button', { name: 'Aceptar ajuste' }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('sr-adj-1', 'accept'));
  });
});

/**
 * v1.51 (M-46): la rama de error del stepper del vendedor es «cualquier terminal
 * (server-derived) menos el único terminal FELIZ», y §23.1d: `expirada` se pinta por su MOTIVO.
 * Aquí es donde más importa, porque es la pantalla del propio vendedor: un `no_offer` (no
 * ofertamos NOSOTROS) pintado como `not_shipped` le imputaría un incumplimiento que nunca cometió.
 */
describe('OrdersView · Ventas · los estados nuevos (v1.51 · M-46)', () => {
  const card: CardDTO = {
    id: 'c-exp',
    externalId: 'c-exp',
    name: 'Charizard',
    number: '4',
    rarity: 'Rare Holo',
    supertype: 'Pokémon',
    subtypes: [],
    setId: 'base1',
    setName: 'Base Set',
    imageSmallUrl: '',
    imageLargeUrl: '',
    availableFinishes: ['holofoil'],
  };

  beforeEach(() => {
    search.tab = 'ventas';
  });

  function withExpired(expiredReason: 'no_offer' | 'not_shipped') {
    vi.spyOn(api, 'getSellRequests').mockResolvedValue([
      srv({
        sellRequestId: 'sr-exp-1',
        status: 'expirada',
        expiredReason,
        quotedTotalCents: 60000,
        ineRequired: false,
        createdAt: '2026-08-15T10:00:00Z',
        items: [
          {
            id: 'sri-exp-1',
            card,
            productType: 'raw',
            rawCondition: 'NM',
            finish: 'holofoil',
            rarity: 'Rare Holo',
            quotedPriceCents: 60000,
            itemStatus: 'cotizada',
          },
        ],
      }),
    ]);
  }

  it('una `expirada` por `no_offer` dice «No procedió» y NO acusa al vendedor', async () => {
    withExpired('no_offer');
    renderWithProviders(<OrdersView />, 'es');

    expect(await screen.findByText('sr-exp-1')).toBeInTheDocument();
    const badge = screen.getByText('No procedió');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('text-muted');
    expect(screen.queryByText('Expirada')).not.toBeInTheDocument();
    expect(screen.queryByText('Sin envío')).not.toBeInTheDocument();
  });

  it('una `expirada` por `not_shipped` sí dice «Sin envío» (los dos motivos NO se colapsan)', async () => {
    withExpired('not_shipped');
    renderWithProviders(<OrdersView />, 'es');

    expect(await screen.findByText('sr-exp-1')).toBeInTheDocument();
    expect(screen.getByText('Sin envío')).toBeInTheDocument();
    expect(screen.queryByText('No procedió')).not.toBeInTheDocument();
  });

  it('el pipeline del vendedor tiene los OCHO pasos del contrato, no los cinco viejos', async () => {
    vi.spyOn(api, 'getSellRequests').mockResolvedValue([
      srv({
        sellRequestId: 'sr-tr-1',
        status: 'en_transito',
        quotedTotalCents: 60000,
        ineRequired: false,
        createdAt: '2026-08-15T10:00:00Z',
        items: [],
      }),
    ]);
    renderWithProviders(<OrdersView />, 'es');
    await screen.findByText('sr-tr-1');

    const current = document.querySelector('li[aria-current="step"]');
    expect(current).not.toBeNull();
    expect(current!.textContent).toContain('En tránsito');
    expect(current!.parentElement!.children).toHaveLength(8);
  });
});
