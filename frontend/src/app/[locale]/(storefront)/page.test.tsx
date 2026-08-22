import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';

// Link de i18n → <a> plano para el render de prueba.
vi.mock('@/i18n/navigation', () => ({
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

  it('cotiza contra el server al añadir una carta: aparece la línea y el total «Te pagamos»', async () => {
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
    await waitFor(() => expect(screen.getAllByText('Te pagamos').length).toBe(2), {
      timeout: 3000,
    });
    const totals = screen.getAllByText(/MX\$|—/);
    expect(totals.length).toBeGreaterThan(0);
  });
});
