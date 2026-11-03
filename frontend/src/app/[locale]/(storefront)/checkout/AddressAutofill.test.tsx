import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
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

import { GuestCheckoutView } from './GuestCheckoutView';
import { AddressManager } from '@/components/domain/AddressManager';

/**
 * Paquete A (dueño, `HECHOS.md` 2026-11-02 «Checkout con menos captura: paquete A…» (4)): que el navegador pueda
 * autocompletar. Los campos viven dentro de un `<form>` (el autocompletado de Chrome/Safari agrupa por formulario)
 * cuyo envío no navega, y cada campo de la dirección lleva su `autocomplete` con la sección `shipping`. El correo no
 * es de la dirección: `email` a secas.
 */
function expectNoNavigation(form: HTMLFormElement) {
  const ev = new Event('submit', { bubbles: true, cancelable: true });
  form.dispatchEvent(ev);
  expect(ev.defaultPrevented, 'el envío del <form> no navega').toBe(true);
}

describe('Autocompletado · checkout de invitado', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem('tcg.cart', JSON.stringify({ ids: ['inv-1002'], updatedAt: Date.now() }));
  });

  it('el formulario es un <form> que no navega, con `autocomplete` shipping en cada campo de la dirección', async () => {
    const usr = userEvent.setup();
    renderWithProviders(<GuestCheckoutView onPaid={vi.fn()} onAccountReady={vi.fn()} />, 'es');
    await screen.findByLabelText('Correo electrónico');
    const form = screen.getByTestId('guest-form');
    expect(form.tagName).toBe('FORM');
    expectNoNavigation(form as HTMLFormElement);

    expect(screen.getByLabelText('Correo electrónico')).toHaveAttribute('autocomplete', 'email');
    expect(screen.getByLabelText('Nombre de quien recibe')).toHaveAttribute('autocomplete', 'shipping name');
    expect(screen.getByLabelText('Código postal')).toHaveAttribute('autocomplete', 'shipping postal-code');
    expect(screen.getByLabelText('Calle y número')).toHaveAttribute('autocomplete', 'shipping address-line1');
    expect(screen.getByLabelText('Teléfono')).toHaveAttribute('autocomplete', 'shipping tel');
    // Colonia en modo LISTA (el `<select>`): también se puede autocompletar.
    await usr.type(screen.getByLabelText('Código postal'), '06600');
    await screen.findByRole('option', { name: 'Juárez' });
    expect(screen.getByRole('combobox', { name: 'Colonia' })).toHaveAttribute('autocomplete', 'shipping address-level3');
    for (const el of within(form).getAllByRole('textbox')) expect(form.contains(el)).toBe(true);
    // Interior, plegado: al abrirlo, `address-line2`.
    await usr.click(screen.getByRole('button', { name: /interior/i }));
    expect(screen.getByLabelText(/interior o depto/i)).toHaveAttribute('autocomplete', 'shipping address-line2');
  });
});

describe('Autocompletado · alta de dirección (AddressManager)', () => {
  it('<form> que no navega; calle `address-line1`, interior `address-line2`, todo en la sección shipping', async () => {
    renderWithProviders(<AddressManager />, 'es');
    fireEvent.click(await screen.findByRole('button', { name: 'Agregar' }));
    const dialog = await screen.findByRole('dialog');
    const form = dialog.querySelector('form');
    expect(form, 'los campos del alta viven en un <form>').not.toBeNull();
    expectNoNavigation(form!);
    const field = (label: string | RegExp) => within(dialog).getByLabelText(label);
    expect(form!.contains(field('Calle y número'))).toBe(true);
    expect(field('Nombre de quien recibe')).toHaveAttribute('autocomplete', 'shipping name');
    expect(field('Calle y número')).toHaveAttribute('autocomplete', 'shipping address-line1');
    expect(field(/interior o depto/i)).toHaveAttribute('autocomplete', 'shipping address-line2');
    expect(field('Código postal')).toHaveAttribute('autocomplete', 'shipping postal-code');
    expect(field('Teléfono')).toHaveAttribute('autocomplete', 'shipping tel');
  });
});
