import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';

/**
 * v1.113.1⟨portada⟩ (API_CONTRACT §DYN.5.7): el checkout NO cambia — se cobra la fila del precio del día y una fila
 * `pending` responde el MISMO `PRICE_PENDING` de siempre. Este candado solo fija que ese error se le dice al cliente con
 * una frase entendible (no el inglés del servidor ni un «error genérico»). Sin cambio de código: el texto
 * `error.PRICE_PENDING` ya existía.
 */
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/checkout',
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, getGuestCheckoutQuote: vi.fn() };
});

import { getGuestCheckoutQuote } from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { GuestCheckoutView } from './GuestCheckoutView';
import { setCheckoutViewport } from './test-viewport';

setCheckoutViewport('desktop');

describe('checkout · `PRICE_PENDING` (§DYN.5.7, sin cambio de cuerpo)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem('tcg.cart', JSON.stringify({ ids: ['inv-1001'], updatedAt: Date.now() }));
    vi.mocked(getGuestCheckoutQuote).mockReset();
  });

  it('el quote con `422 PRICE_PENDING` muestra la frase del catálogo de errores', async () => {
    vi.mocked(getGuestCheckoutQuote).mockRejectedValue(
      new ApiClientError(422, { code: 'PRICE_PENDING', message: 'Price pending for inv-1001' }),
    );
    renderWithProviders(<GuestCheckoutView onPaid={vi.fn()} onAccountReady={vi.fn()} />, 'es');
    expect(await screen.findByText('Esta carta tiene precio pendiente y aún no se puede comprar.')).toBeInTheDocument();
    expect(screen.queryByText(/Price pending/)).not.toBeInTheDocument();
  });
});
