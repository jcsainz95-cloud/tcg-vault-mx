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

// Copy NORMATIVO de §15.7 (literal). Condiciona sobre "esos datos", nunca sobre el correo:
// no afirma nada sobre la dirección, sobre el pedido ni sobre la relación entre ambos.
const NEUTRAL_RESULT =
  'Si esos datos corresponden a un pedido, enviamos un enlace nuevo a ese correo. Revisa tu bandeja de entrada y la carpeta de spam.';

describe('TrackingLinkNeutralState · pantalla neutra (criterios 52, 53)', () => {
  beforeEach(() => {
    resend.mockReset();
    resend.mockResolvedValue({ status: 'ACCEPTED' });
  });

  it('usa el copy normativo y ninguna frase prohibida de §15.7', () => {
    renderWithProviders(<TrackingLinkNeutralState />, 'es');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Este enlace ya no funciona');
    expect(
      screen.getByText(
        'Por seguridad, los enlaces de seguimiento caducan. Podemos enviarte uno nuevo al correo con el que hiciste la compra.',
      ),
    ).toBeInTheDocument();
    // Lista de frases prohibidas (ampliada en §15.7: también las del número de pedido).
    for (const forbidden of [
      /no encontrado/i,
      /no existe/i,
      /no coinciden/i,
      /incorrecto/i,
      /no está registrado/i,
      /token/i,
      /expiró hace/i,
      /\d+ días/i,
    ]) {
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

  it('vía B: ningún campo por separado habilita el envío; solo correo + pedido juntos', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TrackingLinkNeutralState />, 'es');

    const submit = screen.getByRole('button', { name: 'Enviarme un enlace nuevo' });
    // Vacío → deshabilitado, con la nota de validación LOCAL asociada.
    expect(submit).toBeDisabled();
    expect(screen.getByText('Escribe el correo y el número de pedido para continuar.')).toBeInTheDocument();

    // Solo correo → sigue deshabilitado (el correo a secas nunca se acepta).
    await user.type(screen.getByLabelText('Correo con el que compraste'), 'juan@dominio.com');
    expect(submit).toBeDisabled();
    expect(resend).not.toHaveBeenCalled();

    // Solo número de pedido (sin correo válido) → tampoco.
    await user.clear(screen.getByLabelText('Correo con el que compraste'));
    await user.type(screen.getByLabelText('Número de pedido'), 'TCG-000123');
    expect(submit).toBeDisabled();
    expect(resend).not.toHaveBeenCalled();

    // Los dos juntos → habilitado y se manda el par del contrato §4-G.4.
    await user.type(screen.getByLabelText('Correo con el que compraste'), 'juan@dominio.com');
    expect(submit).toBeEnabled();
    await user.click(submit);
    expect(await screen.findByText(NEUTRAL_RESULT)).toBeInTheDocument();
    expect(resend).toHaveBeenCalledWith({ email: 'juan@dominio.com', orderNumber: 'TCG-000123' });
  });

  it('vía A: con token no se pide ningún campo, y la vía B vive tras un disclosure', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TrackingLinkNeutralState token="tok-abc" />, 'es');

    // Cerrada por defecto: el caso común es llegar con el enlace caducado y bastar el botón.
    expect(screen.queryByLabelText('Correo con el que compraste')).not.toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: 'No tengo el enlace' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls', 'neutral-manual-form');

    await user.click(toggle);
    // Al abrir, el foco va al PRIMER campo (§15.7, accesibilidad).
    const emailField = screen.getByLabelText('Correo con el que compraste');
    expect(emailField).toHaveFocus();
    expect(screen.getByLabelText('Número de pedido')).not.toHaveAttribute('autocomplete', 'email');
    expect(emailField).toHaveAttribute('autocomplete', 'email');
  });

  it('la respuesta de la vía A y la de la vía B son EXACTAMENTE la misma frase', async () => {
    const user = userEvent.setup();
    const { unmount } = renderWithProviders(<TrackingLinkNeutralState token="tok-abc" />, 'es');
    await user.click(screen.getByRole('button', { name: 'Enviarme un enlace nuevo' }));
    const viaA = (await screen.findAllByRole('status'))[0].textContent;
    unmount();

    renderWithProviders(<TrackingLinkNeutralState />, 'es');
    await user.type(screen.getByLabelText('Correo con el que compraste'), 'juan@dominio.com');
    await user.type(screen.getByLabelText('Número de pedido'), 'TCG-000123');
    await user.click(screen.getByRole('button', { name: 'Enviarme un enlace nuevo' }));
    const viaB = (await screen.findAllByRole('status'))[0].textContent;

    expect(viaB).toBe(viaA);
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
