import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { setStoredUser } from '@/lib/session';
import { VaultView } from './VaultView';
import { WITHDRAWAL_REQUESTED_KEY } from './vaultTabs';

// `?tab=` lo decide cada test (vi.hoisted: la fábrica de vi.mock se iza al top del módulo).
const { search } = vi.hoisted(() => ({ search: { tab: null as string | null } }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: (k: string) => (k === 'tab' ? search.tab : null) }),
}));

beforeEach(() => {
  vi.restoreAllMocks();
  search.tab = null;
  window.sessionStorage.clear();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/es/vault');
});

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

/** Orden de los nombres de carta (cada card pinta el nombre en un <p lang="en">). */
function cardNames(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('p[lang="en"]')).map((e) => e.textContent ?? '');
}

describe('VaultView · orden de holdings', () => {
  it('orden por defecto respeta el orden del backend', async () => {
    const { container } = renderWithProviders(<VaultView />, 'es');
    await screen.findByText('Blastoise');
    expect(cardNames(container)).toEqual([
      'Blastoise',
      'Latias ex',
      'Surging Sparks Booster Box',
      'Zapdos',
    ]);
  });

  it('ordena por valor descendente (pendientes al final)', async () => {
    const { container } = renderWithProviders(<VaultView />, 'es');
    await screen.findByText('Blastoise');

    const select = screen.getByLabelText('Ordenar por') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'value_desc' } });

    // Latias 950000 > Booster Box 320000 > Blastoise 128000 > Zapdos (precio pendiente → al final)
    expect(cardNames(container)).toEqual([
      'Latias ex',
      'Surging Sparks Booster Box',
      'Blastoise',
      'Zapdos',
    ]);
  });

  it('ordena por valor ascendente (pendientes al final)', async () => {
    const { container } = renderWithProviders(<VaultView />, 'es');
    await screen.findByText('Blastoise');

    const select = screen.getByLabelText('Ordenar por') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'value_asc' } });

    expect(cardNames(container)).toEqual([
      'Blastoise',
      'Surging Sparks Booster Box',
      'Latias ex',
      'Zapdos', // pendiente siempre al final, aun en asc
    ]);
  });

  it('ordena por set (nombre de set, desempate por nombre de carta)', async () => {
    const { container } = renderWithProviders(<VaultView />, 'es');
    await screen.findByText('Blastoise');

    const select = screen.getByLabelText('Ordenar por') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'set' } });

    // Base Set (Blastoise, Zapdos) antes de Surging Sparks (Latias ex, Booster Box)
    expect(cardNames(container)).toEqual([
      'Blastoise',
      'Zapdos',
      'Latias ex',
      'Surging Sparks Booster Box',
    ]);
  });
});

describe('VaultView · pestaña Master set (v1.20, vista (iii))', () => {
  it('la pestaña "Master set" muestra el índice de MI bóveda (solo sets con piezas propias)', async () => {
    renderWithProviders(<VaultView />, 'es');
    await screen.findByText('Blastoise');

    fireEvent.click(screen.getByRole('tab', { name: 'Master set' }));

    // Índice del scope user_vault: base1 y sv08 tienen piezas del usuario; swsh1 no aparece.
    expect(await screen.findByRole('button', { name: /Base Set/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Surging Sparks/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Sword & Shield/ })).toBeNull();
    // El contador «X/Y» cuenta VARIANTES, no cartas.
    expect(screen.getAllByText(/variantes ·/).length).toBeGreaterThan(0);
  });
});

/**
 * §33.4 (Stream A): cuarta pestaña «Retiros», direccionable por URL (`/vault?tab=retiros`), con
 * foco en el `role="tab"` activo al montar así, teclado WAI-ARIA (← → Home End) y el aviso de
 * aterrizaje «Retiro solicitado» que deja /shipments al pagar.
 */
