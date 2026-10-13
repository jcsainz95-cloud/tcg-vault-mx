/**
 * §13 (plano) — el plano de mesas es navegable con teclado, tiene nombres accesibles en orden 1→N,
 * responde a Enter/Espacio/Esc, marca el estado con texto (no solo color) y trae tabla equivalente
 * (API_CONTRACT §CARDSHOW.2, RONDA_0 §8).
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CARD_SHOW } from '@/content/card-show';
import { PlanoMesas } from './PlanoMesas';

vi.mock('@/lib/card-show-clicks', () => ({ trackClick: vi.fn(), trackedHref: (d: string) => `/ir/${d}` }));

const totalMesas = CARD_SHOW.mesas.plano.length;

describe('PlanoMesas · accesibilidad', () => {
  it('cada mesa es un botón tabulable con nombre accesible, en orden 1→N', () => {
    render(<PlanoMesas />);
    const mesaBtns = screen.getAllByRole('button', { name: /^Mesa \d/ });
    expect(mesaBtns).toHaveLength(totalMesas);
    const numeros = mesaBtns.map((b) => Number((b.getAttribute('aria-label') ?? '').match(/Mesa (\d+)/)![1]));
    expect(numeros).toEqual([...numeros].sort((a, b) => a - b)); // 1→N
    // Tabulable: botón nativo (tabIndex implícito 0), no un div con role.
    for (const b of mesaBtns) expect(b.tagName).toBe('BUTTON');
  });

  it('el nombre accesible incluye el estado en texto (no solo color): «Sin apartar» / «Apartada»', () => {
    render(<PlanoMesas />);
    const names = screen.getAllByRole('button', { name: /^Mesa \d/ }).map((b) => b.getAttribute('aria-label'));
    expect(names.some((n) => /Sin apartar$/.test(n ?? ''))).toBe(true);
    expect(names.some((n) => /Apartada$/.test(n ?? ''))).toBe(true);
    // ⛔ nunca la palabra «disponible»
    expect(names.join(' ')).not.toMatch(/disponible/i);
  });

  it('Enter y Espacio seleccionan; Esc deselecciona (aria-pressed + región viva)', async () => {
    const u = userEvent.setup();
    render(<PlanoMesas />);
    const first = screen.getByRole('button', { name: /^Mesa 1,/ });
    first.focus();
    await u.keyboard('{Enter}');
    expect(first).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('status').textContent).toMatch(/Mesa 1/);
    await u.keyboard('{Escape}');
    expect(first).toHaveAttribute('aria-pressed', 'false');

    const second = screen.getByRole('button', { name: /^Mesa 2,/ });
    second.focus();
    await u.keyboard(' ');
    expect(second).toHaveAttribute('aria-pressed', 'true');
  });

  it('zona táctil ≥ 44×44 (min-w/min-h en el botón)', () => {
    render(<PlanoMesas />);
    for (const b of screen.getAllByRole('button', { name: /^Mesa \d/ })) {
      expect(b.className).toMatch(/min-h-\[44px\]/);
      expect(b.className).toMatch(/min-w-\[44px\]/);
    }
  });

  it('tabla equivalente debajo: cabeceras Mesa/Tipo/Precio/Medida/Estado y una fila por mesa', () => {
    render(<PlanoMesas />);
    const table = screen.getByRole('table');
    for (const h of ['Mesa', 'Tipo', 'Precio', 'Medida', 'Estado']) {
      expect(within(table).getByRole('columnheader', { name: h })).toBeInTheDocument();
    }
    // una fila de datos por mesa (+1 de cabecera)
    expect(within(table).getAllByRole('row')).toHaveLength(totalMesas + 1);
  });
});
