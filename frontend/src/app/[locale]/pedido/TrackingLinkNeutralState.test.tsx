import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/render';
import { ApiClientError } from '@/lib/api-client';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const resend = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, resendGuestTrackingLink: (input: unknown) => resend(input) };
});

import { TrackingLinkNeutralState } from './TrackingLinkNeutralState';

const NEUTRAL_RESULT =
  'Si hay un pedido asociado a ese correo, te enviamos un enlace nuevo. Revisa tu bandeja de entrada y la carpeta de spam.';

describe('TrackingLinkNeutralState · pantalla neutra (criterios 52, 53)', () => {
  beforeEach(() => {
    resend.mockReset();
    resend.mockResolvedValue({ status: 'ACCEPTED' });
  });

  it('usa el copy normativo y no menciona vigencia, pedido ni token (§15.7)', () => {
    renderWithProviders(<TrackingLinkNeutralState />, 'es');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Este enlace ya no funciona');
    for (const forbidden of [/no encontrado/i, /no existe/i, /token/i, /expiró hace/i, /\d+ días/i]) {
      expect(document.body.textContent ?? '').not.toMatch(forbidden);
    }
  });

  it('con token usa la forma { token } del contrato §4-G.4 y pinta el resultado neutro', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TrackingLinkNeutralState token="tok-abc" />, 'es');

    await user.click(screen.getByRole('button', { name: 'Enviarme un enlace nuevo' }));
    expect(await screen.findByText(NEUTRAL_RESULT)).toBeInTheDocument();
    expect(resend).toHaveBeenCalledWith({ token: 'tok-abc' });
  });

  it('sin token exige correo Y número de pedido juntos (email a secas nunca se acepta)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TrackingLinkNeutralState />, 'es');

    await user.type(screen.getByLabelText('Correo con el que compraste'), 'juan@dominio.com');
    await user.click(screen.getByRole('button', { name: 'Enviarme un enlace nuevo' }));
    // Falta el número de pedido: no se llama a la API.
    expect(resend).not.toHaveBeenCalled();
    expect(screen.getByText('Escribe tu número de pedido.')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Número de pedido'), 'TCG-000123');
    await user.click(screen.getByRole('button', { name: 'Enviarme un enlace nuevo' }));
    expect(await screen.findByText(NEUTRAL_RESULT)).toBeInTheDocument();
    expect(resend).toHaveBeenCalledWith({ email: 'juan@dominio.com', orderNumber: 'TCG-000123' });
  });

  it('un 429 muestra EXACTAMENTE el mismo mensaje que un envío correcto (criterio 53)', async () => {
    const user = userEvent.setup();
    resend.mockRejectedValue(new ApiClientError(429, { code: 'RATE_LIMITED', message: 'slow down' }));
    renderWithProviders(<TrackingLinkNeutralState token="tok-abc" />, 'es');

    await user.click(screen.getByRole('button', { name: 'Enviarme un enlace nuevo' }));
    expect(await screen.findByText(NEUTRAL_RESULT)).toBeInTheDocument();
    // Ni rastro del código de error ni de un tratamiento de error.
    expect(document.body.textContent ?? '').not.toMatch(/RATE_LIMITED|Demasiadas/i);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('ofrece el reclamo como alternativa aunque el enlace ya no sirva (PROJECT §J)', () => {
    renderWithProviders(<TrackingLinkNeutralState />, 'es');
    expect(screen.getByRole('link', { name: 'Crear cuenta y guardar este pedido' })).toBeInTheDocument();
  });
});
