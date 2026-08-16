import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { BuylistView } from './BuylistView';
import * as api from '@/lib/api';

beforeEach(() => {
  vi.restoreAllMocks();
});

/** Cotiza una carta por su nombre y la agrega al carrito (helper de flujo). */
async function quoteAndAdd(name: string) {
  fireEvent.change(screen.getByLabelText('Buscar carta'), { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
  // Una búsqueda puede devolver varias coincidencias (p. ej. "Pikachu" y "Pikachu ex");
  // se toma la primera opción de la lista.
  const options = await screen.findAllByRole('option', { name: new RegExp(name) });
  fireEvent.click(options[0]);
  fireEvent.click(screen.getByRole('button', { name: 'Cotizar' }));
  fireEvent.click(await screen.findByRole('button', { name: /Agregar al carrito/ }));
}

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

  it('busca por texto, elige carta y cotiza mostrando rareza + regla aplicada (fallback 40%)', async () => {
    renderWithProviders(<BuylistView />, 'es');

    fireEvent.change(screen.getByLabelText('Buscar carta'), { target: { value: 'Charizard' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));

    const option = await screen.findByRole('option', { name: /Charizard/ });
    fireEvent.click(option);

    fireEvent.click(screen.getByRole('button', { name: 'Cotizar' }));

    expect(await screen.findByRole('heading', { name: 'Cotización' })).toBeInTheDocument();
    expect(screen.getByText('Rare Holo')).toBeInTheDocument();
    expect(screen.getByText('40% de referencia')).toBeInTheDocument();
  });

  it('filtra por set y muestra las cartas de ese set', async () => {
    renderWithProviders(<BuylistView />, 'es');

    await screen.findByRole('option', { name: /Base Set/ });
    fireEvent.change(screen.getByLabelText('Filtrar por set'), { target: { value: 'base1' } });

    expect(await screen.findByRole('option', { name: /Pikachu/ })).toBeInTheDocument();
  });

  it('una carta sin referencia (Zapdos) queda en precio pendiente', async () => {
    renderWithProviders(<BuylistView />, 'es');

    fireEvent.change(screen.getByLabelText('Buscar carta'), { target: { value: 'Zapdos' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));

    fireEvent.click(await screen.findByRole('option', { name: /Zapdos/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Cotizar' }));

    expect(await screen.findByText(/precio pendiente/i)).toBeInTheDocument();
  });
});

/**
 * Carrito de venta: varias cartas en UNA sola solicitud. La cantidad por línea
 * se expande a N entradas de `items` al enviar (1 item por carta física).
 */
describe('BuylistView · carrito de venta', () => {
  it('parte con el carrito vacío y sin poder enviar', () => {
    renderWithProviders(<BuylistView />, 'es');
    expect(
      screen.getByText('Tu carrito está vacío. Cotiza una carta y agrégala para venderla.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Enviar solicitud/ })).not.toBeInTheDocument();
  });

  it('agrega una carta cotizada al carrito y muestra su estimado', async () => {
    renderWithProviders(<BuylistView />, 'es');
    await quoteAndAdd('Charizard');

    // La línea aparece en el carrito con su nombre y hay un total estimado.
    expect(screen.getByText('Total estimado')).toBeInTheDocument();
    expect(screen.getByText('Estimado c/u:')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enviar solicitud (1)' })).toBeEnabled();
  });

  it('la cantidad por línea suma al total y expande los items al enviar', async () => {
    const spy = vi.spyOn(api, 'createSellRequest');
    renderWithProviders(<BuylistView />, 'es');
    await quoteAndAdd('Charizard');

    // Sube la cantidad de la línea a 3 (alguien vende 3 iguales).
    const inc = screen.getByRole('button', { name: 'Aumentar cantidad' });
    fireEvent.click(inc);
    fireEvent.click(inc);
    expect(screen.getByRole('button', { name: 'Enviar solicitud (3)' })).toBeInTheDocument();

    // Enviar → abre el KYC/CLABE; se completa y se crea con 3 items expandidos.
    fireEvent.click(screen.getByRole('button', { name: 'Enviar solicitud (3)' }));
    fireEvent.change(await screen.findByLabelText(/CLABE/), {
      target: { value: '002010077777777771' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar solicitud' }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const payload = spy.mock.calls[0][0];
    expect(payload.items).toHaveLength(3);
    expect(payload.items.every((i) => i.cardId === 'c-charizard' && i.rawCondition === 'NM')).toBe(
      true,
    );
  });

  it('agrega varias cartas distintas y las envía en una sola solicitud', async () => {
    const spy = vi.spyOn(api, 'createSellRequest');
    renderWithProviders(<BuylistView />, 'es');
    await quoteAndAdd('Charizard');
    await quoteAndAdd('Pikachu');

    expect(screen.getByRole('button', { name: 'Enviar solicitud (2)' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Enviar solicitud (2)' }));
    fireEvent.change(await screen.findByLabelText(/CLABE/), {
      target: { value: '002010077777777771' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar solicitud' }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const ids = spy.mock.calls[0][0].items.map((i) => i.cardId);
    expect(ids).toContain('c-charizard');
    expect(ids).toContain('c-pikachu');
  });

  it('quitar una línea la elimina del carrito', async () => {
    renderWithProviders(<BuylistView />, 'es');
    await quoteAndAdd('Charizard');
    expect(screen.getByRole('button', { name: 'Enviar solicitud (1)' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Quitar' }));
    expect(
      screen.getByText('Tu carrito está vacío. Cotiza una carta y agrégala para venderla.'),
    ).toBeInTheDocument();
  });

  it('vaciar el carrito lo deja vacío', async () => {
    renderWithProviders(<BuylistView />, 'es');
    await quoteAndAdd('Charizard');
    fireEvent.click(screen.getByRole('button', { name: /Vaciar carrito/ }));
    expect(
      screen.getByText('Tu carrito está vacío. Cotiza una carta y agrégala para venderla.'),
    ).toBeInTheDocument();
  });
});
