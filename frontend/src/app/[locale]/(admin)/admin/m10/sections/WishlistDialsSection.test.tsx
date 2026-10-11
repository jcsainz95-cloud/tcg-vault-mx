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
 * §WSH-UX.9 (a)/(b) · grupo «Lista de deseos» de M10 (API_CONTRACT §WSH.2). Candado WSH-UX-14: encender pide
 * confirmación y no hay `PUT` hasta «Sí, encender»; apagar hace `PUT` directo. `PUT` parcial: solo lo tocado.
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
    wishlistEnabled: 'off',
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
  it('pinta los siete diales del grupo, con `id="wishlist"` (ancla de la lista de compra)', async () => {
    vi.spyOn(api, 'getSettings').mockResolvedValue(settings());
    renderWithProviders(<WishlistDialsSection />, 'es');
    const section = await screen.findByTestId('m10-wishlist');
    expect(section).toHaveAttribute('id', 'wishlist');
    await within(section).findByLabelText(D.labels.wishlistEnabled);
    for (const k of Object.keys(D.labels)) {
      expect(within(section).getByLabelText(D.labels[k as keyof typeof D.labels])).toBeInTheDocument();
    }
    expect((within(section).getByLabelText(D.labels.wishlistMaxPerAccount) as HTMLInputElement).value).toBe('20');
  });

  it('WSH-UX-14 · encender abre el diálogo y NO hay PUT hasta «Sí, encender»', async () => {
    vi.spyOn(api, 'getSettings').mockResolvedValue(settings());
    const put = vi.spyOn(api, 'updateSettings').mockResolvedValue(settings({ wishlistEnabled: 'on' }));
    renderWithProviders(<WishlistDialsSection />, 'es');
    const section = await screen.findByTestId('m10-wishlist');
    fireEvent.change(await within(section).findByLabelText(D.labels.wishlistEnabled), { target: { value: 'on' } });
    fireEvent.click(within(section).getByTestId('m10-wishlist-save'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(D.confirm.title)).toBeInTheDocument();
    expect(within(dialog).getByText(D.confirm.body)).toBeInTheDocument();
    expect(put).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: D.confirm.cancel }));
    expect(put).not.toHaveBeenCalled();
    fireEvent.click(within(section).getByTestId('m10-wishlist-save'));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: D.confirm.yes }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put).toHaveBeenCalledWith({ wishlistEnabled: 'on' });
  });

  it('WSH-UX-14 · apagar hace PUT directo, sin diálogo', async () => {
    vi.spyOn(api, 'getSettings').mockResolvedValue(settings({ wishlistEnabled: 'on' }));
    const put = vi.spyOn(api, 'updateSettings').mockResolvedValue(settings());
    renderWithProviders(<WishlistDialsSection />, 'es');
    const section = await screen.findByTestId('m10-wishlist');
    fireEvent.change(await within(section).findByLabelText(D.labels.wishlistEnabled), { target: { value: 'off' } });
    fireEvent.click(within(section).getByTestId('m10-wishlist-save'));
    await waitFor(() => expect(put).toHaveBeenCalledWith({ wishlistEnabled: 'off' }));
    expect(screen.queryByRole('dialog')).toBeNull();
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
