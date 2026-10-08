import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import es from '../../../../../../messages/es.json';
import { BuyListTab } from './BuyListTab';
import type { WishlistDemandResponse, WishlistDemandRowDTO } from '@/types/contract';

/**
 * §WSH-UX.7 · pestaña «Lista de compra» de Reportes (API_CONTRACT §WSH.8 + v1.87.1). WSH-F4/F8 (versión unitaria) y los
 * candados WSH-UX-8 (sin datos personales), WSH-UX-9 (`null` ≠ 0) y WSH-UX-10 («pierdes» y «−», no solo color).
 */

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/admin/m9',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const B = es.admin.m9.buyList;

function row(over: Partial<WishlistDemandRowDTO> = {}): WishlistDemandRowDTO {
  return {
    cardId: 'c-1',
    cardName: 'Charizard ex',
    setName: 'Obsidian Flames',
    number: '125',
    finish: 'reverse_holo',
    imageSmallUrl: null,
    wantedCount: 3,
    tiers: [
      { maxPct: 16, accounts: 1, maxDisplayCents: 116000, ceilingCents: 86957 },
      { maxPct: 10, accounts: 2, maxDisplayCents: 110000, ceilingCents: 82459 },
    ],
    mainCeilingCents: 86957,
    marketCents: 100000,
    normalPrice: { listCents: 115000, displayCents: 133400 },
    buyersAtNormalPrice: 0,
    marginAtMarket: { cents: 0, pct: 0 },
    buylistTodayCents: 70000,
    ...over,
  };
}

function demand(rows: WishlistDemandRowDTO[], over: Partial<WishlistDemandResponse> = {}): WishlistDemandResponse {
  return {
    generatedAt: '2026-10-07T16:42:00Z',
    dials: { ivaMode: 'with_iva', ivaRatePct: 16, ivaTransferPct: 100, targetMarginPct: 15, marginBasis: 'cost' },
    rows,
    sealed: [{ productName: 'Surging Sparks Booster Box', sealedSubtype: 'box', sealedCondition: 'mint', waitingCount: 4 }],
    ...over,
  };
}

function article(name: string): HTMLElement {
  return screen.getByRole('heading', { level: 3, name }).closest('article') as HTMLElement;
}

beforeEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/es/admin/m9?tab=compra');
});

