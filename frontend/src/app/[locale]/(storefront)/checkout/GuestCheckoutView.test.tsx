import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
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
import { setCheckoutViewport } from './test-viewport';

// Escritas para el layout de escritorio (`aside`); la barra fija móvil tiene su prueba propia (CheckoutPayBar.test.tsx).
setCheckoutViewport('desktop');

function seedCart(ids: string[]) {
  window.localStorage.setItem('tcg.cart', JSON.stringify(ids));
}

describe('GuestCheckoutView · checkout de invitado (criterios 45–48b)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    seedCart(['inv-1002']);
  });

  it('CHK-MOVIL.2.1: el formulario se pinta directo y las otras dos vías quedan a UN toque, inline (criterio 46)', async () => {
    renderWithProviders(<GuestCheckoutView onPaid={vi.fn()} onAccountReady={vi.fn()} />, 'es');

    // Sin pantalla de tres vías: el primer campo existe en el primer pintado de datos.
    expect(await screen.findByLabelText('Correo electrónico')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continuar como invitado' })).toBeNull();
    // T4: «¿Ya tienes cuenta? Inicia sesión · o crea una cuenta» — dos botones, cerrados.
    const login = screen.getByRole('button', { name: 'Inicia sesión' });
    const register = screen.getByRole('button', { name: 'crea una cuenta' });
    expect(login).toHaveAttribute('aria-expanded', 'false');
    expect(register).toHaveAttribute('aria-expanded', 'false');
  });

  // MKT-CONV.4 (B2, criterio 945): franja de confianza bajo «Tu carrito», fuera de la barra de PAGAR.
  it('B2 · la franja de confianza va bajo el título, enlazada a /nosotros, y no dentro de la barra de pago', async () => {
    renderWithProviders(<GuestCheckoutView onPaid={vi.fn()} onAccountReady={vi.fn()} />, 'es');
    const strip = await screen.findByTestId('about-strip');
    const title = screen.getByRole('heading', { level: 1, name: 'Tu carrito' });
    expect(title.parentElement!.contains(strip)).toBe(true);
    expect(within(strip).getByRole('link', { name: 'Quiénes somos y contacto' })).toHaveAttribute('href', '/nosotros');
    expect(strip.closest('[data-testid="checkout-pay-bar"]')).toBeNull();
  });

  it('conserva carrito y correo al abrir «Inicia sesión» y «crea una cuenta» inline (criterio 46)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GuestCheckoutView onPaid={vi.fn()} onAccountReady={vi.fn()} />, 'es');

    const email = await screen.findByLabelText('Correo electrónico');
    await user.type(email, 'juan@dominio.com');

    // Abre el panel de login (inline, sin navegar): el formulario de invitado sigue montado con su correo.
    await user.click(screen.getByRole('button', { name: 'Inicia sesión' }));
    expect(screen.getByRole('button', { name: 'Inicia sesión' })).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById('guest-email')).toHaveValue('juan@dominio.com');
    // Cambia a registro y cierra: nada se pierde.
    await user.click(screen.getByRole('button', { name: 'crea una cuenta' }));
    expect(screen.getByRole('button', { name: 'crea una cuenta' })).toHaveAttribute('aria-expanded', 'true');
    await user.click(screen.getByRole('button', { name: 'crea una cuenta' }));
    expect(screen.getByRole('button', { name: 'crea una cuenta' })).toHaveAttribute('aria-expanded', 'false');

    expect(document.getElementById('guest-email')).toHaveValue('juan@dominio.com');
    // El carrito nunca se toca al cambiar de vía (formato v2: { ids, updatedAt }).
    expect(JSON.parse(window.localStorage.getItem('tcg.cart')!).ids).toEqual(['inv-1002']);
  });

  it('muestra el desglose con LÍNEA DE ENVÍO y los tres avisos del contrato (criterio 48b)', async () => {
    renderWithProviders(<GuestCheckoutView onPaid={vi.fn()} onAccountReady={vi.fn()} />, 'es');

    const breakdown = await screen.findByTestId('amount-breakdown');
    expect(breakdown).toBeInTheDocument();
    expect(screen.getByText('Subtotal')).toBeInTheDocument();
    expect(screen.getByText('Envío')).toBeInTheDocument();
    /*
     * ⭐⭐ **CRITERIO 189 — bajo `IVA_INCLUSIVE` la línea de IVA INFORMA, no suma**, y el mock ya
     * emite esa convención. El rótulo es **de importe** y nada más (criterios **195** y **208**):
     * ni «trasladado», ni «conforme a la ley», ni en negativo.
     */
    expect(screen.getByText('IVA 16 % incluido')).toBeInTheDocument();
    expect(breakdown.getAttribute('data-price-convention')).toBe('IVA_INCLUSIVE');
    // ⛔ El renglón va marcado como informativo: es lo que impide que alguien lo vuelva un sumando.
    expect(breakdown.querySelector('[data-informative="true"]')).not.toBeNull();
    // §29 (v3.6): «Comisión de plataforma» — la línea ya no nombra al procesador de pago.
    expect(screen.getByText('Comisión de plataforma')).toBeInTheDocument();
    // Aviso de ventas finales con enlace a términos: lo lleva la casilla de términos (B4: una sola mención), con T8.
    const terms = screen.getByTestId('privacy-site-guestCheckout');
    expect(terms).toHaveTextContent(/todas las ventas son finales/);
    expect(within(terms).getByRole('link', { name: /términos/ })).toBeInTheDocument();
    expect(screen.getByText('Si tu carta llega dañada o equivocada, te reembolsamos.')).toBeInTheDocument();
    expect(screen.getByText(/Para solicitar factura \(CFDI\)/)).toBeInTheDocument();
  });

  it('B4b (E2E-GUEST-GUION): con el correo vacío la casilla NO dice «Confirmo que — es correcto»; con correo, lo muestra', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GuestCheckoutView onPaid={vi.fn()} onAccountReady={vi.fn()} />, 'es');
    await screen.findByLabelText('Correo electrónico');
    const confirm = () => document.querySelector('label[for="guest-email-confirm"]')!;
    expect(confirm()).toHaveTextContent('Confirmo que mi correo es correcto. Es el único canal para dar seguimiento a mi pedido.');
    expect(confirm().textContent).not.toContain('—');
    // Solo espacios cuenta como vacío.
    await user.type(screen.getByLabelText('Correo electrónico'), '   ');
    expect(confirm().textContent).not.toContain('—');
    expect(confirm()).toHaveTextContent('Confirmo que mi correo es correcto.');
    await user.clear(screen.getByLabelText('Correo electrónico'));
    await user.type(screen.getByLabelText('Correo electrónico'), 'juan@dominio.com');
    expect(confirm()).toHaveTextContent('Confirmo que juan@dominio.com es correcto.');
  });

  it('un correo con formato inválido impide pagar y pinta el resumen de errores (criterio 47)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GuestCheckoutView onPaid={vi.fn()} onAccountReady={vi.fn()} />, 'es');

    await screen.findByLabelText('Correo electrónico'); // CHK-MOVIL.2.1: el formulario está desde el primer pintado
    await user.type(screen.getByLabelText('Correo electrónico'), 'no-es-correo');
    await user.click(screen.getByRole('button', { name: /Pagar/ }));

    // Al pagar con datos inválidos hay DOS alerts: el resumen de errores del formulario y el
    // aviso junto al botón (en el aside `complementary`). Acotamos al resumen del formulario,
    // que vive FUERA del aside (N-9/N-12: el aside agregó su propio destino + aviso de pago).
    const aside = screen.getByRole('complementary');
    const summary = (await screen.findAllByRole('alert')).find((el) => !aside.contains(el));
    expect(summary).toBeDefined();
    expect(summary!).toHaveTextContent('Revisa');
    expect(
      screen.getAllByText('Escribe un correo válido, por ejemplo nombre@dominio.com.').length,
    ).toBeGreaterThan(0);
    // No se creó ninguna sesión de pago: el modal de Stripe no aparece.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('la bóveda es SELECCIONABLE y despliega el upsell, nunca un error (criterio 48)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GuestCheckoutView onPaid={vi.fn()} onAccountReady={vi.fn()} />, 'es');

    await screen.findByLabelText('Correo electrónico'); // CHK-MOVIL.2.1: el formulario está desde el primer pintado
    // CHK-MOVIL.2.3: UNA fila de destino (región «DESTINO»), antes del formulario; la bóveda es un botón con
    // «REQUIERE CUENTA» que despliega el upsell. Sigue seleccionable: ni `disabled` ni `aria-disabled`.
    const form = screen.getByRole('region', { name: 'DESTINO' });
    const vaultRadio = within(form).getByRole('button', { name: /Guardar en mi bóveda/ });
    expect(vaultRadio).toHaveAccessibleName(/REQUIERE CUENTA/);
    expect(vaultRadio).not.toBeDisabled();
    expect(vaultRadio).not.toHaveAttribute('aria-disabled');
    // La bóveda se anuncia ANTES del primer campo (CHK-MOVIL.5).
    expect(vaultRadio.compareDocumentPosition(screen.getByLabelText('Correo electrónico')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await user.click(vaultRadio);
    expect(vaultRadio).toHaveAttribute('aria-expanded', 'true');

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
    expect(vaultRadio).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Para pagar, crea tu cuenta o elige envío a domicilio.')).toBeNull();
  });

  it('editar el correo desmarca la confirmación y vuelve a bloquear el pago (§15.3)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GuestCheckoutView onPaid={vi.fn()} onAccountReady={vi.fn()} />, 'es');

    await screen.findByLabelText('Correo electrónico'); // CHK-MOVIL.2.1: el formulario está desde el primer pintado
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
