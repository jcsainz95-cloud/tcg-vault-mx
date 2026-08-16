import { describe, it, expect } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { BuylistView } from './BuylistView';

/**
 * Nuevo flujo del cotizador (Opción 1, contrato §6 v1.3): buscar sobre TODO el
 * catálogo (por set y/o texto) → elegir una carta → cotizar con getBuylistQuote.
 */
describe('BuylistView · cotizador con búsqueda real', () => {
  it('el botón de cotizar está deshabilitado hasta elegir una carta', async () => {
    renderWithProviders(<BuylistView />, 'es');
    expect(screen.getByRole('button', { name: 'Cotizar' })).toBeDisabled();
    expect(screen.getByText('Elige una carta de los resultados para cotizar.')).toBeInTheDocument();
  });

  it('busca por texto, elige carta y cotiza (EX+ = 40% de la referencia)', async () => {
    renderWithProviders(<BuylistView />, 'es');

    fireEvent.change(screen.getByLabelText('Buscar carta'), { target: { value: 'Charizard' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));

    // Resultado de la búsqueda sobre el catálogo completo.
    const option = await screen.findByRole('option', { name: /Charizard/ });
    fireEvent.click(option);

    fireEvent.click(screen.getByRole('button', { name: 'Cotizar' }));

    expect(await screen.findByRole('heading', { name: 'Cotización' })).toBeInTheDocument();
    expect(screen.getByText('EX o superior')).toBeInTheDocument();
  });

  it('filtra por set y muestra las cartas de ese set', async () => {
    renderWithProviders(<BuylistView />, 'es');

    // Esperar a que carguen los sets del dropdown.
    await screen.findByRole('option', { name: /Base Set/ });
    fireEvent.change(screen.getByLabelText('Filtrar por set'), { target: { value: 'base1' } });

    // Se listan cartas del set Base Set (p. ej. Pikachu) como opciones seleccionables.
    expect(await screen.findByRole('option', { name: /Pikachu/ })).toBeInTheDocument();
  });

  it('una carta sin referencia (Zapdos) queda en precio pendiente', async () => {
    renderWithProviders(<BuylistView />, 'es');

    fireEvent.change(screen.getByLabelText('Buscar carta'), { target: { value: 'Zapdos' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));

    fireEvent.click(await screen.findByRole('option', { name: /Zapdos/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Cotizar' }));

    expect(await screen.findByText(/precio pendiente/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Crear solicitud/ })).toBeDisabled();
  });
});