describe('§WSH-UX.7 · lista de compra (WSH-F4)', () => {
  it('cabecera «Calculado con» sale de `dials`; cifra grande = `mainCeilingCents`; tabla de niveles con <th scope>', async () => {
    vi.spyOn(api, 'getWishlistDemand').mockResolvedValue(
      demand([row()], {
        dials: { ivaMode: 'without_iva', ivaRatePct: 8, ivaTransferPct: 100, targetMarginPct: 20, marginBasis: 'sale' },
      }),
    );
    renderWithProviders(<BuyListTab />, 'es');
    const a = await waitFor(() => article('Charizard ex'));
    expect(
      screen.getByText('Calculado con: margen que buscas 20 % sobre la venta · máximos de los clientes leídos sin IVA · IVA 8 %'),
    ).toBeInTheDocument();
    expect(within(a).getByTestId('demand-ceiling')).toHaveTextContent('MX$869.57');
    expect(within(a).getByText('3 LA BUSCAN')).toBeInTheDocument();
    const table = within(a).getByRole('table');
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      B.tier.level,
      B.tier.accounts,
      B.tier.max,
      B.tier.ceiling,
    ]);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((r) => r.querySelector('th')?.textContent)).toEqual(['16 %', '10 %']);
    expect(within(a).getByText('Tu precio normal MX$1,150.00 sin IVA (MX$1,334.00 con IVA)')).toBeInTheDocument();
    expect(within(a).getByText('Pagan tu precio normal: 0')).toBeInTheDocument();
    expect(within(a).getByText('El buylist pagaría hoy: MX$700.00')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: B.changeDials })).toHaveAttribute('href', '/admin/m10#wishlist');
  });

  it('WSH-UX-8 · el DOM no trae `@`, `userId` ni `wishlistItemId` aunque el DTO los traiga de más', async () => {
    const leaky = {
      ...row(),
      userId: 'u-secreto-1',
      wishlistItemId: 'w-secreto-1',
      email: 'ana@correo.mx',
      accounts: [{ userId: 'u-secreto-2', email: 'beto@correo.mx' }],
    } as unknown as WishlistDemandRowDTO;
    vi.spyOn(api, 'getWishlistDemand').mockResolvedValue(demand([leaky]));
    renderWithProviders(<BuyListTab />, 'es');
    await waitFor(() => article('Charizard ex'));
    const html = document.body.innerHTML;
    expect(html).not.toContain('@');
    expect(html).not.toContain('userId');
    expect(html).not.toContain('wishlistItemId');
    expect(html).not.toContain('secreto');
  });

  it('WSH-UX-9 · `marketCents:null` ⇒ «—» con sr-only y SIN PRECIO DE MERCADO; ningún MX$0.00', async () => {
    vi.spyOn(api, 'getWishlistDemand').mockResolvedValue(
      demand([
        row({
          cardName: 'Sin mercado',
          tiers: [{ maxPct: 10, accounts: 2, maxDisplayCents: null, ceilingCents: null }],
          mainCeilingCents: null,
          marketCents: null,
          normalPrice: null,
          buyersAtNormalPrice: null,
          marginAtMarket: null,
          buylistTodayCents: null,
        }),
      ]),
    );
    renderWithProviders(<BuyListTab />, 'es');
    const a = await waitFor(() => article('Sin mercado'));
    expect(within(a).getByTestId('demand-ceiling')).toHaveTextContent('—');
    const srs = within(a).getAllByText(B.noMarketSr);
    expect(srs.length).toBeGreaterThan(0);
    for (const el of srs) expect(el).toHaveClass('sr-only');
    expect(within(a).getByText(B.noMarket)).toBeInTheDocument();
    expect(a.textContent).not.toContain('MX$0.00');
    expect(a.textContent).not.toMatch(/MX\$0\b/);
    expect(within(a).getByText(B.normalNone)).toBeInTheDocument();
    expect(within(a).getByText(B.buylistNone)).toBeInTheDocument();
  });

  it('WSH-UX-10 · margen negativo ⇒ «pierdes» y «−» en el TEXTO; WSH-F8 · `pct:-9.5` se pinta «−9.5 %» tal cual', async () => {
    vi.spyOn(api, 'getWishlistDemand').mockResolvedValue(
      demand([row({ cardName: 'Pierde', marginAtMarket: { cents: -9483, pct: -9.5 } })]),
    );
    renderWithProviders(<BuyListTab />, 'es');
    const a = await waitFor(() => article('Pierde'));
    const line = within(a).getByText(/Si la pagas a mercado/);
    expect(line.textContent).toBe('Si la pagas a mercado: pierdes MX$94.83 (−9.5 %)');
    expect(line.textContent).not.toContain('950');
    expect(line.textContent).not.toContain('0.095');
  });

  it('margen cero o positivo ⇒ «ganas»', async () => {
    vi.spyOn(api, 'getWishlistDemand').mockResolvedValue(
      demand([row({ cardName: 'Gana', marginAtMarket: { cents: 1234, pct: 1.2 } })]),
    );
    renderWithProviders(<BuyListTab />, 'es');
    const a = await waitFor(() => article('Gana'));
    expect(within(a).getByText('Si la pagas a mercado: ganas MX$12.34 (1.2 %)')).toBeInTheDocument();
  });

  it('orden: «Recomendado» = sin `sort`; un chip manda `sort` y `dir`; la dirección no se muestra con «Recomendado»', async () => {
    const get = vi.spyOn(api, 'getWishlistDemand').mockResolvedValue(demand([row()]));
    renderWithProviders(<BuyListTab />, 'es');
    await waitFor(() => article('Charizard ex'));
    expect(get).toHaveBeenLastCalledWith({});
    expect(screen.queryByRole('button', { name: B.dir.desc })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: B.sort.wanted }));
    await waitFor(() => expect(get).toHaveBeenLastCalledWith({ sort: 'wanted', dir: 'desc' }));
    expect(screen.getByRole('button', { name: B.sort.wanted })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: B.dir.desc }));
    await waitFor(() => expect(get).toHaveBeenLastCalledWith({ sort: 'wanted', dir: 'asc' }));
    expect(window.location.search).toContain('sort=wanted');
    expect(window.location.search).toContain('dir=asc');
  });

  it('`sort` fuera de dominio en la URL se ignora antes de pedir', async () => {
    window.history.replaceState(null, '', '/es/admin/m9?tab=compra&sort=hackeo&dir=lado');
    const get = vi.spyOn(api, 'getWishlistDemand').mockResolvedValue(demand([row()]));
    renderWithProviders(<BuyListTab />, 'es');
    await waitFor(() => article('Charizard ex'));
    expect(get).toHaveBeenCalledWith({});
  });

  it('WSH-F8 · filtrar por texto reduce filas EN PANTALLA; el CSV se pide sin filtro (solo sort/dir)', async () => {
    vi.spyOn(api, 'getWishlistDemand').mockResolvedValue(
      demand([row({ cardId: 'a', cardName: 'Charizard ex' }), row({ cardId: 'b', cardName: 'Pikachu', number: '58' })]),
    );
    const csv = vi
      .spyOn(api, 'exportWishlistDemandCsv')
      .mockResolvedValue({ blob: new Blob(['x']), filename: null });
    const createObjectURL = vi.fn(() => 'blob:x');
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    renderWithProviders(<BuyListTab />, 'es');
    await waitFor(() => article('Charizard ex'));
    fireEvent.change(screen.getByLabelText(B.search), { target: { value: 'pika' } });
    await waitFor(() => expect(screen.queryByRole('heading', { level: 3, name: 'Charizard ex' })).toBeNull());
    expect(screen.getByRole('heading', { level: 3, name: 'Pikachu' })).toBeInTheDocument();
    expect(screen.getByText('Mostrando 1 de 2 cartas. El CSV trae la lista completa.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: B.csv }));
    await waitFor(() => expect(csv).toHaveBeenCalledTimes(1));
    expect(csv).toHaveBeenCalledWith({});
  });

  it('«Ocultar sin mercado» filtra en el navegador', async () => {
    vi.spyOn(api, 'getWishlistDemand').mockResolvedValue(
      demand([row({ cardId: 'a' }), row({ cardId: 'b', cardName: 'Nulo', marketCents: null, mainCeilingCents: null })]),
    );
    renderWithProviders(<BuyListTab />, 'es');
    await waitFor(() => article('Nulo'));
    fireEvent.click(screen.getByLabelText(B.hideNoMarket));
    await waitFor(() => expect(screen.queryByRole('heading', { level: 3, name: 'Nulo' })).toBeNull());
  });

  it('sellados: solo conteo; vacío de filas ⇒ EmptyState', async () => {
    vi.spyOn(api, 'getWishlistDemand').mockResolvedValue(demand([]));
    renderWithProviders(<BuyListTab />, 'es');
    expect(await screen.findByText(B.emptyTitle)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: B.sealedTitle })).toBeInTheDocument();
    expect(screen.getByText('Surging Sparks Booster Box')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });
});
