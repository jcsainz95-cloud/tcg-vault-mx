/**
 * §13 (plano) v2 — modelo NUMERADO (decisión JC): 23 mesas con tipo→precio y disponibilidad, SIN
 * medidas. Una mesa DISPONIBLE es un enlace a WhatsApp con el número prellenado; una APARTADA no es
 * clicable y se marca «Apartada» en texto. Tabla equivalente con columnas Mesa/Tipo/Precio/Estado
 * (API_CONTRACT §CARDSHOW.2, RONDA_0 §8).
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { CARD_SHOW, mesasResueltas } from '@/content/card-show';
import { PlanoMesas } from './PlanoMesas';

vi.mock('@/lib/card-show-clicks', () => ({ trackClick: vi.fn(), trackedHref: (d: string) => `/ir/${d}` }));

const mesas = mesasResueltas();
const totalMesas = mesas.length;
const apartadas = mesas.filter((m) => m.disponibilidad === 'apartada');
const disponibles = mesas.filter((m) => m.disponibilidad === 'disponible');

describe('PlanoMesas · modelo numerado v2', () => {
  it('el plano lista las 23 mesas, ordenadas 1→N', () => {
    render(<PlanoMesas />);
    const lista = screen.getByRole('list', { name: 'Plano de mesas del Card Show' });
    const items = within(lista).getAllByRole('listitem');
    expect(items).toHaveLength(totalMesas);
    expect(totalMesas).toBe(CARD_SHOW.mesas.totalMesas);
  });

  it('cada mesa DISPONIBLE es un enlace tabulable a WhatsApp con su número prellenado y nombre accesible', () => {
    render(<PlanoMesas />);
    // Solo los enlaces del PLANO llevan aria-label «Mesa N, …» (los de la tabla dicen «Disponible · apartar»).
    const links = screen.getAllByRole('link', { name: /^Mesa \d/ });
    expect(links).toHaveLength(disponibles.length);
    for (const m of disponibles) {
      const link = screen.getByRole('link', { name: new RegExp(`^Mesa ${m.numero},`) });
      expect(link.tagName).toBe('A');
      // Nombre accesible: «Mesa N, Tipo, Precio, Disponible».
      expect(link.getAttribute('aria-label')).toBe(`Mesa ${m.numero}, ${m.tipo.nombre}, ${m.tipo.precio}, Disponible`);
      // href a wa.me con el número prellenado (`%23{n}`).
      expect(link.getAttribute('href')).toContain('wa.me/525564893921');
      expect(link.getAttribute('href')).toContain(`%23${m.numero}.`);
      expect(link.getAttribute('target')).toBe('_blank');
    }
  });

  it('cada mesa APARTADA NO es un enlace: se muestra «Apartada» en texto', () => {
    render(<PlanoMesas />);
    expect(apartadas.length).toBeGreaterThan(0);
    for (const m of apartadas) {
      // No existe un enlace del plano para una mesa apartada.
      expect(screen.queryByRole('link', { name: new RegExp(`^Mesa ${m.numero},`) })).toBeNull();
    }
    const lista = screen.getByRole('list', { name: 'Plano de mesas del Card Show' });
    // Hay tantas celdas «Apartada» como mesas apartadas (en el plano).
    const apartadaCells = within(lista).getAllByText('Apartada');
    expect(apartadaCells).toHaveLength(apartadas.length);
  });

  it('zona táctil ≥44×72 en los enlaces de mesa (min-h/min-w)', () => {
    render(<PlanoMesas />);
    for (const b of screen.getAllByRole('link', { name: /^Mesa \d/ })) {
      expect(b.className).toMatch(/min-h-\[72px\]/);
      expect(b.className).toMatch(/min-w-\[44px\]/);
    }
  });

  it('tabla equivalente: cabeceras Mesa/Tipo/Precio/Estado (⛔ sin Medida) y una fila por mesa', () => {
    render(<PlanoMesas />);
    const table = screen.getByRole('table');
    for (const h of ['Mesa', 'Tipo', 'Precio', 'Estado']) {
      expect(within(table).getByRole('columnheader', { name: h })).toBeInTheDocument();
    }
    expect(within(table).queryByRole('columnheader', { name: 'Medida' })).toBeNull();
    // una fila de datos por mesa (+1 de cabecera)
    expect(within(table).getAllByRole('row')).toHaveLength(totalMesas + 1);
  });
});
