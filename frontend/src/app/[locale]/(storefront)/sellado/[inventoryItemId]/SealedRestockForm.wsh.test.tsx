import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { setStoredUser } from '@/lib/session';
import { ApiClientError } from '@/lib/api-client';
import * as api from '@/lib/api';
import es from '../../../../../../messages/es.json';
import { SealedRestockForm } from './SealedRestockForm';

/**
 * §WSH-UX.8 (a) · «Avísame cuando vuelva» con el armado de §WSH.7. Candado WSH-UX-13: con sesión el servidor ignora
 * `dto.email` (§WSH.7 b) ⇒ ⛔ sin campo de correo y con «Te avisaremos a {email}». El texto ya no promete «en cuanto
 * vuelva»: solo avisa si se agota y vuelve.
 */
const R = es.sealed.restock;

beforeEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('WSH-UX-13 · formulario de reposición con sesión', () => {
  it('sin `input[type=email]`, con «Te avisaremos a {email}» y el botón habilitado', async () => {
    setStoredUser({
      id: 'u-1',
      email: 'ana@correo.mx',
      name: 'Ana',
      role: 'customer',
      locale: 'es',
      authProvider: 'local',
      emailVerified: true,
    });
    const sub = vi.spyOn(api, 'subscribeSealedRestock').mockResolvedValue({ subscribed: true });
    const { container } = renderWithProviders(<SealedRestockForm inventoryItemId="inv-1" />, 'es');
    expect(await screen.findByText('Te avisaremos a ana@correo.mx.')).toBeInTheDocument();
    expect(container.querySelector('input[type="email"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: R.cta }));
    await waitFor(() => expect(sub).toHaveBeenCalledTimes(1));
    // errata v1.87.3 (B-1): cuerpo exacto de dos claves; con sesión va el correo de la cuenta.
    expect(sub.mock.calls[0][0]).toEqual({ email: 'ana@correo.mx', inventoryItemId: 'inv-1' });
    expect(Object.keys(sub.mock.calls[0][0]).sort()).toEqual(['email', 'inventoryItemId']);
    expect(await screen.findByText(R.confirmed)).toBeInTheDocument();
  });

  it('sin sesión: el campo de correo sigue', async () => {
    const { container } = renderWithProviders(<SealedRestockForm inventoryItemId="inv-1" />, 'es');
    await screen.findByText(R.title);
    expect(container.querySelector('input[type="email"]')).not.toBeNull();
  });

  it('el texto cuenta el armado (solo si se agota y vuelve), no «en cuanto vuelva»', async () => {
    renderWithProviders(<SealedRestockForm inventoryItemId="inv-1" />, 'es');
    expect(await screen.findByText(R.body)).toBeInTheDocument();
    expect(R.body).toContain('Si se agota');
  });

  it('`429` ⇒ «Demasiados intentos…»', async () => {
    vi.spyOn(api, 'subscribeSealedRestock').mockRejectedValue(
      new ApiClientError(429, { code: 'RATE_LIMITED', message: 'slow' }),
    );
    renderWithProviders(<SealedRestockForm inventoryItemId="inv-1" />, 'es');
    fireEvent.change(await screen.findByLabelText(R.emailLabel), { target: { value: 'yo@ejemplo.com' } });
    fireEvent.click(screen.getByRole('button', { name: R.cta }));
    expect(await screen.findByText(R.rateLimited)).toBeInTheDocument();
  });
});
