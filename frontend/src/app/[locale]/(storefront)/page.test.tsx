import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';

// Link de i18n → <a> plano para el render de prueba. `useRouter`/`usePathname` también se stubean:
// la vitrina «Joyas para gradear» (§22.6) reusa la teja de Compra, que navega al carrito.
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// Sesión ANÓNIMA (ready + no autenticado): la rama que pinta el home 1a sin banda de portafolio.
vi.mock('@/lib/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/session')>();
  return { ...actual, useSession: () => ({ user: null, isAuthenticated: false, ready: true }) };
});

import HomePage from './page';

describe('HomePage · makeover 1a (hero + cotizador + estantes)', () => {
  it('pinta el hero, el cotizador (hero lg + sección móvil) y la banda del buylist', async () => {
    renderWithProviders(<HomePage />, 'es');

    // Hero: kicker mono + H1 + CTA negro al catálogo.
    expect(screen.getByText('Cartas Pokémon · México')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {
        name: 'Compra cartas Pokémon con precio real y guárdalas en la bóveda',
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver el catálogo' })).toHaveAttribute(
      'href',
      '/catalog',
    );

    // El cotizador se pinta DOS veces (columna del hero en lg + sección propia en móvil)
    // compartiendo estado; ambas arrancan con el estado vacío honesto.
    expect(screen.getAllByText('¿Cuánto vale lo que tienes?')).toHaveLength(2);
    expect(
      screen.getAllByText('Aún no agregas cartas. Busca una para ver lo que pagamos hoy.'),
    ).toHaveLength(2);

    // Chips de sets REALES de las facetas del catálogo (mock).
    expect(await screen.findByText('Sets buscados')).toBeInTheDocument();

    // Piezas destacadas + banda de tinta con el CTA rojo del buylist.
    expect(screen.getByText('Piezas destacadas del catálogo')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Cotizar mi lista' })).toHaveAttribute(
      'href',
      '/buylist',
    );
    expect(screen.getAllByRole('link', { name: 'Continuar mi cotización' })[0]).toHaveAttribute(
      'href',
      '/buylist',
    );
  });

  /**
   * §23.3g fila 0 · §23.14.6-6 — la regla del envío en el teaser, en LAS DOS instancias.
   *
   * El panel del home se pinta dos veces: columna del hero (`withTrust` implícito) y sección
   * propia de móvil (`withTrust={false}`). La nota va en el CUERPO del panel, no en la banda
   * de confianza, justamente para que exista en las dos: una regla de dinero que solo aparece
   * en escritorio no es una regla, y móvil es donde vende la mayoría.
   */
  it('la nota del envío se pinta en LAS DOS instancias del teaser (también en la de móvil, sin banda de confianza)', () => {
    renderWithProviders(<HomePage />, 'es');

    // Con CERO cartas: es copy estático (§23.3k), no espera a ningún dato ni al carrito.
    const notes = screen.getAllByTestId('buylist-shipping-note');
    expect(notes).toHaveLength(2);
    // Misma frase, carácter por carácter, en ambas: dos redacciones sería el defecto.
    for (const note of notes) {
      expect(note).toHaveTextContent(
        'Nosotros ponemos la guía de envío y su costo se descuenta siempre de lo que te pagamos: tú no pagas nada de tu bolsillo. El monto exacto va en la oferta, antes de que aceptes.',
      );
    }
    // D43: la nota dice el envío EN PALABRAS. Ninguna cifra de envío en el teaser.
    expect(notes[0].textContent).not.toMatch(/MX\$|\d|%/);
  });

  it('cotiza contra el server al añadir una carta: aparece la línea y el total «Valor de tus cartas»', async () => {
    renderWithProviders(<HomePage />, 'es');

    // Escribe en el buscador del cotizador (primera instancia). El valor debounced
    // (300 ms) dispara GET /buylist/cards del mock.
    const input = screen.getAllByLabelText('Busca una carta para cotizar')[0];
    fireEvent.change(input, { target: { value: 'char' } });

    // Aparece el dropdown con resultados reales del catálogo mock.
    const options = await screen.findAllByRole('button', { name: /Charizard/ }, { timeout: 3000 });
    fireEvent.click(options[0]);

    // La línea se agrega y el total llega DEL SERVER (SEC-A1): con monto cotizado o
    // la línea queda en "Pendiente" — jamás un $0 inventado. El total se pinta en
    // ambas instancias del panel (estado compartido).
    //
    // §23.14.2a: el rótulo es «Valor de tus cartas» (`buylist.quote.money.cardsValue`, la MISMA
    // clave del carrito), no «Te pagamos». Sobre un bruto del que se descuenta el envío, un
    // rótulo que promete depósito es una contradicción viva — y el vendedor se queda con el
    // número grande. Un segundo string con el mismo significado tampoco: por eso se reusa.
    await waitFor(() => expect(screen.getAllByText('Valor de tus cartas').length).toBe(2), {
      timeout: 3000,
    });
    expect(screen.queryByText('Te pagamos')).not.toBeInTheDocument();
    const totals = screen.getAllByText(/MX\$|—/);
    expect(totals.length).toBeGreaterThan(0);

    // Y la nota sigue ahí CON líneas: no aparece, no desaparece y no se mueve (§23.3k).
    expect(screen.getAllByTestId('buylist-shipping-note')).toHaveLength(2);
  });
});
