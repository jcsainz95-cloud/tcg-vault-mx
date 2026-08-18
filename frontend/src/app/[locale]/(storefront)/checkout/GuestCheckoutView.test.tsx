import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/render';

// Link de i18n → <a> plano para el render de prueba.
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/checkout',
}));

import { GuestCheckoutView } from './GuestCheckoutView';

function seedCart(ids: string[]) {
  window.localStorage.setItem('tcg.cart', JSON.stringify(ids));
}

describe('GuestCheckoutView · checkout de invitado (criterios 45–48b)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    seedCart(['inv-1002']);
  });

  it('ofrece las TRES vías de identidad y anuncia que el carrito se conserva (criterio 46)', async () => {
    renderWithProviders(<GuestCheckoutView onPaid={vi.fn()} onAccountReady={vi.fn()} />, 'es');

    expect(await screen.findByRole('button', { name: 'Continuar como invitado' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Iniciar sesión' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Crear cuenta' })).toBeInTheDocument();
    expect(screen.getByText('Tu carrito se conserva en cualquiera de las tres.')).toBeInTheDocument();
  });

  it('conserva carrito y correo al alternar invitado → iniciar sesión → invitado (criterio 46)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GuestCheckoutView onPaid={vi.fn()} onAccountReady={vi.fn()} />, 'es');

    await user.click(await screen.findByRole('button', { name: 'Continuar como invitado' }));
    const email = screen.getByLabelText('Correo electrónico');
    await user.type(email, 'juan@dominio.com');

    // Cambia de vía (inline, sin navegar) y vuelve.
    await user.click(screen.getByRole('button', { name: 'Cambiar' }));
    await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }));
    await user.click(screen.getByRole('button', { name: 'Cambiar' }));
    await user.click(screen.getByRole('button', { name: 'Continuar como invitado' }));

    expect(screen.getByLabelText('Correo electrónico')).toHaveValue('juan@dominio.com');
    // El carrito nunca se toca al cambiar de vía (formato v2: { ids, updatedAt }).
    expect(JSON.parse(window.localStorage.getItem('tcg.cart')!).ids).toEqual(['inv-1002']);
  });

  it('muestra el desglose con LÍNEA DE ENVÍO y los tres avisos del contrato (criterio 48b)', async () => {
    renderWithProviders(<GuestCheckoutView onPaid={vi.fn()} onAccountReady={vi.fn()} />, 'es');

    const breakdown = await screen.findByTestId('amount-breakdown');
    expect(breakdown).toBeInTheDocument();
    expect(screen.getByText('Subtotal')).toBeInTheDocument();
    expect(screen.getByText('Envío')).toBeInTheDocument();
    expect(screen.getByText('IVA 16%')).toBeInTheDocument();
    expect(screen.getByText('Costo de procesamiento')).toBeInTheDocument();
    expect(
      screen.getByText('Todas las ventas son finales. Sin reembolsos salvo carta dañada o equivocada.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Para solicitar factura \(CFDI\)/)).toBeInTheDocument();
  });

  it('un correo con formato inválido impide pagar y pinta el resumen de errores (criterio 47)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GuestCheckoutView onPaid={vi.fn()} onAccountReady={vi.fn()} />, 'es');

    await user.click(await screen.findByRole('button', { name: 'Continuar como invitado' }));
    await user.type(screen.getByLabelText('Correo electrónico'), 'no-es-correo');
    await user.click(screen.getByRole('button', { name: /Pagar/ }));

    const summary = await screen.findByRole('alert');
    expect(summary).toHaveTextContent('Revisa');
    expect(
      screen.getAllByText('Escribe un correo válido, por ejemplo nombre@dominio.com.').length,
    ).toBeGreaterThan(0);
    // No se creó ninguna sesión de pago: el modal de Stripe no aparece.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('la bóveda es SELECCIONABLE y despliega el upsell, nunca un error (criterio 48)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GuestCheckoutView onPaid={vi.fn()} onAccountReady={vi.fn()} />, 'es');

    await user.click(await screen.findByRole('button', { name: 'Continuar como invitado' }));
    const vaultRadio = screen.getByRole('radio', { name: /Guardar en mi bóveda/ });
    expect(vaultRadio).not.toBeDisabled();
    expect(vaultRadio).not.toHaveAttribute('aria-disabled');

    await user.click(vaultRadio);

    // Upsell: beneficio + crear cuenta sin salir del checkout + salida en positivo.
    const panel = await screen.findByTestId('vault-upsell');
    expect(panel).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Crear cuenta y guardar en bóveda' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Seguir con envío a domicilio' })).toBeInTheDocument();
    // NO es un error: no hay alert ni copy de error en pantalla.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    // El pago queda bloqueado, pero con explicación textual (nunca un botón mudo).
    const payButton = screen.getByRole('button', { name: /Pagar/ });
    expect(payButton).toBeDisabled();
    expect(screen.getByText('Para pagar, crea tu cuenta o elige envío a domicilio.')).toBeInTheDocument();

    // Descartar el upsell devuelve el flujo a envío directo.
    await user.click(screen.getByRole('button', { name: 'Seguir con envío a domicilio' }));
    await waitFor(() => expect(screen.queryByTestId('vault-upsell')).not.toBeInTheDocument());
    expect(screen.getByRole('radio', { name: /Envío a mi domicilio/ })).toBeChecked();
  });

  it('editar el correo desmarca la confirmación y vuelve a bloquear el pago (§15.3)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GuestCheckoutView onPaid={vi.fn()} onAccountReady={vi.fn()} />, 'es');

    await user.click(await screen.findByRole('button', { name: 'Continuar como invitado' }));
    await user.type(screen.getByLabelText('Correo electrónico'), 'juan@dominio.com');

    const confirm = screen.getByRole('checkbox', { name: /Confirmo que/ });
    await user.click(confirm);
    expect(confirm).toBeChecked();

    await user.type(screen.getByLabelText('Correo electrónico'), 'x');
    expect(confirm).not.toBeChecked();
    expect(screen.getByText('Cambiaste el correo: vuelve a confirmarlo antes de pagar.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Pagar/ })).toBeDisabled();
  });

  it('nunca muestra el aviso de verificación de correo a un invitado (§15.2)', async () => {
    renderWithProviders(<GuestCheckoutView onPaid={vi.fn()} onAccountReady={vi.fn()} />, 'es');
    await screen.findByTestId('amount-breakdown');
    expect(screen.queryByText(/Verifica tu correo/)).not.toBeInTheDocument();
  });
});
