import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { ApiClientError } from '@/lib/api-client';
import * as api from '@/lib/api';
import es from '../../../../../../messages/es.json';
import { WishlistMailActionPage } from './WishlistMailActionPage';

/**
 * §WSH-UX.6 · la página del enlace del correo (`/{locale}/lista-de-deseos/aviso?a=&id=&t=`). WSH-F3 / WSH-F9 (versión
 * unitaria) y el candado WSH-UX-7: montar NO llama; el clic sí, con lo que traía la URL; el token sale de la barra.
 * ⭐ v1.87.1 (Q-WSH-UX-5): la página no consulta el dial — no hay ninguna llamada a `getWishlist`.
 */

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/lista-de-deseos/aviso',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const M = es.wishlist.mailAction;

function at(search: string) {
  window.history.replaceState(null, '', `/es/lista-de-deseos/aviso${search}`);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('WSH-UX-7 · un clic, nunca al cargar', () => {
  it('montar no llama; la URL pierde `t=`; el clic manda {action,id,token} de la URL', async () => {
    at('?a=remove&id=w-1&t=tok-123');
    const post = vi.spyOn(api, 'postWishlistMailAction').mockResolvedValue({ result: 'removed' });
    const getList = vi.spyOn(api, 'getWishlist');
    renderWithProviders(<WishlistMailActionPage />, 'es');
    const btn = await screen.findByRole('button', { name: M.removeCta });
    expect(screen.getByRole('heading', { level: 1, name: M.removeTitle })).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(post).not.toHaveBeenCalled();
    expect(window.location.search).not.toContain('t=');
    expect(window.location.search).not.toContain('tok-123');
    fireEvent.click(btn);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith({ action: 'remove', id: 'w-1', token: 'tok-123' });
    expect(await screen.findByText(M.removed)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: M.removeCta })).toBeNull();
    expect(screen.getByRole('link', { name: M.goToList })).toHaveAttribute('href', '/account/wishlist');
    expect(getList).not.toHaveBeenCalled();
  });

  it('pause ⇒ «ya no te mandaremos» + cómo reanudar', async () => {
    at('?a=pause&id=mail-1&t=tok');
    vi.spyOn(api, 'postWishlistMailAction').mockResolvedValue({ result: 'paused' });
    renderWithProviders(<WishlistMailActionPage />, 'es');
    expect(screen.getByRole('heading', { level: 1, name: M.pauseTitle })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: M.pauseCta }));
    expect(await screen.findByText(M.paused)).toBeInTheDocument();
    expect(screen.getByText(M.pausedHint)).toBeInTheDocument();
  });

  it.each([
    ['remove', M.alreadyRemoved],
    ['pause', M.alreadyPaused],
  ])('already_done (%s) ⇒ su texto', async (a, text) => {
    at(`?a=${a}&id=x&t=tok`);
    vi.spyOn(api, 'postWishlistMailAction').mockResolvedValue({ result: 'already_done' });
    renderWithProviders(<WishlistMailActionPage />, 'es');
    fireEvent.click(await screen.findByRole('button'));
    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it.each(['?a=borrar&id=x&t=tok', '?a=remove&t=tok', '?a=remove&id=x', ''])(
    'parámetros incompletos o `a` desconocida (%s) ⇒ «Este enlace no funciona.» sin botón ni llamada',
    async (search) => {
      at(search);
      const post = vi.spyOn(api, 'postWishlistMailAction');
      renderWithProviders(<WishlistMailActionPage />, 'es');
      expect(await screen.findByText(M.invalid)).toBeInTheDocument();
      expect(screen.queryByRole('button')).toBeNull();
      expect(post).not.toHaveBeenCalled();
    },
  );

  it('`404 WISHLIST_LINK_INVALID` ⇒ «Este enlace no funciona.» (no dice por qué)', async () => {
    at('?a=remove&id=x&t=mal');
    vi.spyOn(api, 'postWishlistMailAction').mockRejectedValue(
      new ApiClientError(404, { code: 'WISHLIST_LINK_INVALID', message: 'token mismatch for id x' }),
    );
    renderWithProviders(<WishlistMailActionPage />, 'es');
    fireEvent.click(await screen.findByRole('button', { name: M.removeCta }));
    expect(await screen.findByText(M.invalid)).toBeInTheDocument();
    expect(screen.getByText(M.invalidHint)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('token mismatch');
  });

  it('`429` ⇒ «Demasiados intentos…»; red/5xx ⇒ error y el botón sigue', async () => {
    at('?a=remove&id=x&t=tok');
    const post = vi
      .spyOn(api, 'postWishlistMailAction')
      .mockRejectedValueOnce(new ApiClientError(429, { code: 'RATE_LIMITED', message: 'slow' }))
      .mockRejectedValueOnce(new ApiClientError(500, { code: 'INTERNAL', message: 'boom' }));
    renderWithProviders(<WishlistMailActionPage />, 'es');
    fireEvent.click(await screen.findByRole('button', { name: M.removeCta }));
    expect(await screen.findByText(M.rateLimited)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: M.removeCta }));
    expect(await screen.findByText(M.error)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: M.removeCta })).toBeEnabled();
    expect(post).toHaveBeenCalledTimes(2);
  });
});
