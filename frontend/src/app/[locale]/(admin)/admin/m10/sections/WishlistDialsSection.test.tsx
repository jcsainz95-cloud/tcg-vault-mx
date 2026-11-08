import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { mockSettings } from '@/lib/mock/fixtures';
import es from '../../../../../../../messages/es.json';
import { WishlistDialsSection } from './WishlistDialsSection';
import type { SettingsDTO } from '@/types/contract';

/**
 * §WSH-UX.9 (a)/(b) · grupo «Lista de deseos» de M10 (API_CONTRACT §WSH.2). Sin interruptor (WSH-ON-F1). `PUT` parcial: solo lo tocado.
 */

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/admin/m10',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const D = es.admin.m10.wishlist;

function settings(over: Partial<SettingsDTO> = {}): SettingsDTO {
  return {
    ...mockSettings,
    wishlistMaxPerAccount: 20,
    wishlistMaxIvaMode: 'with_iva',
    wishlistDailyMailCap: 3,
    wishlistMailWindowMin: 30,
    wishlistTargetMarginPct: 15,
    wishlistMarginBasis: 'cost',
    ...over,
  };
}

beforeEach(() => vi.restoreAllMocks());

describe('§WSH-UX.9 · diales de la lista de deseos', () => {
  it('pinta los seis diales del grupo, con `id="wishlist"` (ancla de la lista de compra)', async () => {
    vi.spyOn(api, 'getSettings').mockResolvedValue(settings());
    renderWithProviders(<WishlistDialsSection />, 'es');
    const section = await screen.findByTestId('m10-wishlist');
    expect(section).toHaveAttribute('id', 'wishlist');
    await within(section).findByLabelText(D.labels.wishlistMaxPerAccount);
    for (const k of Object.keys(D.labels)) {
      expect(within(section).getByLabelText(D.labels[k as keyof typeof D.labels])).toBeInTheDocument();
    }
    expect((within(section).getByLabelText(D.labels.wishlistMaxPerAccount) as HTMLInputElement).value).toBe('20');
  });

  it('PUT parcial: tocar dos diales manda SOLO esos dos, con su tipo', async () => {
    vi.spyOn(api, 'getSettings').mockResolvedValue(settings());
    const put = vi.spyOn(api, 'updateSettings').mockResolvedValue(settings());
    renderWithProviders(<WishlistDialsSection />, 'es');
    const section = await screen.findByTestId('m10-wishlist');
    fireEvent.change(await within(section).findByLabelText(D.labels.wishlistMaxIvaMode), {
      target: { value: 'without_iva' },
    });
    fireEvent.change(within(section).getByLabelText(D.labels.wishlistTargetMarginPct), { target: { value: '20' } });
    fireEvent.click(within(section).getByTestId('m10-wishlist-save'));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put).toHaveBeenCalledWith({ wishlistMaxIvaMode: 'without_iva', wishlistTargetMarginPct: 20 });
  });

  it('`422 VALIDATION_ERROR` por clave ⇒ el campo marcado, sin el texto del servidor', async () => {
    vi.spyOn(api, 'getSettings').mockResolvedValue(settings());
    vi.spyOn(api, 'updateSettings').mockRejectedValue(
      new ApiClientError(422, {
        code: 'VALIDATION_ERROR',
        message: 'wishlist_max_per_account out of range [1,200]',
        details: { errors: { wishlistMaxPerAccount: 'range' } },
      }),
    );
    renderWithProviders(<WishlistDialsSection />, 'es');
    const section = await screen.findByTestId('m10-wishlist');
    fireEvent.change(await within(section).findByLabelText(D.labels.wishlistMaxPerAccount), { target: { value: '999' } });
    fireEvent.click(within(section).getByTestId('m10-wishlist-save'));
    expect(await within(section).findByText(D.checkFields)).toBeInTheDocument();
    expect(within(section).getByText(D.invalid)).toBeInTheDocument();
    expect(section.textContent).not.toContain('out of range');
  });
});
