import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { renderWithProviders } from '@/test/render';
import type { ClaimOrdersResponse } from '@/types/contract';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/checkout',
}));

const { claimMock } = vi.hoisted(() => ({ claimMock: vi.fn() }));
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, claimGuestOrders: claimMock };
});
// El registro en sí no es lo que se prueba: el doble llama `onSuccess` como lo haría el alta real.
vi.mock('./InlineAuthPanel', () => ({
  InlineAuthPanel: ({ onSuccess }: { onSuccess: () => void }) => (
    <button type="button" onClick={onSuccess}>
      crear cuenta (doble)
    </button>
  ),
}));

import { GuestOrderConfirmation } from './GuestOrderConfirmation';

/**
 * CLM-F1 (API_CONTRACT §4-G.9c, v1.116): al ganar el reclamo, el servidor copia la dirección del pedido a la libreta y
 * responde `addressesSaved`. Si es > 0, el front invalida `GET /users/me/addresses` (clave `['addresses']`) para que la
 * libreta y el picker del retiro la enseñen sin recargar. Con 0 (o un servidor anterior a v1.116 sin el campo), no.
 */
const res = (addressesSaved?: number): ClaimOrdersResponse =>
  ({ claimed: ['o-1'], failed: [], ...(addressesSaved === undefined ? {} : { addressesSaved }) }) as ClaimOrdersResponse;

const addressInvalidations = (spy: ReturnType<typeof vi.spyOn>) =>
  spy.mock.calls.filter((c: unknown[]) => JSON.stringify((c[0] as { queryKey?: unknown })?.queryKey) === '["addresses"]');

describe('CLM-F1 · confirmación del invitado: reclamo con `addressesSaved`', () => {
  afterEach(() => vi.restoreAllMocks());

  for (const [saved, expected] of [[1, 1], [0, 0], [undefined, 0]] as const) {
    it(`addressesSaved=${String(saved)} ⇒ ${expected} invalidación de ['addresses']`, async () => {
      const spy = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
      claimMock.mockReset();
      claimMock.mockResolvedValue(res(saved));
      renderWithProviders(<GuestOrderConfirmation orderNumber="TCG-1" orderId="o-1" email="juan@dominio.com" />, 'es');
      fireEvent.click(screen.getByRole('button', { name: 'crear cuenta (doble)' }));
      await waitFor(() => expect(claimMock).toHaveBeenCalledWith(['o-1']));
      await screen.findByText(/./, { selector: '.text-success' });
      expect(addressInvalidations(spy)).toHaveLength(expected);
    });
  }
});
