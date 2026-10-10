import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { setStoredUser } from '@/lib/session';
import { ApiClientError } from '@/lib/api-client';
import type { UserDTO, WishlistResponse } from '@/types/contract';
import es from '../../../../messages/es.json';
import { AccountView } from './AccountView';

/**
 * §WSH-UX.3 (a) · resumen «Lista de deseos» en «Mi cuenta» (`#wishlist`, después de `#addresses`, solo `customer`).
 * `404 FEATURE_DISABLED` ⇒ la sección y su entrada del índice NO existen (WSH-5).
 */

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/account',
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const getMe = vi.fn();
const getWishlist = vi.fn();
vi.mock('@/lib/api', () => ({
  getMe: () => getMe(),
  getWishlist: () => getWishlist(),
  updateMe: vi.fn(),
  logout: vi.fn().mockResolvedValue(undefined),
  listAddresses: vi.fn().mockResolvedValue([]),
  createAddress: vi.fn(),
  updateAddress: vi.fn(),
  deleteAddress: vi.fn(),
  getBillingProfile: vi.fn().mockResolvedValue(null),
  putBillingProfile: vi.fn(),
  getKyc: vi.fn().mockResolvedValue({ kycStatus: 'none', clabeOnFile: false, ineOnFile: false }),
  updateKyc: vi.fn(),
  resendVerificationEmail: vi.fn(),
  forgotPassword: vi.fn(),
  changePassword: vi.fn(),
}));

const W = es.wishlist.account;

const customer: UserDTO = {
  id: 'u-1',
  email: 'ana@correo.mx',
  name: 'Ana',
  role: 'customer',
  locale: 'es',
  authProvider: 'local',
  emailVerified: true,
  hasPassword: true,
  mustChangePassword: false,
  nameSource: 'user',
};

function list(over: Partial<WishlistResponse> = {}): WishlistResponse {
  return {
    items: [],
    count: 7,
    limit: 20,
    alertsPaused: false,
    emailVerified: true,
    ivaMode: 'with_iva',
    ivaRatePct: 16,
    ...over,
  };
}

function sectionIds() {
  return Array.from(document.querySelectorAll('section[data-account-section]')).map((s) => s.id);
}

beforeEach(() => {
  window.localStorage.clear();
  getMe.mockReset();
  getWishlist.mockReset();
});

describe('§WSH-UX.3 (a) · resumen de la lista en «Mi cuenta»', () => {
  it('cliente: sección `#wishlist` justo después de `#addresses`, con «{count} de {limit}» y «Ver mi lista»', async () => {
    setStoredUser(customer);
    getMe.mockResolvedValue(customer);
    getWishlist.mockResolvedValue(list());
    renderWithProviders(<AccountView surface="storefront" />, 'es');
    const section = await waitFor(() => {
      const s = document.getElementById('wishlist');
      if (!s) throw new Error('sin sección');
      return s;
    });
    expect(await within(section).findByText('7 de 20 cartas. Te avisamos por correo cuando consigamos alguna.')).toBeInTheDocument();
    expect(within(section).getByRole('link', { name: es.wishlist.seeList })).toHaveAttribute('href', '/account/wishlist');
    const ids = sectionIds();
    expect(ids.indexOf('wishlist')).toBe(ids.indexOf('addresses') + 1);
    expect(screen.getByRole('navigation', { name: es.account.index.label })).toHaveTextContent(W.title);
  });

  it('pausados y vacía tienen su línea', async () => {
    setStoredUser(customer);
    getMe.mockResolvedValue(customer);
    getWishlist.mockResolvedValue(list({ alertsPaused: true, count: 2 }));
    renderWithProviders(<AccountView surface="storefront" />, 'es');
    expect(await screen.findByText('2 de 20 cartas. Los avisos están pausados.')).toBeInTheDocument();
  });

  it('`404 FEATURE_DISABLED` ⇒ ni sección ni entrada del índice', async () => {
    setStoredUser(customer);
    getMe.mockResolvedValue(customer);
    getWishlist.mockRejectedValue(new ApiClientError(404, { code: 'FEATURE_DISABLED', message: 'off' }));
    renderWithProviders(<AccountView surface="storefront" />, 'es');
    await screen.findByRole('heading', { level: 1 });
    await waitFor(() => expect(getWishlist).toHaveBeenCalled());
    await waitFor(() => expect(document.getElementById('wishlist')).toBeNull());
    expect(screen.getByRole('navigation', { name: es.account.index.label })).not.toHaveTextContent(W.title);
  });

  it('staff (Q-WSH-UX-6): ni sección ni consulta', async () => {
    const op = { ...customer, role: 'vault_operator' as const };
    setStoredUser(op);
    getMe.mockResolvedValue(op);
    getWishlist.mockResolvedValue(list());
    renderWithProviders(<AccountView surface="admin" />, 'es');
    await screen.findByRole('heading', { level: 1 });
    expect(document.getElementById('wishlist')).toBeNull();
    expect(getWishlist).not.toHaveBeenCalled();
  });
});
