import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import { SellCartFab } from './SellCartFab';

describe('SellCartFab (§18.4a) · FAB del carrito de venta', () => {
  it('vacío: SIN badge, con aria-label «…, vacío» (el FAB permanece: acceso a requisitos)', () => {
    renderWithIntl(<SellCartFab count={0} open={false} onClick={vi.fn()} />, 'es');

    const fab = screen.getByRole('button', { name: 'Carrito de venta, vacío' });
    expect(fab).toHaveAttribute('aria-haspopup', 'dialog');
    expect(fab).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('sell-cart-fab-badge')).not.toBeInTheDocument();
  });

  it('con piezas: badge contador aria-hidden; la cifra viaja en el aria-label', () => {
    renderWithIntl(<SellCartFab count={3} open={false} onClick={vi.fn()} />, 'es');

    expect(screen.getByRole('button', { name: 'Carrito de venta, 3 carta(s)' })).toBeInTheDocument();
    const badge = screen.getByTestId('sell-cart-fab-badge');
    expect(badge).toHaveAttribute('aria-hidden', 'true');
    expect(badge).toHaveTextContent('3');
  });

  it('cap visual del contador: más de 99 pinta «99+» (el aria-label conserva la cifra real)', () => {
    renderWithIntl(<SellCartFab count={130} open={false} onClick={vi.fn()} />, 'es');

    expect(screen.getByTestId('sell-cart-fab-badge')).toHaveTextContent('99+');
    expect(screen.getByRole('button', { name: 'Carrito de venta, 130 carta(s)' })).toBeInTheDocument();
  });

  it('abierto: aria-expanded=true; el clic dispara onClick', () => {
    const onClick = vi.fn();
    renderWithIntl(<SellCartFab count={1} open onClick={onClick} />, 'es');

    const fab = screen.getByTestId('sell-cart-fab');
    expect(fab).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(fab);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
