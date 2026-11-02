import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/render';

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
  return { ...actual, createGuestCheckoutSession: vi.fn() };
});

import { createGuestCheckoutSession } from '@/lib/api';
import { GuestCheckoutView } from './GuestCheckoutView';
import { setCheckoutViewport } from './test-viewport';

/**
 * QA de marketing (2026-11-02): «Revisa los datos marcados arriba…» (`checkout.guest.formIncomplete`) se quedaba
 * pintado después de corregir el formulario: era un `payError` de estado que solo se limpiaba al volver a pulsar
 * «Pagar». Ahora el aviso vive mientras el formulario siga inválido y desaparece en cuanto queda válido.
 */
const MSG = 'Revisa los datos marcados arriba (por ejemplo el teléfono) para poder pagar.';

async function fillAllButPhone(usr: ReturnType<typeof userEvent.setup>) {
  await screen.findByLabelText('Correo electrónico');
  await usr.type(screen.getByLabelText('Correo electrónico'), 'juan@dominio.com');
  await usr.click(screen.getByRole('checkbox', { name: /Confirmo que/ }));
  await usr.type(screen.getByLabelText('Nombre de quien recibe'), 'Juan Pérez');
  await usr.type(screen.getByLabelText('Calle y número'), 'Av. Reforma 123');
  await usr.type(screen.getByLabelText('Código postal'), '06600');
  await screen.findByRole('option', { name: 'Juárez' });
  await usr.selectOptions(screen.getByRole('combobox', { name: 'Colonia' }), 'Juárez');
  await usr.click(screen.getByRole('checkbox', { name: /Acepto los términos/ }));
}

describe.each(['desktop', 'mobile'] as const)('GuestCheckoutView · aviso «Revisa los datos» (%s)', (viewport) => {
  setCheckoutViewport(viewport);
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    vi.mocked(createGuestCheckoutSession).mockReset();
    window.localStorage.setItem('tcg.cart', JSON.stringify({ ids: ['inv-1002'], updatedAt: Date.now() }));
  });

  it('aparece al pagar con el teléfono incompleto y desaparece al corregirlo, sin volver a pulsar «Pagar»', async () => {
    const usr = userEvent.setup();
    renderWithProviders(<GuestCheckoutView onPaid={vi.fn()} onAccountReady={vi.fn()} />, 'es');
    await fillAllButPhone(usr);
    await usr.type(screen.getByLabelText('Teléfono'), '55123');

    // <lg la barra fija se esconde con el teclado abierto (CHK-MOVIL): se suelta el foco como haría el usuario.
    (document.activeElement as HTMLElement | null)?.blur();
    await usr.click(await screen.findByRole('button', { name: /^Pagar/ }));
    expect(await screen.findByText(MSG)).toBeInTheDocument();
    expect(createGuestCheckoutSession).not.toHaveBeenCalled();

    // Un dígito más sigue siendo inválido: el aviso se queda.
    await usr.type(screen.getByLabelText('Teléfono'), '4');
    expect(screen.getByText(MSG)).toBeInTheDocument();

    // Completa el teléfono (10 dígitos): el formulario queda válido y el aviso se va solo.
    await usr.type(screen.getByLabelText('Teléfono'), '5678');
    await waitFor(() => expect(screen.queryByText(MSG)).not.toBeInTheDocument());

    // Y no reaparece por volver a romper un campo sin intentar pagar (el error de campo sí se ve).
    await usr.type(screen.getByLabelText('Teléfono'), '{Backspace}');
    expect(screen.queryByText(MSG)).not.toBeInTheDocument();
  });
});