describe('VaultView · pestaña «Retiros» (§33.4)', () => {
  it('cuatro pestañas con role=tab; el CTA de cabecera dice «Solicitar retiro» → /shipments', async () => {
    renderWithProviders(<VaultView />, 'es');
    await screen.findByText('Blastoise');
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Piezas', 'Master set', 'Sellado', 'Retiros']);
    expect(screen.getByRole('tab', { name: 'Piezas' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('link', { name: 'Solicitar retiro' })).toHaveAttribute('href', '/shipments');
    // El «Retirar» por pieza no cambia (§33.4).
    expect(screen.getAllByRole('link', { name: 'Retirar' }).length).toBeGreaterThan(0);
  });

  it('con ?tab=retiros arranca en «Retiros», con el foco en esa pestaña, y monta la lista de retiros', async () => {
    search.tab = 'retiros';
    window.history.replaceState(null, '', '/es/vault?tab=retiros');
    renderWithProviders(<VaultView />, 'es');

    const tab = screen.getByRole('tab', { name: 'Retiros' });
    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(document.activeElement).toBe(tab);
    expect(await screen.findByRole('heading', { name: 'Mis retiros' })).toBeInTheDocument();
    expect(screen.queryByText('Valor del portafolio')).not.toBeInTheDocument();
  });

  it('clic en «Retiros» refleja ?tab=retiros en la URL y volver a «Piezas» lo quita', async () => {
    renderWithProviders(<VaultView />, 'es');
    await screen.findByText('Blastoise');

    fireEvent.click(screen.getByRole('tab', { name: 'Retiros' }));
    expect(window.location.search).toBe('?tab=retiros');
    expect(await screen.findByRole('heading', { name: 'Mis retiros' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Piezas' }));
    expect(window.location.search).toBe('');
  });

  it('teclado: tabindex itinerante y flechas/Home/End mueven la selección y el foco', async () => {
    renderWithProviders(<VaultView />, 'es');
    await screen.findByText('Blastoise');
    const pieces = screen.getByRole('tab', { name: 'Piezas' });
    const master = screen.getByRole('tab', { name: 'Master set' });
    const withdrawals = screen.getByRole('tab', { name: 'Retiros' });
    expect(pieces).toHaveAttribute('tabindex', '0');
    expect(master).toHaveAttribute('tabindex', '-1');

    pieces.focus();
    fireEvent.keyDown(pieces, { key: 'ArrowRight' });
    expect(master).toHaveAttribute('aria-selected', 'true');
    expect(document.activeElement).toBe(master);

    fireEvent.keyDown(master, { key: 'End' });
    expect(withdrawals).toHaveAttribute('aria-selected', 'true');
    expect(document.activeElement).toBe(withdrawals);
    expect(withdrawals).toHaveAttribute('tabindex', '0');

    fireEvent.keyDown(withdrawals, { key: 'ArrowRight' });
    expect(pieces).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(pieces, { key: 'ArrowLeft' });
    expect(withdrawals).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(withdrawals, { key: 'Home' });
    expect(pieces).toHaveAttribute('aria-selected', 'true');
  });

  it('tras pagar un retiro (marca de sessionStorage) pinta «Retiro solicitado» UNA vez', async () => {
    search.tab = 'retiros';
    window.sessionStorage.setItem(WITHDRAWAL_REQUESTED_KEY, '1');
    renderWithProviders(<VaultView />, 'es');

    expect(await screen.findByRole('status')).toHaveTextContent('Retiro solicitado. Aquí verás su avance.');
    expect(window.sessionStorage.getItem(WITHDRAWAL_REQUESTED_KEY)).toBeNull();
  });

  it('el aviso de reclamables se pinta entre la cabecera y las pestañas SOLO cuando hay pedidos', async () => {
    setStoredUser({ id: 'u-777', email: 'ash@example.com', name: 'Ash', role: 'customer', locale: 'es', emailVerified: true });
    vi.spyOn(api, 'getClaimableOrders').mockResolvedValue([
      { orderId: 'ord-g-1', orderNumber: 'TCG-000777', status: 'settled', totalCents: 168520, itemCount: 1, createdAt: '2026-08-10T18:20:00Z' },
    ]);
    renderWithProviders(<VaultView />, 'es');
    const notice = await screen.findByTestId('claimable-orders-notice');
    // Orden en el DOM: h1 → aviso → tablist.
    const h1 = screen.getByRole('heading', { level: 1 });
    const tablist = screen.getByRole('tablist');
    expect(h1.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(notice.compareDocumentPosition(tablist) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await waitFor(() => expect(screen.getByText('TCG-000777')).toBeInTheDocument());
  });
});
